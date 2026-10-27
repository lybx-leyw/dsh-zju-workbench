/**
 * 锚点索引：`sourceAnchors` 的规范化视图。
 *
 * # 为什么锚点要单独一层
 *
 * `sourceAnchors` 是**扁平**的一维数组，而 UI / 上游要问的问题都是多维的：
 * 「这个知识点有哪些锚点」「这一页有哪些块」「这一秒对应哪段话」。
 * 若每个调用方都自己 `Array.find` 一遍，各处的「缺失锚点怎么算」迟早会给出不同答案
 * （有的返回 null，有的抛错，有的拿 0 兜底）。这一层把那份答案收敛成一份。
 *
 * 三条统一口径：
 * 1. **锚点以 `sourceAnchors` 为准**，`block.anchorIds` 是引用；引用不到只在 `warnings` 里记，
 *    不伪造锚点（伪造出来的锚点会让 UI 跳到一个不存在的位置）。
 * 2. `page` / `timeRange` / `confidence` 缺失一律给 `null`，**不用 0 兜底**：
 *    0 是合法页码（封面）和合法时间（片头），用 0 兜底会把「不知道」伪装成「在第 0 页」。
 * 3. 遍历顺序稳定（按 `sourceAnchors` 原序）：同一份资源多次调用得到逐字相同的索引，
 *    否则派生资源的指纹会无谓地抖动。
 */

import { jsonType } from './validate.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** 规范化单条锚点：补齐缺省、裁掉不属于 schema 的字段。 */
export function normalizeAnchor(raw) {
  if (!raw || jsonType(raw) !== 'object') return null;
  const anchorId = typeof raw.anchorId === 'string' ? raw.anchorId : '';
  if (!anchorId) return null;
  const timeRange = raw.timeRange && jsonType(raw.timeRange) === 'object'
    ? {
      startMs: typeof raw.timeRange.startMs === 'number' ? raw.timeRange.startMs : null,
      endMs: typeof raw.timeRange.endMs === 'number' ? raw.timeRange.endMs : null,
    }
    : null;
  return {
    anchorId,
    topicId: typeof raw.topicId === 'string' ? raw.topicId : null,
    blockId: typeof raw.blockId === 'string' ? raw.blockId : null,
    page: Number.isInteger(raw.page) ? raw.page : null,
    timeRange,
    assetRef: typeof raw.assetRef === 'string' ? raw.assetRef : null,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    origin: typeof raw.origin === 'string' ? raw.origin : 'manual',
  };
}

/**
 * 建锚点索引。
 *
 * @returns {{
 *   list: Array<object>,                          // 规范化后的锚点（原序、已去重）
 *   index: Record<string, object>,                // anchorId → 锚点
 *   byTopic: Record<string, string[]>,            // topicId → anchorId[]
 *   byPage: Record<string, string[]>,             // 页码字符串 → anchorId[]（只收有页码的）
 *   referencedBy: Record<string, {topicId, blockId}|null>,  // anchorId → 引用它的块
 *   warnings: Array<{code: string, message: string}>,
 * }}
 */
export function buildAnchorIndex(bundle) {
  const warnings = [];
  /** @type {Array<object>} */
  const list = [];
  const index = Object.create(null);

  for (const raw of asArray(bundle?.sourceAnchors)) {
    const anchor = normalizeAnchor(raw);
    if (!anchor) {
      warnings.push({ code: 'ANCHOR_MISSING_ID', message: '有来源锚点缺少 anchorId，已跳过' });
      continue;
    }
    if (anchor.anchorId in index) {
      // 重复 anchorId 是上游的错，但不能静默取最后一个：先出现的胜出，
      // 因为 sourceAnchors 通常是按「离正文由近到远」追加的。
      warnings.push({
        code: 'ANCHOR_DUPLICATE',
        message: `锚点 ${anchor.anchorId} 重复出现，只保留第一条`,
        anchorId: anchor.anchorId,
      });
      continue;
    }
    index[anchor.anchorId] = anchor;
    list.push(anchor);
  }

  /** 块引用进来的锚点 → 引用它的块（反查「谁用了这个锚点」）。 */
  const referencedBy = Object.create(null);
  for (const chapter of asArray(bundle?.chapters)) {
    for (const topic of asArray(chapter?.topics)) {
      const topicId = typeof topic?.id === 'string' ? topic.id : null;
      for (const block of asArray(topic?.blocks)) {
        const blockId = typeof block?.id === 'string' ? block.id : null;
        for (const anchorId of asArray(block?.anchorIds)) {
          if (typeof anchorId !== 'string') continue;
          if (!(anchorId in index)) {
            warnings.push({
              code: 'ANCHOR_NOT_FOUND',
              message: `正文块 ${blockId ?? '(无 id)'} 引用了不存在的锚点 ${anchorId}`,
              anchorId,
            });
            continue;
          }
          if (!(anchorId in referencedBy)) referencedBy[anchorId] = { topicId, blockId };
        }
      }
    }
  }

  const byTopic = Object.create(null);
  const byPage = Object.create(null);
  for (const anchor of list) {
    const topicKey = anchor.topicId ?? '';
    if (!byTopic[topicKey]) byTopic[topicKey] = [];
    byTopic[topicKey].push(anchor.anchorId);
    if (anchor.page !== null) {
      const pageKey = String(anchor.page);
      if (!byPage[pageKey]) byPage[pageKey] = [];
      byPage[pageKey].push(anchor.anchorId);
    }
  }

  return { list, index, byTopic, byPage, referencedBy, warnings };
}

/**
 * 对外主入口（契约 §13 里的 `anchors`）。
 *
 * 与 `buildAnchorIndex` 同一份实现，但返回**冻结**的对象：调用方拿到的是共享视图，
 * 就地改它会污染其它 run 的反查结果。
 */
export function anchors(bundle) {
  const built = buildAnchorIndex(bundle);
  return Object.freeze({
    list: Object.freeze(built.list),
    index: built.index,
    byTopic: built.byTopic,
    byPage: built.byPage,
    referencedBy: built.referencedBy,
    warnings: built.warnings,
    /** 按 anchorId 取一条；找不到返回 null。 */
    get(anchorId) {
      return built.index[anchorId] ?? null;
    },
    /** 某个知识点下的全部锚点。 */
    forTopic(topicId) {
      return (built.byTopic[topicId] ?? []).map((id) => built.index[id]);
    },
    /** 某一页上的全部锚点（按数值页序）。 */
    forPage(page) {
      return (built.byPage[String(page)] ?? []).map((id) => built.index[id]);
    },
    /** 锚点指向的位置：给 UI「跳回去」用。缺页码与时段时两者都给 null。 */
    locate(anchorId) {
      const anchor = built.index[anchorId];
      if (!anchor) return null;
      return {
        anchorId: anchor.anchorId,
        page: anchor.page,
        timeRange: anchor.timeRange,
        assetRef: anchor.assetRef,
        topicId: anchor.topicId,
        blockId: anchor.blockId,
        origin: anchor.origin,
      };
    },
  });
}
