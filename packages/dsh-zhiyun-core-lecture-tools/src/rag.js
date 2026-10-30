/**
 * `rag` —— 在讲义里按查询检索相关段落。
 *
 * # 上游为什么给 `rag` 一个 9 参数的 schema
 *
 * 上游 `rag` 走的是「知识库检索 + 精确来源视觉取证」两套路径：一旦给了
 * `source_path` / `asset_id` / `figure` / `page` / `region` / `source_hash` 中的一个，
 * 就切到 `retrieve_visual`（读 PDF 指定页 / 裁切区域），返回的是**原图像素**。
 * 那套参数的描述文字（"One-based PDF page for vector diagrams…"）是给模型**判断
 * 该切哪条路**用的，不是装饰。
 *
 * 本仓讲义没有 PDF 与图片资产，那条路走不通。但 **schema 不能因此删参数**：
 * 模型看到的函数签名变了，它的调用行为就变了 —— 而这条链的质量基线是按原
 * schema 调出来的。所以这里是**同一个 schema，窄一些的能力**：
 *
 * - 纯文本检索（`query` + `kb_name`）：完整实现；
 * - 精确来源选择器（其余六个）：认，但**明确拒绝并说明原因**，而不是静默忽略。
 *   静默忽略最坏：模型以为自己拿到了第 7 页的原图，接着编造"如图所示"。
 *
 * # 返回值形状
 *
 * 上游 `RAGTool._retrieve()` 的 `content` 是**检索管道拼好的自然语言答案**
 * （`result["answer"]`），不是 JSON。这里同样返回文本块：每段带
 * `[source-id]` 行内引用，因为提示词明确要求模型"以 [source-id] 行内引用"
 * （`explore.system` 的 grounding 段）。id 就是 `t1-2` 这种知识点 id ——
 * 与 `read_source` 能接的 id 同一套，模型可以顺着引用往回读全文。
 */
import { normalizeLanguage } from './kb-files.js';
import { searchLecture } from './lecture-index.js';
import { pyRepr } from './py-repr.js';

/** 上游 `_normalize_rag_selectors` 认的精确来源键，顺序照抄。 */
const EXACT_SELECTOR_KEYS = Object.freeze([
  'source_path',
  'asset_id',
  'figure',
  'page',
  'region',
  'source_hash',
]);

const NO_MATCH_TEXT = Object.freeze({
  // 与上游同一句话：重点是让模型知道"检索成功但没命中"，而不是"检索失败了"。
  en: (kb) => `No matching content was found in knowledge base '${kb}'. The search completed successfully.`,
  zh: (kb) => `在知识库「${kb}」中没有检索到匹配内容。检索本身已成功完成。`,
});

/**
 * 精确来源选择器的归一化，逐条对齐上游 `_normalize_rag_selectors()`。
 *
 * 返回 `{selectors}` 或 `{error}`。上游同一处逻辑的取舍是**绝不做宽松处理**
 * （不 clamp、不丢弃、不改道），因为「把请求的图换成一张相似的图」是最严重的
 * 取证错误。这里保留同一套校验，只是最终回复不同（说明本地讲义没有页面）。
 */
export function normalizeRagSelectors(args = {}) {
  const selectors = {};
  for (const key of EXACT_SELECTOR_KEYS) selectors[key] = args[key] ?? null;

  const page = selectors.page;
  if (page !== null && page !== undefined) {
    if (typeof page === 'boolean' || !Number.isInteger(page)) {
      return {
        error: `Invalid page ${pyRepr(page)}: PDF pages are one-based integers. `
          + 'Resend with an integer page >= 1, or null to omit the page.',
      };
    }
    if (page < 1) {
      return {
        error: `Invalid page ${page}: PDF pages are one-based. `
          + 'Resend with a page >= 1, or null to omit the page.',
      };
    }
  }

  const region = selectors.region;
  if (region !== null && region !== undefined) {
    if (Array.isArray(region) && region.length === 0) {
      // 旧客户端会传 region=[] 占位；上游把它当"未提供"（整页），不是错误。
      selectors.region = null;
    } else if (!(
      Array.isArray(region)
      && region.length === 4
      && region.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
    )) {
      return {
        error: `Invalid region ${pyRepr(region)}: a crop must be four finite numbers `
          + '[x0, y0, x1, y1] within 0..1. Resend with a valid crop, or '
          + 'null to inspect the full page.',
      };
    }
  }
  return { selectors };
}

/**
 * 渲染命中段落。
 *
 * # 引用 id 用**知识点 id**，不用块 id
 *
 * 提示词要求模型「以 [source-id] 行内引用」，而上游那些 source-id 是**能被
 * `read_source` 读回去的**（`at-…` / `nb-…`）。本包里能被读回去的只有知识点 id
 * （见 `buildLectureIndex` 的文件头：sources 只收知识点）。若这里对块 id 引用，
 * 模型顺着引用去 `read_source` 会撞上 "unknown source_id" —— 白耗一轮迭代，
 * 而探索轮次是有预算的（`max_explore_iterations`）。
 *
 * 所以：**引用给知识点 id，块 id 放进 metadata**（trace 与 UI 用，不进模型上下文）。
 * 一段命中可能来自同一知识点的多个块，引用 id 相同是正常的：一条引用指向整节，
 * 正文只给命中的那几段 —— 这与「读全文」是两条互补的路。
 *
 * 相似度分数**不输出**：字面检索的分数没有跨查询可比性，给了反而诱导模型
 * 按分数排序而不是按内容判断。
 */
export function renderHits(hits) {
  const blocks = [];
  for (const { block } of hits) {
    blocks.push(`[${block.topicId}] (${block.chapterTitle} · ${block.topicTitle})\n${block.text}`);
  }
  return blocks.join('\n\n');
}

/**
 * @param {object} options
 * @param {{blocks: Array<object>, counts: object}} options.index
 * @param {(event: {query: string, hits: number}) => void} [options.onRetrieve] 观测回调
 */
export function createRagHandler({ index, onRetrieve } = {}) {
  return async function ragHandler(args = {}, ctx = {}) {
    const language = normalizeLanguage(args.language ?? ctx?.language ?? ctx?.context?.language);
    const query = String(args.query ?? '').trim();
    // 上游抛 ValueError（= 显式失败），不是返回空结果：空 query 是**参数错**，
    // 用空结果回答会让模型以为"这个知识库没有相关内容"。
    if (!query) return { ok: false, error: 'RAG query must be a non-empty string.' };
    const kbName = String(args.kb_name ?? '').trim();
    if (!kbName) return { ok: false, error: 'RAG requires an explicit kb_name.' };

    const normalized = normalizeRagSelectors(args);
    if (normalized.error) {
      return {
        ok: false,
        error: normalized.error,
        metadata: { evidence_kind: 'exact_source_visual', error_type: 'invalid_selector' },
      };
    }
    const requested = EXACT_SELECTOR_KEYS.filter((key) => {
      const value = normalized.selectors[key];
      return value !== null && value !== undefined && value !== '';
    });
    if (requested.length > 0) {
      // 认这个参数、拒绝这条路 —— 见文件头。文案给出**下一步该做什么**，
      // 而不是只说"不支持"（模型会原地重试同一个参数）。
      const hint = language === 'zh'
        ? `本讲义没有可分页/裁切的原始文档，「${requested.join('、')}」这类精确来源定位不适用。`
          + '请改用 query 做文本检索，或先用 kb_files 取知识点 id 再用 read_source 读该知识点的全文。'
        : `This lecture has no paginated/croppable source document, so exact-source selectors `
          + `(${requested.join(', ')}) do not apply. Use query for text retrieval, or take a topic id `
          + 'from kb_files and read the full text with read_source.';
      return {
        ok: false,
        error: hint,
        metadata: {
          evidence_kind: 'exact_source_visual',
          error_type: 'unsupported_by_lecture_source',
          selectors: requested,
        },
      };
    }

    const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : 8;
    const hits = searchLecture(index, query, { limit });
    if (typeof onRetrieve === 'function') {
      try {
        onRetrieve({ query, kbName, hits: hits.length });
      } catch {
        // 观测失败不影响检索结果。
      }
    }

    if (hits.length === 0) {
      return {
        ok: true,
        result: {
          content: NO_MATCH_TEXT[language](kbName),
          sources: [],
          metadata: { query, kb_name: kbName, hits: 0, provider: 'lecture-memory' },
        },
      };
    }

    return {
      ok: true,
      result: {
        content: renderHits(hits),
        // 与上游 `_rag_sources()` 同形：`{type, kb_name, ...}`，让消费方（trace / 引用卡）
        // 不必为"本地讲义"写第二套解析。
        // `source` 是**引用 id**（知识点 id，能被 read_source 读回去）；
        // `block_ids` 是本段的精确定位，给 UI 高亮用，不进模型上下文。
        sources: hits.map(({ block }) => ({
          type: 'rag',
          kb_name: kbName,
          source: block.topicId,
          topic_id: block.topicId,
          block_ids: [block.id],
          document_name: `${block.chapterTitle}/${block.topicTitle}`,
        })),
        metadata: {
          query,
          kb_name: kbName,
          hits: hits.length,
          provider: 'lecture-memory',
          // 引用 id（去重、保持首次出现顺序）—— 模型会拿它去 read_source
          source_ids: [...new Set(hits.map(({ block }) => block.topicId))],
          // 精确定位（trace / 高亮）
          block_ids: hits.map(({ block }) => block.id),
        },
      },
    };
  };
}
