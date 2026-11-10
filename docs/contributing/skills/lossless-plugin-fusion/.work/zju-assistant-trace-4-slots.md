# 溯源结果 · 代理 4：页面插槽与 UI 链路

**来源**：子代理只读溯源 `.ref` + 本仓 `packages/client` + 已安装 asar 二进制。

---

## 一、六个槽名全部真实存在（连二进制都验过）

| 槽名 | 存在 | kind | 额外字段 |
| --- | --- | --- | --- |
| `main` | ✅ | keyed | 必填 `key` |
| `sidebar.panellist` | ✅ | list | 必填 `id`、`order?`、`label?` |
| `settings.section` | ✅ | list | 必填 `id`、`order?`、`label?` |
| `settings.section.icon` | ✅ | list | 必填 `id`（须等于 section 的 id）、`inline: true` |
| `plugins.row.config` | ✅ | keyed | 必填 `key`，格式 `<包名>#<rowId>` |
| `plugins.bundle.activation` | ✅ | keyed | 必填 `key` = npm 包名 |

**代理读了本机已安装的 `app.asar`**（数据段起点 6478372，从头部 `u3` 算出），抽出编译后字面量：

```
[layout]           "main": { kind: "keyed", scope: "root" }
[sidebar]          "sidebar.panellist": { kind: "list", scope: "root" }
[settings-general] "settings.section.icon": { kind: "list", scope: "root", inline: true }
[plugin-manager]   "plugins.row.config": { kind: "keyed", scope: "root" }
[plugin-manager]   "plugins.bundle.activation": { kind: "keyed", scope: "root" }
```

**六个槽在发布版里全部到位。** 上游 `index.tsx:166` 那句「npm 的 latest 还是 0.2.1（没有 `settings.section.icon`）」在 0.2.2-rc.1 上**已不成立** —— 那段 `markSettingsNav` 的 MutationObserver 兜底（`index.tsx:125-141`）是**死代码**。

---

## 二、**最关键的发现：本仓不用宿主的 `main`**

代理全量 grep `packages/client` 的 `name: 'main'` 与 `'sidebar.panellist'` —— **零命中**。

本仓实际走三层：

```
page-today/src/client.jsx:14-22
  ctx.inject(['zhiyunStudyController'], scope => registerPageContent(scope, {...}))
    ↓
ui-shared/src/page-registration.jsx:67-79
  ctx.slots.inject(shell.config.pageSlot, () => ctx.slots.register({
    name: shell.config.pageSlot,   // 运行时 = 'page.content'
    key: spec.id,
  }, () => <PageFrame .../>))
    ↓
'page.content'（keyed）—— 由 dsh-pages 的 PageShell 在运行时声明
```

**`page.content` 不在宿主 `.ref` 的 109 个标准槽里**。它由 dsh-pages 通过「向 `shell.overlay` 注册时声明的 children」引进来（`packages/vendor/pages/src/page-shell.jsx:387-392`）。

### 两套骨架互斥

| | 宿主原生（上游 7 页用的） | 本仓 dsh-pages |
| --- | --- | --- |
| 内容槽 | `main`（keyed）+ `sidebar.panellist`（list） | `page.content`（keyed）+ `page.rail-action` |
| 几何 | 宿主 grid 的 `.centerCol` | **`position: fixed; inset: 0; z-index: 1000`**（`page-shell.jsx:217-221`） |
| 与对方共存 | **会被浮层盖住** | 会盖住宿主全部界面 |

宿主 `shell.overlay` 的 `.overlayLayer` 是 `z-index: 20`，dsh-pages 自己用 **1000**。

**→ 不能混用。** 把上游页面挂进宿主 `main`，在本仓 profile 里看到的仍然是 dsh-pages 的浮层。

### 附带发现：vendor/pages 与 npm 版不是同一份代码

| | `packages/vendor/pages` | `node_modules/@lybx-leyw/dsh-pages` |
| --- | --- | --- |
| 版本号 | 0.1.3 | 0.1.3（**相同**） |
| `src/page-shell.jsx` | 23983 B | 19274 B |
| 有 `page-scope.js` | 是 | **否** |
| 产物里 `lifecycleOf` | 7 处 | **0 处** |
| 页面内容 owner props | `{ host: props.host }` | `{}` |

`scripts/link-workspace-packages.mjs:48-53` 的 `VENDOR_LINKS` 白名单里**只有 paper-reader**，没有 pages。所以当前 profile 加载的是 npm 那份，**vendor 那份的生命周期钩子是死代码**。

---

## 三、槽不存在时：两条路径行为完全不同

| 路径 | 行为 | 依据 |
| --- | --- | --- |
| 裸 `ctx.slots.register()` 进未声明槽 | **同步抛错**，插件激活失败 | `ui-slots/src/index.ts:1209-1210` |
| `ctx.slots.inject()` 等一个永不出现的槽 | **永久静默**，不报错不超时 | `ui-renderer/src/client/registry.ts:238` |

**上游把所有跨包注册都包进 `inject`，代价就是「槽没了也没人告诉你」。**

### 另一条易踩约束：同 cell 同 priority 第二次注册会抛

`ui-slots/src/index.ts:1142-1144`、`:1220-1244`。要覆盖必须给**不同 `priority`**。

本仓 `pages-default/src/brand.js:38` 用 `SHADOW_PRIORITY = -1` 抢在官方品牌前渲染，就是这个机制。

---

## 四、**第二个关键发现：数据通道在本仓完全不存在**

上游所有页面只通过一个端点取数：

```ts
// plugin/client/api.ts:3-15
const response = await fetch('/api/zju-campus', { method: 'POST', ... body: JSON.stringify({ action, input }) })
```

代理全量 grep `packages/` + `apps/`（排除 vendor/node_modules/lib）的 `api/zju-campus` → **本仓零命中**。

**→ 「直接挂」在这条上是假的：组件能挂上、能渲染，然后所有数据请求都失败。**

两条路：
- (a) 移植上游 `plugin/host/` 的 handler
- (b) **把 7 页的数据依赖改接到本仓已有的 core/source 服务**

本仓页面走的是 `ctx.inject(['zhiyunStudyController'])` + `fetch('/_dsh/zhiyun-planning')`（`page-today/src/client.jsx:14,41`）。选 (b) 与现有架构一致，但工作量是「重写数据层」。

---

## 五、逐页可挂载性

| 上游页面 | 能挂吗 | 槽 | 改造量 | 依据 |
| --- | --- | --- | --- | --- |
| `ProfileSettings.tsx` | ✅ **几乎零改造** | `settings.section` + `.icon` | 极小 | 已是自足组件；本仓已有 2 个先例（page-paper、page-planning）。组件收 `{close}`，上游签名不带 props，**多传被忽略** |
| `SchedulePage.tsx`（40.6 KB） | 🟡 能，但要换挂载点 + 改导航 | `page.content` | 中 | 自足（`campus-page campus-plan`），但 `openRow()`（`campus.ts:59-61` → `pluginNavigation.openBundle`）在 `page.content` 里点不动，要换 `pages.selectPage(id)`；`ctx.get('layout')?.selectPanel(...)`（`campus.ts:128`）也不适用 |
| `AffairsPage.tsx`（22.2 KB） | 🟡 能，但依赖链最深 | `page.content` | 中偏大 | import `useMemos`、`FeedColumn`、`Flow`、`HandIconButton` |
| `LearningPage.tsx` + 两子文件 | 🟡 能，但与 `page-study` 重叠 | `page.content` | 中 + 产品裁决 | 三文件互相 import，**必须一起搬** |
| `Memos.tsx` + `Notes.tsx` | 🔴 **挂不上（作为独立页）** | — | 大 | `useMemos()` 返回 `{list, opened, toast, layer, notices}` —— **五个 ReactNode 片段**，不是页。被 `AffairsPage:271/313/379/383` 等嵌入 |
| `Feed.tsx` + `NoticeContent.tsx` | 🔴 **挂不上（作为独立页）** | — | 大 | `FeedColumn` 是 `{now, memos}` 入参的**列**，被 `AffairsPage:381` 当右栏用 |
| 7 个配置页 | 🟡 能，但要重算 key | `plugins.row.config` | 小—中 | key 格式 `<包名>#<rowId>`，只有「该包 patch 里真有这个名字的行」才派发。**不匹配就静默不渲染，无告警** |

### 挂不上的通则

上游 7 页里真正是「页」的只有 4 个 + 7 个配置页。其余是**页内部组件**：

```
AffairsPage
├─ 左栏: useMemos()  → Memos.tsx → Notes.tsx
└─ 右栏: FeedColumn   → Feed.tsx  → NoticeContent.tsx
```

它们没有「页」的边界，`page.content` 与 `main` 都只接受整页组件。

### 配置页的一处耦合

`ChatSettings.tsx`（28.2 KB）里带 `ChatMessage` 导出（`:66`），被 `NoticeContent.tsx:6` import。**配置页与消息渲染耦合，不能只搬配置页。**

---

## 六、三个必须提前解决的硬约束

1. **数据通道不存在**（见第四节）
2. **前端宿主服务依赖错位**：

| 服务 | 本仓有吗 | 差异 |
| --- | --- | --- |
| `pluginNavigation` | ✅ | `openBundle(name)` 打开**宿主插件页**；本仓的「插件」是 `page-plugins`，不是一回事 |
| `layout` | ✅ | `selectPanel(id)` 选宿主 `main` 面板；本仓页面不在 `main` 里 |
| `uiWorkspace` | ✅ | `startSession(ws, {prompt})` **语义可用，可不动** |

→ `openRow()` / `openAlert()` 要改调 `pages.selectPage()`；`handToAssistant()` 可不动。

3. **样式 87 KB 能搬，但要过门**：
   - 命名空间已物理隔离（上游 448 条选择器里 427 条 `.campus-`；本仓 `.zs-`/`.zy-` 在上游零出现）
   - 但搬进 `packages/client/` 后**立刻进入 `check:css` 范围**（现在因 `vendor` 隔离而豁免，`check-css-order.mjs:320`）
   - 那 10 条 `:root[data-campus-move]::view-transition-*`（`style.css:2431-2464`）是唯一逃出 `.campus-` 作用域的规则，**很可能被判为与其他包的 `:root` 竞争**（`stripScope` 不剥带属性的 `:root`）
   - 新容器包必须在 `tests/css-order.test.mjs:53` 的包名白名单里登记
   - 多个新包还要补 `scripts/build.mjs:46` 的 `CLIENT_PACKAGES`

---

## 七、构建与样式

### 两套构建器机制几乎同构

| | 本仓 `scripts/build.mjs` | 上游 `plugin/build.mjs` |
| --- | --- | --- |
| 打包器 | esbuild | esbuild |
| 包装 | `window.__ModuleLoader__.load({id, factory})` | 同 |
| 入口 | `src/client.jsx` | `client/index.tsx`（TSX） |
| external | `[...HOST_SEEDS, ...manifest.dsh.client.external]` | 硬编码 8 项 `SHARED` |

**机械层面没有障碍** —— 这是上游插件能装进本仓的原因。

### 样式注入能共存

上游 `plugin/client/index.tsx:144-150` 与本仓 `ui-shared/src/primitives.jsx:144-152` 的 `mountStyle` **做的是同一件事**：effect 里 append `<style>`，卸载时 remove。差异只在标记属性名。

### `dsh.client.external` vs `dsh.client.inject`

| | `inject`（上游用） | `external`（本仓用） |
| --- | --- | --- |
| 单位 | **包名**（依赖边） | **模块 specifier**（模块表 key） |
| 作用 | preflight 展示与 HMR diff | 决定 `require` 能否解析 |
| 顺序 | 不决定 apply 顺序 | 让 provider factory 先于 consumer |

**本仓只用了 `external`，没用 `inject`** —— 所以本仓 50+ 个客户端包之间**没有任何显式包依赖边**，顺序全靠 `ctx.inject([...])` 的服务等待。

---

## 八、对清单的影响

| 项 | 更新 |
| --- | --- |
| U-1～U-7 | **全部有了事实依据**：3 页可挂 `page.content`、1 页可挂 `settings.section`、4 块挂不上 |
| 新增 | **骨架冲突**：本仓用 dsh-pages，上游用宿主 `main`。不可混用 |
| 新增 | **数据通道缺失**：`/api/zju-campus` 本仓零命中，必须先定「移植 host」还是「接本仓 core」 |
| 新增 | 配置页 key 必须是 `<本仓包名>#<行 id>`，不匹配**静默不渲染** |
| 更正 | 上游 `markSettingsNav`（`index.tsx:125-141`）在 0.2.2-rc.1 上是**死代码**（`settings.section.icon` 已存在） |
| 更正 | 我此前说「`docs/contributing/AGENTS.md` 提过 CSS 层叠」——**该说法不成立**。实测该文件对 `CSS`/`样式`/`层叠`/`check:css` 零命中。规则真正的家是 `scripts/check-css-order.mjs` 文件头、`tests/css-order.test.mjs` 文件头、`packages/client/ui-shared/README.md:27-33`。代理建议顺手补进 AGENTS.md |
