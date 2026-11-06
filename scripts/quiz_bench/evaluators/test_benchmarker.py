"""Protocol tests only; judge responses are controlled, not quality labels."""
import asyncio
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import benchmarker as bridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        # Every temporary cleanup target is resolved beneath the workspace's
        # ignored artifacts directory; no external paths or junctions are used.
        artifact_root = (bridge.WORKSPACE / "artifacts").resolve()
        artifact_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=artifact_root)
        self.directory = Path(self.temp.name).resolve()
        assert self.directory.is_relative_to(artifact_root)
        self.addCleanup(self.temp.cleanup)

    def question_file(self, rows):
        filename = self.directory / "questions.json"
        filename.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return filename

    def example(self):
        return {"label": "private-algorithm-identity", "type": "mcq", "stem": "2+2是多少？",
                "choices": [{"label": "x", "text": "4"}, {"label": "y", "text": "5"}],
                "answer": "x", "explanation": "private rationale", "sound": False}

    def test_vendor_is_byte_identical(self):
        lock = bridge.verify_vendor()
        self.assertEqual(lock["license"], "MIT")
        self.assertEqual(len(lock["files"]), 9)

    def test_input_mapping_strips_algorithm_and_audit(self):
        filename = self.question_file([self.example(), {"type": "shortAnswer"}])
        questions, skipped, mapping = bridge.load_questions(filename)
        self.assertEqual(questions[0]["target"], "A")
        self.assertEqual(questions[0]["choices"], "A) 4\nB) 5")
        self.assertEqual(len(skipped), 1)
        self.assertNotIn("private", json.dumps(questions))
        self.assertEqual(mapping[0]["label"], "private-algorithm-identity")

    def test_invalid_mcq_does_not_silently_disappear(self):
        row = self.example()
        row["answer"] = "missing"
        with self.assertRaises(ValueError):
            bridge.load_questions(self.question_file([row]))

    def test_prompts_use_all_native_rules_without_unfilled_slots(self):
        questions, _, _ = bridge.load_questions(self.question_file([self.example()]))
        prompts = bridge.render_prompts(questions[0])
        self.assertEqual(len(prompts), 19)
        self.assertEqual(len({p["rule"] for p in prompts}), 19)
        self.assertIn("single_best_answer", [p["rule"] for p in prompts])
        self.assertTrue(all("{question}" not in p["prompt"] for p in prompts))
        self.assertIn("2+2是多少？", prompts[0]["prompt"])

    def test_prepare_has_no_judge_dependency_or_credentials(self):
        filename = self.question_file([self.example()])
        out = self.directory / "prepared"
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            status = bridge.main(["--input", str(filename), "--out", str(out)])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(stdout.getvalue())["networkRequests"], 0)
        self.assertFalse((out / "calls.jsonl").exists())
        with self.assertRaises(ValueError):
            bridge.safe_output(out)
        with self.assertRaises(ValueError):
            bridge.safe_output(bridge.WORKSPACE / "scripts" / "unexpected-output")

    def test_run_requires_explicit_judge(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                bridge.main(["--input", "unused", "--out", "unused", "--run"])
        self.assertEqual(result.exception.code, 2)

    def native(self):
        bridge.upstream_modules()
        from inspect_ai.scorer import Target
        from scorers import writing_flaws_scorer as writing
        from scorers import shortcut_scorer as shortcut
        return Target, writing, shortcut

    def test_native_writing_scorer_preserves_19_rule_score(self):
        Target, writing, _ = self.native()
        answers = [{"result": "fail" if i == 0 else "pass", "explanation": "controlled", "confidence": 8} for i in range(19)]
        class Judge:
            async def generate(self, prompt):
                return SimpleNamespace(completion=json.dumps(answers.pop(0)))
        state = SimpleNamespace(sample_id="q", metadata={"question": "Q?", "choices": "A) a\nB) b", "target": "A"})
        with patch.object(writing, "get_model", return_value=Judge()):
            score = asyncio.run(writing.writing_flaws_scorer(model="explicit")(state, Target("A")))
        result = bridge.guarded_score("writing_flaws", score)
        self.assertEqual(result["status"], "completed")
        self.assertAlmostEqual(result["value"], 18/19)
        self.assertEqual(len(score.metadata["writing_flaws"]), 1)
        self.assertEqual(answers, [])

    def test_native_parse_exhaustion_is_unknown_not_pass(self):
        Target, writing, _ = self.native()
        class Judge:
            calls = 0
            async def generate(self, prompt):
                self.calls += 1
                return SimpleNamespace(completion="invalid response")
        judge = Judge()
        state = SimpleNamespace(sample_id="q", metadata={"question": "Q?", "choices": "A) a\nB) b", "target": "A"})
        with patch.object(writing, "get_model", return_value=judge):
            score = asyncio.run(writing.writing_flaws_scorer(model="explicit")(state, Target("A")))
        self.assertEqual(judge.calls, 57)
        self.assertEqual(score.value, 1)
        self.assertIsNone(bridge.guarded_score("writing_flaws", score)["value"])

    def test_native_shortcut_parse_exhaustion_is_unknown(self):
        Target, _, shortcut = self.native()
        class Judge:
            async def generate(self, prompt):
                return SimpleNamespace(completion="invalid response")
        state = SimpleNamespace(sample_id="q", metadata={"question": "Q?", "choices_list": ["a", "b"], "target": "A"})
        with patch.object(shortcut, "get_model", return_value=Judge()), contextlib.redirect_stdout(io.StringIO()):
            score = asyncio.run(shortcut.shortcut_scorer(model="explicit")(state, Target("A")))
        self.assertEqual(score.value, 1)
        self.assertEqual(bridge.guarded_score("shortcuts", score)["status"], "error")

    def test_native_shortcut_two_stage_result_is_preserved(self):
        Target, _, shortcut = self.native()
        replies = [{"answer": "A", "question": "inferred Q?", "explanation": "controlled"},
                   {"decision": "no_match", "explanation": "a shortcut"}]
        class Judge:
            async def generate(self, prompt):
                return SimpleNamespace(completion=json.dumps(replies.pop(0)))
        state = SimpleNamespace(sample_id="q", metadata={"question": "Q?", "choices_list": ["a", "b"], "target": "A"})
        with patch.object(shortcut, "get_model", return_value=Judge()):
            score = asyncio.run(shortcut.shortcut_scorer(model="explicit")(state, Target("A")))
        self.assertEqual(bridge.guarded_score("shortcuts", score)["value"], 0)
        self.assertEqual(replies, [])

    def test_transport_failure_escapes_native_retry_loop_and_redacts(self):
        Target, writing, _ = self.native()
        class BrokenJudge:
            async def generate(self, prompt):
                raise RuntimeError("private credential body")
        observer = bridge.ObservedJudge(BrokenJudge(), self.directory)
        state = SimpleNamespace(sample_id="q", metadata={"question": "Q?", "choices": "A) a\nB) b", "target": "A"})
        with patch.object(writing, "get_model", return_value=observer):
            with self.assertRaises(bridge.EvaluationAborted):
                asyncio.run(writing.writing_flaws_scorer(model="explicit")(state, Target("A")))
        self.assertEqual(observer.attempts, 1)
        self.assertEqual(observer.accounting()["unknownUsageAttempts"], 1)
        self.assertNotIn("private credential", (self.directory / "calls.jsonl").read_text())

    def test_native_sdk_http_roundtrip_without_paid_requests(self):
        # Exercise the real pinned SDK, native scorer and our input bridge.
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append(body)
                completion = json.dumps({"result": "pass", "confidence": 8, "explanation": "controlled"})
                response = {"id": "offline-fixture", "object": "chat.completion", "created": 1, "model": "quiz-judge",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": completion}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}}
                payload = json.dumps(response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            args = SimpleNamespace(judge="openai-api/offline/quiz-judge", key_env="QUIZ_OFFLINE_TEST_KEY",
                base_url=f"http://127.0.0.1:{server.server_port}/v1", workers=2, max_tokens=1024,
                timeout=10, metrics=["writing_flaws"], thinking="disabled")
            questions, _, _ = bridge.load_questions(self.question_file([self.example()]))
            with patch.dict("os.environ", {"QUIZ_OFFLINE_TEST_KEY": "offline-test-value"}):
                summary = asyncio.run(bridge.evaluate(questions, args, self.directory))
            self.assertEqual(summary["status"], "completed")
            self.assertEqual(len(requests), 19)
            self.assertTrue(all("response_format" not in r for r in requests))
            self.assertTrue(all(r.get("thinking") == {"type": "disabled"} for r in requests))
            self.assertEqual(summary["thinking"], "disabled")
            self.assertEqual(summary["tokens"]["totalTokensKnown"], 342)
            self.assertEqual(summary["tokens"]["unknownUsageAttempts"], 0)
            records = [json.loads(line) for line in (self.directory / "calls.jsonl").read_text().splitlines()]
            self.assertEqual(sum(r["status"] == "started" for r in records), 19)
            self.assertTrue(all("stopReason" in r for r in records if r["status"] == "completed"))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
