/**
 * DeepSeek 接口错误的**分类核心**（纯函数，零依赖）。
 *
 * # 为什么不按"错误码查表"处理
 *
 * 官方文档列了 7 个码（400 / 401 / 402 / 422 / 429 / 500 / 503），但**同一个码
 * 背后是不同性质的问题**，而调用方真正要做的事只有四件之一：
 *
 *   先修（不该重试） · 降并发后退避 · 谨慎重试 · 客户端侧自己改
 *
 * 所以这一层的产物不是"错误码 → 一句解释"，而是"错误码 + 错误信息 → 一个动作"。
 * 只查码会把 422 里的「上下文超限」当成「参数拼错了」，让调用方去改一个
 * 本来没错的字段；也会把 402（充值）当成 429（退避）—— 那是最贵的一种错。
 *
 * # 一条硬规则：**不确定时不要重试**
 *
 * 重试是正确的动作，只对"同一个请求再发一次可能成功"的失败。凡是**修了才可能
 * 成功**的（凭证、计费、参数、地区），重试都是在同一堵墙上多撞几次 —— 而每次
 * 都要花时间，最坏情况下把用户的额度烧在一个注定失败的请求上。
 * 拿不准属于哪一类时，`classifyError` 一律给 `fix`（不重试）：宁可让调用方
 * 早一点把问题报给人，也不要让它在重试里被稀释成"偶发失败"。
 */

/** 四种动作。调用方**只**该按这四种分支，不要按错误码分支。 */
export const ACTION = Object.freeze({
  /** 先修再试：请求或环境本身有问题，重发同一个请求不会有任何不同。 */
  FIX: 'fix',
  /** 降低并发 + 退避：DeepSeek 的限流口径是**并发数**，先减在飞请求比单纯 sleep 有效。 */
  THROTTLE: 'throttle',
  /** 谨慎重试：服务端故障，短暂等待后可以再试，但要盯着持续率。 */
  RETRY: 'retry',
  /** 客户端侧：不是服务端返回的错（超时、流停滞），要改的是本地策略。 */
  CLIENT: 'client',
});

/**
 * 分类结果里会出现的**失败面**（比官方 7 个码更细）。
 *
 * 为什么需要它：同一个 422 可能是「参数类型错」也可能是「上下文超限」，
 * 两者该做的事完全不同（前者改参数，后者减输入或降 max_tokens）。
 * 只给动作不给失败面的话，调用方能知道"别重试"，但不知道"去改哪儿"。
 */
export const FAILURE = Object.freeze({
  // ── 官方 7 个码 ──
  BAD_REQUEST: 'bad_request',              // 400 请求体畸形 / 深度思考未回传 reasoning_content
  UNAUTHORIZED: 'unauthorized',            // 401 Key 错、缺失、过期、Bearer 头不对
  INSUFFICIENT_BALANCE: 'insufficient_balance', // 402 余额不足（**独立于 429 的计费码**）
  INVALID_PARAMETER: 'invalid_parameter',   // 422 参数类型/取值非法
  RATE_LIMITED: 'rate_limited',            // 429 并发/速率上限
  SERVER_ERROR: 'server_error',            // 500 服务端内部错误
  SERVICE_BUSY: 'service_busy',            // 503 服务繁忙
  // ── 由上面几个码承载、但值得单独指出的失败面 ──
  REASONING_NOT_ECHOED: 'reasoning_not_echoed', // 400：思考模式必须回传 reasoning_content
  CONTEXT_OVERFLOW: 'context_overflow',    // 422/400：输入 + max_tokens 超窗口
  TOOL_SCHEMA_INVALID: 'tool_schema_invalid', // 422：tools 缺 name / tool.content 为空
  EMPTY_TOOL_CONTENT: 'empty_tool_content', // 422：tool 角色 content 传空串被拒
  REGION_BLOCKED: 'region_blocked',        // 403：地区/权限限制（文档未列但实际会出现）
  // ── 客户端侧（不是服务端返回的码）──
  STREAM_STALLED: 'stream_stalled',        // SSE 静默停推：HTTP 200 但不再有 chunk
  CONNECT_TIMEOUT: 'connect_timeout',      // 连接超时
  READ_TIMEOUT: 'read_timeout',            // 读超时（合法慢响应别当失败）
  UNKNOWN: 'unknown',
});

/**
 * 每个失败面的**处置描述**。
 *
 * `action` 是调用方唯一需要的分支依据；`retryable` 是它的布尔投影（方便写
 * `if (r.retryable)`）；`hint` 是给人看的"该查哪儿"，会原样进错误信息。
 */
export const PLAYBOOK = Object.freeze({
  [FAILURE.BAD_REQUEST]: {
    action: ACTION.FIX, retryable: false,
    hint: '请求体不合法：先看是否为深度思考模式（需回传 reasoning_content），再检查 JSON 结构',
  },
  [FAILURE.REASONING_NOT_ECHOED]: {
    action: ACTION.FIX, retryable: false,
    hint: '思考模式要求把上一轮 assistant 的 reasoning_content 完整回传；'
      + '要么补进历史，要么关掉思考模式 / 换非 thinking 变体',
  },
  [FAILURE.UNAUTHORIZED]: {
    action: ACTION.FIX, retryable: false,
    hint: 'API Key 错误、缺失、过期，或 Authorization: Bearer 头格式不对',
  },
  [FAILURE.INSUFFICIENT_BALANCE]: {
    action: ACTION.FIX, retryable: false,
    hint: '余额不足，唯一有效的动作是充值 —— 退避重试在这里毫无意义，别和 429 混为一谈',
  },
  [FAILURE.INVALID_PARAMETER]: {
    action: ACTION.FIX, retryable: false,
    hint: '参数类型或取值非法（max_tokens / temperature / 模型名等）',
  },
  [FAILURE.CONTEXT_OVERFLOW]: {
    action: ACTION.FIX, retryable: false,
    hint: '输入 token + max_tokens 超过模型窗口：减少输入、降 max_tokens，或换长上下文模型',
  },
  [FAILURE.TOOL_SCHEMA_INVALID]: {
    action: ACTION.FIX, retryable: false,
    hint: '工具 schema 不合法：检查 tools[i] 是否有 name、参数 schema 是否完整',
  },
  [FAILURE.EMPTY_TOOL_CONTENT]: {
    action: ACTION.FIX, retryable: false,
    hint: 'tool 角色的 content 不能是空串：某些模型要求非空，给占位文本或省略该条',
  },
  [FAILURE.REGION_BLOCKED]: {
    action: ACTION.FIX, retryable: false,
    hint: '地区或权限限制：检查出口 IP，或该模型是否需要 workspace 手动 opt-in',
  },
  [FAILURE.RATE_LIMITED]: {
    action: ACTION.THROTTLE, retryable: true,
    hint: '并发达到上限：先**减少同时在飞的请求数**（队列化 / 降并行），再退避 —— '
      + 'DeepSeek 的限制口径是并发，多建 Key 分摊不了',
  },
  [FAILURE.SERVER_ERROR]: {
    action: ACTION.RETRY, retryable: true,
    hint: '服务端内部错误：短暂等待后谨慎重试；持续出现说明是服务端问题，不是请求问题',
  },
  [FAILURE.SERVICE_BUSY]: {
    action: ACTION.RETRY, retryable: true,
    hint: '服务繁忙：短暂等待后谨慎重试；持续出现说明是服务端问题',
  },
  [FAILURE.STREAM_STALLED]: {
    action: ACTION.CLIENT, retryable: false,
    hint: '流式响应静默停推（HTTP 200 但不再有 chunk）：需要**独立的流空闲超时**'
      + '（30–60 秒），不能只靠请求总超时 —— 否则要等几分钟才发现',
  },
  [FAILURE.CONNECT_TIMEOUT]: {
    action: ACTION.CLIENT, retryable: true,
    hint: '连接超时：建议 1–3 秒；超时后可重试（此时请求还没到模型，不花钱）',
  },
  [FAILURE.READ_TIMEOUT]: {
    action: ACTION.CLIENT, retryable: true,
    hint: '读超时：长文本生成可能要 10 秒以上，按业务放宽（30 秒+）；'
      + '把读超时设太短会把合法慢响应误判成失败',
  },
  [FAILURE.UNKNOWN]: {
    action: ACTION.FIX, retryable: false,
    hint: '无法识别的失败：不重试（重试只在"同一个请求再发一次可能成功"时正确）',
  },
});

/** 官方 7 个码 → 默认失败面。**只作兜底**，实际分类会先用错误信息细分。 */
export const STATUS_OF_FAILURE = Object.freeze({
  [FAILURE.BAD_REQUEST]: 400,
  [FAILURE.UNAUTHORIZED]: 401,
  [FAILURE.INSUFFICIENT_BALANCE]: 402,
  [FAILURE.INVALID_PARAMETER]: 422,
  [FAILURE.RATE_LIMITED]: 429,
  [FAILURE.SERVER_ERROR]: 500,
  [FAILURE.SERVICE_BUSY]: 503,
});
