"""反馈机器人的工具脚本 —— 供 AI / 定时任务调用，不供人手动敲（人请看 SKILL.md）。

# 这一层是干什么的

工作台「反馈」页是个迷你社区（形态照 GitHub issue）：用户发需求、互相评论。这个目录
是处理评论用的工具：读回待回应的讨论串，把设计意见作为「反馈机器人」回帖上去，
并在必要时推进状态。

# 为什么是 Python 而不是 Node

仓库其余工具是 Node（`scripts/*.mjs`），这里刻意用 Python：收件服务
（`deploy/feedback-service/server.py`）就是 Python，**判定逻辑与协议两边同源**，
不会出现"JS 与 Python 对同一条规则理解不同"的漂移。这个仓库已经踩过一次
（JS 的 `\\w` 只认 ASCII、Python 的是 Unicode，两端对"合法笔名"的理解不一致）。
因此工具直接 `import` 服务端模块复用 `clean_*` / `needs_reply` / `pending`。

# 子命令

    python robot/feedback.py brief             待回应队列 + 完整上下文（默认 JSON）
    python robot/feedback.py list              全部讨论串摘要
    python robot/feedback.py show F-003        一条的完整内容
    python robot/feedback.py reply F-003 --body "……"
    python robot/feedback.py reply F-003 --file draft.md
    python robot/feedback.py status F-003 done

所有子命令都支持 `--dry-run`（只打印将发出的内容，不写）。输出默认是 **JSON**（给 AI 吃），
`--pretty` 才给人看；诊断信息一律走 stderr，好让 `| jq` 或直接喂模型都不被污染。

# 不需要令牌

**谁都能以「反馈机器人」身份发言，谁都能推进状态** —— 服务端那两条路径是公开的。
这是刻意的：这是个 demo 级反馈板，「谁想处理评论都行」比「防住冒充」重要。
把这份说明给任何 AI，它就能接手处理评论。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# 复用收件端的协议与判定函数 —— 单一真值，见文件头「为什么是 Python」。
sys.path.insert(0, os.path.join(HERE, "..", "deploy", "feedback-service"))

import server  # noqa: E402

ENDPOINT = (os.environ.get("FEEDBACK_ENDPOINT") or "https://leywlybx-zju-workbench-alpha.ms.show").rstrip("/")

# `.ms.show` 的边缘过滤按 UA 放行：没有浏览器 UA 一律 403（见 `call()` 的说明）。
# 这份 UA 是**协议的一部分**，不是"装成浏览器"的小聪明 —— 我们的客户端本来就跑在浏览器里。
USER_AGENT = "Mozilla/5.0 (compatible; zhiyun-feedback-robot/1)"


def log(message: str) -> None:
    """诊断信息走 stderr，绝不污染 stdout 里的 JSON。"""
    print(message, file=sys.stderr)


def die(message: str, code: int = 1) -> None:
    log(f"✗ {message}")
    raise SystemExit(code)


def call(path: str, payload: dict | None = None) -> dict:
    """打一次服务端。任何失败都以非零码退出 —— 定时任务靠退出码判断成败。

    **必须带一个浏览器 User-Agent。** 魔搭 Studio 的 `.ms.show` 域名对疑似爬虫的
    请求返回 403（返回体还是一句误导性的"请使用 API 地址"），而浏览器请求正常放行。
    不设 UA 时 urllib 会自报 `Python-urllib/3.x`，于是线上每条命令都 403 ——
    本地跑（没有那层网关）却一切正常，所以这个坑只有连真服务才暴露。
    """
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(f"{ENDPOINT}{path}", data=data, method="POST" if data else "GET")
    request.add_header("user-agent", USER_AGENT)
    if data is not None:
        request.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            answer = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        try:
            message = json.loads(detail).get("error")
        except (ValueError, AttributeError):
            message = detail[:200]
        die(f"服务端拒绝（{error.code}）：{message}")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        die(f"连不上反馈服务（{ENDPOINT}）：{error}")
    if not isinstance(answer, dict) or answer.get("ok") is not True:
        die(f"服务端返回了意料之外的结果：{str(answer)[:200]}")
    return answer


def emit(value: object, pretty: bool) -> None:
    if pretty:
        print(render(value))
    else:
        print(json.dumps(value, ensure_ascii=False))


def render(value: object, indent: int = 0) -> str:
    """极简的人读渲染，只为 `--pretty` 服务。"""
    pad = "  " * indent
    if not isinstance(value, dict):
        if isinstance(value, list):
            return "\n".join(render(item, indent) for item in value)
        return f"{pad}{value}"
    if "title" in value and "comments" in value:  # 一条讨论串
        lines = [f"{pad}{value['id']}  [{value.get('status')}]  {value.get('title')}",
                 f"{pad}  由 {value.get('name')} 发起（{value.get('kind')}）"]
        lines += [f"{pad}  {value.get('detail')}"]
        for comment in value["comments"]:
            who = f"🤖 {comment.get('name')}" if comment.get("robot") else comment.get("name")
            lines.append(f"{pad}  · {who}: {comment.get('body')}")
        return "\n".join(lines)
    return "\n".join(f"{pad}{key}: {json.dumps(item, ensure_ascii=False) if isinstance(item, (dict, list)) else item}"
                     for key, item in value.items())


def fetch_all() -> list[dict]:
    return call("/feedback")["issues"]


def fetch_pending() -> list[dict]:
    """待回应队列。判定与排序由**服务端**做（`?pending=1`），见 server.pending()。"""
    return call("/feedback?pending=1")["issues"]


def issue_by_id(issues: list[dict], iid: str) -> dict:
    match = next((item for item in issues if item.get("id") == iid), None)
    if match is None:
        die(f"没有 {iid} 这条（编号可能写错，或者实例重启后数据丢了）")
    return match  # type: ignore[return-value]


def cmd_brief(args: argparse.Namespace) -> int:
    """给 AI 的主入口：一次拿全「该回应什么」+ 每条的全部上下文。

    刻意把待回应与已答复**都**给出去：AI 需要看到已答复的那些来避免重复回答、
    并保持前后口径一致（比如上一条说"下轮做"，这条就不能说"暂不考虑"）。
    """
    issues = fetch_all()
    waiting = [item for item in issues if server.needs_reply(item)]
    waiting.sort(key=lambda item: item.get("last") or 0)
    emit({
        "endpoint": ENDPOINT,
        "counts": {"total": len(issues), "pending": len(waiting), "answered": len(issues) - len(waiting)},
        "pending": waiting,
        "answered": [item for item in issues if not server.needs_reply(item)],
    }, args.pretty)
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    emit([{
        "id": item["id"], "status": item["status"], "title": item["title"], "kind": item.get("kind"),
        "name": item.get("name"), "comments": len(item.get("comments") or []),
        "needsReply": server.needs_reply(item), "last": item.get("last"),
    } for item in fetch_all()], args.pretty)
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    emit(issue_by_id(fetch_all(), args.issue), args.pretty)
    return 0


def cmd_pending(args: argparse.Namespace) -> int:
    """只列待回应的 —— 用服务端筛过的队列，顺序即「先来先答」。"""
    emit(fetch_pending(), args.pretty)
    return 0


def cmd_reply(args: argparse.Namespace) -> int:
    if args.file:
        with open(args.file, "r", encoding="utf-8") as handle:
            body = handle.read()
    else:
        body = args.body or ""
    if not body.strip():
        die("回帖正文不能为空（--body 或 --file）")
    if args.dry_run:
        emit({"dryRun": True, "wouldPost": {"issue": args.issue, "body": body.strip(), "as": server.ROBOT_NAME}}, args.pretty)
        return 0
    # 先在本地过一遍服务端的清洗规则：能被本地拦下的问题就不用白跑一趟网络，
    # 报错也更具体（服务端只会说"字段不合法"）。
    cleaned = server.clean_comment({"issue": args.issue, "body": body, "name": server.ROBOT_NAME})
    if cleaned is None:
        die("正文不合法（可能超长）—— 见 server.MAX_COMMENT")
    answer = call("/feedback/robot", {"issue": args.issue, "body": body})
    comment = answer.get("comment", {})
    emit({"ok": True, "issue": args.issue, "comment": comment}, args.pretty)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    if args.status not in server.STATES:
        die(f"状态只能是 {' / '.join(server.STATES)}")
    if args.dry_run:
        emit({"dryRun": True, "wouldSet": {"issue": args.issue, "status": args.status}}, args.pretty)
        return 0
    call("/feedback/status", {"issue": args.issue, "status": args.status})
    emit({"ok": True, "issue": args.issue, "status": args.status}, args.pretty)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="feedback.py",
        description="反馈机器人的工具脚本（给 AI / 定时任务用；人请看本目录的 SKILL.md）",
    )
    parser.add_argument("--pretty", action="store_true", help="人看的格式（默认 JSON，供 AI 直接消费）")
    commands = parser.add_subparsers(dest="command")

    # `--pretty` 挂在**每个子解析器**上，所以 `brief --pretty` 与 `--pretty brief` 都行。
    # 只挂在顶层解析器上时，写在子命令之后会被 argparse 判成"无法识别的参数" ——
    # 而 SKILL.md 里正是那么写的（人很自然会写 `list --pretty`），踩过。
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--pretty", action="store_true", help="人看的格式（默认 JSON，供 AI 直接消费）")

    sub = commands.add_parser("brief", parents=[common], help="待回应队列 + 完整上下文（AI 的主入口）")
    sub.set_defaults(run=cmd_brief)
    sub = commands.add_parser("list", parents=[common], help="全部讨论串摘要")
    sub.set_defaults(run=cmd_list)
    sub = commands.add_parser("pending", parents=[common], help="只列待回应的（先来先答）")
    sub.set_defaults(run=cmd_pending)

    show = commands.add_parser("show", parents=[common], help="一条的完整内容（含全部评论）")
    show.add_argument("issue")
    show.set_defaults(run=cmd_show)

    reply = commands.add_parser("reply", parents=[common], help="以「反馈机器人」身份回帖")
    reply.add_argument("issue")
    body = reply.add_mutually_exclusive_group(required=True)
    body.add_argument("--body", help="回帖正文")
    body.add_argument("--file", help="从文件读正文（适合长回复）")
    reply.add_argument("--dry-run", action="store_true", help="只打印将发出的内容，不真的写")
    reply.set_defaults(run=cmd_reply)

    status = commands.add_parser("status", parents=[common], help="推进状态：open / done / declined")
    status.add_argument("issue")
    status.add_argument("status")
    status.add_argument("--dry-run", action="store_true", help="只打印将设置的状态，不真的写")
    status.set_defaults(run=cmd_status)

    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help(sys.stderr)
        return 1
    return args.run(args)


if __name__ == "__main__":
    raise SystemExit(main())
