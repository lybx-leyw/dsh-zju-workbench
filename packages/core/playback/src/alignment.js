/**
 * 回放时间对齐：**三态契约** + 投影。
 *
 * # 这个文件只做两件事
 *
 * 1. **定义「对齐结果」的三种形状**，并拒绝第四种；
 * 2. **把已知偏移投影到某个时刻**（`resolveAt`）。
 *
 * 它不采音、不调模型、不读 DOM、不写盘。索引怎么来、Δ 从哪测出来，
 * 是调用方的事（`probe.js` 是其中一种离线测法）。
 *
 * # 为什么结果必须有三种状态，而不是「成功 / 失败」
 *
 * 只有两态时，算法层会被人为逼回「必须给个数」：一旦某个位置**只定位到文字、
 * 却没有真实语音边界**，它只能二选一 —— 要么编一个数（插值、按字数估时，
 * 这些正是我们明确不要的），要么塞进 `failed` 里。塞进失败之后，UI 就再也
 * 分不出「这句压根没匹配上」和「我知道它在哪，只是还差半句才能定时」——
 * 而后者是**可恢复的**：再听一小段就成。
 *
 * 所以：
 *
 * | state | 含义 | UI 该做什么 |
 * |---|---|---|
 * | `matched` | 偏移已确定 | 应用，可显示 |
 * | `located_only` | 位置找到、时间不定 | 说「正在等下一句」，**不应用** |
 * | `refused` | 拒绝 | 保留原偏移，给出原因 |
 *
 * # 偏移的符号约定（写死在这里，别再各处各定义）
 *
 * `offsetMs` = **字幕时间轴相对播放时钟的偏差**：
 *
 * ```
 * 查表用的轴 = 播放时刻 + offsetMs
 * ```
 *
 * 于是「字幕显得滞后」（时间戳比真实超前 d）对应 `offsetMs = +d`。
 * 直觉校验：滞后时，要看到正确的那句，得往**大的**时间戳方向找，所以是加。
 *
 * 反向的写法（`cueStart − position`）在别处也见过，但它一旦和这里混用，
 * 症状是「偏移加了两倍」或「方向反了」，且两处都自认为对。所以：
 * **本仓只有这一种约定**，符号反了请在适配层取负，不要改这里。
 *
 * # 与 `indexAt` 的关系
 *
 * `video-panel.jsx` 里的 `indexAt` 取「**最后一条起点不晚于 t**」的条目 ——
 * 要的是「当时正在讲什么」，不是「离得最近的那句」。本文件的 `indexAt`
 * 保持**完全相同的语义**（同样的循环、同样的 `-1` 约定），只是多了
 * `offsetMs` 这一个入参。改语义会让字幕看起来永远领先一句，别改。
 */

/**
 * 拒绝的原因分类。
 *
 * 用固定枚举而不是自由字符串：调用方要能 `switch`，也要能统计
 * 「这周有多少次是 `ambiguous`」—— 自由文本做不到这两件事。
 */
export const REFUSAL = {
  /** 语料里找不到任何相似片段。 */
  NO_SIMILAR_TEXT: 'no_similar_text',
  /** 找到不止一处，且没有明显更强的。 */
  AMBIGUOUS: 'ambiguous',
  /** 各处结论互相矛盾（多段投票不能压过一段明确反对）。 */
  CONFLICTING_OFFSETS: 'conflicting_offsets',
  /** 入参形状不对（缺字段、时间非有限数、区间倒挂）。 */
  INVALID_INPUT: 'invalid_input',
};

/** 三个 state 的合法值。导出让消费方做穷尽检查。 */
export const ALIGNMENT_STATE = Object.freeze({
  MATCHED: 'matched',
  LOCATED_ONLY: 'located_only',
  REFUSED: 'refused',
});

/**
 * 造一个「偏移已确定」的结果。
 *
 * @param offsetMs - 见文件头的符号约定。
 * @param evidence - 可选，用来解释「凭什么」。至少含 `score`（0–1）；
 *   多段证据时可带 `support`（贡献的独立采音段数）与 `samples`（各段各自算出的偏移）。
 * @returns 冻结的 `matched` 结果。
 */
export function matched(offsetMs, evidence = undefined) {
  if (!Number.isFinite(offsetMs)) {
    throw new TypeError('matched() 需要有限的 offsetMs；拿不到时间就应当是 locatedOnly 或 refused');
  }
  const result = { state: ALIGNMENT_STATE.MATCHED, offsetMs };
  if (evidence !== undefined) result.evidence = { ...evidence };
  return Object.freeze(result);
}

/**
 * 造一个「位置找到、时间不定」的结果。
 *
 * `awaiting` 是这个状态**唯一的行动指引**：告诉调用方「还差什么」。
 * 上游把它做成了 `{ start, text }` —— 下一条字幕的起点与原文，这样重试时
 * 不必从头再听。我们没有上游那种"下一条字幕"概念时，可以只给 `text`。
 *
 * @param locatedAt - `{ text, score, cueIndex? }`：**定位到了什么**。必须给，
 *   否则这个状态和 `refused` 没有区别。
 * @param awaiting - 可选。`{ start?, text?, reason? }`：还缺什么才能定时。
 */
export function locatedOnly(locatedAt, awaiting = undefined) {
  if (locatedAt === undefined || locatedAt === null) {
    throw new TypeError('locatedOnly() 必须给出 locatedAt：没有定位结果就该用 refused');
  }
  const result = { state: ALIGNMENT_STATE.LOCATED_ONLY, locatedAt: { ...locatedAt } };
  if (awaiting !== undefined) result.awaiting = { ...awaiting };
  return Object.freeze(result);
}

/**
 * 造一个「拒绝」的结果。
 *
 * @param reason - 取 `REFUSAL` 里的值。允许自由字符串（外部来源可能给出
 *   我们没预料到的原因），但内置的四种请一律用常量。
 */
export function refused(reason, detail = undefined) {
  if (typeof reason !== 'string' || reason === '') {
    throw new TypeError('refused() 需要非空的 reason');
  }
  const result = { state: ALIGNMENT_STATE.REFUSED, reason };
  if (detail !== undefined) result.detail = { ...detail };
  return Object.freeze(result);
}

/**
 * 校验一个结果是否符合契约。
 *
 * 常驻在测试里跑，也导出给消费方在边界处自查。**它会拒绝「看起来能跑」的
 * 半成品**：例如一个 `matched` 但 `offsetMs` 是 `NaN`，或者一个
 * `located_only` 却连 `locatedAt` 都没有的。
 *
 * @returns `null` 表示合法；否则返回一句人话说明哪里不对。
 */
export function validateResult(result) {
  if (result === null || typeof result !== 'object') return '结果必须是对象';
  const { state } = result;
  if (state === ALIGNMENT_STATE.MATCHED) {
    if (!Number.isFinite(result.offsetMs)) return 'matched 必须带有限的 offsetMs';
    return null;
  }
  if (state === ALIGNMENT_STATE.LOCATED_ONLY) {
    if (result.offsetMs !== undefined) return 'located_only 不得携带 offsetMs（那会诱导调用方直接应用）';
    if (result.locatedAt === undefined || result.locatedAt === null) return 'located_only 必须带 locatedAt';
    return null;
  }
  if (state === ALIGNMENT_STATE.REFUSED) {
    if (typeof result.reason !== 'string' || result.reason === '') return 'refused 必须带非空 reason';
    if (result.offsetMs !== undefined) return 'refused 不得携带 offsetMs';
    return null;
  }
  return `未知 state：${String(state)}`;
}

/**
 * 在**已加过偏移的轴**上找「最后一条起点不晚于 `axisMs`」的条目。
 *
 * 与 `video-panel.jsx` 的 `indexAt` **语义完全相同**（含 `-1` 约定），
 * 只是抽到这里好让两边共用一份、不会各自漂移。
 *
 * @param items - 按 `key` 升序排列（不排序，调用方保证；`getSubtitles` 已按
 *   `startMs` 排序，`getSlides` 同理）。未排序时结果无意义。
 * @param axisMs - **已加偏移**的时刻。
 * @param key - 取哪个字段当起点，默认 `startMs`。
 * @returns 命中下标；`-1` 表示「早于第一条」，调用方据此显示"还没开始"
 *   而不是硬套第 0 条。
 */
export function indexAt(items, axisMs, key = 'startMs') {
  if (!Array.isArray(items) || !Number.isFinite(axisMs)) return -1;
  let found = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (Number(items[i]?.[key]) <= axisMs) found = i;
    else break;
  }
  return found;
}

/**
 * 把「播放时刻」投影成「该显示哪一条」。
 *
 * 这是整个包的**主入口**：字幕行与课件页都用它，确保两者共用同一个
 * 「时间轴是唯一真源」的约定（见 `video-panel.jsx` 文件头的约定 2）。
 *
 * 注意它返回的是**投影结果**，不是对齐结果 —— 这里不需要三态：偏移是入参，
 * 不是它要解的东西。三态属于「求偏移」的那一层。
 *
 * @param items - 已按起点升序。
 * @param videoMs - `<video>.currentTime * 1000`。
 * @param offsetMs - 见文件头符号约定；缺省 0。
 * @param key - 起点字段名。
 * @returns `{ index, item, axisMs }`；`index` 为 `-1` 时 `item` 是 `null`。
 */
export function resolveAt(items, videoMs, offsetMs = 0, key = 'startMs') {
  const safeVideo = Number.isFinite(videoMs) ? videoMs : 0;
  const safeOffset = Number.isFinite(offsetMs) ? offsetMs : 0;
  const axisMs = safeVideo + safeOffset;
  const index = indexAt(items, axisMs, key);
  return {
    index,
    item: index >= 0 ? items[index] : null,
    axisMs,
  };
}
