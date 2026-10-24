/**
 * 这个包的具名失败。
 *
 * ⚠️ 只有**本包自己**产生的失败才用它。调用方的 `send()` 抛出的原始错误
 *    不会被包装成这个类型 —— 那样会丢掉 `status` 与上游的 message，
 *    而分类正是靠这两样。分类结论挂在原错误的 `llmError` 字段上。
 */
export class LlmErrorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LlmErrorError';
    this.code = code;
    this.details = details;
  }
}

/** 本包会抛的码。 */
export const ERROR_CODE = Object.freeze({
  /** 策略配置不合法（例如 idleMs 为负）。 */
  CONFIG: 'CONFIG',
  /** 调用方给的输入不合法（例如既没有 status 也没有 message）。 */
  INPUT: 'INPUT',
});
