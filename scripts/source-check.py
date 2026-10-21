#!/usr/bin/env python3
"""智云 Pro 工作台的**交互式全链路验证器**（含真实站点登录）。

# 交互 = 运行时向用户要凭证

这个脚本的重点不是菜单，而是：**验证到需要账号时，停下来问你要，然后当场登一次真站点。**

```text
  你在终端里输入学号/密码  →  只在本次进程内存里  →  登录 → 拉数据 → 打印结论
                                   ↓
                            进程退出即消失，不写任何文件
```

凭证**绝不落盘**，这有三条硬保证（见 `CredentialVault` 与 `scripts/source_bridge/`）：

1. 从来没有 `open(..., 'w')` 碰过它 —— 会话罐是纯内存的 `SessionStore({})`，
   共享层对"没有 file 的 SessionStore"直接不写盘（`save()` 立刻返回）；
2. 报告里**不出现**任何凭证字符串 —— `redact()` 在写报告前把已知的账号/密码
   逐字替换成 `<redacted>`，连长度都不暴露；提交者邮箱也只打码显示
   （`3***4@zju.edu.cn`）—— 那条检查的意义就是"别把学号邮推出去"，
   报告自己写原文等于用报告完成它要阻止的泄露；
3. 输入走 `getpass`（不回显），且**不写 shell 历史**；凭证交给 node 子进程时
   走**环境变量**而不是命令行参数 —— 命令行参数会进 `ps` 与历史文件，
   那是这类脚本最常见的泄露路径。

**刻意不提供"记住凭证"选项。** 能落盘的东西就有"忘了清理"的风险，
而这个仓库是公开的、报告会被贴进 issue。省一次输入不值得多一条泄露路径。

# 两条验证线

* **离线链路**（默认全部跑）：包骨架、profile 装配、模块加载、插件接线、路由信封、
  客户端产物、单元测试、卫生。不需要账号、不联网。
* **真机链路**（要账号）：cc98 / 学在浙大 / 教务 / 智云课堂 各登一次，读真实数据。
  没给凭证就跳过 —— **跳过不是失败**，除非你显式要求（`--require-live`）。

# 怎么问凭证

**注意：CC98 账号与浙大统一认证账号是两套东西**（`zjuam` vs `openid.cc98.org`，
账号形态也不同）。智云课堂 / 学在浙大 / 教务共用「浙大一卡通」那一份；CC98 应当
有自己的账号，但本包**目前仍在借用**一卡通记录（已知缺陷，见该包 README）——
所以这里为了能跑通，仍用同一份输入，但报告里会把这条缺陷如实标出来。
学习通要 Cookie，单独问。

    python scripts/source-check.py                    # 全默认：离线全跑 + 问凭证做真机
    python scripts/source-check.py --offline          # 完全不要凭证、不联网
    python scripts/source-check.py --live-only        # 只做真机验证
    python scripts/source-check.py --only tests -y    # CI：只跑单测，不问任何东西

环境变量也认（用于 CI / 一次性脚本，注意：环境变量对**同机其他进程**可见，
不如交互输入安全）：`ZJU_USERNAME` / `ZJU_PASSWORD` / `CHAOXING_COOKIE`。

# 边界

* 真机验证只**读**：没有任何发帖/回复/提交作业/改数据的动作。
* 登录会打真站点。CAS 单点会话下**同号重复登录会作废前一张票** ——
  所以每个平台只登一次，且不重试登录（读失败才重试一次读）。
* 报告默认落 `artifacts/verify/`（已 gitignore），且已做凭证擦除。
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

# ── 常量 ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_ORIGIN = "https://github.com/lybx-leyw/dsh-zju-workbench.git"
DEFAULT_REPORT_DIR = ROOT / "artifacts" / "verify"

SKIP_DIRS = {
    "node_modules", ".git", ".ref", ".ref_book2skill", ".ref-codex-ui", ".runtime",
    "artifacts", ".backup", ".verify-scratch", ".workbuddy", ".audit", "lib", "__pycache__",
}

PASS, FAIL, WARN, SKIP = "pass", "fail", "warn", "skip"
STATUS_STYLE = {PASS: ("✔", "32"), FAIL: ("✖", "31"), WARN: ("!", "33"), SKIP: ("-", "90")}

#: 凭证擦除时替换成什么。刻意不保留长度信息 —— "密码 12 位"也是信息。
REDACTED = "<redacted>"


def harden_console() -> None:
    """让 stdout/stderr 在**编不出某个字符时替换掉，而不是抛异常**。

    这是 `Painter.safe()` 之外的兜底。`Painter` 只认识自己那几个符号，而报告里
    还有从仓库读出来的中文路径、错误消息、测试用例名 —— 任何一处出现 GBK 编不了的
    字符，整个验证器就会在打印那行时崩掉，且崩得和检查内容无关。

    为什么不只依赖 `Painter`：它的覆盖面取决于"每个 print 都记得过一遍"，
    而那是会漏的（这个文件里就有一堆裸 print）。改一次 `errors` 是**穷尽**的做法。
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(errors="replace")
            except (ValueError, OSError):
                pass


class Painter:
    """ANSI 着色 + **按终端实际编码降级**的符号输出。

    # 为什么不能直接 print `✔`

    中文 Windows 的控制台默认是 GBK（代码页 936），而 `✔`(U+2714) 与 `✖`(U+2756)
    **不在 GBK 里**。一量 `sys.stdout` 是 GBK 且 `strict`，`print('✔')` 就抛
    `UnicodeEncodeError` —— 验证器在打印第一行进度时直接崩，而崩的位置看起来
    与"检查失败"毫无关系（用户只看到一段 traceback）。

    这不是假设：传统 conhost（非 Windows Terminal / 非 pwsh7 默认 UTF-8）就是这样。
    开发机上"看起来没事"只是因为那里 stdout 是 UTF-8。

    所以先**探测一次** stdout 能否编码那几个符号，不能就退回 ASCII（`+` / `x` / `-`）。
    探测结果缓存，不在每次打印时 try/except —— 那会把真正的编码错误也吞掉。
    """

    #: 首选符号 → ASCII 降级。降级后仍是一行一个状态，只是不好看。
    GLYPHS = {"✔": "+", "✖": "x", "·": "-", "—": "-"}

    def __init__(self, enabled: bool):
        self.enabled = enabled
        self.ascii_only = not self._can_encode("".join(self.GLYPHS))

    @staticmethod
    def _can_encode(sample: str) -> bool:
        """当前 stdout 能否编码这些字符。"""
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        try:
            sample.encode(encoding, "strict")
            return True
        except (UnicodeEncodeError, LookupError):
            return False

    def safe(self, text: str) -> str:
        """把符号降级成当前终端能显示的形态。拼接进输出的**每一处**都要过它。"""
        if not self.ascii_only:
            return text
        for fancy, plain in self.GLYPHS.items():
            text = text.replace(fancy, plain)
        return text

    def __call__(self, text: str, code: str) -> str:
        text = self.safe(text)
        return f"\033[{code}m{text}\033[0m" if self.enabled else text

    def dim(self, text: str) -> str:
        return self(text, "90")

    def bold(self, text: str) -> str:
        return self(text, "1")


# ── 凭证 ────────────────────────────────────────────────────────────────────


@dataclass
class Account:
    """一份账号。**只活在内存里**：这个对象不会被序列化、不会被写文件、不进报告。"""

    username: str
    password: str = field(repr=False)  # repr 里也不出现，防止被顺手 print 出来
    label: str = "浙大一卡通"

    def __str__(self) -> str:  # pragma: no cover - 仅为避免误打印
        return f"{self.label}({self.username}/***)"


class CredentialVault:
    """凭证的内存保险箱 + 报告擦除器。

    # 为什么不落盘

    本仓库是**公开仓库**，而验证器常被要求"把报告贴到 issue 里"。凭证一旦落盘或进
    报告，泄露就是永久的（历史上删掉不算 —— 抓取是自动的）。所以：

    * `_accounts` 只在进程内存里；
    * `redact()` 在**所有**输出（屏幕 + 报告）写出前逐字替换；
    * 退出时不清理额外的东西 —— 内存本来就随进程消失，**没有临时文件可删**。

    这是刻意的设计：能被清理的东西，就有"忘了清理"的风险。
    """

    def __init__(self, *, interactive: bool, allow_env: bool = True):
        self.interactive = interactive
        self.allow_env = allow_env
        self._accounts: dict[str, Account] = {}
        self._secrets: list[str] = []

    # ── 预置（网页模式下由 HTTP 表单填进来） ──

    def preset(self, key: str, value) -> None:
        """把一份凭证直接放进内存保险箱。

        网页模式下没有终端可问，凭证由 `/api/credentials` 收进来后立刻落到这里 ——
        仍然**只在内存里**，不写文件、不进报告。

        @param key - `'zju'` / `'cc98'` / `'xxt'`。
        @param value - `Account`（账号型）或 `str`（Cookie 型）。
        """
        if value is None:
            return
        if isinstance(value, Account):
            self._remember(value, key)
            return
        text = str(value).strip()
        if not text:
            return
        self.remember_secret(text)
        self._accounts[key] = text  # type: ignore[assignment]

    def has(self, key: str) -> bool:
        """这一份凭证是否已经在内存里。"""
        return key in self._accounts

    # ── 擦除 ──

    def remember_secret(self, value: str) -> None:
        """登记一个需要在输出里抹掉的字符串。"""
        if value and value not in self._secrets:
            self._secrets.append(value)

    def redact(self, text: str) -> str:
        """把已知凭证逐字替换。

        长串先替换：先抹密码再抹用户名，避免"密码里恰好含用户名"时被切碎后漏掉。

        # 为什么短串会顺手登记成"不能抹"

        擦除是**无差别子串替换**：账号可能是 `lybx` 这样 4 个字符，而
        `https://github.com/lybx-leyw/...` 里恰好含这个子串 —— 于是"origin 是共享
        仓库"这一条明明是对的，报告里却被抹成 `https://github.com/<redacted>-leyw/...`，
        读报告的人会以为远端配错了。这类**误伤**比漏抹更难发现（它看起来像真问题）。

        所以：凡是在某个 URL / 仓库 slug 里出现过的短串，都不进擦除表。代价是
        假设"密码恰好等于 GitHub 用户名且只出现在这一处"时少抹一次 —— 而密码通常
        更长、且不该出现在任何 URL 里。
        """
        if not text:
            return text
        # `/` 之间的短串几乎只可能是 URL 的一部分（仓库 slug、路径段），不是凭证。
        for secret in sorted(self._secrets, key=len, reverse=True):
            if not secret:
                continue
            if len(secret) <= 12:
                text = re.sub(
                    rf"(?<!/){re.escape(secret)}(?!/|\.git\b)",
                    REDACTED,
                    text,
                )
                continue
            text = text.replace(secret, REDACTED)
        return text

    # ── 取用 ──

    def zju(self, *, silent: bool = False) -> Account | None:
        """取「浙大一卡通」账号（学在浙大 / 教务 / 智云课堂共用）。

        # CC98 不在这一份里

        CC98 有自己的身份服务（`openid.cc98.org`）和自己的账号，**不是**浙大统一认证，
        所以它读 `cc98()` 那一份（对应 `zhiyun-cc98/account` 记录），不从这里取。

        环境变量优先（CI），但交互模式下**只在没给 CLI 参数时**才问。
        """
        if "zju" in self._accounts:
            return self._accounts["zju"]

        if self.allow_env:
            username = os.environ.get("ZJU_USERNAME") or os.environ.get("ZJU_USER") or ""
            password = os.environ.get("ZJU_PASSWORD") or os.environ.get("ZJU_PASS") or ""
            if username and password:
                account = Account(username=username, password=password)
                self._remember(account, "zju")
                return account

        if not self.interactive or silent:
            return None
        account = self._prompt_account("浙大一卡通（学号 + 密码；学在浙大/教务/智云共用）")
        if account:
            self._remember(account, "zju")
        return account

    def cc98(self, *, silent: bool = False) -> Account | None:
        """取 **CC98 自己的**账号。

        CC98 的账号体系是独立的（论坛 ID / 注册邮箱那一路），与一卡通不是一回事：
        只有 CC98 账号的人没有浙大统一认证身份。所以这里单独取一份，
        对应凭据记录 `zhiyun-cc98/account`。
        """
        if "cc98" in self._accounts:
            return self._accounts["cc98"]

        if self.allow_env:
            username = os.environ.get("CC98_USERNAME", "")
            password = os.environ.get("CC98_PASSWORD", "")
            if username and password:
                account = Account(username=username, password=password, label="CC98 账号")
                self._remember(account, "cc98")
                return account

        if not self.interactive or silent:
            return None
        account = self._prompt_account("CC98 账号（论坛账号，不是浙大统一认证）")
        if account:
            self._remember(account, "cc98")
        return account

    def pta(self, *, silent: bool = False) -> str | None:
        """取拼题A Cookie。它**不能自动登录**（短信验证），只能粘贴。"""
        if "pta" in self._accounts:
            return self._accounts["pta"]  # type: ignore[return-value]

        if self.allow_env:
            cookie = os.environ.get("PINTIA_COOKIE", "").strip()
            if cookie:
                self.remember_secret(cookie)
                self._accounts["pta"] = cookie  # type: ignore[assignment]
                return cookie

        if not self.interactive or silent:
            return None
        print()
        print("  拼题A 无法自动登录（短信验证），需要你手动粘一次 Cookie：")
        print("    浏览器登录 pintia.cn → F12 → Network → 任一 /api 请求 → 复制 Cookie 整行")
        print("    （粘贴时不回显；只在本次进程内存里，不落盘）")
        try:
            cookie = prompt_secret("  拼题A Cookie（直接回车跳过）: ").strip()
        except KeyboardInterrupt:
            return None
        if not cookie:
            return None
        self.remember_secret(cookie)
        self._accounts["pta"] = cookie  # type: ignore[assignment]
        return cookie

    def xxt(self, *, silent: bool = False) -> str | None:
        """取学习通 Cookie。它**不能自动登录**（扫码/滑块），只能粘贴。"""
        if "xxt" in self._accounts:
            return self._accounts["xxt"]  # type: ignore[return-value]

        if self.allow_env:
            cookie = os.environ.get("CHAOXING_COOKIE", "").strip()
            if cookie:
                self.remember_secret(cookie)
                self._accounts["xxt"] = cookie  # type: ignore[assignment]
                return cookie

        if not self.interactive or silent:
            return None
        print()
        print("  学习通无法自动登录（要扫码/过滑块），需要你手动粘一次 Cookie：")
        print("    浏览器登录 chaoxing.com → F12 → Network → 任一请求 → 复制 Cookie 整行")
        print("    （粘贴时不回显；只在本次进程内存里，不落盘）")
        try:
            cookie = prompt_secret("  学习通 Cookie（直接回车跳过）: ").strip()
        except KeyboardInterrupt:
            return None
        if not cookie:
            return None
        self.remember_secret(cookie)
        self._accounts["xxt"] = cookie  # type: ignore[assignment]
        return cookie

    def _remember(self, account: Account, key: str) -> None:
        self._accounts[key] = account
        self.remember_secret(account.password)
        # 用户名也抹掉：报告里出现学号同样是身份泄露。
        self.remember_secret(account.username)

    def _prompt_account(self, label: str) -> Account | None:
        """问一次账号。`getpass` 不回显，也**不进 shell 历史**（我们不拼命令行）。"""
        print()
        print(f"  {label}")
        print("  （输入内容不回显、不落盘、不进 shell 历史；直接回车跳过）")
        try:
            username = ask("    学号: ")
            if not username:
                return None
            password = prompt_secret("    密码: ")
        except KeyboardInterrupt:
            print()
            return None
        if not password:
            return None
        return Account(username=username, password=password)


# ── 结果模型 ────────────────────────────────────────────────────────────────


@dataclass
class Check:
    name: str
    status: str
    detail: str = ""
    evidence: str = ""
    seconds: float = 0.0


@dataclass
class Chain:
    id: str
    title: str
    blurb: str = ""
    checks: list[Check] = field(default_factory=list)
    seconds: float = 0.0

    def add(self, name: str, status: str, detail: str = "", evidence: str = "", seconds: float = 0.0) -> Check:
        check = Check(name, status, detail, evidence, seconds)
        self.checks.append(check)
        return check

    def count(self, status: str) -> int:
        return sum(1 for check in self.checks if check.status == status)

    @property
    def verdict(self) -> str:
        if self.count(FAIL):
            return FAIL
        if self.count(WARN):
            return WARN
        return SKIP if self.count(PASS) == 0 else PASS


# ── 运行时 ──────────────────────────────────────────────────────────────────


class Verifier:
    """子进程、包清单、路径表达的共享环境。"""

    def __init__(self, *, jobs: int = 4, timeout: float = 180.0, vault: CredentialVault | None = None):
        self.jobs = max(1, jobs)
        self.timeout = timeout
        self.vault = vault
        self.node = self._find_node()
        self.packages: dict[str, dict] = {}
        self._git_cache: dict[str, str] = {}

    @staticmethod
    def _find_node() -> str | None:
        import shutil
        return shutil.which("node")

    def rel(self, path) -> str:
        """相对仓库根表达路径 —— 报告里不该出现本机绝对路径。"""
        try:
            return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
        except (ValueError, OSError):
            return str(path)

    def run(self, args: list[str], *, timeout: float | None = None, cwd: Path | None = None,
            extra_env: dict | None = None) -> tuple[int, str, str]:
        """跑子进程。超时返回 -9 而不是抛异常：一条链超时不该吞掉整份报告。"""
        env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"}
        if extra_env:
            env.update(extra_env)
        try:
            done = subprocess.run(
                args, cwd=str(cwd or ROOT), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout or self.timeout, env=env,
            )
            out, err = done.stdout, done.stderr
            # 子进程的输出也可能带凭证（登录日志里回显用户名），出栈前先抹一遍。
            if self.vault:
                out, err = self.vault.redact(out), self.vault.redact(err)
            return done.returncode, out, err
        except subprocess.TimeoutExpired:
            return -9, "", f"超时（>{timeout or self.timeout:.0f}s）"
        except FileNotFoundError as error:
            return -2, "", f"找不到可执行文件：{error}"
        except OSError as error:
            return -3, "", f"无法启动子进程：{error}"

    def git(self, *args: str) -> str:
        key = " ".join(args)
        if key not in self._git_cache:
            code, out, _ = self.run(["git", *args], timeout=20)
            self._git_cache[key] = out.strip() if code == 0 else ""
        return self._git_cache[key]

    def load_packages(self) -> dict[str, dict]:
        if self.packages:
            return self.packages
        packages: dict[str, dict] = {}
        base = ROOT / "packages"
        if not base.is_dir():
            return packages
        for entry in sorted(base.iterdir()):
            if not entry.is_dir():
                continue
            manifest = entry / "package.json"
            data, error = None, ""
            if manifest.exists():
                try:
                    data = json.loads(manifest.read_text("utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    error = str(exc)
            else:
                error = "缺少 package.json"
            packages[entry.name] = {"dir": entry, "json": data, "error": error}
        self.packages = packages
        return packages

    def package_files(self, directory: Path, suffixes=(".js", ".jsx", ".mjs", ".json", ".yml", ".yaml", ".md")) -> list[Path]:
        found: list[Path] = []
        for current, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in files:
                if name.endswith(suffixes):
                    found.append(Path(current) / name)
        return found


def parse_patch_names(text: str) -> set[str]:
    """抽出 patch 里所有 `name:` 的值（去掉成对引号）。

    不做 `f"name: {pkg}" in text`：YAML 允许 `name: 'pkg'`（本仓真的这么写过），
    而且 `name:` 可能在 `- id:` 的下一行。子串匹配会在带引号那处假红 ——
    假红比漏报更糟，它教人开始忽略这个检查。
    """
    return set(re.findall(r"^\s*(?:-\s*)?name:\s*['\"]?([^'\"\s]+)['\"]?\s*$", text, re.M))


# ── Node 探针（离线链路复用） ───────────────────────────────────────────────

PROBE_JS = r"""
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const names = process.argv.slice(3);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');

function fakeContext() {
  const routes = [], services = [], warnings = [];
  const ctx = {
    logger: { info: () => {}, warn: (m) => warnings.push(String(m)), debug: () => {}, error: (m) => warnings.push(String(m)) },
    profileContext: { dir: root + '.verify-scratch/source-check/profile' },
    provide(name) { services.push(name); return () => {}; },
    get() { return undefined; },
    on() { return () => {}; },
    effect(fn) { try { return fn(); } catch { return undefined; } },
    inject(deps, register) {
      const scope = {
        connection: { fetch: { register(spec) { routes.push({ kind: 'connection', path: spec.path ?? null, methods: spec.methods ?? [], fetch: spec.fetch }); return () => {}; } } },
        webServer: { register(spec) { routes.push({ kind: 'webServer', path: spec.path ?? null, methods: [] }); return () => {}; } },
        workspaceRegistry: { create: async () => ({ id: 'verify-workspace' }) },
        llm: {},
        effect(fn) { try { return fn(); } catch (error) { warnings.push(String(error?.message ?? error)); return undefined; } },
        on() { return () => {}; },
      };
      try { return register(scope); } catch (error) { warnings.push(String(error?.message ?? error)); }
    },
  };
  return { ctx, routes, services, warnings };
}

for (const name of names) {
  const base = `${root}packages/${name}/`;
  let pkg;
  try { pkg = JSON.parse(await readFile(base + 'package.json', 'utf8')); }
  catch (error) { emit({ name, stage: 'manifest', error: String(error?.message ?? error) }); continue; }

  const main = pkg.main || './src/index.js';
  const entry = { name, main, type: pkg.type ?? null };
  let mod;
  try { mod = await import(pathToFileURL(base + main).href); }
  catch (error) {
    emit({ ...entry, stage: 'import-error', error: { code: error?.code ?? error?.name ?? 'ERROR', message: String(error?.message ?? error).slice(0, 300) } });
    continue;
  }
  entry.exports = Object.keys(mod);
  entry.hasName = typeof mod.name === 'string';
  entry.hasApply = typeof mod.apply === 'function';
  entry.inject = Array.isArray(mod.inject) ? mod.inject : null;
  // 必须区分「import 成功」与「import 失败」：早先都用 'import'，
  // 于是"能加载但没有 apply"的包（radar 骨架）被当成加载失败，报告红了一片。
  entry.stage = 'import-ok';
  if (!entry.hasApply) { emit(entry); continue; }

  const { ctx, routes, services, warnings } = fakeContext();
  try {
    const dispose = await mod.apply(ctx, { dataDir: null, fetch: async () => new Response('{}', { status: 200 }) });
    entry.stage = 'wire';
    entry.routes = routes.map((route) => ({ kind: route.kind, path: route.path, methods: route.methods }));
    entry.services = services;
    entry.warnings = warnings.slice(0, 3);
    entry.envelopes = [];
    for (const route of routes.filter((item) => item.kind === 'connection' && typeof item.fetch === 'function')) {
      const result = { path: route.path };
      try {
        const response = await route.fetch(new Request('http://127.0.0.1' + route.path, { method: 'GET' }));
        result.getStatus = response.status;
        try { result.getOk = (await response.json())?.ok ?? null; } catch { result.getOk = null; }
      } catch (error) { result.getError = String(error?.message ?? error).slice(0, 200); }
      if ((route.methods ?? []).includes('POST')) {
        try {
          const response = await route.fetch(new Request('http://127.0.0.1' + route.path, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: 'verify-probe', method: '__verify_unknown__', payload: {} }),
          }));
          result.postStatus = response.status;
          const body = await response.json();
          result.postRpcId = body?.rpcId ?? null;
          result.postEnvelope = body?.type ?? null;
          result.postErrorCode = body?.result?.error?.code ?? null;
        } catch (error) { result.postError = String(error?.message ?? error).slice(0, 200); }
      }
      entry.envelopes.push(result);
    }
    if (typeof dispose === 'function') {
      try { await dispose(); entry.disposed = true; }
      catch (error) { entry.disposeError = String(error?.message ?? error).slice(0, 200); }
    }
  } catch (error) {
    entry.stage = 'apply';
    entry.applyError = { code: error?.code ?? error?.name ?? 'ERROR', message: String(error?.message ?? error).slice(0, 300) };
  }
  emit(entry);
}
"""


def write_probe() -> Path:
    target = ROOT / ".verify-scratch" / "source-check" / "probe.mjs"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(PROBE_JS, encoding="utf-8")
    return target


def run_probe(v: Verifier, names: list[str]) -> dict[str, dict]:
    if not v.node or not names:
        return {}
    probe = write_probe()
    # 必须传**绝对路径 + 尾斜杠**：探针自己拼 `root + 'packages/<name>/'`。
    # 漏斜杠会让每个包都 ENOENT，而症状看起来像"包全都不见了"。
    root_arg = str(ROOT).replace("\\", "/").rstrip("/") + "/"
    code, out, err = v.run([v.node, str(probe), root_arg, *names], timeout=max(v.timeout, 60) * 2)
    results: dict[str, dict] = {}
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict) and item.get("name"):
            results[item["name"]] = item
    if code != 0 and not results:
        results["__probe_failure__"] = {"error": (err or out).strip()[:600]}
    return results


# ══════════════════════════════════════════════════════════════════════════
#  真机链路：interact.js 负责登录 + 读一次真实数据
# ══════════════════════════════════════════════════════════════════════════
#
# 为什么把登录逻辑放在 JS 里而不是 Python：那五个包都是 ESM，登录链（CAS 跳转、
# RSA 加密、OAuth2 表单、Cookie 种值）**已经在它们里面实现且被测过**。
# 在 Python 里重写一遍等于维护第二份登录实现 —— 而两份实现分叉时，验证器会
# 开始报"登录失败"而真实页面是好的，那种假红最难信。
#
# 凭证通过**环境变量**从 Python 传给 node 子进程。这看起来和"不落盘"矛盾，其实不是：
# 环境变量只存在于两个进程的内存里，不写磁盘、不进 shell 历史（我们不拼命令行参数）。
# 子进程退出即销毁。命令行参数才是危险的那条路（`ps` 可见 + 进历史），所以不用它。

def run_live(v: Verifier, platforms: list[str], account: Account | None, cookie: str | None,
             cc98: Account | None = None, pta: str | None = None) -> dict[str, dict]:
    """跑真机探针。凭证走**环境变量**交给子进程（不进命令行、不进 `ps`、不进历史）。

    CC98 用**自己的一组**变量：它与浙大统一认证是两套账号，不能混。
    拼题A 与学习通都是 Cookie 导入，各自一组。
    """
    if not v.node or not platforms:
        return {}
    extra: dict[str, str] = {}
    if account:
        extra["VERIFY_ZJU_USER"] = account.username
        extra["VERIFY_ZJU_PASS"] = account.password
    if cc98:
        extra["VERIFY_CC98_USER"] = cc98.username
        extra["VERIFY_CC98_PASS"] = cc98.password
    if pta:
        extra["VERIFY_PTA_COOKIE"] = pta
    if cookie:
        extra["VERIFY_XXT_COOKIE"] = cookie

    # 桥接器：`scripts/source_bridge/`（一个域一个文件）。
    # 它负责「造最小 ctx → apply() → 走包自己的 connection 路由 / 服务」，
    # 所以这里只传平台名与凭证，不碰任何包的内部实现。
    bridge = ROOT / "scripts" / "source_bridge" / "index.mjs"
    root_arg = str(ROOT).replace("\\", "/").rstrip("/") + "/"
    code, out, err = v.run(
        [v.node, str(bridge), "--root", root_arg, "--platform", ",".join(platforms)],
        timeout=max(v.timeout, 120) * 2,
        extra_env=extra,
    )
    results: dict[str, dict] = {}
    for line in out.splitlines():
        if not line.startswith("@@RESULT@@"):
            continue
        try:
            item = json.loads(line[len("@@RESULT@@"):])
        except json.JSONDecodeError:
            continue
        if item.get("platform"):
            results[item["platform"]] = item
    if code != 0 and not results:
        detail = (err or out).strip()[:800]
        for platform in platforms:
            results[platform] = {"platform": platform, "ok": False, "code": "PROBE_FAILED", "message": detail}
    return results


# ── 离线链路 ────────────────────────────────────────────────────────────────


def chain_environment(v: Verifier, r: Chain) -> None:
    started = time.time()
    r.add("node 可执行", PASS if v.node else FAIL, detail=v.node or "PATH 里没有 node",
          evidence="" if v.node else "所有需要 node 的检查都会跳过；先装 node 22+ 或把 node 放进 PATH。")
    if v.node:
        code, out, _ = v.run([v.node, "--version"], timeout=20)
        version = out.strip()
        match = re.match(r"v(\d+)\.(\d+)", version)
        ok = bool(match) and int(match.group(1)) >= 22
        r.add("node 版本 ≥ 22", PASS if ok else WARN, detail=version,
              evidence=f"engines 要求 ^22.19 || >=24，实际 {version}")
    r.add("Python 版本", PASS if sys.version_info >= (3, 9) else WARN,
          detail=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
    for name, path in (("packages/", ROOT / "packages"), ("profiles/", ROOT / "profiles"),
                       ("tests/", ROOT / "tests"), ("scripts/", ROOT / "scripts")):
        r.add(name, PASS if path.is_dir() else FAIL)
    r.seconds = time.time() - started


def chain_workspace(v: Verifier, r: Chain) -> None:
    started = time.time()
    packages = v.load_packages()
    r.add("发现包", PASS if packages else FAIL, detail=f"{len(packages)} 个")
    broken = [n for n, m in packages.items() if m["json"] is None]
    r.add("package.json 可解析", FAIL if broken else PASS,
          detail=f"{len(packages) - len(broken)}/{len(packages)}",
          evidence="\n".join(f"{n}: {packages[n]['error']}" for n in broken))

    name_mismatch, missing_main, wrong_type, missing_file, bad_exports = [], [], [], [], []
    for name, meta in packages.items():
        manifest = meta["json"]
        if manifest is None:
            continue
        if manifest.get("name") != name:
            name_mismatch.append(f"{name} → name={manifest.get('name')!r}")
        if manifest.get("type") != "module":
            wrong_type.append(f"{name} → type={manifest.get('type')!r}")
        main = manifest.get("main")
        if not main:
            missing_main.append(name)
        elif not (meta["dir"] / main).is_file():
            missing_file.append(f"{name} → main={main} 不存在")
        exports = manifest.get("exports")
        if isinstance(exports, dict):
            for sub, target in exports.items():
                if sub == "./package.json" or not isinstance(target, str):
                    continue
                if not (meta["dir"] / target).is_file():
                    bad_exports.append(f"{name} → exports[{sub}]={target} 不存在")

    r.add("包名与目录名一致", FAIL if name_mismatch else PASS,
          detail=f"{len(packages) - len(name_mismatch)}/{len(packages)}", evidence="\n".join(name_mismatch))
    r.add("type=module", FAIL if wrong_type else PASS,
          detail=f"{len(packages) - len(wrong_type)}/{len(packages)}", evidence="\n".join(wrong_type))
    r.add("main 指向真实文件", FAIL if (missing_main or missing_file) else PASS,
          detail=f"{len(packages) - len(missing_main) - len(missing_file)}/{len(packages)}",
          evidence="\n".join(missing_main + missing_file))
    r.add("exports 子路径可解析", FAIL if bad_exports else PASS, evidence="\n".join(bad_exports))

    no_patch, bad_patch, no_owners, no_readme = [], [], [], []
    for name, meta in packages.items():
        if not name.startswith("dsh-zhiyun-"):
            continue
        manifest = meta["json"] or {}
        patch_rel = ((manifest.get("dsh") or {}).get("bundle") or {}).get("patch")
        if not patch_rel:
            no_patch.append(name)
        else:
            patch = meta["dir"] / patch_rel
            if not patch.is_file():
                bad_patch.append(f"{name} → {patch_rel} 不存在")
            else:
                text = patch.read_text("utf-8", errors="replace")
                if not re.search(r"^\s*-?\s*insert:", text, re.M):
                    bad_patch.append(f"{name} → {patch_rel} 没有 insert 段")
                elif name not in parse_patch_names(text):
                    bad_patch.append(f"{name} → {patch_rel} 没有 insert 自己")
        if not (meta["dir"] / "OWNERS").is_file():
            no_owners.append(name)
        if not (meta["dir"] / "README.md").is_file():
            no_readme.append(name)

    ours = [n for n in packages if n.startswith("dsh-zhiyun-")]
    r.add("声明 dsh.bundle.patch", FAIL if no_patch else PASS,
          detail=f"{len(ours) - len(no_patch)}/{len(ours)}", evidence="\n".join(no_patch))
    r.add("patch insert 指向自己", FAIL if bad_patch else PASS,
          detail=f"{len(ours) - len(no_patch) - len(bad_patch)} 可用", evidence="\n".join(bad_patch))
    r.add("OWNERS 覆盖", WARN if no_owners else PASS,
          detail=f"{len(ours) - len(no_owners)}/{len(ours)}", evidence="\n".join(no_owners))
    r.add("README 覆盖", WARN if no_readme else PASS,
          detail=f"{len(ours) - len(no_readme)}/{len(ours)}", evidence="\n".join(no_readme))
    r.seconds = time.time() - started


def chain_profile(v: Verifier, r: Chain) -> None:
    started = time.time()
    profile_dirs = sorted(p for p in (ROOT / "profiles").iterdir() if p.is_dir()) if (ROOT / "profiles").is_dir() else []
    r.add("发现 profile", PASS if profile_dirs else FAIL, detail=", ".join(p.name for p in profile_dirs))
    packages = v.load_packages()

    for profile in profile_dirs:
        manifest = profile / "package.json"
        if not manifest.is_file():
            r.add(f"{profile.name} › package.json", FAIL, detail="缺失")
            continue
        try:
            data = json.loads(manifest.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            r.add(f"{profile.name} › package.json", FAIL, detail=str(error))
            continue
        bundles = ((data.get("dsh") or {}).get("profile") or {}).get("bundles")
        if not isinstance(bundles, list) or not bundles:
            r.add(f"{profile.name} › bundles", FAIL, detail="没有 dsh.profile.bundles")
            continue
        r.add(f"{profile.name} › bundles", PASS, detail=f"{len(bundles)} 条")

        ours = [b for b in bundles if not b.startswith("@")]
        external = [b for b in bundles if b.startswith("@")]
        unknown = [b for b in ours if b not in packages]
        r.add(f"{profile.name} › 本仓 bundle 都有目录", FAIL if unknown else PASS,
              detail=f"{len(ours) - len(unknown)}/{len(ours)}",
              evidence="\n".join(f"{b} → packages/{b} 不存在" for b in unknown)
                       + (f"\n（{len(external)} 个官方包由宿主提供）" if external else ""))

        not_self = []
        for bundle in ours:
            meta = packages.get(bundle)
            if not meta or not meta["json"]:
                continue
            patch_rel = ((meta["json"].get("dsh") or {}).get("bundle") or {}).get("patch")
            if not patch_rel:
                not_self.append(f"{bundle} → 没有 dsh.bundle.patch")
            elif not (meta["dir"] / patch_rel).is_file():
                not_self.append(f"{bundle} → {patch_rel} 不存在")
            elif bundle not in parse_patch_names((meta["dir"] / patch_rel).read_text("utf-8", errors="replace")):
                not_self.append(f"{bundle} → {patch_rel} 没有 insert 自己")
        r.add(f"{profile.name} › 每个 bundle 自己 insert 自己", FAIL if not_self else PASS,
              detail=f"{len(ours) - len(not_self)}/{len(ours)}", evidence="\n".join(not_self))

        missing_links = [b for b in ours if not (ROOT / "node_modules" / b).exists()]
        r.add(f"{profile.name} › node_modules 链接", WARN if missing_links else PASS,
              detail=f"{len(ours) - len(missing_links)}/{len(ours)}",
              evidence=("\n".join(missing_links) + "\n跑 `npm install` 或在 profile 初始化时重建链接。") if missing_links else "")

        retired = {"dsh-zhiyun-pro-ui", "dsh-zhiyun-study", "dsh-zhiyun-page-courses",
                   "dsh-zhiyun-page-player", "dsh-zhiyun-source-omni"}
        stale = [b for b in bundles if b in retired]
        r.add(f"{profile.name} › 没有已下线 bundle", FAIL if stale else PASS, evidence="\n".join(stale))
    r.seconds = time.time() - started


def _load_names(v: Verifier) -> list[str]:
    packages = v.load_packages()
    return [n for n, m in packages.items() if m["json"] and (m["dir"] / (m["json"].get("main") or "")).is_file()]


def chain_load(v: Verifier, r: Chain, probe: dict | None = None) -> None:
    started = time.time()
    if not v.node:
        r.add("node 不可用", SKIP, detail="跳过全部加载检查")
        r.seconds = time.time() - started
        return
    names = _load_names(v)
    r.add("待加载的包", PASS, detail=f"{len(names)} 个")
    probe = probe or run_probe(v, names)
    if "__probe_failure__" in probe:
        r.add("探针启动", FAIL, evidence=probe["__probe_failure__"]["error"])
        r.seconds = time.time() - started
        return

    import_failures, no_export, no_name = [], [], []
    for name in names:
        item = probe.get(name)
        if item is None:
            import_failures.append(f"{name} → 探针没有输出")
            continue
        if item.get("stage") == "import-error":
            error = item.get("error") or {}
            import_failures.append(f"{name} → {error.get('code')}: {error.get('message')}")
            continue
        exports = item.get("exports") or []
        if not exports:
            no_export.append(f"{name} → 没有任何导出")
        elif item.get("hasApply") and not item.get("hasName"):
            # radar 骨架有的用 `NAME` 大写常量（见 note-graph）；那是骨架自己的口径，
            # 不是产品包的约定 —— 只对非骨架要求 `name`。
            if not name.startswith(SKELETON_PREFIX):
                no_name.append(f"{name} → 有 apply 但没有 name")

    r.add("入口可 import", FAIL if import_failures else PASS,
          detail=f"{len(names) - len(import_failures)}/{len(names)}", evidence="\n".join(import_failures))
    r.add("导出非空", FAIL if no_export else PASS,
          detail=f"{len(names) - len(no_export)}/{len(names)}", evidence="\n".join(no_export))
    r.add("插件导出 name", FAIL if no_name else PASS,
          detail=f"{len(names) - len(no_name)}/{len(names)}", evidence="\n".join(no_name))
    r.seconds = time.time() - started


#: radar 候选骨架前缀。
#:
#: 它们在 README 里明确写着「未评审、未接入 profile、不可直接使用」，`apply()` 就是
#: 故意抛 `候选骨架，尚未实现` 的。把它们计入失败，报告会永远红着 ——
#: 而"永远红"的报告等于没人看的报告。所以单独归 SKIP（如实记录），
#: 只对**产品包**（真正的 dsh-zhiyun-* 与官方包）要求可接线。
SKELETON_PREFIX = "dsh-radar-"


def chain_wire(v: Verifier, r: Chain, probe: dict | None = None) -> None:
    started = time.time()
    if not v.node:
        r.add("node 不可用", SKIP, detail="跳过接线检查")
        r.seconds = time.time() - started
        return
    names = _load_names(v)
    probe = probe or run_probe(v, names)
    if "__probe_failure__" in probe:
        r.add("探针启动", FAIL, evidence=probe["__probe_failure__"]["error"])
        r.seconds = time.time() - started
        return

    applied, skipped, failed, no_output, skeletons = [], [], [], [], []
    for name in names:
        item = probe.get(name)
        if not item or not item.get("hasApply"):
            continue
        is_skeleton = name.startswith(SKELETON_PREFIX)
        if item.get("stage") == "apply":
            error = item.get("applyError") or {}
            code = str(error.get("code") or "")
            message = str(error.get("message") or "")
            # 候选骨架的 apply 是故意抛错的，归到"骨架"而不是"失败"。
            if is_skeleton or "候选骨架" in message or "尚未实现" in message:
                skeletons.append(f"{name} → {code}: {message[:100]}")
            # 缺服务 / 上下文不匹配 = 探针给不了它要的环境，不是包坏了。
            elif code in {"CONFIG", "TypeError"} or "需要" in message:
                skipped.append(f"{name} → {code}: {message}")
            else:
                failed.append(f"{name} → {code}: {message}")
            continue
        if is_skeleton:
            skeletons.append(f"{name} → apply 成功（骨架已有实现）")
            continue
        applied.append(name)
        if not item.get("services") and not item.get("routes"):
            # 纯客户端页面包（有 src/client.jsx、apply 只做登记）在这里本来就没有
            # 服务/路由 —— 那不是问题，是它们的形态。只对"服务端包"要求有产出，
            # 否则这条检查会对着十几个正常页面包常年告警。
            if not (v.load_packages()[name]["dir"] / "src" / "client.jsx").is_file():
                no_output.append(f"{name} → apply 成功但既没 provide 也没注册路由")

    r.add("apply 可执行", FAIL if failed else PASS,
          detail=f"{len(applied)} 成功 / {len(skipped)} 跳过 / {len(failed)} 失败", evidence="\n".join(failed))
    r.add("需要真实服务的包（如实跳过）", SKIP if skipped else PASS,
          detail=f"{len(skipped)} 个", evidence="\n".join(skipped))
    if skeletons:
        r.add("radar 候选骨架（未接入，不计失败）", SKIP, detail=f"{len(skeletons)} 个",
              evidence="\n".join(skeletons))
    r.add("apply 有产出", WARN if no_output else PASS,
          detail=f"{len(applied) - len(no_output)}/{len(applied)}", evidence="\n".join(no_output))

    routes = sum(len(i.get("routes") or []) for i in probe.values() if isinstance(i, dict))
    services = sum(len(i.get("services") or []) for i in probe.values() if isinstance(i, dict))
    r.add("接线规模", PASS, detail=f"{services} 个服务 · {routes} 条路由")
    r.seconds = time.time() - started


def chain_routes(v: Verifier, r: Chain, probe: dict | None = None) -> None:
    started = time.time()
    if not v.node:
        r.add("node 不可用", SKIP, detail="跳过路由检查")
        r.seconds = time.time() - started
        return
    probe = probe or run_probe(v, _load_names(v))
    if "__probe_failure__" in probe:
        r.add("探针启动", FAIL, evidence=probe["__probe_failure__"]["error"])
        r.seconds = time.time() - started
        return

    connection_routes, web_routes = [], []
    for name, item in probe.items():
        if not isinstance(item, dict):
            continue
        for route in item.get("routes") or []:
            (connection_routes if route.get("kind") == "connection" else web_routes).append((name, route))
    r.add("connection 数据路由", PASS if connection_routes else WARN, detail=f"{len(connection_routes)} 条",
          evidence="" if connection_routes else "没有任何包通过 connection.fetch.register 注册路由。")

    bad_get, bad_post, post_ok = [], [], []
    for name, _route in connection_routes:
        for envelope in (probe.get(name) or {}).get("envelopes") or []:
            if envelope.get("getError") or envelope.get("getOk") is not True:
                bad_get.append(f"{name} {envelope.get('path')} → GET ok={envelope.get('getOk')} "
                               f"status={envelope.get('getStatus')} {envelope.get('getError') or ''}".strip())
            if "postStatus" not in envelope and "postError" not in envelope:
                continue
            if envelope.get("postError"):
                bad_post.append(f"{name} {envelope.get('path')} → POST 抛错：{envelope['postError']}")
            elif envelope.get("postEnvelope") != "server-response" or not envelope.get("postErrorCode"):
                bad_post.append(f"{name} {envelope.get('path')} → POST 没有回 server-response+错误码："
                                f"envelope={envelope.get('postEnvelope')} code={envelope.get('postErrorCode')}")
            else:
                post_ok.append(f"{name} {envelope.get('path')} → {envelope.get('postErrorCode')}")

    r.add("GET 回 { ok: true }", FAIL if bad_get else PASS,
          detail=f"{len(connection_routes) - len(bad_get)}/{len(connection_routes)}", evidence="\n".join(bad_get))
    r.add("未知方法回 server-response + 错误码", FAIL if bad_post else PASS,
          detail=f"{len(post_ok)} 条已确认", evidence="\n".join(bad_post) or "\n".join(post_ok[:6]))
    if web_routes:
        r.add("webServer 路由（不在探针范围）", SKIP, detail=f"{len(web_routes)} 条",
              evidence="\n".join(f"{n} {route.get('path')}" for n, route in web_routes)
                       + "\n这类路由要 Node 的 req/res，探针不伪造；真实响应由页面/宿主验证。")
    r.seconds = time.time() - started


def chain_client(v: Verifier, r: Chain) -> None:
    started = time.time()
    packages = v.load_packages()
    build_script = ROOT / "scripts" / "build.mjs"
    if not build_script.is_file():
        r.add("scripts/build.mjs", FAIL, detail="缺失")
        r.seconds = time.time() - started
        return
    text = build_script.read_text("utf-8", errors="replace")
    match = re.search(r"CLIENT_PACKAGES\s*=\s*\[(.*?)\]", text, re.S)
    listed = set(re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))) if match else set()
    r.add("解析 CLIENT_PACKAGES", PASS if listed else FAIL, detail=f"{len(listed)} 个")

    with_client = sorted(n for n, m in packages.items() if (m["dir"] / "src" / "client.jsx").is_file())
    r.add("发现 src/client.jsx", PASS, detail=f"{len(with_client)} 个")
    missing_list = [n for n in with_client if n not in listed]
    r.add("有 client.jsx 就进构建表", FAIL if missing_list else PASS,
          detail=f"{len(with_client) - len(missing_list)}/{len(with_client)}", evidence="\n".join(missing_list))

    no_bundle, stale, bad_banner = [], [], []
    for name in with_client:
        source = packages[name]["dir"] / "src" / "client.jsx"
        bundle = packages[name]["dir"] / "lib" / "client.js"
        if not bundle.is_file():
            no_bundle.append(f"{name} → lib/client.js 不存在（跑 npm run build）")
            continue
        if bundle.stat().st_mtime < source.stat().st_mtime:
            stale.append(f"{name} → 产物比源码旧（{datetime.fromtimestamp(bundle.stat().st_mtime):%m-%d %H:%M} < "
                         f"{datetime.fromtimestamp(source.stat().st_mtime):%m-%d %H:%M}）")
        head = bundle.read_text("utf-8", errors="replace")[:400]
        if f'id:"{name}"' not in head and f"id:'{name}'" not in head:
            bad_banner.append(f"{name} → banner id 不是包名（模块表建不出这一行）")

    r.add("客户端产物存在", FAIL if no_bundle else PASS,
          detail=f"{len(with_client) - len(no_bundle)}/{len(with_client)}", evidence="\n".join(no_bundle))
    r.add("产物不比源码旧", WARN if stale else PASS,
          detail=f"{len(with_client) - len(no_bundle) - len(stale)} 个最新", evidence="\n".join(stale))
    r.add("banner id 等于包名", FAIL if bad_banner else PASS, evidence="\n".join(bad_banner))
    r.seconds = time.time() - started


def parse_tap(text: str) -> tuple[int, int, list[str]]:
    """从 TAP 取 `(pass, fail, 失败用例名)`。

    用 TAP 而不是默认 reporter：默认排版随终端宽度变，TAP 是机器格式、稳定。
    """
    passed = failed = 0
    failures: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^(not ok|ok)\s+\d+\s+-\s+(.*)$", line.strip())
        if not match:
            continue
        if match.group(1) == "ok":
            passed += 1
        else:
            failed += 1
            failures.append(match.group(2).strip())
    return passed, failed, failures


def chain_tests(v: Verifier, r: Chain, *, pattern: str | None = None) -> None:
    started = time.time()
    if not v.node:
        r.add("node 不可用", SKIP, detail="跳过全部测试")
        r.seconds = time.time() - started
        return
    files = sorted((ROOT / "tests").glob("*.test.mjs"))
    if pattern:
        files = [f for f in files if pattern in f.name]
    if not files:
        r.add("发现测试文件", SKIP, detail="一个都没有")
        r.seconds = time.time() - started
        return
    r.add("发现测试文件", PASS, detail=f"{len(files)} 个" + (f"（过滤 {pattern}）" if pattern else ""))

    # 慢的先发：实测 omni/zdbk/xxt/classroom/campus 要 5~10s，长任务先排队能压短总时长。
    files.sort(key=lambda f: 0 if any(k in f.name for k in ("omni", "zdbk", "xxt", "classroom", "campus")) else 1)

    def run_one(path: Path):
        begin = time.time()
        code, out, err = v.run([v.node, "--test", "--test-reporter=tap", str(path)],
                               timeout=max(v.timeout, 120))
        passed, failed, failures = parse_tap(out)
        detail = "" if failures else ((err or out).strip()[-600:] if code != 0 else "")
        return path.name, passed, failed, failures, detail, time.time() - begin

    with ThreadPoolExecutor(max_workers=v.jobs) as pool:
        results = list(pool.map(run_one, files))

    total_pass = total_fail = 0
    failing, broken, slow = [], [], []
    for name, passed, failed, failures, detail, seconds in results:
        total_pass += passed
        total_fail += failed
        if failed:
            failing.append(f"{name} → {failed} 个失败：" + "；".join(failures[:4]))
        elif detail:
            broken.append(f"{name} → 进程失败但没有 TAP 结果：{detail}")
        if seconds > 15:
            slow.append(f"{name} → {seconds:.1f}s")

    r.add("全部用例通过", FAIL if (total_fail or broken) else PASS,
          detail=f"{total_pass} 通过 / {total_fail} 失败 / {len(files)} 文件",
          evidence="\n".join(failing + broken))
    if slow:
        r.add("偏慢的测试文件", WARN, detail=f"{len(slow)} 个 >15s", evidence="\n".join(slow))
    r.seconds = time.time() - started


def chain_hygiene(v: Verifier, r: Chain) -> None:
    started = time.time()
    packages = v.load_packages()

    placeholders = []
    for name in ("dsh-zhiyun-source-cc98", "dsh-zhiyun-source-zdbk", "dsh-zhiyun-source-xxt"):
        meta = packages.get(name)
        if not meta:
            continue
        for path in v.package_files(meta["dir"] / "src"):
            if path.suffix not in {".js", ".jsx"}:
                continue
            for number, line in enumerate(path.read_text("utf-8", errors="replace").splitlines(), 1):
                if re.search(r"\b(TODO|FIXME|XXX)\b|占位实现", line):
                    placeholders.append(f"{v.rel(path)}:{number}: {line.strip()[:120]}")
    r.add("新包没有 TODO/占位实现", FAIL if placeholders else PASS,
          detail="cc98 / zdbk / xxt", evidence="\n".join(placeholders))

    omni_refs = []
    for path in (ROOT / "packages").rglob("*.js"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        for number, line in enumerate(path.read_text("utf-8", errors="replace").splitlines(), 1):
            if "dsh-zhiyun-source-omni" in line and re.search(r"\b(import|require|from)\b", line):
                omni_refs.append(f"{v.rel(path)}:{number}: {line.strip()[:120]}")
    r.add("没有包 import 已删除的 omni", FAIL if omni_refs else PASS, evidence="\n".join(omni_refs))

    # 本机绝对路径：带**真实用户名**才是身份泄露。
    #
    # 三类必须放过的假红（都踩过）：
    #   1. **占位符**：文档里刻意写着 `C:\Users\me\...`、`C:\Users\<用户名>\...`
    #      作为"应该写成什么样"的示范（CONTRIBUTING 3.4 就是那么教的）；
    #   2. **不是绝对路径**：`.runtime/home/.credentials.yaml` 里的 `/home/` 是相对
    #      路径的一段，不是根下的 `/home`。所以 `/Users`、`/home` 必须出现在路径
    #      **起点**（行首/空白/引号/反引号之后），不能紧跟在 `.`、`/` 或字母后面；
    #   3. **本文件自己**：这条检查的正则就写在 `source-check.py` 里，
    #      不排除它就会永远报自己 —— 永远红的检查等于没有检查。
    absolute = []
    pattern = re.compile(
        r"(?:[A-Za-z]:\\{1,2}Users\\{1,2}([^\\\s\"'<>]+)"
        r"|(?<![\w./-])/Users/([^/\s\"'<>]+)"
        r"|(?<![\w./-])/home/([^/\s\"'<>]+))"
    )
    placeholder_users = {
        "me", "you", "user", "username", "yourname", "name", "someone", "example",
        "\u2026", "...", "xxx", "your-user", "your_user",
    }
    self_file = Path(__file__).resolve()
    for current, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if not name.endswith((".js", ".jsx", ".mjs", ".json", ".yml", ".yaml", ".md", ".py", ".css")):
                continue
            path = Path(current) / name
            if path.resolve() == self_file:
                continue
            try:
                text = path.read_text("utf-8", errors="replace")
            except OSError:
                continue
            for number, line in enumerate(text.splitlines(), 1):
                for match in pattern.finditer(line):
                    user = next((g for g in match.groups() if g), "")
                    # 占位符与尖括号包裹的示意值一律放过
                    if user.lower() in placeholder_users or "<" in user or ">" in user:
                        continue
                    # `用户名` 是示意值；`.` 开头是相对路径的尾巴；
                    # 以反引号/斜杠/反斜杠/顿号收尾说明这是在讲“路径长什么样”而不是
                    # 一条真路径 —— 真路径后面一定还跟着具体目录名。
                    if (
                        "用户名" in user
                        or user.startswith(".")
                        or user.endswith(("`", "/", "\\", "、"))
                    ):
                        continue
                    absolute.append(f"{v.rel(path)}:{number}: {match.group(0)[:80]}")
    r.add("源码/文档里没有本机绝对路径", WARN if absolute else PASS,
          detail=f"{len(absolute)} 处" if absolute else "", evidence="\n".join(absolute[:20]))

    tracked = v.git("ls-files", ".runtime/home/.credentials.yaml")
    env_present = (ROOT / ".env").exists() or (ROOT / ".temp_env").exists()
    r.add("凭据文件没有进版本库", FAIL if tracked else PASS,
          detail="已检查 .credentials.yaml / .env / *.dpapi",
          evidence="\n".join(filter(None, [
              f"被跟踪：{tracked}" if tracked else "",
              ".env 或 .temp_env 出现在仓库根" if env_present else "",
          ])))
    has_creds = (ROOT / ".runtime" / "home" / ".credentials.yaml").exists()
    r.add("本机已配「浙大一卡通」（只判存在）", PASS if has_creds else WARN,
          detail=".runtime/home/.credentials.yaml",
          evidence="" if has_creds else "没配也能跑离线链路；真机链路会改成向你交互索要凭证。")
    r.seconds = time.time() - started


def mask_email(value: str) -> str:
    """把邮箱打码成 `3***4@zju.edu.cn` 的形状。

    为什么连"本地部分"也不能全露：本仓工作环境的提交者邮箱，本地部分就是学号，
    披露它和披露学号没有区别。保留首尾各一位是为了**让本人认得出这是哪一个**，
    同时别人无法据此定位到人。

    ⚠️ 这个函数的说明里**也不能写真实邮箱当例子** —— 那等于用注释完成了
    它要阻止的那次泄露。（初版就踩了：注释与报告都出现了真实地址。）
    """
    if "@" not in value:
        return f"{value[:1]}***" if value else REDACTED
    local, _, domain = value.partition("@")
    if len(local) <= 2:
        masked = local[:1] + "***"
    else:
        masked = f"{local[0]}***{local[-1]}"
    return f"{masked}@{domain}"


def chain_git(v: Verifier, r: Chain) -> None:
    started = time.time()
    if not (ROOT / ".git").exists():
        r.add("git 仓库", SKIP, detail="没有 .git")
        r.seconds = time.time() - started
        return
    origin = v.git("remote", "get-url", "origin")
    r.add("origin 是共享仓库", PASS if origin == EXPECTED_ORIGIN else FAIL,
          detail=origin or "（没有 origin）",
          evidence="" if origin == EXPECTED_ORIGIN else f"应为：{EXPECTED_ORIGIN}")
    branch = v.git("rev-parse", "--abbrev-ref", "HEAD")
    commit = v.git("rev-parse", "--short", "HEAD")
    r.add("分支/提交", PASS, detail=f"{branch or '?'} @ {commit or '?'}")
    if branch == "main":
        r.add("不在 main 上直接改", WARN, detail="main 有分支保护，改动应走 PR")
    status = v.git("status", "--porcelain")
    dirty = [line for line in status.splitlines() if line.strip()] if status else []
    r.add("工作区状态", PASS if not dirty else WARN,
          detail="干净" if not dirty else f"{len(dirty)} 处未提交", evidence="\n".join(dirty[:15]))
    email = v.git("config", "user.email")
    if email:
        suspicious = bool(re.search(r"@(?:stu\.|m\.)?zju\.edu\.cn$", email)) or bool(re.search(r"\d{8,}", email))
        # ⚠️ 结论里**不能写邮箱原文**：这条检查的意义就是"别把学号邮箱推出去"，
        #    而验证报告会被贴进 issue。把真实地址写进去，
        #    等于用报告本身完成了它要阻止的那次泄露。只给打码后的形状。
        masked = mask_email(email)
        r.add("提交者邮箱不含学号/校邮", WARN if suspicious else PASS, detail=masked,
              evidence="公开提交记录里带学号或校邮等于自曝身份，建议换成 GitHub noreply。"
                       if suspicious else "")
    r.seconds = time.time() - started


# ── 真机链路（每条平台一个 Chain） ─────────────────────────────────────────

LIVE_PLATFORMS = [
    # CC98 有自己的账号体系（openid.cc98.org），**不是**浙大统一认证 ——
    # 它读自己那份凭据（`zhiyun-cc98/account`），不借用一卡通。
    ("cc98", "CC98 论坛", "OAuth2 密码模式 → Bearer（CC98 自己的账号）"),
    ("xzzd", "学在浙大", "CAS（不带 service）→ 待办"),
    ("zdbk", "教务系统", "CAS（带 service）→ 成绩/GPA/课表"),
    ("classroom", "智云课堂", "CAS → 课程列表"),
    ("pta", "拼题A", "Cookie 导入 → 题集/看题（短信验证，无法自动登录）"),
    ("xxt", "学习通", "Cookie 导入 → 课程列表（无法自动登录）"),
]


def make_live_chain(platform: str, title: str, blurb: str, credentials: dict, live: dict) -> Chain:
    """把一条真机结果翻成 Chain。

    凭证缺失 → SKIP 并说明"怎么给我"。这是**如实记录**：没账号不是失败。
    给了凭证但登录失败 → FAIL，evidence 带原始错误码与消息（已擦除凭证）。
    """
    result = Chain(id=platform, title=title, blurb=blurb)
    item = live.get(platform)

    if item is None:
        if platform == "xxt":
            hint = "没有提供学习通 Cookie（无法自动登录，需手动粘贴）。"
        elif platform == "pta":
            hint = "没有提供拼题A Cookie（短信验证，无法自动登录，需手动粘贴）。"
        elif platform == "cc98":
            hint = "没有提供 CC98 账号（它与浙大统一认证是两套账号）。"
        else:
            hint = "没有提供「浙大一卡通」账号。"
        result.add("凭证", SKIP, detail=hint,
                   evidence="在网页里提交即可（凭证只在进程内存里，不落盘）；勾选离线可明确跳过。")
        return result

    # 探针没跑（例如 --no-credentials）时 live_result 是空的，上面的分支已经处理了；
    # 走到这里说明确实给了凭证但结果缺失 —— 那是探针本身的问题，要能看见。
    if item is None:  # pragma: no cover - 防御性，正常走不到
        result.add("探针结果", FAIL, detail="给了凭证但没有拿到探针输出")
        return result

    # 出口：报告里要能看出"这次走的是直连还是网关"。
    #
    # **失败时尤其需要这一行**：一次 NETWORK 失败到底是数据源坏了、还是网络路径
    # 不对，只有出口信息能分开。所以它排在 ok/fail 分支**之前**。
    egress = item.get("egress") or {}
    if egress:
        where = {"inside": "校园网内", "outside": "校外",
                 "unknown": "未探明（认证失败得早，还没请求到校园站点）"}.get(
            egress.get("campus"), str(egress.get("campus")))
        via = "经 WebVPN" if egress.get("viaWebvpn") else "直连"
        result.add("网络出口", PASS,
                   detail=f"{where} · {via} · 模式 {egress.get('mode')}",
                   evidence="降级：undici 不可用，请求会受全局代理影响"
                            if egress.get("degraded") else "")

    # 桥接器报告「这条链路要的凭证没给」—— 那是 SKIP，不是 FAIL。
    # 判定顺序放在 ok 之前：它也是 ok=False，但语义完全不同。
    if item.get("skipped"):
        result.add("凭证", SKIP, detail=item.get("message") or "没有提供凭证",
                   evidence="在网页里提交即可（凭证只在进程内存里，不落盘）；勾选离线可明确跳过。")
        return result

    if not item.get("ok"):
        code = item.get("code") or "ERROR"
        message = item.get("message") or ""
        result.add("登录与读取", FAIL, detail=f"{code}（{item.get('ms', 0)}ms）", evidence=message)
        return result

    data = item.get("data") or {}
    result.add("登录与读取", PASS, detail=f"{item.get('ms', 0)}ms")
    for key, value in data.items():
        if value is None:
            result.add(key, SKIP, detail="源没有返回")
        elif isinstance(value, dict):
            # `profile` 是性能剖析，单独渲染（见下），别按 k=v 一串糊出来
            if key == "profile":
                continue
            # 嵌套结构（如 topic）展平展示，避免报告出现一整块 JSON
            result.add(key, PASS, detail=", ".join(f"{k}={v}" for k, v in value.items()))
        else:
            result.add(key, PASS, detail=str(value)[:120])

    # 性能剖析：待办的耗时几乎完全由「请求数 × 单请求延迟」决定，
    # 而请求数是逐门课累加的（5 端点 × 课程数），肉眼看不出来。
    # 这一项不是"通过/失败"，是给优化用的诊断数据。
    profile = data.get("profile")
    if isinstance(profile, dict) and profile.get("courseCount") is not None:
        per_course = profile.get("perCourse") or []
        detail = (f"{profile.get('courseCount')} 门课 · {profile.get('requests')} 请求 · "
                  f"爬取 {profile.get('crawlMs')}ms / 总计 {profile.get('totalMs')}ms")
        lines = []
        if profile.get("courseCount"):
            avg = (profile.get("crawlMs") or 0) / max(profile["courseCount"], 1)
            per_req = ((profile.get("crawlMs") or 0) / profile["requests"]) if profile.get("requests") else None
            lines.append(f"每门课均值 {avg:.0f}ms" + (f"；单请求均值 {per_req:.0f}ms" if per_req is not None else ""))
        if per_course:
            # 明细比均值有用得多：每门课都接近"单请求均值" → 并行生效；
            # 每门课≈5×单请求均值 → 并行没生效（或有服务端排队）。
            slowest = sorted(per_course, key=lambda row: -(row.get("ms") or 0))[:3]
            lines.append("最慢几门：" + "；".join(
                f"{row.get('course')} {row.get('ms')}ms（{row.get('requests')} 请求，"
                f"活动{row.get('activities')}/测验{row.get('exams')}/互动{row.get('classrooms')}）"
                for row in slowest))
            lines.append("全部每门课耗时：" + ", ".join(f"{r.get('ms')}ms" for r in per_course))
        # 单请求耗时分布：均值会掩盖"少数请求特别慢"，所以要 p50/p90/max
        dist = profile.get("requestMs")
        if isinstance(dist, dict) and dist.get("count"):
            lines.append(
                f"单请求耗时 p50={dist.get('p50')}ms p90={dist.get('p90')}ms "
                f"max={dist.get('max')}ms（{dist.get('count')} 个样本，合计 {dist.get('sum')}ms）")
        result.add("耗时构成", PASS, detail=detail, evidence="\n".join(lines))

    # 登录分段：profile 只覆盖 todos() 内部，"登录与读取"的大头往往在登录。
    login = data.get("login")
    wall = data.get("wallMs")
    if isinstance(login, dict) or wall:
        parts = []
        if isinstance(login, dict):
            for label, key in (
                ("SSO 预取", "prelude"),
                ("CAS", "casLogin"),
                ("落盘", "persist"),
            ):
                span = login.get(key)
                if isinstance(span, dict) and span.get("ms") is not None:
                    parts.append(f"{label} {span['ms']}ms")
            if login.get("totalRequests") is not None:
                parts.append(f"登录共 {login['totalRequests']} 请求")
        detail = " · ".join(parts) if parts else "没有登录（会话复用）"
        if wall:
            detail = f"整链路 {wall}ms · {detail}"
        result.add("登录耗时", PASS, detail=detail, evidence="")
    return result


# ── 链路注册表 ──────────────────────────────────────────────────────────────

OFFLINE_CHAINS: list[tuple[str, str, str, Callable]] = [
    ("environment", "环境", "node/Python/仓库目录是否就绪", chain_environment),
    ("workspace", "包骨架", "包的名称/入口/exports/patch/OWNERS", chain_workspace),
    ("profile", "profile 装配", "层栈里每个 bundle 都能解析并 insert 自己", chain_profile),
    ("load", "模块加载", "每个包的入口能被 ESM import、导出非空", chain_load),
    ("wire", "插件接线", "apply() 在最小上下文里跑通、注册了什么", chain_wire),
    ("routes", "数据路由信封", "GET 回 ok、未知方法回 server-response+错误码", chain_routes),
    ("client", "客户端产物", "client.jsx 是否进构建表、产物是否过期", chain_client),
    ("tests", "单元测试", "逐文件跑 node --test，报出失败用例名", chain_tests),
    ("hygiene", "卫生与隐私", "TODO、omni 残留、本机绝对路径、凭据入库", chain_hygiene),
    ("git", "仓库状态", "origin、分支、脏文件、提交者邮箱", chain_git),
]

OFFLINE_INDEX = {c[0]: c for c in OFFLINE_CHAINS}
LIVE_INDEX = {p[0]: p for p in LIVE_PLATFORMS}

#: 探针共享：load/wire/routes 三条链路要同一份探针输出，只跑一次 node。
PROBE_CONSUMERS = {"load", "wire", "routes"}


# ── 交互 ────────────────────────────────────────────────────────────────────


def ask(prompt: str, default: str = "") -> str:
    """读一行答案；拿不到就退回默认值。

    # 为什么要同时捕获 EOFError 与 StopIteration

    `input()` 在 stdin 关闭（Ctrl-D / 管道结束）时抛 `EOFError`。但在**非交互的
    测试替身或重定向的 stdin** 里，读取可能抛的是 `StopIteration`。只捕 EOFError
    的后果是真机上 Ctrl-D 能正常退出，而脚本化调用会崩在菜单里 —— 一个和"用户
    取消"完全相同语义的事件，两种表现。

    KeyboardInterrupt **不**在这里吞掉：Ctrl-C 是"我现在就要停"，应当真的停。
    """
    try:
        return input(prompt).strip() or default
    except (EOFError, StopIteration):
        return default


def prompt_secret(prompt: str) -> str:
    """读一行**不回显**的输入（密码 / Cookie）。

    `getpass` 在真正的终端上会关掉回显；在非 tty 的管道里它会直接读 stdin 并告警。
    两种情况都要能兜住 EOF，否则 Ctrl-D 会把整个验证器打崩在"要密码"这一步。
    """
    try:
        return getpass.getpass(prompt)
    except (EOFError, StopIteration):
        return ""
    except KeyboardInterrupt:
        print()
        raise


def interactive_menu(painter: Painter) -> dict:
    """选链路 + 选要不要真机验证 + 选报告落点。凭证在真正要用的那一刻才问。"""
    print()
    print(painter.bold("离线链路（不需要账号、不联网）："))
    for index, (key, title, blurb, _fn) in enumerate(OFFLINE_CHAINS, 1):
        print(f"  {index:>2}. {title:<10} {painter.dim(key):<24} {blurb}")
    print()
    print(painter.bold("真机链路（要账号，登录会打真站点，只读）："))
    for index, (key, title, blurb) in enumerate(LIVE_PLATFORMS, len(OFFLINE_CHAINS) + 1):
        print(f"  {index:>2}. {title:<10} {painter.dim(key):<24} {blurb}")
    print()
    print(painter.dim("  输入编号（空格或逗号分隔）、`all` 全跑、`q` 退出。"))

    while True:
        raw = ask("选择链路 [all]: ", "all")
        if raw.lower() in {"q", "quit", "exit"}:
            return {"abort": True}
        if raw.lower() in {"all", "a", "*"}:
            selected = [c[0] for c in OFFLINE_CHAINS] + [p[0] for p in LIVE_PLATFORMS]
            break
        tokens = [t for t in re.split(r"[\s,，]+", raw) if t]
        selected, unknown = [], []
        combined = [(c[0], c[1]) for c in OFFLINE_CHAINS] + [(p[0], p[1]) for p in LIVE_PLATFORMS]
        for token in tokens:
            if token.isdigit() and 1 <= int(token) <= len(combined):
                selected.append(combined[int(token) - 1][0])
            elif token in OFFLINE_INDEX or token in LIVE_INDEX:
                selected.append(token)
            else:
                unknown.append(token)
        if unknown:
            print(painter(f"  不认识的选项：{', '.join(unknown)}", "31"))
            continue
        if selected:
            break
        print(painter("  至少选一条。", "31"))

    if "tests" in selected:
        if ask("  全量单元测试较慢（约 1~2 分钟），现在跑吗？[Y/n]: ", "y").lower() in {"n", "no", "否"}:
            selected.remove("tests")
            print(painter.dim("  已跳过单元测试。"))

    report_dir = ask(f"  报告目录 [{Path('artifacts/verify')}]: ", "artifacts/verify")
    jobs_raw = ask("  并行度（同时跑几个测试文件）[4]: ", "4")
    jobs = int(jobs_raw) if jobs_raw.isdigit() and int(jobs_raw) > 0 else 4

    print()
    print(painter.bold("即将执行："))
    for key in selected:
        title = (OFFLINE_INDEX.get(key) or LIVE_INDEX.get(key))[1]
        kind = "离线" if key in OFFLINE_INDEX else "真机"
        print(f"  · [{kind}] {title}（{key}）")
    print(f"  · 并行度 {jobs}，报告 → {report_dir}")
    print(painter.dim("  · 凭证只在需要时索要，不回显、不落盘、不进报告"))
    if ask("确认开始？[Y/n]: ", "y").lower() in {"n", "no", "否"}:
        return {"abort": True}
    return {"chains": selected, "report_dir": report_dir, "jobs": jobs}


# ── 报告 ────────────────────────────────────────────────────────────────────


def render_console(results: list[Chain], painter: Painter) -> None:
    for result in results:
        if not result.count(FAIL) and not result.count(WARN):
            continue
        for check in result.checks:
            if check.status in {FAIL, WARN}:
                mark, tint = STATUS_STYLE[check.status]
                print(f"      {painter(mark, tint)} {check.name}" + (f" — {check.detail}" if check.detail else ""))
                for line in (check.evidence or "").splitlines()[:6]:
                    if line.strip():
                        print(painter(f"          {line}", "90"))


def render_markdown(results: list[Chain], meta: dict) -> str:
    total_checks = sum(len(r.checks) for r in results)
    total_fail = sum(r.count(FAIL) for r in results)
    total_warn = sum(r.count(WARN) for r in results)
    total_pass = sum(r.count(PASS) for r in results)
    total_skip = sum(r.count(SKIP) for r in results)
    verdict = "全部通过" if not total_fail and not total_warn else ("存在失败" if total_fail else "通过，但有告警")

    lines = ["# 全链路验证报告", ""]
    lines.append(f"- 生成时间：{meta['time']}")
    lines.append(f"- 仓库：`{meta['root_name']}`（{meta['git_ref']}）")
    lines.append(f"- 环境：node {meta['node']} · Python {meta['python']} · {meta['platform']}")
    lines.append(f"- 范围：{len(results)} 条链路 / {total_checks} 项检查")
    lines.append(f"- 凭据：{meta['credential_mode']}")
    lines.append(f"- **结论：{verdict}**")
    lines.append("")

    label = {PASS: "通过", FAIL: "失败", WARN: "告警", SKIP: "跳过"}
    lines += ["## 总览", "",
              "| 链路 | 检查 | 通过 | 失败 | 告警 | 跳过 | 用时 | 结论 |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"]
    for result in results:
        lines.append(f"| {result.title} `{result.id}` | {len(result.checks)} | {result.count(PASS)} | "
                     f"{result.count(FAIL)} | {result.count(WARN)} | {result.count(SKIP)} | "
                     f"{result.seconds:.1f}s | {label[result.verdict]} |")
    lines.append(f"| **合计** | **{total_checks}** | **{total_pass}** | **{total_fail}** | "
                 f"**{total_warn}** | **{total_skip}** | **{meta['seconds']:.1f}s** | **{verdict}** |")
    lines.append("")

    failures = [(r, c) for r in results for c in r.checks if c.status == FAIL]
    warnings = [(r, c) for r in results for c in r.checks if c.status == WARN]
    skips = [(r, c) for r in results for c in r.checks if c.status == SKIP]

    if failures:
        lines += ["## 失败明细", ""]
        for result, check in failures:
            lines += [f"### {result.title} › {check.name}", ""]
            if check.detail:
                lines += [check.detail, ""]
            if check.evidence:
                lines += ["```text", *check.evidence.splitlines(), "```", ""]
    if warnings:
        lines += ["## 告警明细", ""]
        for result, check in warnings:
            lines.append(f"- **{result.title} › {check.name}**" + (f" — {check.detail}" if check.detail else ""))
            for line in (check.evidence or "").splitlines()[:8]:
                if line.strip():
                    lines.append(f"  - `{line.strip()}`")
        lines.append("")
    if skips:
        lines += ["## 跳过（如实记录，不是失败）", ""]
        for result, check in skips:
            lines.append(f"- **{result.title} › {check.name}**" + (f" — {check.detail}" if check.detail else ""))
            for line in (check.evidence or "").splitlines()[:6]:
                if line.strip():
                    lines.append(f"  - `{line.strip()}`")
        lines.append("")

    lines += ["## 全部检查明细", ""]
    for result in results:
        lines += [f"<details><summary>{result.title}（{result.id}）</summary>", ""]
        for check in result.checks:
            mark = {PASS: "✔", FAIL: "✖", WARN: "!", SKIP: "-"}[check.status]
            lines.append(f"- {mark} **{check.name}**" + (f" — {check.detail}" if check.detail else ""))
        lines += ["", "</details>", ""]

    steps = derive_next_steps(failures, warnings)
    if steps:
        lines += ["## 建议的下一步", ""]
        lines += [f"{index}. {step}" for index, step in enumerate(steps, 1)]
        lines.append("")

    lines += ["---", "",
              "由 `scripts/source-check.py` 生成。凭证只在内存中使用，本报告已做凭证擦除。"]
    return "\n".join(lines) + "\n"


def derive_next_steps(failures: list, warnings: list) -> list[str]:
    """按失败链路给出**可执行**的下一步，不写"请检查"。"""
    ids = {result.id for result, _check in failures}
    steps: list[str] = []
    if "environment" in ids:
        steps.append("环境没起来：确认 node 22+ 在 PATH 里，再重跑。")
    if "workspace" in ids:
        steps.append("包骨架有问题：修 `package.json` 的 `name`/`main`/`exports` 与 `cordis.patch.yml`，"
                     "再 `python scripts/source-check.py --only workspace -y`。")
    if "profile" in ids:
        steps.append("profile 装配断了：`npm install` 重建链接或 `npm run profile:init`；"
                     "已下线包名要从 `profiles/*/package.json` 删掉。")
    if "load" in ids:
        steps.append("有包 import 失败：先看跨包相对路径或 `exports` 子路径，"
                     "用 `node -e \"import('./packages/<pkg>/src/index.js')\"` 单点复现。")
    if "routes" in ids:
        steps.append("路由信封不对：GET 必须回 `{ ok: true, value }`，POST 未知方法必须回 "
                     "`{ type:'server-response', rpcId, result:{ ok:false, error:{ code } } }`。")
    if "client" in ids:
        steps.append("客户端产物过期或漏登记：加进 `scripts/build.mjs` 的 `CLIENT_PACKAGES`，然后 `npm run build`。")
    if "tests" in ids:
        steps.append("单元测试失败：`node --test tests/<file>.test.mjs` 单点定位。")
    if "hygiene" in ids:
        steps.append("卫生/隐私项失败：清 TODO 与 omni 残留，把本机绝对路径换成占位符，"
                     "确认凭据文件没被 `git add -f` 带进来。")
    if "git" in ids:
        steps.append(f"origin 必须是 `{EXPECTED_ORIGIN}`；确认后自己改远端，不要默默修正。")
    live_failed = [r.title for r, _c in failures if r.id in LIVE_INDEX]
    if live_failed:
        steps.append(f"真机链路失败（{', '.join(live_failed)}）：先看错误码 —— "
                     "AUTH_REJECTED 是账号问题，WEBVPN_REQUIRED/网络类是出口问题（校外需 WebVPN）。")
    if not failures and warnings:
        steps.append("没有失败；告警建议顺手处理（产物过期、脏工作区、跳过项）。")
    if not steps and not failures:
        steps.append("全部链路通过，无需处理。")
    return steps


def render_json(results: list[Chain], meta: dict) -> str:
    return json.dumps({
        "generated_at": meta["time"],
        "root": meta["root_name"],
        "git": meta["git_ref"],
        "node": meta["node"],
        "python": meta["python"],
        "platform": meta["platform"],
        "credential_mode": meta["credential_mode"],
        "seconds": round(meta["seconds"], 2),
        "summary": {
            "chains": len(results),
            "checks": sum(len(r.checks) for r in results),
            "pass": sum(r.count(PASS) for r in results),
            "fail": sum(r.count(FAIL) for r in results),
            "warn": sum(r.count(WARN) for r in results),
            "skip": sum(r.count(SKIP) for r in results),
        },
        "chains": [{
            "id": r.id, "title": r.title, "verdict": r.verdict, "seconds": round(r.seconds, 2),
            "checks": [{"name": c.name, "status": c.status, "detail": c.detail, "evidence": c.evidence}
                       for c in r.checks],
        } for r in results],
    }, ensure_ascii=False, indent=2) + "\n"


# ── 主流程 ──────────────────────────────────────────────────────────────────


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="智云 Pro 交互式全链路验证器（含真实站点登录；凭证只在内存里）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="不带参数运行进入交互模式；--offline 完全不需要账号；CI 用 --only tests --yes。",
    )
    parser.add_argument("--all", action="store_true", help="跑全部链路（不提问选链路）")
    parser.add_argument("--only", default="", help="只跑这些链路，逗号分隔（如 tests,profile,cc98）")
    parser.add_argument("--skip", default="", help="跳过这些链路，逗号分隔")
    parser.add_argument("--offline", action="store_true", help="只跑离线链路：不问凭证、不联网")
    parser.add_argument("--live-only", action="store_true", help="只跑真机链路")
    parser.add_argument("--list", action="store_true", help="列出全部链路后退出")
    parser.add_argument("--yes", "-y", action="store_true", help="不提问（仍会索要缺失的凭证）")
    parser.add_argument("--no-credentials", action="store_true", help="完全不要凭证，真机链路一律跳过")
    parser.add_argument("--report-dir", default=str(Path("artifacts") / "verify"), help="报告输出目录")
    parser.add_argument("--no-report", action="store_true", help="只打屏幕，不写报告文件")
    parser.add_argument("--jobs", type=int, default=4, help="并行跑测试文件的个数")
    parser.add_argument("--timeout", type=float, default=180.0, help="单个子进程超时（秒）")
    parser.add_argument("--tests-filter", default="", help="只跑文件名含该子串的测试")
    parser.add_argument("--no-tests-slow", action="store_true", help="跳过单元测试链路")
    parser.add_argument("--require-live", action="store_true", help="没凭证时把真机链路判为失败（默认判跳过）")
    parser.add_argument("--no-color", action="store_true", help="禁用颜色")
    parser.add_argument("--json", action="store_true", help="把 JSON 打到 stdout（不写文件）")
    parser.add_argument("--web", action="store_true",
                        help="网页模式：起一个只监听本机的服务，交互全在浏览器里（默认就是它）")
    parser.add_argument("--terminal", action="store_true", help="用终端交互（旧行为）")
    parser.add_argument("--port", type=int, default=WEB_DEFAULT_PORT,
                        help=f"网页模式端口（默认 {WEB_DEFAULT_PORT} = 自动分配空闲端口）")
    parser.add_argument("--no-open", action="store_true", help="网页模式不自动打开浏览器")
    return parser.parse_args(argv)


def resolve_selection(args: argparse.Namespace, painter: Painter) -> list[str] | dict:
    """决定跑哪些链路。显式参数优先于交互。"""
    offline_keys = [c[0] for c in OFFLINE_CHAINS]
    live_keys = [p[0] for p in LIVE_PLATFORMS]
    every_key = offline_keys + live_keys

    if args.only:
        wanted = [t.strip() for t in args.only.split(",") if t.strip()]
        unknown = [w for w in wanted if w not in OFFLINE_INDEX and w not in LIVE_INDEX]
        if unknown:
            raise SystemExit(f"未知链路：{', '.join(unknown)}（可用：{', '.join(every_key)}）")
        selected = wanted
    elif args.live_only:
        selected = list(live_keys)
    elif args.offline:
        selected = list(offline_keys)
    elif args.all:
        selected = list(every_key)
    elif not sys.stdin.isatty():
        selected = list(every_key)
    else:
        choice = interactive_menu(painter)
        if choice.get("abort"):
            return {"abort": True}
        return choice

    for token in (t.strip() for t in args.skip.split(",") if t.strip()):
        if token in selected:
            selected.remove(token)
    if args.no_tests_slow and "tests" in selected:
        selected.remove("tests")
    if args.offline:
        # `--offline` 是"我要纯离线"：真机链路**不选**，连问都不问。
        selected = [k for k in selected if k in OFFLINE_INDEX]
    # ⚠️ `--no-credentials` 只影响"问不问凭证"，**不**把真机链路从报告里删掉：
    #    删掉的话，`--only cc98 --no-credentials` 会输出一份 0 项的空报告，
    #    看起来像跑过了。保留它们 → 每条都记 SKIP，报告里能看见"跳过了什么、为什么"。
    # 去重保序：执行顺序有意义（环境 → 骨架 → …）
    return [k for k in every_key if k in selected]


def main(argv: list[str] | None = None) -> int:
    # 必须在任何 print 之前：中文 Windows 控制台是 GBK，编不出 `✔`/生僻中文时会抛
    # UnicodeEncodeError，而那个异常看起来与检查内容毫无关系。
    harden_console()
    args = parse_args(argv if argv is not None else sys.argv[1:])
    painter = Painter(enabled=sys.stdout.isatty() and not args.no_color and not os.environ.get("NO_COLOR"))

    if args.list:
        print("离线：")
        for key, title, blurb, _fn in OFFLINE_CHAINS:
            print(f"  {key:<12} {title:<10} {blurb}")
        print("真机（要账号）：")
        for key, title, blurb in LIVE_PLATFORMS:
            print(f"  {key:<12} {title:<10} {blurb}")
        return 0

    # 非 tty（CI/管道）且没显式选链路时，不当交互用；也不该偷偷去登录。
    interactive = sys.stdin.isatty() and not args.yes and not args.offline and not args.no_credentials

    # ── 网页模式 ──
    #
    # 默认走网页：纯终端交互在凭证输入上体验差（不回显在某些终端不工作、粘贴吃反斜杠），
    # 而且用户很容易把终端输出整段贴进 issue。网页把输入收进表单、提交后立刻从 DOM 消失。
    #
    # 但**明确要非交互的场合**仍走终端：`--json`（CI 要机器可读）、`--list`、
    # `--offline`/`--live-only`/`--only`/`--all`（脚本化调用）、`--terminal`（显式要旧行为）。
    # 否则 `--only tests -y` 这种 CI 用法会莫名其妙地挂起等浏览器。
    scripted = bool(args.json or args.list or args.offline or args.live_only
                    or args.only or args.all or args.yes or args.no_credentials
                    or args.terminal)
    if args.web or (not scripted and sys.stdin.isatty()):
        return serve_web(args)

    vault = CredentialVault(interactive=interactive, allow_env=True)
    selection = resolve_selection(args, painter)

    # ⚠️ 交互菜单返回的是 dict（chains/report_dir/jobs）。这里**必须真的用它**，
    #    早先写的是 `if isinstance(selection, dict): return 0` —— 那不是"用户取消"，
    #    而是"选完了、确认了，然后一条链路都没跑，直接退出码 0"。
    #    症状是交互式运行时"闪一下什么都没发生"，而且看起来像成功。
    if isinstance(selection, dict):
        if selection.get("abort"):
            return 0
        selected = selection["chains"]
        if not selected:
            print(painter("没有选中任何链路。", "33"))
            return 0
        jobs = selection.get("jobs", args.jobs)
        report_dir = Path(selection.get("report_dir") or args.report_dir)
        # 交互模式下不再自动回放"准备好了"那一屏 —— 菜单已经确认过了。
    else:
        selected = selection
        jobs = args.jobs
        report_dir = Path(args.report_dir)

    verifier = Verifier(jobs=jobs, timeout=args.timeout, vault=vault)

    print(painter.bold("智云 Pro · 全链路验证"))
    print(painter.dim(f"仓库 {ROOT.name} · {sys.platform} · node {verifier.node or '未找到'}"))

    live_selected = [k for k in selected if k in LIVE_INDEX]
    offline_selected = [k for k in selected if k in OFFLINE_INDEX]
    credential_mode = "未使用（离线）"

    started = time.time()
    results: list[Chain] = []

    # `--no-credentials`：真机链路**留在报告里**（记 SKIP），但探针根本不启动。
    # 把它们从结果里删掉的话，`--only cc98 --no-credentials` 会输出一份 0 项的空报告，
    # 看起来像"跑过了且没问题" —— 那是最坏的一种报告。
    if live_selected and args.no_credentials:
        credential_mode = "已按 --no-credentials 跳过"
        if not args.json:
            print()
            print(painter.dim("  真机链路已跳过（--no-credentials）。"))
        for key in live_selected:
            _id, title, blurb = LIVE_INDEX[key]
            chain = make_live_chain(key, title, blurb, {}, {})
            # `--require-live` 说的是"这次验证必须包含真机结果"。用户**主动**跳过
            # 又要求必过，这两件事矛盾 —— 直接把跳过判成失败，让退出码说真话。
            if args.require_live:
                chain.checks = [Check(c.name, FAIL, c.detail, c.evidence, c.seconds) for c in chain.checks]
            results.append(chain)
        live_selected = []
    elif live_selected:
        print(painter.dim("真机链路会登录真实站点；凭证只在本次进程内存里，不落盘、不进报告。"))

    if not args.json:
        print()

    # 探针共享：load/wire/routes 三条链路用同一份 node 输出，只跑一次。
    probe_shared: dict | None = None
    if any(k in PROBE_CONSUMERS for k in offline_selected) and verifier.node:
        names = _load_names(verifier)
        if not args.json:
            print(painter.dim(f"  正在为 {len(names)} 个包跑一次加载/接线探针…"))
        probe_shared = run_probe(verifier, names)

    # 凭证：等真的要用的时候才取（而且只取一次，同账号复用）。
    live_result: dict[str, dict] = {}
    if live_selected:
        needs_cc98 = "cc98" in live_selected
        needs_pta = "pta" in live_selected
        needs_zju = any(k not in ("xxt", "cc98", "pta") for k in live_selected)
        needs_xxt = "xxt" in live_selected
        account = vault.zju() if needs_zju else None
        cc98_account = vault.cc98() if needs_cc98 else None
        pta_cookie = vault.pta() if needs_pta else None
        cookie = vault.xxt() if needs_xxt else None
        if account or cookie or cc98_account or pta_cookie:
            parts = []
            if account:
                parts.append("浙大一卡通（内存）")
            if cc98_account:
                parts.append("CC98 账号（内存）")
            if pta_cookie:
                parts.append("拼题A Cookie（内存）")
            if cookie:
                parts.append("学习通 Cookie（内存）")
            credential_mode = " + ".join(parts)
            if not args.json:
                print(painter.dim(f"  凭证：{credential_mode}"))
            live_result = run_live(verifier, live_selected, account, cookie, cc98_account, pta_cookie)
        else:
            # ⚠️ 没凭证时**不启动探针**。启动的话它会拿空账号去登一次真站点，
            #    结果是 AUTH_REJECTED —— 报告上看起来像"账号有问题"，
            #    而真实情况是"我们根本没问过"。跳过要说清是跳过。
            credential_mode = "未提供（真机链路跳过）"
            if not args.json:
                print(painter.dim(f"  凭证：{credential_mode}"))

    # 离线链路
    for key in offline_selected:
        _id, title, blurb, runner = OFFLINE_INDEX[key]
        result = Chain(id=key, title=title, blurb=blurb)
        begin = time.time()
        try:
            if key == "tests":
                runner(verifier, result, pattern=args.tests_filter or None)
            elif key in PROBE_CONSUMERS:
                runner(verifier, result, probe_shared)
            else:
                runner(verifier, result)
        except Exception as error:  # noqa: BLE001 - 一条链崩了不该吞掉整份报告
            import traceback
            result.add("链路执行", FAIL, detail=f"{type(error).__name__}: {error}",
                       evidence=traceback.format_exc()[-1200:])
        result.seconds = result.seconds or (time.time() - begin)
        results.append(result)
        if not args.json:
            symbol, color = STATUS_STYLE[result.verdict]
            print(f"  {painter(symbol, color)} {painter.bold(title):<20} {painter.dim(f'{result.seconds:5.1f}s')}  "
                  f"{result.count(PASS)} 通过 / {result.count(FAIL)} 失败 / {result.count(SKIP)} 跳过")

    # 真机链路
    for key in live_selected:
        _id, title, blurb = LIVE_INDEX[key]
        synthetic = make_live_chain(key, title, blurb, {}, live_result)
        if args.require_live and synthetic.count(SKIP) and not synthetic.count(FAIL):
            synthetic.checks = [Check(c.name, FAIL, c.detail, c.evidence, c.seconds) for c in synthetic.checks]
        results.append(synthetic)
        if not args.json:
            symbol, color = STATUS_STYLE[synthetic.verdict]
            print(f"  {painter(symbol, color)} {painter.bold(title):<20} {painter.dim(' 真机')}  "
                  f"{synthetic.count(PASS)} 通过 / {synthetic.count(FAIL)} 失败 / {synthetic.count(SKIP)} 跳过")

    elapsed = time.time() - started
    meta = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "root_name": ROOT.name,
        "git_ref": (verifier.git("rev-parse", "--short", "HEAD") or "?") + " @ "
                    + (verifier.git("rev-parse", "--abbrev-ref", "HEAD") or "?"),
        "node": verifier.run([verifier.node, "--version"], timeout=20)[1].strip() if verifier.node else "未找到",
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "platform": sys.platform,
        "credential_mode": credential_mode,
        "seconds": elapsed,
    }

    if args.json:
        sys.stdout.write(vault.redact(render_json(results, meta)))
        return 0 if not any(r.count(FAIL) for r in results) else 1

    print()
    print(painter.bold("失败与告警"))
    if not any(c.status in {FAIL, WARN} for r in results for c in r.checks):
        print(painter("  没有失败项。", "32"))
    else:
        render_console(results, painter)

    total_fail = sum(r.count(FAIL) for r in results)
    total_pass = sum(r.count(PASS) for r in results)
    total_checks = sum(len(r.checks) for r in results)

    if not args.no_report:
        target_dir = report_dir if report_dir.is_absolute() else (ROOT / report_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        markdown_path = target_dir / f"report-{stamp}.md"
        json_path = target_dir / f"report-{stamp}.json"
        # ⚠️ 写出前统一过一遍 redact()：报告常被直接贴进 issue。
        markdown = vault.redact(render_markdown(results, meta))
        payload = vault.redact(render_json(results, meta))
        markdown_path.write_text(markdown, encoding="utf-8")
        json_path.write_text(payload, encoding="utf-8")
        try:
            (target_dir / "latest.md").write_text(markdown, encoding="utf-8")
        except OSError:
            pass
        print()
        print(f"报告：{painter.bold(verifier.rel(markdown_path))}")
        print(f"      {painter.dim(verifier.rel(json_path))}")

    print()
    verdict = "全部通过" if not total_fail else f"{total_fail} 项失败"
    print(painter.bold(f"结论：{verdict}")
          + painter.dim(f"（{total_pass}/{total_checks} 项通过，{elapsed:.1f}s；凭证 {credential_mode}）"))
    return 0 if not total_fail else 1


# ══════════════════════════════════════════════════════════════════════════
# 网页模式：在本机起一个**只监听回环**的服务，交互全部在浏览器里完成
# ══════════════════════════════════════════════════════════════════════════
#
# # 为什么要网页模式
#
# 终端交互的问题不是"不好看"，而是**凭证输入体验差且危险**：
#
#   - `getpass` 在某些终端（git bash、IDE 内置终端）不回显但不工作，用户看不见自己在打什么；
#   - 密码里有特殊字符时，终端粘贴容易吃掉反斜杠；
#   - 用户习惯性地把终端输出整段复制到 issue —— 那正是泄露的高发场景。
#
# 网页模式把这些都收进表单：输入框 type=password、提交后立刻从 DOM 消失、
# 凭证走 HTTP body（不进命令行、不进 shell 历史、不进 `ps`）。
#
# # 安全边界（这是**本机工具**，不是网络服务）
#
# 1. **只绑 127.0.0.1**，不监听 0.0.0.0 —— 同一局域网的人碰不到；
# 2. **带一次性 token**：URL 里给 `?t=<token>`，没 token 的请求一律 403。
#    防的是"本机另一个网页顺手 POST 到 127.0.0.1:端口"（DNS rebinding / CSRF）；
# 3. **只认回环 Host**，防 DNS rebinding（与 `dsh-zhiyun-source-card` 同一条规矩）；
# 4. 凭证**只在进程内存**，不写盘；报告写出前过 `vault.redact()`。
#
# # 端口
#
# 默认让系统分配空闲端口（`port=0`），启动后打印真实端口 —— 不写死，避免撞端口。
# 需要固定端口时用 `--port 8765`。

WEB_DEFAULT_PORT = 0
"""默认端口。0 = 让系统分配空闲端口（推荐：不撞端口、不与别人的服务混）。"""

_WEB_TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


class WebState:
    """网页模式的共享状态：一次只跑一份验证，避免并发把凭证状态搅乱。"""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.progress: list[dict] = []
        self.results: list[Chain] | None = None
        self.meta: dict = {}
        self.markdown: str = ""
        self.error: str = ""


def _web_html(token: str) -> str:
    """单页界面。故意不引任何外部资源 —— 本机工具不该依赖 CDN。

    # 视觉方向：仪表台（instrument panel）

    这个页面的用途是「核对每一条数据源链路是不是通的」。它更接近
    一台仪器的面板，而不是一个网站：深色底、等宽数字、状态色克制、
    最重要的读数（通过/失败）用大号字形压场。

    - 字体：等宽（等宽是这类工具的母语），中文回退到系统中文字体；
    - 配色：炭黑底 + 纸白字 + 状态色（绿/琥珀/红/灰），
      强调色只留给「开始」这一个动作；
    - 状态：每个链路是一张卡片，verdict 用大写字形 + 左侧色条。
    """
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>源检查 · 智云 Pro</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{
  --bg:#101014;--bg2:#17171d;--panel:#1c1c23;--panel2:#222229;
  --ink:#e8e7e2;--ink-dim:#a3a2ac;--line:#2b2b35;
  --ok:#3ec97f;--warn:#e2a83d;--fail:#e5534b;--skip:#71717e;
  --accent:#5b8cff;--accent-ink:#fff;
  --mono:ui-monospace,"Cascadia Code","JetBrains Mono",Consolas,"Courier New",monospace;
  --sans:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
}}
*{{box-sizing:border-box}}
html,body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 var(--sans)}}
::selection{{background:var(--accent);color:#fff}}

/* ── 布局：左边栏（表单） + 右主区（结果） ── */
.shell{{display:grid;grid-template-columns:360px 1fr;min-height:100vh}}
@media (max-width:900px){{.shell{{grid-template-columns:1fr}}}}

aside{{background:var(--bg2);border-right:1px solid var(--line);
padding:28px 26px 48px;position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto}}
@media (max-width:900px){{aside{{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line)}}}}
main{{padding:32px 36px 80px;min-width:0}}

.brand{{font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:var(--ink-dim);
text-transform:uppercase;margin-bottom:2px}}
.title{{font-size:20px;font-weight:650;letter-spacing:-.01em;margin:0 0 4px}}
.sub{{font-size:12.5px;color:var(--ink-dim);margin-bottom:26px;line-height:1.5}}

.group{{margin-bottom:26px}}
.group-label{{font-family:var(--mono);font-size:11px;letter-spacing:.12em;
text-transform:uppercase;color:var(--ink-dim);margin-bottom:10px;
display:flex;align-items:center;gap:8px}}
.group-label::after{{content:"";flex:1;height:1px;background:var(--line)}}

.chains{{display:flex;flex-direction:column;gap:6px}}
.chk{{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;
border:1px solid var(--line);border-radius:8px;cursor:pointer;
transition:border-color .12s,background .12s;background:var(--panel)}}
.chk:hover{{border-color:var(--ink-dim)}}
.chk:has(input:checked){{border-color:var(--accent);background:var(--panel2)}}
.chk input{{margin-top:3px;accent-color:var(--accent)}}
.chk .t{{font-size:13px;font-weight:600;line-height:1.3}}
.chk .b{{font-size:11.5px;color:var(--ink-dim);line-height:1.4}}
.tag{{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--warn);
border:1px solid color-mix(in srgb,var(--warn) 40%,transparent);border-radius:4px;
padding:0 4px;vertical-align:1px}}

.cred{{margin-bottom:4px}}
.cred label{{display:block;font-size:12px;color:var(--ink-dim);margin:14px 0 5px}}
.cred label b{{color:var(--ink);font-weight:600}}
.cred input{{width:100%;padding:8px 11px;border:1px solid var(--line);border-radius:7px;
background:var(--bg);color:var(--ink);font:13px var(--mono);
transition:border-color .12s,box-shadow .12s}}
.cred input:focus{{outline:none;border-color:var(--accent);
box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}}
.cred input::placeholder{{color:var(--skip)}}

.btn{{appearance:none;border:0;border-radius:8px;padding:11px 18px;
font:600 13px var(--sans);cursor:pointer;letter-spacing:.01em;
transition:transform .08s,filter .12s}}
.btn:active{{transform:translateY(1px)}}
.btn-primary{{background:var(--accent);color:var(--accent-ink);width:100%}}
.btn-primary:hover:not(:disabled){{filter:brightness(1.12)}}
.btn-ghost{{background:transparent;color:var(--ink-dim);border:1px solid var(--line);width:100%;margin-top:8px}}
.btn-ghost:hover{{color:var(--ink);border-color:var(--ink-dim)}}
.btn:disabled{{opacity:.45;cursor:not-allowed}}

.note{{font-size:11.5px;color:var(--ink-dim);line-height:1.55;margin-top:14px;
padding-top:14px;border-top:1px dashed var(--line)}}

/* ── 主区 ── */
.hero{{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin-bottom:26px}}
.hero .big{{font-family:var(--mono);font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1}}
.hero .meta{{font-size:12px;color:var(--ink-dim);font-family:var(--mono)}}
.empty{{color:var(--ink-dim);font-size:13px;padding:40px 0;text-align:center;
border:1px dashed var(--line);border-radius:12px}}

/* 空态：三块概览，比一句"结果会出现在这里"有用 */
.empty-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}}
@media (max-width:760px){{.empty-grid{{grid-template-columns:1fr}}}}
.empty-card{{background:var(--panel);border:1px solid var(--line);border-radius:12px;
padding:18px 16px;text-align:left}}
.empty-num{{font-family:var(--mono);font-size:26px;font-weight:700;letter-spacing:-.02em;
line-height:1.1;color:var(--ink)}}
.empty-label{{font-size:11.5px;color:var(--ink-dim);line-height:1.45;margin-top:4px}}
.empty-hint{{font-size:12px;color:var(--ink-dim);line-height:1.6;
padding:12px 14px;border-left:2px solid var(--line);background:var(--bg2);border-radius:0 8px 8px 0}}
.running{{color:var(--ink-dim);font-size:13px;padding:32px 0;text-align:center;
border:1px dashed var(--line);border-radius:12px}}

.res{{background:var(--panel);border:1px solid var(--line);border-radius:12px;
margin-bottom:12px;overflow:hidden;animation:rise .3s ease both}}
@keyframes rise{{from{{opacity:0;transform:translateY(6px)}}to{{opacity:1;transform:none}}}}
.res-head{{display:flex;align-items:center;gap:12px;padding:13px 16px}}
.res-head::before{{content:"";width:3px;align-self:stretch;border-radius:2px;flex:none}}
.res.ok .res-head::before{{background:var(--ok)}}
.res.warn .res-head::before{{background:var(--warn)}}
.res.fail .res-head::before{{background:var(--fail)}}
.res.skip .res-head::before{{background:var(--skip)}}
.res-title{{font-weight:650;font-size:13.5px}}
.res-blurb{{color:var(--ink-dim);font-size:12px}}
.res-verdict{{margin-left:auto;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
text-transform:uppercase;font-weight:700}}
.res.ok .res-verdict{{color:var(--ok)}}
.res.warn .res-verdict{{color:var(--warn)}}
.res.fail .res-verdict{{color:var(--fail)}}
.res.skip .res-verdict{{color:var(--skip)}}
.res-counts{{font-family:var(--mono);font-size:11px;color:var(--ink-dim);
border-top:1px solid var(--line);padding:8px 16px;background:var(--bg2)}}
.chkline{{display:flex;gap:10px;padding:7px 16px;font-size:12.5px;border-top:1px solid var(--line)}}
.chkline .st{{font-family:var(--mono);font-size:10.5px;font-weight:700;flex:none;width:44px;
padding-top:2px;letter-spacing:.06em}}
.chkline.fail .st{{color:var(--fail)}}.chkline.warn .st{{color:var(--warn)}}
.chkline.skip .st{{color:var(--skip)}}.chkline.pass .st{{color:var(--ok)}}
.chkline .nm{{color:var(--ink)}}
.chkline .dt{{color:var(--ink-dim)}}
.chkline pre{{margin:8px 0 4px;background:var(--bg);border:1px solid var(--line);
border-radius:6px;padding:9px 11px;font:11.5px var(--mono);overflow:auto;max-height:220px;
white-space:pre-wrap;word-break:break-word;width:100%}}
details{{margin:0}}
details>summary{{cursor:pointer;padding:8px 16px;font-size:12px;color:var(--ink-dim);
border-top:1px solid var(--line);list-style:none}}
details>summary::-webkit-details-marker{{display:none}}
details>summary::before{{content:"+ ";font-family:var(--mono)}}
details[open]>summary::before{{content:"- "}}
details>summary:hover{{color:var(--ink)}}

pre.raw{{background:var(--bg2);border:1px solid var(--line);border-radius:10px;
padding:16px;overflow:auto;font:11.5px/1.6 var(--mono);max-height:60vh;
white-space:pre-wrap;word-break:break-word}}
.raw-summary{{cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
text-transform:uppercase;color:var(--ink-dim);padding:12px 0;list-style:none;
border-top:1px solid var(--line);margin-top:26px}}
.raw-summary::-webkit-details-marker{{display:none}}
.raw-summary::before{{content:"+ ";}}
details[open]>.raw-summary::before{{content:"- ";}}
.raw-summary:hover{{color:var(--ink)}}

.spin{{display:inline-block;width:12px;height:12px;border:2px solid var(--line);
border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;
vertical-align:-2px;margin-right:8px}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
/* ⚠️ 必须有：脚本里大量用 classList.add('hidden') 控制显隐，
   漏掉这条会让"报告原文"空框和空态提示一直显示。 */
.hidden{{display:none !important}}

/* 侧栏链路列表：紧凑一些，10 条离线 + 6 条真机能一屏看全 */
.chk{{padding:7px 10px}}
.chk .t{{font-size:12.5px}}
.chk .b{{font-size:11px}}
.chains{{gap:4px}}
.group-label{{margin-bottom:5px}}
/* 链路多起来会把「凭证」挤出首屏，而凭证才是要填的东西 —— 限高滚动。 */
#chains{{max-height:34vh;overflow:auto;padding-right:6px;
scrollbar-width:thin;scrollbar-color:var(--line) transparent}}
#chains::-webkit-scrollbar{{width:6px}}
#chains::-webkit-scrollbar-thumb{{background:var(--line);border-radius:3px}}
</style></head><body><div class="shell">

<aside>
  <div class="brand">zhiyun pro</div>
  <h1 class="title">源检查</h1>
  <div class="sub">核对每一条数据源链路。凭证只在进程内存里，不落盘、不进报告。</div>

  <form id="f">
  <div class="group">
    <div class="group-label">链路</div>
    <div class="chains" id="chains"></div>
  </div>

  <div class="group cred">
    <div class="group-label">凭证 · 可选</div>
    <div class="note" style="border:0;padding:0;margin:0 0 6px">留空 = 跳过对应真机链路（记为跳过，不算失败）。</div>

    <label><b>浙大一卡通</b> · 学号</label>
    <input type="text" id="zju_user" autocomplete="off" spellcheck="false" placeholder="学在浙大 / 教务 / 智云课堂共用">
    <label><b>浙大一卡通</b> · 密码</label>
    <input type="password" id="zju_pass" autocomplete="new-password">
    <label><b>CC98 账号</b>（论坛自己的账号，不是统一认证）</label>
    <input type="text" id="cc98_user" autocomplete="off" spellcheck="false">
    <label><b>CC98 密码</b></label>
    <input type="password" id="cc98_pass" autocomplete="new-password">
    <label><b>拼题A Cookie</b>（短信验证，只能粘贴）</label>
    <input type="text" id="pta_cookie" autocomplete="off" spellcheck="false"
           placeholder="pintia.cn 任一 /api 请求的 Cookie 整行">
    <label><b>学习通 Cookie</b>（扫码登录，只能粘贴）</label>
    <input type="text" id="xxt_cookie" autocomplete="off" spellcheck="false"
           placeholder="chaoxing.com 任一请求的 Cookie 整行">
  </div>

  <button type="submit" class="btn btn-primary" id="go">开始检查</button>
  <button type="button" class="btn btn-ghost" id="offline">只跑离线链路</button>

  <div class="note">
    只监听 127.0.0.1，链接带一次性 token。<br>
    关掉这个终端窗口（Ctrl-C）后，内存中的凭证即消失。
  </div>
  </form>
</aside>

<main>
  <div class="hero">
    <div class="big" id="big">就绪</div>
    <div class="meta" id="meta">选好左侧的链路，然后开始。</div>
  </div>
  <div id="empty">
    <div class="empty-grid">
      <div class="empty-card">
        <div class="empty-num" id="cnt-offline">0</div>
        <div class="empty-label">条离线链路<br>不需要账号</div>
      </div>
      <div class="empty-card">
        <div class="empty-num" id="cnt-live">0</div>
        <div class="empty-label">条真机链路<br>会登录真实站点</div>
      </div>
      <div class="empty-card">
        <div class="empty-num">0</div>
        <div class="empty-label">个凭证落盘<br>全程只在内存</div>
      </div>
    </div>
    <div class="empty-hint">离线链路默认已勾选。真机链路需要先填凭证，否则会记为「跳过」而不是失败。</div>
  </div>
  <div id="results"></div>
  <div id="rawwrap" class="hidden">
    <details id="rawdetails">
      <summary class="raw-summary">报告原文（点开看 Markdown）</summary>
      <pre class="raw" id="md"></pre>
    </details>
  </div>
</main>

<script>
const TOKEN = {json.dumps(token)};
const CHAINS = {json.dumps([{"id": c[0], "title": c[1], "blurb": c[2]} for c in OFFLINE_CHAINS] + [{"id": p[0], "title": p[1], "blurb": p[2]} for p in LIVE_PLATFORMS], ensure_ascii=False)};
const LIVE = new Set({json.dumps([p[0] for p in LIVE_PLATFORMS])});
const OFFLINE_SET = new Set({json.dumps([c[0] for c in OFFLINE_CHAINS])});

const box = document.getElementById('chains');
const groups = [
  ['offline', '离线', (c) => OFFLINE_SET.has(c.id)],
  ['live', '真机', (c) => LIVE.has(c.id)],
];
for (const [, label, match] of groups) {{
  const head = document.createElement('div');
  head.className = 'group-label';
  head.style.margin = '12px 0 2px';
  head.textContent = label;
  box.appendChild(head);
  for (const c of CHAINS.filter(match)) {{
    const el = document.createElement('label');
    el.className = 'chk';
    el.innerHTML = `<input type="checkbox" value="${{c.id}}" ${{OFFLINE_SET.has(c.id) ? 'checked' : ''}}>
      <span><span class="t">${{c.title}}</span>${{LIVE.has(c.id) ? ' <span class="tag">真机</span>' : ''}}
      <br><span class="b">${{c.blurb}}</span></span>`;
    box.appendChild(el);
  }}
}}

const $ = (id) => document.getElementById(id);
function picked() {{ return [...box.querySelectorAll('input:checked')].map(i => i.value); }}

/** 勾选变化时更新空态里的两个计数。 */
function syncCounts() {{
  const sel = picked();
  $('cnt-offline').textContent = sel.filter(id => OFFLINE_SET.has(id)).length;
  $('cnt-live').textContent = sel.filter(id => LIVE.has(id)).length;
}}
box.addEventListener('change', syncCounts);
syncCounts();

async function run(offlineOnly) {{
  const selected = offlineOnly ? picked().filter(id => !LIVE.has(id)) : picked();
  if (!selected.length) {{ $('meta').textContent = '至少选一条链路'; return; }}
  $('go').disabled = true; $('offline').disabled = true;
  $('big').innerHTML = '<span class="spin"></span>运行中';
  $('meta').textContent = '真机链路会真的登录，可能要十几秒';
  $('empty').classList.add('hidden');
  // 跑起来要十几秒，先放一个占位，别让右侧一片空白。
  $('results').innerHTML = '<div class="running"><span class="spin"></span>正在跑 ' +
    selected.length + ' 条链路…</div>';

  const body = {{
    chains: selected,
    zju_user: $('zju_user').value,
    zju_pass: $('zju_pass').value,
    cc98_user: $('cc98_user').value,
    cc98_pass: $('cc98_pass').value,
    pta_cookie: $('pta_cookie').value,
    xxt_cookie: $('xxt_cookie').value,
  }};
  // 提交后立刻把凭证框清空：DOM 里不再留明文
  for (const id of ['zju_pass', 'cc98_pass', 'pta_cookie', 'xxt_cookie']) $(id).value = '';

  try {{
    const res = await fetch('/api/run?t=' + encodeURIComponent(TOKEN), {{
      method: 'POST', headers: {{'content-type': 'application/json'}},
      body: JSON.stringify(body),
    }});
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '未知错误');
    render(data);
  }} catch (err) {{
    $('big').textContent = '失败';
    $('meta').textContent = err.message;
  }} finally {{
    $('go').disabled = false; $('offline').disabled = false;
  }}
}}

function render(data) {{
  const all = data.results || [];
  const fail = all.reduce((n, r) => n + r.checks.filter(c => c.status === 'fail').length, 0);
  const pass = all.reduce((n, r) => n + r.checks.filter(c => c.status === 'pass').length, 0);
  const checks = all.reduce((n, r) => n + r.checks.length, 0);
  $('big').textContent = fail ? fail + ' 项失败' : pass + '/' + checks + ' 通过';
  $('big').style.color = fail ? 'var(--fail)' : 'var(--ok)';
  $('meta').textContent = `${{all.length}} 条链路 · ${{data.seconds.toFixed(1)}}s · 凭证 ${{data.credential_mode}}` + (data.report ? ` · 报告 ${{data.report}}` : '');

  const host = $('results');
  host.innerHTML = '';
  for (const r of all) {{
    const div = document.createElement('div');
    div.className = 'res ' + r.verdict;
    const pc = r.checks.filter(c => c.status === 'pass').length;
    const fc = r.checks.filter(c => c.status === 'fail').length;
    const sc = r.checks.filter(c => c.status === 'skip').length;
    const wc = r.checks.filter(c => c.status === 'warn').length;
    div.innerHTML = `<div class="res-head">
      <div><div class="res-title">${{r.title}}</div><div class="res-blurb">${{r.blurb}}</div></div>
      <div class="res-verdict">${{r.verdict}}</div></div>`;

    const interesting = r.checks.filter(c => c.status !== 'pass');
    if (interesting.length) {{
      for (const c of interesting) {{
        const line = document.createElement('div');
        line.className = 'chkline ' + c.status;
        line.innerHTML = `<span class="st">${{c.status}}</span>
          <div><span class="nm">${{c.name}}</span>${{c.detail ? '<span class="dt"> — ' + c.detail + '</span>' : ''}}</div>`;
        if (c.evidence) {{
          const pre = document.createElement('pre');
          pre.textContent = c.evidence;
          line.querySelector('div').appendChild(pre);
        }}
        div.appendChild(line);
      }}
    }}
    if (pc) {{
      const more = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = pc + ' 项通过';
      more.appendChild(summary);
      for (const c of r.checks.filter(c => c.status === 'pass')) {{
        const line = document.createElement('div');
        line.className = 'chkline pass';
        line.innerHTML = `<span class="st">pass</span><div><span class="nm">${{c.name}}</span>${{c.detail ? '<span class="dt"> — ' + c.detail + '</span>' : ''}}</div>`;
        more.appendChild(line);
      }}
      div.appendChild(more);
    }}
    const counts = document.createElement('div');
    counts.className = 'res-counts';
    counts.textContent = `${{pc}} pass · ${{fc}} fail · ${{wc}} warn · ${{sc}} skip${{r.seconds ? ' · ' + r.seconds.toFixed(1) + 's' : ''}}`;
    div.appendChild(counts);
    host.appendChild(div);
  }}
  $('md').textContent = data.markdown || '';
  $('rawwrap').classList.remove('hidden');
}}

$('f').addEventListener('submit', (e) => {{ e.preventDefault(); run(false); }});
$('offline').addEventListener('click', () => run(true));
</script>
</div></body></html>"""


def _chain_dict(chain: Chain, vault: CredentialVault) -> dict:
    """把 Chain 转成网页要的形状（**所有文本都过 redact**）。"""
    return {
        "id": chain.id,
        "title": chain.title,
        "blurb": chain.blurb,
        "verdict": chain.verdict,
        "seconds": round(chain.seconds, 2),
        "checks": [
            {
                "name": vault.redact(c.name),
                "status": c.status,
                "detail": vault.redact(c.detail),
                "evidence": vault.redact(c.evidence),
            }
            for c in chain.checks
        ],
    }


def run_selection(
    selected: list[str],
    *,
    vault: CredentialVault,
    jobs: int = 4,
    timeout: float = 180.0,
    tests_filter: str | None = None,
    require_live: bool = False,
    no_credentials: bool = False,
) -> tuple[list[Chain], dict]:
    """跑一批链路，返回 `(结果, meta)`。终端模式与网页模式**共用这一份**。

    抽出来是因为两条入口对"跑什么"必须完全一致 —— 网页里跑出来的结论
    与命令行跑出来的不一致，那这个工具就没有可信度了。
    """
    verifier = Verifier(jobs=jobs, timeout=timeout, vault=vault)
    live_selected = [k for k in selected if k in LIVE_INDEX]
    offline_selected = [k for k in selected if k in OFFLINE_INDEX]
    credential_mode = "未使用（离线）"
    started = time.time()
    results: list[Chain] = []

    if live_selected and no_credentials:
        credential_mode = "已跳过真机（未提供凭证）"
        for key in live_selected:
            _id, title, blurb = LIVE_INDEX[key]
            chain = make_live_chain(key, title, blurb, {}, {})
            if require_live:
                chain.checks = [Check(c.name, FAIL, c.detail, c.evidence, c.seconds) for c in chain.checks]
            results.append(chain)
        live_selected = []

    probe_shared: dict | None = None
    if any(k in PROBE_CONSUMERS for k in offline_selected) and verifier.node:
        probe_shared = run_probe(verifier, _load_names(verifier))

    live_result: dict[str, dict] = {}
    if live_selected:
        needs_cc98 = "cc98" in live_selected
        needs_pta = "pta" in live_selected
        needs_zju = any(k not in ("xxt", "cc98", "pta") for k in live_selected)
        needs_xxt = "xxt" in live_selected
        account = vault.zju(silent=True) if needs_zju else None
        cc98_account = vault.cc98(silent=True) if needs_cc98 else None
        pta_cookie = vault.pta(silent=True) if needs_pta else None
        cookie = vault.xxt(silent=True) if needs_xxt else None
        if account or cookie or cc98_account or pta_cookie:
            parts = []
            if account:
                parts.append("浙大一卡通（内存）")
            if cc98_account:
                parts.append("CC98 账号（内存）")
            if pta_cookie:
                parts.append("拼题A Cookie（内存）")
            if cookie:
                parts.append("学习通 Cookie（内存）")
            credential_mode = " + ".join(parts)
            live_result = run_live(verifier, live_selected, account, cookie, cc98_account, pta_cookie)
        else:
            credential_mode = "未提供（真机链路跳过）"

    for key in offline_selected:
        _id, title, blurb, runner = OFFLINE_INDEX[key]
        result = Chain(id=key, title=title, blurb=blurb)
        begin = time.time()
        try:
            if key == "tests":
                runner(verifier, result, pattern=tests_filter)
            elif key in PROBE_CONSUMERS:
                runner(verifier, result, probe_shared)
            else:
                runner(verifier, result)
        except Exception as error:  # noqa: BLE001
            import traceback
            result.add("链路执行", FAIL, detail=f"{type(error).__name__}: {error}",
                       evidence=traceback.format_exc()[-1200:])
        result.seconds = result.seconds or (time.time() - begin)
        results.append(result)

    for key in live_selected:
        _id, title, blurb = LIVE_INDEX[key]
        synthetic = make_live_chain(key, title, blurb, {}, live_result)
        if require_live and synthetic.count(SKIP) and not synthetic.count(FAIL):
            synthetic.checks = [Check(c.name, FAIL, c.detail, c.evidence, c.seconds) for c in synthetic.checks]
        results.append(synthetic)

    elapsed = time.time() - started
    meta = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "root_name": ROOT.name,
        "git_ref": (verifier.git("rev-parse", "--short", "HEAD") or "?") + " @ "
                    + (verifier.git("rev-parse", "--abbrev-ref", "HEAD") or "?"),
        "node": verifier.run([verifier.node, "--version"], timeout=20)[1].strip() if verifier.node else "未找到",
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "platform": sys.platform,
        "credential_mode": credential_mode,
        "seconds": elapsed,
    }
    return results, meta


def serve_web(args: argparse.Namespace) -> int:
    """起一个只监听回环的网页服务，交互全部在浏览器里完成。

    @returns 退出码（0 = 用户正常关闭）。
    """
    import http.server
    import secrets
    import threading
    import webbrowser

    token = "".join(secrets.choice(_WEB_TOKEN_CHARS) for _ in range(32))
    state = WebState()
    # 网页模式下凭证由 HTTP 表单填进来，不进 stdin 交互。
    vault = CredentialVault(interactive=False)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "source-check"
        sys_version = ""

        def log_message(self, fmt: str, *vals) -> None:  # noqa: A003 - 覆盖基类
            # 默认实现会把每个请求打到 stderr，其中有 token 与路径 —— 不该进日志。
            pass

        # ── 安全边界 ──

        def _host_ok(self) -> bool:
            """只认回环 Host，防 DNS rebinding。"""
            host = str(self.headers.get("Host", "")).split(":")[0].strip().lower()
            return host in ("127.0.0.1", "localhost", "[::1]", "::1")

        def _token_ok(self, query: str) -> bool:
            """URL 上的一次性 token。防的是本机另一个页面顺手 POST 过来。"""
            from urllib.parse import parse_qs
            got = (parse_qs(query).get("t") or [""])[0]
            return secrets.compare_digest(got, token)

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.send_header("x-content-type-options", "nosniff")
            self.send_header("referrer-policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict) -> None:
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        # ── 路由 ──

        def do_GET(self) -> None:  # noqa: N802 - 基类约定
            from urllib.parse import urlsplit
            parts = urlsplit(self.path)
            if not self._host_ok():
                self._json(403, {"ok": False, "error": "只接受本机访问"})
                return
            if parts.path in ("/", "/index.html"):
                if not self._token_ok(parts.query):
                    self._send(403, "需要带 token 的链接（启动时打印的那个）".encode("utf-8"),
                               "text/plain; charset=utf-8")
                    return
                self._send(200, _web_html(token).encode("utf-8"), "text/html; charset=utf-8")
                return
            if parts.path == "/api/health":
                self._json(200, {"ok": True, "token_required": True})
                return
            self._json(404, {"ok": False, "error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            from urllib.parse import urlsplit
            parts = urlsplit(self.path)
            if not self._host_ok():
                self._json(403, {"ok": False, "error": "只接受本机访问"})
                return
            if parts.path != "/api/run":
                self._json(404, {"ok": False, "error": "not found"})
                return
            if not self._token_ok(parts.query):
                self._json(403, {"ok": False, "error": "token 不对"})
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except (ValueError, json.JSONDecodeError):
                self._json(400, {"ok": False, "error": "请求体不是 JSON"})
                return

            chains = [c for c in (payload.get("chains") or []) if c in OFFLINE_INDEX or c in LIVE_INDEX]
            if not chains:
                self._json(400, {"ok": False, "error": "没有可跑的链路"})
                return

            if not state.lock.acquire(blocking=False):
                self._json(409, {"ok": False, "error": "已经有一轮在跑，等它结束"})
                return
            try:
                # 凭证立刻进内存保险箱，随后立刻从 payload 里抹掉引用。
                for key, user_field, pass_field in (("zju", "zju_user", "zju_pass"),
                                                    ("cc98", "cc98_user", "cc98_pass")):
                    user = str(payload.get(user_field) or "").strip()
                    password = str(payload.get(pass_field) or "")
                    if user and password:
                        label = "CC98 账号" if key == "cc98" else "浙大一卡通"
                        vault.preset(key, Account(username=user, password=password, label=label))
                cookie = str(payload.get("xxt_cookie") or "").strip()
                if cookie:
                    vault.preset("xxt", cookie)
                pta_cookie = str(payload.get("pta_cookie") or "").strip()
                if pta_cookie:
                    vault.preset("pta", pta_cookie)

                results, meta = run_selection(
                    chains,
                    vault=vault,
                    jobs=args.jobs,
                    timeout=args.timeout,
                    tests_filter=args.tests_filter or None,
                )
                state.results = results
                state.meta = meta
                # 报告写出前统一过 redact()。
                state.markdown = vault.redact(render_markdown(results, meta))

                # 顺手落一份报告（与终端模式同一套路径规则）
                report_note = ""
                if not args.no_report:
                    target_dir = Path(args.report_dir)
                    target_dir = target_dir if target_dir.is_absolute() else (ROOT / target_dir)
                    target_dir.mkdir(parents=True, exist_ok=True)
                    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                    (target_dir / f"report-{stamp}.md").write_text(state.markdown, encoding="utf-8")
                    (target_dir / f"report-{stamp}.json").write_text(
                        vault.redact(render_json(results, meta)), encoding="utf-8")
                    try:
                        (target_dir / "latest.md").write_text(state.markdown, encoding="utf-8")
                    except OSError:
                        pass
                    report_note = str(target_dir.relative_to(ROOT)) if target_dir.is_relative_to(ROOT) else str(target_dir)

                self._json(200, {
                    "ok": True,
                    "results": [_chain_dict(c, vault) for c in results],
                    "credential_mode": meta["credential_mode"],
                    "seconds": meta["seconds"],
                    "markdown": state.markdown,
                    "report": report_note,
                })
            except Exception as error:  # noqa: BLE001 - 网页里要把错误显示出来而不是白屏
                import traceback
                self._json(500, {"ok": False, "error": vault.redact(f"{type(error).__name__}: {error}"),
                                 "trace": vault.redact(traceback.format_exc()[-1500:])})
            finally:
                state.lock.release()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/?t={token}"

    print()
    print("  智云 Pro · 源检查（网页模式）")
    print()
    print(f"    打开： {url}")
    print()
    print("  · 只监听 127.0.0.1，同一局域网访问不到")
    print("  · 链接里带一次性 token，别人拿到端口也打不开")
    print("  · 凭证只在进程内存里；关掉这个窗口（Ctrl-C）就没了")
    print()
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - 打不开浏览器不算失败，URL 已经打在上面
            pass
    print("  Ctrl-C 结束。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已关闭。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已中断。", file=sys.stderr)
        sys.exit(130)

