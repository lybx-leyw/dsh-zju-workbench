/**
 * 把一次失败归到 `FAILURE` 里的某一面，并给出 `PLAYBOOK` 的处置。
 *
 * # 为什么必须看错误信息，不能只看状态码
 *
 * | 状态码 | 光看码会得出的结论 | 实际可能是 |
 * |---|---|---|
 * | 400 | 请求体畸形 | 深度思考模式没回传 `reasoning_content` |
 * | 422 | 参数类型错 | 上下文超限 / tools 缺 name / tool.content 为空 |
 * | 403 | （文档没列，按未知处理）| 地区或权限限制 |
 *
 * 这三条里，只有 422 的三种子情况会导向**不同的修法**，而它们的区分完全
 * 依赖错误信息里的文字。所以这里先按状态码定大类，再用**消息特征**细分。
 *
 * # 特征匹配是宽进的
 *
 * 匹配串取官方错误信息里那些**稳定的英文片段**（`maximum context length`、
 * `reasoning_content`、`tool`）。各家代理服务可能改写措辞，所以：
 *   · 匹配不上就退回状态码的默认面（不猜）；
 *   · 全部正则都写成大小写不敏感。
 */

import { ACTION, FAILURE, PLAYBOOK, STATUS_OF_FAILURE } from './classify.js';

/** 消息特征 → 失败面（顺序有意义：越具体的越靠前）。 */
const MESSAGE_RULES = [
  // 深度思考模式：这是 DeepSeek 推理模型独有的 400
  { re: /reasoning_content|thinking mode|must be passed back/i, failure: FAILURE.REASONING_NOT_ECHOED },
  // 上下文预算超限：常落在 422 或 400
  { re: /maximum context length|context length is|exceed(s|ed)? .*context|too many tokens/i, failure: FAILURE.CONTEXT_OVERFLOW },
  // 工具 schema：tools[i] 缺 name 之类
  { re: /\btools?\b.*(name|schema|required)|tool[_ ]?call.*(invalid|schema)/i, failure: FAILURE.TOOL_SCHEMA_INVALID },
  // tool 消息 content 空串
  { re: /tool.*content.*(empty|must not be empty|null)/i, failure: FAILURE.EMPTY_TOOL_CONTENT },
  // 地区 / 权限
  { re: /region|country|not available in your|permission|workspace.*(access|opt.?in)/i, failure: FAILURE.REGION_BLOCKED },
];

/** 状态码 → 默认失败面（含文档未列的 403 与 5xx 家族）。 */
function failureOfStatus(status) {
  if (status === 400) return FAILURE.BAD_REQUEST;
  if (status === 401) return FAILURE.UNAUTHORIZED;
  if (status === 402) return FAILURE.INSUFFICIENT_BALANCE;
  if (status === 403) return FAILURE.REGION_BLOCKED;
  if (status === 422) return FAILURE.INVALID_PARAMETER;
  if (status === 429) return FAILURE.RATE_LIMITED;
  if (status === 500) return FAILURE.SERVER_ERROR;
  if (status === 503) return FAILURE.SERVICE_BUSY;
  // 5xx 的其它码（502/504…）按服务端问题处理：它们同样是"再发一次可能成功"
  if (status >= 500 && status < 600) return FAILURE.SERVER_ERROR;
  return FAILURE.UNKNOWN;
}

/**
 * 分类一次**服务端返回**的失败。
 *
 * @param {object} input
 * @param {number|null} input.status HTTP 状态码（拿不到就传 null）。
 * @param {string} [input.message] 错误信息原文（各类细分都靠它）。
 * @param {string} [input.code] 上游若自己给了更细的码（如 `context_length_exceeded`），一并参考。
 * @returns {{failure:string, action:string, retryable:boolean, hint:string, status:number|null, reason:string}}
 *   `reason` 说明"凭什么这么判"（匹配到的特征 / 兜底依据），进日志比只报一个结论有用得多。
 */
export function classifyError({ status = null, message = '', code = '' } = {}) {
  const text = `${code ?? ''} ${message ?? ''}`.trim();

  // ① 先用消息特征细分（比状态码更具体）
  for (const rule of MESSAGE_RULES) {
    if (rule.re.test(text)) {
      // 地区限制与上下文超限这两类，一旦匹配就以它为准（状态码 400/422 太粗）
      return verdict(rule.failure, status, `消息命中 ${rule.re}`);
    }
  }

  // ② 退回状态码
  const failure = failureOfStatus(status);
  return verdict(failure, status,
    status == null ? '没有状态码，也没有可识别的特征' : `按状态码 ${status} 判定`);
}

/**
 * 分类**客户端侧**的失败（不是服务端返回的码）。
 *
 * 单独一个入口是有意的：这类失败的处置是"改本地策略"，而不是"重发请求"，
 * 混进 `classifyError` 会让调用方以为收到的是服务端结论。
 *
 * @param {'stream_stalled'|'connect_timeout'|'read_timeout'} kind
 */
export function classifyClientFailure(kind) {
  const failure = kind === 'stream_stalled' ? FAILURE.STREAM_STALLED
    : kind === 'connect_timeout' ? FAILURE.CONNECT_TIMEOUT
    : kind === 'read_timeout' ? FAILURE.READ_TIMEOUT
    : FAILURE.UNKNOWN;
  return verdict(failure, null, `客户端侧失败：${kind}`);
}

/** 组装最终结果（所有出口都过这里，保证形状一致）。 */
function verdict(failure, status, reason) {
  const plan = PLAYBOOK[failure] ?? PLAYBOOK[FAILURE.UNKNOWN];
  return {
    failure,
    action: plan.action,
    retryable: plan.retryable,
    hint: plan.hint,
    status,
    expectedStatus: STATUS_OF_FAILURE[failure] ?? null,
    reason,
  };
}

/** 只有这两种动作值得再发一次请求；`client` 里只有超时类可以。 */
export function shouldRetry(classification) {
  return Boolean(classification?.retryable)
    && (classification.action === ACTION.THROTTLE
      || classification.action === ACTION.RETRY
      || classification.action === ACTION.CLIENT);
}

/**
 * 这个失败值不值得**降并发**后再试。
 *
 * 与 `shouldRetry` 分开是有意的：429 的正确第一步是**减少在飞请求**
 * （DeepSeek 的限流口径是并发数），而不是"睡一会儿再按原并发发"。
 * 调用方如果只有一个"重试"分支，就会把这一步漏掉。
 */
export function shouldThrottle(classification) {
  return classification?.action === ACTION.THROTTLE;
}
