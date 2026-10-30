/**
 * trace 元数据辅助 —— 上游 `core/trace.py` 的 JS 对位。
 *
 * 这些字段是前端 `CallTracePanel` 把事件归行/归组的唯一依据：
 * `call_id` 决定它落在哪张卡，`trace_role`/`trace_group` 决定折叠方式，
 * `call_kind` 决定内容算不算"回答正文"。
 */

import { randomBytes } from 'node:crypto';

/**
 * 只有这两种 `call_kind` 的 `content` 事件构成读者看到的回答正文。
 * 其余都流进折叠的 trace 里：检索摘要、计划步骤、可视化修复。
 *
 * 客户端的 `shouldAppendEventContent` 抄了同一份清单。加了一种会写出
 * 用户可见答案的 kind 却不加进这里，文本会流出去然后被静默丢掉 —— 而且
 * trace 里还显示着，失败完全不可见。
 */
export const ANSWER_BEARING_CALL_KINDS = Object.freeze(['llm_final_response', 'agent_loop_round']);

export function isAnswerBearingCallKind(kind) {
  return ANSWER_BEARING_CALL_KINDS.includes(kind);
}

/** 一张可见 trace 卡的 id。10 位 hex 足够短，也足够不撞。 */
export function newCallId(prefix = 'call') {
  return `${prefix}-${randomBytes(5).toString('hex')}`;
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

/**
 * 已知选项名 → 元数据字段名（camelCase → 上游的 snake_case）。
 *
 * 上游是 Python keyword 参数（`call_id=`, `trace_role=`），JS 里只能用 camelCase
 * 传，但落到 metadata 上必须还是上游那套字段名 —— 前端按 `call_id` 取值，
 * 写成 `callId` 就是一行都渲染不出来。
 */
const OPTION_FIELD_MAP = Object.freeze({
  callId: 'call_id',
  traceId: 'trace_id',
  traceRole: 'trace_role',
  traceGroup: 'trace_group',
  traceKind: 'trace_kind',
  callKind: 'call_kind',
});

/**
 * 额外字段：camelCase 键转 snake_case，已经是 snake_case 的原样过去。
 * 两种都收，是因为调用点有从上游逐句搬过来的（写 `call_state`），
 * 也有纯 JS 写的（写 `callState`），不该逼任何一边改。
 */
function normalizeExtraKey(key) {
  if (key.includes('_')) return key;
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/** 从零构造："这几个字段是必需的，其余有值才写"。 */
export function buildTraceMetadata({
  callId,
  phase,
  label,
  callKind,
  traceId = undefined,
  traceRole = undefined,
  traceGroup = undefined,
  traceKind = undefined,
  ...extra
} = {}) {
  const metadata = {
    call_id: callId,
    phase,
    label,
    call_kind: callKind,
  };
  assignIfPresent(metadata, 'trace_id', traceId);
  assignIfPresent(metadata, 'trace_role', traceRole);
  assignIfPresent(metadata, 'trace_group', traceGroup);
  assignIfPresent(metadata, 'trace_kind', traceKind);
  for (const [key, value] of Object.entries(extra)) {
    assignIfPresent(metadata, normalizeExtraKey(key), value);
  }
  return metadata;
}

/**
 * 在已有 trace 元数据上覆写。
 *
 * 与 `buildTraceMetadata` 的差别很重要：这里**保留** base 里的其它字段。
 * 子 trace 的 running/terminal 状态就是靠这个挂在原卡上的。
 */
export function deriveTraceMetadata(
  base = null,
  {
    callId = undefined,
    phase = undefined,
    label = undefined,
    callKind = undefined,
    traceId = undefined,
    traceRole = undefined,
    traceGroup = undefined,
    traceKind = undefined,
    ...extra
  } = {},
) {
  const metadata = { ...(base ?? {}) };
  assignIfPresent(metadata, 'call_id', callId);
  assignIfPresent(metadata, 'phase', phase);
  assignIfPresent(metadata, 'label', label);
  assignIfPresent(metadata, 'call_kind', callKind);
  assignIfPresent(metadata, 'trace_id', traceId);
  assignIfPresent(metadata, 'trace_role', traceRole);
  assignIfPresent(metadata, 'trace_group', traceGroup);
  assignIfPresent(metadata, 'trace_kind', traceKind);
  for (const [key, value] of Object.entries(extra)) {
    assignIfPresent(metadata, normalizeExtraKey(key), value);
  }
  return metadata;
}

export function mergeTraceMetadata(base = null, extra = null) {
  const merged = {};
  if (base) Object.assign(merged, base);
  if (extra) Object.assign(merged, extra);
  return merged;
}
