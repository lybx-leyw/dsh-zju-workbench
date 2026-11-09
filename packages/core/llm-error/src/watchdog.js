/**
 * **流空闲看门狗**：给 SSE / 流式响应单独设一个 idle 超时。
 *
 * # 为什么不能只靠请求总超时
 *
 * DeepSeek 的流式响应可能在生成中途**静默停推**：HTTP 200、流已建立、
 * 前面也收到过 chunk，然后上游不再推任何东西。这时候：
 *
 *   · 请求总超时（通常 300 秒）还在走 —— 要等满 5 分钟才发现；
 *   · 读超时（`readTimeoutMs`）在很多客户端里是"单个 read 的等待"，
 *     语义对，但常常被设成和总超时一样长，于是同样等很久。
 *
 * 工程上的解法是**独立的空闲超时**：只要"连续 N 秒没有新 chunk"就判定停滞。
 * 30–60 秒足够 —— 正常生成时 chunk 是连续的，静默 45 秒一定是出事了。
 *
 * # 这个包不认识任何 HTTP 客户端
 *
 * 所以这里给的是一个**通用的看门狗**：调用方在每次读到 chunk 时 `touch()`，
 * 它自己负责在空闲过久时 reject。不绑定 fetch / axios / 任何 SDK。
 */

import { classifyClientFailure } from './classify-error.js';

/**
 * 造一个空闲看门狗。
 *
 * @param {object} options
 * @param {number} options.idleMs 连续多久没有新数据就判定停滞。
 * @param {AbortController} [options.controller] 超时后要中止的东西（通常是请求）。
 * @param {(info:object)=>void} [options.onStall] 停滞时的回调（打日志）。
 * @returns {{touch:()=>void, stop:()=>void, promise:Promise<never>}}
 *   `promise` 会**永远 pending 到停滞或 stop()**；用法是把它和真正的读循环
 *   `Promise.race` 起来 —— 谁先有结果谁说了算。
 */
export function createStreamWatchdog({ idleMs, controller, onStall } = {}) {
  if (!Number.isFinite(idleMs) || idleMs <= 0) throw new RangeError('idleMs 须为正数');

  let timer = null;
  let settled = false;
  let lastTouchAt = Date.now();
  let resolveStall, rejectStall;
  const promise = new Promise((_, reject) => { rejectStall = reject; });
  // 这个 promise 只用于"停滞时 reject"，所以不会 resolve；
  // 显式吞掉避免 stop() 之后出现 unhandled rejection。
  promise.catch(() => {});

  const arm = () => {
    if (settled) return;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const silentMs = Date.now() - lastTouchAt;
      const classification = classifyClientFailure('stream_stalled');
      const error = Object.assign(
        new Error(`流式响应已静默 ${Math.round(silentMs / 1000)} 秒（空闲超时 ${Math.round(idleMs / 1000)} 秒）：${classification.hint}`),
        { code: 'STREAM_STALLED', llmError: classification },
      );
      onStall?.({ silentMs, idleMs, error });
      // 先中止底层请求，再 reject —— 反过来的话调用方可能还在等 socket
      try { controller?.abort(error); } catch { /* 已中止 */ }
      rejectStall(error);
    }, idleMs);
    // Node 里这个定时器不该把进程钉住
    if (typeof timer.unref === 'function') timer.unref();
  };

  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

  arm();

  return {
    /** 每收到一个 chunk 调一次（重置计时）。 */
    touch() { lastTouchAt = Date.now(); clear(); arm(); },
    /** 正常结束时调（否则定时器还在跑）。 */
    stop() { settled = true; clear(); },
    promise,
  };
}

/**
 * 把"读流"与"空闲看门狗"合并成一个异步迭代器。
 *
 * 用法：
 * ```js
 * for await (const chunk of guardedStream(response.body, { idleMs: 45_000, controller })) { … }
 * ```
 *
 * ⚠️ 迭代结束后看门狗会被 stop()，所以**不需要**调用方自己清理。
 *
 * @param {AsyncIterable<any>} source 原始流
 * @param {{idleMs:number, controller?:AbortController, onStall?:Function}} options
 */
export async function* guardedStream(source, options) {
  const dog = createStreamWatchdog(options);
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      // 谁先来算谁：下一个 chunk，或者停滞
      const next = await Promise.race([iterator.next(), dog.promise]);
      if (next.done) return;
      dog.touch();
      yield next.value;
    }
  } finally {
    dog.stop();
    /* ⚠️ **不要 await** `iterator.return()`。
     *
     * 停滞时底层的 `next()` 正挂在一个永不 resolve 的 promise 上；`return()`
     * 往往也要等那一次 `next()` 释放才能收尾 —— 一 await 就把调用方也钉死，
     * 于是"空闲超时"变成了"永远不超时"，比不加看门狗还糟。
     * 这里只**发起**收尾，不等它；底层流由 controller 中止（那才是真正让它
     * 停下来的手段）。
     */
    try { iterator.return?.()?.catch?.(() => {}); } catch { /* 同步抛也忽略 */ }
  }
}
