/**
 * 上游封装占位 —— `@bbob/core@4.4.1`（JiLiZART/BBob，MIT）。
 *
 * **本文件不 import 上游**。它只记录「上游长什么样」与「接进来要怎么调」，
 * 供评审时不必读上游源码即可判断可行性。评审通过后再改成真实 import。
 *
 * ── 上游事实（2026-10-28 实测，非文档摘抄）──────────────────────
 *
 * | 项 | 值 |
 * | --- | --- |
 * | npm 包 | `@bbob/core` / `@bbob/parser` / `@bbob/plugin-helper` / `@bbob/types` / `@bbob/preset` / `@bbob/preset-html5`，**均为 4.4.1** |
 * | `bbob` / `bbob-html` / `bbob-react` / `bbob-vue` | **npm 上不存在**（`Not found`）→ 别锁这几个名字 |
 * | 安装体积 | 6 个包，unpacked 合计 **≈ 462 KB** |
 * | 依赖写法 | **每个包的 `dependencies` 全是 `"*"`** → 只锁顶层版本锁不住任何东西 |
 * | 许可证 | MIT（`LICENSE` 文件 + 每个包 `package.json.license` 均 MIT） |
 * | `main` / `module` / `exports` | 三者齐（`lib/index.js` / `es/index.mjs`）→ 可正常 Node ESM import |
 * | 是否自带 HTML 渲染 / `innerHTML` | **否**（`@bbob/preset-html5` 内部无 `innerHTML` / `dangerous` 字样） |
 *
 * ── 调用形状 ──────────────────────────────────────────────────
 *
 * ```js
 * import { parse } from '@bbob/parser';
 *
 * const ast = parse(ubb, {
 *   // ⚠ 必须开：否则 `[code]` 里的 `[b]` 会被当成真标签（实测见 README §风险）
 *   contextFreeTags: ['code'],
 *   // 只认已知标签，未知的按字面量放行（避免把 `[1]` 之类的正文当标签吞掉）
 *   onlyAllowTags: [...],
 * });
 * ```
 *
 * AST 形状（实测片段）：
 * ```json
 * {
 *   "tag": "quote",
 *   "attrs": {},
 *   "content": [ "文字", { "tag": "b", "content": ["粗体"],
 *                          "start": {"from": 72, "to": 75},
 *                          "end":   {"from": 77, "to": 81} } ],
 *   "start": {"from": 65, "to": 72},
 *   "end":   {"from": 100, "to": 108}
 * }
 * ```
 * 叶子节点是**纯字符串**（不含偏移）；只有 tag 节点带 `start`/`end`。
 *
 * ── TODO ─────────────────────────────────────────────────────
 *
 * TODO-U1 · `contextFreeTags: ['code']` 会让 code 块内容被切成多段字符串
 *           （`"["`, `"b]x"`, `"["`, `"/b]"`），拼接后字面量正确但**块内偏移不可用**。
 *           若 TODO-C1 的缝合层已经先把 `[code]` 整段摘走，这里就不必开该选项 ——
 *           **二选一，不要两处都做**。
 *
 * TODO-U2 · `onlyAllowTags` 需要一份白名单。起点可直接取本仓
 *           `packages/dsh-zhiyun-source-cc98/src/ubb.js` 里正则已列举的标签集合
 *           （`b i u del center left right line noubb color size font align bg sound upload
 *             img video audio code quote url ac/em/cc98/tb/ms 编号  bili`）。
 *
 * TODO-U3 · 6 个 `@bbob/*` 的版本必须**逐个写死**（已在 `../package.json` 完成）。
 *           评审若决定升级，**6 个一起升**，不可只动 `@bbob/core`。
 */

/**
 * 上游调用形状的占位（评审通过后替换为真实实现）。
 *
 * @param {string} _ubb
 * @returns {never}
 */
export function parseUbb(_ubb) {
  throw new Error('TODO-C1/C2：缝合层与偏移验证完成前，不得调用上游解析。');
}
