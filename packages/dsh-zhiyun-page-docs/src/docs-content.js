// 内置文档的**唯一** import 点。
//
// 每一篇 markdown 都通过 esbuild 的 text loader 变成字符串打进来（见 scripts/build.mjs
// 的 `loader: { '.md': 'text' }`）。集中在一处的理由有两个：
//
//   1. `docs-manifest.js` 保持纯数据 —— 它能被裸 Node import，测试才能核对
//      「清单里的 file 都真的有对应模块」而不需要构建。
//   2. 想换正文来源时（比如改成从服务加载），只改这一个文件，页面代码不动。
//
// ⚠️ 新增一篇文档要同时改这里和 `docs-manifest.js`。漏了这里不会构建失败 ——
//    `PAGE_CONTENT[id]` 是 undefined，页面会显示"这一篇暂时读不到"。
//    `tests/docs-page.test.mjs` 有一条断言在盯这两处是否对齐。

import overview from './docs/overview.md';
import setup from './docs/setup.md';
import config from './docs/config.md';
import vibe from './docs/vibe.md';
import owners from './docs/owners.md';
import plugin from './docs/plugin.md';
import testing from './docs/testing.md';
import attribution from './docs/attribution.md';
import privacy from './docs/privacy.md';
import layout from './docs/layout.md';
import shell from './docs/shell.md';

/**
 * 页面 id → markdown 原文。
 *
 * 键是 `docs-manifest.js` 里的页面 `id`（不是文件名）。用 id 而不是文件名做键，
 * 是因为 id 同时决定 URL/状态与插槽，文件名只是打包时的路径，改文件名不该影响状态。
 */
export const PAGE_CONTENT = Object.freeze({
  overview,
  setup,
  config,
  vibe,
  owners,
  plugin,
  testing,
  attribution,
  privacy,
  layout,
  shell,
});

/**
 * 取一篇文档的原文。
 * @param id - 页面 id。
 * @returns markdown 字符串；该 id 没有配套文件时返回空串（页面据此显示空态）。
 */
export function contentOf(id) {
  return Object.prototype.hasOwnProperty.call(PAGE_CONTENT, id) ? PAGE_CONTENT[id] : '';
}
