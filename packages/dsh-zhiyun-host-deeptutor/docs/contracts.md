# DeepTutor 宿主服务契约（v1）

本文件是 `dsh-zhiyun-host-deeptutor` 与所有业务包之间的**唯一接口真源**。修改本文件前先确认所有下游包能同步。

- 服务名：`zhiyunDeepTutor`（Cordis 服务键 `ctx.zhiyunDeepTutor`）
- 包名：`dsh-zhiyun-host-deeptutor`
- 上游快照：`vendor/deeptutor/`，版本见 `upstream.lock.json`
- 业务包**不得** import `vendor/` 下的任何 Python 或直接 spawn Python 进程。

---

## 1. 包内文件所有权

| 路径 | 负责方 | 说明 |
| --- | --- | --- |
| `docs/contracts.md`、`src/protocol.js` | 集成人（Lead） | 契约真源，其他人只读 |
| `package.json`、`cordis.patch.yml`、`README.md`、`upstream.lock.json`、`distribution.json` | Lead | 注册与锁文件 |
| `python/**`、`patches/**`、`ATTRIBUTION.md`、`docs/upstream.md`、`docs/runtime.md` | 运行时流 | Python 侧桥与上游说明 |
| `src/index.js`、`src/service.js`、`src/runtime.js`、`src/models.js` | Node 流 | 进程生命周期、RPC、服务面、模型桥 |
| `src/resources.js`、`src/adapters/**` | 资源/业务流 | 资源桥与业务适配 |
| `docs/capabilities.md`、`src/capabilities.js` | Node 流 | 能力五态目录 |

---

## 2. 数据与进程边界

- 上游状态根由 `DEEPTUTOR_HOME` 决定，值必须是 `<profileContext.dir>/data/zhiyun-deeptutor/home`，
  于是上游数据落在 `<...>/data/zhiyun-deeptutor/home/data/user/...`。
  **禁止**把 `DEEPTUTOR_HOME` 指到 `vendor/deeptutor`（上游 `validate_runtime_home()` 会拒绝）。
- Python 解释器由 `resolvePython()` 决定，优先级：
  1. `<profileContext.dir>/data/zhiyun-deeptutor/python.json` 里记录的绝对路径（用户显式安装过）；
  2. 环境变量 `ZHIYUN_DEEPTUTOR_PYTHON`；
  3. 仓库内受管 venv：`<repoRoot>/.runtime/deeptutor-py<minor>/Scripts/python.exe`（Windows）或 `bin/python`；
  4. `py -3.11` / `py -3.12` / `py -3.13` 探测出的**非** 3.10 解释器。
  绝不写死开发者机器上的绝对路径；解析结果写进日志与 `status()` 供用户复核。
- 解释器版本必须满足 `>=3.11,<3.15`，否则 `status().state = 'unsupported-python'`。
- 依赖就绪判定：`<venv>/Lib/site-packages/deeptutor/__version__.py` 或 `importlib` 探针成功，且 `deeptutor` 可被 import。
- 进程模型：一个宿主服务实例最多一个常驻 Python 子进程；空闲 `idleTimeoutMs`（默认 10 分钟）后由 Node 侧优雅退出。
  子进程崩溃后不自动无限重启：记录 `restartCount`，超过 `maxRestarts`（默认 3）转 `crashed` 状态并上报可解释原因。

---

## 3. Stdio RPC 协议

传输：子进程 stdin/stdout，**换行分隔的 UTF-8 JSON**（NDJSON），UTF-8 无 BOM。stderr 原样进日志。

### 3.1 报文形状

```jsonc
// 客户端 → 服务端 请求
{"jsonrpc":"2.0","id":"c17","method":"turn.start","params":{}}
// 服务端 → 客户端 响应
{"jsonrpc":"2.0","id":"c17","result":{}}
{"jsonrpc":"2.0","id":"c17","error":{"code":-32602,"message":"...","data":{"kind":"E_UPSTREAM_ERROR","detail":{}}}}
// 服务端 → 客户端 通知（无 id）
{"jsonrpc":"2.0","method":"turn.event","params":{}}
// 服务端 → 客户端 反向请求（模型桥、配额桥）
{"jsonrpc":"2.0","id":"s5","method":"llm.stream","params":{}}
// 客户端 → 服务端 反向响应
{"jsonrpc":"2.0","id":"s5","result":{}}
{"jsonrpc":"2.0","id":"s5","error":{"code":-32000,"message":"...","data":{}}}
```

**id 命名规则**（避免碰撞）：Node 侧发起用 `c<N>`（N 自增十进制），Python 侧发起用 `s<N>`。
收到 `id` 以 `c` 开头且本地有 pending 的 → 是响应；以 `s` 开头 → 是反向请求，必须回响应。

### 3.2 反向请求（Python → Node）

| method | 用途 | 参数 | 返回 |
| --- | --- | --- | --- |
| `llm.stream` | 一次模型调用（流式聚合） | `{ callId, model, provider, temperature, maxTokens, reasoningEffort, messages, responseFormat, tools, timeoutMs }` | `{ content, toolCalls, usage:{input,output,total}, finishReason, model }` |
| `llm.complete` | 非流式模型调用 | 同上（无 callId 追踪，用 id） | 同上 |
| `quota.acquire` | 申请一个 worker 名额 | `{ scope, weight, runId }` | `{ granted:true, waitMs }` |
| `quota.release` | 归还名额 | `{ scope, weight, runId }` | `{}` |

流式期间 Python 侧可以边收边发 `llm.delta` 通知（见 3.3），但**最终结果只由对 `llm.stream` 的响应给出**。
Node 侧必须实现“未知 method 返回 error 而不是挂死”。

### 3.3 通知（Python → Node）

| method | 说明 |
| --- | --- |
| `turn.event` | 转发一条上游 `StreamEvent`（已带映射后的 `kind`）。**params 形状是 `{ runId, event }`，事件本体在 `params.event` 里**，不在 `params` 顶层 |
| `llm.delta` | `{ callId, text, kind:'text'|'reasoning' }`，仅供进度展示 |
| `run.result` | `{ runId, status, result, usage, error }`，一轮结束终态 |
| `log` | `{ level, message, fields }` |

`turn.event` 的 `event` 字段形状见 §5.1。写成 `{runId, event}` 而不是把事件摊平到 `params`，
是因为一条通知同时要带 run 归属（Node 侧据此路由到对应的 `runs.events()` 迭代器，多 run 并发时
不能靠"当前只有一个 run"猜）和事件本身；摊平会让 `runId` 与事件里可能出现的同名字段撞车。

---

## 4. Python 侧方法目录（Node → Python 请求）

| method | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `ping` | `{}` | `{ ok, pid, pythonVersion, deeptutorVersion }` | 健康检查，不触发上游 import 副作用以外的工作 |
| `status` | `{ probe?:boolean }` | `StatusReport` | 见 §7 |
| `capabilities` | `{}` | `{ capabilities: CapabilityEntry[] }` | 上游注册表 + 依赖探测 |
| `turn.start` | `{ runId, capability, content, sessionId?, workspaceId?, language?, config?, llm?, resources? }` | `{ turnId, sessionId, workspaceId }` | 立即返回，事件走通知 |
| `turn.attach` | `{ runId, turnId, afterSeq }` | `{ attached:boolean, replayed:number }` | 重连补发 |
| `turn.cancel` | `{ runId }` | `{ cancelled:boolean }` | |
| `turn.reply` | `{ runId, text?, answers? }` | `{ accepted:boolean }` | 对应 `wait_for_input` |
| `turn.result` | `{ runId }` | `{ status, result, usage, error }` | 终态快照，幂等 |
| `quiz.generate` | `{ runId, request }` | `{ turnId, sessionId }` | capability=`deep_question` 的语义化包装 |
| `reading.act` | `{ runId, request }` | `{ turnId, sessionId }` | capability=`immersive_reading` 的语义化包装 |
| `artifact.open` | `{ artifactId }` | `{ path, mimeType, size, sourceAnchor? }` | 只允许 `public_outputs` 与本次 run 的产物目录 |
| `shutdown` | `{ drain?:boolean }` | `{ ok:true }` | 收到后必须最终退出 |

`llm` 参数形状（运行快照的一部分，见 §8）：
```jsonc
{"provider":"...","model":"...","temperature":0.7,"maxTokens":4096,"reasoningEffort":null,"mode":"host"}
```

**`llm` 只落在 `llm_shim`，绝不写进上游 `TurnRequest.llm_selection`。** 这条容易搞错，写清原因：

上游 `llm_selection` 的语义是「从上游自己的 `data/user/settings/model_catalog.json` 里挑一条已配置的
profile/model」——`services/session/turns/request_preparer.py:551-566` 会拿 `{profile_id, model_id}` 调
`apply_llm_selection_to_catalog()`，条目不存在就抛
`RuntimeError: Invalid LLM selection: selected profile/model was not found.`，而此时 `turn.start` 直接失败、
连一个事件都发不出来。宿主环境里那份 catalog 永远是空的（我们从不写上游 catalog、也不该写：凭证归宿主），
所以**任何非空 `llm_selection` 都必然把「宿主选了模型」变成「这次运行起不来」**。

我们的模型传输走的是另一条路：`python/llm_shim.py` 在运行时 patch `get_llm_config()` 与
`deeptutor.services.llm.complete/stream`，把模型调用变成反向请求 `llm.stream` / `llm.complete` 回到 Node 侧
`ctx.llm`（真 key 永不过桥）。`llm` 参数只需要 `llm_shim.set_selection()`，桥在 `app.start_turn()` 之前调用它
（`python/deeptutor_bridge.py` 的 `_start()`），每次 run 覆盖一次，避免上一轮快照漏进来。

可解释性不靠上游 catalog：`status().llmShim.selectedModel` / `selectedProvider` 就是这一轮实际用的模型。
桥的 `turn.start` 回执额外带 `llmSelectionUsed`（不进上游请求），便于日志对账。

`resources` 参数是已 attach 的资源句柄数组：`[{ handleId, resourceId, revision, snapshotPath }]`。
`snapshotPath` 是 Node 写出的**只读快照文件**绝对路径，Python 只读不写。

### 4.1 `turn.result` 的 `result` 形状随能力与上游版本变化

**桥不解析、不猜、不重排产物的内部结构。** 实测（真实 deepseek 跑通两次 `deep_question`）：

| 能力 | `result` 实测形状 |
| --- | --- |
| `deep_question`（custom 模式） | `{ response: "<markdown 正文>", summary: { success, source, requested, template_count, completed, failed, templates[], results[], analysis }, mode: "custom", metadata: { cost_summary } }` |
| 同上，另一轮 | `{ content: "<markdown 正文>" }` |
| `chat` / `ask_questions` 等 | 见上游 `emit_capability_result` 的 payload |

两条要点：

1. **`deep_question` 交回的是正文与信封，不是结构化题目数组。** 结构化解析归业务侧
   `packages/dsh-zhiyun-core-quiz/src/adapters/quiz.js`（及 `upstream.js` 的 `checkCandidate`）：
   它认 Markdown 里的题目块、做题型映射、跑验收；桥只保证「上游产出的东西完整到了 Node 侧」。
   谁在桥里猜形状，上游一改版就会静默丢题。
2. **产物的物理位置是 `metadata` 顶层，不是 `metadata["result"]`。** 上游
   `StreamBus.result(data)` 走 `merge_trace_metadata(data, metadata)`（`runtime/stream_bus.py:332`），
   把 `data` 的顶层键直接摊进 `metadata`，同时 `content` 是空串。所以桥的提取顺序是
   `metadata["result"]` → `metadata["payload"]` → 非空 `content` → 整个 `metadata`。
   只认前者线上表现就是「上游真出了题，桥交回空结果」——这条已经踩过一次，`--selftest` 有断言钉住。

`usage` 字段通常为 `null`：上游不发独立 `usage` 事件，成本在产物的
`metadata.cost_summary`（`{ total_cost_usd, total_tokens, total_calls, prompt_tokens, completion_tokens }`）。
要展示用量就读那里，别指望 `turn.result.usage`。

### 4.2 终态判定：只有 `done` 与 `error` 说了算

| 事件 | 职责 |
| --- | --- |
| `result` | **只收产物**。它的 metadata 是能力自己拼的，不带 `status`，不参与成败判定 |
| `error` | 判 `failed` 并写 `turn.error`（保留真实错误文案） |
| `done` | 用 `metadata.status` 定终态；非 `failed` 时**显式清空** `turn.error` |

`normalize_status(None)` 返回 `"running"` 而不是 `"failed"`：「上游没表态」和「上游说失败」是两件事，
混为一谈会让每个不带 status 的终态事件都触发同一次误判。曾经的线上表现是
`{ status:"succeeded", error:{ message:"上游以失败状态结束" } }` —— 自相矛盾的回执。
`--selftest` 的 `check_terminal_status()` 用四个场景钉住这张表。

---

## 5. 事件映射（上游 15 种 → 产品 kind）

上游 `deeptutor/core/stream.py` 的 `StreamEventType` 必须**全覆盖**，未知值一律 `diagnostic` 且**不得丢弃**。

| upstream type | kind |
| --- | --- |
| `stage_start` | `stage-start` |
| `stage_end` | `stage-end` |
| `thinking` | `thinking` |
| `observation` | `observation` |
| `content` | `content` |
| `tool_call` | `tool-call` |
| `tool_result` | `tool-result` |
| `progress` | `progress` |
| `sources` | `sources` |
| `result` | `result` |
| `error` | `error` |
| `session` | `session` |
| `session_meta` | `session-meta` |
| `done` | `done` |
| `wait_for_input` | `wait-for-input` |
| （其他/缺失） | `diagnostic` |

Node 侧对外事件对象：
```jsonc
{
  "runId": "run_...", "sequence": 12, "upstreamSequence": 12,
  "kind": "progress", "upstreamType": "progress", "stage": "planning",
  "taskId": null, "counts": {"done":3,"total":10}, "elapsedMs": 12345,
  "usage": {"input":0,"output":0}, "resourceRevision": "sha256:...",
  "content": "...", "metadata": {}, "at": 1730000000000
}
```
- `sequence` 由 Node 单调分配，**不能**用“假定调用次数”伪造进度。
- 上游字段 `metadata` 原样透传进 `metadata`。

---

## 6. 标准学习资源 schema v1

定义在 `packages/dsh-zhiyun-core-learning-resource/schema/learning-resource.v1.json`（JSON Schema 2020-12），
实现由该包提供：`validate(bundle)`、`contentHash(bundle)`、`project(bundle)`、`anchors(bundle)`。字段与临时规划一致：

```jsonc
{
  "schemaVersion": 1,
  "resourceId": "res_...",              // 稳定 ID，按 courseId+subId 派生
  "accountScope": {"accountId":"...","workspaceId":"..."},
  "courseId": "...", "subId": "...",
  "revision": "sha256:...",             // 内容哈希，派生资源的缓存键
  "contentHash": "sha256:...",
  "generatedAt": "2026-10-25T12:00:00.000Z",
  "title": "...", "language": "zh", "contentType": "lecture-v4",
  "chapters": [
    {"id":"ch1","title":"...","topics":[
      {"id":"t1","title":"...","blocks":[
        {"id":"b1","type":"paragraph|list|table|image|code|formula|question|callout",
         "text":"...","assetRef":"...","anchorIds":["a1"]}
      ]}
    ]}
  ],
  "selectedTopicIds": ["t1"], "selectedRanges": [{"topicId":"t1","blockIds":["b1"]}],
  "sourceAnchors": [{"anchorId":"a1","topicId":"t1","blockId":"b1","page":3,
                     "timeRange":{"startMs":0,"endMs":1000},"assetRef":null,
                     "confidence":0.9,"origin":"transcript|slide|manual"}],
  "warnings": [{"code":"MISSING_SLIDE","message":"...","anchorId":"a1"}],
  "sourceConfidence": 0.82,
  "reviewStatus": "draft|reviewed|approved"
}
```
- `revision` 必须由规范化后的内容计算（键排序 + 稳定序列化），保证同一内容跨机器同值。
- `selectedTopicIds`/`selectedRanges` 为空表示全量。
- 资源快照是**不可变**的；revision 变化即新快照。

---

## 7. 能力五态

```jsonc
{
  "name": "deep_question",
  "description": "...",
  "stages": ["exploring","planning","..."] ,
  "cliAliases": ["quiz"],
  "upstream": true,        // 上游注册表里存在
  "depsAvailable": true,   // Python + 依赖探测通过（math_animator 需 manim）
  "configured": true,      // 模型/搜索等必需配置就位
  "verified": false,       // 本机成功跑通过至少一次（落 capabilities-state.json）
  "exposed": true,         // 产品已开放给用户
  "installHint": "",
  "reason": ""             // 不可用时的可解释原因
}
```
`status()` 返回：
```jsonc
{
  "state": "ready|disabled|unsupported-python|deps-missing|not-installed|crashed|starting",
  "deeptutorVersion": "1.6.15",
  "python": {"path":"...","version":"3.11.9","source":"managed-venv|env|py-launcher|recorded"},
  "home": "...", "dataRoot": "...", "vendorPath": "...",
  "upstream": {"commit":"a31d826...","version":"1.6.15","archiveSha256":"bb9b..."},
  "process": {"pid":1234,"startedAt":0,"restartCount":0,"idleTimeoutMs":600000},
  "capabilities": [/* CapabilityEntry */],
  "warnings": []
}
```

---

## 8. 运行快照与指纹

`runs.start()` 生成 `RunRecord`：
```jsonc
{
  "runId":"run_...", "mode":"upstream-native|integrated-parallel",
  "capability":"deep_question",
  "resourceHandles":[{"handleId":"...","resourceId":"...","revision":"sha256:..."}],
  "input":{...},
  "llm":{...},                      // 运行快照，不可在 run 中变更
  "fingerprint":"sha256:...",       // 见下
  "quota":{"workers":4,"scope":"..."},
  "startedAt":0
}
```
指纹输入（键排序后哈希）：`resourceRevisions` + `upstreamCommit` + `llmConfigDigest` + `strategy` + `questionHistoryVersion` + `requestDigest`。
`runs.start` 若与已完成 run 指纹相同则返回 `cached:true` 与旧结果，不重复消费。

---

## 9. 错误 taxonomy

| kind | 场景 | 用户可见文案要点 |
| --- | --- | --- |
| `E_DISABLED` | 服务未启用 | 说明在哪开启 |
| `E_PYTHON_MISSING` | 找不到解释器 | 给安装路径与命令 |
| `E_PYTHON_VERSION` | 版本不在 3.11–3.14 | 给当前版本 |
| `E_DEPS_MISSING` | vendor 依赖未装 | 给 pip 命令 |
| `E_BRIDGE_UNAVAILABLE` | 子进程起不来/协议握不上 | 给 stderr 摘要 |
| `E_CAPABILITY_UNAVAILABLE` | 五态未就绪 | 给 `reason` |
| `E_UPSTREAM_ERROR` | 上游抛异常 | 带上游 traceback 尾部 |
| `E_TIMEOUT` | 模型或 turn 超时 | 给超时值 |
| `E_CANCELLED` | 被取消 | |
| `E_PROTOCOL` | 报文不合规 | 内部错误，日志给原文 |
| `E_QUOTA` | 配额取不到 | 给上限 |
| `E_INTERNAL` | 我们自己的代码到了不该到的状态（注入缺失、契约被违反） | 这是本仓的缺陷，不是用户的配置问题 |
| `E_RESOURCE_INVALID` | 调用方交来的学习资源不符合 schema | 指出 JSON Pointer 路径 |

最后两种是**刻意分开**的：它们描述的是「本地自身的问题」，不是上游失败。若被归到 `E_UPSTREAM_ERROR`，
重试逻辑会去重试一个永远失败的请求（schema 不合规的输入重试一万次也不会变合规），而日志里也失去了
「到底是上游坏了还是我们喂错了」这条线索。`DeepTutorError` 对未登记的 kind 仍然兜底归一为
`E_UPSTREAM_ERROR`，所以新增 kind 时必须同时改这里与 `src/protocol.js` 的 `ERROR_KINDS`。

所有错误对象：`{ kind, message, detail? }`；`message` 用中文，不含绝对路径（除 `python` 相关给用户定位用）。

---

## 10. 配额（§7.3 落地）

- 用户按“供应商/模型行”配置 `workers`，总上限 `Σ row.workers`。
- Node 侧维护全局信号量 `Σ workers`；`quota.acquire/release` 由 Python 在**每次模型调用前**发起。
- 一个 worker = 一个在飞模型请求；不等于 Python 进程，也不等于一道题。
- 必须防“Node 池 × Python 池”相乘：Node 传给 Python 的并发上限 = `min(row.workers, globalLimit)`，
  Python 侧 `max_concurrency` 同步收紧到同一个值。
- 取不到名额时 `quota.acquire` 阻塞等待，超时抛 `E_QUOTA`。

---

## 11. 服务面（`ctx.zhiyunDeepTutor`）

```js
{
  status(): Promise<StatusReport>,
  capabilities(): Promise<CapabilityEntry[]>,
  resources: { attach(bundle): Promise<Handle>, release(handleId): Promise<void>, get(handleId) },
  runs: {
    start(request): Promise<RunRecord>,        // request: { capability, resourceHandles, input, options, scope }
    events({ runId, afterSeq }): AsyncIterable<Event>,
    cancel(runId), reply({ runId, requestId, answer }), result(runId)
  },
  quiz: { generate(request): Promise<QuizResult> },
  reading: { act(request): Promise<ReadingResult> },
  artifacts: { open(handle) },
  dispose(): Promise<void>
}
```

所有方法在服务不可用时**抛** `E_DISABLED`/`E_BRIDGE_UNAVAILABLE`，由业务包决定降级；
宿主插件本身在 `apply()` 中**永不因上游缺失而抛错**（否则整个工作台挂掉）。

---

## 12. 可观测与验证证据

每次 run 落 `data/zhiyun-deeptutor/runs/<runId>/`：
`request.json`、`events.ndjson`、`result.json`、`usage.json`、`diagnostics.ndjson`（未映射事件 + stderr 摘录）。
`capabilities-state.json` 记录每能力最近一次成功时间与该次 runId —— 这是“已验证”的唯一来源，禁止手工置真。

---

## 13. 模块导出清单（并行开发的接口边界）

每个模块**只由一位负责人写**，其他人按这里的签名调用。签名变更必须先改本节。

### `src/runtime.js` — 负责人：Node 运行时流

```js
export class PythonBridge extends EventEmitter {
  constructor({ pythonPath, vendorPath, homeDir, env, logger, requestTimeoutMs });
  async start();                       // 起子进程 + ping 握手；失败抛 DeepTutorError
  async stop({ drain = true } = {});
  get state();                         // 'stopped'|'starting'|'ready'|'crashed'
  get info();                          // { pid, startedAt, pythonVersion, deeptutorVersion }
  async request(method, params, { timeoutMs, signal } = {});  // 见 §4 方法目录
  onNotification(handler);             // handler({ method, params }) —— 通知
  onRequest(handler);                  // handler(method, params) -> Promise<result> —— 反向请求
  onExit(handler);                     // handler({ code, signal, stderrTail })
}
export async function resolvePython({ profileDir, rootDir, env, logger });
// 返回 { path, version, source: 'recorded'|'env'|'managed-venv'|'py-launcher', ok, reason }
export async function probeVendorDeps({ pythonPath, vendorPath, env });
// 返回 { installed: boolean, deeptutorVersion|null, missing: [], reason }
export function ndjsonReader(stream); // 返回 async iterator<unknown>
```

### `src/models.js` — 负责人：Node 运行时流

```js
export function createLlmBridge({ llm, attachments, selection, quota, logger });
// 返回 { handleRequest(method, params) -> Promise<object>, dispose() }
// 支持 method: 'llm.stream' | 'llm.complete'，内部用 ctx.llm.resolveModelInfo / prepareCall / prepared.stream
// 必须把宿主 chunk 协议(text-delta/usage/finish)聚合成 §3.2 的返回形状；
// tool-call-delta 不得静默丢弃（聚合成 toolCalls 返回）。
export function toHostMessages(messages);  // 上游 messages -> 宿主消息数组（含 image part 映射）
```

### `src/capabilities.js` — 负责人：服务面流

```js
export const FIVE_STATES;            // ['upstream','depsAvailable','configured','verified','exposed']
export function createCapabilityCatalog({ bridge, expose, configured, stateFile, logger });
// 返回 { list(): Promise<CapabilityEntry[]>, get(name), markVerified(name, runId),
//        isExposed(name), dispose() }
// expose / configured 是普通对象 { [capabilityName]: boolean }，由 index.js 的 config 给出
// stateFile 是 capabilities-state.json 的绝对路径（verified 状态的唯一来源）
export function decorate(five, { name, description, stages, cliAliases });
```

### `src/service.js` — 负责人：服务面流

```js
export function createService({ bridge, llmBridge, catalog, resources, runStore, config, logger });
// 返回契约 §11 的完整服务对象（status/capabilities/resources/runs/quiz/reading/artifacts/dispose）
// runs.events 返回 AsyncIterable<Event>，支持 afterSeq 重放
// 必须实现运行快照、指纹、指纹命中返回 cached:true（契约 §8）
```

### `src/run-store.js` — 负责人：Lead（已完成）

```js
export function createRunStore({ runsDir, logger });
// { dir(runId), writeRequest, appendEvent, appendDiagnostic, writeResult,
//   writeUsage, readResult, readEvents, close(runId), closeAll() }
// 所有写操作内部吞错并回调 logger（盘满时宁可丢证据也不丢用户结果）。
export function stableJson(value);   // 键排序 + 2 空格 + 末尾换行，供指纹复用
```

### `src/resources.js` — 负责人：资源流

```js
export function createResourceRegistry({ dataDir, validate, contentHash, logger });
// 返回 { attach(bundle) -> handle, release(handleId), get(handleId), snapshot(handleId), dispose() }
// handle: { handleId, resourceId, revision, snapshotPath, accountScope, courseId, subId }
export function toUpstreamResourcePayload(handle, bundle);
// 上游 TurnRequest 里的 reading_references / 正文注入用的紧凑结构
```

### `src/index.js` — 负责人：Lead

```js
export const name = 'zhiyun-deeptutor';
export const inject = ['profileContext'];
export function apply(ctx, config = {});
// 永不因上游缺失抛错；ctx.provide('zhiyunDeepTutor', service)
```

### `src/adapters/quiz.js` — 负责人：服务面流

```js
export const QUESTION_TYPE_MAP;   // 上游题型 -> 智云 core-quiz 题型（见下）
export const JUDGE_TYPE;          // 'trueFalse'
export const JUDGE_ALIASES;       // { judge/trueFalse/tf/true_false -> 'trueFalse' }
export function isJudgeType(value);
export function toQuizCandidates({ capabilityResult, runId, resourceRevision, resourceAnchors });
// -> { questions: CandidateQuestion[], diagnostics: [] }
// CandidateQuestion 必须保留 rawType / rawOutput / modelSnapshot / anchors / taskId
```

**题型映射的硬要求**：上游主流水线 `agents/question/pipeline.py:156 class QuestionType(StrEnum)` 只有
`choice` / `concept` / `fill_in_blank` / `short_answer` / `written` / `coding` 6 个；其中
`concept` 的正确答案被规范成 `"true"/"false"`（pipeline.py:1436-1445），并有
`concept_must_not_have_options`、`concept_correct_answer_must_be_true_or_false` 两条校验
（pipeline.py:1471-1475）—— **所以 concept 是判断题，绝不是"概念填空"**。
智云落盘代号必须用 `trueFalse`（`core-quiz/src/strategies.js` 的 `QUESTION_TYPES` 与
`core-quiz/src/points.js:90` 只认这个），不得用自造字符串。
`services/practice/importing.py` 另有一套题型（single_choice/multi_choice/true_false/fill_blank/short_answer/essay），
属于另一条刷题导入流水线，登记时须注明来源，不得与主流水线混为一谈。未知题型一律 `unknown` 并进 diagnostics。

### `packages/dsh-zhiyun-core-learning-resource/src/index.js` — 负责人：资源流

```js
export const name = 'zhiyun-learning-resource';
export const inject = [];
export function apply(ctx, config = {});
// ctx.provide('zhiyunLearningResource', { schema, validate, contentHash, project, anchors });
```

### `python/deeptutor_bridge.py` — 负责人：Python 运行时流

按 §3 实现 NDJSON RPC 主循环；对外只暴露 `main()`，通过 `python -m deeptutor_bridge` 或 `python python/deeptutor_bridge.py` 启动。
必须支持 `--selftest`（不连上游，跑协议自检并退出码 0）。

### `python/llm_shim.py` — 负责人：Python 运行时流

把上游 `deeptutor.services.llm.complete/stream` 重定向到桥反向请求 `llm.stream`。**不得**修改 vendor 文件（用运行时 monkeypatch 或 `patches/` 可重放补丁）。

**必须同时 patch `get_llm_config()`**，返回一份合成的 `LLMConfig`（`provider_name` / `binding` 用上游
`ProviderSpec(name="custom", backend="openai_compat", is_direct=True)`，`api_key` 放占位值，真 key 永不过桥）。
原因不是"顺手"，而是**上游能力代码在 `run()` 的第一行就读它**：`agents/question/capability.py:39-42`
`from deeptutor.services.llm.config import get_llm_config; llm_config = get_llm_config()`，
早于 topic 校验、早于任何 provider 调用；`agents/question/pipeline.py:82+420` 的 `self.llm_config = get_llm_config()`
同样如此。原装 `get_llm_config()` 在 catalog 为空时抛
`LLMConfigError: No active LLM model is configured. Please set it in Settings > Catalog.`
——只 patch `complete/stream` 的话，一个反向请求都等不到，出题在第一步就死。

同理 `CONSUMER_MODULES` 必须包含 `deeptutor.agents.question.pipeline`：它用
`from deeptutor.services.llm import get_llm_config` 把名字绑进了自己的模块命名空间，只改
`deeptutor.services.llm` 那个模块是 patch 不到的。

没有运行快照时 `get_llm_config()` **仍要抛**（不能静默返回空配置），文案指向宿主设置
（「宿主未选择模型：请在工作台的模型设置里选一个供应商与模型行」），这样能力五态里的 `configured` 才有真实落点。

