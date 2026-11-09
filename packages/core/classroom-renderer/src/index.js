/**
 * 课堂画布约定（宿主半边）。
 *
 * # 本包现在只会有两个常量
 *
 * 它曾同时装渲染器；2026-11 按分层把组件搬走了：
 *
 * | 曾经 | 现在 |
 * | --- | --- |
 * | `src/view/slide.jsx`（React） | `packages/client/ui-shared/src/classroom-slide.jsx` |
 * | `src/style.css` | `packages/client/ui-shared/src/classroom-slide.css` |
 * | `src/client.jsx`（浏览器半边） | 已删 —— 本包没有客户端产物了 |
 *
 * 留下的只有 `VIEWPORT_SIZE` / `VIEWPORT_RATIO`：生成侧（`core-classroom-generate`）
 * 与渲染侧必须用同一套坐标，所以它是**共享数据**，属于 core。
 *
 * # 为什么这条边界值得写下来
 *
 * 组件住在 core 的后果不是抽象的：core 的产物要能在 Node 里被 require，
 * 而 React 组件会把 React 拖进进程；同时页面会为了一个组件 import 一个 core 包，
 * 把「core 提供服务、page 只渲染」变成「page 依赖 core 的 UI」。
 */

export const name = 'zhiyun-classroom-renderer';
// ↑ 与被别的包 require 时的模块 id（`@lybx-leyw/dsh-zju-core-classroom-renderer`）不同名，
// 但宿主按 __ModuleLoader__ 注册的 id 建表，不需要它们一致。

/**
 * 画布尺寸（纯数据）。
 *
 * 生成侧（`core-classroom-generate/src/scene.js`）与渲染侧必须用同一套坐标，
 * 所以它定义在这里、由两边引用。
 */
export const VIEWPORT_SIZE = 1000;
export const VIEWPORT_RATIO = 0.5625;

/**
 * 历史来源标注。
 *
 * 保留它是因为 `ATTRIBUTION.md` 承诺的那份 MIT 代码的**设计**仍被沿用
 * （画布坐标系、元素字段命名、text/shape/image/latex 的分类），只是不再
 * 逐字节拷它的产物。
 */
export const upstream = Object.freeze({
  package: '@openmaic/renderer',
  version: '0.2.0',
  commit: '0ae3215e965412b8ee536feaa5d98f75b7a70923',
  /** 已删除：本仓自研的渲染器现在住在 `ui-shared/src/classroom-slide.jsx`。 */
  vendor: null,
});

/**
 * 本包不提供任何运行时服务，只导出画布常量。
 *
 * ⚠️ **渲染组件不在这里**。`ClassroomSlide` 会 `import React` 并产出 DOM，
 * 按本仓分层它属于 UI 层，已搬到 `@lybx-leyw/dsh-zju-ui-shared`
 * （`src/classroom-slide.jsx`）。core 只留纯数据与纯逻辑 —— 这条边界以前是破的，
 * 那时候 `page-study` 直接 import 一个 core 包里的 React 组件。
 */
export async function apply() {}
