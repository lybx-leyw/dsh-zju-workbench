/**
 * 预计看完时间：`(总时长 − 剩余要跳过的支线) ÷ 当前倍率`。
 *
 * # 三个容易被算错的地方
 *
 * ## 1. 只扣**还没播到**的支线
 *
 * 需求写的是「总时长 − 跳过时长」，但直接拿全片支线总和去减是错的：
 * 如果已经播过 30 分钟、其中含 5 分钟支线，那 5 分钟**已经花掉了**（当时没开
 * 跳过，或者开了但用户手动拖回去看过）。再扣一次等于宣称"未来的时间可以
 * 退回过去"。
 *
 * 所以起点是**剩余时长**（`总长 − 当前位置`），再从中扣掉「当前位置之后、
 * 且被开启跳过」的支线段。
 *
 * ## 2. 已经播过的时间不参与除法
 *
 * 「预计还要多久」= 剩余时长 ÷ 倍速。如果把已播的也除以倍速再加回来，得到的是
 * 「从头按这个倍速看完整节课要多久」—— 那是另一个问题，而且答案会随时间跳变
 * （用户每拖一次进度条就变），读起来像坏了。
 *
 * ## 3. 倍率是从现在起的倍率
 *
 * 用当前 `playbackRate`，不预测"用户接下来会不会再调"。这是唯一诚实的假设：
 * 一旦用户改了速度，这个数立刻重算。
 */

/** 默认跳过的角色。与 `skip-branch.js` 的 `SEGMENT_ROLE.BRANCH` 一致。 */
const BRANCH_ROLE = 'branch';

/**
 * 计算剩余可播放时长（毫秒），只扣**当前位置之后**的支线。
 *
 * @param axisMs - 总时长。
 * @param atMs - 当前位置。
 * @param segments - `toSeekBar()` 的 `segments`（`from/to` 是 0–1 比例）。
 * @param skipBranch - 是否开启跳支线。关闭时不扣任何东西。
 * @returns `{ remainingMs, skippedMs }`：
 *   - `remainingMs` 扣完支线后还要花的时间；
 *   - `skippedMs` 本次扣掉的支线时长（便于 UI 显示"省了多久"）。
 */
export function remainingPlayMs(axisMs, atMs, segments, skipBranch) {
  const axis = Number(axisMs);
  const at = Number(atMs);
  if (!Number.isFinite(axis) || axis <= 0) return { remainingMs: 0, skippedMs: 0 };
  const from = Number.isFinite(at) ? Math.min(axis, Math.max(0, at)) : 0;

  let remaining = axis - from;
  let skipped = 0;

  if (skipBranch && Array.isArray(segments)) {
    for (const segment of segments) {
      if (!segment || segment.role !== BRANCH_ROLE) continue;
      const start = Number(segment.from) * axis;
      const end = Number(segment.to) * axis;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      // 只取与 [from, axis] 相交的那部分：
      // - 整段在当前位置之前 → 已经播过了，不扣
      // - 跨越当前位置 → 只扣后半截
      const overlapStart = Math.max(start, from);
      const overlapEnd = Math.min(end, axis);
      if (overlapEnd <= overlapStart) continue;
      skipped += overlapEnd - overlapStart;
    }
  }

  // 夹到 0：浮点累积或脏数据不该算出负的剩余时间。
  remaining = Math.max(0, remaining - skipped);
  return { remainingMs: remaining, skippedMs: skipped };
}

/**
 * 预计还要多久看完。
 *
 * @param axisMs - 总时长。
 * @param atMs - 当前位置。
 * @param rate - 当前倍率（`playbackRate`）。
 * @param segments - 分段；没有传就不扣支线。
 * @param skipBranch - 是否跳支线。
 * @returns 毫秒（**实际经过的时间**，不是视频时间轴上的时长）。
 *
 * 关键：除以倍率。2 倍速下 10 分钟的视频只要 5 分钟 —— 这是这个功能的意义所在。
 */
export function estimateRemainingMs(axisMs, atMs, rate, segments, skipBranch) {
  const { remainingMs, skippedMs } = remainingPlayMs(axisMs, atMs, segments, skipBranch);
  const speed = Number(rate);
  // 倍率非法或为 0 时当作 1：宁可显示"不加速"的估计，也不要 `Infinity`/`NaN`。
  const divisor = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return { remainingMs, estimateMs: remainingMs / divisor, skippedMs };
}

/**
 * 毫秒 → 人话时长。
 *
 * 与播放器上的 `formatTime`（`mm:ss`）不一样，这里要的是**粗粒度**：
 * 「还要看 1 小时 23 分」比「还要看 83:27」好读得多 —— 预估本来就是估算，
 * 精确到秒是假精度。
 *
 * | 时长 | 输出 |
 * |---|---|
 * | < 1 分钟 | `不到 1 分钟` |
 * | < 1 小时 | `23 分钟` |
 * | ≥ 1 小时 | `1 小时 23 分` |
 * | 恰好整小时 | `2 小时` |
 */
export function formatEta(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total <= 0) return '不到 1 分钟';
  // ⚠️ 用 `floor` 而非 `round`：剩余 30 秒时 round 会进位成「1 分钟」，
  // 而人读到"还要 1 分钟"会以为还得等一分钟。宁可说"不到 1 分钟"。
  // 但**超过 1 分钟之后**用 round —— 剩 83.9 分钟说"1 小时 24 分"比"1 小时 23 分"
  // 更接近真实，且没有人会因为差 6 秒而困惑。
  const floorMinutes = Math.floor(total / 60_000);
  if (floorMinutes < 1) return '不到 1 分钟';
  const minutes = Math.round(total / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/**
 * 「省了多久」的文案。**只有真的省了才返回**，否则 `null`。
 *
 * 不省的时候显示「省了 0 分钟」是噪声 —— 那会让整行字变长、注意力分散，
 * 而信息量为零。
 */
export function formatSaved(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 60_000) return null;
  return `省 ${formatEta(total)}`;
}
