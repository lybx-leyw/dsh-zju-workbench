// 共享 UI 原语：把「共享原子样式」注入一次，并把原语本身交给其它客户端包 require。
//
// 页面包用 `import { Icon } from 'dsh-zhiyun-ui-primitives'`：构建时它是 external，
// 运行时由客户端的模块表解析到**这个** bundle 的 exports（见 dsh.client.external）。
import * as primitives from './primitives.jsx';
import css from './style.css';

export const name = 'zhiyun-ui-primitives-client';
/** 纯展示包：除了客户端的 `slots` 什么都不依赖。 */
export const inject = [];
export function apply(ctx) {
  // 样式随本包的生命周期装卸；卸载后页面回到宿主原生外观。
  primitives.mountStyle(ctx, {
    attribute: 'zhiyunPrimitivesStyle',
    css,
    label: 'zhiyun: shared primitive styles',
  });
}
// ⚠️ 这张清单是**逐个列**的，新增原语必须同时加到这里，否则它在 `primitives.jsx` 里
//    定义得好好的、产物里也有那个字符串，但**入口 bundle 不往外传** —— 使用方拿到
//    `undefined`，React 报 #130（Element type is invalid），表现是那一整块插槽崩掉、
//    界面上凭空少一片。这个坑真踩过：新加的 `StudentAvatar` 漏在了这里。
//    `tests/ui-primitives.test.mjs` 会比对两个文件的导出名，防止再漏。
export const { Icon, Mark, Empty, SectionTitle, Notice, StudentAvatar, useStore, useStudy, mountStyle } = primitives;

// ⚠️ 这里**不能**写 `export default primitives`。
//
// 宿主 Loader 解析 bundle 的 exports 时优先取 `default`（见 vendor/loader 的 `unwrapExports`：
// `exports = exports.default ?? exports`），于是 default 会顶掉真正的插件面 —— 它拿到的是
// 原语命名空间对象（没有 `apply`），整页直接 "Failed to load plugins:
// invalid plugin, expect function or object with an \"apply\" method, received object"。
// 具名导出就够了：别的包 `import { Icon } from 'dsh-zhiyun-ui-primitives'` 走的是本 bundle
// 的 exports 表（dsh.client.external 建立的行），与 ESM default 无关。
