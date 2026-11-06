# 运行时层：Python 桥与模型桥

本文件说明 `src/runtime.js`、`src/models.js`、`python/**` 三层怎么协作，以及**为什么**这么实现。
协议字段本身以 [contracts.md](./contracts.md) 为准；本文只补充契约没写的实现约束与踩过的坑。

---

## 1. 三层分工

```
┌────────────────────────────────────────────────────────────────┐
│ src/index.js          插件装配：resolvePython → PythonBridge   │
│                       → createLlmBridge → createService        │
├────────────────────────────────────────────────────────────────┤
│ src/runtime.js        Python 子进程生命周期 + NDJSON JSON-RPC  │
│   PythonBridge        握手 / 请求分发 / 反向请求 / 通知 / 降级  │
│   resolvePython       解释器解析（受管 venv → env → 记录 → py） │
│   probeVendorDeps     vendor 依赖探测（import deeptutor）       │
│   ndjsonReader        半包/多包/坏行切分                       │
│   createWorkDir       运行期工作目录                           │
│   runCapture          一次性命令捕获（探测用）                 │
│   isSupportedPythonVersion  3.11–3.14 白名单                   │
├────────────────────────────────────────────────────────────────┤
│ src/models.js         宿主模型 → 桥的模型桥                    │
│   createLlmBridge     llm.stream / llm.complete 反向请求应答   │
│   toHostMessages      上游 messages → 宿主 messages            │
├────────────────────────────────────────────────────────────────┤
│ python/deeptutor_bridge.py   JSON-RPC 主循环 + 方法目录        │
│ python/llm_shim.py           接管上游五个模型入口（含 agentic）│
│ python/capabilities_probe.py 独立能力/依赖探测（可单跑）       │
└────────────────────────────────────────────────────────────────┘
```

三个**只读**依赖：`src/protocol.js`（常量唯一真源）、`vendor/deeptutor/**`（上游快照，禁止改）、
`upstream.lock.json`（版本事实）。Python 侧常量必须与 `src/protocol.js` 逐字节一致，
由 `tests/deeptutor-bridge.test.mjs` 里读 `python/deeptutor_bridge.py --dump-protocol` 的那条用例守着。

---

## 2. PythonBridge：进程与传输

### 2.1 构造参数

```js
new PythonBridge({
  rootDir,            // 包根目录（找 python/ 脚本）
  pythonPath,         // 可省略；省略则内部调 resolvePython
  vendorPath,         // vendor/deeptutor
  homeDir,            // DEEPTUTOR_HOME 的值（调用方给，禁止写死绝对路径）
  profileDir,         // 可选；resolvePython 找记录用
  transport = 'auto', // 'auto' | 'pipe' | 'files'
  spawnImpl = spawn,  // 注入点：受限环境/测试用假实现
  logger,
  startTimeoutMs = 30_000,
  requestTimeoutMs = 900_000,
})
```

### 2.2 为什么要注入 `spawnImpl` 与 `transport`

真实部署是 `stdio: ['pipe','pipe','pipe']`。但**受限沙箱下 pipe 会直接 `EPERM`**
（受限模式不允许程序开命名管道），`spawn` 会同步抛 `EPERM spawn EPERM`。

所以：

- `default` 传输 = 管道，**生产路径，行为不变**；
- `files` 传输 = `stdio: ['ignore', outFd, errFd]` + 轮询 `<workdir>/bridge-in.ndjson` /
  `bridge-out.ndjson`，**仅用于受限环境自检与调试**；
- `'auto'`（默认）= 先试管道，捕获到 `EPERM` 就降级到 `files`，并记一条 `warn`
  （降级是事实，必须留痕，不能悄悄换实现）。

`src/runtime.js` 里**所有** spawn 点都走同一个注入点，没有第二处 `spawn(...)`；
禁止用 `exec` 或 shell 拼接绕过 —— 那是换了个坑，不是解决问题。

### 2.3 状态机

`state()` 返回：`idle` → `starting` → `ready` → `crashed` / `stopped`。

握手：连上后立刻发 `ping`，校验 `result.protocolVersion === PROTOCOL_VERSION`。
**版本不符直接拒绝并抛 `E_PROTOCOL`**，不做兼容猜测 —— 常量表一旦错位，
后面每个字段名都可能错，早失败比晚错乱好排查。

### 2.4 反向请求（Python → Node）

`llm.stream` / `llm.complete` / `quota.acquire` / `quota.release` 由 Python 侧发起。
`PythonBridge` 收到后按登记顺序问订阅者（`attachTo` / `handleRequest` 返回 `undefined`
表示「不是我的」，继续问下一个）。全部都不认时**必须**回 `-32601`，
错误响应也要回 —— 挂死会让整条出题流水线永久卡住。

---

## 3. models.js：模型桥

```js
const llmBridge = createLlmBridge({
  llm: () => ctx.get('llm') ?? ctx.llm,   // LlmRuntime，惰性取
  attachments: () => ctx.get('attachments'),
  getSelection: () => ({ provider, model, temperature, maxTokens, reasoningEffort }),
  logger,
});
const detach = llmBridge.attachTo(bridge);
```

调用链与 `packages/dsh-zhiyun-core-parser/src/llm.js` 的 `HarnessLlm` 完全一致：

1. `ctx.llm.resolveModelInfo(provider, model, signal)` 校验供应商/模型存在；
2. `ctx.llm.prepareCall(config, signal)` 拿 `prepared`；
3. `prepared.stream({ ...prepared.config, messages, signal })` 逐 chunk 消费。

聚合规则（契约 §3.2 的返回形状）：

| 宿主 chunk | 聚合到 |
| --- | --- |
| `text-delta` | `content` |
| `reasoning-delta` | `reasoning`（不计入 content） |
| `tool-call-delta` | `toolCalls[]`（按 `index` 累加 `argumentsDelta` 字符串） |
| `usage` | `usage: { input, output, total }`（宿主三个计数字段互不重叠） |
| `finish` | `finishReason`（`reason.kind`） |

**`tool-call-delta` 不得静默丢弃** —— 丢了工具调用上游会当成模型没吐工具，
错误表现为「模型什么都不做」而不是报错，极难排查。

未配置模型时（`resolveModelInfo` 抛错或 selection 为空）按五态回
`E_DISABLED` / `E_CAPABILITY_UNAVAILABLE`，**不要**崩溃：
服务面要能把「没配模型」如实翻译成用户可读的提示。

---

## 4. python/deeptutor_bridge.py

### 4.1 结构

- `Transport` 抽象：`StdioTransport`（管道）/ `FileTransport`（NDJSON 文件轮询）/ `MemoryTransport`（自检）。
- `Upstream`：**惰性**持有 `DeepTutorApp`。`--selftest` 全程不 import 上游，
  所以 pip 没装完也能跑（自检里有一条用例断言 `deeptutor` 没进 `sys.modules`）。
- `Bridge`：JSON-RPC 主循环 + 方法目录 + turn 生命周期。

### 4.2 启动序列

`Upstream.app()` 里，**构造 `DeepTutorApp()` 之前**按顺序做三件事（都在同一把锁内，
所以并发 `turn.start` 也只会播种一次）：

1. `ensure_vendor_on_path()` —— 把 `vendor/deeptutor` 塞进 `sys.path`。
2. `reset_runtime_singletons()` —— 让所有「跟 home 绑定」的上游单例
   （`PathService` / `RuntimeSettingsService` / `ModelCatalogService`）失效。
   桥是在 `main()` 里把 `--home` 写进 `os.environ` 的，若进程里有模块已按旧 home
   建过单例，不重置就会播种到另一个目录去（上游 `runtime/launcher.py:1432` 同样调它）。
3. `bootstrap_upstream_settings()` —— 替上游 launcher 调一次首次运行播种，见 §4.3。

然后才 `DeepTutorApp()`。

### 4.3 上游首次运行播种（为什么桥必须自己调）

上游把「准备运行时配置」放在**自己的入口**里，而不是 `DeepTutorApp` 构造里：
`runtime/launcher.py:1440-1443` 与 `api/main.py:522-524` 都是先
`init_user_directories(runtime_home)` 再 `ensure_runtime_settings_files()`，然后才起服务。

我们的桥是「把上游当库用」，直接从 `DeepTutorApp()` 开始 —— 于是
**CLI/Web 能跑、当库用就少一半初始化**。缺的现场表现：

- 缺 `main.yaml`：`agents/question/capability.py:147` / `:234` 调
  `load_config_with_main("main.yaml")`；`services/config/loader.py:86-108`
  **没有任何兜底、不读包内默认值**，直接
  `FileNotFoundError: Configuration file not found: main.yaml`。出题在第 2 个事件就死。
- 缺 `agents.yaml` 更隐蔽：`get_agent_params` 会落到全局兜底值，所有 agent 的
  temperature / max_tokens 都不是上游调的默认值，**出题质量悄悄变差且无任何报错**。

因此这段引导**失败即致命**（抛 `E_DEPS_MISSING`，detail 带 `home`/`settingsDir`），
不做 warn 级降级 —— 沉默降级比启动失败难查得多。

**幂等**：`init.py:149-153` 的 `_write_yaml_if_missing` / `_write_json_if_missing`
只在文件缺失时写默认值，用户改过的 `main.yaml` / `agents.yaml` 不会被覆盖。
所以每次启动都调，**不加「只第一次调」的标志位** —— 那样用户删掉配置后反而永远重建不出来。

**归属**：`data/user/settings/*.yaml` 是**上游** `init_user_directories` 的产物，
桥只是替它的 launcher 调了一次，**不自己编任何默认值** —— 否则上游升级默认参数时
我们会永远停在旧值。

播种后桥会当场验收 `main.yaml` / `agents.yaml` / `interface.json` 三个文件是否都在；
仍缺就报 `E_DEPS_MISSING` 并列出缺哪些（说明上游默认值表或路径规则变了，属于契约破裂）。

`status()` 里对应字段：

```json
"settings": { "dir": "<home>/data/user/settings", "seeded": true, "files": ["main.yaml", "agents.yaml", "interface.json"] }
```

`seeded` 为 `false` 表示还没起过门面（没调用过 `app()`），不是「配置坏了」。

`--selftest` **不**包含这段（它明确要求不 import 上游），所以自检仍是 61/61。

### 4.4 `status()` 报的路径必须真实存在

`status()` 的 `dataRoot` 是「运行时数据落在哪」这个事实。报一个不存在的路径等于撒谎，
而且 `artifact.open` 的 allowed_roots 就是 `[<home>/data, <home>]`，
路径不存在会让产物校验出现「目录都不存在却在校验白名单」的怪状态。

所以桥启动阶段会 `mkdir(parents=True, exist_ok=True)` 建好 `<home>/data`；
**建失败只记 warn 不致命**（只读盘上 status 仍要能回）。

### 4.5 事件映射

上游 `StreamEvent.type` → 契约 §5 的 `kind`，映射表 `to_event_kind()`。
上游侧 `type` 可能是 `str` 也可能是 `Enum`，两种都要兼容：
`value = t.value if hasattr(t, 'value') else str(t)`。

未映射的上游事件**不丢弃**，落 `kind: 'diagnostic'`（契约 §5 的 DIAGNOSTIC_KIND），
这样上游升级引入新事件时，我们能看见它而不是静默吞掉。

### 4.6 `turn.event` 通知的形状

`params` 是 `{ runId, event }` —— 事件本体在 `params.event` 里，**不是摊平在 params 顶层**（契约 §3.3）。
`turn.attach` 重放时同形状。

### 4.6.1 终态判定：只有 `done` / `error` 说了算

`result`、`done`、`error` 都算「终态类事件」（`TERMINAL_EVENT_TYPES`），但它们**不等权**：

| 事件 | 干什么 | 不干什么 |
| --- | --- | --- |
| `result` | 收下产物到 `turn.result` | **不判成败** |
| `error` | 判 `failed`，写 `turn.error` | — |
| `done` | 判 `succeeded`/`failed`/`cancelled`；成功时**清空** `turn.error` | — |

`result` 不判成败是硬要求，不是风格偏好。能力提交结果时由
`emit_capability_result` 拼 metadata，里面**没有 `status` 字段**。旧实现让
`result` 也参与判定、且 `normalize_status(None)` 默认 `"failed"`，于是成功的一轮
先被写成 `failed` + `E_UPSTREAM_ERROR`，随后 `done` 只改 status 不清 error，
`turn.result` 回执就变成自相矛盾的
`{"status":"succeeded","error":{"kind":"E_UPSTREAM_ERROR",...}}`（探针实测复现）。

因此 `normalize_status()` 对未知/缺失值返回 `"running"`（上游没表态），
**绝不**把「没表态」读成「失败」。

### 4.6.2 `result` 的载荷形状随能力与上游版本变化

桥**不猜** `result` 里有什么，原样透传。已知的真实形状：

- `deep_question`（agentic 出题路径）：`{ "content": "### Question 1 ..." }`，
  纯 Markdown 正文，**不是**结构化题目数组；
- 其他能力可能是 `{ ... }` 别的产物元数据。

所以结构化解析属于适配器职责（`src/adapters/quiz.js` 的 `extractRawQuestions`
从 Markdown 抽题、`toQuizCandidates` 做值域校验），桥层不得假设
`result.questions` 存在。

### 4.7 上游 `llm_selection` 是刻意不传的

`build_turn_request` **不**把宿主的 `llm` 快照映射成上游 `TurnRequest.llm_selection`。

原因：上游 `llm_selection` 的语义是「从上游自己的
`data/user/settings/model_catalog.json` 里挑一条已配好的 profile/model」，
`request_preparer.py:564` 的 `apply_llm_selection_to_catalog` 找不到条目就抛
`Invalid LLM selection: selected profile/model was not found.`
宿主环境**从不写**那份 catalog（模型传输走 `llm_shim` 反向请求），
所以任何非空 `llm_selection` 都必然让 `turn.start` 起不来 ——
等于把「宿主选了模型」变成「任务直接失败」。

宿主快照的唯一落点是 `llm_shim.set_selection()`，喂给 `get_llm_config()`。
想回答「这轮用哪个模型」，看 `turn.start` 回执的 `llmSelectionUsed` 或
`status().llmShim.selectedModel`。

---

## 5. python/llm_shim.py

把上游的模型入口整体换到桥上，**不改 vendor 文件**。

### 5.1 接管什么（五个入口，分三层）

| 上游入口 | 换成 | 谁在用 |
| --- | --- | --- |
| `services/llm/config.py: get_llm_config` | 返回合成 `LLMConfig`（内容来自宿主快照） | 所有能力进门前 |
| `services/llm: complete` | 走桥 `llm.complete` | `agents/base_agent.call_llm` |
| `services/llm: stream` | 走桥 `llm.stream` | `agents/base_agent.stream_llm` |
| `services/llm/factory.py: complete_with_config` | 走桥 `llm.complete` | learning / 评测类子模块 |
| `runtime/agentic/client.py: build_openai_client` / `_build_openai_client` | 返回**假 OpenAI 客户端**（`chat.completions.create` → 桥 `llm.stream`/`llm.complete`） | `deep_question` / `deep_solve` / `deep_research` / `explore_context` |

前三行是「取模型」的两段式：`get_llm_config` 是**真正的闸门**，上游能力代码在调模型
之前先问它「模型配好了吗」，宿主环境没有上游 catalog，它原本会报
`No active LLM model is configured`，turn 立刻以 error 事件结束。所以只在
`complete`/`stream` 打补丁是不够的 —— 必须在 `_app()` 建好门面后、任何 `turn.start`
之前就装上（`Bridge._app` 里 `_install_llm_shim()`）。

第五行是**另一条路**：`deep_question` 这类能力在 1.6.x 已迁到 `runtime/agentic`
引擎，它们不经过 `services.llm`，而是自己 `build_openai_client()` 拿客户端直接
`await client.chat.completions.create(...)`（`runtime/agentic/labeled_step.py:454`、
`agents/question/pipeline.py:491` 与 `:1120`）。合成配置里的 `base_url` 是永不可解析的
`llm-shim.host.invalid`，这条路径会去拨号并拿 502 —— 前四行一行都走不到。所以必须把
**工厂函数本身**换掉。

### 5.2 为什么按对象身份扫描

上游大量 `from deeptutor.services.llm import complete as llm_complete` 这种别名导入：
名字变了、对象还是同一个。`install()` 因此遍历 `sys.modules` 里所有 `deeptutor*` 模块，
按 `id(原函数)` 匹配属性并替换 —— 别名能命中，同名的无关属性不会被误伤。
`restore()` 用同一份记录还原。

装失败**不致命**：没有垫片时上游会如实报「没配模型」，
而桥本身（ping/status/capabilities）仍要能工作。失败原因进 `status().llmShim.error`。

### 5.3 假客户端翻译成什么

`chat.completions.create(**kwargs)` 被翻成一次桥调用，规则固定：

- `stream=True` → `llm.stream`，`stream=False` → `llm.complete`；
- `stream_options` / `extra_headers` / 上游专有 kwargs **不出桥**（宿主不接受）；
- `role=tool` 的消息补一个 `callId` —— 宿主 `toHostMessages` 靠
  `message.callId || message.tool_call_id` 把工具结果配回那次调用，对不上就等于
  把工具结果降级成一条普通用户发言，模型会以为自己没调过工具；
- 桥回执（`{content, reasoning, toolCalls, usage, finishReason, model}`）被摊成
  **chunk 序列**：正文 → 工具调用 → `finish_reason` → `usage` 尾帧。
  上游逐 chunk 消费，但**分块粒度不是语义**（它把 content 一段段拼起来做 label 探测），
  真正有语义的是顺序；`usage` 必须单独一帧且在 `finish_reason` 之后，否则上游会白等
  一次 `_USAGE_TRAILER_GRACE_TIMEOUT_S`。
- `finishReason` 用**上游词表**：`tool-calls` → `tool_calls`（下划线，不是宿主的连字符）。
- 没模型快照时**当场**抛「宿主未选择模型：请在工作台的模型设置里…」，不让占位 route
  去桥那里兜一圈再变成 `E_CAPABILITY_UNAVAILABLE`。

假客户端刻意 **duck-typing**（不 import openai 的 pydantic 模型）：上游读的都是
`chunk.choices[0].delta.content` / `chunk.usage.prompt_tokens` 这类属性路径，普通对象
就够；依赖 SDK 会让「pip 没装完就跑不起来」的边界重新出现。

### 5.4 快照作用域

`set_selection` 写 `ContextVar`（并行 run 互不串味），另留一份进程级 fallback
供 `get_llm_config` 在 ContextVar 没设到的地方读取。`clear_selection()` 在 run 收尾时调用，
之后 `get_llm_config()` 会如实报「没配模型」。

---

## 6. python/capabilities_probe.py

独立可执行的能力/依赖探针：`--selftest` 走纯逻辑自检，不带参数则输出 JSON。

它能单跑的意义：出问题时不用起整条桥，直接
`.runtime/deeptutor-py311/Scripts/python.exe python/capabilities_probe.py`
就能看到「哪些能力的依赖在本机就绪」，把「桥有问题」和「环境有问题」区分开。

---

## 7. 验证

```pwsh
# 1. 协议自检（不 import 上游，依赖没装完也该绿）
.runtime/deeptutor-py311/Scripts/python.exe packages/dsh-zhiyun-host-deeptutor/python/deeptutor_bridge.py --selftest

# 2. 模型入口自检 / 能力探针自检
.runtime/deeptutor-py311/Scripts/python.exe packages/dsh-zhiyun-host-deeptutor/python/llm_shim.py --selftest
.runtime/deeptutor-py311/Scripts/python.exe packages/dsh-zhiyun-host-deeptutor/python/capabilities_probe.py --selftest

# 3. Node 侧（直接执行，不要 `node --test`：受限沙箱里测试运行器自己 spawn 会 EPERM）
node tests/deeptutor-bridge.test.mjs

# 4. 导出面
node -e "import('./packages/dsh-zhiyun-host-deeptutor/src/runtime.js').then(m=>console.log(Object.keys(m)))"
```

真实出题（要模型凭证）属于人工验证，见 `scripts/deeptutor_bridge_selftest.mjs`，
不在自动化测试范围内 —— 那里断言的是「桥能不能起、常量对不对、聚合对不对」，
不是「模型出的题好不好」。
