# External quiz evaluators

This is a bench-only integration of publicly released **scorer source**, not a new generation algorithm or product gate. Our lecture/question data remain the evaluation data. It does not modify r1, r2, r3, the App or provider configuration.

## Admission decision

| Candidate | Public scorer implementation | License check | Decision |
| --- | --- | --- | --- |
| BenchMarker | `scorers/writing_flaws_scorer.py`, `scorers/shortcut_scorer.py`, complete prompt builders | MIT | Vendor the pinned, unmodified scorer subset |
| QGEval | Evaluation-related code is public; its seven human-rated dimensions are described in its paper | No root license covering the project's own code at inspected commit | Do not vendor |
| SAQUET | Public notebook | No LICENSE/COPYING/NOTICE at inspected commit | Do not vendor |

Source attribution, inspected commits and scope: [ATTRIBUTION.md](ATTRIBUTION.md). The MIT notice and original source are retained. This subset includes 19 writing-rule judges and the original two-stage choices-only shortcut judge. It is one external evaluation framework with two complementary metrics, not two independent benchmarks.

## Prepare our existing outputs without model calls

Use Python 3.11. The preparation path only needs the standard library:

```powershell
python scripts/quiz_bench/evaluators/benchmarker.py --input artifacts/my-quiz-run/questions.json --out artifacts/my-external-eval-preview
```

Accepts our `questions.json` arrays and JSONL rows with `stem`, `choices: [{label,text}]`, `answer` (or string choices and `question`). All delivered MCQs are included; other types/undelivered rows are explicitly reported as skipped. Invalid MCQ records fail validation. Algorithm identities, previous audit grades, explanations and rubrics are excluded from judge inputs. An opaque source map allows results to be joined back afterwards. Answers map to the original choice order, labelled A–Z as expected by upstream.

Outputs contain private data and are restricted to a new directory under ignored `artifacts/`. `prepared.json` holds normalized MCQs, `source-map.json` holds row identities, `writing-prompts.json` renders the exact upstream prompts, and `protocol.json` records the snapshot and chosen configuration. The vendor hash check runs before imports. Preparation makes **zero network requests**.

## Run the upstream scorers

Create a separate Python environment and install `requirements.txt`. Do not install upstream's full dependency list into the existing DeepTutor/product environment.

```powershell
python -m venv .runtime/quiz-evaluators-py311
.runtime/quiz-evaluators-py311/Scripts/python.exe -m pip install -r scripts/quiz_bench/evaluators/requirements.txt
# Put the judge credential in an environment variable; never in a command argument or tracked file.
.runtime/quiz-evaluators-py311/Scripts/python.exe scripts/quiz_bench/evaluators/benchmarker.py --input artifacts/my-quiz-run/questions.json --out artifacts/my-external-eval-run --run --judge openai-api/deepseek/deepseek-flash --base-url https://api.deepseek.com/v1 --key-env QUIZ_JUDGE_API_KEY --workers 2 --thinking disabled
```

`--run` requires an explicit judge and credential environment variable. The adapter never uses upstream's per-rule default models. `--metrics writing_flaws` or `--metrics shortcuts` selects a subset. Rules, examples and native aggregation stay unchanged. JSON is requested by the original text prompt; no provider JSON-output mode is enabled. Language-specific prompt changes would need a separately named adaptation and separate validation.

`--thinking disabled` matches the explicit transport option used by our existing DeepSeek bench host. The generic adapter otherwise keeps `provider-default`. This setting is recorded in the protocol and summary: provider-default reasoning can consume the entire output budget before emitting the required result, so runs using different thinking settings must not be mixed. This is a provider option, not a prompt or judge-model upgrade.

Writing flaws requires **19 model calls per question** before retries; shortcuts requires one call and, when the choices-only guess matches the key, a second comparison call. Set the input size accordingly. Workers parallelize questions, while the native writing-rule loop remains sequential. Wall time is measured directly and is never divided by the worker count. Provider/transport failures stop the run rather than triggering the upstream parse retry loop for every remaining rule.

## Results and limitations

- `results.json` checkpoints each returned question, native per-rule decisions and explanations. `calls.jsonl` records start events, completions, stop reasons and usage; `request-events.json` and `summary.json` record actual wall time and known/unknown tokens. Match start and terminal records by index rather than counting JSONL lines as requests. Cache/reasoning subsets are not added again. All attempted calls, including failed ones, are counted; missing usage remains unknown.
- The upstream writing scorer initializes an exhausted parse to `pass`; the shortcut scorer can also return a passing value after invalid responses. We preserve the native result as `upstreamValue` but expose `status: error, value: null` for those cases. Incomplete runs exit nonzero and show missing/error counts next to any mean, so partial results are not complete benchmark wins.
- These are item-writing and shortcut metrics. They do not establish lecture coverage, inter-question diversity, explanation correctness, or world-factual correctness. The original prompts do not receive the lecture or explanation. Keep Codex/manual review and historical deduplication results alongside them.
- Scores from a different judge model or Chinese course data do not reproduce the paper's reported validation performance. This integration first verifies source/protocol behavior; it does not claim a real-model quality evaluation has already happened.

## Offline mechanism checks

```powershell
.runtime/quiz-evaluators-py311/Scripts/python.exe -m unittest discover -s scripts/quiz_bench/evaluators -p test_benchmarker.py -v
```

Tests exercise the actual native scorer functions with controlled judge responses; they are protocol tests, not substitutes for real-model question-quality review.
