// 源：ref/OpenMAIC/lib/server/generation/run/failure-code.ts:1-65（失败码是封闭枚举）
// 源：ref/OpenMAIC/lib/server/generation/run/start.ts:88-127（startRefusal 的形状：code + message + detail）

/**
 * 生成管线的领域错误。
 *
 * # 为什么错误码要单独一个文件
 *
 * 与 `dsh-zhiyun-host-classroom/src/errors.js` 同一条纪律：上层（页面/编排）
 * 靠 `code` 决定「重试、换模型、还是让用户改 brief」，字符串匹配是最脆的写法。
 * 所以种类是**封闭枚举**，未知种类一律落回 `E_INTERNAL`，绝不静默吞掉。
 *
 * | code | 谁的问题 | 调用方该怎么办 |
 * |---|---|---|
 * | `E_INVALID_INPUT` | brief / opts 不合法 | 改 brief，别重试 |
 * | `E_MISSING_SERVICE` | `zhiyunClassroomVault` 或缺 studio | 装插件，别重试 |
 * | `E_NO_LLM_PROVIDER` | `zhiyunClassroomStudio.providers` 里没有可用对话模型 | 去设置页配模型 |
 * | `E_NO_LLM_TRANSPORT` | provider 解析到了，但没有可调用的通道 | 注入 `config.llm` |
 * | `E_UPSTREAM_ERROR` | 模型侧失败（HTTP/超时/凭证） | 可重试 |
 * | `E_BAD_OUTPUT` | 模型回了非 JSON / 结构不合法 | 可重试（换模型更稳） |
 * | `E_NOT_FOUND` | runId 不在内存里，也没有落盘记录 | 刷新列表 |
 * | `E_MATERIAL_UNAVAILABLE` | 传了 `materialIds` 但一份都读不出来（字节缺失 / 解析失败） | 重新上传讲义；别重试生成 |
 * | `E_CANCELLED` | 调用方自己取消的 | 忽略 |
 * | `E_INTERNAL` | 我们自己走到了不该到的分支 | 上报 |
 */

export const ERROR_CODES = Object.freeze([
  'E_INVALID_INPUT',
  'E_MISSING_SERVICE',
  'E_NO_LLM_PROVIDER',
  'E_NO_LLM_TRANSPORT',
  'E_UPSTREAM_ERROR',
  'E_BAD_OUTPUT',
  'E_NOT_FOUND',
  'E_MATERIAL_UNAVAILABLE',
  'E_CANCELLED',
  'E_INTERNAL',
]);

export class ClassroomGenerateError extends Error {
  /**
   * @param {string} code 见 {@link ERROR_CODES}；未知值落回 `E_INTERNAL`
   * @param {string} message 给人看的一句话（页面可以直接显示）
   * @param {object} [detail] 结构化细节（字段名、上游原文、phase 等）
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'ClassroomGenerateError';
    // `code` 是契约字段：上层按它分支，不要改成 `kind`（那是 host-classroom 的命名，
    // 本包在 `run-error` 事件里统一用 `code`，两个包的事件形状本来就不同）。
    this.code = ERROR_CODES.includes(code) ? code : 'E_INTERNAL';
    if (detail !== undefined) this.detail = detail;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ClassroomGenerateError);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/** 取消是「预期内」的终止，不是失败：`phase` 只用于给事件定位。 */
export function cancelled(phase, runId) {
  return new ClassroomGenerateError('E_CANCELLED', `run ${runId} 已被取消`, { phase, runId });
}

/** 把任意抛出物折成 `{ code, message }`，给 `run-error` 事件的 payload 用。 */
export function describeError(error, fallbackCode = 'E_INTERNAL') {
  if (error instanceof ClassroomGenerateError) {
    return { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = ERROR_CODES.includes(error?.code) ? error.code : fallbackCode;
  return { code, message };
}
