/**
 * 把上游的会话 SSE 变成可订阅的 store（页面用 `useStore` 读它）。
 *
 * 做成「纯 store + 注入 EventSource」而不是写进 React 组件里，理由是可测：
 * SSE 的重连、换会话、`meta` 帧与消息帧的到达顺序，全是靠人手点不出来、
 * 但写错了会让抽屉看起来「不回答」的地方。`tests/paper.test.mjs` 用一个假
 * EventSource 直接驱动这个 store。
 *
 * # 三条来自宿主真实行为的约束
 *
 *   1. 上游那 24 条路由里 SSE 是**唯一**长连接。它先写一行 `: connected` 注释，
 *      再写一个**具名** `event: meta`，之后才是没有 `event:` 行的数据帧。
 *      具名事件不会进 `onmessage` —— 所以 `meta` 必须单独监听，
 *      否则我们永远不知道当前会话号。
 *   2. 换会话必须**换 URL**（`n` 在 query 上），无法在一条连接里切换。
 *      所以 `open(n)` 的语义是「关掉旧的、开一条新的」。
 *   3. 断线由浏览器自动重连，重连后会**从头推一遍 snapshot**。我们的
 *      `applyFrame` 按消息 id 去重，所以重连不会出现重复气泡。
 */

import { applyFrame, EMPTY_FEED } from './transcript.js';
import { followUrl } from './library.js';

/**
 * @param options.topic / options.name - 当前文献（渲染时固定，切换文献要换 store）。
 * @param options.eventSourceFactory - 注入点，默认 `url => new EventSource(url)`。
 */
export function createSessionFeed({ topic, name, eventSourceFactory } = {}) {
  const make = eventSourceFactory ?? ((url) => new EventSource(url));

  let source = null;
  let activeN = null;
  let feed = EMPTY_FEED;
  let state = { phase: 'idle', n: null, sessionId: null, error: null };
  const listeners = new Set();

  // 快照必须是**同一个对象**直到状态真的变了：`useStore` 是 `useSyncExternalStore`，
  // 每次调用都返回新对象会让 React 认为「又变了」而无限重渲染（#185），
  // 崩掉的不只是抽屉，是整个插槽。所以只在 emit 时重建一次。
  let snapshot = { ...state, messages: feed.messages, live: feed.live };

  const emit = () => {
    snapshot = { ...state, messages: feed.messages, live: feed.live };
    for (const listener of listeners) listener();
  };
  const setState = (patch) => {
    const next = { ...state, ...patch };
    const changed = Object.keys(next).some((key) => next[key] !== state[key]);
    if (!changed) return;
    state = next;
    emit();
  };

  const pushFrame = (frame) => {
    const next = applyFrame(feed, frame);
    if (next.messages === feed.messages && next.live === feed.live) return;
    feed = next;
    emit();
  };

  const detach = () => {
    if (!source) return;
    source.onmessage = null;
    source.onerror = null;
    try { source.close(); } catch { /* 已经关掉就算了 */ }
    source = null;
  };

  /**
   * 连上第 `n` 个会话（`n` 省略 = 让上游挑该文献最新的一个）。
   * 重复调用同一个 n 是幂等的（不会重连，避免抽屉每次重渲染都断一次）。
   */
  const open = (next) => {
    const target = next ?? null;
    if (source && activeN === target) return;
    detach();
    activeN = target;
    feed = EMPTY_FEED;
    setState({ phase: 'connecting', n: target, sessionId: null, error: null });
    emit();

    let created;
    try {
      created = make(followUrl(topic, name, target));
    } catch (err) {
      setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    source = created;

    created.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return; // 半个 JSON 不值得让整个抽屉报错
      }
      setState({ phase: 'open' });
      pushFrame(frame);
    };

    // 具名 `meta`：上游在数据帧之前告诉我们真实会话号（我们请求的 n 可能被上游改写）。
    created.addEventListener('meta', (event) => {
      let info = null;
      try { info = JSON.parse(event.data); } catch { info = null; }
      if (!info) return;
      activeN = typeof info.n === 'number' ? info.n : activeN;
      setState({ phase: 'open', n: info.n ?? activeN, sessionId: info.sessionId ?? null });
    });

    created.addEventListener('error', (event) => {
      // 两种 error 长在同一事件名上：上游发的（有 data）与连接断的（没有 data）。
      const payload = event?.data ? safeParse(event.data) : null;
      if (payload?.error) {
        setState({ phase: 'error', error: String(payload.error) });
        return;
      }
      // 浏览器会自己重连；这里只如实说明「现在断了」，不清空已有消息。
      setState({ phase: 'error', error: '与后端的连接中断了，正在重试…' });
    });
  };

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    open,
    close() { detach(); activeN = null; feed = EMPTY_FEED; setState({ phase: 'idle', sessionId: null }); },
    get n() { return activeN; },
  };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
