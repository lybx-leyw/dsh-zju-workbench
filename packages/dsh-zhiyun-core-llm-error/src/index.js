/**
 * **DeepSeek 接口错误的分类与处置策略**（纯函数包，零 UI、零网络）。
 *
 * # 它解决的是什么问题
 *
 * 调用 DeepSeek 时，"失败了"不是一个足够的信息。官方文档列了 7 个状态码，
 * 但它们背后是**四类完全不同的动作**：
 *
 * ```
 * 先修（不要重试）   400 401 402 422 403
 * 降并发后退避       429
 * 谨慎重试           500 503
 * 客户端侧自己改     流停滞 / 连接超时 / 读超时
 * ```
 *
 * 把 402（余额不足）当 429（限流）去退避重试，是在烧时间；
 * 把 429 当 402 处理，会把一个等一会儿就好的问题报成"要充值"。
 * 把 422 里的"上下文超限"当成"参数拼错了"，会让人去改一个本来没错的字段。
 *
 * 所以这个包的产物是**动作**，不是错误码表。
 *
 * # 为什么先只做 DeepSeek
 *
 * 上面那张动作分界里有几处是 DeepSeek 独有的口径：
 *   · **402 是独立计费码**（多数服务商把它折进 429）；
 *   · **429 的限制口径是并发数**（不是 RPM/TPM），所以第一步是降并发而不是 sleep；
 *   · **思考模式必须回传 `reasoning_content`**，否则 400；
 *   · **SSE 会静默停推**，需要独立 idle 超时。
 *
 * 别家未必这样。所以 `PROVIDER` 现在只有 deepseek —— 加别家时要重新核
 * 那家的码表，而不是把 DeepSeek 的策略套上去。
 *
 * # 用法
 *
 * ```js
 * import { withRetry, classifyError } from 'dsh-zhiyun-core-llm-error';
 *
 * // ① 自动重试 / 降并发
 * const result = await withRetry({
 *   concurrency: 4,
 *   send: ({ concurrency }) => callDeepSeek({ concurrency }),
 * });
 *
 * // ② 只分类，自己决定
 * try { … } catch (error) {
 *   const r = classifyError({ status: error.status, message: error.message });
 *   if (r.action === 'fix') reportToUser(r.hint);
 * }
 * ```
 *
 * # 这里没有的东西
 *
 * 不发请求、不读环境变量、不落盘、不写 UI。它只做判断 —— 所以它能在
 * 任何宿主里用，也容易被单测钉住。
 */

export {
  ACTION, FAILURE, PLAYBOOK, STATUS_OF_FAILURE,
} from './classify.js';

export {
  classifyError, classifyClientFailure, shouldRetry, shouldThrottle,
} from './classify-error.js';

export {
  DEFAULT_POLICY, backoffDelay, throttleConcurrency, decide, withRetry,
} from './policy.js';

export { createStreamWatchdog, guardedStream } from './watchdog.js';

/** 本包当前支持的供应商。加别家要重新核码表，不要直接套用。 */
export const PROVIDER = Object.freeze({ DEEPSEEK: 'deepseek' });

/** 支持的供应商列表（诊断用）。 */
export const SUPPORTED = Object.freeze([PROVIDER.DEEPSEEK]);

/**
 * 一条**人可读**的失败说明（直接给用户看的那种）。
 *
 * 比 `hint` 多一层"现在该怎么办"的语气，因为它会被放在界面上；
 * 而 `hint` 是给日志和开发者的。
 */
export function explain(classification) {
  if (!classification) return '未知失败。';
  const { action, hint, retryable } = classification;
  const tail = retryable ? '（会自动重试）' : '（不会再重试，需要先修这个）';
  const lead = action === 'fix' ? '需要先修正' : action === 'throttle' ? '被限流，正在降并发' : action === 'retry' ? '服务端暂时故障' : '本地超时';
  return `${lead}：${hint}${tail}`;
}
