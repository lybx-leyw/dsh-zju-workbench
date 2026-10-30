/**
 * `read_source` —— 按 id 取一份来源的完整正文（上游从 `source_index` 取，这里从讲义索引取）。
 *
 * # handler 返回值形状为什么是「纯文本 content + metadata」
 *
 * 上游 `ReadSourceTool.execute()` 返回 `ToolResult(content=str(full_text),
 * metadata={source_id, char_count})` —— 正文是**裸文本**，不是 JSON。这个选择
 * 有代价也有理由：正文动辄几千字，套进 JSON 要多一层转义，模型读起来也更费
 * token。所以这里照原样返回正文，把结构化信息放进 `metadata`（trace / UI 用，
 * 不进模型的 tool 消息）。
 *
 * # 三条错误语义必须保留
 *
 * 上游有三种失败，且**文案不一样**，因为模型的自纠动作不一样：
 * 1. 没有来源 → 直接说没有（模型该换策略，不是去猜 id）；
 * 2. 有多个来源却没给 id → 提示 id 是必填，**不要**默认取第一个
 *    （默认取第一个会让模型养成"不填 id 也能拿到东西"的习惯，多来源时必然取错）；
 * 3. id 不存在 → 列出**本次真实可用的 id**，让模型照着改。
 *
 * 唯一来源时自动补 id（上游行为）：那时"猜"的唯一答案就是那个来源，
 * 让模型多跑一轮没有收益。
 */
import { sortSourceIds } from './lecture-index.js';
import { reprString } from './py-repr.js';

/**
 * @param {object} options
 * @param {Map<string, object>} options.sources  讲义索引的 `sources`
 * @param {(sourceId: string) => void} [options.onRead] 读取回调（trace / 审计用）
 */
export function createReadSourceHandler({ sources, onRead } = {}) {
  return async function readSourceHandler(args = {}) {
    if (!(sources instanceof Map) || sources.size === 0) {
      return { ok: false, error: 'Error: no attached sources are available for this turn.' };
    }
    let sourceId = String(args.source_id ?? '').trim();
    if (!sourceId) {
      if (sources.size === 1) {
        sourceId = sources.keys().next().value;
      } else {
        return { ok: false, error: 'Error: source_id is required when multiple sources are available.' };
      }
    }
    const source = sources.get(sourceId);
    if (!source || typeof source.text !== 'string' || source.text === '') {
      const available = sortSourceIds([...sources.keys()]).join(', ');
      return {
        ok: false,
        error: `Error: unknown source_id ${reprString(sourceId)}. Valid ids for this turn: ${available || '(none)'}.`,
      };
    }
    if (typeof onRead === 'function') {
      try {
        onRead(sourceId);
      } catch {
        // 观测失败不能影响工具结果（上游同样不把 trace 的失败冒泡给模型）。
      }
    }
    return {
      ok: true,
      result: {
        content: source.text,
        metadata: {
          source_id: sourceId,
          char_count: source.text.length,
          kind: source.kind,
          title: source.title,
        },
      },
    };
  };
}
