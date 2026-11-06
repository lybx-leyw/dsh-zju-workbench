/**
 * 知识点轨道：把知识点时间区间排成一条**纵向轨道**，供右栏显示。
 *
 * # 为什么不用力导向图
 *
 * 仓库里已有 `dsh-zhiyun-graph-render`（cytoscape + fcose 力导向），但它服务的是
 * 「笔记之间的链接」，那种图的价值在于**发现意外的关联**。
 *
 * 播放器右栏要回答的是完全不同的问题：
 *
 * - 我现在在**哪里**？
 * - 接下来是**哪几个**知识点？
 * - 点一下能跳到哪？
 *
 * 那是一个**有序序列**问题，不是关联发现问题。力导向会把顺序打乱，
 * 而顺序恰恰是这个场景里最重要的信息（视频只有一条时间线）。
 *
 * 所以这里用**纵向轨道**：按时间从上往下排，当前节点高亮，上下各留若干，
 * 超出的一侧用「还有 N 个」折叠。
 *
 * # 视觉密度
 *
 * 右栏约 300px 宽、~400px 高。一个节点按 34px 排，能放 11 个。
 * 所以 `before` / `after` 各取 2–3 个，剩下折叠 —— 让"现在"始终在视觉中心，
 * 又能看清前后各几步。
 */

/** 默认参数。 */
export const TRACK_DEFAULTS = Object.freeze({
  /** 当前节点之前显示几个。 */
  before: 2,
  /** 当前节点之后显示几个。预览"要去哪"比回顾"从哪来"更重要，所以多一个。 */
  after: 3,
});

/**
 * 构建可见轨道。
 *
 * @param ranges - `buildTopicRanges` 的 `ranges`（按时间升序）。
 * @param atMs - 当前播放时刻。
 * @param options - 覆盖 `TRACK_DEFAULTS`。
 * @returns `{ items, currentIndex, beforeHidden, afterHidden, total }`：
 *   - `items: [{ index, title, chapterTitle, fromMs, toMs, state }]`，
 *     `state` 为 `'past' | 'current' | 'next'`；
 *   - `currentIndex`：在**完整列表**里的下标；不在任何知识点时是 `-1`；
 *   - `beforeHidden` / `afterHidden`：被折叠的条数（0 表示没折叠）。
 *
 * # 当前不在任何知识点时怎么办
 *
 * 老师停顿、翻页时 `currentIndex` 为 `-1`。这时不能整条轨道消失 ——
 * 用户仍然想知道"接下来是什么"。处理：把**下一个即将开始**的知识点标成
 * `'next'` 并放在靠上的位置，让轨道继续可用。
 */
export function buildTrack(ranges, atMs, options = {}) {
  const { before, after } = { ...TRACK_DEFAULTS, ...(options ?? {}) };
  const all = Array.isArray(ranges) ? ranges : [];
  const total = all.length;
  if (total === 0) {
    return { items: [], currentIndex: -1, beforeHidden: 0, afterHidden: 0, total: 0 };
  }

  const at = Number(atMs);
  // 找到"当前"或"下一个"的位置。
  let currentIndex = -1;
  if (Number.isFinite(at)) {
    for (let i = 0; i < total; i += 1) {
      const range = all[i];
      if (at >= range.fromMs && at < range.toMs) { currentIndex = i; break; }
    }
    // 不在任何区间里：找第一个还没开始的。
    if (currentIndex === -1) {
      for (let i = 0; i < total; i += 1) {
        if (at < all[i].fromMs) { currentIndex = i; break; }
      }
    }
  }
  // 完全超出末尾（或时间非法）：停在最后一个。
  if (currentIndex === -1) currentIndex = total - 1;

  const start = Math.max(0, currentIndex - before);
  const end = Math.min(total - 1, currentIndex + after);
  const items = [];
  for (let i = start; i <= end; i += 1) {
    const range = all[i];
    items.push({
      index: i,
      title: typeof range.title === 'string' ? range.title : '',
      chapterTitle: typeof range.chapterTitle === 'string' ? range.chapterTitle : '',
      fromMs: range.fromMs,
      toMs: range.toMs,
      state: i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'next',
    });
  }

  return {
    items,
    currentIndex,
    beforeHidden: start,
    afterHidden: total - 1 - end,
    total,
  };
}

/**
 * 当前时刻与知识点序列的位置关系。
 *
 * 四种状态，**中间的"空档"必须单独成一种**：
 *
 * | 状态 | 含义 | UI 该怎么做 |
 * |---|---|---|
 * | `inside` | 就在某个知识点里 | 高亮它 |
 * | `gap` | 上一个讲完了、下一个还没开始 | 轨道指向下一个，但标明"还没开始" |
 * | `before` | 第一个知识点都还没开始 | 指向第一个 |
 * | `after` | 全部讲完了 | 停在最后一个，标"已讲完" |
 *
 * ⚠️ 最初只写了 `inside` / `before` / `after` 三个，结果**中间的空档被
 * 归成了 `after`**（因为它既不在区间内、也不在第一个之前）—— 于是
 * "老师正在翻页，下一个知识点还没开始"在 UI 上会显示成"全部讲完了"。
 * 这是测试抓出来的（`currentState(RANGES, 1230s)` 期望 `gap` 实得 `after`）。
 *
 * @returns `'inside' | 'gap' | 'before' | 'after' | null`
 */
export function currentState(ranges, atMs) {
  const all = Array.isArray(ranges) ? ranges : [];
  const at = Number(atMs);
  if (all.length === 0 || !Number.isFinite(at)) return null;
  for (const range of all) {
    if (at >= range.fromMs && at < range.toMs) return 'inside';
  }
  // 不在任何区间里：看它落在整条序列的哪一侧。
  const first = all[0];
  const last = all[all.length - 1];
  if (at < first.fromMs) return 'before';
  if (at >= last.toMs) return 'after';
  // 落在两个知识点之间（含"上一段结束到下一段开始"的所有空隙）。
  return 'gap';
}

/**
 * 跳转目标：点某个知识点该跳到哪一毫秒。
 *
 * **跳到起点，不是终点** —— 用户点它是因为想从那里开始看。
 * 额外留 300ms 余量：直接落在 `fromMs` 上时，区间判定是左闭右开的，
 * 边界毫秒的浮点误差可能让它落在上一段。往前推一点更稳。
 */
export function seekTargetMs(topic, epsilonMs = 300) {
  const from = Number(topic?.fromMs);
  if (!Number.isFinite(from)) return null;
  return Math.max(0, from + epsilonMs);
}

/**
 * 轨道节点的位置标签。
 *
 * 节点自身的 `state` 只有三种（`past` / `current` / `next`），因为轨道是
 * **相对当前位置**排的。第四种「空档」不属于节点，属于整条轨道 ——
 * 由 `currentState()` 另外给出，UI 用它决定是否在标题处标注「即将开始」。
 */
export function stateLabel(state) {
  if (state === 'past') return '已讲';
  if (state === 'current') return '现在';
  if (state === 'next') return '接下来';
  return '';
}

/**
 * 整条轨道的状态标签（空档时用）。
 *
 * 为什么要单独一个函数：节点标签说"这个节点相对我的位置"，整条轨道的标签
 * 说"我现在处于什么阶段"。两者混在同一个字符串里会打架 —— 空档时
 * 当前节点标着「现在」，但老师其实还没讲到它，那会误导。
 */
export function trackNote(phase) {
  if (phase === 'gap') return '这段是中间空档，下一个知识点还没开始';
  if (phase === 'before') return '还没讲到第一个知识点';
  if (phase === 'after') return '这节课的知识点都讲完了';
  return '';
}
