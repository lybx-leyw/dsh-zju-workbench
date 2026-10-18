"""
中转站的**对抗性**检查：假设攻击者知道协议，能拿到对方没有的密钥之外的一切。

这里不是功能性测试，而是逐条打"能不能绕过密钥"这件事。每条用例都对应一种
真实攻击手法，而不是"顺手多写一个 assert"：

  * 缺密钥 / 空密钥 / 错密钥 / 大小写变形 / 前后空格
  * 用另一把密钥去开这一侧（读写越权）
  * 头部重复、用 `Authorization` 冒充（平台占用该头，服务端不该认）
  * 路径变形：尾部斜杠、大小写、双重前缀、路径穿越、URL 编码
  * 查询串注入（`since` 不该成为绕过口）
  * 方法变形：HEAD / PUT / DELETE / 自定义方法
  * `null` / `undefined` 语义：配置为空时是否变成"谁都能过"
"""
import importlib.util
import json
import shutil
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "relay_service_adv", HERE.parent / "deploy" / "relay-service" / "server.py"
)
relay = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(relay)

WRITE_KEY = "the-write-key"
READ_KEY = "the-read-key"
_counter = iter(range(10_000))


class AdversarialBase(unittest.TestCase):
    def setUp(self):
        self._root = HERE.parent / ".verify-scratch" / f"relay-adv-{next(_counter)}"
        self._root.mkdir(parents=True, exist_ok=True)
        self.server = relay.make_server(0, relay.Store(self._root / "e.jsonl"), WRITE_KEY, READ_KEY)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.port}"
        # 先塞一条"机密"，后续所有绕过尝试都是为了读到它
        self.raw("POST", "/entries", {"kind": "diary", "title": "机密内容", "text": "不该被读到"},
                 headers={"X-Zy-Write-Key": WRITE_KEY})

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        shutil.rmtree(self._root, ignore_errors=True)

    def raw(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        h = {"content-type": "application/json"}
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8", "replace")

    def assert_no_leak(self, status, body, label):
        """无论返回什么状态码，正文里都不能出现机密内容。"""
        self.assertNotIn("机密内容", body, f"{label}: 响应泄露了条目内容")
        self.assertNotIn("不该被读到", body, f"{label}: 响应泄露了条目正文")


class MissingKeyTest(AdversarialBase):
    """没有密钥的一切形态都必须读不到。"""

    def test_no_header(self):
        s, b = self.raw("GET", "/entries")
        self.assertEqual(s, 404)
        self.assert_no_leak(s, b, "无密钥")

    def test_empty_header(self):
        s, b = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": ""})
        self.assertEqual(s, 404)
        self.assert_no_leak(s, b, "空密钥")

    def test_whitespace_only(self):
        s, b = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": "   "})
        self.assertEqual(s, 404)
        self.assert_no_leak(s, b, "纯空格")

    def test_null_like_strings(self):
        for value in ("null", "None", "undefined", "0", "false"):
            s, b = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": value})
            self.assertEqual(s, 404, f"值 {value} 不该通过")
            self.assert_no_leak(s, b, f"值 {value}")


class WrongKeyTest(AdversarialBase):
    """错误密钥的各种变形。"""

    def test_trailing_padding_and_case(self):
        for value in (f"{READ_KEY} ", f"{READ_KEY}  ", READ_KEY.upper(), READ_KEY[:-1], READ_KEY + "x"):
            s, b = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": value})
            self.assertEqual(s, 404, f"{value!r} 不该通过")
            self.assert_no_leak(s, b, repr(value))

    def test_leading_whitespace_is_stripped_by_http_not_by_us(self):
        """前导空白由 HTTP 层剥掉，不是服务端宽松比较。

        实测：客户端发 `' the-read-key'`，服务端 `self.headers` 里收到的已经是
        `'the-read-key'`。这是 RFC 9110 对字段值 OWS 的规定，任何 HTTP 服务都一样，
        而攻击者要触发它必须**本来就握有正确密钥**，因此不构成越权。
        尾部空白不会被剥（实测返回 404），断言据此写成"只剩两侧行为"。
        """
        s, _ = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": f" {READ_KEY}"})
        self.assertEqual(s, 200, "前导空白被 HTTP 层规范化，这是协议行为而非鉴权缺陷")
        s, _ = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": f"{READ_KEY} "})
        self.assertEqual(s, 404, "尾随空白不被剥离，必须拒绝")

    def test_prefix_of_real_key(self):
        # 常量时间比较不能退化成 startswith
        for n in range(1, len(READ_KEY)):
            s, _ = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": READ_KEY[:n]})
            self.assertEqual(s, 404, f"前缀 {READ_KEY[:n]!r} 不该通过")


class CrossKeyTest(AdversarialBase):
    """两把密钥不能互相顶替 —— 这是整个模板的核心承诺。"""

    def test_write_key_cannot_read(self):
        s, b = self.raw("GET", "/entries", headers={"X-Zy-Read-Key": WRITE_KEY})
        self.assertEqual(s, 404)
        self.assert_no_leak(s, b, "写密钥读")

    def test_read_key_cannot_write(self):
        s, _ = self.raw("POST", "/entries", {"kind": "note", "title": "t", "text": "x"},
                        headers={"X-Zy-Write-Key": READ_KEY})
        self.assertEqual(s, 404)

    def test_both_headers_still_only_grant_their_side(self):
        # 同时带上两把：读接口只认 read，写接口只认 write
        both = {"X-Zy-Read-Key": READ_KEY, "X-Zy-Write-Key": WRITE_KEY}
        self.assertEqual(self.raw("GET", "/entries", headers=both)[0], 200)
        s, _ = self.raw("POST", "/entries", {"kind": "note", "title": "t", "text": "x"},
                        headers={"X-Zy-Read-Key": READ_KEY, "X-Zy-Write-Key": "wrong"})
        self.assertEqual(s, 404)


class HeaderTrickTest(AdversarialBase):
    """用平台占用或被别处信任的头来冒充。"""

    def test_authorization_header_is_ignored(self):
        for value in (f"Bearer {READ_KEY}", f"Basic {READ_KEY}", READ_KEY, f"oauth2:{READ_KEY}"):
            s, b = self.raw("GET", "/entries", headers={"Authorization": value})
            self.assertEqual(s, 404, f"Authorization {value!r} 不该通过")
            self.assert_no_leak(s, b, "Authorization 冒充")

    def test_platform_headers_are_ignored(self):
        for name in ("X-modelscope-user", "X-studio-id", "X-Zy-Read-Key "):
            s, _ = self.raw("GET", "/entries", headers={name: READ_KEY})
            self.assertEqual(s, 404, f"{name} 不该通过")

    def test_wrong_header_name(self):
        for name in ("X-Zy-Readkey", "X-Zy-Read-Key-", "X-Zy-Key", "Zy-Read-Key"):
            s, _ = self.raw("GET", "/entries", headers={name: READ_KEY})
            self.assertEqual(s, 404, f"{name} 不该通过")


class PathTrickTest(AdversarialBase):
    """路径变形不该让路由落到"无保护分支"上。"""

    def test_trailing_slash_needs_key(self):
        s, b = self.raw("GET", "/entries/")
        self.assertEqual(s, 404)
        self.assert_no_leak(s, b, "/entries/")

    def test_case_variants(self):
        for path in ("/ENTRIES", "/Entries", "/entries%2f", "/./entries", "/entries/../entries"):
            s, b = self.raw("GET", path)
            self.assertIn(s, (404, 400), f"{path} 不该返回数据")
            self.assert_no_leak(s, b, path)

    def test_gateway_prefix_does_not_bypass(self):
        # 剥前缀是为了命中业务路由，不是为了绕过校验
        for path in ("/invoke/entries", "/config/entries"):
            s, b = self.raw("GET", path)
            self.assertEqual(s, 404, f"{path} 无密钥不该通过")
            self.assert_no_leak(s, b, path)

    def test_double_prefix(self):
        s, _ = self.raw("GET", "/invoke/invoke/entries")
        self.assertEqual(s, 404)


class QueryTrickTest(AdversarialBase):
    """查询串不能成为绕过口。"""

    def test_since_without_key(self):
        for q in ("?since=0", "?since=-1", "?since=999999", "?since=abc", "?key=the-read-key"):
            s, b = self.raw("GET", "/entries" + q)
            self.assertEqual(s, 404, f"{q} 无密钥不该通过")
            self.assert_no_leak(s, b, q)

    def test_since_negative_with_valid_key_returns_all(self):
        s, body = self.raw("GET", "/entries?since=-1", headers={"X-Zy-Read-Key": READ_KEY})
        self.assertEqual(s, 200)
        data = json.loads(body)
        self.assertEqual(data["count"], 1, "since=-1 应等价于取全部")


class MethodTrickTest(AdversarialBase):
    """非预期方法不该落到能读数据的处理函数。"""

    def test_unexpected_methods(self):
        for method in ("HEAD", "PUT", "DELETE", "PATCH"):
            s, b = self.raw(method, "/entries", headers={"X-Zy-Read-Key": READ_KEY})
            self.assertNotEqual(s, 200, f"{method} 不该返回成功")
            self.assert_no_leak(s, b, method)


class EmptyConfigTest(unittest.TestCase):
    """配置为空时必须是"全拒"，不能是"全放"。"""

    def test_key_matches_rejects_when_expected_missing(self):
        self.assertFalse(relay.key_matches("anything", ""))
        self.assertFalse(relay.key_matches("", ""))
        self.assertFalse(relay.key_matches(None, ""))

    def test_key_matches_rejects_when_given_missing(self):
        self.assertFalse(relay.key_matches(None, READ_KEY))
        self.assertFalse(relay.key_matches("", READ_KEY))

    def test_env_reader_ignores_blank(self):
        import os
        os.environ["RELAY_TEST_BLANK"] = "   "
        try:
            self.assertEqual(relay.read_key_env("RELAY_TEST_BLANK"), "", "空白值应视为未配置")
        finally:
            del os.environ["RELAY_TEST_BLANK"]


if __name__ == "__main__":
    unittest.main()
