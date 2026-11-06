"""Run unmodified upstream scorers on local quiz artifacts, outside the product.

Default mode prepares inputs without network access. --run explicitly enables
the judge. Source and prompt hashes are verified before importing vendor code.
"""
import argparse
import asyncio
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]
VENDOR = HERE / "vendor" / "benchmarker"
sys.dont_write_bytecode = True


def verify_vendor():
    lock = json.loads((HERE / "vendor.lock.json").read_text(encoding="utf-8"))
    for name, expected in lock["files"].items():
        actual = hashlib.sha256((VENDOR / name).read_bytes()).hexdigest()
        if actual != expected["sha256"]:
            raise ValueError(f"Vendor hash mismatch: {name}")
    return lock


def load_questions(filename):
    text = Path(filename).read_text(encoding="utf-8-sig")
    rows = ([json.loads(line) for line in text.splitlines() if line.strip()]
            if str(filename).endswith(".jsonl") else json.loads(text))
    if not isinstance(rows, list):
        raise ValueError("Input must be a JSON array or JSONL of questions")
    questions, skipped, mapping = [], [], []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"Row {index}: expected an object")
        if row.get("type", "mcq") != "mcq" or row.get("delivered") is False:
            skipped.append({"row": index, "reason": "not a delivered MCQ"})
            continue
        stem, choices = row.get("stem", row.get("question")), row.get("choices")
        if not isinstance(stem, str) or not stem.strip():
            raise ValueError(f"Row {index}: missing question stem")
        if not isinstance(choices, list) or not 2 <= len(choices) <= 26:
            raise ValueError(f"Row {index}: expected 2-26 choices")
        labels, values = [], []
        for i, choice in enumerate(choices):
            labels.append(choice.get("label", chr(65+i)) if isinstance(choice, dict) else chr(65+i))
            values.append(choice.get("text") if isinstance(choice, dict) else choice)
        if (len(set(labels)) != len(labels)
                or any(not isinstance(v, str) or not v.strip() for v in values)
                or row.get("answer") not in labels):
            raise ValueError(f"Row {index}: invalid choices or answer label")
        answer = chr(65 + labels.index(row["answer"]))
        # Judge inputs contain no algorithm name, prior audit score or rationale.
        payload = {"question": stem, "choices_list": values,
                   "choices": "\n".join(f"{chr(65+i)}) {v}" for i, v in enumerate(values)),
                   "target": answer}
        identity = hashlib.sha256(json.dumps([index, payload], ensure_ascii=False).encode()).hexdigest()
        questions.append({"id": identity, **payload})
        mapping.append({"id": identity, "row": index, "label": row.get("label", row.get("id")),
                        "originalChoiceLabels": labels})
    if not questions:
        raise ValueError("No delivered MCQs to evaluate")
    return questions, skipped, mapping


def safe_output(directory):
    root, out = (WORKSPACE / "artifacts").resolve(), Path(directory).resolve()
    if not out.is_relative_to(root) or out == root:
        raise ValueError("Output must be a new directory inside workspace artifacts/")
    if out.exists() and any(out.iterdir()):
        raise ValueError("Output directory must be empty; previous scores are never overwritten")
    out.mkdir(parents=True, exist_ok=True)
    return out


def write_json(filename, data):
    target = Path(filename)
    pending = target.with_suffix(target.suffix + ".tmp")
    pending.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending.replace(target)


def upstream_modules():
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    from prompts.writing_flaw_prompts import get_writing_flaw_prompts
    return get_writing_flaw_prompts


def render_prompts(question):
    return [{"rule": name.value, "prompt": template.format(
        lbrace="{", rbrace="}", question=question["question"],
        choices=question["choices"], answer=question["target"])}
        for name, template in upstream_modules()()]


def guarded_score(metric, score):
    """Keep native score, but never count exhausted parsing as a valid pass."""
    metadata = score.metadata or {}
    if metric == "writing_flaws":
        rows = metadata.get("acceptable", []) + metadata.get("writing_flaws", [])
        invalid = len(rows) != 19 or any(
            not isinstance(row.get("explanation"), str) or not row["explanation"].strip()
            or row["explanation"] == "The LLM failed to parse the output" for row in rows)
    else:
        invalid = (not isinstance(score.answer, str) or len(score.answer) != 1
                   or score.answer not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                   or not metadata.get("inferred_question")
                   or score.explanation == "The model failed to produce a valid explanation")
    return {"status": "error" if invalid else "completed",
            "value": None if invalid else score.value, "upstreamValue": score.value,
            "answer": score.answer, "explanation": score.explanation,
            "metadata": metadata}


class EvaluationAborted(BaseException):
    # Upstream catches Exception and continues. Transport failures must escape
    # that loop, especially auth/balance failures, rather than triggering 19x3 calls.
    pass


class ObservedJudge:
    def __init__(self, model, out):
        self.model, self.out, self.stopped = model, out, False
        self.receipts, self.events, self.attempts = [], [], 0

    async def generate(self, prompt):
        if self.stopped:
            raise EvaluationAborted("Judge transport was stopped")
        index = self.attempts
        self.attempts += 1
        started = time.time() * 1000
        self.events.append({"index": index, "status": "started", "at": started})
        self.log({"index": index, "status": "started", "started": started,
                  "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest()})
        try:
            output = await self.model.generate(prompt)
        except Exception as error:
            self.stopped = True
            ended = time.time() * 1000
            self.events.append({"index": index, "status": "failed", "at": ended})
            self.log({"index": index, "status": "failed", "errorType": type(error).__name__,
                      "started": started, "ended": ended})
            # Provider exception bodies can contain secrets, so do not persist them.
            raise EvaluationAborted("Judge request failed; see errorType in calls.jsonl") from None
        ended = time.time() * 1000
        self.events.append({"index": index, "status": "completed", "at": ended})
        usage = output.usage.model_dump() if output.usage else None
        receipt = {"index": index, "status": "completed", "prompt": prompt,
                   "completion": output.completion, "usage": usage,
                   "stopReason": output.choices[0].stop_reason if output.choices else None,
                   "started": started, "ended": ended}
        self.receipts.append(receipt)
        self.log(receipt)
        return output

    def log(self, value):
        with (self.out / "calls.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=False) + "\n")

    def accounting(self):
        usage = [r["usage"] for r in self.receipts if r["usage"] is not None]
        known = sum(u["input_tokens"] + u["output_tokens"] for u in usage)
        unknown = self.attempts - len(usage)
        starts = {e["index"]: e["at"] for e in self.events if e["status"] == "started"}
        service_ms = sum(e["at"] - starts[e["index"]] for e in self.events
                         if e["status"] != "started" and e["index"] in starts)
        return {"attempts": self.attempts, "inputTokensKnown": sum(u["input_tokens"] for u in usage),
                "outputTokensKnown": sum(u["output_tokens"] for u in usage),
                "totalTokensKnown": known, "unknownUsageAttempts": unknown,
                "totalTokens": None if unknown else known,
                "requestServiceMs": service_ms}


async def evaluate(questions, args, out):
    if version("inspect-ai") != "0.3.132":
        raise RuntimeError("Install the pinned evaluator requirements before running")
    if version("openai") != "2.54.0":
        raise RuntimeError("Install the pinned judge transport before running")
    from inspect_ai.model import GenerateConfig, get_model
    from inspect_ai.scorer import Target
    from scorers import writing_flaws_scorer as writing
    from scorers import shortcut_scorer as shortcut
    thinking = getattr(args, "thinking", "provider-default")
    extra_body = {"thinking": {"type": thinking}} if thinking != "provider-default" else None
    config = GenerateConfig(max_tokens=args.max_tokens, max_connections=args.workers,
                            max_retries=0, timeout=args.timeout, extra_body=extra_body)
    native_model = get_model(args.judge, api_key=os.environ[args.key_env],
                             base_url=args.base_url, config=config)
    judge = ObservedJudge(native_model, out)
    # Only vendor-local model lookup is bridged; scoring functions/prompts stay
    # byte-identical. Never use the upstream default per-rule stronger models.
    def explicit_model(name):
        if name != args.judge:
            raise EvaluationAborted("Unexpected judge model")
        return judge
    writing.get_model = explicit_model
    shortcut.get_model = explicit_model
    factories = {"writing_flaws": writing.writing_flaws_scorer,
                 "shortcuts": shortcut.shortcut_scorer}
    results = []
    queue = asyncio.Queue()
    for q in questions:
        queue.put_nowait(q)
    started = time.perf_counter()

    async def worker():
        while not queue.empty() and not judge.stopped:
            q = queue.get_nowait()
            record = {"id": q["id"], "metrics": {}}
            try:
                for metric in args.metrics:
                    scorer = factories[metric](model=args.judge)
                    state = SimpleNamespace(sample_id=q["id"], metadata=q)
                    score = await scorer(state, Target(q["target"]))
                    record["metrics"][metric] = guarded_score(metric, score)
            except EvaluationAborted as error:
                record["error"] = str(error)
            except Exception as error:
                judge.stopped = True
                record["error"] = "Scorer failed: " + type(error).__name__
            results.append(record)
            write_json(out / "results.json", results)
    await asyncio.gather(*(worker() for _ in range(args.workers)))
    wall_ms = (time.perf_counter() - started) * 1000
    complete = (len(results) == len(questions) and all(
        not r.get("error") and len(r["metrics"]) == len(args.metrics)
        and all(v["status"] == "completed" for v in r["metrics"].values()) for r in results))
    summary = {"status": "completed" if complete else "incomplete", "judge": args.judge,
               "thinking": thinking,
               "inspectAiVersion": version("inspect-ai"),
               "openaiVersion": version("openai"),
               "workers": args.workers, "requested": len(questions), "returned": len(results),
               "wallMs": wall_ms, "tokens": judge.accounting(), "metrics": {}}
    for metric in args.metrics:
        scores = [r["metrics"][metric] for r in results if metric in r["metrics"]]
        values = [s["value"] for s in scores if s["status"] == "completed"]
        summary["metrics"][metric] = {"scored": len(values), "requested": len(questions),
            "errorsOrMissing": len(questions)-len(values),
            "meanAmongCompleted": sum(values)/len(values) if values else None}
    write_json(out / "summary.json", summary)
    write_json(out / "request-events.json", judge.events)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--run", action="store_true", help="Enable paid judge requests; default is offline preparation")
    parser.add_argument("--judge", help="Explicit Inspect AI model, e.g. openai-api/deepseek/deepseek-flash")
    parser.add_argument("--base-url")
    parser.add_argument("--key-env", default="QUIZ_JUDGE_API_KEY")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--thinking", choices=["provider-default", "disabled", "enabled"], default="provider-default",
                        help="Explicit provider thinking option; use disabled to match our existing DeepSeek bench")
    parser.add_argument("--metrics", nargs="+", choices=["writing_flaws", "shortcuts"], default=["writing_flaws", "shortcuts"])
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 64 or args.max_tokens < 1 or args.timeout < 1:
        parser.error("Invalid worker count, token limit or timeout")
    if len(set(args.metrics)) != len(args.metrics):
        parser.error("Duplicate metrics")
    if args.run and (not args.judge or not os.environ.get(args.key_env)):
        parser.error("--run requires --judge and a nonempty --key-env credential")
    if args.judge and not args.judge.startswith("openai-api/"):
        parser.error("This adapter requires an explicit openai-api/provider/model judge")
    if args.judge and not args.base_url:
        parser.error("An explicit --base-url is required for this adapter")
    lock = verify_vendor()
    questions, skipped, mapping = load_questions(args.input)
    out = safe_output(args.out)
    write_json(out / "prepared.json", questions)
    write_json(out / "source-map.json", {"inputSha256": hashlib.sha256(Path(args.input).read_bytes()).hexdigest(), "mapping": mapping, "skipped": skipped})
    write_json(out / "protocol.json", {"upstream": lock, "metrics": args.metrics,
        "judge": args.judge, "workers": args.workers,
        "maxTokens": args.max_tokens, "timeoutSeconds": args.timeout,
        "thinking": args.thinking,
        "inspectAiVersionRequired": "0.3.132", "pythonVersion": sys.version.split()[0],
        "openaiVersionRequired": "2.54.0",
        "scoring": "Unmodified native scorers; exhausted parsing is unknown, never a pass",
        "mode": "run" if args.run else "prepare", "inputCount": len(questions)})
    write_json(out / "writing-prompts.json", [{"id": q["id"], "rules": render_prompts(q)} for q in questions] if "writing_flaws" in args.metrics else [])
    if not args.run:
        print(json.dumps({"status": "prepared", "questions": len(questions), "skipped": len(skipped), "writingRules": 19, "networkRequests": 0}))
        return 0
    summary = asyncio.run(evaluate(questions, args, out))
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["status"] == "completed" else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never print exception bodies from provider/SDK imports or credentials.
        print("Evaluation failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(2)
