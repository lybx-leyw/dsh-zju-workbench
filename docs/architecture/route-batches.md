# 路由搬运分批表（L1 → 4 个并行批次）

> 上游：`ref/OpenMAIC`（**只读**）。本表覆盖 `app/api/` 下全部 **82** 条 `route.ts`。
> 已完成：`health`、`server-providers`（在 `src/upstream/`，不在本表）。
> 本表剩余 **80** 条，分 4 批并行搬。

---

## 0. 共同的挂载协议（4 批都一样，逐字照做）

每条 route 搬成一个方法，挂在 `ctx.zhiyunClassroomStudio` 的某个命名空间下。
每个批次**只创建自己的文件**，不改 `src/service.js` / `src/index.js`（由编排层统一接）。

### 文件
```
src/services/<批次名>.js      ← 只此一个文件归你
tests/classroom-host-<批次名>.test.mjs
```

### 导出
```js
export function mount<批次名首字母大写>(service, deps) { … }
```

- `service`：`createClassroomService` 的返回值（已含 `status` / `providers.list` / 若干 `E_NOT_IMPLEMENTED` 桩）
- `deps`：`{ ports, log, dataDir, providerConfig }`
  - `ports`：`{ vault, media, generate, agent, pbl, export, stage, studio }`，任一可能为 `null`
  - `log`：`{ debug, info, warn, error }`
  - `dataDir`：`string|null`（本包的数据目录，`profileContext.dir/data/zhiyun-classroom/`）
  - `providerConfig`：`{ configured, get(key) }`（`upstream/provider-config.js`）

### 挂载方式
```js
service.runs = Object.assign(service.runs ?? {}, { get, cancel, list, start, … });
service.stages = Object.assign(service.stages ?? {}, { … });
service.generate = Object.assign(service.generate, { capabilities, job, start }); // 保持可调用
```
**不要**整体替换 `service.generate` / `service.providers` / `service.status` —— 已有实现要留着。

### 返回值（三选一，与 `src/services/support.js` 一致）
| 上游写法 | 本包返回 |
|---|---|
| `NextResponse.json(body, { status })` | `{ httpStatus, body, headers }` |
| `new Response('Not found', { status })` | `{ httpStatus, body: 'Not found', headers }` |
| `new Response(buffer, { headers })` | `{ httpStatus, buffer, mimeType, headers }` |
| SSE / 流式 `Response` | `AsyncIterable<event>`（`src/events.js` 的形状） |
| `req.formData()` / `req.arrayBuffer()` | 入参直接收 `{ buffer, filename, mimeType }` 或 `{ fields, files }` |

### 降级（硬性）
端口缺失时**不许编数据**：
- 查询类：返回上游「没有持久层」的那条分支（多半是 `404` 文本或 `{ success:false }`）；
- 变更/生成类：`throw new ClassroomError('E_NOT_IMPLEMENTED', '…', { source: 'app/api/…/route.ts:行号' })`；
- 一律在文件头注释里写清「端口缺失时的行为」。

### 搬运纪律
- 上游 handler body 的**业务逻辑一行不许改**，只换签名（`NextRequest` → 普通参数，`NextResponse` → 上面的返回形状）；
- 删掉 `revalidate` / `cookies()` / `runtime = 'nodejs'` 这类 Next 专有声明，在注释里记一句；
- 每个方法上方写 `// 源文件:app/api/…/route.ts:起-止`（行号必须真实，自己 `sed -n` 数）；
- 上游注释保留（英文也保留），本包补充的中文注释另起一段。

### 测试
`tests/classroom-host-<批次名>.test.mjs`，`node --test` 必须全绿：
- 每条 route 至少 1 例：入参校验（400 分支）+ 正常分支；
- 用假 `deps.ports`（内存版），照 `tests/classroom-host.test.mjs` 的 stub 写法；
- 断言 `httpStatus` + `body` 的关键字段，不断言整个 body（上游加字段不该让测试红）。

---

## 批 1：生成 / 运行 / 舞台（20 条）→ `src/services/generation.js`

| # | 上游 route | 方法（挂到哪） | 备注 |
|---|---|---|---|
| 1 | `generate-classroom` POST | `generate.start(brief, opts)` | 返回 `{ runId, events }`，`events` 是 `AsyncIterable`；端口 `generate` 缺失→抛 |
| 2 | `generate-classroom/capabilities` GET | `generate.capabilities()` | 读 `providerConfig`，纯函数 |
| 3 | `generate-classroom/[jobId]` GET | `generate.job(jobId)` | 查询 |
| 4 | `generation-runs` GET / POST | `runs.list()` / `runs.start(body)` | |
| 5 | `generation-runs/events` GET | `runs.allEvents(opts)` | 跨 run 的事件流，`AsyncIterable` |
| 6 | `generation-runs/[id]` GET / DELETE | `runs.get(id)` / `runs.cancel(id)` | DELETE = cancel |
| 7 | `generation-runs/[id]/confirm-outline` POST | `runs.confirmOutline(id, body)` | |
| 8 | `generation-runs/[id]/events` GET | `runs.events(id, opts)` | `AsyncIterable` |
| 9 | `generation-runs/[id]/hold-outline` POST | `runs.holdOutline(id, body)` | |
| 10 | `generation-runs/[id]/retry` POST | `runs.retry(id, body)` | 端口 `generate.resume` 优先 |
| 11 | `stages` GET / POST | `stages.list()` / `stages.create(body)` | 端口 `vault.classroom` |
| 12 | `stages/[id]` GET / PUT / PATCH / DELETE | `stages.get(id)` / `stages.put(id, doc)` / `stages.remove(id)` | |
| 13 | `stages/[id]/freshness` GET | `stages.freshness(id)` | |
| 14 | `stages/[id]/generation-complete` POST | `stages.markComplete(id, body)` | |
| 15 | `stages/[id]/manifest` GET | `stages.manifest(id)` | |
| 16 | `stages/[id]/publish` POST | `stages.publish(id, body)` | |
| 17 | `stages/[id]/scenes` GET / POST | `stages.scenes(id)` / `stages.putScenes(id, body)` | |
| 18 | `stages/[id]/status` GET | `stages.status(id)` | |
| 19 | `stages/[id]/unpublish` POST | `stages.unpublish(id, body)` | |
| 20 | `stage-meta/[stageId]` GET | `stages.meta(stageId)` | |

---

## 批 2：素材 / 媒体 / 解析（17 条）→ `src/services/media.js`

| # | 上游 route | 方法 | 备注 |
|---|---|---|---|
| 1 | `materials` GET / POST | `materials.list(q)` / `materials.create(body)` | `create` 收 `{buffer,filename,mimeType}`：字节 → `vault.assets`（键 `material-<id>`，`meta.name` 存原始文件名），元数据 → `vault.kv`，带 `sessionId` 时另写 `vault.materials`。**讲义链路靠它**（§8.5） |
| 2 | `materials/[id]` GET / DELETE | `materials.get(id)` / `materials.remove(id)` | |
| 3 | `materials/[id]/extraction` GET | `materials.extraction(id)` | |
| 4 | `materials/[id]/original` GET | `materials.original(id)` | 二进制分支 |
| 5 | `materials/folders` GET / POST | `materials.folders.list()` / `.create(body)` | |
| 6 | `materials/folders/[id]` PATCH / DELETE | `materials.folders.update(id, body)` / `.remove(id)` | |
| 7 | `materials/library` GET | `materials.library(q)` | |
| 8 | `materials/move` POST | `materials.move(body)` | |
| 9 | `classroom-media/[classroomId]/[...path]` GET | `media.asset(classroomId, path)` | 二进制；端口 `vault.assets` |
| 10 | `parse-pdf` POST | `media.parsePdf(file)` | 端口 `media.parsePdf` |
| 11 | `transcription` POST | `media.transcribe(file, opts)` | 端口 `media.asr` |
| 12 | `proxy-media` GET | `media.proxy(url, opts)` | 二进制 + 上游 HTTP |
| 13 | `comfyui-workflows` GET | `media.comfyuiWorkflows()` | 读 `public/`；无目录→空清单 |
| 14 | `generate/image` POST | `media.image(body)` | 端口 `media.image` |
| 15 | `generate/tts` POST | `media.tts(body)` | 端口 `media.tts` |
| 16 | `generate/video` POST | `media.video(body)` | 端口 `media.video` |
| 17 | `generate/voice` POST | `media.voice(body)` | 端口 `media.voice` 或 `providers` |

---

## 批 3：智能体 / 会话 / 技能 / 对话（16 条）→ `src/services/agent-runtime.js`

> 注意：`src/services/agents.js` **已存在**（`GET/POST /api/agents` 已搬完）。
> 你**只新建** `agent-runtime.js`，不要动 `agents.js`。`agents/[id]` 和 `agents/import` 留给你（在 `agents.js` 里加会冲突 → 改为在 `agent-runtime.js` 里 `service.agents = Object.assign(service.agents, {...})` 覆盖，并在注释里说明）。

| # | 上游 route | 方法 | 备注 |
|---|---|---|---|
| 1 | `agents/[id]` GET / PUT / DELETE | `agents.get(id)` / `agents.put(id, body)` / `agents.remove(id)` | |
| 2 | `agents/import` POST | `agents.import(body)` | |
| 3 | `agent/sessions` GET / POST | `sessions.list(q)` / `sessions.create(body)` | 端口 `agent` |
| 4 | `agent/sessions/[id]` GET / PATCH / DELETE | `sessions.get(id)` / `.update(id, body)` / `.remove(id)` | |
| 5 | `agent/sessions/[id]/cancel` POST | `sessions.cancel(id)` | |
| 6 | `agent/sessions/[id]/events` GET | `sessions.events(id, opts)` | `AsyncIterable` |
| 7 | `agent/sessions/[id]/messages` GET / POST | `sessions.messages(id)` / `.send(id, body)` | |
| 8 | `agent/sessions/status` GET | `sessions.status()` | |
| 9 | `agent/runtime` GET / POST | `runtime.get()` / `runtime.start(body)` | |
| 10 | `agent/owner-events` GET | `runtime.ownerEvents(opts)` | `AsyncIterable` |
| 11 | `agent/skills` GET / POST | `skills.list()` / `skills.install(body)` | |
| 12 | `agent/skills/[id]` GET / PUT / DELETE | `skills.get(id)` / `.put(id, body)` / `.remove(id)` | |
| 13 | `skills/[id]` GET | `skills.view(id)` | 复用 `skills.get` |
| 14 | `chat/pi` POST | `chat.send(body)` | `AsyncIterable` 或一次性，按上游 |
| 15 | `chat/pi/whiteboard-visibility` POST | `chat.whiteboardVisibility(body)` | |

---

## 批 4：身份 / 配置 / 校验 / 导出 / PBL / 其他（27 条）→ `src/services/platform.js`

| # | 上游 route | 方法 | 备注 |
|---|---|---|---|
| 1 | `access-code/status` GET | `access.status()` | |
| 2 | `access-code/verify` POST | `access.verify(body)` | |
| 3 | `identity/claim` POST | `identity.claim(body)` | |
| 4 | `identity/legacy-import-binding` POST | `identity.legacyBinding(body)` | |
| 5 | `folders` GET / POST | `folders.list()` / `folders.create(body)` | 端口 `vault.folders` |
| 6 | `folders/[id]` GET / PATCH / DELETE | `folders.get(id)` / `.update(id, body)` / `.remove(id)` | |
| 7 | `folders/members` GET / POST / DELETE | `folders.members.list(q)` / `.add(body)` / `.remove(body)` | |
| 8 | `model-config` GET / PUT | `modelConfig.get()` / `.put(body)` | `providerConfig` |
| 9 | `model-config/import` POST | `modelConfig.import(body)` | |
| 10 | `provider/probe-models` POST | `providers.probe(body)` | 上游 HTTP |
| 11 | `verify-model` POST | `providers.verifyModel(body)` | |
| 12 | `verify-image-provider` POST | `providers.verifyImage(body)` | |
| 13 | `verify-pdf-provider` POST | `providers.verifyPdf(body)` | |
| 14 | `verify-video-provider` POST | `providers.verifyVideo(body)` | |
| 15 | `azure-voices` GET | `providers.azureVoices()` | 上游 HTTP；无 key→空清单 |
| 16 | `usage` GET | `usage.get(q)` | 读 `data/usage/*.jsonl` → `dataDir/usage/` |
| 17 | `persistence/[...path]` GET / PUT / DELETE | `persistence.get(path)` / `.put(path, body)` / `.remove(path)` | 端口 `vault.kv` |
| 18 | `export-video/capability` GET | `video.capability()` | |
| 19 | `export-video/render` POST | `video.render(body)` | 端口 `export.video` |
| 20 | `export-video/render/[jobId]` GET | `video.job(jobId)` | |
| 21 | `export-video/render/[jobId]/download` GET | `video.download(jobId)` | 二进制 |
| 22 | `quiz-grade` POST | `quiz.grade(body)` | 端口 `agent` 或直接 `llm` |
| 23 | `pbl/v2/evaluate` POST | `pbl.evaluate(body)` | 端口 `pbl.grade` |
| 24 | `pbl/v2/instructor` POST | `pbl.instructor(body)` | |
| 25 | `pbl/v2/open-task` POST | `pbl.openTask(body)` | |
| 26 | `pbl/v2/simulator` POST | `pbl.simulator(body)` | |
| 27 | `pbl/v2/task/update` POST | `pbl.updateTask(body)` | |

---

## 3. 完成后的回报（每批 ≤250 字）

1. 本批 20/17/16/27 条各自的状态：`done` / `degraded`（端口缺失的降级分支）/ `skipped`（附一句原因）
2. `node --test tests/classroom-host-<批次名>.test.mjs` 的真实输出
3. 你在上游源码里发现的、与 `ROUTES.md` 记载不一致的地方（**这条最重要**）
4. 需要编排层补的端口方法（具体到 `ports.xxx.yyy`）
