/**
 * 农历刻度 —— 把公历某一天换算成中国农历的「月 + 日」（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。
 *
 * # 为什么不用第三个 npm 包
 *
 * ECMA-402 的 `Intl.DateTimeFormat` 已经支持 `calendar: "chinese"`。跑一遍就能看到
 * `formatToParts()` 给出的就是「月份名（正月 / 二月 / 闰六月 …）+ 数字日」：
 *
 * ```text
 * 2026-11-01 → month=九月  day=23   （数字，不是「廿三」）
 * 2026-01-01 → month=十一月 day=13
 * 2026-02-17 → month=正月  day=1
 * ```
 *
 * 也就是说 **月名天生就带「正月 / 冬月 / 腊月 / 闰×月」的正名**，只有「日」需要
 * 从数字转成「初一 … 初十 / 十一 … 十九 / 二十 / 廿一 … 廿九 / 三十」。
 * 这一步是纯查表，40 行以内 —— 所以本包**不引入任何依赖**。
 *
 * # 三条已知边界（评审重点）
 *
 * 1. **必须走 `formatToParts`，不能走 `format`**。`format()` 直接给
 *    「2026年九月23」，混着字面量 `年` / `literal` 分隔符，正则一改就错；
 *    `parts` 里 `type` 是稳定的。
 * 2. **`relatedYear` 不是农历年号**。它给的是「这一农历年对应的公历年」，
 *    春节前后会与公历年差 1（2026-01-01 的 `relatedYear` 是 **2025**）。
 *    要显示干支（乙巳 / 丙午）请读 `yearName`，**不要**把 `relatedYear` 当农历年。
 * 3. **ICU 版本决定边界行为**。`calendar: "chinese"` 的实现随 Node 的 ICU 版本走
 *    （本机 Node 22.13 / ICU 76.1 实测正常）。闰月、闰腊月这类稀有时刻
 *    必须由评审阶段用「已知对照表」验，不能只信库。
 *
 * # 不做什么
 *
 * - 不做节气计算（需要天文算法或额外的节气表，超出「一行文本」的价值）。
 * - 不做宜忌、黄历、生肖运势 —— 与学习工作台无关。
 * - 不做「农历生日提醒」：那是日历域的功能，本仓日历由 ICS 导出承接。
 */

const LUNAR_MONTH = new Intl.DateTimeFormat('zh-CN', {
  calendar: 'chinese',
  timeZone: 'Asia/Shanghai',
  month: 'long',
});

const LUNAR_DAY = new Intl.DateTimeFormat('zh-CN', {
  calendar: 'chinese',
  timeZone: 'Asia/Shanghai',
  day: 'numeric',
});

/** 「日」的中文名。下标即农历日，1…30。 */
const DAY_NAMES = [
  '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

/**
 * 把毫秒时间戳换算成「九月廿三」这样的农历文本。
 *
 * @param ms - 毫秒时间戳。
 * @returns 农历月日文本；不可解析时返回空串（调用方据此**不渲染这一行**，
 *          不要退回「未知」之类的占位字）。
 *
 * TODO(评审)：接进 `packages/dsh-zhiyun-page-today/src/agenda.js` 的 `clock()`
 *             旁边，作为同一个日期行上的第二段，**不新增卡片、不新增页面**。
 */
export function lunarLabel(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';

  // TODO(评审)：闰月。`month` 会是「闰六月」这种形态，`DAY_NAMES` 查表不受影响，
  //             但要确认「闰月首日」是否应显示为「闰六月初一」而非被 ICU 省略月份前缀。
  const month = LUNAR_MONTH.format(date);
  const day = Number(LUNAR_DAY.format(date));

  if (!month || !Number.isInteger(day) || day < 1 || day > 30) return '';
  return `${month}${DAY_NAMES[day]}`;
}
