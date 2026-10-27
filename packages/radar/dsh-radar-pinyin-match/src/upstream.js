/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-zhiyun-paper/src/upstream.js`：本包不直接 import 上游，
 * 而是留一个**窄接口**（`createMatcher()`），把所有「上游长什么样」的知识
 * 关在这一个文件里。这样评审时可以：
 *
 *   ① 单测里注入一个假 matcher（不装上游也能跑通上层逻辑）；
 *   ② 上游换实现/换版本时只改这一个文件；
 *   ③ 上游 API 的怪癖（返回 `false` 而非 `null`、返回闭区间而非长度）只在这里消化。
 *
 * ⚠ 下面两个 `TODO` 是**评审前必须由人决定**的事，不是可以随手填的空。
 */

/** 上游 `match()` 的返回形状：命中回 `[start, end]`（**闭区间，含两端**），未命中回 `false`。 */export const UPSTREAM_SHAPE = '[number, number] | false';

/**
 * TODO-5 · 把上游的「闭区间 + false」翻译成本仓的「`{ matchStart, matchEnd } | null`」。
 *
 *   本仓 `findIn()` 的契约（`layered-search.js`）：
 *
 *   ```
 *   return { matchStart: at, matchEnd: at + needle.length };  // end 是【开区间】
 *   ```
 *
 *   而上游回的是**闭区间**（`match('道德经','ddj') → [0,2]` 表示第 0、1、2 三个字）。
 *   于是 `matchEnd` 必须 **+1** 才能与本仓 `previewOf()` 的切片语义对上；
 *   漏掉这个 +1，预览会**少一个字**——而且不会报错，只会看起来「怪怪的」。
 *   这是本封装唯一真正需要小心的地方。
 *
 * @param {string} haystack 被检索的文本（一个句子 / 一个块 / 一段讲义）
 * @param {string} needle   用户输入（可能是汉字、全拼、首字母、繁体）
 * @returns {{ matchStart: number, matchEnd: number } | null}
 */
export function toLocalSpan(haystack, needle) {
  // 占位：评审通过后实现。
  //   1. matcher = await loadMatcher(haystack)   // 见 TODO-2 的双字典策略
  //   2. const span = matcher.match(haystack, needle)
  //   3. span === false ? null : { matchStart: span[0], matchEnd: span[1] + 1 }
  throw new Error('候选骨架：toLocalSpan() 未实现（见 README，未评审）');
}

/**
 * TODO-6 · 惰性取上游。
 *
 *   为什么必须是**函数**而不是顶层 `import`：
 *   宿主是浏览器端（`dsh.client.platform = web`），顶层 import 会把 28KB 字典
 *   塞进「学习」页的首屏包；而拼音匹配只服务于「检索时」这一个交互。
 *
 *   另外繁版（86KB）须在**运行时判断**后才加载，见 TODO-2。
 */
export async function loadMatcher() {
  throw new Error('候选骨架：loadMatcher() 未实现（见 README，未评审）');
}
