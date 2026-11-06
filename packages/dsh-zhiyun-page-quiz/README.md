# dsh-zhiyun-page-quiz

智云 Pro 的「题库」页（页面插件）。跨课程按知识点出题、组卷练习、管理历史题目。

## 这一页为什么是独立插件包

在此之前，题库页挂在 `dsh-zhiyun-page-study` 里 —— 壳用 `pageBundle('quiz')` 特判，
把 `zhiyun.quiz.content` 交给学习页注册。两者其实是两件不同的事：

- 「学习」页按**课程 → 节次 → 知识点**纵向走，围绕一节课展开；
- 「题库」页按**知识点横向跨课程**走，围绕一段时间内的出题与复习展开。

拆开之后，题库可以单独停用、单独审查，样式也不再压在 672 行的学习页样式表里（搬走了 252 行）。

## 边界

- **零宿主逻辑**：`src/index.js` 只是让 Loader 能扫到这个包的 `dsh.client`。
- 领域状态（取数、出题任务、题库持久化）全在 `dsh-zhiyun-core-study` 提供的
  `zhiyunStudyController` 服务里；本包只渲染与交互。
- 出题策略/题型/配额的纯函数与常量来自 `dsh-zhiyun-core-quiz`。
- UI 原子（`Notice`、`useStudy`、`mountStyle`、`zs-button`/`zs-primary`/`zs-text`）
  来自 `dsh-zhiyun-shell-ui`。

## 与 dsh-zhiyun-page-study 的关系（唯一的跨页面包依赖）

学习页的知识点面板里嵌着一份**点级**出题目板（`quiz-panel.jsx`），它和学习页的
讲义生成共用一个模型选择器（`generation-models.jsx`）。这两个组件都放在本包，
由学习页以 `external` 方式导入：

```
dsh-zhiyun-page-study  ──import──▶  dsh-zhiyun-page-quiz
```

方向是**单向**的：本包不 import 学习页。客户端模块加载器对成环的 external 图会在
启动时直接抛错（`client-modules: module arrival cycle`），所以这条约束不是风格问题。

## 文件

| 文件 | 作用 |
| --- | --- |
| `src/index.js` | 宿主半边，无行为 |
| `src/client.jsx` | 挂样式 + 注册 `zhiyun.quiz.content`；对外再导出 `QuizPanel` / `GenerationModels` |
| `src/question-bank.jsx` | 页面外壳（页头/统计/分段导航）+ `PointQuizComposer` + 练习 |
| `src/question-history.jsx` | 历史题目列表、筛选、批量弃用、归档 |
| `src/question-generation-progress.jsx` | 出题任务进度（阶段、配额、任务树） |
| `src/quiz-panel.jsx` | 学习页知识点面板里嵌的点级题板 |
| `src/generation-models.jsx` | 供应商/模型/并发位选择器（`purpose` 区分讲义与出题） |
| `src/style.css` | 本页样式，类名统一 `zs-qz-*` 前缀 |

## 样式约定

- 类名一律 `zs-qz-*`：同包内后写的赢是确定的，跨包才需要防冲突；
  `npm run check:css` 会把「同一元素、同特异性、不同取值」的跨包规则报出来。
- 颜色只取壳的 `--zy-*` 变量，明暗主题自动跟随；不在本包重定义它们。
- 裸文字钮用壳的 `.zs-text`（**定义在 `dsh-zhiyun-shell-ui`**，学习页与题库页共用）。
