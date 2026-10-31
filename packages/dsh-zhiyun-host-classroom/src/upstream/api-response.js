/**
 * 上游 `lib/server/api-response.ts` 的移植（源文件:lib/server/api-response.ts:1-88）。
 *
 * # 改了什么，没改什么
 *
 * 只去掉了一件事：`NextResponse.json(...)`。规范第 2 通道要求 handler body 原样搬，
 * 不许保留 `NextResponse`，所以这里返回**普通对象**：
 *
 *   `{ httpStatus, body }`
 *
 * `body` 与上游 `NextResponse.json()` 的第一个参数**逐字段相同**（`success` 在前），
 * `httpStatus` 就是上游第二个参数的 `status`。这样：
 *
 * - 业务代码里 `apiSuccess({...})` / `apiError(...)` 的调用点一个字都不用改；
 * - HTTP 层（将来接进 host-bridge 的那一层）拿到 `{ httpStatus, body }` 直接回，
 *   不需要业务层知道"HTTP"这件事。
 *
 * 为什么不干脆返回裸 body：`apiError` 的 status（403/404/500）是**接口契约的一部分**，
 * 丢掉它，调用方只能从 errorCode 猜；猜错就会出现「403 被当成 500 去重试」这类错误。
 *
 * 错误码表 `API_ERROR_CODES` 原样保留。它是 L2/L3 共同的词表，散落到各处就等于没有词表。
 */

export const API_ERROR_CODES = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_PROVIDER: 'MISSING_PROVIDER',
  MISSING_MODEL: 'MISSING_MODEL',
  MODEL_CONFIG_INVALID: 'MODEL_CONFIG_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REQUEST: 'INVALID_REQUEST',
  CREATE_REFUSED: 'CREATE_REFUSED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_QUOTA_EXCEEDED: 'ASSET_QUOTA_EXCEEDED',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  VOXCPM_AUTO_VOICE_REQUIRES_CONTEXT: 'VOXCPM_AUTO_VOICE_REQUIRES_CONTEXT',
  INVALID_URL: 'INVALID_URL',
  REDIRECT_NOT_ALLOWED: 'REDIRECT_NOT_ALLOWED',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  CONTENT_SENSITIVE: 'CONTENT_SENSITIVE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  QWEN_VC_CONFIG_MISSING: 'QWEN_VC_CONFIG_MISSING',
  QWEN_VC_ENDPOINT_INVALID: 'QWEN_VC_ENDPOINT_INVALID',
  QWEN_VC_HTTP_ERROR: 'QWEN_VC_HTTP_ERROR',
  QWEN_VC_TIMEOUT: 'QWEN_VC_TIMEOUT',
  QWEN_VC_TRANSPORT_ERROR: 'QWEN_VC_TRANSPORT_ERROR',
  QWEN_VC_RESPONSE_JSON_INVALID: 'QWEN_VC_RESPONSE_JSON_INVALID',
  QWEN_VC_RESPONSE_VOICE_MISSING: 'QWEN_VC_RESPONSE_VOICE_MISSING',
  QWEN_VC_RESPONSE_AUDIO_URL_MISSING: 'QWEN_VC_RESPONSE_AUDIO_URL_MISSING',
  QWEN_VC_AUDIO_URL_INVALID: 'QWEN_VC_AUDIO_URL_INVALID',
  QWEN_VC_AUDIO_DOWNLOAD_FAILED: 'QWEN_VC_AUDIO_DOWNLOAD_FAILED',
  QWEN_VC_AUDIO_TOO_LARGE: 'QWEN_VC_AUDIO_TOO_LARGE',
  QWEN_VC_AUDIO_EMPTY: 'QWEN_VC_AUDIO_EMPTY',
  QWEN_VC_VOICE_NOT_FOUND: 'QWEN_VC_VOICE_NOT_FOUND',
  QWEN_VC_BOOTSTRAP_UNSUPPORTED: 'QWEN_VC_BOOTSTRAP_UNSUPPORTED',
  QWEN_VC_REFERENCE_AUDIO_INVALID: 'QWEN_VC_REFERENCE_AUDIO_INVALID',
  QWEN_TTS_ERROR: 'QWEN_TTS_ERROR',
  TTS_INVALID_RESPONSE: 'TTS_INVALID_RESPONSE',
  GENERATION_FAILED: 'GENERATION_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ACTIVE_RUN_LIMIT: 'ACTIVE_RUN_LIMIT',
  RUN_STATE_CONFLICT: 'RUN_STATE_CONFLICT',
};

/**
 * 成功响应。上游签名 `apiSuccess<T>(data: T, status = 200)`（源文件:lib/server/api-response.ts:78）。
 *
 * @template {Record<string, unknown>} T
 * @param {T} data
 * @param {number} [status]
 * @returns {{ httpStatus: number, body: { success: true } & T }}
 */
export function apiSuccess(data, status = 200) {
  return { httpStatus: status, body: { success: true, ...data } };
}

/**
 * 失败响应（源文件:lib/server/api-response.ts:59-76）。
 *
 * `details` / `reason` 的省略规则与上游一致：假值（空串、undefined）**不出现**在 body 里，
 * 而不是出现成 `null` —— 这条差异会让客户端的 `'reason' in body` 判据翻转。
 *
 * @param {string} code 见 {@link API_ERROR_CODES}
 * @param {number} status HTTP 状态码
 * @param {string} error
 * @param {string} [details]
 * @param {string} [reason]
 */
export function apiError(code, status, error, details, reason) {
  return {
    httpStatus: status,
    body: {
      success: false,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
      ...(reason ? { reason } : {}),
    },
  };
}
