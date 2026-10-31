# OpenMAIC → `dsh-zhiyun-host-classroom` 路由清点表

> 规范：`docs/architecture/classroom-port.md`（唯一事实来源）
> 上游：`ref/OpenMAIC` v1.3.0（**只读**）
> 本表所有「入参 / 出参 / 依赖」都是从**源码逐行读出**的，不是从类型声明或 README 推断。
> 主表 20 行全部逐条读过；附录 A 的 62 行只读了方法签名与 import 面（见附录开头说明）。

---

## 0. 先说口径：规范写 21，实测 20 / 82

规范 §6 与任务书写的是「**21 个 route** 搬运」。实际数：

```bash
$ find ref/OpenMAIC/app/api -name route.ts | wc -l
82
$ find ref/OpenMAIC/app/api -maxdepth 2 -name route.ts | wc -l   # 即 app/api/*/route.ts
20
```

| 口径 | 数量 | 含义 |
|---|---|---|
| `app/api/*/route.ts`（**规范 §2 的字面 glob**，深度 2） | **20** | 本表主表 |
| 深度 3 | 33 | 附录 A |
| 深度 4 | 24 | 附录 A |
| 深度 5 | 5 | 附录 A |
| 合计 | **82** | 真实服务面 |

**结论：21 这个数字对不上任何一种切法**（不是 20，也不是 82）。本表按规范字面把深度 2 的 **20 个**逐条做完，其余 62 个列进附录 A 做**分级清点**。这不是我少做了一个 —— 差的那 1 个不存在；真正的问题是**规范低估了 3 倍**（82 vs 21），L1 的工作量评估需要按 82 重排（见 §4 缺口 G-5）。

---

## 1. 复杂度判定规则（照任务书，逐字执行）

| 判定 | 规则 |
|---|---|
| **直接搬** | handler body 只调纯函数（无 IO、无 owner seam、无 Next API） |
| **需适配** | body 的依赖面是 `pg` / 文件系统 / S3 / 上游 HTTP / 宿主服务；`NextRequest` 只是"数据来源"（headers、url、json），可参数化 |
| **需重写** | body 的 IO 面是 **Next/Web 运行时专有形状**：`next/headers` 的 `cookies()`、`revalidate`、SSE/流式 `Response`、二进制 `Response`、multipart `req.formData()` |

**实测结论：`直接搬` 是 0 个。** 原因不是这些 route 复杂，而是 20 条 route **无一例外**都有 IO，且集中在三个宿主接缝上（逐条 grep 的实测计数）：

1. `withRequestOwner` / `resolveRequestOwner`（owner 身份接缝）—— **8/20**：`agents`、`folders`、`generate-classroom`、`generation-runs`、`materials`、`model-config`、`stages`、`verify-model`；
2. `provider-config`（`server-providers.yml` + 环境变量）—— **7/20 直接 import**：`health`、`parse-pdf`、`server-providers`、`transcription`、`verify-image-provider`、`verify-pdf-provider`、`verify-video-provider`；另有 `azure-voices` 等经 `model-config/media` 间接依赖；
3. 上游 HTTP / LLM —— **5/20**：`azure-voices`、`proxy-media`、`quiz-grade`、`verify-model`、`verify-pdf-provider`。

落在三者之外的 2 条（`comfyui-workflows`、`usage`）踩的是**文件系统**（`public/`、`data/usage/*.jsonl`）。

所以规范里「只调纯函数的 = 直接搬」这一档，在 `app/api/` 下**没有样本**。第一个"能整段照抄"的东西在 `lib/server/` 里（`getParallelSceneConcurrency`、`filenameToDisplayName`），不在 route 层。

---

## 2. 主表：`app/api/*/route.ts`（20 个，逐条读过源码）

> 「迁成哪个 service 方法」一栏里，**「缺口」= 规范 §4 的 10 个方法覆盖不到这条 route**，需要先改规范再动手。

| # | route 路径 | HTTP | 入参形状 | 出参形状 | 依赖的 `lib/server` 模块 | 迁成哪个 service 方法 | 复杂度 |
|---|---|---|---|---|---|---|---|
| 1 | `/api/health` | GET | 无 | `{success:true, status:'ok', version, accessCodeConfigured, capabilities:{webSearch,imageGeneration,videoGeneration,tts}, generation:{parallelSceneConcurrency}}` | `api-response`、`generation-capabilities`、`provider-config` | **`status()`**（上游 body 原样进 `detail`） | 需适配（槽位解析读 workspace `pg`） |
| 2 | `/api/server-providers` | GET | 无 | 成功 `{success:true, providers, tts, asr, pdf, image, video, webSearch, generation:{parallelSceneConcurrency}}`；失败 `{success:false, errorCode:'INTERNAL_ERROR', error}` @500 | `provider-config`（7 个 getter + 并发上限）、`api-response`、`logger` | **`providers.list()`** | 需适配（`server-providers.yml` 走 fs） |
| 3 | `/api/agents` | GET, POST | POST `{agent: <customAgentSchema>}` | GET `{agents: AgentView[]}`；POST `{agent: AgentView}` @201；404（无持久层）/409 `AGENT_EXISTS`/403 `BUILT_IN_AGENT_READ_ONLY` | `agents/{http,registry,store}`、`orchestration/registry/wire`、`identity/with-owner`、`config/feature-flags` | **缺口**（建议 `agents.list/create`） | 需适配（`pg` + owner） |
| 4 | `/api/azure-voices` | POST | JSON `{apiKey, baseUrl}` | `{success:true, voices: unknown[]}`；`MISSING_API_KEY`/`MISSING_REQUIRED_FIELD` 400、`INVALID_URL` 403、`PROVIDER_DISABLED` 403、`UPSTREAM_ERROR` 502、`INTERNAL_ERROR` 500 | `provider-fetch`、`ssrf-guard`、`model-config/runtime`（`requestProvidersAllowed`）、`resolve-model`、`api-response` | **缺口**（建议 `providers.voices(providerId)`） | 需适配（上游 HTTP + SSRF 钉定） |
| 5 | `/api/comfyui-workflows` | GET | 无 | `{workflows: [{id, name}]}` —— **注意：没有 `success` 信封**（与全家不一致，是上游的历史遗留，别顺手统一） | `lib/media/comfyui-workflows`（`fs` 读 `public/`，动态 import） | **缺口**（建议 `media.workflows()`） | 需适配（fs） |
| 6 | `/api/folders` | GET, POST | POST `{name: string}` | `{folders: [{...folder, userKey}]}`；POST `{folder: {...folder, userKey}}`；400 `INVALID_BODY`/`FOLDER_NAME_INVALID`/`_EMPTY`/`_TOO_LONG`；500 `FOLDER_LIST_FAILED`/`FOLDER_CREATE_FAILED`；404（无持久层） | `folder-persistence`、`agent-runtime/{owner-scoped-documents,route-response}`、`identity/with-owner`、`persistence/owner-merges`、`folder-name-errors`、`utils/folder-name-validation` | **缺口**（建议 `classroom.folders`） | 需适配（`pg`） |
| 7 | `/api/generate-classroom` | POST | JSON `{requirement, materialIds?}` | 202 `{success:true, ...classroomJobView(run)}`；400 `INVALID_REQUEST`/模型未配置；429 `ACTIVE_RUN_LIMIT`；500 `INTERNAL_ERROR` | `generate-classroom-job`、`generation/run/{input,start}`、`classroom-storage`（`buildRequestOrigin`，吃 `req.nextUrl`）、`agent-runtime/route-response`、`identity/with-owner` | **`generate(brief, opts)`** | 需适配（`nextUrl` + `pg`） |
| 8 | `/api/generation-runs` | GET, POST | GET `?active=1`；POST `{requirement, materialIds?, interactive?, taskEngine?, agents?, learnerProfile?, outlineReview?, voice?}` | GET `{runs: RunSnapshot[], limits:{maxActive,maxWaiting}}`；POST 202 `{run: RunSnapshot}`；400/429 `ACTIVE_RUN_LIMIT` | `generation/run/{input,config,start,store}`、`agent-runtime/route-response`、`identity/with-owner` | **`generate()` + `runs.get()`** | 需适配（`pg`） |
| 9 | `/api/materials` | GET, POST | GET `?sessionId&limit&before`；POST **原始字节 body** + `content-type` + `x-material-filename`，query `scope=library`、`extract=false` | GET `{materials: [...]}`；POST `{material: ...}` @201；413 超限、415 不支持类型、400 | `persistence/owner-materials`、`materials/{bytes,extractor-wake,library-view,upload-limits}`、`agent-runtime/{session-materials,material-resolver,route-response}`、`workbench/material-upload-policy`、`@openmaic/storage` | **缺口**（建议 `materials.list/upload`） | **需重写**（`req.body` 流式 + 字节存储） |
| 10 | `/api/model-config` | GET, PUT | PUT `{revision: number\|null, change: {kind:'slots'\|'provider'\|'remove-provider', ...}}`（zod `.strict()`） | `ModelSettingsView {webFetchProviders?, revision, allowUserKeys, presets[], providers[], slots[]}`；400 `INVALID_REQUEST`/`INVALID_SETTINGS`、409 `CONFLICT`/`SLOT_LOCKED`、403 | `model-config/settings`、`persistence/workspace-model-config`、`persistence/{owner-merges,server-provider}`、`identity/with-owner` | **`providers.set()`**（GET 侧**缺口**） | 需适配（`pg`） |
| 11 | `/api/parse-pdf` | POST | multipart `{pdf: File, providerId?, apiKey?, baseUrl?}` | `{success:true, data: ParsedPdfContent & {metadata:{pageCount, fileName, fileSize}}}`；400/403/500 `PARSE_FAILED` | `document`（`extractDocument`）、`material-extraction/services`、`client-extractor-endpoint`、`model-config/{media,runtime}`、`provider-config` | **缺口**（建议 `extract.pdf()`） | **需重写**（`req.formData()`） |
| 12 | `/api/proxy-media` | POST | JSON `{url}` | **二进制** body + `Content-Type`/`Content-Length`/`Cache-Control: private, max-age=3600`；403 `INVALID_URL`、502 `UPSTREAM_ERROR`/`TOO_MANY_REDIRECTS` | `ssrf-guard`、`pinned-dispatcher`、`api-response` | **缺口**（建议 `media.fetch(url)`） | **需重写**（二进制 `Response`） |
| 13 | `/api/quiz-grade` | POST | JSON `{question, userAnswer, points, commentPrompt?, language?}` | `{success:true, score, comment}`；400、500 `INTERNAL_ERROR` | `ai/llm`（`callLLM`）、`resolve-model`、`api-response` | **缺口**（归 `dsh-zhiyun-core-quiz`：建议 `quiz.grade()`） | 需适配（LLM + header 解析模型） |
| 14 | `/api/stages` | GET, POST | POST `{name, description?}` | GET `{stages: [...]}`；POST 201 `{stage:{id,name,description?,createdAt,updatedAt,sceneCount:0}}`；400、403 `CREATE_REFUSED`、404 | `persistence/library`、`agent-runtime/{owner-scoped-documents,route-response,stage-limits}`、`persistence-hooks/registry`、`persistence/owner-merges`、`identity/with-owner` | **`classroom.load()`**（列表侧）/ `classroom.save()`（创建侧） | 需适配（`pg`） |
| 15 | `/api/transcription` | POST | multipart `{audio: File, providerId?, modelId?, language?, apiKey?, baseUrl?, previewProvider?, previewModel?}` | `{success:true, text}`；400、403 `INVALID_URL`、500 `TRANSCRIPTION_FAILED` | `audio/asr-providers`、`provider-config`、`model-config/{media,runtime,saved-provider}`、`ssrf-guard` | **缺口**（建议 `media.transcribe()`） | **需重写**（`req.formData()`） |
| 16 | `/api/usage` | GET | `?months=YYYY-MM,YYYY-MM` | `{success:true, totals:{requests, llmTokens}, byModel: Bucket[], byDay: Bucket[], byKind: Bucket[]}`；500 | `usage-storage`（`fs` 读 `data/usage/*.jsonl`） | **缺口**（建议 `usage.summary()`） | 需适配（fs） |
| 17 | `/api/verify-image-provider` | POST | JSON `{provider?, model?}`；或 headers `x-image-provider`/`x-image-model`/`x-api-key`/`x-base-url` | `{success:true, message}`；400 `MISSING_PROVIDER`/`MISSING_API_KEY`/`MISSING_MODEL`、403 `INVALID_URL`/`PROVIDER_DISABLED`、500 `UPSTREAM_ERROR` | `media/image-providers`、`provider-config`、`model-config/{saved-provider,runtime}`、`media-provider-fetch`、`ssrf-guard` | **缺口**（建议 `providers.verify(key, cfg)`） | 需适配（上游 HTTP） |
| 18 | `/api/verify-model` | POST | JSON `{model, apiKey?, baseUrl?, providerType?, provider?}` + owner cookie | `{success:true, message:'Connection successful', response}`；401、400、500 | `identity/{resolve,with-owner}`、`resolve-model`、`model-config/saved-provider`、`ai/llm`、`llm-error-response` | **缺口**（同上） | 需适配（LLM + owner cookie 写） |
| 19 | `/api/verify-pdf-provider` | POST | JSON `{provider?}`；或 `{providerId, apiKey?, baseUrl?, accessKeyId?, accessKeySecret?}` | `{success:true, message:'Connection successful'}`；400、403 `INVALID_URL`/`REDIRECT_NOT_ALLOWED`、500 | `provider-config`、`provider-fetch`、`ssrf-guard`、`alidocmind-endpoint`、`pdf/constants`、`model-config/saved-provider` | **缺口**（同上） | 需适配（上游 HTTP + 动态 import） |
| 20 | `/api/verify-video-provider` | POST | JSON `{provider?, model?}`；或 headers `x-video-provider`/`x-video-model`/`x-api-key`/`x-base-url` | `{success:true, message}`；400/403/500 | `media/video-providers`、`provider-config`、`media-provider-fetch`、`ssrf-guard`、`model-config/saved-provider` | **缺口**（同上） | 需适配（上游 HTTP） |

### 2.1 已搬的两条（本批交付）

按任务书「依赖最少的两个」挑完，实际比较结果：

| route | 依赖面 | 为什么能先搬 |
|---|---|---|
| `GET /api/health` | 3 个 import，其中一个纯环境变量 | body 只有 8 行；能力位缺失时上游本身也是四个 `false`（`generation-capabilities.ts:13-21` 的 `catch { return false }`），降级与上游同答案 |
| `GET /api/server-providers` | 7 个 getter + 1 个纯函数 | body 无 IO、无 owner、无 DB；7 个 getter 在「没配任何 provider」时上游返回 `{}`，降级同答案 |

搬运方式（规范第 2 通道）：去掉 `NextRequest/NextResponse` → 普通参数 + 普通返回；`apiSuccess/apiError` 保留**字段级**一致（`{ httpStatus, body }`，见 `src/upstream/api-response.js` 头注）；body 与行内注释逐字保留。

两条 route 之外，还有两个**降级依赖**必须点名（不算"搬完"）：
- `resolveServerGenerationCapabilities()` —— 槽位解析要读 workspace 的 `pg`，属「需适配」，本批给降级实现；
- 七个 `getServer*Providers()` + `getParallelSceneConcurrency()` —— 装载器 1137 行未搬，本批给降级集合（只有 `getParallelSceneConcurrency` 是真实现，逐行照搬）。

两处都在 `src/upstream/` 里以**可注入**的方式留了缝：L2 把真的 `providerConfig` 注进来，`providers.list()` 立刻是真数据，**handler body 一行都不用改**。

---

## 3. 汇总统计

### 3.1 主表（20 个 `app/api/*/route.ts`）

| 判定 | 数量 | 名单 |
|---|---|---|
| 直接搬 | **0** | —— |
| 需适配 | **16** | health、server-providers、agents、azure-voices、comfyui-workflows、folders、generate-classroom、generation-runs、model-config、quiz-grade、stages、usage、verify-image-provider、verify-model、verify-pdf-provider、verify-video-provider |
| 需重写 | **4** | **materials**（`req.body` 流式上传 + 字节存储）、**parse-pdf**（`req.formData()`）、**proxy-media**（二进制 `Response`）、**transcription**（`req.formData()`） |

### 3.2 全量（82 个，含附录 A）

| 判定 | 数量 |
|---|---|
| 直接搬 | **0** |
| 需适配 | **66** |
| 需重写 | **16** |

**需重写全名单（16）：**

1. `app/api/access-code/status/route.ts` —— `next/headers` 的 `cookies()`
2. `app/api/access-code/verify/route.ts` —— `cookies().set()`
3. `app/api/agent/owner-events/route.ts` —— SSE
4. `app/api/agent/sessions/[id]/events/route.ts` —— SSE
5. `app/api/chat/pi/route.ts` —— SSE 流
6. `app/api/classroom-media/[classroomId]/[...path]/route.ts` —— 二进制 + `revalidate`
7. `app/api/export-video/render/[jobId]/download/route.ts` —— 透传上游字节流 + `Content-Disposition`
8. `app/api/generation-runs/events/route.ts` —— SSE
9. `app/api/generation-runs/[id]/events/route.ts` —— SSE
10. `app/api/materials/route.ts` —— `req.body` 流式上传
11. `app/api/materials/[id]/original/route.ts` —— `NextResponse(Uint8Array)` 二进制
12. `app/api/parse-pdf/route.ts` —— `req.formData()`
13. `app/api/persistence/[...path]/route.ts` —— catch-all 持久层网关，25 处 DB 引用
14. `app/api/proxy-media/route.ts` —— 二进制 `Response`
15. `app/api/stages/[id]/freshness/route.ts` —— SSE 轮询流
16. `app/api/transcription/route.ts` —— `req.formData()`

### 3.3 服务方法覆盖率

规范 §4 的 10 个方法 vs 20 个 route：

| 方法 | 对应的 route | 状态 |
|---|---|---|
| `status()` | `health` | **已搬** |
| `providers.list()` | `server-providers` | **已搬** |
| `generate()` | `generation-runs`(POST)、`generate-classroom` | 空壳 |
| `runs.get()` / `runs.cancel()` | `generation-runs/[id]` | 空壳 |
| `classroom.load()` / `classroom.save()` | `stages`、`stages/[id]` | 空壳 |
| `export.pptx()` / `export.html()` | **无对应 route**（在 `lib/export/`） | 空壳 |
| `providers.set()` | `model-config`(PUT) | 空壳 |
| **无方法可落** | `agents`、`azure-voices`、`comfyui-workflows`、`folders`、`materials`、`parse-pdf`、`proxy-media`、`quiz-grade`、`transcription`、`usage`、`verify-*`（4 个） | **11 条 route 没有契约位置** |

**覆盖率 = 9/20。** 11 条 route 落在契约外，是当前最大的结构性缺口（G-1）。

---

## 4. 契约缺口（会卡住 L2 / L3 的具体项）

> 按「不修就会让下游写出错代码」排序。每条都给了复现命令或源码位置。

### G-1 规范 §4 的 10 个方法覆盖不了 55% 的 route（阻塞 L2/L3）

`agents`、`materials`、`parse-pdf`、`transcription`、`proxy-media`、`usage`、`verify-*`（4 个）、`folders`、`azure-voices`、`comfyui-workflows` —— 共 11 条，规范里**没有**对应方法。

后果：L2 要么自己发明名字（`ctx.zhiyunClassroom.materials`），要么把逻辑塞进 `classroom.load/save`（语义错位），三批 builder 各自发明就再也不会一致。
建议：先补规范 §4 的命名，再动代码。候选（已在主表「迁成哪个 service 方法」一栏逐条给出）。

### G-2 `ctx.vault` 不存在（直接卡死规范第 3 通道）

规范 §2 写「driver 换成 `ctx.vault`（本仓既有）」：

```bash
$ grep -rn "ctx\.vault\|provide('vault'" packages/ src/ scripts/   # 零命中
```

本仓只有 `zhiyunVault`（`dsh-zhiyun-core-vault`，笔记库索引），**没有事务、没有行级写、没有 owner 分区**，接不住 `lib/persistence` 的 SQL 语义。
后果：`dsh-zhiyun-core-classroom-vault` 开工第一天就会卡住，且三条路（新建 `vault` / 扩 `zhiyunVault` / 直接持 `pg`）的选型会影响两个既有包。
处置：`src/adapter.js` 里已把 SQL→端口的映射表写全（7 个方法 + 3 条不能丢的语义），选型定了照表实现即可。

### G-3 `zhiyunClassroom` 服务名与 bundle id 双重撞车（**会静默覆盖既有服务**）

| 冲突点 | 现状 |
|---|---|
| 服务名 | `dsh-zhiyun-source-classroom/src/index.js:101` 已经 `ctx.provide('zhiyunClassroom', source)`，提供 `getCurrentUser`/`acquireSso`/`transport` |
| 依赖方 | `dsh-zhiyun-core-parser`（`inject: ['llm','attachments','agentDefaultModel','profileContext','zhiyunClassroom']`）与 `dsh-zhiyun-core-study` 都 inject 这个名字，用的是**源包**的形状 |
| bundle 行 id | 规则是「包名去 `dsh-` 前缀」（`scripts/test-host.mjs:90-93`），`dsh-zhiyun-source-classroom` 与 `dsh-zhiyun-host-classroom` 都得 `zhiyun-classroom` |

后果：同一个 profile 里两个都开，后注册的覆盖先注册的；`core-parser` / `core-study` 会拿到 `{runs, classroom, export}`，然后在 `source.acquireSso()` 上以 `TypeError` 崩掉 —— 而且崩在解析包里，日志看不出是课堂包干的。
本包的处理：按规范 provide（不改名，规范是唯一事实来源），但 `apply()` 会探测并 `log.error`，且写进 `status().detail.conflict = { occupiedBy, detail }` / `state: 'partial'`，测试里有一条专门钉住它。
建议：规范层定名（`zhiyunClassroomHost`？或把源包并进本服务的一个命名空间），再统一改三处 inject。

### G-4 `status()` 的语义没定死，"partial" 全靠约定

规范只写了 `status() → { state, version, detail }`，没给 `state` 的枚举。
本包用了 `ready | partial | degraded | disabled | conflict | not-implemented`（`src/errors.js` 的 `STATUS_STATES`），并把"哪些子能力真的实现了"放进 `detail.implemented`。
后果：L3 页面若照 `state === 'ready'` 判定"课堂可用"，会在本批就显示"可用"—— 但其实只有 `status` 和 `providers.list` 两条通。
建议：把枚举与 `detail.implemented` 写进规范，否则三个页面包会各自发明判断条件。

### G-5 工作量口径：21 → 82（排期会错 3 倍）

见 §0。而且 82 个 route 里 **16 个是流式/二进制/multipart**，这 16 个恰好是课堂体验的核心（生成流、课件媒体、上传、导出下载）。
后果：如果 L1 按 21 排期，实际要在流式层（SSE 转发 + `AsyncIterable` 桥）多花一整个批次；而规范 §4 只说"事件流用 AsyncIterable"，**没说 SSE 帧格式、心跳、重连**怎么落到 Cordis 服务上（上游有 4 套 SSE 实现：`generation/run/sse.ts`、`stages/[id]/freshness`、`agent/owner-events`、`chat/pi`）。
建议：先定一个 SSE 桥（帧格式 + 25s 心跳 + `retry:` 提示），4 条流照它搬。

### G-6 `.zyc-` 样式前缀在宿主层无落点

规范 §5 要求「每个包一个 `src/style.css`，选择器一律 `.zyc-` 前缀」。但本包是**纯服务端包**（无 `src/client.jsx`），没有样式可写，也不该进 `CLIENT_PACKAGES`。
后果：`tests/build-seeds.test.mjs` 若按"每个包都要有 style.css"断言会误报。当前它只查 `client.jsx`，所以暂时安全 —— 记在这里免得下一个 builder 照 §5 给本包加一个空 css。

---

## 附录 A：其余 62 个 route（分级清点，未逐条读入参出参）

> 说明：这 62 个（深度 3–5）只读了**方法签名 + import 面**，判定按 §1 规则做。入参/出参形状没逐条读，**不要**拿这张表当契约用；L1 第二批按主表的详细程度补。
> 判定口径同 §1；`SSE` = 流式响应，`bin` = 二进制响应，`mp` = multipart。

### access-code（2）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `access-code/status` | GET | `next/headers` cookies、`access-token`、`env ACCESS_CODE` | 需重写 |
| `access-code/verify` | POST | `next/headers` cookies.set、`attempt-limiter`、`client-identity`、`access-token` | 需重写 |

### agent（10）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `agent/owner-events` | GET | SSE + owner store + `pg` | 需重写 |
| `agent/runtime` | GET | agent runtime 配置 + `pg` | 需适配 |
| `agent/sessions` | GET, POST | session store、`pg`、owner | 需适配 |
| `agent/sessions/[id]` | GET, PATCH | session store、`pg` | 需适配 |
| `agent/sessions/[id]/cancel` | POST | session store | 需适配 |
| `agent/sessions/[id]/events` | GET | SSE | 需重写 |
| `agent/sessions/[id]/messages` | POST | session store、`@openmaic/storage` | 需适配 |
| `agent/sessions/status` | GET | session store、`feature-flags` | 需适配 |
| `agent/skills` | GET, POST | skills store、`pg` | 需适配 |
| `agent/skills/[id]` | DELETE, GET | skills store | 需适配 |

### agents / skills（3）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `agents/[id]` | DELETE, PUT | agents store、`pg` | 需适配 |
| `agents/import` | POST | agents store、`pg` | 需适配 |
| `skills/[id]` | GET | skills store、`pg` | 需适配 |

### chat（2）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `chat/pi` | POST | SSE + agent runtime + `pg` | 需重写 |
| `chat/pi/whiteboard-visibility` | POST | 进程内单例 `settleWhiteboardVisibility` + owner seam | 需适配 |

### export-video（4）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `export-video/capability` | GET | `render-service`（探测上游 HTTP） | 需适配 |
| `export-video/render` | POST | `render-service`、`pg` | 需适配 |
| `export-video/render/[jobId]` | DELETE, GET | `render-service`、`pg` | 需适配 |
| `export-video/render/[jobId]/download` | GET | 上游字节流 + `Content-Disposition` | 需重写 |

### folders / materials（9）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `folders/[id]` | DELETE, PATCH | document store、`pg` | 需适配 |
| `folders/members` | POST | document store、`pg` | 需适配 |
| `materials/folders` | GET, POST | `persistence/owner-materials`、`pg` | 需适配 |
| `materials/folders/[id]` | DELETE, PATCH | 同上 | 需适配 |
| `materials/[id]` | GET, PATCH, DELETE | 同上 + 字节存储 | 需适配 |
| `materials/[id]/extraction` | POST | 同上 + 提取器 | 需适配 |
| `materials/[id]/original` | GET | 字节存储 → `Uint8Array` 二进制响应 | 需重写 |
| `materials/library` | GET | 同上 | 需适配 |
| `materials/move` | POST | 同上 | 需适配 |

### generate（4）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `generate/image` | POST | image providers（上游 HTTP）+ 模型配置 | 需适配 |
| `generate/tts` | POST | TTS providers + 模型配置 | 需适配 |
| `generate/video` | POST | video providers | 需适配 |
| `generate/voice` | POST | Qwen VC 语音克隆（上游 HTTP + 本地文件） | 需适配 |

### generate-classroom / generation-runs（8）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `generate-classroom/capabilities` | GET | `generation-capabilities` + 槽位解析 | 需适配 |
| `generate-classroom/[jobId]` | GET | run store、`pg` | 需适配 |
| `generation-runs/[id]` | GET, DELETE | run store、`pg` | 需适配 |
| `generation-runs/[id]/confirm-outline` | POST | run store | 需适配 |
| `generation-runs/[id]/hold-outline` | POST | run store | 需适配 |
| `generation-runs/[id]/retry` | POST | run store | 需适配 |
| `generation-runs/[id]/events` | GET | SSE | 需重写 |
| `generation-runs/events` | GET | SSE | 需重写 |

### identity / model-config（3）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `identity/claim` | POST | `identity/resolve`、owner 合并、`pg` | 需适配 |
| `identity/legacy-import-binding` | POST | 同上 | 需适配 |
| `model-config/import` | POST | `workspace-model-config`、`pg` | 需适配 |

### pbl（5）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `pbl/v2/evaluate` | POST | `lib/pbl` + LLM 调用 | 需适配 |
| `pbl/v2/instructor` | POST | 同上 | 需适配 |
| `pbl/v2/open-task` | POST | 同上 | 需适配 |
| `pbl/v2/simulator` | POST | 同上 | 需适配 |
| `pbl/v2/task/update` | POST | 同上 | 需适配 |

### persistence / provider（2）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `persistence/[...path]` | ALL（catch-all） | 29 处 `pg`/`@openmaic/storage` 引用，是客户端的持久层网关 | 需重写 |
| `provider/probe-models` | POST | 上游 `/models` 探测 + 模型配置 | 需适配 |

### stages（9）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `stages/[id]` | GET, PATCH, PUT, DELETE | document store、`pg`（8 处） | 需适配 |
| `stages/[id]/freshness` | GET | SSE（5s 轮询 rev + 25s 心跳） | 需重写 |
| `stages/[id]/generation-complete` | POST | document store | 需适配 |
| `stages/[id]/manifest` | GET | document store | 需适配 |
| `stages/[id]/publish` | POST | document store | 需适配 |
| `stages/[id]/scenes` | GET | document store | 需适配 |
| `stages/[id]/status` | GET | `stage-access`（无 auth，公开标志） | 需适配 |
| `stages/[id]/unpublish` | POST | document store | 需适配 |
| `stage-meta/[stageId]` | GET | document store、`pg` | 需适配 |

### media（1）

| route | 方法 | 依赖面 | 判定 |
|---|---|---|---|
| `classroom-media/[classroomId]/[...path]` | GET | `classroom-media-bytes` + `revalidate` + 二进制响应 | 需重写 |

> **附录小计：62 条**（access-code 2 + agent 10 + agents/skills 3 + chat 2 + export-video 4 + folders/materials 9 + generate 4 + generate-classroom/generation-runs 8 + identity/model-config 3 + pbl 5 + persistence/provider 2 + stages 9 + media 1），与 `find -mindepth 2` 的 62 个文件一一对应。
> 附录内：需重写 12、需适配 50、直接搬 0。
> 与主表合并（20 + 62 = 82）：需重写 16、需适配 66、直接搬 0。

---

## 附录 B：本包的目录

```
packages/dsh-zhiyun-host-classroom/
├── package.json            # type: module / main: src/index.js / dsh.bundle.patch / private
├── cordis.patch.yml        # - insert: - id: zhiyun-classroom
├── ROUTES.md               # 本文件
└── src/
    ├── index.js            # name / inject / apply（永不抛）+ 组合层冲突探测 + provide
    ├── service.js          # 规范 §4 的 10 个方法形状 + inspectShape
    ├── errors.js           # ClassroomError + ERROR_KINDS + STATUS_STATES
    ├── adapter.js          # 存储适配层（**只有接口与 SQL→端口映射表**）
    └── upstream/
        ├── api-response.js      # lib/server/api-response.ts 的端口（去掉 NextResponse）
        ├── health.js            # app/api/health/route.ts:7-16 原样搬
        ├── server-providers.js  # app/api/server-providers/route.ts:16-38 原样搬
        └── provider-config.js   # getParallelSceneConcurrency 原样搬 + 7 个 getter 降级
```

---

## 6. 批 2 落地记录（素材 / 媒体 / 解析，17 条）

> 交付：`src/services/media.js`（`mountMedia(service, deps)`）、`tests/classroom-host-media.test.mjs`。
> 挂到 `service.materials` / `service.media`，`Object.assign` 挂载，不替换任何既有命名空间。
> 行号是本仓 `sed -n` 数出来的**真实行号**（`ref/OpenMAIC/app/api/…`）。

| # | route | 方法 | 状态 | 差异 | 源文件行号 |
|---|---|---|---|---|---|
| 1 | `materials` GET / POST | `materials.list(q)` / `materials.create(body)` | done | 持久层是 `vault.kv`（元数据）+ `vault.assets`（字节），不是 `pg`；`req.body` 流式读改成入参 `{ buffer }`，「超限即 413」语义不变；无 `vault` → 纯文本 404 | `materials/route.ts:123-165` / `170-444` |
| 2 | `materials/[id]` GET / DELETE | `materials.get(id)` / `materials.remove(id)` | done | **上游还有 PATCH（改名），表里没列** → 额外提供 `materials.rename(id, body)`；`usesClassicExtraction` 判据换成 `extraction.format/status` | `materials/[id]/route.ts:62-92` / `126-159`（PATCH `94-124`） |
| 3 | `materials/[id]/extraction` **POST** | `materials.extraction(id)` | done | **表里写 GET，上游是 POST**；没有提取器进程，标 `pending` 即返回（上游注释同义：排队即可） | `materials/[id]/extraction/route.ts:26-72` |
| 4 | `materials/[id]/original` GET | `materials.original(id)` | done | 二进制分支 `{ httpStatus, buffer, mimeType, headers }`；字节来自 `vault.assets`；无字节 → 503 `unavailable`（同上游） | `materials/[id]/original/route.ts:42-83` |
| 5 | `materials/folders` GET / POST | `materials.folders.list(q)` / `.create(body)` | done | 文件夹存 `vault.kv`（`material-folders/<id>`），同名去重、50 个上限、显示宽度校验逐字照抄 | `materials/folders/route.ts:28-37` / `39-67` |
| 6 | `materials/folders/[id]` PATCH / DELETE | `materials.folders.update(id, body)` / `.remove(id)` | done | DELETE 先把它下面的素材 `folderId` 清空再删（上游同一事务语义） | `materials/folders/[id]/route.ts:27-57` / `59-75` |
| 7 | `materials/library` GET | `materials.library(q)` | done | `sessionId` 的 `attached` 标记需要上游链接表 → **不返回该字段**；`assetQuotaBytes` 固定 `null`（没有池配额）；指向别人的 session 不再有 404 oracle | `materials/library/route.ts:38-98` |
| 8 | `materials/move` POST | `materials.move(body)` | done | 全有或全无（422 列出不能动的 id）、派生品跟随源一起移动，逐条照抄 | `materials/move/route.ts:28-75` |
| 9 | `classroom-media/[classroomId]/[...path]` GET | `media.asset(classroomId, path, req)` | done | 不读 `CLASSROOMS_DIR`，改读 `vault.assets`（`stageId = classroomId`，按 `meta.name` / 资产 id 命中）；Range 206/416 头部逐字照抄 | `classroom-media/[classroomId]/[...path]/route.ts:34-153` |
| 10 | `parse-pdf` POST | `media.parsePdf(file)` | done | `req.formData()` → `{ buffer, filename, mimeType?, providerId? }`；provider 槽位解析下沉到 `ports.media.parsePdf`；端口缺 → 抛 `E_NOT_IMPLEMENTED` | `parse-pdf/route.ts:27-127`（提取调用 `99-105`） |
| 11 | `transcription` POST | `media.transcribe(file, opts)` | done | 同上换成 `{ buffer }` + `ports.media.asr`；`modelId` 仍要 trim；端口缺 → 抛 | `transcription/route.ts:29-115`（ASR 调用 `94-96`） |
| 12 | `proxy-media` **POST** | `media.proxy(url, opts)` | done | **表里写 GET，上游是 POST**；二进制分支；SSRF 只有「协议 + 字面内网地址」两层 —— `undici` 的 pinned dispatcher（DNS 钉定）**没搬**（不加依赖），这是本批唯一的安全面差额 | `proxy-media/route.ts:23-114` |
| 13 | `comfyui-workflows` GET | `media.comfyuiWorkflows()` | done | 上游读 `cwd/public`；本包读 `dataDir/public`，`dataDir` 为 null 时走上游「目录不存在」分支（空清单 200） | `comfyui-workflows/route.ts:16-23`（发现逻辑 `lib/media/comfyui-workflows.ts:72-98`） |
| 14 | `generate/image` POST | `media.image(body)` | done | `x-image-*` / `x-api-key` / `x-base-url` 头改成 body 字段；`SensitiveContent` 仍判 400 `CONTENT_SENSITIVE` | `generate/image/route.ts:47-103`（出图调用 `70-77`） |
| 15 | `generate/tts` POST | `media.tts(body)` | done | 合成步骤 = `ports.media.tts`，base64 在这一层编码（同上游 `125`）；`previewProvider` 预览路径随槽位一起下沉 | `generate/tts/route.ts:57-167`（合成调用 `109-131`） |
| 16 | `generate/video` POST | `media.video(body)` | degraded | **端口缺方法**：`zhiyunClassroomMedia` 的签名里没有 `video`，所以这条恒抛 `E_NOT_IMPLEMENTED`（不编结果） | `generate/video/route.ts:51-108`（提交调用 `74-81`） |
| 17 | `generate/voice` POST | `media.voice(body)` | degraded | **端口缺方法**：上游走各 provider 的 `VoiceRegistrationAdapter`（register/exists/bootstrap/delete），本仓无端口 → 校验完入参即抛；要接 `ports.media.voice` | `generate/voice/route.ts:74-339`（适配器取用 `141-148`） |

**状态分布：15 done / 2 degraded / 0 skipped。**

需要编排层补的端口方法（按本批的必要性排序）：

1. `ports.media.video(prompt, opts)` —— 否则 `generate/video` 永远是 `E_NOT_IMPLEMENTED`；
2. `ports.media.voice(payload)` —— 否则 `generate/voice` 同上（`registerVoice` / `voiceExists` / `bootstrapReferenceClip` / `deleteVoice` 四个动作都要）；
3. `ports.vault.materials` 的**owner 级**查询（当前只能按 `sessionId` 分区，`materials.list` 无 session 时读的是 kv）—— 若以后要真会话表，`materials.list(?sessionId)` 才能恢复 404 oracle；
4. `ports.materials.links(sessionId, ids)` —— `materials/library` 的 `attached` 标记缺它就没法返回（现在刻意不返回）；
5. `ports.materials.extractor()` —— `materials/extraction` 目前只标 `pending`，没有扫描进程去真的跑提取；
6. `ports.mediaAssets(classroomId, name)` —— `media.asset` 现在靠 `assets.list` 全量扫 + `meta.name` 命中；数据量大时要一个直接的按名取字节。

与上游 / 本表记载不一致的三处（都已在上面表格里标出）：

- `materials/[id]/extraction`：表写 GET，上游只有 **POST**；
- `proxy-media`：表写 GET，上游只有 **POST**；
- `materials/[id]`：表只列 GET/DELETE，上游还有 **PATCH**（改名），已补 `materials.rename`。

---

## 5. 批 1 落地记录（生成 / 运行 / 舞台，20 条）

> 交付：`src/services/generation.js`（`mountGeneration(service, deps)`）、`tests/classroom-host-generation.test.mjs`（56 例）。
> 挂到 `service.generate` / `service.runs` / `service.stages`：`generate` **保持可调用**，只往上挂
> `capabilities` / `job` / `start`（第 0 节的要求），`runs` / `stages` 用 `Object.assign`，不替换任何既有实现。
> 行号是本仓 `sed -n` 数出来的**真实行号**（`ref/OpenMAIC/app/api/…`）。
>
> 端口：`ports.generate`（`start/stream/cancel/resume/get/list`）、`ports.vault`
> （`classroom.*` / `runs.*`）、`ports.stage`（可选：`access/setPublished/markComplete/library`）、
> `ports.media`（可选：`extractableMimeTypes`）。任一为 `null` 时按「上游没有持久层」那一条分支走，
> 不自造错误（逐条差异见下表）。

| # | route | 方法 | 状态 | 差异 | 源文件行号 |
|---|---|---|---|---|---|
| 1 | `generate-classroom` POST | `generate.start(brief, opts)` | done | 真接 `ports.generate.start(brief, opts)` + `stream(runId)` 原样透出；返回 202 body **加上** `{ runId, events }`。202 的 `step`/`progress` 由端口快照近似（端口没有上游 `StoredRun` 的 `step`/`progress`，不补 = 不编数据）；`req` 换成 `{ request, origin, start }`；`requiredModelRefusal` 的模型槽解析挂 `opts.resolveStage`/`deps.resolveStage`，未注入即跳过（上游无模型时 400）；端口缺失 → 抛 `E_NOT_IMPLEMENTED` | `generate-classroom/route.ts:30-83` |
| 2 | `generate-classroom/capabilities` GET | `generate.capabilities()` | done | 纯函数 + `providerConfig.getCapabilities`（未注入 = 上游「四槽位全解析不出」的四 `false`）；`formats` 由 `ports.media.extractableMimeTypes` 过滤，缺端口 = 空集（同上游无 extractor）；`WORKBENCH_MATERIAL_FORMATS` 18 条逐字段抄进本文件 | `generate-classroom/capabilities/route.ts:32-58` |
| 3 | `generate-classroom/[jobId]` GET | `generate.job(jobId)` | done | id 正则 `^[a-zA-Z0-9_-]+$` 400 在前；run 由 `ports.generate.get` 读，`classroomJobView` 的原样套（状态词映射：端口 `running/failed/cancelled` → 上游 `preparing/paused/ended`） | `generate-classroom/[jobId]/route.ts:24-56` |
| 4 | `generation-runs` GET / POST | `runs.list(opts)` / `runs.start(body, opts)` | done | GET 的 `?active=1` 判据照抄（`opts.active` 或 `opts.query`），缺参 400；`limits` 走 `generationRunConfig()`（真读环境变量）。POST 同 #1，202 `{ run }` + `{ runId, events }` | `generation-runs/route.ts:83-106` / `43-81` |
| 5 | `generation-runs/events` GET | `runs.allEvents(opts)` | done | 先一条 `runs` 快照帧，之后按 `seq` 变了才发 `run` 帧（`COMMIT_SKEW_MS` 60s 回看照抄）；**没有 `NOTIFY`**（端口无通知通道），只有 30s 轮询；429 + `Retry-After: 5` 与每 owner 上限（默认 16）逐行照搬；无 `vault` 时发一条空快照就结束 | `generation-runs/events/route.ts:35-82` |
| 6 | `generation-runs/[id]` GET / DELETE | `runs.get(id)` / `runs.cancel(id)` | done | GET 的 `media` / `failureSeq` / `mediaFailureSeqs` / `materialKinds` 上游是一条 SQL，这里由**同一份事件日志**重算；DELETE = discard（有课 409、已 ended 幂等、completed 409），额外叫一次 `ports.generate.cancel`（上游靠 lease 丢弃） | `generation-runs/[id]/route.ts:42-76` / `78-93` |
| 7 | `generation-runs/[id]/confirm-outline` POST | `runs.confirmOutline(id, body)` | done | `parseConfirmOutline` 逐行照抄（含 `order = index+1`）；`normalizeSceneOutlines` 未搬 → 注入 `ports.generate.normalizeOutlines` 就用真的，否则只校验「是数组」；幂等靠 `vault.runs.command/putCommand`（**没有事务**：并发下可能重复写事件）；限额判定不在锁内（上游先加 advisory lock） | `generation-runs/[id]/confirm-outline/route.ts:37-66` |
| 8 | `generation-runs/[id]/events` GET | `runs.events(id, opts)` | done | 返回 `AsyncIterable`（`events.js` 的 `runEventStream`），失败分支返回 `{httpStatus, body, headers}`；`after` 同时认 `last-event-id` 头、`?after=`、`opts.after`；500 条一页 + `resync` 分支逐行照抄；429 槽位同 #5 | `generation-runs/[id]/events/route.ts:42-107` |
| 9 | `generation-runs/[id]/hold-outline` POST | `runs.holdOutline(id, body)` | done | `before` 判据（等待确认 or 还没 outline）、`auto` run 409、`wait` run 原样返回，逐行照抄 | `generation-runs/[id]/hold-outline/route.ts:33-54` |
| 10 | `generation-runs/[id]/retry` POST | `runs.retry(id, body)` | done | 状态机（paused → `stateForRetry(step)`）、媒体重试（`media:` 检查点 + `FINAL_RUN_MEDIA_FAILURE_CODES`）逐行照抄；`wakeGenerationRunner()` 由 `ports.generate.resume` 承担（表 10 的「resume 优先」）；`wakeOwnerMaterialExtractor` 没有端口 → 不做 | `generation-runs/[id]/retry/route.ts:41-73` |
| 11 | `stages` GET / POST | `stages.list()` / `stages.create(body)` | done | 列表读 `vault.classroom.list`（摘要即上游 `listDocuments` 的摘要）；宿主库 provider 走 `ports.stage.library`，缺了走 owned 分支（= 上游无 provider）；POST 的三条 400 与 `stage-<base64url>` id 生成逐行照抄 | `stages/route.ts:47-64` / `71-148` |
| 12 | `stages/[id]` GET / PUT / PATCH / DELETE | `stages.get` / `stages.put` / `stages.patch` / `stages.remove` | done | **表里没列 PATCH（改名），已补 `stages.patch`**；`mapSaveError` 照抄（`E_NOT_FOUND`→404、版本冲突→400）；PUT 的 existence-gate 与 `stage.id === 路径 id` 照抄；文档只回 `{stage, scenes, outline}`（不带 `stageMeta`/`assets`） | `stages/[id]/route.ts:68-78` / `121-180` / `81-118` / `183-198` |
| 13 | `stages/[id]/freshness` GET | `stages.freshness(id)` | done | `AsyncIterable` 只产 `stage_freshness` 帧；`retry:` 与 25s 心跳是传输层（`events.js` 形状里没有），交 HTTP 桥；`rev` 上游由触发器维护，这里退化成 `updatedAt`（同毫秒两次写可能看不到）；`maxPolls` 是测试终止开关 | `stages/[id]/freshness/route.ts:44-154` |
| 14 | `stages/[id]/generation-complete` POST | `stages.markComplete(id, body)` | done | 上游是一条窄 UPDATE（`stage_meta.generation_complete`），端口没有窄更新 → 「读 → 改这一个标志 → 整份写回」，**可能与并发整份保存互相覆盖**（已在本行记）；`COURSE_GENERATING` 409 与 403/404 照抄 | `stages/[id]/generation-complete/route.ts:25-75` |
| 15 | `stages/[id]/manifest` GET | `stages.manifest(id)` | done | `{rev, scenes:[{id,order,rev}]}` 形状照抄；`rev` 来源同 #13（`updatedAt`，不是触发器 rev） | `stages/[id]/manifest/route.ts:28-37` |
| 16 | `stages/[id]/publish` POST | `stages.publish(id, body)` | degraded | **端口缺方法**：`ports.stage.setPublished` 未注入即抛 `E_NOT_IMPLEMENTED`（变更类不静默）；`course:publish` 角色 / 匿名 `login_required` 401 / `forbidden` 403 / 已公开幂等 200 照抄；`principal` 需要 `kind`/`roles`，所以本文件另有一个 `withPrincipal`（`support.withOwner` 只传 `{ownerId,headers}`） | `stages/[id]/publish/route.ts:24-76` |
| 17 | `stages/[id]/scenes` GET（**上游没有 POST**） | `stages.scenes(id, opts)` / `stages.putScenes(id, body)` | degraded | GET 的 `ids` 解析（去空、去重、单字符/代理对过滤）、200 上限、400 `empty_scene_ids`/`too_many_scene_ids` 照抄；**表里的 POST 上游不存在**（81 行只有 GET）→ `putScenes` 恒抛 `E_NOT_IMPLEMENTED` | `stages/[id]/scenes/route.ts:48-80` |
| 18 | `stages/[id]/status` GET | `stages.status(id)` | degraded | 无 auth、`{isPublic, publishedAt}`、404 `{error:'not_found'}`、500 `{error:'internal_error'}` 照抄；但 `resolveStageAccess` 要 `stage_meta` 那一行，**`zhiyunClassroomVault` 不写 `stage_meta`** → 接 `ports.stage.access` 之前这条恒 404 | `stages/[id]/status/route.ts:21-44` |
| 19 | `stages/[id]/unpublish` POST | `stages.unpublish(id, body)` | degraded | 同 #16（同一个 `setPublished`，`publishedAt = null`） | `stages/[id]/unpublish/route.ts:21-62` |
| 20 | `stage-meta/[stageId]` GET | `stages.meta(stageId)` | degraded | `{isOwner, isPublic, publishedAt, generationComplete, source}` 照抄且**永不带 `ownerId`**；同 #18，`stage_meta` 来源缺失 → 接 `ports.stage.access` 之前恒 404 | `stage-meta/[stageId]/route.ts:39-88` |

**状态分布：15 done / 5 degraded / 0 skipped。**
5 条 degraded 的共同原因只有一个：**`stage_meta` 端口没有注入**（`ports.stage.access` / `setPublished`）；
`stages.putScenes` 这半个方法是 skipped 级（上游没有 POST），但整行按 GET 可用记 degraded。

需要编排层补的端口方法（按本批的必要性排序）：

1. `ports.stage.access(stageId)` → `{ ownerId, name, isPublic, publishedAt, generationComplete, source, deletedAt } | null`
   —— 否则 #18/#20/#14/#16/#19 五条全靠 `vault.classroom.load` 猜 `stage_meta`，而 vault 根本不写那张表（生产上恒 404）；
2. `ports.stage.setPublished(stageId, isPublic, publishedAt)` —— 否则 publish / unpublish 恒抛 `E_NOT_IMPLEMENTED`；
3. `ports.generate.normalizeOutlines(outlines)` —— 否则 `confirm-outline` 的编辑分支只做数组校验（上游有 `MAX_OUTLINE_SCENES` / JSON 字节上限）；
4. `ports.generate.markComplete(stageId)`（可选）—— 有它就不必用「整份回写」实现 `stages.markComplete`，能恢复上游那条窄 UPDATE；
5. `ports.generate.runner.wake(runId)`（可选）—— 现在用 `resume(runId)` 兼任唤醒，语义比 `wakeGenerationRunner()` 重；
6. `ports.media.extractableMimeTypes({ownerId})` —— 否则 `capabilities.materials.formats` 恒为空清单。

与上游 / 本表记载不一致的地方（**最重要**，都已逐条落到上表）：

- **`stages/[id]/scenes` 上游只有 GET**（`route.ts` 全长 81 行，只有一个 `export async function GET`）；批表第 1 节写的是「GET / POST」，POST 那个 handler 不存在，所以 `stages.putScenes` 没有可搬的 body。本表附录 A 第 331 行的「stages/[id]/scenes | GET」才是对的；
- **`stages/[id]` 是四个动词**（GET/PUT/PATCH/DELETE），批表只给了三个方法名（`get`/`put`/`remove`），PATCH（改名）没有落点 → 已补 `stages.patch`；
- **`generation-runs` GET 必须 `?active=1`**，否则 400「Only the active runs are listed」。本表 §2 第 66 行只写了 GET `{runs, limits}`，漏了这条 400 分支；批表的 `runs.list()` 也没有参数位，所以本实现取 `runs.list(opts)`（`opts.active` / `opts.query`）；
- **`isRunId` 的格式与生成端口对不上**：上游是 `/^run-[A-Za-z0-9_-]{16}$/`（`store.ts:219-221`），而 `zhiyunClassroomGenerate` 用 `randomUUID()` 造 id。照抄会让「刚生成的 run 自己取不到」→ 本文件额外接受 UUID，这是本批唯一放宽的入参判据；
- 主表 §2 把 `generate-classroom` 记成 `generate(brief, opts)`、把 `stages` 记成 `classroom.load/save`；批表改成了 `generate.start` / `stages.*`。两处口径不一致，本批按**批表**落地，`service.generate` 本体仍是 `service.js` 里的空壳（第 0 节要求「不要整体替换」），真正入口是 `generate.start`。

---

## 8. 批 4 落地记录（身份 / 配置 / 校验 / 导出 / PBL，27 条）

> 交付：`src/services/platform.js`（`mountPlatform(service, deps)`）、`tests/classroom-host-platform.test.mjs`（56 例）。
> 挂到 `service.access` / `service.identity` / `service.folders` / `service.modelConfig` / `service.providers` /
> `service.usage` / `service.persistence` / `service.video` / `service.quiz` / `service.pbl`，全部 `Object.assign` 追加；
> `service.providers` 的 `list()`（真实现）与 `set()`（空壳）原样保留。
> 行号是本仓 `sed -n` 数出来的**真实行号**（`ref/OpenMAIC/app/api/…`）。

| # | route | 方法 | 状态 | 差异 | 源文件行号 |
|---|---|---|---|---|---|
| 1 | `access-code/status` GET | `access.status(request)` | done | 上游读 `process.env.ACCESS_CODE`，本包读 `providerConfig.get('accessCode')`；未配置 → `{success:true,enabled:false,authenticated:false}`（照抄）；cookie 从 `headers.cookie` 读，HMAC 令牌逐行照搬 | `access-code/status/route.ts:5-17` |
| 2 | `access-code/verify` POST | `access.verify(body, request)` | done | `cookies().set()` → 响应头 `Set-Cookie`；未配置 → `{success:true,valid:true}`；限流只在 `TRUST_PROXY_HEADERS` 可信身份时计数（上游同策略），`Retry-After` 照抄 | `access-code/verify/route.ts:21-83` |
| 3 | `identity/claim` POST | `identity.claim(request)` | degraded | 上游 `pg` + advisory lock 的 claim 下沉到 `ports.identity.claim(principal)`；端口缺失 → 404 `PERSISTENCE_NOT_CONFIGURED`（上游 `DATABASE_URL` 未配分支）；`CLAIM_REFUSAL_STATUS` 六种码照抄（含 503 `OWNER_BUSY` + `Retry-After`） | `identity/claim/route.ts:32-72` |
| 4 | `identity/legacy-import-binding` POST | `identity.legacyBinding(body, request)` | degraded | 下沉到 `ports.identity.bindLegacyImport(ownerId, browserId)`；`BROWSER_ID_PATTERN=/^[0-9a-f]{32}$/`、`assurance==='minted' → 409 OWNER_NOT_ESTABLISHED` 照抄；端口缺失 → 404 | `identity/legacy-import-binding/route.ts:43-85` |
| 5 | `folders` GET / POST | `folders.list(request)` / `folders.create(body, request)` | done | 持久层是 `vault.kv`（`folders/<ownerId>/<id>`），不是 `pg`；`order` 用「当前列表长度」（上游 SQL 是最大 +1），并发创建可能同序；无 kv → 纯文本 404 | `folders/route.ts:54-71` / `78-121` |
| 6 | `folders/[id]` **PATCH** / **DELETE** | `folders.update(id, body, request)` / `folders.remove(id, request)` | done / **skipped** | **上游没有 GET**（批表写了 GET/PATCH/DELETE）→ `folders.get` 恒抛 `E_NOT_IMPLEMENTED`；`?mode=ungroup\|remove` 的分支与 `removedStageIds` 照抄 | `folders/[id]/route.ts:41-101` / `104-126` |
| 7 | `folders/members` **POST** | `folders.members.add(body, request)` / `.remove(body, request)` | done / **skipped** | **上游只有 POST**（批表写了 GET/POST/DELETE）：`add` 是 POST 本体，`remove` 是同一 handler 的 `folderId:null` 分支（上游注释 `4-9`）；`members.list` 无对应 handler → 恒抛 | `folders/members/route.ts:36-76` |
| 8 | `model-config` GET / PUT | `modelConfig.get(request)` / `modelConfig.put(body, request)` | degraded | **不读 `provider-config`**：上游是 owner 分区的工作区设置表 + `revision`（zod `.strict()`），`provider-config` 只供 deployment 层 → 下沉 `ports.modelConfig.view/apply`；端口缺 → 纯文本 404；三条 change 的入参校验逐条照抄 | `model-config/route.ts:44-50` / `82-141` |
| 9 | `model-config/import` POST | `modelConfig.import(body, request)` | degraded | `ports.modelConfig.import(ownerId, proposal)`；`MAX_ATTEMPTS=3` 的重试在端口内（那是事务性质）；缺端口 → 404 | `model-config/import/route.ts:43-98` |
| 10 | `provider/probe-models` POST | `providers.probe(body, request)` | done | `buildModelsUrlCandidates` + `fetchModels` 逐行搬（含 15s/30s 预算、404/405 换候选、一次重试）；transport 用 `deps.fetch`（无 undici DNS 钉定，差额同 `src/upstream/provider-fetch.js` 头注）；按已保存 provider 探测缺端口 → 抛 | `provider/probe-models/route.ts:26-109` |
| 11 | `verify-model` POST | `providers.verifyModel(body, request)` | degraded | 上游 `resolveModel`+`callLLM` 只保留「一条 `chat/completions`」；无 key → 401（上游解析不出模型的分支），无 `baseUrl` → 400；已保存 provider 分支缺端口 → 抛；错误按 HTTP status 翻固定文案（逐条照抄） | `verify-model/route.ts:19-23` / `25-120` |
| 12 | `verify-image-provider` POST | `providers.verifyImage(body, request)` | degraded | 10 个适配器的 `test*Connectivity` 未逐个搬，统一 `probeMediaProvider`（`probe-auth` 的固定文案与判定照抄，路径表 `MEDIA_PROBE_PATHS` 只覆盖读到的几个）；注册表只保留 `requiresApiKey/defaultBaseUrl/hasModels`；按 id 测已保存 provider 缺端口 → 抛 | `verify-image-provider/route.ts:43-139` |
| 13 | `verify-pdf-provider` POST | `providers.verifyPdf(body, request)` | degraded | AliDocMind 走 SDK 签名 → `ports.providers.verifyAliDocMind`，缺端口 → 抛；MinerU Cloud / 自托管的探测请求与固定文案照抄；客户端 endpoint 只认官方 `docmind-api.*.aliyuncs.com` | `verify-pdf-provider/route.ts:122-247` |
| 14 | `verify-video-provider` POST | `providers.verifyVideo(body, request)` | degraded | 同 #12（6 个 video 适配器）；注意上游 video 的 `MISSING_API_KEY` 是**无条件**判（不像 image 看 `requiresApiKey`） | `verify-video-provider/route.ts:43-136` |
| 15 | `azure-voices` **POST** | `providers.azureVoices(body)` | done | **批表写 GET，上游只有 POST**；`Ocp-Apim-Subscription-Key`、20s 超时、401/403 → 502 固定文案、非数组 → 502 照抄 | `azure-voices/route.ts:25-87` |
| 16 | `usage` GET | `usage.get(q)` | done | 读 `dataDir/usage/`（`dataDir` 为 null → 上游的 `cwd/data/usage`）；聚合（byModel/byDay/byKind、`totalTokens=input+output`）逐行照抄 | `usage/route.ts:71-116` |
| 17 | `persistence/[...path]` GET / PUT / DELETE | `persistence.get(path)` / `.put(path, body)` / `.remove(path)` | degraded | 上游是 `@openmaic/storage` 的 HTTP 网关（documents/assets/runtime 三套契约 + `pg`），本包落 `dataDir/persistence/` 的 JSON 文件树；**补了路径穿越校验**（上游路由自身没有 `normalize`，它把路径交给 storage 路由表）；写入原子（tmp+rename）；`dataDir` 为 null → 404 `PERSISTENCE_NOT_CONFIGURED` | `persistence/[...path]/route.ts:486-593` |
| 18 | `export-video/capability` GET | `video.capability()` | done | `getRenderServiceCapability` 逐行搬（未配 URL → `{enabled:false}`；`/health` 不通或没 owner-bound 标记 → `{enabled:false}`，永不抛） | `export-video/capability/route.ts:13-16` |
| 19 | `export-video/render` POST | `video.render(body, request)` | done | multipart **原始字节**原样转发（不 `formData()`）；300MB 上限、429/413 的状态与 `reason` 映射照抄；`ports.export.video` 优先，否则 `RENDER_SERVICE_URL` + `deps.fetch` | `export-video/render/route.ts:29-116` |
| 20 | `export-video/render/[jobId]` GET / **DELETE** | `video.job(jobId, request)` / `video.cancel(jobId, request)` | done | 批表只列 GET，上游还有 DELETE（取消）→ 已补 `video.cancel`；404/502 分支照抄 | `export-video/render/[jobId]/route.ts:18-53` / `56-92` |
| 21 | `export-video/render/[jobId]/download` GET | `video.download(jobId, request)` | done | **二进制分支** `{httpStatus, buffer, mimeType, headers}`；301/302 透传 `location`（不带 buffer）；`Content-Disposition`/`Cache-Control` 照抄 | `export-video/render/[jobId]/download/route.ts:26-90` |
| 22 | `quiz-grade` POST | `quiz.grade(body, request)` | degraded | `callLLM` → `ports.agent.complete`（或 `ports.media.complete`），端口缺 → 抛 `E_NOT_IMPLEMENTED`；提示词、JSON 提取、`50%` 兜底逐行照抄；`thinkingConfig`/`serverManaged` 没有端口位（已记 §8 附注） | `quiz-grade/route.ts:29-117` |
| 23 | `pbl/v2/evaluate` POST（**SSE**） | `pbl.evaluate(body, request)` | degraded | 上游三种 `kind` 各跑一个 evaluator 流；本包 `ports.pbl.evaluate` 优先，否则 `rubric`+`grade` 组装成 `project_patch{evaluation}` + `done`；无 `ports.pbl` → 抛 | `pbl/v2/evaluate/route.ts:56-131` |
| 24 | `pbl/v2/instructor` POST（**SSE**） | `pbl.instructor(body, request)` | degraded | `ports.pbl.instructorTurn`：现有五方法（plan/buildPlan/rubric/grade/briefing）里**没有**对话轮 → 缺了就抛 | `pbl/v2/instructor/route.ts:37-76` |
| 25 | `pbl/v2/open-task` POST（**SSE**） | `pbl.openTask(body, request)` | degraded | `ports.pbl.openTask` 优先，否则退到 `instructorTurn({userMessage:'', phase})`（上游就是同一个 `runInstructorTurn`）；都没有 → 抛 | `pbl/v2/open-task/route.ts:39-94` |
| 26 | `pbl/v2/simulator` POST（**SSE**） | `pbl.simulator(body, request)` | degraded | `ports.pbl.simulatorTurn`；缺 → 抛 | `pbl/v2/simulator/route.ts:38-73` |
| 27 | `pbl/v2/task/update` POST | `pbl.updateTask(body, request)` | degraded | 上游五个确定性动作在 `progress` kernel 里（未搬）；`ports.pbl.updateTask(body)`；缺 → 抛 | `pbl/v2/task/update/route.ts:46-160` |

**状态分布：10 done / 15 degraded / 2 skipped。**

- degraded 的 15 条全部只因为**端口未注入**（不是逻辑没搬）：`ports.identity`（#3/#4）、`ports.modelConfig`（#8/#9）、
  `ports.providers.*`（#11~#14 的「按已保存 provider 测」分支与 AliDocMind SDK）、`ports.agent`（#22）、
  `ports.pbl.*`（#23~#27）。端口注进来，上表对应行立刻变真数据，**route body 一行不用改**。
- skipped 的 2 条是**上游没有那个 handler**：`folders.get`（`folders/[id]` 只有 PATCH/DELETE）、
  `folders.members.list`（`members` 只有 POST）。不编一个上游不存在的读接口。

与上游 / 批表记载不一致的地方（**最重要**，都已落到上表）：

- **`azure-voices` 上游只有 POST**（路由名是 GET 的写法，handler 是 `POST {apiKey, baseUrl}`）；批表写 GET → 本包按 POST 搬；
- **`folders/[id]` 上游只有 PATCH / DELETE**，批表多写了一个 GET；
- **`folders/members` 上游只有 POST**，一个 handler 同时表达「归入」与「取消归属」；批表写的 GET/DELETE 落成 `members.list`（无 handler，抛）与 `members.remove`（`folderId:null` 分支）；
- **`persistence/[...path]` 上游导出 GET/POST/PUT/PATCH/DELETE 五个动词**，批表只列三个；本批按「KV 文件树」只落 get/put/remove（POST/PATCH 没有可映射的语义）；
- **`export-video/render/[jobId]` 上游还有 DELETE**（取消任务），批表只列 GET → 已补 `video.cancel`；
- **`model-config` 不读 `provider-config`**（任务书这么写）：上游是 owner 分区的工作区设置表 + `revision` 乐观锁 + zod `.strict()` 三种 change，
  `provider-config` 只提供 deployment 层；所以 `modelConfig.get/put/import` 必须走 `ports.modelConfig`，`providerConfig` 只用在 `verify-*` 的
  `resolve*ApiKey/BaseUrl/Model` 与 `requestProvidersAllowed()`；
- **`access-code/status` 的 body 是 `{enabled, authenticated}`**，没有任务书里说的 `required` 字段；「未启用访问码」在 `status` 上是
  `enabled:false`，在 `verify` 上是 `{success:true,valid:true}` —— 两处不是同一个分支；
- **`pbl/v2/*` 四条都是 SSE**（批表没标），且 `evaluate` 是「一个 handler 三分支（`kind`）」而不是三个 route；
  本包返回 `AsyncIterable<event>`，事件是**扁平**的 `{type, ...payload}`（上游 SSE 帧的 `data` + `event:` 名），不是 `events.js` 的 `{type,data}`；
- **`quiz-grade` 的 `callLLM` 带 `thinkingConfig` / `serverManaged`** 两个模型层参数（来自 `resolveModelFromRequest`），
  端口只保留 `{system, prompt, source, request}` —— 思考链配置目前无处可传；
- **`verify-model` 的第一个分支是 owner 解析失败 401**（不是 body 校验），本包用 `deps.owner.resolve` 表达。

需要编排层补的端口方法（按本批的必要性排序）：

1. `ports.pbl.instructorTurn({project, userMessage, phase, signal})` / `ports.pbl.simulatorTurn(opts)` —— 否则 #24~#26 恒抛；
2. `ports.pbl.updateTask(body)` —— 否则 #27 恒抛（上游是纯确定性状态机，没有 LLM，最容易补）；
3. `ports.modelConfig.view(ownerId)` / `.apply(ownerId, {revision, change})` / `.import(ownerId, proposal)` —— 否则 #8/#9 恒 404；
4. `ports.identity.claim(principal)` / `.bindLegacyImport(ownerId, browserId)` —— 否则 #3/#4 恒 404；
5. `ports.agent.complete({system, prompt, source, request}) -> {text}` —— 否则 #22 恒抛；
6. `ports.providers.savedChatEndpoint(ref, request)` / `.savedMediaConnection(kind, ref, request)` / `.verifyAliDocMind(creds)` —— 否则 #11~#14 的「按 id 测已保存 provider」分支恒抛；
7. `ports.export.video(payload, ctx) -> {httpStatus, body}` —— 可选：不注入时本包用 `RENDER_SERVICE_URL` + `deps.fetch` 自己发（与上游同路径）；
8. `ports.pbl.evaluate(body, ctx)` —— 可选：不注入时本包用 `rubric` + `grade` 组装（结果流式度为 1 帧）。

---

## 7. 批 3 落地记录（智能体 / 会话 / 技能 / 对话，16 条）

> 交付：`src/services/agent-runtime.js`（`mountAgentRuntime(service, deps)`）、
> `tests/classroom-host-agent-runtime.test.mjs`（49 例）。
> 挂到 `service.agents` / `sessions` / `runtime` / `skills` / `chat`：全部 `Object.assign`，
> 不替换任何命名空间；`service.agents` 只补 `get/put/remove/import` 四个键，
> `agents.js` 的 `list/create` 原样保留（理由写在 `agent-runtime.js` 文件头）。
> 行号是本仓 `sed -n` 数出来的**真实行号**（`ref/OpenMAIC/app/api/…`）。
>
> 端口：`ports.agent`（`plan/run` + `sessions` 存储面 + `registry` + `resolveElementReference`
> + `assertWorkspaceModelsAuthorized`）、`deps.agents`（与 `agents.js` 同一个注册表端口，
> 额外用 `update/remove/import/get`）、`ports.vault.kv`（`deps.agents` 未注入时的自定义 agent）、
> `ports.export.skillZip`。任一为 `null` 时按下面的规则走：**查询类**回上游「没有持久层 /
> 没有 runtime」那条分支，**变更类**抛 `E_NOT_IMPLEMENTED`（`detail.source` 指到 handler 行号）。

| # | route | 方法 | 状态 | 差异 | 源文件行号 |
|---|---|---|---|---|---|
| 1 | `agents/[id]` PUT / DELETE（**上游没有 GET**） | `agents.put(id, body)` / `agents.remove(id)` / `agents.get(id)` | done | **批表写了 GET，上游没有**（全长 64 行只有 PUT/DELETE）→ `get` 按批表补，读的是 PUT 写的那一行（`vault.kv` 的 `agents/<id>`）；`zod` 的 `customAgentSchema` 换成 30 行手写校验（`.strict()` 保留）；`readCappedJson` 的字节上限没有落点（没有流），改成不判 | `agents/[id]/route.ts:31-46` / `48-63` |
| 2 | `agents/import` POST | `agents.import(body)` | done | 逐条「内置 → schema → 已存在」的跳过原因照抄；`importOwnerAgents` 的事务由端口负责（vault 版是逐条 `set`，**没有事务**）；`BODY_TOO_LARGE` 分支缺（没有字节流） | `agents/import/route.ts:39-83` |
| 3 | `agent/sessions` GET / POST | `sessions.list(q)` / `sessions.create(body)` | done | 六条 400（existingCourse/stageId、prompt、materialIds、courseRefs、locale）逐行照抄；`assertWorkspaceModelsAuthorized` 走端口，未注入即跳；`scheduleConversationTitle` 同理；`buildRequestOrigin(req)` 换成 `opts.origin` | `agent/sessions/route.ts:226-236` / `43-224` |
| 4 | `agent/sessions/[id]` GET / PATCH（**上游没有 DELETE**） | `sessions.get(id)` / `.update(id, body)` / `.remove(id)` | degraded | **批表写了 DELETE，上游没有**（63 行只有 GET/PATCH）→ `remove` 恒抛 `E_NOT_IMPLEMENTED` 并注明；`normalizeSessionTitleOverride` 逐行照抄（U+FFFD / 120 上限 / 不切代理对） | `agent/sessions/[id]/route.ts:13-27` / `29-63` |
| 5 | `agent/sessions/[id]/cancel` POST | `sessions.cancel(id)` | done | 终态三条 409 `SESSION_ALREADY_TERMINAL` 与 202 `{id, cancelRequested}` 照抄；lease 观察者写终态事件是 runner 的事，本包只让请求持久化 | `agent/sessions/[id]/cancel/route.ts:16-45` |
| 6 | `agent/sessions/[id]/events` GET | `sessions.events(id, opts)` | done | `AsyncIterable`；**回放历史 + 之后实时**保留（`phase: backlog/live`、`caught_up{replayed,fromEventId}`、degraded caught_up、终态放慢到 10s）；续读同时认 `Last-Event-ID`、`?lastEventId=`（上游）与 `?after=`（本包别名）；**没有 LISTEN/NOTIFY**，只有轮询；`message_update` 的中间 token 由端口的 `readEventsAfterForReplay` 压缩（上游在 store 里做） | `agent/sessions/[id]/events/route.ts:60-298` |
| 7 | `agent/sessions/[id]/messages` POST（**上游没有 GET**） | `sessions.send(id, body)` / `sessions.messages(id)` | degraded | **批表写了 GET，上游没有**（149 行只有 POST）→ `messages` 走端口的 `listMessages`，端口没有就 404（不编一份 transcript）；`elementRefs` / `courseRefs` 的解码逐行照抄；`AgentSessionAccessError` 的 403 与退役 403 走 `ownerWriteError` 接缝 | `agent/sessions/[id]/messages/route.ts:27-149` |
| 8 | `agent/sessions/status` GET | `sessions.status()` | done | `Object.fromEntries(sessions.map([id, status]))` 照抄（稀疏映射，不补齐） | `agent/sessions/status/route.ts:11-20` |
| 9 | `agent/runtime` GET（**上游没有 POST**） | `runtime.get()` / `runtime.start(body)` | degraded | **批表把这条记成「长连接 / 按 owner 起一个 runtime 实例」，上游不是**：35 行只有一个 GET，返回 `{enabled, runtimeEnabled, persistence}` 三个布尔 → `get` 照抄形状（判的是"端口在不在"）；`start` 恒抛 `E_NOT_IMPLEMENTED`，除非端口声明了 `startRuntime` | `agent/runtime/route.ts:27-35` |
| 10 | `agent/owner-events` GET | `runtime.ownerEvents(opts)` | done | `AsyncIterable`；`resync_required`（`cursor_ahead` / `too_far_behind`，阈值 1000）、`owner_moved`、degraded caught_up、30s 轮询照抄；心跳帧 `: ping` 是传输层（契约里没有注释帧）→ 交 HTTP 桥；`Set-Cookie`（退役凭证）同样交桥 | `agent/owner-events/route.ts:39-344` |
| 11 | `agent/skills` GET / POST | `skills.list()` / `skills.install(body)` | done | 上游读**文件系统** `skills/`，本包读 `dataDir/skills/`；`dataDir === null` 走上游「目录不存在 → 空清单」；`req.formData()` → `{ buffer, filename, mimeType }`；三条闸门（400 无文件 / 413 >1 MiB / 400 invalid-upload）照抄；`.zip` 要 JSZip → 抛；`createUserSkill` 的 pg 行换成 `<dataDir>/skills/usk_<hex>/SKILL.md` | `agent/skills/route.ts:27-45` / `48-104` |
| 12 | `agent/skills/[id]` GET / DELETE（**上游没有 PUT**） | `skills.get(id)` / `.remove(id)` / `skills.put(id, body)` | degraded | **批表写了 PUT，上游没有**（54 行只有 GET/DELETE）→ `put` 恒抛（上游的编辑是 `patchUserSkill` 的 JSON-pointer 补丁，不是整份覆盖）；DELETE 的 `usk_` 前缀 405 照抄 → 本包的 `install` 用 `usk_` 前缀，所以只有上传的技能可删 | `agent/skills/[id]/route.ts:18-29` / `31-54` |
| 13 | `skills/[id]` GET | `skills.view(id)` | degraded | **批表写「复用 skills.get」，上游返回的不是 JSON 而是 `application/zip`**（`buildUserSkillZip`，JSZip）→ 注入 `ports.export.skillZip` 前恒抛；`isSafeSkillId` 400 与"不存在 404"两条分支照抄；`id === 'openmaic'` 打的是仓库 `skills/` 目录，本包没有该树 → 抛 | `skills/[id]/route.ts:23-48` |
| 14 | `chat/pi` POST | `chat.send(body)` | done | 不引 CopilotKit：`resolveModel` / `runPiDirectorLoop` 换成 `ports.agent.plan` + `.run`（`AsyncIterable`）；handler 的九条业务判断（messages / storeState / agentIds / 课件引用开关 / scenes 成员 / 元素引用 / agentIds 形态 / agent 解析 / 传输）**顺序与文案照抄**；`:heartbeat` 帧、`X-OpenMAIC-Element-Reference-Accepted` 响应头没有落点 → 交 HTTP 桥；`resolveModel` 的 401/400 三条模型分支留给端口抛 | `chat/pi/route.ts:48-63` / `65-387` |
| 15 | `chat/pi/whiteboard-visibility` POST | `chat.whiteboardVisibility(body)` | done | **任务书说的「存储键与默认值」在上游是进程内的待决登记**：键 `Symbol.for('openmaic.pi.whiteboard-visibility.pending')`、默认 `'unknown'`（超时 / 派发失败 / 中止），不是持久配置项 —— 两者都逐字照抄；body 必须**恰好**三个键，`queryId`+`stageId`+`learnerKey` 三者对不上即 404 | `chat/pi/whiteboard-visibility/route.ts:35-45` / `47-67` |
| 16 | `agents` GET / POST（**本批第 16 条，已在 `agents.js` 搬完**） | `agents.list()` / `agents.create(body)` | done | 不在本文件：`src/services/agents.js` 已交付，本批**未改动**它；它的端口（`deps.agents`）与降级（vault `agents/<id>`）与本文件共用同一键空间，所以 `agents.get/put/remove/import` 与它看到的是同一份数据 | `agents/route.ts:23-29` / `31-48` |

**状态分布：11 done / 5 degraded / 0 skipped。**
5 条 degraded 里有 4 条是**上游根本没有那个动词**（`sessions.remove` 的 DELETE、
`sessions.messages` 的 GET、`runtime.start` 的 POST、`skills.put` 的 PUT），
1 条是二进制 zip 需要 JSZip（`skills.view`）—— 都不是"没搬完"，是"上游没有可搬的 body"。

需要编排层补的端口方法（按本批的必要性排序）：

1. `ports.agent.sessions` —— 上游 `AgentSessionStore` 的子集，缺它 `sessions.*` 与
   `runtime.ownerEvents` 整批降级：
   `getSession(id)`、`listSessionsByOwner(ownerId)`、`createSession(input)`、
   `setManualSessionTitle(id, ownerId, title)`、`requestCancel(id)`、
   `postUserMessage(id, message, { expectedOwnerId })`、`listMessages(id, opts)`、
   `readEventsAfterForReplay(id, cursor, limit) -> { events, scanned }`、
   `readMaxId(ownerId)`、`readAfter(ownerId, cursor, limit)`、`readRetirement(ownerId)`、
   `softDeleteSession(id, ownerId)`、`bindMaterials(sessionId, ownerId, ids)`、
   `scheduleConversationTitle(id, ownerId)`；
2. `ports.agent.registry.getAgent(id, ownerId)` —— 否则 `chat.send` 只能靠
   `body.config.agentConfigs` 里的覆盖，任何真 agent id 都会 400
   `Unknown classroom agents`（这是上游在"注册表为空"时的原答案，不是新错误）；
3. `ports.agent.resolveElementReference(body)` —— 否则带课件引用的 `chat/pi` 请求恒抛
   （上游那份 1640 行的解析没搬）；
4. `ports.agent.assertWorkspaceModelsAuthorized(ownerId, slots)` —— 否则
   `sessions.create` / `sessions.send` 的模型授权闸门不判（上游会 401/403）；
5. `ports.export.skillZip(id, skill)` —— 否则 `skills.view` 恒抛，`GET /api/skills/:id` 不可用；
6. `deps.agents` 的 `get/update/remove/import` —— 否则这四个方法只能走 vault 降级，
   `agents.js` 的注册表（内置 agent 清单）在这里看不见；
7. `ports.agent.startRuntime(body)`（可选）—— 上游没有这个 POST，给编排层留的扩展位。

与上游 / 本表记载不一致的地方（**最重要**，都已逐条落到上表）：

- **`agent/runtime` 不是长连接**：批表第 9 行写「GET / POST」「按 owner 起一个 runtime 实例」，
  而上游 `route.ts` 全长 35 行、只有一个 `GET`，返回的是三个布尔的状态探针
  （`enabled` / `runtimeEnabled` / `persistence`）。没有 POST、没有 SSE、没有实例。
  本批按**上游**落地（`runtime.get` = 探针；`runtime.start` = 恒抛），批表那两格是照旧文档抄的；
- **`agents/[id]` 没有 GET**、**`agent/sessions/[id]` 没有 DELETE**、
  **`agent/sessions/[id]/messages` 没有 GET**、**`agent/skills/[id]` 没有 PUT**：
  四个动词在批表里有、在上游没有（分别 64 / 63 / 149 / 54 行的文件只有一个或两个导出）；
- **`skills/[id]` 不是 JSON**：批表写「复用 `skills.get`」，上游回的是 `application/zip`
  二进制（`Content-Disposition: attachment; filename="<id>-skill.zip"`）；
- **白板可见性不是"开关的存储键与默认值"**：上游没有持久层，是进程内 `Map`
  （`Symbol.for('openmaic.pi.whiteboard-visibility.pending')`），默认值 `'unknown'`
  表示"没人回答"，不是"关"。照抄时把这两点都保留了（见 `PENDING_VISIBILITY_KEY` 的注释）；
- `agent/sessions` POST 的 `assertWorkspaceModelsAuthorized` 与 `scheduleConversationTitle`
  在批表里没有落点：前者是模型授权闸门（本包无端口），后者是异步标题任务（端口可选）。
