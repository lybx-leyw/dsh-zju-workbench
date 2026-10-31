# 课堂子系统移植规范（OpenMAIC → dsh 插件包）

本文件是这次移植的**唯一事实来源**。所有 builder 动手前读它，所有 reviewer 按它验收。
任何与本文件冲突的实现都算错，改实现或先改本文件。

## 1. 目标与判据

**目标**：把 `ref/OpenMAIC`（v1.3.0，759,784 行 TS/TSX）整体移植成本仓的插件包群，
运行在 `zhiyun-bench` profile 里，功能与观感与原版一致。

**不是**：不是包一层 iframe、不是起一个 sidecar 进程、不是只挑子系统做样板。

**判据**（三条全过才算一格完成）：

1. **能力等价**：同一份 brief，原版与本仓产出的场景序列（slides / quiz / interactive / pbl）类型与数量一致；
2. **观感等价**：同一场景在两边渲染出的 DOM 文本一致，关键元素（白板、公式、图表）截图 diff 在容差内；
3. **边界合法**：包不 import 另一个包的 `src/`，只走 `ctx.*` 服务或 `exports` 子路径；不新增宿主种子。

## 2. 五条通道（什么必须改、什么不许动）

| # | 通道 | 规则 |
|---|---|---|
| 1 | 语言 | **不手改 TS→JS**。`scripts/build.mjs` 的 esbuild 直接吃 `.ts/.tsx`。新增 `src/*.tsx` 即可，禁止为了"统一风格"把 760k 行翻成 JS。 |
| 2 | 服务端 | `app/api/*/route.ts` 的 handler body 原样搬进 `ctx.provide('zhiyunClassroomStudio*', …)` 的方法。禁止保留 `NextRequest/NextResponse`，改签名，不改逻辑。 |
| 3 | 存储 | `lib/persistence` `lib/store` 的 SQL 语义保留，driver 换成 `ctx.vault`（本仓既有）。适配层单独一个文件 `adapter.js`，不许在业务里散写 IO。 |
| 4 | UI | `app/(routes)` + `components/` 切成 `page-*` 包，按 slots 注册。只换壳（路由→插槽、全局布局→外壳），**不重写渲染树**。 |
| 5 | 第三方 | `langgraph` `@copilotkit/*` `echarts` `shiki` `motion` `tailwindcss@4` `@ai-sdk/*` **原样保留为依赖**。禁止"顺手换成我们自己的实现"。 |

## 3. 包谱

| 源 | 目标包 | 归属 |
|---|---|---|
| `packages/@openmaic/{dsl,geometry}` | `dsh-zhiyun-classroom-dsl` | vendor（不 fork 逻辑，只打包） |
| `packages/@openmaic/renderer` | `dsh-zhiyun-classroom-renderer` | vendor + 客户端产物 |
| `packages/@openmaic/{generation,importer,editor,storage}` | 各自同名 `dsh-zhiyun-classroom-*` | 移植 |
| `lib/server/` 50.7k | `dsh-zhiyun-host-classroom` | 宿主侧 |
| `lib/workbench/` `lib/chat/` `lib/orchestration/` `lib/agent*/` | `dsh-zhiyun-core-classroom-agent` | 领域 |
| `lib/audio/` `lib/media/` `lib/web-*` | `dsh-zhiyun-core-classroom-media` | 领域 |
| `lib/pbl/` `lib/quiz/` | `dsh-zhiyun-core-classroom-pbl` / 并入 `core-quiz` | 领域 |
| `lib/export/` `lib/video-export*/` | `dsh-zhiyun-core-classroom-export` | 领域 |
| `lib/persistence/` `lib/store/` `lib/document*/` | `dsh-zhiyun-core-classroom-vault` | 领域 |
| `lib/whiteboard/` `lib/choreography/` `lib/action/` | `dsh-zhiyun-core-classroom-stage` | 领域 |
| `app/(pages)` + `components/` 89k | `page-classroom` / `-build` / `-play` / `-editor` | 页面 |

## 4. 接口契约

宿主包只暴露服务，不暴露实现：

```
ctx.zhiyunClassroomStudio.status()                  // { state, version, detail }
ctx.zhiyunClassroomStudio.generate(brief, opts)     // 流式，返回 runId + AsyncIterable<event>
ctx.zhiyunClassroomStudio.materials.create({ buffer, filename, mimeType })  // → { materialId }
ctx.zhiyunClassroomStudio.runs.get(runId)
ctx.zhiyunClassroomStudio.runs.cancel(runId)
ctx.zhiyunClassroomStudio.classroom.load(id)        // { scenes, meta, assets }
ctx.zhiyunClassroomStudio.classroom.save(id, doc)
ctx.zhiyunClassroomStudio.export.pptx(id) / .html(id)
ctx.zhiyunClassroomStudio.providers.list() / .set(key, cfg)
```

讲义走 `generate({ requirement, materialIds })`：**只传 id，不传正文**（上游明确拒绝
`pdfContent`），字节由第 0 段按 id 从 `vault.assets` 取（见 §8.5）。

约束：

- `apply()` **永不因上游缺失而抛错**（照 `host-deeptutor` 的约定），缺失表现为 `status().state`；
- 页面包 `inject: ['slots']` + 惰性 `ctx.inject(['zhiyunClassroomStudio'], …)`，领域包停用时不注册、外壳显示占位；
- 事件流用 AsyncIterable，不用回调注册表（避免卸载泄漏）。

## 5. 样式与依赖

- 每个包一个 `src/style.css`，选择器一律 `.zyc-` 前缀；外壳的 `.zy-` 不动。
- Tailwind 4 只允许在 `classroom-renderer` 内引入，且必须 `@scope` 到 `.zyc-root`，防止 reset 污染工作台。
- 新增客户端包必须同时：① 在 `scripts/build.mjs` 的 `CLIENT_PACKAGES` 登记；② `package.json` 的 `dsh.client` 声明 `platform/external`；③ 不进 `HOST_SEEDS`。

## 6. 并行切分（互不阻塞）

- **L0 内核**：dsl / geometry / renderer（无业务依赖，最先）
- **L1 宿主**：host-classroom + 21 个 route 搬运
- **L2 领域**：agent / media / pbl / export / vault / stage（只依赖 L0+L1 契约）
- **L3 页面**：4 个 page 包（只依赖 L2 契约）
- **L4 闸门**：parity 工具 + golden 语料（独立，先于 L3 完成）

同一层内可并行；跨层只按契约，不按文件。

## 7. 风险登记

| 风险 | 影响 | 处置 |
|---|---|---|
| Tailwind 4 与工作台样式冲突 | 工作台视觉被 reset | `@scope` + 快照对比 |
| `@openmaic/renderer` 的 `motion@11` 与 React 18 并存 | 运行时警告/动画失效 | 先跑单页 smoke，失败则锁 `motion@11.x` 并关 layout 动画 |
| `@napi-rs/canvas` 原生依赖 | 桌面端分发缺二进制 | 导出链路降级为服务端渲染，客户端不引 |
| LangGraph 状态机与 Cordis 生命周期错配 | 取消/重启泄漏 | run 级 disposer，取消时 `AbortSignal` 贯穿 |
| 760k 行搬运产生"看起来像"的漂移 | 判据 1/2 失败 | 每个包必须带上游 fixture 的对照测试，无对照不算完 |

## 8. 落地状态（2026-10-31 收口）

口径：**profile 登记** = `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles` 里有一行；
**构建登记** = `scripts/build.mjs` 的 `CLIENT_PACKAGES` 里有一行（有 `src/client.jsx` 的包才需要）；
**导航入口** = 外壳 `NAV`/`RAIL_DEFAULT` 里有可点到的入口。

### 8.1 包

| 包 | 体量 | profile | 构建 | 导航 | 说明 |
|---|---|---|---|---|---|
| `dsh-zhiyun-classroom-dsl` | 84 文件 / 772K | 否 | 否 | 否 | vendor `@openmaic/dsl@0.12.0`；构建期内核，被 renderer 内联，不是插件 |
| `dsh-zhiyun-classroom-geometry` | 13 文件 / 220K | 否 | 否 | 否 | 同上（`@openmaic/geometry@0.1.0`），被 stage/renderer 内联 |
| `dsh-zhiyun-classroom-renderer` | 252 文件 / 17M | **是** | **是** | 否（被播放页消费） | vendor `@openmaic/renderer@0.2.0`；`lib/client.js` 14MB，只外置 react 三件套 |
| `dsh-zhiyun-host-classroom` | 23 文件 | **是** | 否 | 否 | 82 条 route 的宿主侧全部落地点 |
| `dsh-zhiyun-core-classroom-vault` | 8 文件 | **是** | 否 | 否 | 文件树存储，`classroom/ scenes/ runs/ assets/ materials/` 六张逻辑表 |
| `dsh-zhiyun-core-classroom-media` | 17 文件 | **是** | 否 | 否 | TTS/ASR/生图/检索/PDF，全 provider 分支保留 |
| `dsh-zhiyun-core-classroom-pbl` | 13 文件 | **是** | 否 | 否 | PBL v2 planner + rubric + grade |
| `dsh-zhiyun-core-classroom-agent` | 20 文件 | **是** | **是** | 否 | Director 编排 / 角色调度 / 动作归一化 |
| `dsh-zhiyun-core-classroom-generate` | 14 文件 | **是** | 否 | 否 | 四段管线（outline→scenes→media→finalize），逐段 checkpoint、可 resume |
| `dsh-zhiyun-core-classroom-export` | 37 文件 | **是** | 否 | 否 | PPTX / HTML / ZIP / video；HTML 可直接进 `<iframe srcdoc>` |
| `dsh-zhiyun-core-classroom-stage` | 19 文件 | **是** | **是** | 间接 | 动作账本 + 客户端 `<ClassroomStage>` |
| `dsh-zhiyun-page-classroom-build` | 8 文件 | **是** | **是** | **是** | 「课堂 → 生成」二级入口（`NAV.classroom-build`） |
| `dsh-zhiyun-page-classroom-play` | 7 文件 | **是** | **是** | **是** | 导轨「课堂」（`NAV.classroom`） |

`dsl` / `geometry` 从 profile 摘除是有意的：它们没有 `cordis.patch.yml`，进 bundles 只会让
Loader 建一条「装载了但什么都不做」的条目；消费它们的包（renderer / stage）在构建期就内联了。

### 8.2 82 条 route

分批表见 `docs/architecture/route-batches.md`，逐条记录见 `packages/dsh-zhiyun-host-classroom/ROUTES.md` §5–§8。

| 批 | 域 | 条数 | done | degraded（端口缺失的降级分支） | skipped（上游无此动词） |
|---|---|---|---|---|---|
| 1 | 生成 / 运行 / 舞台 | 20 | 15 | 5 | 0 |
| 2 | 素材 / 媒体 / 解析 | 17 | 15 | 2 | 0 |
| 3 | 智能体 / 会话 / 技能 / 对话 | 16 | 11 | 5 | 0 |
| 4 | 身份 / 配置 / 校验 / 导出 / PBL | 27 | 10 | 15 | 2 |
| | **合计** | **80** | **51** | **27** | **2** |
| — | 已在 L1 首轮搬完（`health` / `server-providers`） | 2 | 2 | 0 | 0 |

「degraded」不等于没搬：业务判断全部照抄，只是它依赖的端口（`ports.pbl.*`、`ports.modelConfig.*`）
还没在 L2 侧提供，于是走上游「该能力未配置」的那条分支。

### 8.3 实测

| 项 | 数字 |
|---|---|
| 全仓测试 | 2684 例 / 2575 通过 / 67 失败 / 39 跳过（失败全是既有基线：parser 拼图、流式、quiz，与课堂无关） |
| 课堂专项测试 | 17 个文件、376 例（374 通过 / 2 跳过 / 0 失败） |
| 客户端构建 | 20 个包全绿，renderer 产物 14MB |
| 端到端 | brief → 27 条事件 → 4 场景 → HTML 34,342B → PPTX 66,637B |
| 渲染一致性（与上游 renderer 双渲染） | **identical**：2 张 slide、11 个文本节点、双方 markup 各 11,511B 且逐字节相同 |
| HTML 导出覆盖率 | **identical**：37,937B、5 场景、37/37 行文本全中 |
| PPTX 结构 | **identical**：5 页 = 5 场景、28 个 `<a:t>`、19/19 行、OMML 1 |

一致性工具的判定规则见 `docs/architecture/render-parity.md`；共记录 10 条「合法差异」
（class 名、空白、`data-*`、零宽字符、图表栅格化、quiz 选项不进 deck 等），逐条写了理由。

### 8.4 收口时修掉的四个真缺陷

这四条都是「单包测试全绿、接起来是错的」，属于本次移植最有价值的产出：

1. **页面事件契约对不上**：生成管线发 `{ kind: 'run-done', payload }`，页面读 `event.type` 与
   `event.data` → 页面永远停在 `idle`。修法：事件双写 `type`（snake_case 镜像）+
   页面同时认 `kind`/`type`、`payload`/`data`，并把 kebab 归一成 snake。
   回归用例 `tests/classroom-contract.test.mjs`。
2. **run 记录从不落盘**：管线只写 `runs.putStep`，不写 `generation_runs` 行与事件表 →
   生成成功那一刻 `GET /api/generation-runs/[id]` 仍是 404，刷新页面看不到自己刚起的 run。
   修法：`persistRun()` 在开跑与收尾各写一次行 + 全量事件。
3. **`classroom.load` 返回 HTTP 信封**：`stages.get` 返回 `{ httpStatus, body }`，而 §4 的
   `classroom.load(id)` 要给课堂文档本身 → `export.html(id)` 对存在的课堂报 `E_NOT_FOUND`。
   修法：兼容层剥信封，4xx 转 `E_NOT_FOUND`。
4. **`export.pptx/html` 是死路径**：宿主里恒抛 `E_NOT_IMPLEMENTED`，真实现只在
   `ctx.zhiyunClassroomExport`。修法：转发到 `ports.export`，入参 id 与文档对象都接受。

### 8.5 讲义链路（2026-10-31 追加）

「传入讲义 → AI 照着讲」原来只有接口、没有链路：`brief.materialIds` 一路存到了 run 里，
但**没有任何一段读它**，模型看到的大纲 prompt 里没有讲义正文。补齐后分四层：

| 层 | 位置 | 行为 |
|---|---|---|
| 页面上传 | `page-classroom-build/src/client.jsx` 的 `attach()` | 选文件即 `studio.materials.create({buffer,…})`，拿 `materialId`；`uploading/ready/failed` 三态，未就绪不放行「下一步」 |
| 素材落盘 | `host-classroom/src/services/media.js` | 字节 → `vault.assets`（键 `material-<id>`，`meta.name` 存原始文件名）；元数据 → `vault.kv` |
| 第 0 段 | `core-classroom-generate/src/phases/material-analysis.js` | 按 `materialIds` 取字节 → `media.parsePdf`（unpdf，本地无网络）→ 拼成 `### 讲义 N：<文件名>` 段落 |
| 进 prompt | `core-classroom-generate/src/prompts.js` | 大纲 prompt 多一节 `## 讲义（用户上传，按它备课）`；无讲义时该节整段不出现（字节不变） |

**与上游的唯一差异**：上游是**上传即抽取**（`POST /api/materials` 后台 worker，run 只等
`extraction.status=ready`）；本仓没有常驻 worker，改成**生成时抽取**。可见后果只有一条：
第一次生成多花几百毫秒，而不是上传时预支。

**事件**：`material-analysis` 段 `phase-start`（`index:-1`、`optional:true`）→
`phase-progress{step:'material',status:'reading'|'ok'|'failed'}` → `phase-done{materials,chars,truncated}`，
整段排在 `outline` 之前。它**不进 `PHASES`**（上游 `plan.ts:44-55` 也是可选段），
所以没有讲义时事件序列与四段时代逐事件一致。

**失败口径**：部分讲义读不出来 → 用能读的继续并逐份报失败；一份都读不出来 →
`E_MATERIAL_UNAVAILABLE`（同上游 `ClassroomMaterialsUnavailableError`：不静默让模型凭空讲）。

**依赖**：`unpdf`（纯 JS，无原生依赖）已装进
`packages/dsh-zhiyun-core-classroom-media/node_modules/`。它**不进**根 `package.json`
——根安装会被 3 个私有 radar 包 404 挡住（见 §8.4 第 2 条同源问题）。换机器时把
`npm pack unpdf` 的产物解到上述目录即可；缺它时 `parsePdf` 返回 `E_DEPENDENCY_MISSING`
（`tests/classroom-media.test.mjs` 用隔离目录守着这条语义）。

**判据**：`tests/classroom-e2e.test.mjs` 第 7 段 —— 上传真 PDF → 生成 → 断言
（a）事件序列含 `material-analysis` 且排在 `outline` 前；（b）模型收到的 outline prompt
里**有讲义正文原句**。只测「上传返回 201」是测不出断链的。

### 8.6 已知未完成 / 风险

| # | 事 | 影响 | 建议 |
|---|---|---|---|
| R-1 | `sanitize.escapeText` 对 `&` 二次转义（`&amp;` → `&amp;amp;`） | 播放器会把 `&amp;` 显示成字面量 | 上游同位置也有此行为；修它会让 parity 差异多一条，建议与上游一起改 |
| R-2 | 取 `ctx.zhiyunClassroomStudio` 的时机有四种写法（apply 抓一次 / 惰性） | 真 Cordis 靠 `inject` 推迟掩盖；容器不推迟就静默降级 | 统一成惰性 getter（`media`/`export` 已是） |
| R-3 | 「模型未配」有两套答案：宿主 `status().detail.providerConfig` vs run-error `E_NO_LLM_PROVIDER` | 用户看到两个入口说不同的话 | 页面统一读 `providers.list()`，把 run-error 当兜底 |
| R-4 | `proxy-media` 的 SSRF 只做了协议 + 字面内网地址两层 | DNS 重绑定可绕过 | 需要 undici 的 `lookup` 钉定，属新增依赖，未做 |
| R-5 | `scripts/test-host.mjs` 在本机跑不到 | 没有 DSH 宿主（`.runtime/` 只有夹具），`initialize()` 就退出 | 端到端闸门改用静态校验 + `tests/classroom-e2e.test.mjs` 的进程内装配 |
| R-6 | `core-classroom-agent` 的 `lib/client.js` 已产出但无页面消费 | 客户端多 32K 无用产物 | 等「课堂编辑页」落地后由它消费 |
| R-7 | 扫描版 PDF 没有 OCR（unpdf 只抽文本层） | 图片型讲义以 `E_MATERIAL_UNAVAILABLE` 失败 | 配 MinerU（`providers.set('mineru', …)`）后自动改走 OCR |

### 8.7 复现命令

```bash
node scripts/build.mjs                                   # 20 个客户端包
node --test tests/classroom*.test.mjs                    # 403 例
node --test tests/classroom-material.test.mjs            # 讲义：抽取 / 失败 / prompt 注入
node --test tests/classroom-e2e.test.mjs                 # 上传讲义 → prompt 里真的有正文
node scripts/classroom-golden-parity.mjs --a <dirA> --b <dirB>   # 产物目录自比 / 互比
node scripts/classroom-render-parity.mjs                 # 与上游 renderer 双渲染
```