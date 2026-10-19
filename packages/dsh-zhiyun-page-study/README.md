# dsh-zhiyun-page-study

「学习」页：**课程目录 + 课堂回放 + 整理**，一页。

这是拆分后最大的页面包，也是唯一一页承载「回到课堂」这件事的包。三块内容各占一栏：

| 区域 | 是什么 | 文件 |
| --- | --- | --- |
| 左栏（课程目录） | 课程 → 节次，就地展开；已整理 / 解析中的状态点 | `study-workspace.jsx` 的 `CourseTree` |
| 正文区「视频」栏 | 视频主视图 + 课件小窗 + 字幕，两者可互换。终稿出来后，栏顶是四个汇总，视频下有内容分段和语速条 | `video-panel.jsx` / `seek-bar.js` / `video.css` |
| 正文区其余栏 | 终稿 / 讲义 / PPT / 字幕 / 出题 / 笔记 + 分层检索 | `study-workspace.jsx`、`lecture-reader.jsx`、`quiz-panel.jsx`、`note-panel.jsx`、`note-links.js`、`layered-search.js`、`layers.js`、`format.js` |

出题和笔记的读写在 `dsh-zhiyun-study-core`。这一页只渲染：从已选片段出填空或简答，
待审题要用户采纳才进复习队列；笔记里的页码链切到课件，时间链切到字幕。另一节的链接
留在原地并说明跳不过去。目录上方另有一个入口，在当前账号已整理的终稿里做字面查找；
点中一节后打开它，并把同一个词放进这一节自己的检索框。从今天页点一条已采纳的题进来时，
这一节直接停在出题。

## 为什么是一页

这里曾经是**三个页面包**：「我的课」（`dsh-zhiyun-page-courses`，只列课程与节次）、
「看课」（`dsh-zhiyun-page-player`，回放的视频/课件/字幕）、「学习」（本包）。
三者读的是**同一份** `state.content`，用户走的也是同一段动线（选课 → 看回放 →
整理 → 回看），拆成三页的代价是每一步都要离开当前上下文：看课时读不到讲义，
读讲义时又回不到那一段，还得记着自己是从哪进来的。

现在播放是正文区的一栏（`zs-content-switch` 的「视频」），课程目录是左栏。
**导航因此少两项，功能一个没少**；那两个包已删除。

## 播放那几条不能破的约定

1. **`<video>` 常驻**：主视图与小窗互换只改 `data-main`（纯 CSS 换网格区域），
   绝不条件渲染 —— 摘掉节点等于 `dispose()`，声音当场断、`currentTime` 也丢。
   `video.css` 里两个舞台都无条件写在树里，正是为此。
2. **时间轴是唯一真源**：当前时刻由 `<video>` 的 `timeupdate` 驱动，课件页与字幕行
   都是它的投影。反过来（课件驱动视频）会与用户拖进度条打架。
3. **点字幕才跳**：不自动滚动。用户可能正在读某一行，自动滚走是打断。

视频地址经 `safeMedia` 过滤（只放行 http/https）—— 它来自课堂接口，属于外部数据。

## 边界

- **领域状态不在这里**：账号、课程树取数、解析任务、持久化都在 `dsh-zhiyun-study-core`
  提供的 `zhiyunStudyController` 里，本包用 `ctx.inject(['zhiyunStudyController'], …)` 惰性取。
  停用领域包时这一页空着，不会把整个前端拖成 pending。
- **检索与格式化留在本包**：`searchLesson` / `hitBlockIndexes` / `layerSpecOf` /
  `time` / `lessonWhen` 只有这一页用，属于「这一页怎么呈现」，不属于领域。
  `tests/study.test.mjs` 直接从本包 import 它们（`src/layered-search.js`）。
- `lecture-reader.jsx` 用宿主的 `@deepseek-ai/dsh-client-ui-primitives`（`MarkdownText`，种子词），
  跨包原语用 `dsh-zhiyun-ui-primitives`（`useStudy` / `Notice`）—— 两个不同的包，别混。
- **两张样式表**：`style.css`（整页）与 `video.css`（视频栏）。同包内后写的赢，
  顺序是确定的，不吃挂载顺序的亏；视频栏的类名一律 `zs-video-` 前缀，与整页的
  `zs-*` 不重名，`npm run check:css` 因此不会把它们报成跨包竞争。

## 插槽

在 `zhiyun.study.content` 注册内容（`children` 声明归外壳）。`ModelSettings` 是这一页的
「解析模型」折叠区，读领域状态的路由配置，界面留在本包。
