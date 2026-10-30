# dsh-zhiyun-core-question

智云 Pro 的**出题流水线**。上游 `DeepTutor` `deep_question` 主链的纯 JS 重写：
零第三方依赖、零落盘、不真调模型（`llm` 与 `tools` 都由集成层注入）。

上游来源：`vendor/deeptutor/deeptutor/agents/question/pipeline.py`（2309 行）
及周边 `runtime/agentic/{loop,labeled_step,labels}`、`utils/json_parser.py`、
`services/prompt/language.py`。逐段对照见 `NOTES.md`，测绘文档见
`.verify-scratch/PIPELINE-SPEC.md`。

## 对外只有一个入口

```js
import { runDeepQuestion } from 'dsh-zhiyun-core-question';

const { questions } = await runDeepQuestion({
  lecture,      // { chapters: [{ title, topics: [{ title, blocks: [{kind,text}] }] }] }
  count,        // 题数（0/负数按 1 处理，不是 0 题）
  type,         // 'choice' | 'fill_in_blank' | 'concept' | 'short_answer'
  difficulty,   // 'easy' | 'medium' | 'hard'
  llm,          // core-llm 实例（prepareCall 必需）
  tools,        // core-tool 注册表（schemas / dispatch）
  onEvent,      // ({ stage }) => void，stage ∈ 'exploring'|'planning'|'quizzing'
  signal,
});
```

`questions[]` 与产品 `tutor.runs.result().questions` **逐字段兼容**：
`{ type, stem, options, choices, answer, explanation, topic, difficulty, questionId, issues }`。
所以 `packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js` 一行不用改。

同时返回上游信封 `{ summary, response, mode, usage }`，便于和旧实现对照
（`summary.results[].qa_pair` 里是同一份数据，只是 topic 的键名是 `concentration`）。

### 题型映射

| 上游 | 本包 `type` | 说明 |
|---|---|---|
| `choice` | `mcq` | options 必须恰好 A/B/C/D |
| `concept` | `trueFalse` | **判断题**，答案 `true`/`false` → `正确`/`错误` |
| `fill_in_blank` | `cloze` | 题面含 `____` |
| `short_answer` / `written` / `coding` | `shortAnswer` | |

⚠️ `concept` 是判断题，不是"概念填空"。映射错了会让质检用文本等价的判据去判真假题。

## 四个阶段

```
explore ──→ plan ──→ quiz（逐题，串行）──→ repair（每题 0 或 1 次）
```

- **explore**：agentic loop（THINK/TOOL/FINISH），读讲义、调工具；FINISH 正文
  逐 chunk 进用户气泡，同时序列化成 `exploration_trace` 给下游。
- **plan**：单次 PLAN 调用产出模板（每题一个考点角度）。空模板 = 硬失败；
  数量不足只警告。
- **quiz**：按模板逐题生成，带工具循环。FINISH 是裸 JSON，**绝不**进气泡。
  第 N 题读得到前 N−1 题题面（串行是去重的唯一保证）。
- **repair**：校验不合格时单轮修复；修不好**照常出题**，用
  `[Generation failed] {topic}` / `N/A` 占位。

模型调用上限 `10 + 2 + 9N`（N=15 时 147 次）。

## 三个不能改的行为

1. `if repaired` 是 Python 真值判断：`{}` 不算修复成功（JS 的 `{}` 是 truthy）。
2. 修复失败不出重题、不过滤坏题——题数必须与计划一致。
3. explore 的 `streamBodyLive=true`、quiz 的 `false`。对调会让用户看到裸 JSON。

见 `NOTES.md` 的 §2-§7。

## 自检

```bash
node tests/core-question.test.mjs
node --check src/index.js
```

`NOTES.md` 第 12 节记录了 `.verify-scratch/PIPELINE-SPEC.md` §7 那 6 条
「待确认」项各自选了哪种理解、为什么、以及怎么回退。
