/**
 * 本包的错误类型。
 *
 * `code` 是**机器可读的一等公民**：HTTP 路由按它决定状态码，页面按它决定
 * 该提示「去个人面板配模型」还是「稍后重试」。把文案当控制流
 * （`message.includes('模型')`）是这类兼容层最容易腐化的地方 —— 文案一改，
 * 分支就静默失效，而且没有测试会红。
 *
 * # 从 `dsh-zju-host-paper` 迁入
 *
 * 原先住在智云的兼容层包里。合并到 vendor 后，上游与智云共用这一套错误码：
 * 它们是**同一个 HTTP 面**（`/paper-reader/*` 与 `/zw-paper/*`）的错误约定，
 * 分两处定义迟早漂移。
 */

/** 错误码。未登记的码在 `paperErrorStatus` 里一律 500。 */
export type PaperErrorCode =
  | 'INPUT'
  | 'NO_LLM'
  | 'NO_SESSION_ADMIN'
  | 'CONFIG'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'LLM_FAILED'
  | 'EMPTY'
  | 'INTERNAL';

export class PaperError extends Error {
  /** 机器可读的错误码；路由按它选状态码，页面按它选提示。 */
  readonly code: PaperErrorCode;

  constructor(code: PaperErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PaperError';
    this.code = code;
    if (details !== null && typeof details === 'object') Object.assign(this, details);
  }
}

/** code → HTTP 状态码。未登记的 code 一律 500：宁可少说，不要谎报 400。 */
export const PAPER_ERROR_STATUS: Readonly<Record<PaperErrorCode, number>> = Object.freeze({
  INPUT: 400,
  NO_LLM: 503,
  NO_SESSION_ADMIN: 503,
  CONFIG: 503,
  CANCELLED: 499,
  TIMEOUT: 504,
  LLM_FAILED: 502,
  EMPTY: 502,
  INTERNAL: 500,
});

export function paperErrorStatus(code: string): number {
  return PAPER_ERROR_STATUS[code as PaperErrorCode] ?? 500;
}
