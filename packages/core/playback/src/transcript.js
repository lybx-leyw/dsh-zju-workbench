/**
 * 字幕轨：决定**播放器上该显示哪一句、时间轴该画哪几段**。
 *
 * # 它解决的问题
 *
 * `video-panel.jsx` 现在的字幕直接取 `content.subtitles.items` —— 那是智云
 * 语音识别的**原始碎片**。真实一节课（`course 86582 / sub 1979657`，915 条）
 * 的前四条是：
 *
 * ```
 * 5s    "行。"
 * 24s   "是。"
 * 34s   "嗯。"
 * 56s   "是嗯。"
 * ```
 *
 * 而同一门课的「学习」栏读的是 `core-parser` 的**清理终稿**：句子带
 * `startMs/endMs`（`core.js:92`），按比例拆句也在原区间内插值
 * （`parser.js:116-120`）。**同一节课、两块屏，一块是"行。""嗯。"，
 * 一块是连贯的句子。** 这是回放的观感问题，不是时间对齐问题。
 *
 * # 两条轨，一个选择
 *
 * | 轨 | 来源 | 特征 |
 * |---|---|---|
 * | `cleaned` | 终稿 `sentences[]` | 句子完整、有标点；**可能不存在**（没跑过解析） |
 * | `raw` | `subtitles.items` | 一定存在；碎片、无标点、含 ASR 噪声 |
 *
 * `resolveTrack()` **永远返回一条可用的轨**，并如实说明是哪一条。
 * 调用方必须把 `track.kind` 显示出来 —— 「现在看到的是清洗后的」和
 * 「还没有清洗，只能看原始碎片」是两种不同的可信度，不能长得一样。
 *
 * # 为什么清洗后的句子必须验证时间
 *
 * 终稿的句子时间是从原始字幕派生的（`core.js:92` 直接沿用 `line.startMs`），
 * 但 `parser.js` 拆句时用**比例插值**（`span * ratioFrom`）。比例插值的前提是
 * 「语速在这条字幕内均匀」，这在真实语流里只是近似。所以清洗句子之后**不能
 * 无条件相信它的时间**，要能表达第三种状态：
 *
 * | state | 含义 | 字幕层怎么画 |
 * |---|---|---|
 * | `matched` | 时间可用 | 正常高亮 |
 * | `located_only` | 文字有、时间不可信 | 显示但**不参与高亮**（灰） |
 * | `refused` | 不可用 | 不显示 |
 *
 * 这不是为自己的洁癖写的：如果硬把插值出来的时间当确定值高亮，用户会看到
 * 句子在说话前就跳出来了，而界面上没有任何东西说明「这条时间是算的」。
 */

/** 轨的种类。 */
export const TRACK_KIND = Object.freeze({
  /** 清洗后的句子（终稿）。 */
  CLEANED: 'cleaned',
  /** 原始 ASR 碎片。 */
  RAW: 'raw',
});

/**
 * 把碎片行合并成**可读的整句字幕**。
 *
 * # 为什么必须有这一步
 *
 * `resolveTrack()` 拿到的 `sentences` 来自 `core-parser`：它**逐行纠错**，
 * 但**不合并**（`core.js:72` 就是 `rawLines.map(...)`，一条字幕行一条 sentence）。
 * 真实一节课 1343 条字幕行 → 1343 条 sentence。于是即使标着"清洗后"，
 * 用户看到的仍然是：
 *
 * ```
 * 00:17  嗯，三，第二个。嗯，对。行行行。嗯嗯嗯
 * 00:26  不行，说。你说那个情况下，都高速还是还
 * ```
 *
 * 纠错只修了字，没有修"一句话被切成十段"这件事。而**字幕的可读性来自成句**，
 * 不是来自每个字都对。所以这里做合并：相邻碎片在**时间接近 + 总长不超阈值**
 * 时并成一条，遇到句末标点且已经够长就断开。
 *
 * # 阈值
 *
 * | 参数 | 默认 | 为什么 |
 * |---|---|---|
 * | `maxChars` | 34 | 一条字幕超过这个长度，在画面上会折成三行、挡住画面 |
 * | `maxGapMs` | 800 | 停顿超过 0.8 秒就是两句话，并起来会读错语气 |
 * | `maxDurationMs` | 12000 | 一条字幕挂太久会让人以为卡住 |
 * | `minChars` | 8 | 太短的段（"哎。"）单独成条会闪，尽量并入邻居 |
 *
 * 时间不可信的条目（`located_only`）**不参与合并**，各自成条 —— 它们的时间
 * 本来就不可靠，合并会把不可靠传给别人。
 *
 * @param lines - `resolveTrack()` 的 `lines`。
 * @param options - 覆盖上面的阈值。
 * @returns 新的行数组，形状与输入一致（`text/startMs/endMs/state`），
 *   但相邻碎片已合并。
 */
export function buildCues(lines, options = {}) {
  const { maxChars = 34, maxGapMs = 800, maxDurationMs = 12_000, minChars = 8 } = options;
  if (!Array.isArray(lines)) return [];

  const cues = [];
  /** 当前正在拼的这条；`null` 表示下一条要新开。 */
  let open = null;

  const flush = () => {
    if (open === null) return;
    cues.push({
      text: open.parts.join(''),
      startMs: open.startMs,
      endMs: open.endMs,
      state: open.state,
    });
    open = null;
  };

  for (const line of lines) {
    const text = typeof line?.text === 'string' ? line.text : '';
    if (text === '') continue;
    const startMs = line.startMs;
    const endMs = Number.isFinite(Number(line.endMs)) ? Number(line.endMs) : startMs;

    // 时间不可信的条目：自成一条，既不吸收别人也不被吸收。
    if (line.state !== 'matched' || !Number.isFinite(startMs)) {
      flush();
      cues.push({ text, startMs, endMs, state: line.state ?? 'located_only', noisy: line.noisy === true });
      continue;
    }

    if (open === null) {
      open = { parts: [text], startMs, endMs, state: 'matched' };
      continue;
    }

    const gap = startMs - open.endMs;
    const mergedLength = open.parts.join('').length + text.length;
    const mergedDuration = endMs - open.startMs;
    const openText = open.parts.join('');
    // 上一段已经以句末标点收尾、且长度够 -> 不并（那是完整的一句）
    const openFinished = /[。！？!?…]$/.test(openText) && openText.length >= minChars;

    if (gap > maxGapMs || mergedLength > maxChars || mergedDuration > maxDurationMs || openFinished) {
      flush();
      open = { parts: [text], startMs, endMs, state: 'matched' };
      continue;
    }
    open.parts.push(text);
    open.endMs = Math.max(open.endMs, endMs);
  }
  flush();

  // 短尾回并：最后一条如果太短（"嗯。"这种），单独成条会在画面上闪一下。
  // 并回上一条 —— 但**只并一次**：连着并会把这个尾部一路吞到开头，
  // 而那些条之间可能隔着几十秒的空档（"嗯。"→ 40 秒后 →"对。"），
  // 并起来就是把两段不相干的话粘成一句。
  if (cues.length >= 2) {
    const tail = cues[cues.length - 1];
    const prev = cues[cues.length - 2];
    const gap = tail.startMs - prev.endMs;
    const mergeable = tail.text.length < minChars
      && prev.text.length + tail.text.length <= maxChars
      && tail.state === 'matched' && prev.state === 'matched'
      && Number.isFinite(gap) && gap <= maxGapMs;
    if (mergeable) {
      cues.splice(-2, 2, {
        text: prev.text + tail.text,
        startMs: prev.startMs,
        endMs: Math.max(prev.endMs, tail.endMs),
        state: 'matched',
      });
    }
  }

  return cues;
}

/**
 * 判断一条原始字幕是不是「尾噪」。
 *
 * 真实案例：`course 86582 / sub 1979657` 的最后一条是
 * `{ startMs: 6965000, endMs: 9345000, text: '对。' }` —— **一条跨 39.7 分钟
 * 的条目**。老师 6965 秒就讲完了（之后是答疑/等待），但 ASR 把麦一直开着，
 * 于是最后一条把 `endMs` 撑到了录像末尾。
 *
 * 它不该被删（那是篡改数据），但**绝不能进统计与进度条**：一条 40 分钟的
 * "对。" 会把时长分母、末段语速、时间轴右端全拉歪。
 *
 * 判定用两个条件同时成立，宁可漏也不误杀：
 *   - 时长超过 `maxDurationMs`（默认 5 分钟，远长于任何一句话）；
 *   - **或者** 时长超过中位时长的 `maxRatio` 倍（默认 200 倍）。
 *
 * @returns `true` 表示「这条可疑，别拿去算时间」。
 */
export function isTailNoise(line, stats) {
  const duration = Number(line?.endMs) - Number(line?.startMs);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (duration > (stats?.maxDurationMs ?? 300_000)) return true;
  const median = stats?.medianDurationMs;
  if (Number.isFinite(median) && median > 0 && duration > median * (stats?.maxRatio ?? 200)) return true;
  return false;
}

/**
 * 从原始字幕算出尾噪判定要用的两个基数。
 *
 * 只统计「时长有限且为正」的条目；中位数用中位数而不是均值，因为
 * 一条 40 分钟的离群值会把均值直接拉垮（均值对离群值不稳健，这正是
 * 本函数存在的理由）。
 */
export function noiseStats(lines) {
  const durations = (Array.isArray(lines) ? lines : [])
    .map((line) => Number(line?.endMs) - Number(line?.startMs))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const medianDurationMs = durations.length === 0
    ? Number.NaN
    : (durations.length % 2 === 1
      ? durations[(durations.length - 1) / 2]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);
  return { medianDurationMs };
}

/**
 * 把终稿句子整理成字幕轨条目。
 *
 * 只接受**时间自洽**的句子：`startMs` 有限、`endMs` 不早于 `startMs`。
 * 时间不可用的句子不丢，而是标 `state: 'located_only'` —— 文字还在，
 * 只是不参与高亮。丢掉它们等于把清洗成果扔掉一半。
 */
function fromSentences(sentences) {
  const out = [];
  for (const sentence of Array.isArray(sentences) ? sentences : []) {
    const text = typeof sentence?.text === 'string' ? sentence.text.trim() : '';
    if (text === '') continue;
    const startMs = Number(sentence?.startMs);
    const endMs = Number(sentence?.endMs);
    const timed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
    out.push({
      text,
      startMs: timed ? startMs : null,
      endMs: timed ? endMs : null,
      state: timed ? 'matched' : 'located_only',
    });
  }
  return out;
}

/**
 * 把原始碎片整理成字幕轨条目。尾噪条目**降级而不删除**。
 */
function fromSubtitles(lines) {
  const stats = noiseStats(lines);
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = typeof line?.text === 'string' ? line.text.trim() : '';
    if (text === '') continue;
    const startMs = Number(line?.startMs);
    const endMs = Number(line?.endMs);
    if (!Number.isFinite(startMs)) continue;
    const noisy = isTailNoise(line, stats);
    out.push({
      text,
      startMs,
      endMs: Number.isFinite(endMs) ? endMs : startMs,
      // 尾噪条目标成 located_only：它仍然显示（用户需要看见原文），
      // 但不参与"正在讲哪一句"的高亮，也不进时间轴。
      state: noisy ? 'located_only' : 'matched',
      noisy,
    });
  }
  return out;
}

/**
 * 选一条轨。
 *
 * 优先级：**有清洗句子就用清洗句子**；没有才退回原始碎片。
 * 这个顺序不能反 —— 反过来等于"有干净数据却去显示脏数据"。
 *
 * @param sentences - 终稿 `result.sentences`；没跑过解析时是 `undefined`。
 * @param subtitles - `content.subtitles.items`。
 * @returns `{ kind, lines, reason }`；`kind` 必须是 `TRACK_KIND` 里的值，
 *   调用方据此显示可信度说明。
 */
export function resolveTrack(sentences, subtitles) {
  const cleaned = fromSentences(sentences);
  if (cleaned.length > 0) {
    return {
      kind: TRACK_KIND.CLEANED,
      // 纠错只修字、不修「一句话被切成十段」—— 所以这里必须再合并一次，
      // 否则标签写着"清洗后"、用户看到的还是碎片（真实截图就是这样）。
      lines: buildCues(cleaned),
      reason: sentences.length === cleaned.length
        ? 'cleaned'
        : 'cleaned-partial',
    };
  }
  const raw = fromSubtitles(subtitles);
  return { kind: TRACK_KIND.RAW, lines: buildCues(raw), reason: raw.length > 0 ? 'no-sentences' : 'empty' };
}

/**
 * 在**已加偏移**的轴上找当前该高亮的那一句。
 *
 * 与 `video-panel.jsx` 的 `indexAt` 语义相同（最后一条起点不晚于 t），
 * 但**跳过 `located_only`**：时间不可信的句子不能抢高亮，否则用户会看到
 * 一句话在真正讲到之前就亮起来。
 *
 * @returns 命中下标；`-1` 表示「还没开始」。
 */
export function activeIndex(lines, axisMs) {
  if (!Array.isArray(lines) || !Number.isFinite(axisMs)) return -1;
  let found = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line?.state !== 'matched') continue;
    if (Number(line.startMs) <= axisMs) found = i;
    else break;
  }
  return found;
}

/**
 * 把字幕轨投影成「烧在播放器底部的字幕条」要画的东西。
 *
 * # 为什么字幕要"烧"进播放器
 *
 * 现在字幕是右栏一个独立列表，视频在左边或上面。用户看视频时眼睛在视频上，
 * 字幕在右栏 —— 而说话内容跟着视频时间在变，**视线不在那里就等于没有字幕**。
 * 真正该发生的是：字幕条贴在视频画面底部，和 `<video>` 同一个格子。
 *
 * 这个函数只算**该显示哪一行**，不碰 DOM、不碰时间轴事件。
 *
 * @param lines - `resolveTrack()` 的产出。
 * @param videoMs - `<video>.currentTime * 1000`。
 * @param offsetMs - 轴上偏移；本仓当前实测为 0（`临时计划.md` 的 H-1）。
 * @returns `{ index, line, hidden, leadMs }`：
 *   - `hidden` 为 `true` 时不该渲染字幕条（没讲到第一条 / 中间有空档）；
 *   - `leadMs` 是「距离下一句还有多久」，用于空档期淡化；
 *   - `line` 为 `null` 表示没有可显示的行。
 */
export function burnLine(lines, videoMs, offsetMs = 0) {
  const axisMs = (Number.isFinite(videoMs) ? videoMs : 0) + (Number.isFinite(offsetMs) ? offsetMs : 0);
  const index = activeIndex(lines, axisMs);
  if (index < 0) {
    // 还没讲到第一句：显示"第一句将要说的内容"没有意义（会提前剧透），
    // 也不显示空条 —— 让调用方决定是否要提示"还没开始"。
    return { index: -1, line: null, hidden: true, leadMs: null, axisMs };
  }
  const line = lines[index];
  // 当前句已结束、下一句还没开始 → 这段是空档（老师咳嗽、翻页、沉默）。
  // 空档期继续挂着上一句，观感上比闪成空白好；但要能算出还有多久到下一句，
  // 让调用方可以淡化。
  const endMs = Number(line?.endMs);
  const nextStart = Number(lines[index + 1]?.startMs);
  const inGap = Number.isFinite(endMs) && axisMs > endMs;
  const leadMs = inGap && Number.isFinite(nextStart) ? nextStart - axisMs : null;
  return { index, line, hidden: false, leadMs, axisMs };
}

/**
 * 把字幕轨整理成「每句一段」的时间轴色带输入。
 *
 * 用途：进度条下方那条细带，显示「哪里有人在说话、哪里有长空档」。
 * 与 `core-player` 的 `speedBuckets` 不同 —— 那个按**块**算语速，这个是
 * 按**句**算有/无，粒度更细，且不依赖终稿是否已生成。
 *
 * @param lines - `resolveTrack()` 的产出。
 * @param axisMs - 横轴总长（应来自 `<video>.duration`，不是录像元数据）。
 * @returns `{ from, to, state }[]`，`from/to` 是 0–1 比例，已夹紧、已排序、
 *   已合并重叠段。`state` 直接沿用行的 `state`（`located_only` 会画灰）。
 */
export function speechBands(lines, axisMs) {
  if (!Array.isArray(lines) || !Number.isFinite(axisMs) || axisMs <= 0) return [];
  const bands = [];
  for (const line of lines) {
    const start = Number(line?.startMs);
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(Number(line?.endMs)) ? Number(line.endMs) : start;
    if (end < start) continue;
    const from = clamp01(start / axisMs);
    const to = clamp01(end / axisMs);
    if (to <= from) continue;
    bands.push({ from, to, state: line.state ?? 'matched', noisy: line.noisy === true });
  }
  bands.sort((a, b) => a.from - b.from);
  // 合并重叠/相接的同状态段，避免相邻碎片画成一堆 1px 竖线。
  const merged = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.from <= last.to + 1e-6 && last.state === band.state && last.noisy === band.noisy) {
      last.to = Math.max(last.to, band.to);
    } else {
      merged.push({ ...band });
    }
  }
  return merged;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
