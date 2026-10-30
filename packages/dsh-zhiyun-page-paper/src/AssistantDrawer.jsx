import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, useStore } from 'dsh-zhiyun-shell-ui';
import { MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { ask, newSession } from './library.js';
import { createSessionFeed } from './session-feed.js';
import { SessionPalette } from './SessionPalette.jsx';
import { linkCitations, pageFromLink } from './citations.js';
import { RESUME_COMMAND_TEXT, isResumeCommand } from './resume.js';

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

/**
 * 宿主 Markdown 渲染器的文案。
 *
 * 必须是**模块级常量**：`MarkdownText` 按 `labels` 的**身份**缓存它的组件表
 * （宿主源码注释：「a fresh object per render would rebuild MarkdownText's
 * component table every chunk」），每次渲染新建一个字面量会让流式回答每来一个
 * 增量就重建一遍。`packages/dsh-zhiyun-page-study/src/lecture-reader.jsx` 也是这么写的。
 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

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
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  // 抽屉收起 / 换论文时把面板一并关掉，否则下次展开会顶着一个陈旧的列表。
  useEffect(() => {
    if (!open) setPaletteOpen(false);
  }, [open]);
  useEffect(() => { setPaletteOpen(false); }, [topic, name]);

  // 新消息进来时贴底。**默认就是贴底的** —— 追问是这里的主循环，回答生成到一半
  // 却停在上面几屏之外，用户会以为「没反应」。
  //
  // 只有一种情况不抢滚动：**用户自己往上翻了**（当前视图离底部超过一屏的 1.5 倍）。
  // 这不是猜的：能往上翻说明用户正在回看历史，此时把他拽回底部是打断。
  // 换会话 / 首屏时 `scrollTop` 是 0，距底必然大于阈值 —— 所以那两个时刻要
  // 单独强制贴底，否则「切回旧会话默认停在最上面」正是用户抱怨的那个问题。
  /**
   * 新消息来时贴底 —— 但**只在用户没有主动往上翻的时候**。
   *
   * # 旧实现的 bug
   *
   * 判据是「当前离底部是否小于 1.5 屏」。可展开抽屉时内容还是空的
   * （`scrollTop=0`、`maxScroll=0`），历史消息随后**一次性到达**；
   * 那一刻 `away` 等于**全部历史的高度**，历史一多就远超 1.5 屏，
   * 于是被误判成「用户正在回看历史」而不贴底 —— 这正是
   * 「打开后停在最上面」的来源。
   *
   * # 现在的判据
   *
   * 用 `userScrolledRef` 记「用户是否真的手动滚动过」：
   *   - 只有 `scroll` 事件（且不是我们程序改的）才置 true；
   *   - 展开/换会话/切换时清零 —— 那是新上下文，应当重新贴底。
   * 于是「一次都没滚过」的初始状态永远贴底，而用户回看历史时也不会被拽走。
   */
  const userScrolledRef = useRef(false);
  // 「这一次 scroll 是我们自己改的」标记。程序改 `scrollTop` 同样会触发 scroll 事件，
  // 不区分的话，一次自动贴底就会被当成"用户往上翻了"，从此再也不贴底（更难查）。
  const programmaticRef = useRef(false);

  /**
   * 贴底。
   *
   * ⚠️ 两点讲究：
   *   1. 打「程序发起」标记 —— 否则自己触发的 scroll 事件会被监听器当成
   *      "用户往上翻了"，从此再也不贴底（这个坑很难查）。
   *   2. **连做两帧**。消息密集到达时，第一次赋值那一刻 `scrollHeight` 可能
   *      还没反映刚渲染的内容（浏览器尚未 reflow），于是只滚到"上一版的底部"，
   *      差出几十像素。下一帧再补一次就稳定贴底。
   */
  const scrollToBottom = useCallback((list) => {
    if (list === null) return;
    programmaticRef.current = true;
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(() => {
      if (!list.isConnected) return;
      programmaticRef.current = true;
      list.scrollTop = list.scrollHeight;
    });
  }, []);

  // 新消息 / 流式文本增长：只要用户没翻过，就贴底。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    if (userScrolledRef.current) return;
    scrollToBottom(list);
  }, [state.messages.length, state.live?.text, scrollToBottom]);

  // 展开 / 换会话 / 首屏：**强制**贴底（用户的「打开后停在最上面」正是这里）。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    userScrolledRef.current = false;
    scrollToBottom(list);
  }, [open, state.sessionId, topic, name, scrollToBottom]);

  // 只有真正的用户滚动才置位。`programmaticRef` 由上面的 `scrollToBottom` 标记。
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    const onScroll = () => {
      if (programmaticRef.current) { programmaticRef.current = false; return; }
      const away = list.scrollHeight - list.scrollTop - list.clientHeight;
      // 贴着底不算「往上翻」：内容变长时浏览器会自动微调 scrollTop。
      userScrolledRef.current = away > 4;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [open, state.sessionId]);

  // 展开 / 换会话 / 换论文：重置「用户翻过」的标记，让下一次消息到达时重新贴底。
  useEffect(() => {
    userScrolledRef.current = false;
  }, [open, state.sessionId, topic, name]);

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    const question = draft.trim();
    if (!question || busy) return;
    // `/resume` 不发给模型：它是本地的会话管理入口（见 `resume.js` 的注释）。
    // 必须**在** busy 检查之后、发送之前拦下，否则这行字会被当成问题发给论文助手。
    if (isResumeCommand(question)) {
      setDraft('');
      setPaletteOpen(true);
      return;
    }
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

  /** 从 `/resume` 面板切到某条旧会话。`n` 是上游的权威编号。 */
  const pickSession = useCallback((row) => {
    setPaletteOpen(false);
    if (!row) return;
    feed.open(row.n);
    pushNotice(`已切到会话 ${row.n}`);
  }, [feed, pushNotice]);

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
          <button type="button" title="切换会话（/resume）" aria-label="切换会话" onClick={() => setPaletteOpen(true)}><Icon name="history" size={16}/></button>
          <button type="button" title="新建会话" aria-label="新建会话" onClick={startFresh}><Icon name="plus" size={16}/></button>
        </div>
      </>}
    </header>

    {open && <>
      <div className="zp-drawer-list" ref={listRef}>
        {/* 折叠了几条要如实说。**不能只在列表为空时才显示** —— 恰恰是列表里
            有了真对话之后，用户才会以为「这里看到的就是全部」，而会话日志里
            其实还躺着文献路径、运行时策略和技能目录。 */}
        {state.contextCount > 0 && <div className="zp-drawer-folded">
          <Icon name="layers" size={14}/>已折叠 {state.contextCount} 条工作台上下文（文献路径、运行时策略等），只显示对话本身。
        </div>}
        {messages.length === 0 && !live && !state.turnError && <div className="zp-drawer-empty">
          <Icon name="chat" size={22}/>
          <strong>关于这篇文献，问点什么</strong>
          <p>在左侧选中英文会自动翻译；想深入就点浮层里的「就此提问」，或直接在下面输入。</p>
        </div>}
        {messages.map((message) => <Bubble key={message.id} role={message.role} text={message.text} onJumpToPage={onJumpToPage}/>)}
        {live && <Bubble role="assistant" live text={live.text} onJumpToPage={onJumpToPage}/>}
        {state.turnError && <div className="zp-drawer-error"><Icon name="close" size={14}/>{state.turnError}</div>}
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
          placeholder={`围绕这篇文献提问…（Enter 发送，Shift+Enter 换行，${RESUME_COMMAND_TEXT} 切换会话）`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
          }}
        />
        <div className="zp-drawer-compose-actions">
          <span className="zp-drawer-hint">{busy ? '发送中…' : notice ?? `回答会带上页码引用 · ${RESUME_COMMAND_TEXT} 管理会话`}</span>
          <button type="submit" className="is-primary" disabled={busy || !draft.trim()}><Icon name="arrow" size={15}/>发送</button>
        </div>
      </form>

      {paletteOpen && <SessionPalette
        topic={topic}
        name={name}
        currentN={state.n}
        onPick={pickSession}
        onClose={() => setPaletteOpen(false)}
      />}
    </>}
  </aside>;
}

function Bubble({ role, text, live = false, onJumpToPage }) {
  return <div className={`zp-bubble is-${role}${live ? ' is-live' : ''}`}>
    <div className="zp-bubble-role">{role === 'user' ? '我' : '助手'}{live && <span className="zp-bubble-dot"/>}</div>
    {/* 用户的提问保持纯文本：选中一段英文再提问时，选区里常带 Markdown 记号
        （`*`、`[]`、反引号），渲染出来反而走样。助手的回答才是 Markdown。 */}
    {role === 'user'
      ? <div className="zp-bubble-text">{text}</div>
      : <AssistantText text={text} live={live} onJumpToPage={onJumpToPage}/>}
  </div>;
}

/**
 * 助手的回答：交给宿主自己的 Markdown 渲染器。
 *
 * 三件事各自有出处：
 *   - `MarkdownText` 是宿主渲染助手消息的**同一个**组件（`ui-chat` 的
 *     `AssistantMarkdown.tsx` 就用它），复制/代码块/表格/数学公式的行为与
 *     「问一问」里完全一致，不必自己维护一套 Markdown 实现。
 *   - 页码引用先经 `linkCitations` 改写成链接，再由 `openExternalLink` 拦下来
 *     跳页（这个拦截是宿主为了「链接在侧栏打开」预留的公开口子）。
 *   - `variant="compact"`：默认的 body 变体段落间距 16px、标题上边距 32px，
 *     塞进 392px 宽的抽屉里太散。
 */
function AssistantText({ text, live, onJumpToPage }) {
  const rendered = useMemo(() => linkCitations(text), [text]);
  const openExternalLink = useCallback((href) => {
    const page = pageFromLink(href);
    if (page !== null) {
      onJumpToPage?.(page);
      return;
    }
    // 回答里真出现外链（论文 DOI、arXiv）时按宿主的默认行为开新窗口。
    globalThis.open?.(href, '_blank', 'noopener,noreferrer');
  }, [onJumpToPage]);
  return <div className="zp-bubble-text zp-md">
    <MarkdownDelegateProvider openExternalLink={openExternalLink}>
      <MarkdownText text={rendered} streaming={live} labels={MARKDOWN_LABELS} variant="compact"/>
    </MarkdownDelegateProvider>
    {live && !text && <span className="zp-typing"><i/><i/><i/></span>}
  </div>;
}
