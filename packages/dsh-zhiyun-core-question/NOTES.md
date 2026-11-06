# dsh-zhiyun-core-question · 上游行为笔记

> 这是从 `packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/`
> **逐行读出来**的行为事实，不是设计建议。后面维护这个包的人，先看这份，再改代码。
> 每条都注了上游文件与行号。标 ⚠️ 的是「看起来可以简化、一简化就掉分」的那些。
>
> 上游主文件：`agents/question/pipeline.py`（2309 行，未注前缀即指它）。
> 测绘文档：`.verify-scratch/PIPELINE-SPEC.md`（734 行）。

---

## 0. 本包模块 ↔ 上游来源

| 本包文件 | 上游来源 |
|---|---|
| `src/pipeline.js` | `agents/question/pipeline.py` 的 `run` / `_run_inner` / `_explore` / `_plan` / `_quiz_one` / `_repair_quiz_payload` / `_force_finish` / `_build_result_payload`，以及 `_BaseLoopHost` / `_ExploreLoopHost` / `_QuizLoopHost` 三个 host |
| `src/quiz-payload.js` | 同文件 1406-1508（归一化 / 校验 / 占位） |
| `src/plan.js` | 同文件 808-871（`_parse_plan`） |
| `src/json.js` | `utils/json_parser.py` + `pipeline.py:1384-1404`（两套解析器） |
| `src/types.js` | 同文件 156-306（题型词表与提示词文案） |
| `src/render.js` | 同文件 1176-1285、1857-1950（轨迹渲染 / 提示词片段 / 题目卡） |
| `src/i18n.js` | `services/prompt/language.py`、`services/config/loader.py:parse_language`、`pipeline.py:2009-2022`（`_t`） |
| `src/labeled-step.js` | `runtime/agentic/labeled_step.py` 的**兜底**实现（优先用 core-llm 的） |
| `src/product-questions.js` | 无直接上游；对位 `host-deeptutor/src/adapters/quiz.js` 的题型/答案映射 |
| `src/deps.js` | 跨包依赖解析（core-tool 必需、core-llm 可选） |

**不在本包**：followup agent（单题追问）、mimic 模式的 PDF 抽模板
（`mimic_source.py`）、`capability.py` 的请求路由。本包只做 `custom` / `mimic`
两种模式的出题主链。

---

## 1. 四阶段为什么是这个顺序，且不能并行

```
explore ──→ plan ──→ quiz#1 ──→ quiz#2 ──→ … ──→ quiz#N
   │          │        └─ repair（0 或 1 次，单题内）
   │          └─ 读 exploration_trace
   └─ 产出 exploration_trace + finish_text
```

- **explore 先于 plan**：plan 的 user 提示词第一个变量就是 `exploration_trace`。
  先规划后探索，planner 只能凭标题猜考点，plan 里的 `topic` 会退化成"第一章第一节"
  这种没有信息量的字符串。
- **plan 先于 quiz**：`QuizTemplate` 是「本题考什么、什么题型、什么难度」的唯一来源。
  quiz 阶段会把模型的 `question_type` **无条件覆盖**成 template 的值（§4.1）。
- **quiz 串行**：第 N 题的提示词里带 `previous_questions`（前 N−1 题题面，**不截断**）。
  `Promise.all` 会让 15 道题互相看不见，去重全靠运气——这是"题与题重复"这类
  质量问题的主要来源。上游 `for ... await`（588-600）就是串行。
- **repair 跟在单题之后**：它吃的是这一题归一化后的 payload 与 issues 码表。

**只有单轮内的工具调用是并发的**（`asyncio.gather`），上限 15，超出的直接截断并
回一条"未执行"占位结果（`tool_dispatch.py:53`、`152-161`）。

---

## 2. `_t` 的三态——本包最容易"改好反而改坏"的地方

```python
def _t(self, key, default="", **kwargs):
    value = self._prompts
    for part in key.split("."):
        if not isinstance(value, dict) or part not in value: return default   # ①
        value = value[part]
    if not isinstance(value, str): return default                             # ②
    if kwargs:
        try: return value.format(**kwargs)
        except (KeyError, IndexError, ValueError): return value               # ③
    return value
```

| 情况 | 返回 | 为什么 |
|---|---|---|
| ① key 不存在 | `default`（常是 `""`） | 提示词缺失是个**可恢复**故障；崩溃会让用户看到 500，而不是"题出得差" |
| ② 叶不是字符串 | `default` | 路径写到了中间节点（例如 `explore`），返回字典会炸 `str.format` |
| ③ format 失败 | **未格式化的原文** | 占位符会原样发给模型。不优雅，但这是真实行为 |
| 没传 kwargs | 不做 format | `protocol.*` / `notices.*` / `empty.*` / `trace.*` 正文里的 `{}` 是字面量 |

JS 侧两个最常见的错误实现是「抛错」（把降级变成崩溃）和「返回 key 名」
（模型收到 `explore.system` 这种垃圾）。本包 `src/i18n.js` 的
`createTranslator` 严格复刻三态，并且 `pythonFormat` 真的实现了
`{{`/`}}` 转义（`plan.system` / `quiz_step.system` 里 JSON schema 段的双花括号
**必须**用 format 才还原成单花括号——不格式化，模型看到的是 `{{"analysis": ...}}`）。

> 实测：用真实 kwargs 渲染 `explore.system / explore.user_template / plan.system /
> plan.user_template / quiz_step.system / quiz_step.user_template / repair.user_template /
> tool_summarizer.user_template` 全部成功，无 KeyError；`repair.system` /
> `tool_summarizer.system` 不参与格式化。

---

## 3. ⚠️ 一组重复定义的辅助函数，生效的是**第二份**

`pipeline.py` 把 `_normalize_type_list` / `_normalize_per_type_counts` /
`_format_allowed_types` / `_format_per_type_counts` 各定义了**两遍**
（187-246 与 249-306）。Python 后定义覆盖前定义，所以 249-306 那份生效。
两份注入提示词的**文案不同**：

| | 第一份（死代码） | **第二份（生效）** |
|---|---|---|
| 空 allowed_types | `"auto"` | `"any (planner picks per question)"` |
| 非空 | `choice, short_answer` | ``"``choice``, ``short_answer``"`` |
| 空 counts | `"auto"` | `"no per-type targets (planner distributes freely)"` |

搬错这一处**不会报任何错**，只会让 plan 阶段看到的话术变掉，模型对类型约束的
理解随之漂移。`tests/core-question.test.mjs` 里有一条断言**明确否定** `"auto"`。

---

## 4. ⚠️ 四个"看起来可以简化"的判定

### 4.1 `question_type` 以 template 为准（1412）

```python
normalized["question_type"] = expected_type      # 无条件覆盖
```

后果：
- 校验永远针对**计划好的**题型。模型即使写成 `choice`，也按 `short_answer` 的
  规则判，选项会被丢掉（`options = None`）并判 `non_choice_must_not_have_options`；
- repair 提示词里的 `question_type` 也是 template 的值，等于要求模型"别改类型"。

这与 `quiz_step.system` 里"``question_type`` 必须完全等于 template"是同一条约束的两端。
别"顺手"信任模型返回值。

### 4.2 ⚠️ `if repaired:` 是 **Python 真值**，不是 `is not None`（957）

`_repair_quiz_payload` 解析失败返回 `{}`（1040 → 1388），`{}` 在 Python 里**为假**
⇒ 保留修复前的 normalized 与 issues。

JS 的 `{}` 是 **truthy**。照抄 `if (repaired)` 会把一次失败的 repair 当成成功，
用空对象覆盖掉原本可能只差一个 `explanation` 的题面——题面变成
`[Generation failed]`，而本来它是能用的。

本包用 `pythonTruthy()`（`src/quiz-payload.js`）显式实现 Python 真值语义。

### 4.3 ⚠️ repair 只有 **1 轮**，且"修复失败"也要照常出题

设计稿里"最多重试 N 轮"的说法与代码不符：`_quiz_one` 只调一次
`_repair_quiz_payload`（950），**没有 while 循环**。唯一的"再来一次"是
`reasoning_only` 分支里的"降思考重问一次"（1013-1039），那是另一条路径。

并且修复后仍有 issues 时**不丢弃**题目，只发 `notices.repair_failed`（962），
然后走 `_payload_to_qa_pair`（1488-1508）。最终：

```python
question = "[Generation failed] {topic}"   # 题面空时
correct_answer = "... or 'N/A'"            # 答案空时
explanation = "... or 'N/A'"               # 解析空时
metadata = {"issues": issues} if issues else {}
```

**若 JS 实现选择"修复失败就重出"或"过滤掉坏题"，题数与 `summary` 语义都会变。**
「请求 5 出 4」变成默认行为，而产品的 `summary.completed/failed` 是靠
`metadata.issues` 算的（§5）。

### 4.4 ⚠️ plan 空模板 = 故意的崩溃；数量不足 = 只警告

```python
if not plan.templates:
    raise RuntimeError(self._t("notices.plan_unusable"))     # 786-791
if len(plan.templates) < num_questions:
    await stream.progress(notices.plan_count_mismatch)       # 792-805，继续
```

注释（787-791）记了历史事故 #1318：早期解析空串得到"零题计划"，phase 3 遍历空列表，
**整个回合 0 题且没有任何错误痕迹**。现在的策略是"在原因还可读的地方失败"。

而数量不足只警告——"三道真题好过一场失败"。

**两条分支方向相反，不能统一成一种。**

---

## 5. ⚠️ `success` 的判据是 `metadata.issues`，不是 `error`

```python
successful = sum(1 for qa in qa_pairs if not qa.metadata.get("issues"))   # 1351
```

注释（1347-1350）记录过 bug：曾读一个**从不被写入**的 `error` 字段，导致全占位题
也报 `success=True / failed=0`，#1508 因此没留下任何失败痕迹。

JS 侧如果在 `QuizPair.metadata` 里塞别的键（比如 `error`），或者把 issues 移到顶层，
`summary.completed/failed` 立刻全错。本包的 `payloadToQaPair` 只写
`{issues}` 或 `{}` 两种形状。

---

## 6. 结果信封：`topic` 的键名在两层里不一样

| 函数 | 键名 | 位置 |
|---|---|---|
| `_qa_pair_to_dict`（1952-1963） | **`concentration`** | `summary.results[].qa_pair` |
| `_template_to_dict`（1965-1975） | **`topic`** | `summary.templates[]` |

这是为了兼容旧 `QAPair` / `QuizViewer`。上游适配器读的正是
`raw.concentration ?? raw.topic`（`host-deeptutor/src/adapters/quiz.js:405`）。
本包 `qaPairToDict` / `templateToDict` 保持这个不对称。

---

## 7. ⚠️ `stream_body_live` 一开一关决定用户看到什么

| 阶段 | 值 | 机制 | 用户看到 |
|---|---|---|---|
| explore | `True`（695） | FINISH 逐 chunk → `stream.content` | 探索前言逐字长出来 |
| quiz | `False`（937） | FINISH 只作返回值 | 只看到渲染后的题目卡 |

quiz 的 `_QuizLoopHost.emit_final` 是**故意的空实现**（2281-2283，注释写明
deliberate no-op）。把这个标志对调，用户会在出题时看到
`{"question_type": "choice", ...}` 刷屏。

本包两条都有测试钉住：`chunks` 里**不能**出现 `"correct_answer"`，
而 explore 的前言必须被拆成多个 chunk 推出去。

---

## 8. `_render_exploration_trace` 主动**丢弃** user 消息

`1263-1267`：循环里注入的 `role=user` 都是协议修复/强制收尾提示，属于噪声。
若 JS 实现"忠实序列化全部消息"，plan 会读到一堆"协议修正：你上一轮…"，
既浪费预算又干扰规划。

同时：
- `role=tool` 的 content **已被 Tool Summarizer 替换**，渲染器不该再压缩一次；
- 纯文本 assistant 视为 THINK 迭代，剥掉开头的 `` ``THINK`` `` / `` ``TOOL`` `` /
  `` ``FINISH`` `` 再输出（`_strip_protocol_label`，1277-1285）；
- 最后若有 `finish_text`，追加 `### {trace.finish_note}` 块。

---

## 9. Tool Summarizer：只作用于 explore，且替换原始 tool message

`_ExploreLoopHost.dispatch_tools`（2137-2180）在父类派发之后，对**每条** `tool_messages`
跑一次主模型调用，成功则 `new_message["content"] = summary`，返回新的 DispatchOutcome。

三个后果：
1. `exploration_trace` 里看到的永远是**压缩版**，plan 与 quiz 都读不到原文；
2. summarizer 失败返回 `None` → 保留原始结果（1142-1159），**不重试**；
3. quiz 阶段**不做** summarizer（只有 `_ExploreLoopHost` 覆写了 `dispatch_tools`）。

成本上它是"每条 tool result 多一次主模型调用"（141-153 注释写着这是成本换效果），
所以 `10 + 2 + 9N` 这个预算**不含**它（§5.3 明确列出它单独计）。

---

## 10. 两套 JSON 解析器**不能合并**

| 用途 | 上游 | 行为 |
|---|---|---|
| plan | `parse_json_response`（`json_parser.py`） | 整段解析 → fenced 提取 → `<think>` 剥离 → **最长可解码值挑选** → json-repair 兜底 → `{}` |
| quiz / repair | `_parse_quiz_payload`（1384-1404） | 单段 fenced 提取 → `json.loads` → 从**首个** `{` `raw_decode` → `{}` |

合并的两种方向都会坏：
- 统一成**强**解析器：quiz 的坏 JSON 会被 repair **猜**出一个对象，畸形题面被当正常题
  收下，repair 流程根本不会触发；
- 统一成**弱**解析器：plan 更容易失败，直接撞上 §4.4 的硬失败。

`_parse_quiz_payload` 还有两个细节：
- 只取**第一段** fenced block（非贪婪）；
- 结尾不用花括号切片，否则后面的散文会被一起吃进来。

---

## 11. 其它「不报错但改变行为」的点

| # | 点 | 上游位置 |
|---|---|---|
| 1 | `num_questions=0` → **1**（不是 0 题） | 486 `max(1, int(...))` |
| 2 | `templates_override` **空列表 = None** = custom 模式 | 506 |
| 3 | explore 循环用 **`answering`** 预算（4000），不是 `exploring` | 686 |
| 4 | temperature 硬编码 **0.4**；summarizer 用 0.2 | 439、153 |
| 5 | 默认语言 `parse_language("")` → **`zh`**（但 `normalize_language("")` → `en`，两个函数不同默认） | `loader.py:189`、`language.py` |
| 6 | choice 的 options 必须**恰好** A/B/C/D 四个非空；缺一个/多一个（E）/某值为空 都判 issue | 1467 |
| 7 | choice 的答案允许写**选项值**：先 `upper()` 看是否命中键，否则线性找值相等项换成键（第一个命中） | 1427-1435 |
| 8 | concept 接受 对/正确/yes/y/1 与 错/错误/no/n/0；**未命中原样保留**再判 issue | 1442-1445 |
| 9 | 非 choice 的答案若是**单个** A/B/C/D 字符 → 判 `non_choice_correct_answer_looks_like_option_key`。这是**故意的启发式**（会误判合法答案 "A"），别"修" | 1484 |
| 10 | fill_in_blank **只检存在**、不检"恰好一处"（与提示词要求不一致） | 1479 |
| 11 | plan 重编号 `q_1..q_n`，**丢弃模型给的 id**；topic 小写去重，重复/空的**跳过不占位** | 845-870 |
| 12 | 难度 `diff = target_difficulty or diff_raw`，非法 → `medium` | 857-859 |
| 13 | `_render_previous_questions` **不截断**；`_render_quiz_history` 截 160/80 字符 | 1905、1867 |
| 14 | `_emit_quiz_question` 在 `qa_pairs.append` **之前**调用（逐题即刻上屏） | 601-607 |
| 15 | mimic 模式：`exploration_trace` 是**非空**的 `empty.no_exploration_trace`，`analysis=""`，`finish_text=""` | 547-553 |
| 16 | `_use_native_tools` 返回 True 但**没有工具**会让模型编造文本式 tool calls，所以必须两者都满足 | 1616-1623 |
| 17 | 强制收尾成功条件是 `label == FINISH` **且**正文里不能再有行首标签（比循环内多一道检查）；两次都失败返回 `protocol.fallback_final` 假文本，最终变成 `[Generation failed]` | 1563-1575 |

---

## 12. SPEC §7 的 6 条「待确认」——本包各自选了什么

SPEC 列了 6 条上游行为不确定或未读完的项。实现不能编，所以每条都要给出
**明确选择 + 理由 + 可回退的开关**。

### 7-1 `next(iter(allowed_set))` 的选取顺序 → **固定成"用户传入顺序的第一个"**

上游（839-841）`allowed_set` 是 `frozenset`，迭代顺序取决于 Python 字符串哈希：
同进程内稳定、跨进程/跨版本可能不同。也就是说上游自己在这条分支上的行为
**本来就不可复现**。

**选择**：`pickFallbackType()`（`src/plan.js`）按 `allowedTypes` 的**传入顺序**取第一个。

**理由**：
1. 可复现 > 逐字节等价——不可复现的行为没法做回归测试。
2. 触发条件极窄：只有「`allowed_types` 非空 **且** 不含 `short_answer` **且** 模型
   给了非法类型」三条同时成立才有差别。产品实际调用几乎总是传单题型或含
   `short_answer`。
3. 顺序取"用户传的第一个"在语义上更接近"最想要的那个题型"。

**回退**：若上游核对发现某版本有确定顺序，改 `pickFallbackType` 一处即可。

### 7-2 `find_inline_labels` 在 JSON 字符串内的误判边界 → **照搬正则，不额外加固**

上游正则要求**行首**（可缩进）+ 包裹/裸标签 + 分隔符或行尾（`labels.py:152-173`）。
题面/解析里若出现"换行 + `` ```FINISH``` `` + 冒号"这种结构，会被判 `multiple_labels`
并触发一次协议违规重试。

**选择**：逐字复刻正则（`src/labeled-step.js` 的 `findInlineLabels`），不加
"跳过 JSON 字符串内部"的加固。

**理由**：
1. 触发概率低（要求标签恰好落在一行开头）；
2. 加了加固反而会**漏掉**真实的协议违规——模型确实可能在一轮里写两个动作标签；
3. 误判的代价只是"多一轮"，不是"整题报废"：违规轮会把草稿留作上下文再补一条纠正。
   上游明知这个边界存在也没有修，说明这个代价是可接受的。

**回退**：如果真机上观察到 JSON 内的 `FINISH` 行频繁触发误判，再在
`findInlineLabels` 里加"当前是否在字符串字面量内"的扫描。

### 7-3 `_parse_quiz_payload` 对多个 JSON 对象的处理 → **照搬"只取第一个"**

上游（1401）`raw_decode` 只取第一个可解码对象。若模型先给一个 schema 示例再给真答案，
会取到示例。`parse_json_response`（plan）用"最长值"策略规避了这点，quiz 路径**没有**。

**选择**：`parseQuizPayload` 保持"只取第一个"，**不**引入最长值策略。

**理由**：
1. 这是 T9 的核心——两套解析器的强弱差异是**设计**，不是疏漏。把最长值策略搬进
   quiz，坏 JSON 会被"猜"成一个对象，repair 流程不再触发，畸形题面被当正常题收下；
2. quiz 提示词（`quiz_step.system`）明确要求"FINISH 的正文就是一个 JSON 对象，
   不要包代码块、不要加标题、闭合括号之后不要再写任何文字"。真触发说明模型违约，
   而这正是应该走 repair 的场景。

**回退**：如果真机上发现"示例在前、真答案在后"是高频违约形态，可加一条
**仅在修复阶段**使用的强解析器（repair 的输入已经是错误载荷，多猜一次不亏）。

### 7-4 `stream.stage` 的边界语义 → **只发 `onEvent({stage})`，不发 start/end**

上游 `async with stream.stage(...)` 的边界行为在 `runtime/stream_bus.py`，本次
未逐行读。产品视角需要的是"当前在哪个阶段"，而不是成对事件。

**选择**：
- `runDeepQuestion` 对外**只**回调 `onEvent({ stage })`，在进入每个阶段时发一次，
  顺序 `exploring → planning → quizzing`（mimic 模式只有 `quizzing`）；
- 内部 StreamBus 的 start/end 由调用方通过 `config.stream` 自行接管，本包在
  `config.stream` 缺省时创建一条内部总线（`closeStream: false` 可关掉收尾）。

**理由**：
1. 契约里的 `onEvent({stage})` 就是产品需要的最小信息（`quiz-engine-runtime.js`
   用它写 `s.phase = 'native-' + event.stage`）；
2. 成对 start/end 在异常路径上的语义（是否补 end）上游未定，本包不猜。

**回退**：如果产品需要 trace 面板挂行，传 `config.stream` 进去即可——本包的
所有阶段内事件（content / thinking / progress / tool_call）都发在那条总线上，
且都带 `source` / `stage`。

### 7-5 图片降级路径 → **不做**

`prepare_multimodal_messages` 的 `url_images_dropped` / `should_degrade_to_text`
降级重试发生在 `run_labeled_step` 的调用点，是否复刻取决于产品是否支持图片附件出题。

**选择**：`runDeepQuestion` 接受 `config.attachments` 并把它渲染进
`explore.user_template` 的 `{attachments_summary}`（文本摘要），但**不**把图片
作为多模态 parts 注入消息。

**理由**：
1. 产品当前出题入口（`nativeQuizContract` → `tutor.runs.start`）只传讲义文本，
   没有图片附件；
2. 多模态注入点必须严格是"最后一条 user 消息的 content 换成 parts 数组"（T3），
   而 explore 的轨迹切片锚点必须在这之后取。这条链路在没有真实图片输入的
   情况下无法验证，**未验证的降级路径比没有更危险**——它会在真机上以
   "图片静默消失"的形式失败。

**回退**：如果产品要支持图片出题，注入点必须在
`Object.assign({}, promptMessages)` 之后、`initialMessageCount` 之前，
并且**不改消息条数**（否则轨迹切片起点错位，system 提示词会被混进 exploration_trace）。

### 7-6 `agents.yaml` 里 `capabilities.question` 的真实用户配置 → **默认表 + 只认已知 key**

上游只确认了合并规则（`loader.py:345-373`：读 `capabilities.question`，
**只保留默认表里存在的 key**，再深合并 `DEFAULT_QUESTION_PARAMS`），
运行期真实文件不在仓库。

**选择**：`mergeBudgets()`（`src/pipeline.js`）逐字复刻这个规则：
- 默认表 `answering 4000 / planning 6000 / quiz_finish 3000 / repair 2500 / tool_summarizer 800`；
- 用户覆盖里**未知阶段名直接丢弃**（不合并、不报错）；
- 值只接受正数，否则回落默认。

调用方通过 `config.budgets` 传覆盖，形状与 `agents.yaml` 一致。

**理由**：规则是可确认的，值不可确认；把规则实现对，值走默认表，
用户想改就传 `config.budgets`。不读文件是刻意的——本包零文件 IO。

**回退**：集成层读到 `agents.yaml` 后把 `capabilities.question` 原样传给
`config.budgets` 即可，无需改本包。

---

## 13. 本包额外做的两个决定（SPEC 没写，但集成层需要）

### 13.1 对外返回 `questions[]`，同时保留上游信封

产品只吃 `result.questions`（`quiz-engine-runtime.js:237`），而上游信封
（`summary.results[].qa_pair`）是质量对照的基线。两个都给：

```js
{ questions, summary, response, mode, usage }
```

`questions[]` 由 `toProductQuestions` 映射，字段与 `normalizeUpstreamQuestion` 兼容：
`type`（智云词表）/ `stem` / `answer`（**字符串**）/ `choices[{label,text}]` /
`options`（choice 专用）/ `explanation` / `topic` / `difficulty`。

⚠️ **终态 RESULT 事件里必须去掉 `questions`。** 宿主
`adapters/quiz.js` 的 `extractRawQuestions` 会同时遍历
`summary.results[].qa_pair`（上游形状）**和**顶层 `questions` 数组（产品形状）。
两者同时存在时同一道题会被收两遍——产品侧表现为「请求 15 题，收到 30 题」，
且 `candidates` 里一半是重复。所以 `runDeepQuestion` **返回值**带 `questions`，
而发到 `stream.result` 的那份副本去掉了它。

⚠️ `answer` 必须是字符串：`validateNativeQuestion` 要求
`typeof answer === 'string' && answer.trim()`，给布尔或数组会在产品侧被当成格式错误。
所以 `concept` 的 `"true"`/`"false"` 被映射成 `"正确"`/`"错误"`；未命中的
（例如模型给了"部分正确"）**原样透传**，让下游明确拒收并记一条可读 diagnostic，
而不是在这里悄悄猜一个真假值。

### 13.2 降级链：`llm.runLabeledStep` → core-llm → 本包兜底三个实现遵守同一个 `finalMeta` 两态语义，所以换实现不改变"quiz 的裸 JSON 会不会刷屏"。
本包自带兜底（`src/labeled-step.js`）是为了让单测能在**不装齐五个包**的情况下跑通；
生产环境应注入 core-llm 的实现（它多了 `<think>` 前置状态机、usage 尾帧宽限、
provider 降级重试）。

core-tool 是**硬依赖**（循环/调度是骨架），core-llm 是**软依赖**
（`src/deps.js` 里 `.catch(() => null)`）。这个不对称是有意的：缺 core-llm 时
流水线还能跑，缺 core-tool 时连"循环"这个概念都不存在。

---

## 14. 预算：`10 + 2 + 9N` 的边界

| 阶段 | 上限 | 备注 |
|---|---|---|
| explore 主循环 | 8 | `DEFAULT_MAX_EXPLORE_ITERATIONS` |
| explore 强制收尾 | +2 | `FINALIZATION_REPAIR_ATTEMPTS` |
| **explore 小计** | **10** | |
| plan | 1（+1 若 reasoning_only） | |
| **plan 小计** | **2** | |
| 每题 quiz 主循环 | 5 | `DEFAULT_MAX_QUIZ_ITERATIONS_PER_QUESTION` |
| 每题强制收尾 | +2 | |
| 每题 repair | 1（+1 若 reasoning_only） | |
| **每题小计** | **9** | |

⇒ **N=15 时 147 次**。

⚠️ **不含 Tool Summarizer**：它理论上每次工具派发每条 tool message 一次
（8 轮 × 15 = 120）。把它算进预算会把正常的 15 题流水线提前掐断。

⚠️ 预算击穿时**不抛到最后**：本包在单题内捕获 `MODEL_BUDGET_EXCEEDED`，
用占位题补齐（`issues: ['model_budget_exceeded']`），题数仍与计划一致——
与「修复失败仍出题」是同一条语义。**只有 plan 阶段的硬失败会往上抛。**

---

## 15. 自检

```bash
node tests/core-question.test.mjs     # 54 项全绿
node --check src/index.js
node --check src/pipeline.js
```

用例覆盖（任务书点名六项 + 搬错点）：

1. 四阶段顺序（含 `onEvent` 序列、模型调用次数）
2. repair 空对象不覆盖原稿 + `pythonTruthy` 语义
3. 修复失败出占位题、题数不变
4. 类型话术（明确否定 `"auto"`）
5. `_t` 三态（含真实提示词包 54 key 全可渲染）
6. 调用次数上限（3 次预算 → 5 题里 2 题正常 + 3 题占位）
7. quiz 裸 JSON 不刷屏 / explore 前言逐 chunk 上屏
8. `question_type` 以 template 覆盖模型值
9. plan 空模板抛错 / 数量不足只警告 / reasoning_only 降思考重问
10. mimic 模式跳过 explore+plan、response 回退 markdown
11. 工具链：真派发、结果被概括后才进轨迹、工具抛错不中断
12. 两套解析器的强弱差异（fenced / `<think>` / 最长值 / 无 repair）
13. 产品形状：`stem`/`answer`/`choices`/`type` 与 `concept → trueFalse` 映射
14. 协议矩阵四个阶段与上游一致
15. `useNativeTools` 对云端 provider 乐观一档（本地 provider 不信）
