"""内置能力探测（契约 §7 的五态里 Python 侧能负责的那几态）。

## 为什么单独一个文件

`deeptutor_bridge.py` 的 `--selftest` **不许 import 上游**（依赖没装完也要能跑），
而能力探测又必须能真的去问上游注册表。把探测逻辑独立出来，就能：

1. 桥在能连上游时 import 它、问一次；连不上时用同一份静态表兜底 —— 两边字段
   形状由同一个 `normalize()` 保证，不会「兜底时少一个字段，真实时多一个」。
2. `python python/capabilities_probe.py` 可以**单独**跑一遍，直接在终端上看
   11 个能力各自到底缺什么（排查用户机器上的 `deps-missing` 时这是最快的一条路）。

## 只填 Python 侧知道的四态

契约 §7 的 CapabilityEntry 有 `upstream` / `depsAvailable` / `configured` /
`verified` / `exposed` 五态，其中后三态只有 Node 侧知道（`configured` 来自用户
配置、`verified` 来自 `capabilities-state.json`、`exposed` 来自产品开关）。这里
**只填 `upstream` 与 `depsAvailable`**，其余留 `None` 表示"未表态"，由 Node 侧
合并；编一个 `false` 出来会被上层当成"确定不可用"，比不填更糟。

## 依赖探测的口径

`importlib.util.find_spec()` 只查"能不能 import"，**不真的 import**：真 import
manim 会拉起 ffmpeg/PDF 后端，在探测阶段做这种事既慢又可能崩，而探测只该回答
"装了没装"。
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from typing import Any, Callable, Iterable

#: 上游 `runtime/bootstrap/builtin_capabilities.py` 的 11 项（顺序与注册表一致）。
#: 这里写死是**有意的**：探测的用途是"上游缺件时也要如实报告有哪些能力"，
#: 所以它不能依赖上游可 import —— 那就是要探测的东西本身。
BUILTIN_CAPABILITIES: tuple[dict[str, Any], ...] = (
    {"name": "chat", "description": "通用对话", "cli_aliases": []},
    {"name": "ask_questions", "description": "提问澄清", "cli_aliases": []},
    {"name": "deep_solve", "description": "深度解题", "cli_aliases": []},
    {"name": "deep_question", "description": "深度出题", "cli_aliases": ["quiz"]},
    {"name": "deep_research", "description": "深度研究", "cli_aliases": []},
    {"name": "math_animator", "description": "数学动画（需 manim）", "cli_aliases": []},
    {"name": "visualize", "description": "可视化", "cli_aliases": []},
    {"name": "mastery_path", "description": "掌握路径", "cli_aliases": ["mastery"]},
    {"name": "immersive_reading", "description": "沉浸阅读", "cli_aliases": ["reading"]},
    {"name": "course_study", "description": "课程研读", "cli_aliases": []},
    {"name": "audio_overview", "description": "音频概览", "cli_aliases": []},
)

#: 能力 → 必需的可选依赖（不在 server.txt 里，缺了该能力不可用但整包仍可用）。
#: 只登记**确实卡住能力**的依赖：装了用不上不算缺件。
CAPABILITY_DEPS: dict[str, tuple[str, ...]] = {
    "math_animator": ("manim",),
}

#: 依赖缺失时给用户看的安装提示（契约 §9 要求"给 pip 命令"）。
INSTALL_HINTS: dict[str, str] = {
    "manim": "pip install manim",
}


def module_available(name: str) -> bool:
    """能不能 import 这个名字。查不到（含 None）都算不可用，不抛。"""
    if not name:
        return False
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError):
        # 父包不存在时 find_spec 会抛 ModuleNotFoundError；损坏的包会抛别的。
        # 探测的语义是"能不能用"，任何异常都等于不能。
        return False


def missing_deps(name: str, available: Callable[[str], bool] = module_available) -> list[str]:
    """某个能力缺哪些依赖（空列表 = 齐了）。"""
    return [dep for dep in CAPABILITY_DEPS.get(name, ()) if not available(dep)]


def install_hint_for(missing: Iterable[str]) -> str:
    return " 与 ".join(INSTALL_HINTS[dep] for dep in missing if dep in INSTALL_HINTS)


def normalize(
    manifest: dict[str, Any],
    *,
    available: Callable[[str], bool] = module_available,
    upstream: bool = True,
    reason: str = "",
) -> dict[str, Any]:
    """上游 manifest（或静态表条目）→ 契约 §7 的 CapabilityEntry。

    `manifest['availability']` 是上游自己给的结论（`{available, install_hint}`）；
    本函数在它之上**只做减**（缺依赖就置 `depsAvailable=False`），绝不做加 ——
    上游说不可用而我们说可用，用户会遇到"看着能用、点了就炸"。
    """
    name = str(manifest.get("name") or "").strip()
    availability = manifest.get("availability")
    if not isinstance(availability, dict):
        availability = {}
    deps_ok = bool(availability.get("available", True))
    upstream_hint = str(availability.get("install_hint") or "")
    missing = missing_deps(name, available)
    if missing:
        deps_ok = False
    hint = upstream_hint or install_hint_for(missing)
    entry_reason = reason
    if not entry_reason and missing:
        entry_reason = f"缺少必需依赖：{', '.join(missing)}"
    return {
        "name": name,
        "description": str(manifest.get("description") or ""),
        "stages": [str(item) for item in (manifest.get("stages") or [])],
        "cliAliases": [str(item) for item in (manifest.get("cli_aliases") or [])],
        "upstream": upstream,
        "depsAvailable": deps_ok,
        # 后三态只有 Node 侧知道，留 None = 未表态（见模块文档）。
        "configured": None,
        "verified": None,
        "exposed": None,
        "installHint": hint,
        "reason": entry_reason,
    }


def fallback_entries(
    *,
    available: Callable[[str], bool] = module_available,
    reason: str = "上游不可 import，能力清单来自内置静态表",
) -> list[dict[str, Any]]:
    """上游连不上时的兜底清单：11 条都在，但 `upstream=False` 且 `reason` 说清原因。"""
    return [normalize(manifest, available=available, upstream=False, reason=reason) for manifest in BUILTIN_CAPABILITIES]


def probe(app: Any = None, *, available: Callable[[str], bool] = module_available) -> dict[str, Any]:
    """探测一轮能力。

    @param app - `DeepTutorApp` 实例或 `None`；`None` 表示上游不可用，走静态兜底。
    @returns `{capabilities, upstreamAvailable, reason}`
    """
    if app is None:
        return {
            "capabilities": fallback_entries(available=available),
            "upstreamAvailable": False,
            "reason": "上游不可用，能力清单来自内置静态表",
        }
    get_contracts = getattr(app, "get_capability_contracts", None)
    if not callable(get_contracts):
        return {
            "capabilities": fallback_entries(available=available, reason="上游门面缺少 get_capability_contracts"),
            "upstreamAvailable": False,
            "reason": "上游门面缺少 get_capability_contracts，能力清单来自内置静态表",
        }
    try:
        contracts = get_contracts()
    except Exception as exc:  # 上游门面自己炸了：如实报原因，不要伪造一份可用清单
        return {
            "capabilities": fallback_entries(
                available=available,
                reason=f"读取上游能力清单失败：{type(exc).__name__}: {exc}",
            ),
            "upstreamAvailable": False,
            "reason": f"读取上游能力清单失败：{type(exc).__name__}: {exc}",
        }
    entries = []
    for manifest in contracts or []:
        if not isinstance(manifest, dict):
            continue
        entries.append(normalize(manifest, available=available))
    if not entries:
        return {
            "capabilities": fallback_entries(available=available, reason="上游能力注册表为空"),
            "upstreamAvailable": False,
            "reason": "上游能力注册表为空",
        }
    return {"capabilities": entries, "upstreamAvailable": True, "reason": ""}


# ── 独立运行（排查工具） ────────────────────────────────────────────────────


def _import_app() -> Any:
    """尽最大努力拿到 `DeepTutorApp`；拿不到就返回 None（由 probe 兜底）。"""
    vendor = os.environ.get("ZHIYUN_DEEPTUTOR_VENDOR")
    if vendor and vendor not in sys.path:
        sys.path.insert(0, vendor)
    if not vendor:
        # 从本文件位置反推 vendor：python/ 的同级目录下的 vendor/deeptutor。
        here = os.path.dirname(os.path.abspath(__file__))
        guess = os.path.abspath(os.path.join(here, "..", "vendor", "deeptutor"))
        if os.path.isdir(guess) and guess not in sys.path:
            sys.path.insert(0, guess)
    try:
        from deeptutor.app.facade import DeepTutorApp  # type: ignore

        return DeepTutorApp()
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    report = probe(_import_app())
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    print(f"上游能力清单可用：{'是' if report['upstreamAvailable'] else '否'}")
    if report["reason"]:
        print(f"原因：{report['reason']}")
    print(f"共 {len(report['capabilities'])} 个能力：")
    for entry in report["capabilities"]:
        mark = "OK " if entry["depsAvailable"] else "缺件"
        suffix = f"  ({entry['installHint']})" if entry["installHint"] else ""
        print(f"  [{mark}] {entry['name']}{suffix}")
        if entry["reason"]:
            print(f"         {entry['reason']}")
    return 0


# 不依赖上游的纯逻辑自检（可在 pip 装完前跑）。
def _selftest() -> int:
    failures: list[str] = []

    def check(label: str, condition: bool, detail: str = "") -> None:
        if not condition:
            failures.append(f"{label}{('：' + detail) if detail else ''}")

    check("内置能力 11 项", len(BUILTIN_CAPABILITIES) == 11, str(len(BUILTIN_CAPABILITIES)))
    names = [item["name"] for item in BUILTIN_CAPABILITIES]
    check("能力名不重复", len(set(names)) == len(names), str(names))
    for required in ("chat", "deep_question", "math_animator", "mastery_path", "audio_overview"):
        check(f"包含 {required}", required in names, str(names))

    # module_available 对不存在的名字必须返回 False 而不是抛。
    check("module_available 假名字为 False", module_available("zhiyun_no_such_module_xyz") is False)
    check("module_available 对 JSON 为 True", module_available("json") is True)

    # 缺依赖必须把 depsAvailable 减成 False。
    fake_missing = normalize(
        {"name": "math_animator", "description": "d"},
        available=lambda name: False,
    )
    check("math_animator 缺 manim 时不可用", fake_missing["depsAvailable"] is False, str(fake_missing))
    check("math_animator 给安装提示", "manim" in fake_missing["installHint"], fake_missing["installHint"])
    check("缺依赖时 reason 非空", bool(fake_missing["reason"]), fake_missing["reason"])

    fake_ok = normalize({"name": "math_animator"}, available=lambda name: True)
    check("math_animator 依赖齐时可用", fake_ok["depsAvailable"] is True, str(fake_ok))
    check("依赖齐时 reason 为空", fake_ok["reason"] == "", fake_ok["reason"])

    # 上游说不可用 + 依赖齐 → 仍不可用（只做减，不做加）。
    upstream_off = normalize(
        {"name": "chat", "availability": {"available": False, "install_hint": "pip install x"}},
        available=lambda name: True,
    )
    check("上游说不可用就不可用", upstream_off["depsAvailable"] is False, str(upstream_off))
    check("优先用上游的 install_hint", upstream_off["installHint"] == "pip install x", upstream_off["installHint"])

    # 后三态必须留 None（未表态），不能编 false。
    check("configured 留 None", fake_ok["configured"] is None, str(fake_ok["configured"]))
    check("verified 留 None", fake_ok["verified"] is None, str(fake_ok["verified"]))
    check("exposed 留 None", fake_ok["exposed"] is None, str(fake_ok["exposed"]))

    # 兜底路径：11 条都在，且 upstream/available 都如实为 False。
    fallback = probe(None)
    check("兜底 11 条", len(fallback["capabilities"]) == 11, str(len(fallback["capabilities"])))
    check("兜底 upstreamAvailable=False", fallback["upstreamAvailable"] is False)
    check("兜底每条 upstream=False", all(item["upstream"] is False for item in fallback["capabilities"]))
    check("兜底每条有 reason", all(item["reason"] for item in fallback["capabilities"]))

    # 门面缺方法 / 抛异常都不能把探测拖成崩溃。
    class NoContracts:
        pass

    class Raises:
        def get_capability_contracts(self):
            raise RuntimeError("boom")

    check("门面缺方法走兜底", probe(NoContracts())["upstreamAvailable"] is False)
    check("门面抛异常走兜底", probe(Raises())["upstreamAvailable"] is False)
    check("门面异常时 reason 带原文", "boom" in probe(Raises())["reason"], probe(Raises())["reason"])

    class Fake:
        def get_capability_contracts(self):
            return [
                {"name": "chat", "description": "d", "stages": ["s1"], "cli_aliases": ["c"]},
                {"name": "math_animator"},
                "junk",  # 非 dict 的条目要跳过而不是炸
            ]

    class FakeAvail:
        def __init__(self):
            self.seen: list[str] = []

        def __call__(self, name: str) -> bool:
            self.seen.append(name)
            return name != "manim"

    avail = FakeAvail()
    real = probe(Fake(), available=avail)
    check("真实路径 upstreamAvailable=True", real["upstreamAvailable"] is True, str(real["upstreamAvailable"]))
    check("真实路径跳过非 dict 条目", len(real["capabilities"]) == 2, str(len(real["capabilities"])))
    chat = next(item for item in real["capabilities"] if item["name"] == "chat")
    check("stages 透传", chat["stages"] == ["s1"], str(chat["stages"]))
    check("cliAliases 透传", chat["cliAliases"] == ["c"], str(chat["cliAliases"]))
    check("真实路径 upstream=True", chat["upstream"] is True)
    animator = next(item for item in real["capabilities"] if item["name"] == "math_animator")
    check("实际探测到缺 manim", animator["depsAvailable"] is False, str(animator))
    check("探测问了 manim", "manim" in avail.seen, str(avail.seen))

    print("capabilities_probe selftest")
    print(f"checks: {'FAILED' if failures else 'ok'}")
    for failure in failures:
        print(f"  FAIL {failure}")
    return 0 if not failures else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(_selftest())
    sys.exit(main())
