/** Browser entry for the page shell. Native slots and their owners stay untouched. */
import { normalizeConfig } from './state.js';
import { installPageShell } from './page-shell.jsx';

export const name = 'dsh-pages-client';
/**
 * 依赖声明。
 *
 * `slots` / `locale` 是**必需**：没有槽就没法渲染页面，没有 locale 就没法出标签。
 *
 * `layout` 是**可选**（`required: false`）：它提供官方的面板控制面
 * （`openRightbar` / `closeRightbar` / `toggleSidebar` / `panelInfo`），
 * 宿主面 `host` 优先用它。headless 或精简 profile 可能没有它 ——
 * 那种情况下 `host` 自动回落到 DOM 读取，页面功能照常（只是精确度低一点）。
 *
 * 写成可选而不是不写：声明了 `required: false` 之后，cordis 会**等它出现**再
 * 触发注入，而不是让它一直是 undefined；同时它缺席也不会把插件拖成 pending。
 */
export const inject = {
  slots: { required: true },
  locale: { required: true },
  layout: { required: false },
};
export { normalizeConfig, installPageShell };

/** Install the same page shell for both host-loader and product-bundle callers. */
export function apply(ctx, config = {}) {
  return applyWithConfig(ctx, config);
}

export function applyWithConfig(ctx, config = {}) {
  return installPageShell(ctx, normalizeConfig(config));
}
