/**
 * 上游 `jieba-wasm` 的封装占位 —— 候选骨架，**未评审、不可直接使用**。
 *
 * 本文件只负责「按平台拿到一个可用的分词函数」，**不实现任何检索语义**。
 * 语义（有序词序列、主词/子词）属于本包自己的 TODO-2，不属于上游。
 *
 * ── 已实测的入口差异（2026-10-20，jieba-wasm@2.4.0）──────────────────
 *
 *   | 平台 | 入口文件 | 形态 | 初始化 |
 *   | --- | --- | --- | --- |
 *   | Node | `pkg/nodejs/jieba_rs_wasm.js` | **CJS**（`module.exports.cut = …`） | 顶部同步 `fs.readFileSync`，**无需 init** |
 *   | 浏览器 | `pkg/web/jieba_rs_wasm.js` | **ESM** | **必须** `await __wbg_init()`（默认导出），否则 `cut()` 抛 `wasm is undefined` |
 *
 *   `package.json` 的 `exports` 用条件导出区分：`node` / `browser` / `import` / `require`。
 *   ⚠ **Node 下 `import` 拿到的是 CJS 互操作对象**：`import pkg from 'jieba-wasm'`
 *   可用，`import { cut } from 'jieba-wasm'` 在此版本下**会失败**（只有 `default`）。
 *   所以这里统一用默认导入，不要写具名导入。
 *
 *   体积（实测，gzip）：`.wasm` **2,815,114 B**，胶水 JS **2,600 B**。
 *   → **禁止放进浏览器 bundle**，见 `src/index.js` Q-1 / TODO-1。
 */

/** 缓存已加载的分词器，避免每帧重复初始化 wasm。 */
let pending = null;

/**
 * 懒加载上游并返回 `{ cut, cutForSearch, addWord }`。
 *
 * @returns {Promise<{cut: Function, cutForSearch: Function, addWord: Function}>}
 */
export function loadUpstream() {
  if (pending) return pending;
  pending = (async () => {
    // eslint-disable-next-line no-unused-vars
    const mod = await import('jieba-wasm');
    // TODO-1：浏览器分支须 `await (mod.default ?? mod.__wbg_init)()` 先初始化。
    //   该分支未在本仓验证过（本仓页面检索是客户端函数，Q-1 尚未裁决），
    //   所以这里**故意不写**，避免被误读成「已验证可用」。
    throw new Error('候选骨架：上游封装未实现（见 src/upstream.js TODO-1）');
  })();
  return pending;
}
