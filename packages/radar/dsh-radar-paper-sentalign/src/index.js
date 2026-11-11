/**
 * dsh-radar-paper-sentalign —— 论文页句级对照翻译的**引擎契约**骨架。
 *
 * ⚠️ 候选骨架：未评审、未接入 profile、不可直接使用。
 * 本文件只有一个空的 `apply()`；可执行的只有下面白名单里的纯函数契约。
 * 真正的接入点在评审通过后写进 `packages/client/page-paper`，**不在这里**。
 *
 * 为什么是空骨架：上游 `Chuanyunux/pararead` 未发 npm（`registry.npmjs.org/
 * pararead` → Not found）、且是 VS Code 扩展（`main` 指向的产物依赖
 * `vscode` 模块，DSH 内加载不能），**没有可锁版的包**。按仓库 r155 §③ 定下、
 * r158 再次验证的「B 类契约提取」口径：`dependencies: {}` 是刻意的，
 * 见 README「为什么不锁版」。
 */

/** 可迁移的四条决策对应的纯函数契约（实现在 ./sentalign.js）。 */
export {
  sentenceId,
  planBatches,
  mergeById,
  detectScript,
  isAlreadyInLanguage,
  cacheKey,
} from './sentalign.js';

/** 白名单：本骨架承诺的公开面。不要从这个数组之外 import。 */
export const EXPORTS = Object.freeze([
  'sentenceId',
  'planBatches',
  'mergeById',
  'detectScript',
  'isAlreadyInLanguage',
  'cacheKey',
]);

/**
 * 占位。**刻意什么都不做。**
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // TODO(评审后)：把 sentalign 的契约接进论文页。
  //
  // 挂载点应为 `packages/client/page-paper`，具体三处：
  //
  //   1. `ReaderFrame.jsx` —— 选区出口。现在 `readSelection()` 把整段
  //      `selection.toString()` 交给 `translate()`（整段进出）。句级对照需要
  //      在 iframe 内先切句、再按句量 `getBoundingClientRect()` 回传父页，
  //      父页据此把译文摆到同高位置。
  //
  //   2. `Paper.jsx:168-170` —— `translate` 的调用点。句级化之后
  //      `translateSelection(text)` 应换成 `translateSentences(ids)`，
  //      返回 `Map<id, translation>`，未命中的 id 走单句重试。
  //
  //   3. 翻译缓存 —— 现在是内存缓存、无版本维度。必须把
  //      `cacheKey` 里的术语表哈希与 `PROMPT_VERSION` 接进去，
  //      否则用户改完术语表发现译文没变。
  //
  // 评审需先裁定的一件事：**句级对齐的坐标回传是否接受 iframe 内
  // getBoundingClientRect() + postMessage**。不接受则本骨架整体作废。
  void ctx;
}
