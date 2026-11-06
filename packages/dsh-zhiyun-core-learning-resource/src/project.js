/**
 * 资源投影：把 `chapters → topics → blocks` 压成上游能直接塞进上下文的紧凑结构。
 *
 * # 为什么投影必须带 anchorIndex
 *
 * DeepTutor 的产出（题目、讲解、追问）要能**回到来源**：用户点一下，跳到讲义的那一页 /
 * 那一句。若投影只是纯文本，锚点信息就在这一层被吞掉了 —— 之后的题目再也说不清
 * 「这道题对应第 3 页的那段」，来源定位链断在这里，任何后续补偿都补不回来。
 * 所以 `project()` 的返回值里，`anchorIndex` 是一等公民：`anchorId → {topicId, blockId, page, timeRange}`。
 *
 * # 三种视图
 *
 * - `text`：纯文本（带章/知识点标题与块号），给「把正文塞进 prompt」的场合。
 *   每个块前面带 `[b1]` 这样的块号，正文里出现引用时可以人工对上；块号同时是反查的钥匙。
 * - `blocks`：分块结构（保留 `type`/`text`/`assetRef`/`anchorIds`/`topicId`/`blockId`），
 *   给「需要按块选择」的场合（例如只把某几块喂给出题器）。
 * - `anchorIndex`：`anchorId → {topicId, blockId, page, timeRange, assetRef, confidence, origin}`。
 *   **即使 anchor 在 sourceAnchors 里但没有任何块引用它，也照样进索引** —— 上游可能只给了
 *   页码而没落到块上，那种锚点同样要能反查。
 *
 * # 选择子集
 *
 * `selectedTopicIds` / `selectedRanges` 为空 = 全量（契约 §6）。非空时只投影被选中的部分，
 * 但 `anchorIndex` 仍然只收被投影出来的块的锚点 + 全局锚点，避免给出「索引里有、正文里没有」的假锚点。
 */

import { jsonType } from './validate.js';

/** 块类型 → 文本渲染时的标签（只影响 `text` 视图，不影响结构）。 */
const TYPE_LABEL = Object.freeze({
  paragraph: '正文',
  list: '列表',
  table: '表格',
  image: '图',
  code: '代码',
  formula: '公式',
  question: '问题',
  callout: '提示',
});

/** 取文本视图里的块标签；未知类型原样显示，不吞掉信息。 */
function labelOf(type) {
  return TYPE_LABEL[type] ?? String(type ?? '块');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * 选出要投影的知识点集合。
 *
 * 返回 `{ all: boolean, topicIds: Set<string>|null, blockIdsByTopic: Map<string,Set<string>>|null }`：
 * - `all` 为真时忽略两个集合（全量）；
 * - `topicIds` 非空即「只投影这些知识点」；
 * - `blockIdsByTopic` 里有的 topic 只投影列出的块（`selectedRanges` 语义）。
 */
function resolveSelection(bundle) {
  const topicIds = asArray(bundle?.selectedTopicIds).filter((id) => typeof id === 'string');
  const ranges = asArray(bundle?.selectedRanges).filter((row) => row && typeof row === 'object');
  if (topicIds.length === 0 && ranges.length === 0) {
    return { all: true, topicIds: null, blockIdsByTopic: null };
  }
  const blockIdsByTopic = new Map();
  for (const range of ranges) {
    const topicId = str(range.topicId);
    if (!topicId) continue;
    const ids = asArray(range.blockIds).filter((id) => typeof id === 'string');
    // blockIds 缺省/为空 = 该知识点整段；显式列出时只取列出的块。
    if (!blockIdsByTopic.has(topicId)) blockIdsByTopic.set(topicId, ids.length > 0 ? new Set(ids) : null);
    else if (ids.length > 0) for (const id of ids) blockIdsByTopic.get(topicId)?.add?.(id);
  }
  return {
    all: false,
    topicIds: topicIds.length > 0 ? new Set(topicIds) : null,
    blockIdsByTopic,
  };
}

/** 该知识点是否被选中：两个选择器是**并集**语义（契约里二者可同时出现）。 */
function topicSelected(selection, topicId) {
  if (selection.all) return true;
  if (selection.topicIds?.has(topicId)) return true;
  if (selection.blockIdsByTopic?.has(topicId)) return true;
  return false;
}

function blockSelected(selection, topicId, blockId) {
  if (selection.all) return true;
  // 只按 topicIds 选中的知识点：整段都要。
  if (selection.topicIds?.has(topicId)) return true;
  const allow = selection.blockIdsByTopic?.get(topicId);
  if (allow === undefined) return false;
  if (allow === null) return true;
  return allow.has(blockId);
}

/**
 * 建锚点索引。
 *
 * `sourceAnchors` 是唯一真源；`block.anchorIds` 只是引用。两边不一致时**以 sourceAnchors 为准**，
 * 并把「块引用了不存在的锚点」记进 `warnings`（投影不能假装没看见坏引用）。
 */
function buildAnchorIndex(bundle, warnings) {
  const index = Object.create(null);
  for (const anchor of asArray(bundle?.sourceAnchors)) {
    if (!anchor || typeof anchor !== 'object') continue;
    const anchorId = str(anchor.anchorId);
    if (!anchorId) continue;
    // 时段缺失一律 null，**不用 0 兜底**：0 毫秒是合法的片头时刻，
    // 兜底会把「不知道在哪」伪装成「在视频开头」，UI 会跳到一个错误的位置。
    // 缺一半也降级成 null —— 半截时段无法定位。
    const timeRange = anchor.timeRange && typeof anchor.timeRange === 'object'
      && typeof anchor.timeRange.startMs === 'number' && typeof anchor.timeRange.endMs === 'number'
      ? { startMs: anchor.timeRange.startMs, endMs: anchor.timeRange.endMs }
      : null;
    index[anchorId] = {
      anchorId,
      topicId: anchor.topicId ?? null,
      blockId: anchor.blockId ?? null,
      page: Number.isInteger(anchor.page) ? anchor.page : null,
      timeRange,
      assetRef: anchor.assetRef ?? null,
      confidence: typeof anchor.confidence === 'number' ? anchor.confidence : null,
      origin: anchor.origin ?? null,
    };
  }
  return index;
}

/**
 * 把一份标准学习资源投影成 `{ text, blocks, anchorIndex }`。
 *
 * @param bundle 标准学习资源（不需要已通过校验；缺字段时按「空」处理，投影永不抛）
 * @param options.includeUnselected 为 true 时忽略选择器做全量投影（调试/预览用）
 * @returns {{text: string, blocks: Array, anchorIndex: object, stats: object, warnings: Array}}
 */
export function project(bundle, { includeUnselected = false } = {}) {
  const warnings = [];
  const allAnchors = buildAnchorIndex(bundle, warnings);
  const selection = includeUnselected ? { all: true, topicIds: null, blockIdsByTopic: null } : resolveSelection(bundle);

  /** @type {Array<object>} */
  const blocks = [];
  const lines = [];
  const usedAnchors = new Set();
  let topicCount = 0;
  let chapterCount = 0;

  const title = str(bundle?.title).trim();
  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }

  for (const chapter of asArray(bundle?.chapters)) {
    if (!chapter || typeof chapter !== 'object') continue;
    const chapterId = str(chapter.id);
    const chapterTopics = [];
    for (const topic of asArray(chapter.topics)) {
      if (!topic || typeof topic !== 'object') continue;
      const topicId = str(topic.id);
      if (!topicId) {
        warnings.push({ code: 'TOPIC_MISSING_ID', message: '有知识点缺少 id，已跳过', chapterId });
        continue;
      }
      if (!topicSelected(selection, topicId)) continue;
      const picked = [];
      let blockNo = 0;
      for (const block of asArray(topic.blocks)) {
        if (!block || typeof block !== 'object') continue;
        const blockId = str(block.id);
        blockNo += 1;
        if (!blockId) {
          warnings.push({ code: 'BLOCK_MISSING_ID', message: '有正文块缺少 id，已跳过', topicId });
          continue;
        }
        if (!blockSelected(selection, topicId, blockId)) continue;
        const anchorIds = asArray(block.anchorIds).filter((id) => typeof id === 'string');
        const missing = anchorIds.filter((id) => !(id in allAnchors));
        if (missing.length > 0) {
          warnings.push({
            code: 'ANCHOR_NOT_FOUND',
            message: `正文块引用了不存在的锚点：${missing.join(', ')}`,
            topicId,
            blockId,
          });
        }
        for (const id of anchorIds) if (id in allAnchors) usedAnchors.add(id);
        const text = str(block.text);
        const entry = {
          blockId,
          topicId,
          chapterId,
          index: blockNo,
          type: block.type,
          text,
          assetRef: block.assetRef ?? null,
          anchorIds: [...anchorIds],
          meta: block.meta && typeof block.meta === 'object' ? block.meta : null,
        };
        picked.push(entry);
        blocks.push(entry);
      }
      // 选中的知识点即使一个块都没有也要出现在 text 视图里：空知识点本身是信息
      //（说明上游没抽到内容），静默消失会让人误以为选择器没生效。
      chapterTopics.push({ topicId, title: str(topic.title), blocks: picked });
      topicCount += 1;
    }
    if (chapterTopics.length === 0) continue;
    chapterCount += 1;
    lines.push(`## ${str(chapter.title) || chapterId || '未命名章'}`);
    lines.push('');
    for (const topic of chapterTopics) {
      if (topic.title) lines.push(`### ${topic.title}`);
      else lines.push(`### （未命名知识点 ${topic.topicId}）`);
      if (topic.blocks.length === 0) {
        lines.push('（本节没有可用正文）');
        lines.push('');
        continue;
      }
      for (const entry of topic.blocks) {
        lines.push(`[${entry.blockId}] ${labelOf(entry.type)}｜${entry.text}`);
      }
      lines.push('');
    }
  }

  // 锚点索引：块引用的锚点 + 那些没有落到块上的全局锚点。
  // 后者必须保留 —— 上游可能只给了页码（`origin: slide`），没有对应正文块。
  const anchorIndex = Object.create(null);
  for (const [anchorId, anchor] of Object.entries(allAnchors)) {
    const orphan = anchor.blockId === null || anchor.blockId === undefined;
    if (usedAnchors.has(anchorId) || orphan) anchorIndex[anchorId] = anchor;
  }

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    blocks,
    anchorIndex,
    stats: {
      chapters: chapterCount,
      topics: topicCount,
      blocks: blocks.length,
      anchors: Object.keys(anchorIndex).length,
      selected: selection.all ? 'all' : 'partial',
      chars: [...text].length,
    },
    warnings,
  };
}

/**
 * 反查：给定 anchorId，返回它指向的位置 + 该位置在投影里的块。
 *
 * 这是「来源定位」链的对外出口：上游拿到 anchorId 就能问出「哪一页、哪一秒、哪一块」。
 * 找不到时返回 null（不抛）：陈旧锚点（资源已换版）是常态，调用方要能降级。
 */
export function lookupAnchor(projection, anchorId) {
  if (!projection || typeof projection !== 'object' || typeof anchorId !== 'string') return null;
  const anchor = projection.anchorIndex?.[anchorId];
  if (!anchor) return null;
  const block = asArray(projection.blocks).find((item) => item.blockId === anchor.blockId) ?? null;
  return { anchor, block };
}
