/**
 * 本包的错误类型。
 *
 * `code` 是**机器可读的一等公民**：HTTP 路由按它决定状态码，页面按它决定
 * 该提示「去个人面板配模型」还是「稍后重试」。把文案当控制流
 * （`message.includes('模型')`）是这类兼容层最容易腐化的地方 —— 文案一改，
 * 分支就静默失效，而且没有测试会红。
 */
export class PaperError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PaperError';
    this.code = code;
    if (details && typeof details === 'object') Object.assign(this, details);
  }
}

/** code → HTTP 状态码。未登记的 code 一律 500：宁可少说，不要谎报 400。 */
export const PAPER_ERROR_STATUS = Object.freeze({
  INPUT: 400,
  NO_LLM: 503,
  CONFIG: 503,
  CANCELLED: 499,
  TIMEOUT: 504,
  LLM_FAILED: 502,
  EMPTY: 502,
  INTERNAL: 500,
});

export function paperErrorStatus(code) {
  return PAPER_ERROR_STATUS[code] ?? 500;
}
