// 源：无（本包自己的宿主接缝）。taxonomy 与 `dsh-zhiyun-host-classroom/src/errors.js`
// 同构，只把「route 还没搬」换成「provider 没配」这一层真正会遇到的失败面。
/**
 * 课堂媒体包的领域错误。
 *
 * # 为什么公开方法**返回**错误而不是 throw
 *
 * 课堂播放链路（页面包、播放器包）跑在渲染树里：`tts()` 抛一个未捕获异常，
 * 挂掉的不是一次合成，是整个课堂页。规范第 4 节对这种降级的要求是"缺失表现为状态"。
 * 所以本包的服务方法一律 resolve 一个 `{ ok: false, code, message, detail }`，
 * 调用方 `if (!result.ok)` 分支，而不是 `try/catch`。
 *
 * 领域错误**仍然是 Error 实例**（{@link MediaError} 继承 Error）：内部工具函数
 * 继续用 throw 表达，服务层在边界处转成结果。两套写法各归其位，不混用。
 */

/**
 * 错误种类。`code` 是写进契约的，改了就是破坏性变更。
 *
 * | code | 谁的问题 | 调用方该怎么办 |
 * |---|---|---|
 * | `E_NOT_CONFIGURED` | 部署侧：这个 provider 没有 key / baseURL | 提示去设置页，别重试 |
 * | `E_UNSUPPORTED_PROVIDER` | 入参：provider id 不认识 | 修正入参 |
 * | `E_INVALID_INPUT` | 入参：文本为空、URL 非法等 | 修正入参 |
 * | `E_UPSTREAM_ERROR` | 上游 HTTP 失败，`detail.retryable` 说明能不能重试 | 可重试则重试 |
 * | `E_RATE_LIMITED` | 上游 429 / 业务限流码 | 退避后重试，`detail.retryAfterMs` |
 * | `E_QUOTA_EXHAUSTED` | 套餐/余额耗尽 | 充值，别重试 |
 * | `E_INVALID_RESPONSE` | 上游 200 但回来的不是音频/图片/JSON | 换 provider |
 * | `E_DEPENDENCY_MISSING` | 本机缺原生/可选依赖（unpdf、sharp、SDK） | 装依赖，别重试 |
 * | `E_CANCELLED` | 调用方自己 abort 的 | 忽略 |
 * | `E_INTERNAL` | 我们自己的 bug | 上报 |
 */
export const ERROR_CODES = Object.freeze([
  'E_NOT_CONFIGURED',
  'E_UNSUPPORTED_PROVIDER',
  'E_INVALID_INPUT',
  'E_UPSTREAM_ERROR',
  'E_RATE_LIMITED',
  'E_QUOTA_EXHAUSTED',
  'E_INVALID_RESPONSE',
  'E_DEPENDENCY_MISSING',
  'E_CANCELLED',
  'E_INTERNAL',
]);

const CODE_SET = new Set(ERROR_CODES);

export class MediaError extends Error {
  /**
   * @param {string} code 见 {@link ERROR_CODES}；未知值落回 `E_INTERNAL`（不静默吞）
   * @param {string} message 给人看的一句话
   * @param {object} [detail] `{ provider, capability, retryable, source, hint, ... }`
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'MediaError';
    this.code = CODE_SET.has(code) ? code : 'E_INTERNAL';
    if (detail !== undefined) this.detail = detail;
    if (Error.captureStackTrace) Error.captureStackTrace(this, MediaError);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/** provider 没有可用凭证。绝不猜、绝不发一个必然 401 的请求。 */
export function notConfigured(capability, providerId, hint) {
  return new MediaError(
    'E_NOT_CONFIGURED',
    `${capability} 的 provider「${providerId ?? '(未指定)'}」没有可用配置（API key / baseURL）`,
    { capability, provider: providerId, hint: hint ?? '在课堂设置里配置该 provider，或由宿主 providers.set 写入' },
  );
}

export function unsupportedProvider(capability, providerId, known) {
  return new MediaError('E_UNSUPPORTED_PROVIDER', `${capability} 不支持 provider「${providerId}」`, {
    capability,
    provider: providerId,
    known,
  });
}

export function invalidInput(message, field) {
  return new MediaError('E_INVALID_INPUT', message, field === undefined ? undefined : { field });
}

export function dependencyMissing(dependency, capability, hint) {
  return new MediaError(
    'E_DEPENDENCY_MISSING',
    `${capability} 需要可选依赖 ${dependency}，当前运行环境未安装`,
    { dependency, capability, hint: hint ?? `npm i ${dependency}` },
  );
}

export function cancelled(message = '操作已取消') {
  return new MediaError('E_CANCELLED', message);
}

export function internal(message, detail) {
  return new MediaError('E_INTERNAL', message, detail);
}

/**
 * 把上游 `Response` 的失败转成领域错误。
 *
 * `retryable` 只看 HTTP 语义（429 / 5xx 可重试，4xx 是配置或入参问题），
 * 不猜 provider 的业务码 —— 那些由各自的 adapter 用更精确的 code 覆盖。
 */
export function upstreamError(provider, status, bodyText, extra) {
  const retryable = status === 429 || status >= 500;
  const snippet = typeof bodyText === 'string' ? bodyText.slice(0, 300) : '';
  return new MediaError(
    status === 429 ? 'E_RATE_LIMITED' : 'E_UPSTREAM_ERROR',
    `${provider} 返回 HTTP ${status}${snippet ? `：${snippet}` : ''}`,
    { provider, status, retryable, ...extra },
  );
}

export function invalidResponse(provider, message) {
  return new MediaError('E_INVALID_RESPONSE', `${provider}：${message}`, { provider });
}

/** 把任意 throw 规整成 MediaError（服务层边界用，保留 cause 便于定位）。 */
export function toMediaError(error, fallbackCode = 'E_INTERNAL') {
  if (error instanceof MediaError) return error;
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return cancelled();
  const wrapped = new MediaError(fallbackCode, error instanceof Error ? error.message : String(error), {
    cause: error instanceof Error ? error.name : typeof error,
  });
  return wrapped;
}

/** 服务方法的成功/失败信封。 */
export function ok(data) {
  return { ok: true, ...data };
}

export function fail(error) {
  const domain = toMediaError(error);
  return { ok: false, code: domain.code, message: domain.message, detail: domain.detail ?? {} };
}
