/**
 * pet 流式的**客户端 store**：消费 SSE，把 `delta` 拼成一个会长的气泡。
 *
 * # 为什么做成 store 而不是写在 React 里
 *
 * 流式的三种失败模式（连不上、中途 error 帧、客户端回退到非流式）
 * 都很难靠手点复现，而写错的表现又恰好是"气泡卡住"这种看不出原因的样子。
 * 抽成 store 之后，`tests/planning-pet-stream.test.mjs` 用一个假 EventSource
 * 就能把三种都跑到。
 *
 * # 三条来自真实行为的约束
 *
 *   1. **不能用 `onmessage` 收具名事件**。我们发的是 `event: delta` /
 *      `event: final` / `event: error`，具名事件不会进 `onmessage` ——
 *      必须 `addEventListener` 逐个监听，否则永远收不到内容。
 *   2. **`final` 一定要关连接**。服务端发完就 `res.end()`，但浏览器侧
 *      对已结束的流会尝试重连；不主动 close 会在服务端留下半开连接。
 *   3. **失败要能退回非流式**。老模型通道不支持 `callStream` 时服务端回
 *      `NO_STREAM`，这时不能报错给用户，而要悄悄用普通 `pet-chat` 再来一次。
 */

/**
 * @param options.url - SSE 地址（含 `?pet-stream`）。
 * @param options.body - `{ text, history }`，会以 POST 发出。
 * @param options.eventSourceFactory - 注入点：默认用 `fetch` 读流（见下）。
 * @param options.onDelta - 每段人话。
 * @param options.onFinal - 收尾：`{ say, action, draft, notes }`。
 * @param options.onError - 失败原因。
 */
export function createPetStream({
  url, body, fetchImpl, onDelta, onFinal, onError,
} = {}) {
  const doFetch = fetchImpl ?? ((target, init) => fetch(target, init));
  let cancelled = false;
  // 本次是否收到了任何正文（用于上层判断"流式根本没跑起来"）
  const outcome = { deltas: 0, final: false, unsupported: false, errored: false };

  /**
   * 用 `fetch` + `ReadableStream` 而不是 `EventSource`。
   *
   * `EventSource` 只能发 GET，而我们的请求体里有 `text` / `history`（可能几百字）。
   * 塞进 query 会撞 URL 长度上限，还会让历史内容出现在访问日志里。
   * 服务端发的是标准 SSE 帧格式，`fetch` 读流后自己切帧即可。
   */
  const run = async () => {
    let response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zhiyun-planning': '1' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!cancelled) onError?.(`连接失败：${error?.message ?? error}`);
      return;
    }

    // 非 SSE 响应 = 服务端直接拒绝了（没接线 / 不支持流式），
    // 把 JSON 里的错误读出来，让调用方决定要不要退回普通模式
    const type = response.headers?.get?.('content-type') ?? '';
    if (!response.ok || !type.includes('text/event-stream')) {
      let message = `请求失败（${response.status}）`;
      let code = null;
      try {
        const payload = await response.json();
        message = payload?.error?.message ?? payload?.error ?? message;
        code = payload?.error?.code ?? null;
      } catch { /* 不是 JSON，就用状态码 */ }
      outcome.unsupported = code === 'NO_STREAM';
      outcome.errored = !outcome.unsupported;
      if (!cancelled) onError?.(message, { code, status: response.status });
      return;
    }

    const reader = response.body?.getReader?.();
    if (!reader) { onError?.('这个浏览器不支持流式读取'); return; }
    const decoder = new TextDecoder();
    let buffer = '';

    /**
     * 切帧：SSE 的一帧是 `event: X\ndata: Y\n\n`。这里只认我们发的三种。
     */
    const consume = (block) => {
      let event = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      const data = dataLines.join('\n');
      if (event === 'delta') { outcome.deltas += 1; onDelta?.(data); return; }
      if (event === 'final') {
        try {
          const payload = JSON.parse(data);
          outcome.final = true;
          onFinal?.(payload);
        } catch { onError?.('收尾数据看不懂'); }
        return;
      }
      if (event === 'error') {
        let message = data;
        try { message = JSON.parse(data)?.message ?? data; } catch { /* 原文 */ }
        outcome.errored = true;
        onError?.(message);
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        // 帧之间用空行分隔
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (block.trim()) consume(block);
        }
        if (cancelled) break;
      }
      // 收尾时可能还剩最后一帧没有结尾空行
      if (buffer.trim()) consume(buffer);
    } catch (error) {
      if (!cancelled) onError?.(`读流中断：${error?.message ?? error}`);
    } finally {
      try { reader.releaseLock?.(); } catch { /* 已释放 */ }
    }
  };

  return {
    /** 跑完这一次；返回结果供上层决定要不要回退到非流式。 */
    async start() { await run(); return { ...outcome }; },
    cancel() { cancelled = true; },
  };
}
