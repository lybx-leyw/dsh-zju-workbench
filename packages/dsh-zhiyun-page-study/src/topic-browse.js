/**
 * 知识点轨道的「自由浏览」状态。
 *
 * # 需求
 *
 * 和课件同样的三态：跟随视频 / 冻结在当前知识点 / 用户翻到别处。
 * 但知识点比课件多一层 —— **按章浏览**。用户可能想翻到第三章看看
 * 讲了哪些知识点，而他还在看第一章的视频。
 *
 * # 和课件为什么不完全同构
 *
 * 课件是一维的（页序），"当前页"由 `indexAt(slides, nowMs)` 直接给出。
 * 知识点是**两维**的（章 → 知识点），"回到当前位置"要同时定位到
 * 章和知识点。所以这里给出的是 `{ chapterNo, index }` 而不是单个下标。
 *
 * # 三态
 *
 * | 状态 | 行为 |
 * |---|---|
 * | `follow` | 显示视频当前所在的知识点（默认） |
 * | `browse` | 用户翻到了别处：显示他选的那一章，**不被视频拽回** |
 *
 * `browse` 状态下如果用户翻回来的正好是当前知识点，**自动回到 follow**
 * —— 和课件同样的判断：翻回来就说明没有脱离的意图了。
 */

/** 默认参数。 */
export const BROWSE_DEFAULTS = Object.freeze({
  /** 一屏最多显示多少个知识点（超出折叠）。 */
  pageSize: 12,
});

/**
 * 按章分组。
 *
 * @param ranges - `buildTopicRanges()` 的 `ranges`（按时间升序）。
 * @returns `[{ chapterNo, chapterTitle, items: [{ index, title, fromMs, toMs }] }]`
 *   按 `chapterNo` / 首次出现顺序排列。
 *
 * 为什么按 `chapterNo` 而不是 `chapterTitle`：标题可能重复（比如两章都叫
 * 「小结」），而 `no` 是讲义里排好的序号。没有 `no` 时退回按出现顺序编号。
 */
export function groupByChapter(ranges) {
  const list = Array.isArray(ranges) ? ranges : [];
  const groups = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const range = list[i];
    if (!range) continue;
    /* ⚠️ 缺章号时**不要**在这里自增编号。
     *
     * 最初写成 `const no = range.chapterNo ?? (fallbackNo += 1)`，结果是
     * 循环里每一条没有章号的区间都拿到一个新号 —— 本该属于同一章的知识点
     * 被拆成 N 章（测试抓出来的：期望 1 章，实际 2 章）。
     *
     * 缺章号说明讲义没做整节梳理（整棵树只有一章），语义上就应该**全部归一章**。
     * 所以用固定的兜底号 1。 */
    const no = Number.isInteger(range.chapterNo) ? range.chapterNo : 1;
    if (!groups.has(no)) {
      groups.set(no, {
        chapterNo: no,
        chapterTitle: typeof range.chapterTitle === 'string' ? range.chapterTitle : '',
        items: [],
      });
    }
    groups.get(no).items.push({
      index: i,
      title: typeof range.title === 'string' ? range.title : '',
      fromMs: range.fromMs,
      toMs: range.toMs,
    });
  }
  const out = [...groups.values()];
  out.sort((a, b) => a.chapterNo - b.chapterNo);
  return out;
}

/**
 * 找某个知识点下标属于哪一章。
 *
 * @returns 章序号；找不到时返回 `null`。
 */
export function chapterOfIndex(chapters, index) {
  if (!Array.isArray(chapters) || !Number.isInteger(index)) return null;
  for (const chapter of chapters) {
    if (chapter.items.some((item) => item.index === index)) return chapter.chapterNo;
  }
  return null;
}

/**
 * 决定轨道该显示哪一章、哪些知识点。
 *
 * @param ranges - 全部知识点区间。
 * @param atMs - 视频当前时刻。
 * @param browseChapterNo - 用户手动选的章序号；`null` 表示跟随视频。
 * @param options - 覆盖 `BROWSE_DEFAULTS`。
 * @returns `{ chapters, activeChapterNo, items, following, hasPrev, hasNext, hidden }`
 *   - `activeChapterNo`：当前显示的是哪一章；
 *   - `items`：该章要显示的知识点（可能被 `pageSize` 截断）；
 *   - `following`：是否处于跟随态（决定要不要显示「回到当前」按钮）；
 *   - `hidden`：被折叠掉的条数。
 */
export function resolveBrowse(ranges, atMs, browseChapterNo, options = {}) {
  const { pageSize } = { ...BROWSE_DEFAULTS, ...(options ?? {}) };
  const chapters = groupByChapter(ranges);
  const empty = {
    chapters,
    activeChapterNo: null,
    items: [],
    following: true,
    hasPrev: false,
    hasNext: false,
    hidden: 0,
  };
  if (chapters.length === 0) return empty;

  // 视频当前所在的知识点下标（不在任何区间时取"下一个"）。
  const at = Number(atMs);
  let liveIndex = -1;
  if (Number.isFinite(at)) {
    for (let i = 0; i < (ranges?.length ?? 0); i += 1) {
      const range = ranges[i];
      if (at >= range.fromMs && at < range.toMs) { liveIndex = i; break; }
    }
    if (liveIndex === -1) {
      for (let i = 0; i < (ranges?.length ?? 0); i += 1) {
        if (at < ranges[i].fromMs) { liveIndex = i; break; }
      }
    }
  }
  const liveChapterNo = chapterOfIndex(chapters, liveIndex);

  // 用户选的章有效就用它；否则跟随视频所在的章。
  const browseValid = Number.isInteger(browseChapterNo)
    && chapters.some((chapter) => chapter.chapterNo === browseChapterNo);
  const activeChapterNo = browseValid ? browseChapterNo : (liveChapterNo ?? chapters[0].chapterNo);
  const following = !browseValid || browseChapterNo === liveChapterNo;

  const chapter = chapters.find((item) => item.chapterNo === activeChapterNo) ?? chapters[0];
  // 跟随态下要保证"当前知识点"在可见窗口里：如果它在第 30 个，直接显示
  // 前 12 个会让用户看不到自己在哪。
  let start = 0;
  if (chapter.items.length > pageSize) {
    const anchor = chapter.items.findIndex((item) => item.index === liveIndex);
    if (following && anchor >= 0) {
      // 让当前项尽量居中。
      start = Math.max(0, Math.min(chapter.items.length - pageSize, anchor - Math.floor(pageSize / 2)));
    }
  }
  const items = chapter.items.slice(start, start + pageSize);

  return {
    chapters,
    activeChapterNo: chapter.chapterNo,
    items,
    following,
    hasPrev: start > 0,
    hasNext: start + pageSize < chapter.items.length,
    hidden: Math.max(0, chapter.items.length - pageSize),
  };
}

/**
 * 切到相邻的一章。
 *
 * @param chapters - `groupByChapter` 的结果。
 * @param currentNo - 当前章序号。
 * @param delta - `+1` 下一章、`-1` 上一章。
 * @returns 目标章序号；已经在头/尾时返回 `null`（调用方据此禁用按钮）。
 */
export function stepChapter(chapters, currentNo, delta) {
  if (!Array.isArray(chapters) || chapters.length === 0) return null;
  const at = chapters.findIndex((chapter) => chapter.chapterNo === currentNo);
  if (at < 0) return null;
  const next = at + Number(delta);
  if (!Number.isInteger(next) || next < 0 || next >= chapters.length) return null;
  return chapters[next].chapterNo;
}
