"""
中转站（`deploy/relay-service/server.py`）的权限与存储契约。

这里**起真服务、打真端口**，因为被钉住的行为正好在 HTTP 层：读密钥能不能写、
写密钥能不能读、未授权是不是 404 而不是 403。只测纯函数的话，这几条一条都测不到。

刻意不做的事：
  * 不连线上创空间 —— 端到端验证见 README 的"验证"一节，需要真实域名与密钥；
  * 不等待真实网络 —— 全部打 127.0.0.1 的临时端口。
"""
import importlib.util
import itertools
import json
import os
import shutil
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

_COUNTER = itertools.count()

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "relay_service", HERE.parent / "deploy" / "relay-service" / "server.py"
)
relay = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(relay)

WRITE_KEY = "w-test-key"
READ_KEY = "r-test-key"


class RelayCase(unittest.TestCase):
    """每个用例一台干净的服务 + 一个临时落盘文件。"""

    def setUp(self):
        # 沙箱把系统临时目录的一部分设成了不可删，cleanup() 会抛 PermissionError。
        # 用仓库内的 .verify-scratch 作根，并自己负责清理：删不掉不算测试失败。
        self._root = HERE.parent / ".verify-scratch" / f"relay-{next(_COUNTER)}"
        self._root.mkdir(parents=True, exist_ok=True)
        self.store_path = self._root / "entries.jsonl"
        self.server = relay.make_server(0, relay.Store(self.store_path), WRITE_KEY, READ_KEY)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        shutil.rmtree(self._root, ignore_errors=True)  # 删不掉不算失败

    # --- 便捷方法 ---------------------------------------------------------

    def call(self, method, path, body=None, write=None, read=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"content-type": "application/json"}
        if write is not None:
            headers["X-Zy-Write-Key"] = write
        if read is not None:
            headers["X-Zy-Read-Key"] = read
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            return err.code, json.loads(raw) if raw else {}

    def call_raw(self, method, path, body=None, write=None, read=None):
        """返回原始响应体。首页是 HTML，不能按 JSON 解析。"""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"content-type": "application/json"}
        if write is not None:
            headers["X-Zy-Write-Key"] = write
        if read is not None:
            headers["X-Zy-Read-Key"] = read
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8")

    def post_entry(self, **overrides):
        body = {"kind": "diary", "title": "今天的记录", "text": "写了一点东西", "tags": ["plan"]}
        body.update(overrides)
        return self.call("POST", "/entries", body, write=WRITE_KEY)


class PermissionTest(RelayCase):
    """两个密钥职责不相交 —— 本文件的核心断言。"""

    def test_write_key_cannot_read(self):
        self.post_entry()
        status, _ = self.call("GET", "/entries", write=WRITE_KEY)
        self.assertEqual(status, 404, "写密钥必须读不到数据")

    def test_read_key_cannot_write(self):
        status, _ = self.call("POST", "/entries", {"kind": "note", "title": "t", "text": "x"}, read=READ_KEY)
        self.assertEqual(status, 404, "读密钥必须写不进去")

    def test_unauthorized_is_404_not_403(self):
        # 403 等于告诉扫描器"这里有个入口"，本服务一律 404
        self.assertEqual(self.call("GET", "/entries")[0], 404)
        self.assertEqual(self.call("GET", "/entries", read="wrong")[0], 404)
        self.assertEqual(self.call("POST", "/entries", {}, write="wrong")[0], 404)

    def test_health_needs_no_key(self):
        status, payload = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])

    def test_health_hides_count_without_key(self):
        """条数是元数据：匿名者不该据此推断"这人有没有数据、有多少"。"""
        self.post_entry()
        status, payload = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertNotIn("count", payload, "匿名健康检查不得回条数")

        status, payload = self.call("GET", "/health", read=READ_KEY)
        self.assertEqual(payload["count"], 1, "带读密钥时应能自查条数")

    def test_read_with_read_key(self):
        self.post_entry()
        status, payload = self.call("GET", "/entries", read=READ_KEY)
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["entries"][0]["title"], "今天的记录")


class StorageTest(RelayCase):
    """只追加、不改不删；seq 连续且可用于增量拉取。"""

    def test_seq_is_monotonic_and_since_filters(self):
        for i in range(3):
            self.post_entry(title=f"第{i}条")
        _, payload = self.call("GET", "/entries", read=READ_KEY)
        self.assertEqual([e["seq"] for e in payload["entries"]], [1, 2, 3])

        _, payload = self.call("GET", "/entries?since=2", read=READ_KEY)
        self.assertEqual([e["seq"] for e in payload["entries"]], [3])

    def test_append_does_not_rewrite_history(self):
        self.post_entry(title="第一条")
        first = self.store_path.read_text(encoding="utf-8")
        self.post_entry(title="第二条")
        after = self.store_path.read_text(encoding="utf-8")
        self.assertTrue(after.startswith(first), "旧行必须逐字保留")

    def test_half_written_line_does_not_break_reading(self):
        self.post_entry()
        with self.store_path.open("a", encoding="utf-8") as fh:
            fh.write('{"kind": "note", "title": "断')  # 模拟写到一半断电
        status, payload = self.call("GET", "/entries", read=READ_KEY)
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1, "坏行应被跳过，而不是让整个服务读不出来")


class ValidationTest(RelayCase):
    """字段白名单与上限。两端漂移的表现是"用户填得好好的却提交失败"。"""

    def test_unknown_field_is_rejected(self):
        status, _ = self.post_entry(realName="张三")
        self.assertEqual(status, 400, "白名单外的字段必须直接拒绝，不能静默丢弃")

    def test_identity_fields_are_not_whitelisted(self):
        for field in ("name", "studentId", "email", "ip"):
            self.assertNotIn(field, relay.ALLOWED_FIELDS)

    def test_kind_must_be_known(self):
        self.assertEqual(self.post_entry(kind="whatever")[0], 400)

    def test_empty_title_or_text_rejected(self):
        self.assertEqual(self.post_entry(title="  ")[0], 400)
        self.assertEqual(self.post_entry(text="")[0], 400)

    def test_overlong_text_rejected(self):
        self.assertEqual(self.post_entry(text="x" * (relay.MAX_TEXT + 1))[0], 400)

    def test_tags_are_bounded_and_safe(self):
        self.assertEqual(self.post_entry(tags=["ok-1"])[0], 201)
        self.assertEqual(self.post_entry(tags=["带空格 的"])[0], 400)
        self.assertEqual(self.post_entry(tags=["a"] * (relay.MAX_TAGS + 1))[0], 400)

    def test_at_defaults_to_now(self):
        status, payload = self.post_entry()
        self.assertEqual(status, 201)
        self.assertGreater(payload["entry"]["at"], 0)

    def test_store_full_returns_507(self):
        # 直接写满上限太慢，改小上限跑一轮
        original = relay.MAX_ENTRIES
        relay.MAX_ENTRIES = 2
        try:
            self.assertEqual(self.post_entry(title="a")[0], 201)
            self.assertEqual(self.post_entry(title="b")[0], 201)
            self.assertEqual(self.post_entry(title="c")[0], 507, "写满后应拒绝新条目")
        finally:
            relay.MAX_ENTRIES = original


class GatewayPrefixTest(RelayCase):
    """创空间网关会先打 `/invoke`、`/config` 再跑到我们的路径。

    这组用例来自线上踩坑：本地直连端口时一切正常，上到创空间后所有请求都变成
    `POST /invoke` → 404。只测本地路径永远发现不了，所以把前缀剥离单独立成一组。
    """

    def test_strips_invoke_prefix_for_write(self):
        status, payload = self.call(
            "POST", "/invoke/entries", {"kind": "note", "title": "经网关", "text": "x"}, write=WRITE_KEY
        )
        self.assertEqual(status, 201)
        self.assertEqual(payload["entry"]["title"], "经网关")

    def test_strips_invoke_prefix_for_read(self):
        self.post_entry()
        status, payload = self.call("GET", "/invoke/entries", read=READ_KEY)
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1)

    def test_strips_config_prefix(self):
        status, _ = self.call("GET", "/config/health")
        self.assertEqual(status, 200, "平台探测的 /config 前缀也要能落到 /health")

    def test_bare_prefix_maps_to_root(self):
        # 光秃秃的 /invoke 不该被当成 /entries
        self.assertEqual(self.call("POST", "/invoke", {}, write=WRITE_KEY)[0], 404)

    def test_unknown_path_still_404(self):
        self.assertEqual(self.call("GET", "/invoke/whatever", read=READ_KEY)[0], 404)

    def test_landing_page_lists_no_data(self):
        """域名是给人点开的：要有说明页，但绝不能顺带把已有数据吐出来。"""
        self.post_entry(title="不该出现在首页的秘密")
        status, html = self.call_raw("GET", "/")
        self.assertEqual(status, 200)
        self.assertNotIn("不该出现在首页的秘密", html, "首页不得泄露任何条目内容")
        self.assertIn("X-Zy-Read-Key", html, "首页应说明读接口需要密钥")


class BootstrapTest(unittest.TestCase):
    """没配密钥就不该起服务 —— 敞开的数据源可能几个月都没人发现。"""

    def test_key_comparison_handles_missing_config(self):
        self.assertFalse(relay.key_matches("anything", ""), "未配密钥时必须一律拒绝")
        self.assertFalse(relay.key_matches(None, READ_KEY))
        self.assertTrue(relay.key_matches(READ_KEY, READ_KEY))

    def test_clean_entry_returns_none_for_garbage(self):
        self.assertIsNone(relay.clean_entry("不是对象"))
        self.assertIsNone(relay.clean_entry({"kind": "note"}))  # 缺 title/text


if __name__ == "__main__":
    unittest.main()
