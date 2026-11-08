/**
 * 重试与压并发的**策略层**（纯函数 + 一个小执行器，零依赖）。
 *
 * 它只做决策："这一次失败之后该怎么等、要不要降并发、还值不值得再试"。
 * 真正的请求由调用方发 —— 这个包不认识任何 HTTP 客户端。
 *
 * # 三种动作对应三种等待
 *
 * | 动作 | 等待 | 并发 | 为什么 |
 * |---|---|---|---|
 * | `throttle`（429） | 指数退避 | **主动下调** | 限流口径是并发数，光睡不动并发等于没治 |
 * | `retry`（500/503） | 短固定等待 + 抖动 | 不动 | 服务端故障，降并发帮不上 |
 * | `fix`（400/401/402/422/403） | **不等待** | — | 再发多少次都一样 |
 *
 * # 为什么 402 绝不能被当成 429
 *
 * 402 是 DeepSeek **独立于 429 的计费码**。把余额不足当限流去退避重试，
 * 结果是一边烧时间一边永远失败；而 429 当 402 处理则会让一个本来能靠等解决的
 * 问题被报成"要充值"。这两件事的区别是"钱"和"时间"，混错的代价很具体。
 */

import { ACTION } from './classify.js';
import { classifyError, shouldRetry, shouldThrottle } from './classify-error.js';

/**
 * 默认策略。数值都有理由，不要凭感觉调：
 *
 * - `baseDelayMs: 800` —— 429 往往是"并发撞顶"而不是"发得太密"，所以第一次
 *   退避不必太长（真正起效的是降并发）；太长只会让整体变慢。
 * - `maxDelayMs: 20000` —— 封顶，避免指数退避把一次调用拖成几分钟。
 * - `maxAttempts: 4` —— 含首次。再多的重试在服务端故障面前收益递减。
 * - `throttleFactor: 0.5` —— 429 时把并发砍半。DeepSeek 的并发是账号粒度，
 *   所以这是**唯一有效**的自救动作。
 * - `minConcurrency: 1` —— 砍到 1 就停（再砍就是串行了，那已经是最保守）。
 * - `jitter: 0.2` —— ±20% 抖动，避免多个 worker 同时醒来再次撞顶。
 */
export const DEFAULT_POLICY = Object.freeze({
  baseDelayMs: 800,
  maxDelayMs: 20_000,
  maxAttempts: 4,
  throttleFactor: 0.5,
  minConcurrency: 1,
  jitter: 0.2,
  /**
   * **流空闲超时**，独立于请求总超时。
   *
   * DeepSeek 的 SSE 可能在生成中途**静默停推**（典型发生在 reasoning_content
   * 输出到一半）。HTTP 是 200、流也已经开始，但上游不再推 chunk。如果只有
   * 300 秒的请求总超时，这个停滞要几分钟后才发现 —— 那几分钟是全白等的。
   * 30–60 秒的 idle 超时能在"明显不对劲"时就断掉。默认取 45 秒。
   */
  streamIdleTimeoutMs: 45_000,
  /** 连接超时：1–3 秒。太短会在网络抖动时误杀。 */
  connectTimeoutMs: 2_000,
  /** 读超时：长文本生成要 10 秒以上，按业务放宽。 */
  readTimeoutMs: 60_000,
});

/** 一次退避该等多久（带抖动）。 */
export function backoffDelay(attempt, policy = DEFAULT_POLICY) {
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (Math.random() * 2 - 1) * policy.jitter;
  return Math.max(0, Math.round(raw * jitter));
}

/** 429 之后新的并发上限（砍半，但不低于下限）。 */
export function throttleConcurrency(current, policy = DEFAULT_POLICY) {
  return Math.max(policy.minConcurrency, Math.floor(current * policy.throttleFactor));
}

/**
 * 决策：这一次失败之后做什么。
 *
 * @param {object} input
 * @param {number} input.attempt 已经试了几次（1 = 刚失败第一次）。
 * @param {number|null} [input.status] HTTP 状态码。
 * @param {string} [input.message] 错误信息。
 * @param {number} [input.concurrency] 当前并发（决定要不要下调）。
 * @param {object} [input.policy]
 * @returns {{stop:boolean, action:string, failure:string, delayMs:number, nextConcurrency:number|null,
 *            hint:string, reason:string, retryable:boolean}}
 */
export function decide({ attempt, status = null, message = '', concurrency = 1, policy = DEFAULT_POLICY } = {}) {
  const classification = classifyError({ status, message });
  const base = {
    action: classification.action,
    failure: classification.failure,
    hint: classification.hint,
    reason: classification.reason,
    retryable: classification.retryable,
  };

  // 不重试的动作：立刻停，**不等待**（等待只是在浪费用户的时间）
  if (!shouldRetry(classification)) {
    return { ...base, stop: true, delayMs: 0, nextConcurrency: null };
  }
  // 次数用尽
  if (attempt >= policy.maxAttempts) {
    return { ...base, stop: true, delayMs: 0, nextConcurrency: null,
      reason: `${classification.reason}；已重试 ${attempt} 次达到上限` };
  }

  const delayMs = classification.action === ACTION.RETRY
    // 服务端故障：短固定等待 + 抖动（不必指数增长，指数会让 503 的恢复期被拉长）
    ? Math.round(policy.baseDelayMs * (1 + (Math.random() * 2 - 1) * policy.jitter))
    : backoffDelay(attempt, policy);

  const nextConcurrency = shouldThrottle(classification) && concurrency > policy.minConcurrency
    ? throttleConcurrency(concurrency, policy)
    : null;

  return { ...base, stop: false, delayMs, nextConcurrency };
}

/**
 * 跑一个请求直到成功 / 不该重试 / 次数用尽。
 *
 * @param {object} options
 * @param {(context:{attempt:number, concurrency:number}) => Promise<any>} options.send
 *   真正发请求。抛出带 `status` / `message` 的错误即可被分类。
 * @param {(ms:number) => Promise<void>} [options.sleep] 便于测试注入。
 * @param {(event:object) => void} [options.onDecision] 每次决策回调（打日志用）。
 * @returns {Promise<any>} 成功时的返回值。
 * @throws 最后一次的原始错误（附 `llmError` 字段，带分类结论，别再包一层新错）。
 */
export async function withRetry({ send, sleep = defaultSleep, policy = DEFAULT_POLICY, concurrency = 1, onDecision } = {}) {
  let current = concurrency;
  let lastError = null;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await send({ attempt, concurrency: current });
    } catch (error) {
      lastError = error;
      const decision = decide({
        attempt,
        status: error?.status ?? error?.response?.status ?? null,
        message: error?.message ?? String(error),
        concurrency: current,
        policy,
      });
      onDecision?.({ attempt, decision });

      if (decision.stop) {
        // 把分类结论**挂在原错误上**：调用方既能 `catch` 到原始形状，
        // 又能拿到"该不该重试 / 去查哪儿"。
        error.llmError = decision;
        throw error;
      }
      if (decision.nextConcurrency != null) current = decision.nextConcurrency;
      await sleep(decision.delayMs);
    }
  }
  lastError.llmError = decide({ attempt: policy.maxAttempts, status: null, message: '重试次数用尽', policy });
  throw lastError;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
