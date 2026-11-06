/**
 * 上游封装占位 —— **未实现**。
 *
 * 上游 `0x000005/better-zdbk` 是**单文件油猴脚本**（`zdbk.user.js`，661 KB，无模块边界），
 * **未发布到 npm**，因此**没有可锁版的包**。与 A 类骨架（锁版 `dependencies` + `upstream.js`
 * 导出上游实例）不同，本文件在本包中**只承担「上游形状记录」的职责**：
 * 记录被提取的那两个符号**在源码里的确切位置**，供评审逐行核对。
 *
 * ── 上游被提取的两个符号（commit 见 ATTRIBUTION.md）───────────────
 *
 *   CONFIG.campusAliases           （CONFIG 字面量内，约第 211 行）
 *     { "紫金港": ["银泉"] }
 *
 *   isCampusMismatch(cell)         （约第 3180–3190 行）
 *     var location = normalizeDisplayText(cell && cell.textContent).replace(/\s+/g, "");
 *     if (!settings.campus || !location || location === "--"
 *         || location.indexOf(settings.campus) !== -1) { return false; }
 *     var aliases = CONFIG.campusAliases[settings.campus] || [];
 *     for (var i = 0; i < aliases.length; i++) {
 *       if (location.indexOf(aliases[i]) !== -1) { return false; }
 *     }
 *     return true;
 *
 *   以及它的调用方 updateCourseNotices(heading, load)（约第 3196–3222 行）：
 *   遍历所有 `td.skdd`，只有**每一行**都 `isCampusMismatch === true` 时才置 `allOutside`。
 *
 * ── 为什么本包不直接 import ─────────────────────────────────────
 *
 *   上游代码作用在**DOM 节点**上（`cell.textContent`、`settings` 全局），
 *   离开 `zdbk.zju.edu.cn` 选课页即失效。本包要做的是把它的**判定口径**
 *   改写成「字符串进、结构化结果出」的纯函数（见 `src/index.js` 的 `classifyZone`），
 *   语义等价处保留，**已知误报处必须修掉**（见 README「已知风险」）。
 *
 * ── TODO ─────────────────────────────────────────────────────────
 *
 *   [ ] 上游若要升级，先核对上面两段源码是否变化；`campusAliases` 是否新增条目。
 *   [ ] 不把 `zdbk.user.js` 放进本仓任何位置（不搬运上游源码）。
 */
export const UPSTREAM = Object.freeze({
  repo: '0x000005/better-zdbk',
  license: 'MIT',
  npm: null,
  form: 'single-file userscript',
});
