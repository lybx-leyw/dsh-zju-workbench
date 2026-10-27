/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-zhiyun-paper/src/upstream.js` 与 `packages/dsh-radar-pinyin-match/src/upstream.js`：
 * 本包不直接 import 上游，而是留一个**窄接口**（`loadUpstream()` + `toLocalSpan()`），
 * 把所有「上游长什么样」的知识关在这一个文件里。这样评审时可以：
 *
 *   ① 单测里注入一个假 matcher（不装上游也能跑通上层逻辑）；
 *   ② 上游换实现 / 换版本时只改这一个文件；
 *   ③ 上游 API 的怪癖（闭区间、`indices` 可能缺、basic 构建的导出形态）只在这里消化。
 *
 * ⚠ 下面三个 `TODO` 是**评审前必须由人决定**的事，不是可以随手填的空。
 */

/** 上游锁定凭据 —— 与 `package.json.dependencies` 必须逐字一致（`tests/radar-packages.test.mjs` 钉住）。 */
export const UPSTREAM_PACKAGE = 'fuse.js';
export const UPSTREAM_VERSION = '7.5.0';
/** 供人工复核对照：仓库地址（即 npm 包的 `repository.url`）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/krisk/Fuse';

/** 上游命中区间的形状：**闭区间**，含两端。 */
export const UPSTREAM_SHAPE = '[number, number]（闭区间，含两端）';
/**
 * TODO-A · 加载上游，并决定用**哪个构建**。
 *
 *   实测（本仓复现脚本见 README「实测差分」）：
 *
 *   - `fuse.js@7.5.0` 的 npm 包里 **只有** `dist/fuse.mjs` / `dist/fuse.basic.mjs` /
 *     `dist/fuse.basic.min.mjs` 少数几个出口；**没有 `fuse.min.js`**（404）。
 *     早期版本（7.1.0）有 `dist/fuse.basic.min.js`（UMD），7.5.0 已移除。
 *   - 本包**只该用 basic 构建**：完整构建带 extended search（`$path` / `!` 否定 / `^` 前缀），
 *     那是**新的查询语法**，会改变用户输入的语义 —— 属于「改档位」，本包不允许（见 README 边界）。
 *   - 名字叫 `mjs` 不代表一定是 ESM 产物：实测 `7.5.0/dist/fuse.basic.min.mjs` 可 `import`
 *     默认导出为构造函数；但**不要凭命名推断**，实现时必须先 `import` 一次、打印
 *     `typeof x === 'function'` 再落代码。
 *
 *   本仓已有的 Node 侧互操作先例是 `createRequire`（见 `dsh-zhiyun-host-paper/src/index.js`
 *   的 `installedUpstreamVersion()`）；本包**服务端与客户端都要用**（检索在 `layered-search.js`，
 *   是客户端 bundle 的一部分），所以客户端那一侧走打包器解析，不能再依赖 `createRequire`。
 *
 * @returns {Promise<{ Fuse: Function, version: string, build: 'basic' }>}
 */
export async function loadUpstream() {
  // 占位：评审通过后实现。候选写法（二选一，需实测）：
  //
  //   import Fuse from 'fuse.js/dist/fuse.basic.min.mjs';   // 前提：package.json#exports 放行子路径
  //   import Fuse from 'fuse.js';                            // 前提：上游 resolve 到 basic（**默认不是**）
  //
  // ⚠ 若 `exports` 字段挡住了 `dist/*` 子路径（7.x 常见），就**不能**用子路径 import，
  //   只能接受默认入口（完整构建）**并关掉 extendedSearch**（`extendedSearch: false`
  //   不属于公开选项，所以更稳的做法是：自己检查用户输入里是否出现 `$ ! ^ ' = |` 等
  //   扩展语法字符，出现则退回纯字面，不进 Fuse）。这一条必须由评审拍板。
  throw new Error('候选骨架：loadUpstream() 未实现（见 README，未评审）');
}

/**
 * TODO-B · 把上游的「闭区间」翻译成本仓的「`{ matchStart, matchEnd }`」。
 *
 *   本仓 `findIn()` 的契约（`layered-search.js`）：
 *
 *   ```
 *   return { matchStart: at, matchEnd: at + needle.length };  // end 是【开区间】
 *   ```
 *
 *   Fuse 回的 `[4, 10]` 表示第 4…10 **共 7 个字符**（「Fourier」）。所以
 *   `matchEnd` 必须 **+1** 才能与 `previewOf()` 的切片语义对上。
 *   漏掉这个 +1，预览会**少一个字**——而且不会报错，只会看起来「怪怪的」。
 *
 * @param {unknown} indices 上游 `matches[0].indices`（`number[][]` 或 `undefined`）
 * @returns {{ matchStart: number, matchEnd: number } | null}
 */
export function toLocalSpan(indices) {
  // 占位：评审通过后实现。
  //   if (!Array.isArray(indices) || !Array.isArray(indices[0])) return null;   // ← R3
  //   const [start, end] = indices[0];
  //   return { matchStart: start, matchEnd: end + 1 };
  throw new Error('候选骨架：toLocalSpan() 未实现（见 README，未评审）');
}

/**
 * TODO-C · 分数必须被**丢掉**，而不是被使用。
 *
 *   Fuse 的 `score` 是 0（最像）→ 1（最不像），且**跨文本不可比**（文本长度、位置都计入）。
 *   本仓的结果顺序是「层 → 文档序 → 文档内偏移」，没有分数位。若实现时顺手
 *   `sort((a, b) => a.score - b.score)`，同一个查询在不同节里会给出不同的条序，
 *   而页面没有任何地方能解释这个顺序 —— 那是**隐形的契约破坏**。
 *
 *   结论：`scanOnce()` 只允许消费「命中 / 未命中 + 区间」，`score` 一律丢弃。
 *   真要做排序，那是 `dsh-radar-search-rank`（minisearch）那条独立轴的活。
 */
export const SCORE_IS_NOT_A_SORT_KEY = true;
