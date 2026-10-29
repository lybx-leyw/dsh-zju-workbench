// 「笔记链接图」渲染层的浏览器半边。
//
// 本包只导出一个组件：由「笔记」页（`dsh-zhiyun-page-notes`）import 使用，
// 自己**不注册**任何页面、插槽或导航项。这与「移植」的定义一致 ——
// 整包搬到一个正式位置，但它的职责边界不因为搬家而改变。
import css from './style.css';

// 插件面：本包**不注册**任何页面/插槽/导航项，但客户端 Loader 仍会把
// profile 里登记的每个 client 条目当作插件装配（Cordis 要求 object 形态的
// 插件带 `apply`，否则整页只剩一句 "Failed to load plugins"）。
// 所以这里给一个空插件面，与 `dsh-zhiyun-core-quiz/src/client.jsx` 同形状。
export const name = 'zhiyun-graph-render';
export const inject = [];
export function apply() {}

export { css };
export { NoteGraph } from './NoteGraph.jsx';
export {
  toElements, layoutFor, ringPositions, graphStyles, GRAPH_LAYOUT_LIMIT,
} from './model.js';
