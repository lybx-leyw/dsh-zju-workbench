# dsh-zhiyun-core-tool · 上游行为笔记

> 这是从 `vendor/deeptutor/deeptutor/` 逐行读出来的**行为事实**，不是设计建议。
> 后面维护这个包的人，先看这份，再改代码。每条都注了上游文件与大致行号。
> 标 ⚠️ 的是「看起来可以简化、一简化就掉分/报错」的那些。

---

## 0. 这个包负责的边界

| 本包模块 | 上游来源 |
|---|---|
| `src/schema.js` | `core/tool_protocol.py` 的 `ToolParameter` / `ToolDefinition` / `ToolResult` |
| `src/trace.js` | `core/trace.py` |
| `src/stream.js` | `core/stream.py` |
| `src/stream-bus.js` | `runtime/stream_bus.py` |
| `src/arg-guard.js` | `runtime/agentic/tool_arg_guard.py` |
| `src/dispatch.js` | `runtime/agentic/tool_dispatch.py`（956 行，本包重点） |
| `src/loop.js` | `runtime/agentic/loop.py` + `labels.py` |
| `src/messages.js` | `runtime/agentic/messages.py` |
| `src/registry.js` | `runtime/registry/tool_registry.py` + 本包契约 |
| `src/context.js` | `core/context.py` |
| `src/capability.js` | `core/capability_protocol.py` + `runtime/capability_catalog.py` |
| `src/request-contracts.js` | `runtime/request_contracts.py` |
| `src/json.js` | `utils/json_parser.py`（只取工具参数那条路径） |
| `src/home.js` | `runtime/home.py` |

**不在本包**：`labeled_step.py`（一次流式 LLM 调用 + 标签路由，属于 core-llm 的
流式接口）、`client.py`（provider 能力判定）、`usage.py`。

---

## 1. 工具 schema：三条容易漏的规矩

### 1.1 `required` 默认是 **true**

```python
required: bool = True   # tool_protocol.py:33
```

反直觉，但必须照搬：写成「默认可选」会让提示词里承诺必填的参数在 schema 里
变成可选，模型于是真的不填，然后被 arg guard 拒。

### 1.2 `array` 必须带 `items`

```python
if self.type == "array":
    schema["items"] = self.items if self.items is not None else {"type": "string"}
```
（`tool_protocol.py:72-73`）

注释写得很直白：**Gemini 会因为缺 `items` 直接 400**，OpenAI 只是宽容。
所以哪怕调用方只写 `{type:'array'}`，也必须产出 `items`。

### 1.3 `nullable` 展开成 `[type, "null"]`

```python
"type": [self.type, "null"] if self.nullable else self.type
```
（`tool_protocol.py:59`）

理由（原文 issue #1928）：有些端点把 optional property 归一化成 required，
此时模型**必须**给一个真值，否则就会退化成占位符（`"N/A"`）。给 `null` 一个
合法的表示，是把占位符挡在外面的唯一办法。

### 1.4 ⚠️ `parameters` 是对象时按 `raw_parameters` 处理

上游优先 `raw_parameters`（MCP 适配器用），完全跳过 `ToolParameter` 重编码 ——
任意 JSON Schema 重编码成参数行会丢信息（`oneOf`、`$ref`、`additionalProperties`）。
JS 版沿用同一条判定：**`parameters` 是普通对象就当完整 schema 透传**。

---

## 2. 参数守卫：它**不**校验类型

`arg_guard.py` 的全文只做两件事：

1. **必填参数没来**（`absent`）；
2. **必填参数来了但是空串**（`blank`）。

唯一的 schema 求值在「值显式为 `null`」时（`_allows_null`，`:72-92`），而且
只求值 `null` 一项，不求值工具的完整校验契约。

### 2.1 ⚠️ 类型错误照样派发

`{"count": "五"}` 会被**原样**交给工具。原因写在模块 docstring 里：守卫要
「deliberately free of dispatcher, registry, and stream concerns」，保持可单测。
类型不对的调用由工具自己拒绝，工具抛错再由调度层转成 `role=tool` 错误文本。
我们用一条测试把这条钉住了（`wrong arg TYPES are not policed by the guard`）——
如果哪天有人"顺手"加上类型校验，那条测试会红。

### 2.2 ⚠️ 空集合**不**算缺席

```python
if isinstance(value, str) and not value.strip(): return False
return True
```
（`_is_supplied`，`:55-69`）

`[]` / `{}` 对数组/对象参数可以是**刻意给的值**（"没有标签"），拒绝它们会挡掉
本来能跑通的调用。只有 `None`、空白串算缺席。

### 2.3 缺席 vs 空串的**措辞必须不同**

`:141-166` 的 `unsatisfied_required_args` 把两者拆开，是因为 thinking 模型
有时**故意**传 `""`（先搭骨架后填内容）。把它说成 "missing" 与模型自己对这次
调用的认知矛盾，会诱发逐字重复（issue #1101）。

两条文案的差别是硬性的：

- 缺席：`` `tool` was called without its required argument(s): `x`. Expected: x (string). ``
- 空串：`` `tool` received empty value(s) for required argument(s): `x`. Those keys were present but blank — supply non-empty content (do not re-emit the same empty string). ``
- 两者都以这句话收尾：`Re-emit the call with those arguments filled in; an identical call with empty arguments will be rejected again without running.`

最后那句是**关键**：模型在这个失败模式下的动作是逐字重试，不是重读 schema。
不说清楚，它就会把同一个畸形调用再发 5~7 次（真实报告：一次回合里 7 个
`write_note` 有 5 个空着来）。

### 2.4 被拒的调用也要给子 trace 收终态

`tool_dispatch.py:490-508`。用的是 `stream.progress` 而**不是** `stream.error`：

> a stream ERROR makes a partner turn re-run the whole turn on its backup model

也就是说，一次可恢复的单调用纠偏如果标成 ERROR，会让整轮在有副作用的工具上
重跑一遍。这条在 `execute_tool_call` 的抛错路径（`:813-837`）里同样成立，只有
检索路径（`retrieve_meta` 存在时）保留 ERROR —— 那条路径早于本约定且没有副作用。

---

## 3. 调度：三阶段顺序不能换

`tool_dispatch.py:300-338` 的核心结构：

```
1. rebinding tools（串行）→ 其余调用重绑
2. 其余调用（并发）
3. pausing tools（串行，先重绑一次）
```

### 3.1 为什么每个参数都在**任何**调用执行前绑好

`_prepare_tool_args`（`:519-551`）在 `_run_one` 之前就为所有调用算好 `exec_args`。
于是「改变这一轮作用对象」的工具（掌握度路径、工作区）如果不先跑并让受影响的
调用重绑，那些调用还指着这一轮开始时的状态。

`_rebind`（`:276-298`）从**模型的原始参数**重新绑定，不是从已绑定的结果上打补丁 ——
这样「重绑」与「第一次绑定」完全一样幂等，任何阶段边界都能重绑。

### 3.2 ⚠️ 暂停类工具最后跑，并**再**重绑一次

```python
PAUSE_LAST_TOOLS = frozenset({"ask_user", "workspace_export"})   # :60
```

注释（`:55-59`）：模型在同一轮里既提问又显示卡片时，卡片否则会在问题还不存在的时候
就绑好，于是带不上它的持久化版本。

### 3.3 ⚠️ 每批 15 个调用的上限，超出的**仍然要有** `role=tool` 回复

```python
MAX_PARALLEL_TOOL_CALLS = 15   # :53
```
（`:349-365`）

> Both Chat Completions and Responses require an output for each id, even when
> the execution limit skips it; otherwise the next round AND hard finish fail.

所以跳过的那几条要补一条「本轮上限 15，需要就下一轮再发」的 `role=tool`。
**每条 id 都必须有回复**这条规则在 `_collect_outcome`（`:907-914`）里也适用：
重复调用、被守卫拒绝的调用、抛错的调用，全都各有一条。

### 3.4 去重的两条规则

`_detect_duplicate_calls`（`:369-401`）：

- 普通工具：`(工具名, JSON 规范化后的参数)` 相同才算重复。
- **暂停类工具更严**：这一批里第一个暂停调用是主调用，之后**任何**暂停调用都
  映射到它，不管名字和参数 —— UI 与暂停/恢复运行时每批只支持一张待处理卡片。

重复调用不是直接丢掉，而是回一条给模型看的指令（`_duplicate_stub_result`，`:404-433`）：
"Do NOT emit two identical tool_calls in one assistant message — parallel calls must
differ in arguments."。

### 3.5 ⚠️ 结果按**原始顺序**回填，不是执行完成顺序

`:338  results = [by_index[index] for index in range(len(prepared))]`

`role=tool` 消息的顺序必须与 assistant 消息里 `tool_calls` 的顺序一致，否则下一轮
provider 会拒。我们的测试用「slow 先发、fast 先完成」把这条钉住了。

### 3.6 事件顺序：所有 `tool_call` 先发完，再发任何 `tool_result`

`:192-222` 是第一个循环（只发 `tool_call`），`_collect_outcome` 在最后统一发
`tool_result`。所以一轮里前端的卡片是**一次性摆出来**的，不是执行到哪个冒哪个。

### 3.7 显示参数 ≠ 执行参数

`:202-212`，两条剥除规则：

- 服务端注入的私有 kwargs（`_sandbox_mounts` 之类，以下划线开头）：执行管道，
  不是显示参数，而且**可能不可 JSON 序列化**（一个 Mount dataclass 曾让 WS 推送
  与回合持久化同时崩掉）。
- 标了 `sensitive` 的参数：trace 是给工具所服务的那个人看的，一个 quiz 的
  `expected_answer` 只要隔着一个折叠三角就能看到，这道题就废了。

`ToolEventProjection`（`tool_protocol.py:154-163`）是服务端持有的公开投影：
**只接受这个类型的值**，模型自己给的 JSON 对象不能改变 trace 可见性。

### 3.8 `provider_kind` / `provider_id` 只给外部工具写

`:609-626`：内建工具整条字段**缺席**，于是「没有这两个字段」明确表示「不是外部
provider」，而不是「外部 provider 没识别出来」。别改成写空串 —— 两者语义不同。

---

## 4. 循环：终止条件与 `stream_body_live`

### 4.1 状态机

见 `src/loop.js` 文件头。要点：

- 协议违规 → 修复后**继续**（不终止）；
- 终止标签 → 可选 `validate_terminal`，通过才算终止；
- 工具轮 → 追加 assistant + tool，dispatch，然后看 `pause` / `terminate`；
- 中间标签 → 追加 assistant 作为上下文（可以被标成 final，那样正文推流但回合继续）；
- 预算耗尽 → `force_finalize`，它自己决定 `completed`。

### 4.2 ⚠️ `_PROTOCOL_*` 是四个不同的矩阵，不是一种

`agents/question/pipeline.py:110-135`：

| 协议 | allowed | terminal | intermediate | final | tool_label |
|---|---|---|---|---|---|
| `_PROTOCOL_EXPLORE` | THINK, TOOL, FINISH | FINISH | THINK | FINISH | TOOL |
| `_PROTOCOL_PLAN` | PLAN | PLAN | ∅ | **∅** | None |
| `_PROTOCOL_QUIZ` | THINK, TOOL, FINISH | FINISH | THINK | FINISH | TOOL |
| `_PROTOCOL_REPAIR` | FINISH | FINISH | ∅ | FINISH | None |

`_PROTOCOL_PLAN.final` 为空是**有意的**：plan 文本从不以流式正文出现，只作为
返回值解析。我们的 `runAgenticLoop` 把整张矩阵作为参数收下，`final` 为空就不
调 `emitFinal` —— 有测试钉住。

### 4.3 ⚠️ `stream_body_live` 一开一关是刻意的

`pipeline.py:695`（explore）`stream_body_live=True` → FINISH 正文明珠逐 chunk
推给前端，循环必须**跳过** `emitFinal`，否则推两遍。
`pipeline.py:937`（quiz）`stream_body_live=False` → FINISH 是一坨裸 JSON，
必须靠这个开关才不会把 `{"question_type": "choice", ...}` 刷到用户脸上；
那一路的 `emit_final` 是**故意空实现**（`:2281-2283`）。

### 4.4 修复轮要收**整个 step**，不只是文本

`loop.py:449-476`。Takes the whole step rather than its text so the round's
reasoning travels with the draft: a repair round is still a round, and a thinking
model's provider rejects a history that lost it.

截断长度 500，追加的标记是 **`\n...[truncated]`**（源码里是带反斜杠的字面量，
不是换行）—— 我们保留了同样的字符序列，否则复盘时对不上。

### 4.5 推理必须跟着 assistant 轮走

- DeepSeek thinking 模式：发起工具调用的那个 assistant 轮必须带回 `reasoning_content`（#1058）。
- Anthropic 扩展思考：返回的是**带签名**的 thinking blocks，必须逐字重放。
- Gemini 的 OpenAI 兼容端点：每个 function call 的 `extra_content`（不透明
  thought signature）必须原样发回（#1181）。

三条都是"漏了就第二轮被拒"，不是可选优化。

### 4.6 预算量级

出题整卷的模型调用量是 `10 + 2 + 9N`（N = 题数），单题约 9 次
（explore 最多 8 轮、plan 1 次、每题 quiz ≤5 + repair ≤2）。
`DEFAULT_MAX_ITERATIONS = 32` / `DEFAULT_MAX_ROUNDS = 32` 只是兜底，
**调用方必须显式传**，否则第 4 题往后会全部走强制收尾。
`pipelineModelCallBudget(n)` 就是给集成测试对账用的。

---

## 5. 流总线：顺序保证与可合并范围

### 5.1 三条顺序保证

1. `emit` 是单点串行的：**先 assign seq，再进 history，最后投递**，同一个同步段完成。
2. `subscribe` **先注册队列、再快照 replay 范围**。反过来的话，replay 期间 emit
   的事件会既走 history 迭代又走队列，投递两次（`stream_bus.py:135-144` 的注释
   就是在说这个）。
3. seq 只在 `assign_seq` 的总线上分配，从 1 开始。**直接调用者拿到的永远是 0**，
   所以「0 保持 0」是对外契约，不能拿它当「还没发过事件」。

### 5.2 可合并的事件

只有 `content` / `thinking` / `observation`，且必须**同 source + 同 stage + 同
call_id 且连续**。它们是逐 token 的正文增量，拼起来语义不变。

**不能合并**的（顺序本身有信息）：
- `tool_call` / `tool_result`：一次调用一张卡，合并会让两个工具挤进一行、`tool_call_id` 丢失；
- `sources` / `result` / `error` / `stage_start` / `stage_end`：状态转移，合并抹掉中间态；
- `wait_for_input`：阻塞点，合并等于把两次等待压成一次。

### 5.3 `result_completion` 的意义

"能力函数正常返回" ≠ "它要做的事做完了"。读最终 RESULT 的 `metadata.completed`；
字段缺席返回 `null`，由消费者沿用原有生命周期。嵌套的 / 工具结果里的 RESULT 不算。

---

## 6. 注册表：别名只在执行时生效

`tool_registry.py:98-117` + `tools/builtin_specs.py:234-239`：

```python
TOOL_ALIASES = {
    "pdf": ("read_source", {}),
    "rag_hybrid": ("rag", {"mode": "hybrid"}),
    "rag_naive": ("rag", {"mode": "naive"}),
    "rag_search": ("rag", {}),
}
```

合并次序是 `{**default_kwargs, **(kwargs or {})}` —— **默认值铺底、模型参数覆盖**。
别写反：模型显式说 `mode:"naive"` 时被别名默认值盖回去，是那种"看起来正常工作"
的 bug。

`get_enabled` 按**解析后的名字**去重（`:127-137`）：同一批入参里同时给 `pdf` 和
`read_source`，只能出一份 schema。

---

## 7. 请求契约：`extra="forbid"` 是产品行为

`request_contracts.py:47-62`。`DeepQuestionRequestConfig` 的关键约束：

- `mode ∈ {custom, mimic}`，默认 `custom`
- `num_questions: 1..50`，默认 1
- `max_questions: 1..100`，默认 10
- `question_types` / `per_type_counts` 默认空（空 = "随便挑"，不是"一个都不要"）

⚠️ **`per_type_counts` 的总和约束不在这一层校验**。上游交给流水线
（`_normalize_per_type_counts` 按允许类型过滤并重新分配），在这里拒绝会让前端
"多选题型时暂时不同步"的中间态直接 400。

未知字段一律拒绝：客户端拼错字段名要**尽早**知道，而不是安静地被忽略、然后表现为
"设置没生效"。

---

## 8. 与 pipeline-parity 契约的关系

`tests/pipeline-parity.test.mjs` 钉的是 **pipeline 层**（`_t` 三态、类型规范化、
repair 单轮、占位题保留）。本包的 `tests/core-tool.test.mjs` 钉的是**它下面那层**：

- 标签矩阵是参数（不是一个常量）—— `runAgenticLoop terminates on the
  protocol-specific terminal label`；
- `streamBodyLive` 开关语义 —— `runAgenticLoop skips emitFinal when streamBodyLive is on`；
- 预算量级 —— `runToolLoop handles the whole question-pipeline budget (10 + 2 + 9N calls)`。

三层（pipeline-parity / core-tool / 集成）不应该有重叠断言，否则改一处要改三个地方。

---

## 9. 已知的取舍（不是遗漏）

1. **`labeled_step` 没搬进本包。** 它是一次流式 LLM 调用 + 标签路由，属于
   core-llm 的流式接口；本包的 `runAgenticLoop` 通过 `runLabeledStep` 回调使用它，
   `step` 的形状是 `{label, text, toolCalls, reasoningContent, thinkingBlocks}`。
2. **`json_repair` 依赖没搬。** 上游在最后一级调第三方 `json-repair`。本仓不允许
   新依赖，所以只保留了「去尾随逗号 + 控制字符转义」这一级最小修复；真正的难点
   （围栏、`<think>` 前言、散文夹载荷）都在它之前处理掉了。
3. **`stream_bus` 没有按事件循环分队列。** 上游这么做是为了桌面/TestClient 宿主
   在不同 loop 上服务 socket。Node 是单线程事件循环，不存在这个问题。
4. **MCP / 插件的工具发现不在本包。** `load_plugins` / `deferred_tools` 的
   渐进披露机制保留了 `deferred` 标记与 `deferredTools()`，但装载由集成层注入。
