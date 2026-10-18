#!/usr/bin/env python3
"""中转站：让用户把自己的数据喂给 AI，而不把数据交给任何第三方。

# 它解决什么

用户的个人规划、日记、读书笔记散在各处。想让它成为工作台的**自定义数据源**，
需要一个双方都能到达的落点 —— 但用户不该为此注册云服务，也不该把私人内容交给
我们托管。于是把这个落点做成**一台用户自己部署的迷你服务器**：

    用户的抓取脚本/手动提交 ──写密钥──►  中转站（用户自己的魔搭创空间）
                                            │  只追加的事件日志
    AI / 工作台         ──读密钥──►        └── 读出全部条目

我们只提供**模板与协议**，不托管任何数据，也不接触用户的密钥。

# 权限模型（本文件最重要的部分）

两个密钥，职责不相交：

| 变量 | 谁持有 | 能做什么 |
| --- | --- | --- |
| `WRITE_KEY` | 用户的推送脚本 | 只能 POST 一条新条目 |
| `READ_KEY`  | 用户填进工作台 | 只能读 |

**写密钥不能读，读密钥不能写。** 这不是风格问题：工作台把读密钥存在用户本机，
一旦泄露，泄露的是"读",不该连带把"往这个人的数据源里注入内容"的能力也交出去。

两个密钥都从环境变量读，不留在代码里。官方创空间会保存环境变量但不允许回读其值，
正适合放密钥。

# 接口

    GET  /health           无需密钥，只回 {ok, count}
    POST /entries          需要写密钥，追加一条
    GET  /entries          需要读密钥，按时间正序返回全部
    GET  /entries?since=N  只要 seq > N 的，供增量拉取
    OPTIONS *              CORS 预检

请求头一律是 `X-Zy-Write-Key` / `X-Zy-Read-Key`。**不能用 `Authorization`** ——
魔搭平台自己占用了它（`X-modelscope-*`、`X-studio-*` 同理），照用会被网关吞掉。

# 为什么只追加、不改不删

并发提交是常态（多个抓取脚本、多个设备）。追加是原子的，改中间某一行不是。
代价是查重要在 fold 时做，但这个量级（几千条）无所谓，换来的是
"任何时刻都不需要锁、也不会写坏已有记录"。
"""
from __future__ import annotations

import hmac
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("RELAY_PORT", "7860"))

# 魔搭 docker 创空间的持久化目录；本地跑时退回到脚本同级 data/。
DEFAULT_STORE = Path("/mnt/workspace") / "entries.jsonl"
LOCAL_STORE = Path(__file__).resolve().parent / "data" / "entries.jsonl"
STORE = Path(os.environ.get("RELAY_STORE") or (DEFAULT_STORE if DEFAULT_STORE.parent.exists() else LOCAL_STORE))

MAX_BODY = 32 * 1024
MAX_TITLE = 200
MAX_TEXT = 8000
MAX_TAG = 32
MAX_TAGS = 8
MAX_ENTRIES = 5000  # 上限挡住灌库：写满后拒绝新条目，而不是悄悄丢掉旧的

# 字段白名单。出现白名单外的键直接 400 —— 静默丢弃会让"我明明发了却没存上"
# 变成排查不出来的问题，而身份字段（姓名、学号、邮箱）本来就该在第一次调用就暴露。
ALLOWED_FIELDS = {"kind", "title", "text", "tags", "at"}
KINDS = {"plan", "diary", "note", "event"}

NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

# 打开域名时看到的说明页。刻意不列出任何已有数据 —— 这一侧不解锁就等于查不到。
LANDING_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>中转站</title>
<style>
  body{font:15px/1.7 -apple-system,"Segoe UI",system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#222}
  code{background:#f3f3f4;padding:2px 6px;border-radius:4px;font-size:13px}
  pre{background:#f3f3f4;padding:14px;border-radius:8px;overflow:auto;font-size:13px}
  h1{font-size:20px;margin-bottom:4px}
  .muted{color:#666;font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  td,th{border-bottom:1px solid #eee;padding:8px 6px;text-align:left}
</style></head><body>
<h1>中转站</h1>
<p class="muted">你正在运行一台自己的数据中转站。写进去由你决定，读出来只交给持有读密钥的一方。</p>
<table>
  <tr><th>动作</th><th>请求</th><th>需要</th></tr>
  <tr><td>服务状态</td><td><code>GET /health</code></td><td>—</td></tr>
  <tr><td>写一条</td><td><code>POST /entries</code></td><td><code>X-Zy-Write-Key</code></td></tr>
  <tr><td>读全部</td><td><code>GET /entries</code></td><td><code>X-Zy-Read-Key</code></td></tr>
</table>
<p>写一条的例子（把 <code>&lt;你的写密钥&gt;</code> 换掉）：</p>
<pre>curl -X POST 本域名/entries \\
  -H "X-Zy-Write-Key: &lt;你的写密钥&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"plan","title":"本周计划","text":"……","tags":["plan"]}'</pre>
<p class="muted">写密钥读不到数据，读密钥写不进数据。密钥只在服务端的环境变量里，这个页面不显示它们。</p>
</body></html>"""


def clean_entry(raw: object) -> dict | None:
    """校验并规整一条提交。不合格返回 None（调用方回 400）。"""
    if not isinstance(raw, dict):
        return None
    if set(raw) - ALLOWED_FIELDS:
        return None

    kind = raw.get("kind", "note")
    if not isinstance(kind, str) or kind not in KINDS:
        return None

    title = raw.get("title", "")
    if not isinstance(title, str):
        return None
    title = title.strip()
    if not title or len(title) > MAX_TITLE:
        return None

    text = raw.get("text", "")
    if not isinstance(text, str) or not text.strip():
        return None
    if len(text) > MAX_TEXT:
        return None

    tags = raw.get("tags") or []
    if not isinstance(tags, list) or len(tags) > MAX_TAGS:
        return None
    cleaned_tags = []
    for tag in tags:
        if not isinstance(tag, str):
            return None
        tag = tag.strip()
        if not tag or len(tag) > MAX_TAG or not NAME_RE.match(tag):
            return None
        cleaned_tags.append(tag)

    at = raw.get("at")
    if at is None:
        at = int(time.time())
    if not isinstance(at, int) or isinstance(at, bool) or at <= 0:
        return None

    return {"kind": kind, "title": title, "text": text, "tags": cleaned_tags, "at": at}


class Store:
    """append-only 的事件日志。每行一个条目，读的时候现编号。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        items = []
        with self.path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue  # 半行（写到一半断电）不该让整个服务读不出历史
                if isinstance(item, dict):
                    items.append(item)
        return items

    def append(self, entry: dict) -> dict | None:
        """返回落盘后的条目（带 seq）；已满返回 None。"""
        items = self.entries()
        if len(items) >= MAX_ENTRIES:
            return None
        stored = dict(entry, seq=len(items) + 1)
        # 一行一次 write，末尾补换行：并发进程各自追加时不会互相踩在半个对象上
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(stored, ensure_ascii=False) + "\n")
        return stored


def key_matches(given: str | None, expected: str | None) -> bool:
    """常量时间比较。缺配置时一律不放行 —— 没配密钥的服务不该是敞开的。

    严格相等，不做任何归一化：`" abc"` 与 `"abc"` 是两回事。
    请求头首尾的空白不是这里处理的 —— 那是 HTTP 协议本身的规定
    （字段值前后的 OWS 会被解析器去掉），任何 HTTP 服务都一样，
    且要求攻击者本来就握有正确密钥，不构成越权。
    """
    if not expected or not given:
        return False
    return hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    store: Store
    write_key: str
    read_key: str

    # --- 基础设施 ---------------------------------------------------------

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: N802 - 标准库要求
        # 不记 IP、不记完整请求头：日志里出现访问者信息，就违背了这个服务"不收集身份"的前提
        sys.stderr.write(f"[relay] {fmt % args}\n")

    def cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Zy-Write-Key, X-Zy-Read-Key")

    def reply(self, code: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def reply_text(self, code: int, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return parsed if isinstance(parsed, dict) else None

    # --- 路由 -------------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def route_path(self) -> str:
        """去掉创空间网关可能加上的前缀。

        线上日志实测：平台自己的探针会原样打 `/invoke`、`/config` 到容器，
        说明**路径是原样转发的**，用户带密钥请求 `/entries` 时到达的也是 `/entries`。
        所以这里不是"必须剥"的适配，而是容忍：万一以后网关改成加前缀，剥掉之后
        业务路由仍然命中，不必为此重新发版。
        """
        path = self.path.partition("?")[0]
        for prefix in ("/invoke", "/config"):
            if path.startswith(prefix + "/"):
                path = path[len(prefix):]
        return path

    def do_GET(self) -> None:  # noqa: N802
        path = self.route_path()
        _, _, query = self.path.partition("?")

        # 域名是要给用户直接点开的：没有这条，打开就是 404，看不出这是个正在跑的服务
        if path in ("/", "/index.html"):
            self.reply_text(200, LANDING_HTML)
            return

        if path == "/health":
            # 匿名请求只回 ok，**不回条数**：条数本身是元数据，能让人推断
            # "这个人的数据源里有没有东西、有多少"，而健康检查只需要判活。
            # 带读密钥时再附上条数，给主人自查用。
            payload = {"ok": True}
            if key_matches(self.headers.get("X-Zy-Read-Key"), self.read_key):
                payload["count"] = len(self.store.entries())
            self.reply(200, payload)
            return

        if path.rstrip("/") != "/entries":
            self.reply(404, {"error": "not found"})
            return

        if not key_matches(self.headers.get("X-Zy-Read-Key"), self.read_key):
            # 未授权一律 404 而不是 403：403 等于告诉扫描器"这里有个入口"
            self.reply(404, {"error": "not found"})
            return

        items = self.store.entries()
        since = 0
        if query:
            for part in query.split("&"):
                name, _, value = part.partition("=")
                if name == "since":
                    try:
                        since = int(value)
                    except ValueError:
                        self.reply(400, {"error": "invalid since"})
                        return
        payload = [item for item in items if item.get("seq", 0) > since]
        self.reply(200, {"entries": payload, "count": len(payload), "total": len(items)})

    def do_POST(self) -> None:  # noqa: N802
        if self.route_path().rstrip("/") != "/entries":
            self.reply(404, {"error": "not found"})
            return

        if not key_matches(self.headers.get("X-Zy-Write-Key"), self.write_key):
            self.reply(404, {"error": "not found"})
            return

        body = self.read_body()
        if body is None:
            self.reply(400, {"error": "invalid json body"})
            return

        entry = clean_entry(body)
        if entry is None:
            self.reply(400, {"error": "invalid entry", "allowed": sorted(ALLOWED_FIELDS), "kinds": sorted(KINDS)})
            return

        stored = self.store.append(entry)
        if stored is None:
            self.reply(507, {"error": "store full", "limit": MAX_ENTRIES})
            return

        self.reply(201, {"ok": True, "entry": stored})


def make_server(port: int, store: Store, write_key: str, read_key: str) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"store": store, "write_key": write_key, "read_key": read_key})
    return ThreadingHTTPServer(("0.0.0.0", port), handler)


def read_key_env(*names: str) -> str:
    """按顺序取第一个非空的同名环境变量，兼容平台对变量名的限制。

    魔搭创空间的环境变量名**不接受下划线**：`WRITE_KEY` 会被平台以
    `invalid_environment_variable_name` 拒掉，只能写成 `WRITEKEY`。
    本地脚本和别的平台又习惯用下划线，所以两个拼写都认，谁先有值用谁。
    """
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def main() -> int:
    write_key = read_key_env("WRITE_KEY", "WRITEKEY")
    read_key = read_key_env("READ_KEY", "READKEY")

    # 没配密钥就退出，而不是起一个敞开的服务。启动失败在平台日志里一眼可见，
    # 敞开的数据源则可能几个月都没人发现。
    if not write_key or not read_key:
        sys.stderr.write("[relay] 缺少 WRITE_KEY / READ_KEY 环境变量，拒绝启动\n")
        return 2
    if write_key == read_key:
        sys.stderr.write("[relay] WRITE_KEY 与 READ_KEY 不能相同\n")
        return 2

    server = make_server(PORT, Store(STORE), write_key, read_key)
    sys.stderr.write(f"[relay] 监听 0.0.0.0:{PORT}，落盘 {STORE}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
