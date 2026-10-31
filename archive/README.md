# 归档区

这里放的是**当前不参与构建、但需要保留可还原性**的东西。归档不是删除：
每个条目都写清「为什么归档」和「怎么还原」。

## deeptutor-vendor-1.6.15（76 MB）

### 是什么

上游 DeepTutor 的完整 Python 源码（`deeptutor/`、`web/`、`assets/`、`tests/` 等
1082 个文件、约 30 万行）。它原本位于
`packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/`。

### 为什么归档

2026-10-31 起，出题链路由**纯 JS 重构版**接管：

```js
// packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js
export const NATIVE_BACKEND = 'core-question';
```

重构版（`dsh-zhiyun-core-llm` / `-tool` / `-lecture-tools` / `-question`）
是对 `deep_question` 全链的逐行为重写，零第三方依赖、不启 Python 子进程。
质量对照结果：`writing_flaws 0.972`（基线 vendor 0.940）、
`shortcuts 0.933`（基线 0.933）。

vendor 因此不再参与出题，只在**回退**时才需要。

### 归档前验证过什么

1. 移除 vendor 后，`dsh-zhiyun-host-deeptutor` 插件仍能正常 `apply()`
   ——它设计上「永不因上游缺失抛错」，实测确认。
2. `status()` 如实报 `deps-missing` / `not-installed`，不编造版本号。
3. quiz 全链路测试（295 项）在无 vendor 下全绿。
4. 把目录移回原位后，`deeptutor-host` 的 14 项测试恢复全绿，
   第 ⑭ 项重新走「vendor 在仓库里」分支并断言 `ready` + 版本 `1.6.15`。

### 怎么还原

```powershell
mv archive/deeptutor-vendor-1.6.15 packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor
```

再把开关改回 vendor：

```js
export const NATIVE_BACKEND = 'deeptutor';
```

两处都做完才是一次完整回退。只移目录不改开关，出题仍走重构版；
只改开关不移目录，会因缺 vendor 报 `deps-missing`。

### 注意

- `packages/dsh-zhiyun-host-deeptutor/package.json` 的 `files` 里**仍保留**
  `vendor/deeptutor/` 声明。这是有意的：移回来后无需再改清单即可打包。
- `tests/deeptutor-host.test.mjs` 第 ③、⑭ 项会自己判断 vendor 在不在，
  两种情形分别断言，不会因为 vendor 缺席就静默跳过。

## deprecated-packages/dsh-zhiyun-core-llm（305 KB）

### 为什么废弃

这个包的名字和职责都错了。

**名字**：`core-llm` 听起来像「一套 LLM 客户端」。宿主的 `dsh-llm`
（`@deepseek-ai/dsh-llm` + `dsh-llm-deepseek`）才是唯一的传输层，
它管鉴权、HTTP、SSE 解析、usage 计量、重试策略、idle watchdog、
provider 方言差异（OpenAI 兼容 / Anthropic Messages）。

**职责**：包内 4095 行里，约 3300 行在重复实现宿主已有的能力：

| 模块 | 行数 | 宿主已有 |
|---|---:|---|
| `wire.js` | 767 | `serialize()` / `createUserMessage` |
| `providers.js` | 519 | `adapters` 注册表 + `registration()` |
| `usage.js` | 360 | `_usage` / `AssistantStreamAccumulator` |
| `config.js` | 357 | `resolveCallWithInfo` / `resolveModelInfo` |
| `reasoning.js` | 255 | `reasoningEffort` 处理 |
| `messages.js` | 151 | 消息工厂 |
| `think.js` / `labels.js` / `labeled-step.js` | 987 | **宿主没有** ← 只有这部分是真需求 |

最实际的危害不是浪费代码，而是**制造了一套并行的 LLM 栈**：
2026-10-31 一整天的 `TRANSPORT` / `NO_ADAPTER` 事故，全部源于在两条栈之间
判断该用哪条、以及绕开宿主自己拼请求。

### 拆成了什么

真需求（标签协议状态机）搬进新包 **`dsh-zhiyun-core-question-stream`**：

- `labeled-step.js`（736 行）—— 流式标签路由、`finalMeta` 两态、`<think>` 前置状态机
- `labels.js`（151 行）—— 协议标签识别
- `think.js`（100 行）—— `<think>` 块跨 chunk 处理
- `usage-frame.js`（新增，约 60 行）—— 只保留三个纯形状转换函数，
  不搬 `UsageTracker` 的计价逻辑（那是客户端的职责，宿主已做）

新包**不发起任何 HTTP 请求**：所有传输由调用方注入的 `client.prepareCall()` 完成
（生产环境即 `pool.base.llm`，宿主的 `LlmRuntime`）。

### 同时删掉的兜底

`core-question-backend.js` 里原来有一条「没有宿主就自建 client」的兜底，
已删除改为明确抛 `NOT_WIRED`。理由：偷偷走另一条 HTTP 栈，
会让「界面选的模型」和「实际调用的模型」可能不是同一个，且失败信息无法归因。

### 怎么还原

不打算还原。若确需对照旧实现：

```powershell
mv archive/deprecated-packages/dsh-zhiyun-core-llm packages/
```

## deprecated-packages/dsh-zhiyun-page-classroom + dsh-zhiyun-host-openmaic

### 是什么

一套完整的**旧课堂方案**：

| 包 | 作用 |
|---|---|
| `host-openmaic` | 把上游 OpenMAIC 整站（Next.js）跑起来，含 PostgreSQL 依赖 |
| `page-classroom` | 用同源 iframe 承载那个整站，UI 与上游一致 |

### 为什么归档

2026-10-31 起，课堂功能由**重构版**接管：

| 新包 | 职责 |
|---|---|
| `page-classroom-build` | brief → 可编辑大纲 → 流式生成 |
| `page-classroom-play` | 场景进度条 + 舞台 + 控制条 |
| `core-classroom-stage` | 账本 / 时间轴 / 白板动作重放 |
| （另 10 个 core-classroom-* 领域包） | |

旧方案与新版**并存但互不相通**，是典型的「各管一半」：

1. `page-classroom` 注册的 slot 是 `zhiyun.classroom.content`
2. 而 NAV 现在找的是 `zhiyun.classroom.play`
3. 两个包都不在 `profiles/zhiyun-bench/package.json` 的 bundles 里
4. 没有任何包依赖它们

**slot 名对不上，加载了也不会显示。** 两个包已被 AI 标了 `DETACHED.md`（未接入）。

### 归档前验证过什么

1. 全仓无任何包依赖这两个包（grep 所有 package.json）
2. 5 个测试文件引用的是 `page-classroom-build` / `page-classroom-play`，
   **没有一处**引用 `page-classroom`
3. `css-order.test.mjs` 的包清单里也没有它们
4. 从 profile 移除后 `npm install` 与构建均通过

### 注意：vendor 目录留在本地

`host-openmaic/vendor/` 有 **18.9 万个文件**（上游整站源码 + node_modules + .next
构建产物），被 `.gitignore` 排除，**从未进入 git**。

所以本次归档只移动了 git 跟踪的 16 个源码文件。本地那份 vendor 因为进程占用
（`Device or resource busy`）没能一起移走，留在 `packages/dsh-zhiyun-host-openmaic/vendor/`。

**这不影响仓库状态** —— git 里它本来就不存在，任何人都不会 clone 到它。
需要时可以直接删除该目录回收磁盘；要恢复旧方案则按下面步骤。

### 怎么还原

```powershell
# 1. 把源码移回
git mv archive/deprecated-packages/dsh-zhiyun-host-openmaic packages/dsh-zhiyun-host-openmaic
git mv archive/deprecated-packages/dsh-zhiyun-page-classroom packages/dsh-zhiyun-page-classroom

# 2. 删掉 DETACHED.md 标记
Remove-Item packages/dsh-zhiyun-host-openmaic/DETACHED.md -ErrorAction SilentlyContinue
Remove-Item packages/dsh-zhiyun-page-classroom/DETACHED.md -ErrorAction SilentlyContinue

# 3. 按 DETACHED.md 里「要重新接进来时」那 5 步做
```

### 还差什么才能真的用起来

`DETACHED.md` 里写明了两条硬前置，当时没解决：

1. **PostgreSQL 是手工起的便携版**，不在宿主生命周期里。换机器或重启后
   页面会报 `no-database`
2. 上游构建**必须**带 `ALLOWED_FRAME_ANCESTORS`，它在 `next.config.ts` 的
   `headers()` 里构建期求值、写死进 `routes-manifest.json`。少了它 iframe 一定
   被 CSP 拦，**运行时不报错，只表现为白屏**

这两条决定了它不是「开箱可用」的方案，也是被重构版取代的原因之一。
