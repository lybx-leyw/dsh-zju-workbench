"""智云 Pro 反馈服务 —— 极小、零框架依赖的「内嵌迷你社区」后端。

# 它是什么

一台只做一件事的后端：收下用户在工作台「反馈」页发的需求（issue）与评论（comment），
**追加**写进本地文件，供所有人读回。部署在魔搭 Studio
（`leywlybx/zju-workbench-alpha`）上，当"云服务器"用。

形态刻意做成 GitHub issue 那一套：**发一条需求 → 谁都能在下面评论 → 状态推进**。
区别只有一个：这里没有账号，所以评论的署名是一个**本地随机笔名**（见下文）。

# 为什么这么小

魔搭 Studio 的资源与平台约束很紧（依赖体积、长阻塞都会踩坑）。所以这里刻意**不引入
FastAPI/uvicorn**：Python 标准库的 `http.server` 就够了，零第三方依赖，镜像小、
启动快、不会因为某个包解析失败而起不来。

# 数据形状：append-only 事件日志

`/mnt/workspace/feedback.jsonl` —— **一行一个事件**，不是一行一个 issue。事件三种：

    {"t":"issue",   "id":"F-003", "kind":"new", "title":…, "detail":…, "name":…, "at":…}
    {"t":"comment", "issue":"F-003", "body":…, "name":…, "at":…, "cid":…}
    {"t":"status",  "issue":"F-003", "status":"done", "at":…}

读的时候 `fold()` 从小到大扫一遍，合成 `{id, title, …, status, comments[], last}`。

**为什么是事件流而不是"改一行"**：这条日志是唯一真值，而它可能被并发写（多个用户
同时评论）。追加是原子的，改中间某一行不是。状态推进也只是**再加一个事件**，不动历史 ——
于是"这条为什么变成 done 了"永远能回溯。代价是读要 fold，但量级（几千条）无所谓。

# 安全边界

- 接收端点对外公开（它就是这个用途），因此**不做任何身份校验**，靠限长与字段白名单
  抵御乱写。
- **不存任何身份信息**：不写 IP、不写 User-Agent、不要真实姓名。
  署名只接受一个**本地随机笔名**（形如 `访客-7f3a`），且服务端不打算校验它"像不像"真名 ——
  它能被反查成真人的唯一途径是用户自己把真名填进去，这是用户的选择，不是我们的收集。
- **没有权限体系，也不打算有**：`POST /feedback/robot`（以「反馈机器人」身份回帖）与
  `POST /feedback/status`（推进状态）**和发需求一样是公开的**。
  谁拿着 `robot/SKILL.md` 谁就能以机器人身份说话 —— 这是**刻意**的，不是疏漏：
  这是个 demo 级的反馈板，「谁想处理评论都行」比「防住冒充」重要得多。
  代价是任何人都能把别人的需求标成「不采纳」；已知并接受（见 `docs/modelscope-as-cloud-server.md`）。
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 持久化目录：魔搭 Studio 的 /mnt/workspace；本地跑时退回到同目录下的 data/。
DATA_DIR = os.environ.get("FEEDBACK_DATA_DIR") or ("/mnt/workspace" if os.path.isdir("/mnt/workspace") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
LOG_FILE = os.path.join(DATA_DIR, "feedback.jsonl")

PORT = int(os.environ.get("FEEDBACK_PORT", "7860"))

MAX_BODY = 32 * 1024          # 单条请求体上限
MAX_TITLE = 200               # 标题上限
MAX_DETAIL = 4000             # 需求正文上限
MAX_COMMENT = 4000            # 评论正文上限
MAX_ISSUES = 2000             # 防灌：条数上限
MAX_EVENTS = 20000            # 防灌：事件总数上限（评论比需求更容易被刷）

# 字段白名单：只认这几个，其余一律**拒收**（不是静默丢弃）。刻意没有任何身份字段。
ISSUE_FIELDS = ("kind", "title", "detail", "name")
COMMENT_FIELDS = ("issue", "body", "name")

KINDS = ("new", "track")
STATES = ("open", "done", "declined")

# 笔名：1~24 个「词字符或连字符」。`\w` 在 Python 3 下按 Unicode 匹配，中文笔名可用；
# 不含空格与标点，避免把渲染层的结构（前缀、分隔线）从名字里注入进来。
NAME_RE = re.compile(r"^[\w-]{1,24}$")
ISSUE_ID_RE = re.compile(r"^F-\d{3,}$")

ROBOT_NAME = "反馈机器人"
# 机器人回帖固定加这个尾巴。客户端据此把「官方答复」与普通评论分开渲染，
# 所以它由**服务端**统一追加：机器人脚本漏写也不会让读者分不清谁在说话。
RULE = "─" * 24
CLOSING = f"\n\n{RULE}\n> 这是一条由反馈机器人发布的公开答复。"


# ────────────────────────────────────────────────────────────── 纯函数：清洗

def clean_name(raw: object) -> str | None:
    """洗一个笔名。不合法返回 None（调用方决定是拒收还是用默认值）。"""
    if not isinstance(raw, str):
        return None
    name = unicodedata.normalize("NFC", raw).strip()
    return name if NAME_RE.match(name) else None


def clean_issue(raw: object) -> dict | None:
    """把一条新需求洗成白名单字段；越界即拒。

    白名单外字段一律**拒收**而不是静默丢弃：客户端要是误把身份信息一起 POST 上来
    （真实姓名、学号、IP），请求会"成功"，等我们发现时那些数据已经落进公开日志了。
    直接拒掉能让问题在第一次调用就暴露。
    """
    if not isinstance(raw, dict):
        return None
    if any(key not in ISSUE_FIELDS for key in raw):
        return None
    if raw.get("kind") not in KINDS:
        return None
    title = raw.get("title")
    detail = raw.get("detail")
    if not isinstance(title, str) or not title.strip():
        return None
    if not isinstance(detail, str) or not detail.strip():
        return None
    if len(title) > MAX_TITLE or len(detail) > MAX_DETAIL:
        return None
    name = clean_name(raw.get("name"))
    if name is None:
        return None
    return {"kind": raw["kind"], "title": title.strip(), "detail": detail.strip(), "name": name}


def clean_comment(raw: object) -> dict | None:
    """把一条评论洗成白名单字段；越界即拒。

    **必须带合法笔名**。这里刻意不接受"不署名"—— 不签名就等于可以冒充维护者发言，
    而"谁在说话"正是这条讨论串唯一的结构。官方答复走的是另一条要令牌的路径。
    """
    if not isinstance(raw, dict):
        return None
    if any(key not in COMMENT_FIELDS for key in raw):
        return None
    issue = raw.get("issue")
    body = raw.get("body")
    if not isinstance(issue, str) or not ISSUE_ID_RE.match(issue):
        return None
    if not isinstance(body, str) or not body.strip():
        return None
    if len(body) > MAX_COMMENT:
        return None
    name = clean_name(raw.get("name"))
    if name is None:
        return None
    return {"issue": issue, "body": body.strip(), "name": name}


def robot_body(body: str) -> str:
    """给机器人回帖补上「官方答复」尾巴（已有则不重复加）。"""
    text = body.strip()
    return text if CLOSING.strip() in text else text + CLOSING


def fold(events: list[dict]) -> list[dict]:
    """把事件流合成问题列表。

    旧的在前、新的在后地扫一遍；`status` 与 `comment` 只作用在已出现的 issue 上
    （指向不存在条目的评论直接丢掉 —— 那说明日志被截断过，不是正常写入）。

    @param events - 事件列表，按写入顺序。
    @returns 问题列表，按最后活动时间**倒序**（有动静的浮上来，最像 issue 列表）。
    """
    issues: dict[str, dict] = {}
    order: list[str] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        kind = event.get("t")
        if kind == "issue":
            iid = event.get("id")
            if not isinstance(iid, str) or iid in issues:
                continue  # 没 id 的坏行、重复的 id 都跳过，不让它们污染列表
            at = event.get("at") or 0
            issues[iid] = {
                "id": iid,
                "kind": event.get("kind"),
                "title": event.get("title"),
                "detail": event.get("detail"),
                "name": event.get("name"),
                "at": at,
                "status": "open",
                "comments": [],
                "last": at,
                # 见 needs_reply()：这里是**唯一的**判定处，机器人与页面都读这个字段，
                # 各自再实现一份必然会漂移。
                "needs_reply": True,
            }
            order.append(iid)
            continue
        iid = event.get("issue")
        item = issues.get(iid)
        if item is None:
            continue
        at = event.get("at") or 0
        if kind == "comment":
            item["comments"].append({
                "cid": event.get("cid"),
                "name": event.get("name"),
                "body": event.get("body"),
                "at": at,
                "robot": bool(event.get("robot")),
            })
            item["needs_reply"] = not bool(event.get("robot"))
        elif kind == "status" and event.get("status") in STATES:
            item["status"] = event["status"]
        else:
            continue
        item["last"] = max(item["last"], at)
    return sorted((issues[iid] for iid in order), key=lambda item: -item["last"])


def needs_reply(issue: dict) -> bool:
    """这条讨论串是否需要维护者出面回应。

    **定义放在服务端是刻意的**：机器人（`robot/`）与页面都要用这个判定，
    两边各写一份必然漂移 —— 这个仓库已经在别处踩过同类问题（JS 的 `\\w` 只认
    ASCII、Python 的是 Unicode，于是两端对"合法笔名"的理解不一致）。

    判定 = 「最后一条不是机器人发的」。提需求时还无人评论也算 —— 一条没人理的
    需求正是最需要先开口的。**与 status 无关**：已实现的需求下面照样可以有新讨论。

    @param issue - 一条已 fold 的讨论串。
    @returns 是否需要回应。
    """
    comments = issue.get("comments") or []
    if not comments:
        return True
    return not bool(comments[-1].get("robot"))


def pending(issues: list[dict]) -> list[dict]:
    """挑出待回应的，**最久没人管的排最前**（先来先答）。

    顺序是给自动回复用的：若一轮只处理一条，应当处理排队最久的，否则热门条目会
    反复被答，冷门的永远轮不上。

    @param issues - 已 fold 的讨论串列表。
    @returns 新列表。
    """
    waiting = [item for item in issues if needs_reply(item)]
    return sorted(waiting, key=lambda item: item.get("last") or 0)


# ────────────────────────────────────────────────────────────── 存储

class Store:
    """append-only 事件日志。写入串行化，读走内存快照。

    单实例、低流量，所以整个日志常驻内存；`append` 是"先落盘再改内存"，
    保证进程崩了也不会出现"内存里有、文件里没有"。
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self.events: list[dict] = []
        self._loaded = False
        self._lock = threading.Lock()

    def load(self) -> None:
        """首次访问时把文件读进来；坏行跳过，不让一行毁掉整份日志。"""
        if self._loaded:
            return
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self.events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        self._loaded = True

    def issues(self) -> list[dict]:
        with self._lock:
            self.load()
            return fold(self.events)

    def next_issue_id(self) -> str:
        """下一个编号：从已有编号的最大值往后取，避免删过条目后撞号。"""
        with self._lock:
            self.load()
            return self._next_id_locked()

    def _next_id_locked(self) -> str:
        biggest = 0
        for event in self.events:
            iid = event.get("id") if event.get("t") == "issue" else None
            if isinstance(iid, str) and ISSUE_ID_RE.match(iid):
                biggest = max(biggest, int(iid[2:]))
        return f"F-{biggest + 1:03d}"

    def add_issue(self, item: dict, at: int) -> dict | None:
        """分配编号并追加一条需求 —— **编号分配与写入在同一把锁里**。

        分成"先 `next_issue_id()` 再 `write()`"两步是错的：两个用户同时提交会拿到
        同一个编号，而 `fold()` 对重复 id 只认第一条，于是后一条需求**静默消失**。
        提交是并发的（这就是公开端点的常态），所以这里必须原子。

        @param item - `clean_issue()` 洗过的字段。
        @param at - 时间戳。
        @returns 落盘的事件；达到上限时 None。
        """
        with self._lock:
            self.load()
            if sum(1 for e in self.events if e.get("t") == "issue") >= MAX_ISSUES:
                return None
            if len(self.events) >= MAX_EVENTS:
                return None
            event = {"t": "issue", "id": self._next_id_locked(), **item, "at": at}
            self._append_locked(event)
            return event

    def write(self, event: dict) -> bool:
        """追加一个事件。超出上限时返回 False（不抛异常）。"""
        with self._lock:
            self.load()
            count = sum(1 for item in self.events if item.get("t") == "issue")
            if event.get("t") == "issue" and count >= MAX_ISSUES:
                return False
            if len(self.events) >= MAX_EVENTS:
                return False
            self._append_locked(event)
            return True

    def _append_locked(self, event: dict) -> None:
        """真正的落盘 + 入内存。调用方必须已经持有 `self._lock`。"""
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        self.events.append(event)


STORE = Store(LOG_FILE)


def now() -> int:
    return int(time.time())


# ────────────────────────────────────────────────────────────── HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "zhiyun-feedback/2"

    def _json(self, code: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        # 插件在本地页面里跨源调用它，必须放行 CORS。
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict | None:
        """读并解析请求体；超长/非法一律 None。

        读之前**不能**先回响应：客户端正在写的那截数据会撞上已关闭的 socket，
        浏览器/urllib 侧表现为 `ConnectionAborted`（连接被中止）而不是拿到那个错误码。
        所以所有处理函数都先调用本方法，再决定回什么。
        """
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def do_OPTIONS(self) -> None:  # noqa: N802 - 标准库要求的命名
        self._json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            self._json(200, {"ok": True, "issues": len(STORE.issues()), "events": len(STORE.events)})
            return
        if self.path.startswith("/feedback"):
            issues = STORE.issues()
            # `?pending=1` 只给待回应的（最久没人管的在前）——机器人一轮要处理什么，
            # 由服务端回答，省得每个调用方各写一遍筛选与排序。
            if "pending=1" in self.path:
                waiting = pending(issues)
                self._json(200, {"ok": True, "count": len(waiting), "issues": waiting})
                return
            self._json(200, {"ok": True, "count": len(issues), "issues": issues})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/feedback/robot"):
            self._robot()
            return
        if self.path.startswith("/feedback/comment"):
            self._comment()
            return
        if self.path.startswith("/feedback/status"):
            self._status()
            return
        if self.path.startswith("/feedback"):
            self._issue()
            return
        self._json(404, {"ok": False, "error": "not found"})

    def _issue(self) -> None:
        raw = self._body()
        if raw is None:
            self._json(400, {"ok": False, "error": "请求体过大、为空或不是合法 JSON"})
            return
        item = clean_issue(raw)
        if item is None:
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        event = STORE.add_issue(item, now())
        if event is None:
            self._json(429, {"ok": False, "error": "条目已达上限，请联系维护者"})
            return
        self._json(200, {"ok": True, "issue": {**event, "status": "open", "comments": [], "last": event["at"]}})

    def _comment(self) -> None:
        raw = self._body()
        if raw is None:
            self._json(400, {"ok": False, "error": "请求体过大、为空或不是合法 JSON"})
            return
        item = clean_comment(raw)
        if item is None:
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        if not any(issue["id"] == item["issue"] for issue in STORE.issues()):
            self._json(404, {"ok": False, "error": "这条需求不存在"})
            return
        event = {"t": "comment", **item, "at": now(), "cid": f"{item['issue']}-c{now()}"}
        if not STORE.write(event):
            self._json(429, {"ok": False, "error": "评论已达上限，请联系维护者"})
            return
        self._json(200, {"ok": True, "comment": {**event, "robot": False}})

    def _status(self) -> None:
        # 公开端点：谁都能推进状态。这是个 demo 级反馈板，「谁想处理评论都行」
        # 优先于「防住误标」—— 见文件头的安全边界。
        raw = self._body()
        if raw is None:
            self._json(400, {"ok": False, "error": "请求体过大、为空或不是合法 JSON"})
            return
        if not isinstance(raw, dict) or any(k not in ("issue", "status") for k in raw):
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        issue, status = raw.get("issue"), raw.get("status")
        if not isinstance(issue, str) or status not in STATES:
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        if not any(item["id"] == issue for item in STORE.issues()):
            self._json(404, {"ok": False, "error": "这条需求不存在"})
            return
        if not STORE.write({"t": "status", "issue": issue, "status": status, "at": now()}):
            self._json(429, {"ok": False, "error": "已达上限，请联系维护者"})
            return
        self._json(200, {"ok": True})

    def _robot(self) -> None:
        """以「反馈机器人」身份回帖 —— **公开端点，不需要任何凭证**。

        谁拿着 `robot/SKILL.md` 谁就能用。这是刻意的：见文件头「安全边界」。
        """
        raw = self._body()
        if raw is None or not isinstance(raw, dict) or any(k not in ("issue", "body") for k in raw):
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        issue, body = raw.get("issue"), raw.get("body")
        if not isinstance(issue, str) or not ISSUE_ID_RE.match(issue):
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        if not isinstance(body, str) or not body.strip():
            self._json(400, {"ok": False, "error": "字段不合法"})
            return
        if not any(item["id"] == issue for item in STORE.issues()):
            self._json(404, {"ok": False, "error": "这条需求不存在"})
            return
        text = robot_body(body)
        if len(text) > MAX_COMMENT + len(CLOSING):
            self._json(400, {"ok": False, "error": "回复过长"})
            return
        event = {"t": "comment", "issue": issue, "body": text, "name": ROBOT_NAME, "robot": True, "at": now(), "cid": f"{issue}-r{now()}"}
        if not STORE.write(event):
            self._json(429, {"ok": False, "error": "评论已达上限，请联系维护者"})
            return
        self._json(200, {"ok": True, "comment": event})

    def log_message(self, fmt: str, *args: object) -> None:
        # 默认实现会把来访 IP 写进日志 —— 收反馈不需要这个，去掉。
        print(f"[feedback] {fmt % args}")


def main() -> None:
    print(f"zhiyun feedback service on 0.0.0.0:{PORT}, store={STORE.path}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
