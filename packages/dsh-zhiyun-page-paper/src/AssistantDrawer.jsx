import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, useStore } from 'dsh-zhiyun-ui-primitives';
import { ask, newSession } from './library.js';
import { createSessionFeed } from './session-feed.js';

/**
 * 右侧的 AI 助手抽屉。
 *
 * # 为什么不自己接 `ctx.conversation`
 *
 * 直接调宿主会话服务在 0.2 里是**半公开**路径（`ctx.sessions.scope(id).get('conversation').send`
 * 存在但不在公开目录里，见壳里那段注释），而抽屉还要自己处理流式、引用、打断、重放。
 * 上游已经把这条链路走通了：`POST /paper-reader/api/ask` 负责「拼 prompt + 注入会话」，
 * `GET /paper-reader/api/session/follow` 把那一轮的**宿主原生 SSE**（快照 + 增量 + 实时流）
 * 推回来。所以本组件只做两件事：把问题交给 `/api/ask`，把 SSE 帧渲染成气泡
 * （帧 → 气泡的解析在纯模块 `transcript.js` 里）。
 *
 * # 「每篇论文一个会话」
 *
 * 上游按文献生成确定的会话 id（`dpr-<base64url(topic/name)>-<n>`），同一篇论文反复提问
 * 会落在同一个会话里，所以打开抽屉就能看到之前的问答；换论文 → 换 feed。
 *
 * 抽屉宽度可拖动，宽度记在 localStorage：读论文时「宽一点看答案」是常态需求。
 */

const WIDTH_KEY = 'zhiyun.paper.drawer';
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 392;

function readStoredWidth() {
  try {
    const stored = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** 一句「已发送到会话 N」的提示，2.6 秒后自己消失。 */
function useTransientMessage() {
  const [message, setMessage] = useState(null);
  const timerRef = useRef(null);
  const push = useCallback((text) => {
    setMessage(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 2600);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return [message, push];
}

export function AssistantDrawer({ topic, name, open, onToggle, selection, onSelectionConsumed, onJumpToPage }) {
  const [width, setWidth] = useState(readStoredWidth);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, pushNotice] = useTransientMessage();
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // 换论文就要换 feed（会话 id 是按文献生成的）。
  const feed = useMemo(() => createSessionFeed({ topic, name }), [topic, name]);
  const state = useStore(feed);

  useEffect(() => {
    if (!open) return undefined;
    feed.open(null);
    return () => feed.close();
  }, [feed, open]);

  // 选区从阅读器递进来：不自动发送（用户只是选中了一段英文），只聚焦输入框
  // 并把选区当引用条渲染出来，由用户决定问不问。
  useEffect(() => {
    if (!selection) return;
    if (open) inputRef.current?.focus();
  }, [selection, open]);

  // 新消息进来时贴底（只在已经接近底部时，避免抢用户正在回看的滚动）。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [state.messages.length, state.live?.text]);

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    const question = draft.trim();
    if (!question || busy) return;
    setBusy(true);
    try {
      const quote = selection?.text;
      const sent = await ask({
        topic,
        name,
        question,
        ...(quote ? { selectedText: quote, page: selection?.page ?? null } : {}),
      });
      setDraft('');
      // 连上这个会话（n 是上游给的权威编号）。之前已经连着同一个 n 时是幂等的。
      feed.open(sent.n);
      pushNotice(`已发送到会话 ${sent.n}`);
    } catch (error) {
      pushNotice(`发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, selection, topic, name, feed, pushNotice]);

  const startFresh = useCallback(async () => {
    try {
      const created = await newSession(topic, name);
      feed.open(created.n);
      pushNotice(`已新建会话 ${created.n}`);
    } catch (error) {
      pushNotice(`新建会话失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [topic, name, feed, pushNotice]);

  const startResize = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent) => {
      // 抽屉在右侧：往左拖 = 变宽。
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - moveEvent.clientX)));
      setWidth(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { globalThis.localStorage?.setItem(WIDTH_KEY, String(width)); } catch { /* 隐私模式就算了 */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [width]);

  // 记住拖动结束时的宽度（`startResize` 的闭包读不到最新的 width）。
  useEffect(() => {
    const timer = setTimeout(() => {
      try { globalThis.localStorage?.setItem(WIDTH_KEY, String(width)); } catch { /* 同上 */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [width]);

  const messages = state.messages;
  const live = state.live;

  return <aside className={`zp-drawer${open ? ' is-open' : ''}`} style={open ? { width } : undefined} aria-label="论文 AI 助手" aria-hidden={!open}>
    <div className="zp-drawer-resize" role="separator" aria-orientation="vertical" aria-label="调整助手宽度" onMouseDown={startResize}/>
    <header className="zp-drawer-head">
      <button type="button" className="zp-drawer-toggle" aria-label={open ? '收起 AI 助手' : '展开 AI 助手'} title={open ? '收起 AI 助手' : '展开 AI 助手'} onClick={onToggle}><Icon name={open ? 'chevron' : 'chat'} size={17}/></button>
      {open && <>
        <strong>AI 助手</strong>
        <span className="zp-drawer-session" title={state.sessionId ?? ''}>{state.sessionId ? `会话 ${state.n ?? '—'}` : '未连接'}</span>
        <div className="zp-drawer-head-actions">
          <button type="button" title="新建会话" aria-label="新建会话" onClick={startFresh}><Icon name="plus" size={16}/></button>
        </div>
      </>}
    </header>

    {open && <>
      <div className="zp-drawer-list" ref={listRef}>
        {messages.length === 0 && !live && <div className="zp-drawer-empty">
          <Icon name="chat" size={22}/>
          <strong>关于这篇文献，问点什么</strong>
          <p>在左侧选中英文会自动翻译；想深入就点浮层里的「就此提问」，或直接在下面输入。</p>
        </div>}
        {messages.map((message) => <Bubble key={message.id} role={message.role} text={message.text} onJumpToPage={onJumpToPage}/>)}
        {live && <Bubble role="assistant" live text={live.text} onJumpToPage={onJumpToPage}/>}
        {state.phase === 'error' && state.error && <div className="zp-drawer-error"><Icon name="close" size={14}/>{state.error}</div>}
      </div>

      <form className="zp-drawer-compose" onSubmit={submit}>
        {selection?.text && <div className="zp-drawer-quote" title={selection.text}>
          <span>选中{selection.page ? `（第 ${selection.page} 页）` : ''}</span>
          <p>{selection.text.length > 120 ? `${selection.text.slice(0, 120)}…` : selection.text}</p>
        </div>}
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="围绕这篇文献提问…（Enter 发送，Shift+Enter 换行）"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
          }}
        />
        <div className="zp-drawer-compose-actions">
          <span className="zp-drawer-hint">{busy ? '发送中…' : notice ?? '回答会带上页码引用'}</span>
          <button type="submit" className="is-primary" disabled={busy || !draft.trim()}><Icon name="arrow" size={15}/>发送</button>
        </div>
      </form>
    </>}
  </aside>;
}

/** 页码引用 `[第 12 页]` 与上游提示词里要求的 `&page=12` 链接都做成可点的跳转。 */
const PAGE_REF = /(?:^|[\s(（])(?:第\s*(\d{1,4})\s*页|\[(\d{1,4})\])/g;

function Bubble({ role, text, live = false, onJumpToPage }) {
  const parts = useMemo(() => splitPageRefs(text), [text]);
  return <div className={`zp-bubble is-${role}${live ? ' is-live' : ''}`}>
    <div className="zp-bubble-role">{role === 'user' ? '我' : '助手'}{live && <span className="zp-bubble-dot"/>}</div>
    <div className="zp-bubble-text">
      {parts.length === 0 ? '' : parts.map((part, index) => part.page
        ? <button type="button" key={index} className="zp-page-ref" onClick={() => onJumpToPage?.(part.page)}>第 {part.page} 页</button>
        : <React.Fragment key={index}>{part.text}</React.Fragment>)}
      {live && !text && <span className="zp-typing"><i/><i/><i/></span>}
    </div>
  </div>;
}

/** 把文本切成「普通文字」与「页码引用」两种片段。 */
export function splitPageRefs(text) {
  if (typeof text !== 'string' || !text) return [];
  const parts = [];
  let cursor = 0;
  PAGE_REF.lastIndex = 0;
  for (let match = PAGE_REF.exec(text); match !== null; match = PAGE_REF.exec(text)) {
    const start = match.index + (match[0].length - match[0].trimStart().length);
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ page: Number(match[1] ?? match[2]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
