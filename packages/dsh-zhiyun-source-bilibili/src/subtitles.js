/**
 * **字幕：从 B 站的 cue 形状转成本仓的 `subtitles[]`**（纯函数，零 IO）。
 *
 * # 为什么不直接把 B 站 JSON 丢给解析器
 *
 * `dsh-zhiyun-core-parser/src/parser.js` 的 `validateInput()` 对字幕有**硬校验**：
 *
 * ```js
 * for (const line of subtitles)
 *   if (typeof line.text !== 'string'
 *     || !Number.isFinite(line.startMs) || !Number.isFinite(line.endMs)
 *     || line.startMs < 0 || line.endMs < line.startMs)
 *     throw new ParserError('INPUT', '字幕时间区间或文本无效');
 * ```
 *
 * 而 B 站给的是 `{ from, to, content }`（**秒**，浮点，可能缺字段）。
 * 所以这一层必须做**三件事**，一件都不能省：
 *
 * | # | 做什么 | 不做的后果 |
 * | --- | --- | --- |
 * | 1 | 秒 → 毫秒取整 | `Number.isFinite` 过得去，但 `anchor()` 的分窗会因浮点抖动错位 |
 * | 2 | `startMs` 钳到 ≥ 0 | 负值直接 `INPUT` 错，**整节课解析失败** |
 * | 3 | `endMs` 钳到 ≥ `startMs` | 同上报错；B 站确有 `to < from` 的脏数据 |
 *
 * 另外**必须至少留一条**：空字幕数组会让整节课走 `transcript-only` 通道
 * （`slides` 为空时连 vision 都不跑）。那不是错误，但要让调用方知道
 * 「这条视频确实配了字幕轨、只是内容为空」与「根本没有字幕轨」是两回事。
 */

/** 单条字幕的合理上限（秒）。超过 1 小时的 cue 一定是脏数据。 */
export const MAX_CUE_SECONDS = 3600;

/**
 * 把 B 站的一条 cue 转成本仓的字幕行。
 *
 * @param cue - `{ from, to, content }`。
 * @returns `{ startMs, endMs, text }` —— 直接满足 `validateInput()`。
 *          时间非法（非有限、负、超上限）时返回 `null`，由调用方计入丢弃数。
 */
export function cueToSubtitle(cue) {
  const rawFrom = Number(cue?.from);
  const rawTo = Number(cue?.to);
  if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return null;
  if (rawFrom < 0 || rawFrom > MAX_CUE_SECONDS || rawTo > MAX_CUE_SECONDS) return null;
  const startMs = Math.round(rawFrom * 1000);
  // `to` 早于 `from` 是上游脏数据：钳到与 `from` 相等，不丢这条（内容本身有效）。
  const endMs = Math.max(startMs, Math.round(rawTo * 1000));
  return { startMs, endMs, text: String(cue?.content ?? '') };
}

/**
 * 把 B 站的 `cues[]` 整批转成 `subtitles[]`。
 *
 * # 三条处理规则（都是「宁可少一条，不要让整节课失败」）
 *
 * 1. **时间非法的 cue 丢弃** —— 那一条进不了时间轴，留着只会让 `anchor()` 出错。
 * 2. **内容为空白的 cue 丢弃** —— 上游会产出纯空格的 cue（静音段占位）。
 *    注意：`validateInput()` 只要求 `text` 是 `string`，空串**不报错**，
 *    但空串会进 `transcriptWindows()` 的字符预算统计，把分卷切得更碎。
 * 3. **按 `startMs` 稳定排序** —— 上游偶有乱序（多轨合并时）。
 *    排序要**稳定**：同一 `startMs` 的两条保留原相对顺序。
 *
 * @param cues - B 站字幕 `body` 数组。
 * @returns `{ subtitles, dropped, empty }`。
 *          `dropped` 是被规则 1/2 丢掉的数量；`empty` 表示转完一条都不剩。
 */
export function cuesToSubtitles(cues) {
  if (!Array.isArray(cues)) return { subtitles: [], dropped: 0, empty: true };
  const kept = [];
  let dropped = 0;
  for (const cue of cues) {
    const row = cueToSubtitle(cue);
    if (row === null) { dropped += 1; continue; }
    if (row.text.trim() === '') { dropped += 1; continue; }
    kept.push(row);
  }
  // 稳定排序：Array#sort 在 V8 上已稳定，但显式带原序号，避免依赖实现细节。
  const ordered = kept
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.startMs - b.row.startMs || a.index - b.index)
    .map((entry) => entry.row);
  return { subtitles: ordered, dropped, empty: ordered.length === 0 };
}

/**
 * 把逐条字幕拼成一段带时间戳的纯文本（给「没有课件」的口播视频用）。
 *
 * 与 `source-classroom` 的 `getTranscript()` 是同一件事的不同形态：
 * 那边返回**分页**的长文本（`offset` / `maxCharacters` / `nextOffset`），
 * 这里返回**一段**（调用方自己决定要不要分页）。
 *
 * # `everySec` 的语义
 *
 * - `0`（默认）：**每一行都带时间戳** —— 与字幕一一对应，便于核对原话。
 * - `> 0`：按该间隔**聚合**，只在进入新的时间桶时打一次戳；同桶内其余行不带戳。
 *   读数不变、行数骤降（90 分钟的课按 60s 聚合，时间戳从几千个降到几十个）。
 *
 * ⚠️ 早先的实现用 `nextStampMs = stamp + Infinity` 表达「每行都带戳」，
 *    结果第一行之后 `nextStampMs` 变成 `Infinity`，**后续行永远不再带戳**。
 *    现在两个分支各自读得懂：`everySec === 0` 走「每行都打戳」，
 *    `> 0` 走「换桶才打戳」。
 *
 * @param subtitles - 已规范化的字幕行。
 * @param options.everySec - 时间戳聚合间隔（秒）；`0` 表示每行都带。
 * @returns `{ text, lines }`。
 */
export function transcriptOf(subtitles, { everySec = 0 } = {}) {
  const rows = Array.isArray(subtitles) ? subtitles : [];
  const clock = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };
  const bucketMs = Number.isFinite(everySec) && everySec > 0 ? everySec * 1000 : 0;
  const lines = [];
  /** 上一次打过戳的时间桶；`null` = 还没打过。`bucketMs === 0` 时不用它。 */
  let lastBucket = null;
  for (const row of rows) {
    const at = Number(row?.startMs) || 0;
    const text = String(row?.text ?? '');
    if (bucketMs > 0) {
      const bucket = Math.floor(at / bucketMs);
      if (bucket === lastBucket) { lines.push(text); continue; }
      lastBucket = bucket;
      lines.push(`[${clock(bucket * bucketMs)}] ${text}`);
    } else {
      lines.push(`[${clock(at)}] ${text}`);
    }
  }
  return { text: lines.join('\n'), lines };
}
