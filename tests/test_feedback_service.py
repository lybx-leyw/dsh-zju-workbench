"""
反馈服务的收件规则。

钉的是"什么能落盘、什么必须被拒、谁能以维护者身份说话"——收件端是唯一能让脏数据
进后台的地方，而且它对公众开放（发需求与评论都不需要凭证），所以字段白名单、长度上限
与令牌校验都不是可选项。

纯函数（`clean_*` / `fold`）直接喂输入断言；涉及令牌与落盘的用临时目录起真服务，
因为"没配令牌时端点是否关闭"这件事只有走过那段 HTTP 代码才能证明。
"""
import itertools
import json
import os
import shutil
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "deploy", "feedback-service"))

import server  # noqa: E402

# 临时日志放仓库内的 `.runtime/`（已 gitignore）而不是系统临时目录，且**不用**
# `tempfile.mkdtemp`：它以 0o700 建目录，在 Windows 上会连带剥掉沙箱继承下来的允许
# 权限，之后连自己写进去都会被拒。普通 `os.mkdir` 建的目录行为正常。
TMP_ROOT = os.path.join(HERE, "..", ".runtime", "feedback-tests")
_counter = itertools.count()


def temp_dir():
    path = os.path.join(TMP_ROOT, f"case-{os.getpid()}-{next(_counter)}")
    os.makedirs(path, exist_ok=True)
    return path


def remove_dir(path):
    shutil.rmtree(path, ignore_errors=True)


def issue_event(iid="F-001", at=100, **extra):
    return {"t": "issue", "id": iid, "kind": "new", "title": "t", "detail": "d", "name": "访客-1", "at": at, **extra}


class CleanIssueTest(unittest.TestCase):
    def test_accepts_a_new_request(self):
        self.assertEqual(
            server.clean_issue({"kind": "new", "title": "离线模式", "detail": "想离线看课", "name": "访客-1"}),
            {"kind": "new", "title": "离线模式", "detail": "想离线看课", "name": "访客-1"},
        )

    def test_accepts_unicode_and_hyphen_names(self):
        for name in ("访客-7f3a", "同学", "a" * 24, "robot-1"):
            with self.subTest(name=name):
                self.assertIsNotNone(server.clean_issue({"kind": "new", "title": "t", "detail": "d", "name": name}))

    def test_rejects_identity_fields_instead_of_silently_dropping_them(self):
        # 静默丢弃会让"客户端在传身份信息"这件事拖到数据已经公开时才暴露。
        for field in ("username", "studentId", "contact", "email", "ip", "realName"):
            with self.subTest(field=field):
                self.assertIsNone(server.clean_issue({"kind": "new", "title": "x", "detail": "y", "name": "n", field: "someone"}))

    def test_rejects_missing_or_dirty_name(self):
        # 笔名是唯一的"谁在说话"，不能为空、不能带空格或标点（会注入渲染结构）。
        for name in (None, "", "   ", "a b", "张三 李四", "<script>", "a" * 25, 123):
            with self.subTest(name=name):
                self.assertIsNone(server.clean_issue({"kind": "new", "title": "x", "detail": "y", "name": name}))

    def test_rejects_unknown_kind(self):
        self.assertIsNone(server.clean_issue({"kind": "other", "title": "x", "detail": "y", "name": "n"}))

    def test_rejects_blank_or_oversized_text(self):
        self.assertIsNone(server.clean_issue({"kind": "new", "title": "   ", "detail": "y", "name": "n"}))
        self.assertIsNone(server.clean_issue({"kind": "new", "title": "x", "detail": "  ", "name": "n"}))
        self.assertIsNone(server.clean_issue({"kind": "new", "title": "x" * (server.MAX_TITLE + 1), "detail": "y", "name": "n"}))
        self.assertIsNone(server.clean_issue({"kind": "new", "title": "x", "detail": "y" * (server.MAX_DETAIL + 1), "name": "n"}))

    def test_rejects_non_object(self):
        for raw in ([], "x", None, 3):
            with self.subTest(raw=raw):
                self.assertIsNone(server.clean_issue(raw))

    def test_trims_surrounding_whitespace(self):
        self.assertEqual(
            server.clean_issue({"kind": "new", "title": "  x  ", "detail": "  y  ", "name": " 访客-1 "}),
            {"kind": "new", "title": "x", "detail": "y", "name": "访客-1"},
        )


class CleanCommentTest(unittest.TestCase):
    def test_accepts_a_comment(self):
        self.assertEqual(
            server.clean_comment({"issue": "F-002", "body": "我也想要", "name": "访客-2"}),
            {"issue": "F-002", "body": "我也想要", "name": "访客-2"},
        )

    def test_rejects_anonymous_comments(self):
        # 不署名 = 可以冒充维护者发言，所以这里必须拒收（官方答复走令牌路径）。
        for name in (None, "", "   "):
            with self.subTest(name=name):
                self.assertIsNone(server.clean_comment({"issue": "F-002", "body": "b", "name": name}))

    def test_rejects_identity_fields_and_bad_issue_ids(self):
        self.assertIsNone(server.clean_comment({"issue": "F-002", "body": "b", "name": "n", "email": "a@b.c"}))
        for bad in ("<script>", "F-1", "001", "", "F-002; drop table"):
            with self.subTest(issue=bad):
                self.assertIsNone(server.clean_comment({"issue": bad, "body": "b", "name": "n"}))

    def test_rejects_blank_or_oversized_body(self):
        self.assertIsNone(server.clean_comment({"issue": "F-002", "body": "   ", "name": "n"}))
        self.assertIsNone(server.clean_comment({"issue": "F-002", "body": "x" * (server.MAX_COMMENT + 1), "name": "n"}))


class RobotBodyTest(unittest.TestCase):
    def test_appends_the_official_closing_once(self):
        once = server.robot_body("设计方案如下")
        self.assertIn(server.RULE, once)
        self.assertEqual(server.robot_body(once), once, "已经有尾巴时不重复追加")


class FoldTest(unittest.TestCase):
    def test_folds_issue_comment_and_status_into_one_item(self):
        items = server.fold([
            issue_event(at=100),
            {"t": "comment", "issue": "F-001", "body": "b", "name": "访客-2", "at": 200},
            {"t": "status", "issue": "F-001", "status": "done", "at": 300},
        ])
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["status"], "done", "状态事件覆盖初始的 open")
        self.assertEqual([c["body"] for c in item["comments"]], ["b"])
        self.assertEqual(item["last"], 300, "最后活动时间取最晚的那个事件")

    def test_sorts_by_last_activity_descending(self):
        items = server.fold([
            issue_event("F-001", at=100),
            issue_event("F-002", at=200),
            {"t": "comment", "issue": "F-001", "body": "b", "name": "n", "at": 300},
        ])
        self.assertEqual([item["id"] for item in items], ["F-001", "F-002"], "有新评论的浮到最前")

    def test_ignores_events_for_unknown_issues_and_duplicate_ids(self):
        items = server.fold([
            {"t": "comment", "issue": "F-999", "body": "b", "name": "n", "at": 1},
            issue_event("F-001", at=100, title="first"),
            issue_event("F-001", at=150, title="dup"),
            {"t": "status", "issue": "F-999", "status": "done", "at": 2},
        ])
        self.assertEqual(len(items), 1, "指向不存在条目的评论/状态要丢掉")
        self.assertEqual(items[0]["title"], "first", "重复 id 只认第一条")

    def test_ignores_bad_rows(self):
        items = server.fold([None, "x", {"t": "issue"}, {"t": "nope"}, issue_event("F-001", at=100)])
        self.assertEqual([item["id"] for item in items], ["F-001"])

    def test_rejects_unknown_status_values(self):
        items = server.fold([issue_event(at=100), {"t": "status", "issue": "F-001", "status": "pending", "at": 200}])
        self.assertEqual(items[0]["status"], "open", "「待处理」不是合法状态，不该进公开板")


class NextIdTest(unittest.TestCase):
    def _store(self, events):
        path = os.path.join(temp_dir(), "feedback.jsonl")
        self.addCleanup(remove_dir, os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as handle:
            for event in events:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        return server.Store(path)

    def test_next_id_continues_from_the_biggest_existing(self):
        store = self._store([issue_event("F-001"), issue_event("F-007")])
        self.assertEqual(store.next_issue_id(), "F-008", "按最大值往后取，删过条目也不撞号")

    def test_next_id_starts_at_one_on_empty_log(self):
        self.assertEqual(self._store([]).next_issue_id(), "F-001")

    def test_append_then_read_round_trips(self):
        store = self._store([])
        self.assertTrue(store.write(issue_event("F-001", at=100)))
        items = store.issues()
        self.assertEqual([item["id"] for item in items], ["F-001"])
        # 重新开一个实例读同一个文件：证明写盘是真落了，不是只在内存里。
        self.assertEqual([item["id"] for item in server.Store(store.path).issues()], ["F-001"])

    def test_concurrent_issue_creation_never_reuses_an_id(self):
        # 这是真实的并发场景（公开端点，多个用户同时提交）。曾经的写法是
        # "先 next_issue_id() 再 write()"两步走，中间有窗口 —— 两个请求会拿到同一个
        # 编号，而 fold() 对重复 id 只认第一条，于是后一条需求**静默消失**。
        # 这里用真线程压一把，断言编号既不重复、也不丢条目。
        store = self._store([])
        results, errors = [], []
        barrier = threading.Barrier(8)

        def submit(index):
            try:
                barrier.wait(timeout=5)
                event = store.add_issue({"kind": "new", "title": f"第 {index} 条", "detail": "d", "name": "访客-1"}, at=index)
                results.append(event)
            except Exception as error:  # noqa: BLE001 - 测试里要看到任何异常
                errors.append(error)

        threads = [threading.Thread(target=submit, args=(i,)) for i in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(errors, [], "并发提交不该抛异常")
        ids = [event["id"] for event in results]
        self.assertEqual(len(ids), 8, "每条提交都要拿到编号")
        self.assertEqual(len(set(ids)), 8, f"编号撞了：{sorted(ids)}")
        folded = store.issues()
        self.assertEqual(len(folded), 8, "fold 之后不能少于实际提交数（丢条目就是这里暴露的）")


class HttpTest(unittest.TestCase):
    """起真服务，钉端点行为与「一切都无需凭证」。"""

    @classmethod
    def setUpClass(cls):
        cls._dir = temp_dir()
        cls._old_dir, cls._old_store = server.DATA_DIR, server.STORE
        server.DATA_DIR = cls._dir
        server.LOG_FILE = os.path.join(cls._dir, "feedback.jsonl")
        server.STORE = server.Store(server.LOG_FILE)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.DATA_DIR, server.STORE = cls._old_dir, cls._old_store
        remove_dir(cls._dir)

    def call(self, path, payload=None, method=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(f"{self.base}{path}", data=data, method=method or ("POST" if data else "GET"))
        request.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode())

    def test_post_issue_assigns_an_id_and_returns_it(self):
        status, body = self.call("/feedback", {"kind": "new", "title": "第一条", "detail": "d", "name": "访客-1"})
        self.assertEqual(status, 200)
        self.assertTrue(body["issue"]["id"].startswith("F-"))
        self.assertEqual(body["issue"]["status"], "open")

    def test_comment_requires_an_existing_issue(self):
        status, _ = self.call("/feedback/comment", {"issue": "F-999", "body": "b", "name": "访客-2"})
        self.assertEqual(status, 404)

    def test_comment_lands_on_the_issue(self):
        _, created = self.call("/feedback", {"kind": "new", "title": "要被评论的", "detail": "d", "name": "访客-1"})
        iid = created["issue"]["id"]
        status, _ = self.call("/feedback/comment", {"issue": iid, "body": "我也想要", "name": "访客-2"})
        self.assertEqual(status, 200)
        _, listing = self.call("/feedback")
        item = next(i for i in listing["issues"] if i["id"] == iid)
        self.assertEqual([c["name"] for c in item["comments"]], ["访客-2"])

    def test_robot_reply_is_public_and_marked(self):
        # **不带任何凭证**就能以机器人身份回帖 —— 这是刻意的（demo 级反馈板，
        # 「谁想处理评论都行」优先）。不设令牌参数正是这条测试要证明的事。
        _, created = self.call("/feedback", {"kind": "new", "title": "等机器人", "detail": "d", "name": "访客-1"})
        iid = created["issue"]["id"]
        status, body = self.call("/feedback/robot", {"issue": iid, "body": "方案"})
        self.assertEqual(status, 200, "回帖不该需要凭证")
        self.assertTrue(body["comment"]["robot"], "机器人回帖要带 robot 标记")
        self.assertEqual(body["comment"]["name"], server.ROBOT_NAME)
        self.assertIn(server.RULE, body["comment"]["body"], "尾巴由服务端统一追加")

    def test_status_change_is_public(self):
        _, created = self.call("/feedback", {"kind": "new", "title": "要被推进的", "detail": "d", "name": "访客-1"})
        iid = created["issue"]["id"]
        self.assertEqual(self.call("/feedback/status", {"issue": iid, "status": "declined"})[0], 200, "推进状态也不该需要凭证")
        _, listing = self.call("/feedback")
        self.assertEqual(next(i for i in listing["issues"] if i["id"] == iid)["status"], "declined")

    def test_robot_reply_still_validates_its_input(self):
        # 放开权限不等于放开校验：坏编号 / 空正文 / 不存在的条目都还要拦住。
        _, created = self.call("/feedback", {"kind": "new", "title": "校验", "detail": "d", "name": "访客-1"})
        iid = created["issue"]["id"]
        self.assertEqual(self.call("/feedback/robot", {"issue": "bad-id", "body": "b"})[0], 400)
        self.assertEqual(self.call("/feedback/robot", {"issue": iid, "body": "   "})[0], 400)
        self.assertEqual(self.call("/feedback/robot", {"issue": "F-999", "body": "b"})[0], 404)
        self.assertEqual(self.call("/feedback/robot", {"issue": iid, "body": "b", "extra": 1})[0], 400, "白名单外字段照旧拒收")

    def test_health_reports_counts(self):
        status, body = self.call("/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("issues", body)

    def test_no_endpoint_asks_for_a_token(self):
        # 反过来钉住"没有任何凭证门"：曾经机器人/状态两条路径要令牌，
        # 结果是「拿到 skill 也用不了」。现在谁都该能调。
        for path, payload in (
            ("/feedback/robot", {"issue": "F-001", "body": "x"}),
            ("/feedback/status", {"issue": "F-001", "status": "done"}),
        ):
            with self.subTest(path=path):
                status, _ = self.call(path, payload)
                self.assertNotIn(status, (401, 403, 503), f"{path} 不该有权限门")


if __name__ == "__main__":
    unittest.main()
