/**
 * 【候选骨架·未评审、未接入 profile、不可直接使用】
 *
 * dsh-radar-study-chart —— 给既有「题库 / 学习」统计补趋势图。
 *
 * ## 现状（本轮实测，非推测）
 *
 * - 全仓 `packages/dsh-zhiyun-*/src` 内 `echarts` 只出现在**注释**里
 *   （`core-classroom-stage/src/client.jsx:192` 明确写「图表与公式**不在这里**实现渲染器」，
 *   `classroom-dsl/vendor/dsl/*.js:12` 写「must never gain a runtime dependency on … echarts」）。
 * - `dsh-zhiyun-classroom-renderer` 的 deps 只有 `katex@0.16.38`，无任何图表库；
 *   其 `view/slide.jsx:7` 自述「产品实际只用到 4 类」—— chart 被**明确排除**在渲染范围外。
 * - `page-quiz/src/question-history.jsx` 的作答历史是逐条文本
 *   （`第 20 行`：`作答：… · 掌握/待复习/已记录`），**无正确率、无趋势、无图表**。
 * - `core-study/src/grading.js` 只产出 `buildAttempt()` 的单次判定对象，
 *   **不做跨次聚合**，也没有 `accuracy`/`mastery` 字段。
 *
 * ⇒ 结论：本仓**没有**任何可复用的图表渲染能力，也没有正确率时间序列。
 *   这不是「重复集成」，而是既有面板（题库页 / 学习页）**缺一块统计视图**。
 *
 * ## 集成性质：**强化式集成**（三条判据全成立）
 *
 * | 判据 | 结论 | 依据 |
 * | --- | --- | --- |
 * | ① 仍是同一个面板 | ✅ | 落点是题库页已有的「作答历史」区与学习页的进度区，**不新增页面、不新增导航项** |
 * | ② 功能仍相似正交 | ✅ | 仍是「作答正确率 / 掌握度」这一件事，只是从「逐条文字」升级为「时间序列图」 |
 * | ③ 底层多调了更优质实现 | ✅ | 上游 `dsh-chart` 提供 `show_chart` 工具 + recharts 内联渲染（8 色分类调色板、明暗双主题校验过色觉分离），本仓需从零写 |
 *
 * ## 为什么是锁版挂载、不是抄代码
 *
 * 上游 `dsh-chart@0.5.0` 是**原生 DSH 插件包**（`package.json` 带 `dsh.bundle.patch`
 * → `./cordis.patch.yml`，且带 `dsh.client.platform = "web"`），形态与本仓
 * `dsh-zhiyun-paper` 系列一致：锁版引入 + 外围兼容层，**绝不改上游源码**。
 * 整包解压 23,264 B（22.7 KB），无 `dependencies`，`peerDependencies` 仅
 * `@deepseek-ai/dsh-tools: "*"` —— 对宿主版本无约束，接入门槛低。
 *
 * ## 与在册图表候选的区别（避免重复登记/重复出骨架）
 *
 * - `lxfu1/dsh-plugin-chart`（registry 🔵）：AntV 底座的**插件内图表面板**，形态是新建面板 → 判据①不成立。
 * - `Max-Samson/dsh-usage-chart` 等「用量簇」（registry ⛔）：token 用量/成本，**与学习无关**。
 * - 本包：聊天内联 `show_chart`，**复用**它给既有题库统计供数，不新建面板。
 *
 * 本文件目前只有占位与 TODO —— 骨架只证明「这个上游锁得住、这个位置是空的」，
 * 不证明「接进去能跑」。评审通过前不要 import。
 */

export const name = 'radar-study-chart';

export const VERSION = '0.0.0';

/**
 * 占位：未来在这里导出「作答历史 → chart spec」的聚合函数，以及落位注册。
 *
 * TODO(评审后)：
 *  1. **先补数据聚合**（这是真正的工作量，不是画图）：
 *     在 `core-study/src/grading.js` 旁新增纯函数 `attemptSeries(attempts, { bucket })`，
 *     把「逐条 attempt」按天/按章节聚合成 `{ labels, values }`。
 *     注意 attempt 的 `verdict` 有三个值（`correct` / `incorrect` / 其他），
 *     分母口径要先定死（只算已判定？含未判定？），否则正确率会随时间虚高。
 *  2. **落位**：题库页 `question-history.jsx` 的作答区顶部加一块趋势图，
 *     复用**同一份** `attemptSeries` 输出；学习页 `study-workspace.jsx` 的进度区同理。
 *     两块共用一份聚合，避免两处各算一遍导致数字对不上。
 *  3. **不要新写渲染器**：图由上游 `show_chart` 的 toolview 渲染；
 *     若要让它出现在面板（而非聊天流）里，需评估 `conversation.chat.turnTail`
 *     之外的 slot 是否可用 —— 上游只注册了 `tool.call.toolview` 与
 *     `conversation.chat.turnTail` 两个 slot，**面板内嵌不在其范围内**，
 *     这一条是评审的主要阻塞项，未解决前不要声称「已接入面板」。
 *  4. 中文标签的宽度与 8 色调色板在浅色主题下的对比度未验。
 */
export function apply() {
  return { ok: false, reason: 'skeleton: unreviewed, not wired' };
}
