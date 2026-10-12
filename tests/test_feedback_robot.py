"""
`robot/feedback.py` 的命令行契约。

这里**不起服务、不发网络**，只钉参数解析与输出形状 —— 因为踩过的坑恰好在这一层：
`--pretty` 原本只挂在顶层解析器上，于是 `list --pretty` 被 argparse 判成"无法识别的
参数"，而 SKILL.md 里正是那么写的。这类错误不会在"跑一次 happy path"时暴露。

真正打服务端的验证走端到端（见 SKILL.md 的一轮完整流程）。
"""
import importlib.util
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("feedback_robot", os.path.join(HERE, "..", "robot", "feedback.py"))
robot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(robot)


class PrettyFlagTest(unittest.TestCase):
    """`--pretty` 在子命令**前后**都必须被接受。"""

    def setUp(self):
        # 指向一个必然被拒绝的本地端口：解析对了就快速失败于"连不上"，
        # 而不是去连真实域名等 20 秒超时。
        self._endpoint = robot.ENDPOINT
        robot.ENDPOINT = "http://127.0.0.1:1"

    def tearDown(self):
        robot.ENDPOINT = self._endpoint

    def run_main(self, argv):
        """跑 main()，捕获 stdout/stderr。

        我们只关心 `--pretty` 有没有被**解析**掉：解析失败时 argparse 会打印
        "unrecognized arguments" 并以 2 退出，那正是要拦的回归。
        """
        out, err = io.StringIO(), io.StringIO()
        code = None
        with redirect_stdout(out), redirect_stderr(err):
            try:
                code = robot.main(argv)
            except SystemExit as exit_code:
                code = exit_code.code
        return code, out.getvalue(), err.getvalue()

    def test_pretty_after_subcommand_is_accepted(self):
        # 这条就是回归：SKILL.md 写的是 `list --pretty`。
        for argv in (["list", "--pretty"], ["brief", "--pretty"], ["pending", "--pretty"]):
            with self.subTest(argv=argv):
                _, _, err = self.run_main(argv)
                self.assertNotIn("unrecognized arguments", err, f"{argv} 应当接受 --pretty")

    def test_pretty_before_subcommand_is_accepted(self):
        for argv in (["--pretty", "list"], ["--pretty", "brief"]):
            with self.subTest(argv=argv):
                _, _, err = self.run_main(argv)
                self.assertNotIn("unrecognized arguments", err, f"{argv} 也应当接受 --pretty")

    def test_dry_run_flags_are_accepted_after_subcommand(self):
        # reply/status 的 --dry-run 同样常写在子命令之后；它不需要网络（提前 return）。
        code, out, err = self.run_main(["reply", "F-001", "--body", "x", "--dry-run"])
        self.assertNotIn("unrecognized arguments", err)
        self.assertEqual(code, 0, "dry-run 不该失败")
        self.assertTrue(json.loads(out)["dryRun"], "dry-run 要说清楚自己没真写")

        code, out, _ = self.run_main(["status", "F-001", "done", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out)["dryRun"])

    def test_unknown_command_fails_loudly(self):
        code, _, err = self.run_main(["nonsense"])
        self.assertNotEqual(code, 0, "不认识的命令要以非零码退出（定时任务靠它判断）")
        self.assertTrue(err.strip(), "失败要给 stderr 一个原因")


class OutputContractTest(unittest.TestCase):
    """输出形状是给 AI 消费的契约。"""

    def test_emit_defaults_to_single_line_json(self):
        out = io.StringIO()
        with redirect_stdout(out):
            robot.emit({"a": 1, "中文": "值"}, pretty=False)
        self.assertEqual(out.getvalue().strip(), '{"a": 1, "中文": "值"}')
        json.loads(out.getvalue())  # 必须是可解析的

    def test_pretty_renders_an_issue_readably(self):
        issue = {
            "id": "F-003", "status": "open", "title": "标题", "name": "访客-1", "kind": "new",
            "detail": "正文", "comments": [{"name": "访客-2", "body": "评论", "robot": False}],
        }
        text = robot.render(issue)
        for expected in ("F-003", "标题", "访客-2", "评论"):
            self.assertIn(expected, text)

    def test_render_marks_robot_comments(self):
        issue = {"id": "F-1", "status": "open", "title": "t", "name": "n", "kind": "new", "detail": "d",
                 "comments": [{"name": robot.server.ROBOT_NAME, "body": "答复", "robot": True}]}
        self.assertIn("🤖", robot.render(issue), "官方答复要能一眼看出")


class NoTokenTest(unittest.TestCase):
    """工具里不该有任何令牌概念 —— 拿到 skill 就该能用。"""

    def test_no_token_is_required_anywhere(self):
        source = open(os.path.join(HERE, "..", "robot", "feedback.py"), encoding="utf-8").read()
        self.assertNotIn("TOKEN", source, "工具不该再读令牌")
        self.assertNotIn("x-robot-token", source, "工具不该发令牌头")
        self.assertFalse(hasattr(robot, "require_token"), "不该还有 require_token")

    def test_brief_does_not_advertise_a_canreply_gate(self):
        # 曾经 brief 里有个 canReply（本机有没有令牌）；那个概念已经不存在了。
        source = open(os.path.join(HERE, "..", "robot", "feedback.py"), encoding="utf-8").read()
        self.assertNotIn("canReply", source)


if __name__ == "__main__":
    unittest.main()
