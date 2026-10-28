// 「笔记链接图」渲染层的浏览器半边。
//
// 本包只导出一个组件：由「笔记」页（`dsh-zhiyun-page-notes`）import 使用，
// 自己**不注册**任何页面、插槽或导航项。这与「移植」的定义一致 ——
// 整包搬到一个正式位置，但它的职责边界不因为搬家而改变。
import css from './style.css';

export { css };
export { NoteGraph } from './NoteGraph.jsx';
export {
  toElements, layoutFor, ringPositions, graphStyles, GRAPH_LAYOUT_LIMIT,
} from './model.js';
