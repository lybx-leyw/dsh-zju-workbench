/**
 * dsh-radar-star-anomaly · 占位入口（**未实现**）
 *
 * 由「DSH 生态雷达」于 2026-11-06 自动生成，仅供人工评审。
 * 这里**没有**任何可用逻辑：apply() 只挂一个空分区，不注册任何 RPC、不改任何页面。
 *
 * TODO（评审通过后按顺序做）：
 *   1. 确认落点：`dsh-zhiyun-page-plugins`（「插件」页）内新增一个**只读**标记列，
 *      不新增导航项、不新增写入口 —— 本仓那条页面的原则是「不另开写入口」。
 *   2. 把上游判据移植成纯函数（见 ./upstream.js 的三条已核实判据），
 *      输入只用「两次快照的 stars/forks」与本地快照日期，不引入上游任何采集流水线。
 *   3. 数据来源二选一：
 *      a) 自己的 `radar` 轮次顺带记录 stars（零外部依赖，慢）；
 *      b) 读上游 `data/*.json` 的**已发布产物**（需确认可离线、可缓存，见 README 风险 R1）。
 *   4. 中文文案：判据名要直白（「日增异常」「疑似清号回收」「高星零 fork」），
 *      不要出现「anomaly」这类给维护者看的口径。
 */

/** @type {import('cordis').Plugin} */
export const name = 'dsh-radar-star-anomaly'

/**
 * 占位 apply：**故意什么都不做**。
 * 真实实现之前挂上来只会让「插件」页多一行什么都不干的东西。
 */
export function apply() {
  // no-op on purpose
}
