# PATCHES — 我们对 dsh-paper-reader 做了什么

> **这是代价清单。** 记录我们偏离上游多少 —— 偏离越多，将来同步上游越贵。
> 每次改动都要在这里加一条，包括「顺手改的」。

## 上游基线

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/GGboya/dsh-paper-reader |
| 提交 | `87ee32184a9ffb214f635e6838f05e05f347eb8d` |
| 标签 | **v1.8.2**（2026-11-06） |
| 许可证 | MIT（见 `LICENSE`） |
| 引入方式 | `git clone` 后删除 `.git`，作为普通文件纳入本仓版本控制 |

## 这个包的形态（重要）

是个**混合形态**的包，两半的来源不同：

| 半边 | 入口 | 来源 | 本仓是否入库 |
| --- | --- | --- | --- |
| 宿主 | `dist/index.js` | `src/**/*.ts`（26 个）经 `tsc` 编译 | ✅ **已构建并入库** |
| 客户端 | `lib/client.js` | **手写并直接提交**（上游就是这样） | ✅ 上游自带 |

`package.json` 的 `type: module`，`exports` 三个入口：`.` → `dist/index.js`、`./client` → `lib/client.js`、`./package.json`。

## 本仓对上游的改动

### 1. 删掉 `.git`（13 MB）

保留它的唯一好处是能直接 `git fetch` 看上游新提交；代价是本仓体积变大，
且 `.git` 套 `.git` 容易让人误以为这是 submodule 而用错命令。

**同步上游的方式**：按上面钉住的 commit 拉一份新的，与本目录做 diff，人工判断改动。

### 2. 不用 submodule

submodule 意味着**不改上游**。但本仓引入它的目的恰恰是**自己维护、自己锁版本**
—— 一旦我们改了代码，submodule 就表达不了「这是我们的分支」。

### 3. `.gitignore` 的两处反转（与上游相反）

上游的 `.gitignore` 排除 `dist/`，我们**反转成入库**：

> 上游的 dist 由使用者从 npm 拿到；我们是 vendor —— clone 本仓就必须能直接跑，
> 不能要求谁先 `npm i && tsc`。缺 dist 的表现是「profile 启动报模块找不到」，
> 而报错完全指不出「你需要先构建」。

同时**新增排除**上游 README 的演示媒体（`docs/demo.gif` 6.5 MB、
`docs/demo.mp4` 2.4 MB、两个 gif），共约 10 MB。它们只服务「怎么用」的展示，
与本仓改代码的目的无关。入库体积因此从 16 MB 降到 6.1 MB。

### 4. 删除上游的 CI 与 lockfile

`.github/`（上游的三平台 CI 与本仓无关）、`pnpm-lock.yaml`（我们用 npm）。

## 待办：客户端半边要重构（不是搬运）

**这是本仓引入这个 vendor 的真正目的**，尚未开始。

原版的设计是「把 dsh 变成论文工作台」——它**接管**宿主插槽：

| 插槽 | 原版用法 | 与 `dsh-pages` 的冲突 |
| --- | --- | --- |
| `sidebar.workspaces`（priority -1000） | **接管**整个侧栏工作区列表 | dsh-pages 的导轨要这块 |
| `sidebar.right.pane.tab` | 右侧面板加 PDF 页签 | 可保留 |
| `settings.section` | 自建设置分区 | 应改用 `ui-shared` 的 settings-kit |
| `shell.overlay` | 自己的浮层 | dsh-pages 也有 overlay |
| `sidebar.footer.action` | 侧栏底部开关 | 可保留 |

我们要的是相反的形态 —— **它是 `dsh-pages` 里的一页，不是整个工作台**：

```
原版                          重构后
──────────────────────────────────────────────────
整个工作台                    dsh-pages 的「论文」一页
├─ 接管 sidebar.workspaces    ├─ page.content key='paper'（用 PageFrame fullBleed）
├─ 视觉换位 CSS grid          ├─ 页面内三栏 grid（左树 / 中 PDF / 右对话）
├─ 自建 UI 原语               ├─ ui-shared 的 primitives
└─ 自己的 i18n                └─ ui-shared 的 settings-kit + registerText
```

`PageFrame` 支持 `fullBleed`（整幅铺开、页面自己管滚动），所以三栏布局**不受限**：
外壳不施加版式，页面内部布局仍由自己决定。

### 上游已吸收的功能（不必再迁）

`host-paper`（写于上游 1.3.1 时代）补的两项，v1.8.2 已经有了，且实现更强：

| host-paper 的路由 | 上游 v1.8.2 |
| --- | --- |
| `/api/translate` | ✅ 已有 |
| `/api/sessions/archive` | ✅ 已有 |
| 选中翻译 | ✅ **已有且更完整**（保留公式、逐公式保全校验；host-paper 版没有） |

上游现有 **36 条路由**，覆盖文献库管理、MinerU、嵌入检索、划词翻译、
babeldoc 整篇翻译、主题配置、笔记。

### 4. 伴读会话固定跑 `paper-reader` preset（对上游的有意偏离）

**上游行为**：`createPaperSession` 调 `sessionController.create({ sessionId, workspaceId })`
**不传 `agentPreset`** —— 会话跑宿主的默认 preset（standard）。

它的注释解释了为什么：

> 论文伴读 preset 只注册到 dsh；论文入口不默认套用，避免替用户改变 agent。

那是**通用插件**的克制：装到别人的 profile 上，不该擅自换掉用户选的 agent。

**我们为什么改**：这个页面由本仓自己维护，论文页就该是论文伴读。混装 standard
preset 的后果是：

| 维度 | 应该（paper-reader preset） | 实际（standard preset） |
| --- | --- | --- |
| 人格 | 教练式 examiner，先出题再等回答 | 编码 agent |
| 工具面 | 5 个论文工具 | 混入 bash / fs / todo / web |
| 上下文管理 | 带 compaction 裁剪 | 走默认 |

**改法**：`createPaperSession` 显式传 `agentPreset: "paper-reader"`，覆盖所有
论文会话的创建路径（`/api/ask`、`/api/session/follow`、`/api/sessions/new` 都走它）。

**验证**（真机 A/B 对照）：

| 情况 | 结果 | 说明 |
| --- | --- | --- |
| 传不存在的 preset 名 + `fresh: true` | **500** | 宿主确实在校验 preset |
| 传 `paper-reader` + `fresh: true` | **200**（`n: 2`） | preset 存在且被采用 |
| 传 preset + 复用已有会话 | 200 | 复用分支不重新解析 preset |

> 第三条容易被误读成「preset 没生效」—— 实测复用的会话不会改 preset。
> 要验证必须用 `fresh: true` 建新会话。

### 5. 移除浏览器半边（`dsh.client`）—— 本包只做 host

**这是本仓对上游最重要的一个偏离，也是改动最小的一个：`lib/client.js` 一个字节没动。**

#### 上游的形态

上游把「论文工作台」做成整站接管：

| 机制 | 它做了什么 |
| --- | --- |
| `sidebar.workspaces` single slot（priority -1000） | 把整个工作台侧栏换成文献库树 |
| `sidebar.footer.action` | 加一个「论文伴读」模式开关 |
| `shell.overlay` | 阅读器 iframe + 对话头部按钮组挂在整页浮层 |
| 会话切换护栏 | 给 `[data-rightbar-col]` 写 `data-rightbar-instant`、猴补丁 `layoutService.closeRightbar` |
| 布局换位 `applySwap` | 每 200ms 改宿主 grid 与面板样式 |
| 头部按钮定位 | 给官方 header 加 `marginLeft: 80px` |

那套设计的前提是「装了这个插件，dsh 就变成论文工作台」。

#### 为什么本仓不适用

本仓是 **dsh-pages 多页工作台**：导轨上有 11 个页面，论文只是其中一个。
上游那套 UI 与页面架构**直接冲突**：

- 它会接管侧栏 —— 而侧栏属于页面壳；
- 它会挂整页浮层 —— 切到别的页面还看得见；
- 它每 200ms 改宿主 grid —— home 也跟着变。

实测证据（真机）：移除前 home 页有 `[data-dpr-mode]` 1 个、
`[data-dsh-plugin="dsh-paper-reader"]` 1 个 —— 论文的 UI 漏到了 home 上。

#### 改法

从 `package.json` 删掉 `dsh.client` 整块：

```diff
-  "client": {
-    "inject": ["@deepseek-ai/dsh-client-runtime", ...],
-    "platform": "web",
-    "external": ["@lybx-leyw/dsh-zju-ui-shared"]
-  }
```

宿主只加载声明了 `dsh.client` 的客户端 bundle，删掉之后**浏览器半边不再加载**。

`lib/client.js` 文件本身保留在磁盘上（属于上游快照），只是不再被加载。

#### 现在谁提供 UI

**`packages/client/page-paper/`** —— 它是本页唯一的 UI 实现：

| 职责 | 文件 |
| --- | --- |
| 整页三栏 | `Paper.jsx`（686 行） |
| 阅读器 iframe + 悬停翻译 | `ReaderFrame.jsx` |
| 文献库树 | `PaperTree.jsx` |
| AI 助手抽屉 | `AssistantDrawer.jsx` |
| 设置分区 | `SettingsSection.jsx` |
| 会话 SSE 订阅 | `session-feed.js` + `transcript.js` |
| 样式（33 KB，全 `zp-` 前缀） | `style.css` |

两边通过 **HTTP 路由**耦合，不在客户端互相 import：

```
GET  /paper-reader/                     ← ReaderFrame 的 iframe 源
GET  /paper-reader/api/library          ← 文献库
POST /paper-reader/api/ask              ← 提问
GET  /paper-reader/api/session/follow   ← 会话 SSE
```

#### 验证

移除后真机检查 home 页：

```
dprMode: 0        ✓
dprRail: 0        ✓
dprOverlay: 0     ✓
headerMarginLeft: (空)  ✓
```

论文页三栏：

```
树 280 + 主区 717 + 抽屉 392 = 1389   ✓
drawerCls: "zp-drawer is-open"        ✓
```

#### 将来同步上游时要注意

上游如果给 `lib/client.js` 加了新功能（新的文献库交互、新的阅读器控件），
**那些不会自动出现在本仓** —— 因为客户端半边不再加载。
要跟进的话，得在 `page-paper` 里实现同等能力，而不是恢复 `dsh.client`。

### 清单

- [x] vendor 纳入本仓（`.gitignore` 反转、删 `.git`、排除演示媒体）
- [x] 构建 `dist/` 并入库
- [x] 智云 5 个能力迁入（`paper-tree` / `paper-errors` / `paper-session` /
      `paper-selection` / `paper-routes`），严格 TS
- [x] 归档 `dsh-zhiyun-host-paper`
- [x] 移除 `dsh.client`：本包只做 host，UI 全部归 `page-paper`
- [x] 伴读会话固定 `paper-reader` preset
- [x] `lib/client.js` 保持上游原文（哈希与 npm 1.8.2 一致）