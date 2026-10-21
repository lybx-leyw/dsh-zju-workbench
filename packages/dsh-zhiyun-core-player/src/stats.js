/**
 * 播放统计：把终稿的块级数据算成「能直接画在进度条上」的数。
 *
 * 移植自 `zhiyun-pro` 的 `lib/fusion/stats.dart`（**同作者项目**，
 * 按本仓 [AGENTS.md](../../../docs/contributing/AGENTS.md) 的规定不计入 ATTRIBUTION）。
 *
 * # 它只做一件事：把终稿读成数
 *
 * 入口只有一个 —— **块级终稿**（`blocks`）。想回读原始字幕、课程接口或网络，
 * 在这里写不出来：没有那个类型的参数，也没有那个 import。
 * 「统计只取终稿」因此是**类型上**的约束，不是注释里的承诺。
 *
 * # 产出三组数据
 *
 * | 产出 | 喂给 |
 * |---|---|
 * | `records` | 一切（每块的角色 / 维度 / 概述 / 时间戳） |
 * | `segments` | **内容进度条**：按时间轴分段 + 角色（颜色）+ 维度 |
 * | `speedBuckets` | **语速热力条**：Δ文本数 ÷ Δ时间戳 |
 * | 四个汇总字段 | 课程信息表 |
 *
 * # 语速算法（`Δ时间戳 ÷ Δ文本数`）
 *
 * 块恰好铺满整节的时间轴，所以「相邻块起点之差」就是上一块之后到这一块开始
 * 的那段时间窗，落在那个窗口里的文本正是这一块自己的正文。于是：
 *
 * ```
 * 语速(i) = 第 i 块的字符数 ÷ (第 i 块起点 − 第 i−1 块起点)
 * ```
 *
 * # 三种「不可估」返回 `null`，**不返回 0**
 *
 * | 情况 | 返回 | 为什么不是 0 |
 * |---|---|---|
 * | 文本数差为 0（纯过渡语 / 空块） | `null` | `0` 会被读成「老师一句话没说」，那是**假的**；`null` 才是「这一格没有信息」 |
 * | 时间戳差 ≤ 0（同毫秒两块 / 时间没往前走） | `null` | 除以 0 得 `Infinity`，除以负数得负语速，两者都把热力图画成噪声 |
 * | 只有一块（没有「相邻」） | 不产生桶 | 没有 Δ 就没有估计，不编造 |
 *
 * 展示层**必须接住**这个 `null` 语义（画成中性底色而不是"最冷"），
 * 否则这里这份克制就白费了。
 *
 * # 消费方
 *
 * 学习页的视频栏把 `toSeekBar()` 的结果画在回放下面。颜色和「估不出来」的
 * 中性底色由那一栏决定；这里仍然只回数。`null` 语速必须保持 `null`。
 */

/** 相邻块合并的间隔阈值（秒）。与知识检索那边的同值，口径要一致。 */
export const STATS_MERGE_GAP_SEC = 15;

/**
 * 统计一个字符数。
 *
 * ⚠️ 用 `[...text].length` 而不是 `text.length`：后者对 emoji 与部分汉字
 * 按 UTF-16 码元计数，"一个字"会算成 2。语速的分母错了整条热力条就歪了。
 */
export function countChars(text) {
  return typeof text === 'string' ? [...text].length : 0;
}

/**
 * 把块级终稿算成分段与热力桶。
 *
 * @param {Array<object>} blocks - 块级终稿。每块至少要有 `startMs` / `endMs` /
 *   `text`（或 `sentences`）/ `role`（`'main'` | `'branch'` | null）/ `facets`。
 * @returns {object} 见文件头「产出三组数据」。
 */
export function computeSectionStats(blocks) {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && Number.isFinite(b.startMs));
  const records = list.map((b, i) => ({
    blockIndex: i,
    startMs: b.startMs,
    endMs: Number.isFinite(b.endMs) ? b.endMs : b.startMs,
    role: b.role ?? null,
    facets: Array.isArray(b.facets) ? b.facets : [],
    summary: b.summary ?? '',
    chars: countChars(textOf(b)),
  }));

  const segments = buildContentSegments(records);
  const speedBuckets = buildSpeedBuckets(records);

  const coveredMs = records.length === 0
    ? 0
    : Math.max(0, records[records.length - 1].startMs - records[0].startMs);
  const totalChars = records.reduce((sum, r) => sum + r.chars, 0);

  // 平均语速：总字符数 ÷ 覆盖总时长（字/秒）。覆盖时长为 0 时给 null，不给 0。
  const averageCharsPerSecond = coveredMs > 0 ? totalChars / (coveredMs / 1000) : null;

  // 主线时长占比：Σ(主线块时长) ÷ 覆盖总时长。role 是单选必填，时长由代码算。
  const mainlineMs = records
    .filter((r) => r.role === 'main')
    .reduce((sum, r) => sum + Math.max(0, r.endMs - r.startMs), 0);
  const mainlineRatio = coveredMs > 0 ? mainlineMs / coveredMs : null;

  // 热力归一分母：全局最大语速。用算好的桶求，两处各求一次会让热力在刷新时跳变。
  const maxCharsPerSecond = speedBuckets.reduce(
    (max, b) => (b.charsPerSecond !== null && b.charsPerSecond > max ? b.charsPerSecond : max),
    0,
  );

  return {
    records,
    segments,
    speedBuckets,
    durationMs: coveredMs,
    totalChars,
    averageCharsPerSecond,
    averageCharsPerMinute: averageCharsPerSecond === null ? null : averageCharsPerSecond * 60,
    mainlineRatio,
    knowledgePointCount: countKnowledgePoints(records),
    exampleCount: records.filter((r) => r.facets.includes('例题')).length,
    maxCharsPerSecond,
  };
}

function textOf(block) {
  if (typeof block.text === 'string') return block.text;
  if (Array.isArray(block.sentences)) return block.sentences.map((s) => s?.text ?? '').join('');
  return '';
}

/**
 * 按**角色**把相邻块合并成分段（内容进度条按它上色）。
 *
 * 合并条件三个都要满足，缺一不可：
 *   1. 角色相同 —— 颜色是按角色取的，角色不同必须断开；
 *   2. 维度集合相同 —— 进度条上还要写第二维，集合不同就得换标签；
 *   3. 时间相邻 —— 间隔不超过 {@link STATS_MERGE_GAP_SEC}。
 *
 * ⚠️ 第 3 条用**已合并段的最后一块**的时间算间隔，不是用段的起点。
 * 用起点比会把三句连续的讲述拆成两条（上游记录过这个坑）。
 */
export function buildContentSegments(records) {
  const out = [];
  for (const r of records) {
    const last = out[out.length - 1];
    const adjacent = last !== undefined
      && (r.startMs - last.lastEndMs) / 1000 <= STATS_MERGE_GAP_SEC;
    const sameShape = last !== undefined
      && last.role === r.role
      && sameFacets(last.facets, r.facets);
    if (last && adjacent && sameShape) {
      last.toBlockIndex = r.blockIndex;
      last.endMs = r.endMs;
      last.lastEndMs = r.endMs;
      last.blockIndexes.push(r.blockIndex);
      continue;
    }
    out.push({
      fromBlockIndex: r.blockIndex,
      toBlockIndex: r.blockIndex,
      startMs: r.startMs,
      endMs: r.endMs,
      // 内部字段：只用来算相邻，不对外承诺
      lastEndMs: r.endMs,
      role: r.role,
      facets: [...r.facets],
      summary: r.summary,
      blockIndexes: [r.blockIndex],
    });
  }
  return out;
}

function sameFacets(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((f) => setB.has(f));
}

/**
 * 语速热力桶：`Δ文本数 ÷ Δ时间戳`（相邻块口径）。
 *
 * 单位是**字/秒**。不可估的桶 `charsPerSecond` 为 `null`（不是 0）。
 */
export function buildSpeedBuckets(records) {
  const out = [];
  for (let i = 1; i < records.length; i += 1) {
    const prev = records[i - 1];
    const cur = records[i];
    const dtMs = cur.startMs - prev.startMs;
    const chars = cur.chars;
    // 两种不可估都返回 null，理由见文件头表格
    const estimable = dtMs > 0 && chars > 0;
    out.push({
      fromBlockIndex: prev.blockIndex,
      toBlockIndex: cur.blockIndex,
      startMs: prev.startMs,
      endMs: cur.startMs,
      chars,
      charsPerSecond: estimable ? chars / (dtMs / 1000) : null,
      charsPerMinute: estimable ? (chars / (dtMs / 1000)) * 60 : null,
    });
  }
  return out;
}

/**
 * 知识点数 = **合并后**的块数。
 *
 * 为什么不直接数块：ASR 会把一段讲述切成好几句，逐块数会得到虚高的"知识点"。
 * 合并规则与 {@link buildContentSegments} 同源（同角色 + 同维度 + 时间相邻）。
 */
export function countKnowledgePoints(records) {
  return buildContentSegments(records).length;
}

/**
 * 把统计映射到进度条的绘制输入（**只回数，不管颜色**）。
 *
 * 颜色是主题的事，不是统计的事 —— 所以这里只给 `role`，
 * 由展示层映射成色。主题改了不必改统计。
 *
 * @param {object} stats - {@link computeSectionStats} 的产物。
 * @param {number} axisMs - 进度条横轴长度（通常就是视频总时长）。
 *   ⚠️ 与 `stats.durationMs` 常常不等：终稿只覆盖有语音的部分，
 *   视频可能还有片头/片尾。所以横轴由调用方显式给定。
 */
export function toSeekBar(stats, axisMs) {
  const axis = axisMs > 0 ? axisMs : stats.durationMs;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // 越界一律夹到 [0,1]：终稿时间轴与视频总时长可能不一致，
  // 夹紧保证画出来的东西永远在条内 —— 宁可某段少画一点，也不让它溢出。
  const segments = stats.segments.map((s) => ({
    from: clamp01(axis > 0 ? s.startMs / axis : 0),
    to: clamp01(axis > 0 ? s.endMs / axis : 0),
    role: s.role,
    facets: s.facets,
    summary: s.summary,
    blockIndexes: s.blockIndexes,
  }));

  const max = stats.maxCharsPerSecond;
  const heat = stats.speedBuckets.map((b) => ({
    from: clamp01(axis > 0 ? b.startMs / axis : 0),
    to: clamp01(axis > 0 ? b.endMs / axis : 0),
    // null 保持 null：展示层画中性底色，绝不画成"最冷"
    heat: b.charsPerSecond === null || max <= 0 ? null : clamp01(b.charsPerSecond / max),
    charsPerSecond: b.charsPerSecond,
  }));

  return { axisMs: axis, segments, heat };
}
