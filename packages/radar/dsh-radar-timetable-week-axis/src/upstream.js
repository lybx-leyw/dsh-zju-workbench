/**
 * dsh-radar-timetable-week-axis —— 上游占位（B 类 · **不锁版**）。
 *
 * 上游是 Next.js 站点，`private` + 未发 npm + 无 `dsh.bundle.patch` ⇒ **无法锁版**。
 * 本文件只记录「从上游读到的形状」，**不含任何上游源码**。
 * 实现时按这些形状自行写判定逻辑，不得整段搬运 `.ts` 文件。
 *
 * 参考：`src/lib/nusmods.ts`（只读思路，未复制代码）
 */

/** 上游仓库（只作凭据，不作依赖）。 */
export const UPSTREAM_REPOSITORY = 'CPLADRAGON/nus-vacansee';

/** 上游许可证（GitHub `license.spdx_id` 实查）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游支持的四种 `weeks` 编码 —— 这是本包要吃的全部形状。
 *
 * TODO(评审后实现)：把这份形状表当成**契约**，`normalizeWeeks()` 必须覆盖每一种；
 * 缺一种就静默返回空周次（课表不报错但整学期消失）。
 *
 * @type {ReadonlyArray<{shape: string, meaning: string}>}
 */
export const WEEK_ENCODINGS = Object.freeze([
  { shape: 'number[]', meaning: '显式周号列表' },
  { shape: '{ start, end }', meaning: '闭区间' },
  { shape: '{ start, end, weeks }', meaning: '以 weeks 为准，start/end 作钳位' },
  { shape: '{ start, end, weekInterval }', meaning: '按间隔步进，缺省 1' },
]);

/**
 * 加载上游 —— **占位，永远抛错**。
 *
 * TODO(评审后实现)：本包**不需要**运行期加载上游（它是站点不是库）。
 * 若评审想改成「真锁版」，必须先确认上游发了 npm 包 —— 目前没有，故本函数应保持抛错。
 */
export function loadUpstream() {
  throw new Error('dsh-radar-timetable-week-axis: B 类能力提取，无上游运行期依赖');
}
