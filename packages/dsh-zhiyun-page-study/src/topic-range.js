/**
 * 知识点 → 时间区间的反映射。
 *
 * # 它解决什么
 *
 * 播放器现在只知道「主线 / 支线」这两级（来自终稿的 `tag.role`）。但用户
 * 真正关心的是**这节课讲到哪个知识点了** —— 那是比主线更高一级的结构，
 * 由讲义包（`dsh-zhiyun-core-lecture`）从课件标题 + 分段梳理建出来。
 *
 * 这条链路是：
 *
 * ```
 * 讲义 chapters[].topics[]        知识点，带 blockIndexes（块序号）
 *   → result.blocks[i].startMs    块序号 → 时间
 *   → 知识点的时间区间
 *   → 播放到 t 时落在哪个知识点
 * ```
 *
 * # 三个必须处理的情况
 *
 * ## 1. 知识点之间有空隙
 *
 * 块的 `startMs` 是「这块开始讲」，不是「上一块结束」。相邻知识点之间可能
 * 隔着老师停顿、翻页、读课件的时间。**不能把空隙算给任一知识点** ——
 * 那会让「当前知识点」在没讲话的时候也显示着上一个。
 *
 * 处理：用**每块的 `endMs`**（不是下一块的 `startMs`）作为区间终点。
 * `endMs` 之后的空隙不属于任何知识点，显示为空。
 *
 * ## 2. 一个块被多个知识点引用
 *
 * `tree.assignments` 的注释明确说过「一个块落在两个节点」是不该发生但类型上
 * 可见的事。这里取**第一个**（按章、按知识点的顺序），并记 `overlap` 标记，
 * 不静默合并 —— 那是数据问题，应该能被查出来。
 *
 * ## 3. 知识点没有块
 *
 * 树里包含「本次课没讲到」的知识点（`isCovered` 为假），它们的
 * `blockIndexes` 是空数组。**跳过它们** —— 没有时间就没有区间。
 *
 * # 为什么按块而不是按页
 *
 * 块的 `startMs` 来自终稿（清洗后的句子时间），比课件的 `createdSec` 更贴近
 * 「老师讲到这一刻」。而 `anchor.tSec` 是讲义自己的锚点，用途是「一键回家」，
 * 精度只到秒，且只在 `own[0]` 存在时才有值。
 */

/** 默认参数。 */
export const TOPIC_RANGE_DEFAULTS = Object.freeze({
  /**
   * 相邻知识点之间小于它的空隙，视为同一段。
   *
   * ⚠️ **默认为 0（不合并）**，这是刻意的。
   *
   * 最初设成 2000ms 的想法是"别碎成一堆毫秒级区间"，但实测立刻暴露问题：
   * 块与块首尾相接时空隙**恰好是 0**（`endMs` 与下一块 `startMs` 相同），
   * 于是整节课的知识点全被合并成一段 —— 那正好毁掉这个功能的意义
   * （要看到"现在讲到哪个知识点"）。
   *
   * 知识点是**用户要看的层级**，不该为"减少段数"而合并。真要合并，应该由
   * 讲义包在生成时决定（那是内容判断），不是播放器的显示优化。
   */
  mergeGapMs: 0,
});

/**
 * 从讲义 + 终稿块构建「知识点时间区间表」。
 *
 * @param lecture - `state.lecture`：`{ chapters: [{ title, no?, topics: [...] }] }`。
 * @param blocks - `state.result.blocks`：每块带 `index` / `startMs` / `endMs`。
 * @param options - 覆盖 `TOPIC_RANGE_DEFAULTS`。
 * @returns `{ ranges, chapterCount, topicCount, skipped }`：
 *   - `ranges: [{ fromMs, toMs, title, chapterTitle, chapterNo, topicNo, blockIndexes, overlap }]`
 *     按 `fromMs` 升序，**互不重叠**（重叠的块只归第一个知识点）；
 *   - `skipped`：被跳过的知识点数（没有块的那些）。
 */
export function buildTopicRanges(lecture, blocks, options = {}) {
  const { mergeGapMs } = { ...TOPIC_RANGE_DEFAULTS, ...(options ?? {}) };
  const empty = { ranges: [], chapterCount: 0, topicCount: 0, skipped: 0 };
  if (!Array.isArray(lecture?.chapters) || !Array.isArray(blocks)) return empty;

  // 块序号 → 时间。用 Map 而不是 find：知识点数量 × 块数量是乘法级的。
  const byIndex = new Map();
  for (const block of blocks) {
    const index = Number(block?.index);
    const startMs = Number(block?.startMs);
    if (!Number.isInteger(index) || !Number.isFinite(startMs)) continue;
    const endMs = Number(block?.endMs);
    byIndex.set(index, {
      startMs,
      // `endMs` 缺失时退化成"和起点相同"，由下面的合并逻辑兜住。
      endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : startMs,
    });
  }
  if (byIndex.size === 0) return empty;

  /** 已被某个知识点占用的块序号。重叠只归第一个。 */
  const claimed = new Set();
  const ranges = [];
  let skipped = 0;
  let topicNo = 0;

  for (const chapter of lecture.chapters) {
    const chapterTitle = typeof chapter?.title === 'string' ? chapter.title : '';
    const chapterNo = Number.isInteger(chapter?.no) ? chapter.no : undefined;
    for (const topic of Array.isArray(chapter?.topics) ? chapter.topics : []) {
      topicNo += 1;
      const title = typeof topic?.title === 'string' ? topic.title : '';
      const indexes = (Array.isArray(topic?.blockIndexes) ? topic.blockIndexes : [])
        .map(Number)
        .filter((index) => Number.isInteger(index) && byIndex.has(index));

      if (indexes.length === 0) {
        // 本次课没讲到的知识点：树里有，但没有时间。
        skipped += 1;
        continue;
      }

      let fromMs = Infinity;
      let toMs = -Infinity;
      let overlap = false;
      const used = [];
      for (const index of indexes) {
        if (claimed.has(index)) {
          // 同一块被两个知识点引用 —— 记下来，但不给第二个知识点重复算时间。
          overlap = true;
          continue;
        }
        claimed.add(index);
        used.push(index);
        const span = byIndex.get(index);
        fromMs = Math.min(fromMs, span.startMs);
        toMs = Math.max(toMs, span.endMs);
      }
      if (used.length === 0) {
        // 所有块都被前面的知识点占了 —— 这个知识点没有独立的时间。
        skipped += 1;
        continue;
      }
      ranges.push({
        fromMs,
        toMs: Math.max(fromMs, toMs),
        title,
        chapterTitle,
        chapterNo,
        topicNo,
        blockIndexes: used,
        overlap,
      });
    }
  }

  ranges.sort((a, b) => a.fromMs - b.fromMs);
  const merged = mergeCloseRanges(ranges, mergeGapMs);
  return {
    ranges: merged,
    chapterCount: lecture.chapters.length,
    topicCount: topicNo,
    skipped,
  };
}

/**
 * 合并同章、相邻且空隙很小的区间。
 *
 * 只合并**同一章**的：跨章合并会把「第三章」和「第四章」糊成一段，
 * 而那正好是两个不同的知识块。
 *
 * ⚠️ `mergeGapMs` 为 0（默认）时这个函数**原样返回**，不做任何合并 ——
 * 因为 `range.fromMs >= last.toMs` 的空隙在首尾相接时恰好为 0，
 * `<= 0` 会让所有相邻段都合并。这个函数只在调用方显式给了正阈值时才有意义。
 */
function mergeCloseRanges(ranges, mergeGapMs) {
  const threshold = Number(mergeGapMs);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return ranges.map((range) => ({ ...range, blockIndexes: [...range.blockIndexes] }));
  }
  const out = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    const close = last !== undefined
      && last.chapterNo === range.chapterNo
      // `<` 而不是 `<=`：空隙为 0（首尾相接）时**不合并**，那是两个不同的知识点。
      && range.fromMs - last.toMs < threshold
      && range.fromMs - last.toMs > 0
      && range.fromMs >= last.fromMs;
    if (close) {
      last.toMs = Math.max(last.toMs, range.toMs);
      last.blockIndexes = [...last.blockIndexes, ...range.blockIndexes];
      last.overlap = last.overlap || range.overlap;
      // 标题保留**第一个**知识点的：合并后仍是"从这里开始讲的那个知识点"。
    } else {
      out.push({ ...range, blockIndexes: [...range.blockIndexes] });
    }
  }
  return out;
}

/**
 * 查某个时刻属于哪个知识点。
 *
 * 二分查找：一节课可能几十个知识点，`timeupdate` 每秒数次，线性扫不划算。
 *
 * @param ranges - `buildTopicRanges` 的 `ranges`。
 * @param atMs - 当前播放时刻。
 * @returns 命中的知识点；在空隙里（不属于任何知识点）返回 `null`。
 *
 * ⚠️ **返回 `null` 是常态**：老师停顿、翻页、课间那几分钟不属于任何一个
 * 知识点。调用方必须能接受"现在没有知识点"这个状态，不能拿上一个顶上。
 */
export function topicAt(ranges, atMs) {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  const at = Number(atMs);
  if (!Number.isFinite(at)) return null;

  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid];
    if (at < range.fromMs) high = mid - 1;
    else if (at >= range.toMs) low = mid + 1;
    else return range;
  }
  return null;
}

/**
 * 知识点列表（按时间顺序），供 UI 做「上一/下一个知识点」跳转。
 *
 * 只保留有标题的：无名知识点跳过去只会让人困惑。
 */
export function topicList(ranges) {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .filter((range) => typeof range.title === 'string' && range.title.trim() !== '')
    .map((range) => ({
      title: range.title,
      chapterTitle: range.chapterTitle,
      fromMs: range.fromMs,
      toMs: range.toMs,
    }));
}
