# dsh-zhiyun-page-paper

「论文阅读」页：左侧本地 PDF 阅读器（可选取文本），右侧 AI 助手抽屉，选中英文悬停触发翻译，整篇翻译与重排端点集中在设置里。

**改这一页的东西都在这里**。

## 界面

- 顶栏：文献库下拉（切文献 / 上传 PDF / 新建专题）、页数与转录状态、转录、「AI 助手」、「问一问」。
- 阅读区：同源 `<iframe>` 承载上游 `/paper-reader/` 页面。**不 fork 上游 HTML** —— 锁版的意义就在于不改上游源码；改为在 iframe 载入后注入一张样式表（`frame-theme.js`）把 `--zy-*` 映射进去，并藏掉已经搬到本壳的上游控件（`#cfg-pop` 端点弹窗、`#ask-pop` 选中即问浮层、`#pdf-path`、`#ver`）。
- 右侧抽屉：`AssistantDrawer.jsx`，订阅上游 SSE `/paper-reader/api/session/follow` 显示流式回答，带「第 N 页」可点跳转。
- 悬停翻译：`ReaderFrame.jsx` 在 iframe 内挂 `mouseup`/`mousemove`，判定（`selection-text.js`，纯函数可测）通过后停顿 260ms 触发，结果渲染在父页面的浮层里。

## 为什么阅读器是 iframe 而不是 react-pdf

客户端 bundle 有「不许内联本包 `src/` 之外的文件」的构建守卫（`tests/build-seeds.test.mjs`），pdf.js 那 1.8MB 进不来。iframe 是绕过它的正当做法，也让「上游原样跑」这条架构判断成立。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/client.jsx` | 客户端入口：挂样式、注册 `zhiyun.paper.content` 与 `settings.section` |
| `src/Paper.jsx` | 页面组装：文献库、顶栏、阅读区、抽屉 |
| `src/ReaderFrame.jsx` | iframe 载入、主题注入、选区监听、译文浮层 |
| `src/AssistantDrawer.jsx` | AI 助手抽屉、气泡、页码跳转 |
| `src/LibraryPanel.jsx` | 文献库下拉与上传 |
| `src/SettingsSection.jsx` | 设置分组：整篇翻译端点 + 检索重排端点 |
| `src/library.js` | 页面到后端的唯一出口（上游 24 条路由 + 本包自有两条） |
| `src/transcript.js` | SSE 帧 → 气泡（不认识别的东西） |
| `src/session-feed.js` | 把 SSE 变成可订阅 store（注入 EventSource 以便测试） |
| `src/selection-text.js` | 悬停判定的纯逻辑：该不该翻、光标是否压住选区、停顿多久 |
| `src/frame-theme.js` | 注入 iframe 的主题 CSS（纯函数） |

## 边界

- `inject: ['slots']`；内容插槽 `zhiyun.paper.content` 由外壳 `main` 插槽声明并认领 children，本页只注册内容。
- 设置入口只注册 `settings.section`（`id: 'paper-reader'`, `order: 60`）—— 外壳的 `PersonalSettingsBridge` 会按 order 摊成折叠分组，**零改壳**。
- 不碰 `sidebar.workspaces`、不碰 `shell.overlay`：那是上游客户端与本仓外壳的地盘。
- 铺满页面的 CSS 用 `body[data-zhiyun] .zy-content:has(> .zp-page)` 而不是 `.zy-page[data-page=paper] .zy-content` —— 后者与 `dsh-zhiyun-page-study` 的同名覆盖同特异性同主体，胜负只剩挂载顺序，正是 `check-css-order` 判隐患的形状。
