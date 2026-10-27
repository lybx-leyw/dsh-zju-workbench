/**
 * dsh-radar-todo-fence —— 学在浙大待办的「判据围栏」**候选骨架**。
 *
 * ⚠️ 未评审 · 未接入 profile · 不可直接使用。所有入口在未完成 TODO 前一律抛错，
 *    以保证它被误挂载时**立刻暴露**，而不是静默产出「看起来合理」的结果。
 *
 * # 这个包要解决的事
 *
 * 「今天」页与「规划」页消费的是 `packages/dsh-zhiyun-source-campus` 给出的同一份 `rows`。
 * 现在这份 rows 有两处不可见的性质：
 *
 *   1. 它可能来自 `fast`（1 个请求）或 `slow`（5N 个请求），调用方看不出差别；
 *   2. `rows === []` 可能是「真的没有待办」，也可能是「读失败了被 catch 成空数组」。
 *
 * 本包**不重新抓取**，只做两件事：给 rows 挂一份 `fence`（来源 + 降级 + 完整性），
 * 以及把「空列表」区分成三态。这样「今天页显示今天没事」与「今天页读不到数据」不再同形。
 *
 * # 与现有功能的关系
 *
 * 强化式集成（**判据③ 部分成立，见 README**）。不新增面板、不改抓取逻辑、不搬上游代码。
 */

/**
 * 活动类型的**判定口径表**。
 *
 * 来源：`8eoyw/zju-learning-cli`（MIT）`zju.py:739` 的 `ACT_TYPES`，那是作者在真机上
 * 见到的活动类型枚举。**这里只取「有哪些类型」这一事实，不取任何代码实现**（见 ATTRIBUTION）。
 *
 * ⚠️ 未经本轮复核：该表是否覆盖全部类型、以及它们是否都会出现在 `/api/todos` 的
 *    `todo_list` 里，**都没有验证**。所以下面刻意不给「是否作业」的结论，只给「要不要计入漏检」。
 */
export const TYPES = Object.freeze({
  homework: { label: '作业', countsAsMissing: true },
  exam: { label: '测验', countsAsMissing: true },
  forum: { label: '讨论', countsAsMissing: 'unknown' },
  questionnaire: { label: '问卷', countsAsMissing: 'unknown' },
  survey: { label: '调查', countsAsMissing: 'unknown' },
  vocabulary: { label: '单字', countsAsMissing: 'unknown' },
  lesson: { label: '直播', countsAsMissing: 'unknown' },
  classroom: { label: '课堂互动', countsAsMissing: false },
  material: { label: '课件', countsAsMissing: false },
  online_video: { label: '影片', countsAsMissing: false },
  page: { label: '网页', countsAsMissing: false },
  web_link: { label: '链接', countsAsMissing: false },
  chatroom: { label: '聊天室', countsAsMissing: false },
});

/** 骨架自己的错误：任何 TODO 未完成的入口都抛它，便于上层一眼认出「这是骨架不是实现」。 */
export class FenceNotImplemented extends Error {
  constructor(entry) {
    super(`${entry} 是候选骨架的占位实现（未评审、未接入）。实现前不得挂载。`);
    this.name = 'FenceNotImplemented';
    this.code = 'RADAR_SKELETON_PLACEHOLDER';
    this.entry = entry;
  }
}

/**
 * 给一份 rows 生成围栏元数据。
 *
 * @param rows - `normalizeXzzd()` 之后的待办数组（本包只读，不改）。
 * @param meta - `{ source: 'fast'|'slow'|'diff', degraded: string[], readError: Error|null, at: Date }`。
 * @returns `{ source, count, byType, degraded, complete, explain }`。
 */
// TODO-1：实现。要点：
//   - `complete` 的判定**不能**只看 `readError == null`：fast 模式下端点 403 会让
//     rows 变成 []，而 `readError` 在 index.js 里被吞进了 `xzzd.error`。要一起看。
//   - `byType` 用 TYPES 的 key 归一；**未知类型原样保留**并计入 `unknownTypes`
//     （F-1 的教训：不要假设类型是封闭集合）。
//   - 不要在这里排序或过滤 rows —— 那是 source-campus 的职责，重复实现就是两套口径。
export function fenceOf(_rows, _meta) {
  throw new FenceNotImplemented('fenceOf');
}

/**
 * 把「空列表」解释成三态之一，供「今天」页显式渲染。
 *
 * @param fence - `fenceOf()` 的返回值。
 * @returns `'empty'`（真没有）/ `'failed'`（读失败）/ `'partial'`（部分降级）—— 或抛错。
 */
// TODO-2：实现。要点：
//   - 三态**必须**能在 UI 上区分（r42/r57 记过「静默降级」：工作台照常起、页面照常开，只是没数据）。
//   - `partial` 要能说出「少了哪一类」，否则又回到「有代码没证据」。
export function explainEmpty(_fence) {
  throw new FenceNotImplemented('explainEmpty');
}

/**
 * 判「逐课版有、聚合端点没有」的条目里，哪些才算真漏。
 *
 * @param onlySlow - 只在 slow 里出现的行。
 * @returns `{ countedAsMissing, undecidable, structural }` 三组。
 */
// TODO-3：实现。要点：
//   - **不要**复用 `diffTodos()` 的 `type !== 'classroom'`（r67 的 F-1：那行阈值缺证据）。
//   - `countsAsMissing === 'unknown'` 的类型**不得**计入「漏」，应进 `undecidable` 并让评审裁决。
//   - 这一条是本骨架存在的**主要理由**，实现前不得退化成 `!== 'classroom'`。
export function splitMissing(_onlySlow) {
  throw new FenceNotImplemented('splitMissing');
}

/**
 * 生成一份人可读的围栏摘要（用于「关于数据」或诊断面板）。
 *
 * @param fence - `fenceOf()` 的返回值。
 * @returns 单行中文摘要。
 */
// TODO-4：实现。要点：摘要里必须同时出现「来源（fast/slow）」与「是否完整」，
//   两者缺一就会让「1 个请求」与「全部失败」看起来一样。
export function describeFence(_fence) {
  throw new FenceNotImplemented('describeFence');
}

/** 本包的默认导出只用于让误挂载抛错。 */
export default function apply() {
  throw new FenceNotImplemented('apply');
}
