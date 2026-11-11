/**
 * 上游封装占位。
 *
 * B 类骨架**通常不含本文件**（见任务文档的目录树：`src/upstream.js` 是「A 类：上游封装占位」）。
 * 这里破例保留，理由是上游形态特殊：它是 MIT 的 **Obsidian 插件**，
 * 「能不能摘码」的答案是「可以」，但「摘了能不能用」的答案是「不能」（见下）。
 * 与其留一篇散文解释，不如把「什么可借 / 什么不可借」写成机器可读的白名单。
 *
 * ⚠ 本文件**永远返回 `{ ok: false }`** —— 骨架阶段不加载任何上游代码。
 */

/**
 * 上游元信息（人工核对后填写；`locked: null` 表示**没有可锁的版本**）。
 *
 * 上游仓库 `jritzi/ocr-extractor`：
 *   - 未发布到 npm（Obsidian 社区插件走 GitHub Release 的 `main.js`/`manifest.json`/`styles.css` 三件套）；
 *   - 无 git tag ⇒ **`locked` 无值可填**，这正是本骨架 `dependencies` 为空的原因。
 *   - 因此 `packages/radar/` 里唯一合法的形态是「**契约提取**」，不是「锁版挂载」。
 */
export const UPSTREAM = Object.freeze({
  repo: 'jritzi/ocr-extractor',
  license: 'MIT',
  licenseVerified: true,
  // 仓库无 tag、未发 npm ⇒ 无法锁版。评审若要锁版，须先让上游打 tag 或自建 tarball。
  locked: null,
  // 摘码的可行性判断（三条全「否」，故不搬源码）
  portable: {
    '实现与 Obsidian vault API 耦合': false,
    '实现与 Obsidian callout 渲染耦合': false,
    '实现可脱离 Obsidian 桌面端运行': false,
  },
});

/**
 * 上游导出白名单：**只允许**从这里取东西，且当前白名单是**空的**。
 *
 * 空不是遗漏 —— 上游没有 `module.exports` 级别的库入口（它导出的是 Obsidian 的
 * `Plugin` 子类）。真正被复用的是 `BORROWED_CONTRACTS` 里的三条**设计决策**，
 * 那些已经写在本包里，不需要运行时导入。
 */
export const ALLOWED_EXPORTS = Object.freeze([]);

/**
 * 加载上游。
 *
 * @returns {Promise<{ok: false, reason: string}>} 骨架阶段恒为失败。
 */
export async function loadUpstream() {
  return { ok: false, reason: '候选骨架：上游无可导入的库入口（Obsidian 插件形态），且无版本可锁' };
}

export default { UPSTREAM, ALLOWED_EXPORTS, loadUpstream };
