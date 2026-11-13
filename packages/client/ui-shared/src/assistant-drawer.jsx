/**
 * AI 助手右侧抽屉 —— 页面内可折叠的对话面板。
 *
 * # 为什么自建，不复用宿主对话
 *
 * 宿主的对话组件绑定在 `main.conversation` 插槽上，而那是 **single 作用域**：
 * 一个会话同时只能有一份。想把它「搬」进页面抽屉，等于要宿主放开单槽语义 ——
 * 那会动整个会话区的契约。
 *
 * 所以抽屉自己渲染对话：消息列表 + 输入框，通过页面自己的接口收发
 * （论文页用 `/paper-reader/api/ask` + `/api/session/follow` 的 SSE）。
 *
 * # 为什么放在 `ui-shared`
 *
 * 「页面 + 右侧 AI 助手」是产品级形态，不只论文页要：笔记、课堂、规划都可能要。
 * 抽屉的**外壳**（折叠、拖宽、滚动、输入区）是共用的；**怎么发消息**由调用方
 * 通过 `send` 回调决定 —— 这样它既能接论文页的 SSE，也能接别的页面的接口。
 *
 * # 与宿主右栏的关系
 *
 * 无关。这是页面内部的 flex 一列，不是宿主的 `sidebar-right`。
 * 不碰宿主的任何节点，切页即卸载。
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './primitives.jsx';
import { Markdown } from './markdown.jsx';

/** 抽屉宽度约束：太窄放不下消息，太宽会把正文挤没。 */
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 400;

/** 记住宽度：用户的长期偏好，不该每次切页就重置。 */
const WIDTH_KEY = 'zw.drawer.width';
const OPEN_KEY = 'zw.drawer.open';

/**
 * 一个页面的 AI 助手抽屉。
 *
 * @param props - 见下方各字段。
 * @returns 抽屉元素（含折叠态）。
 */
/**
 * 工具调用的参数摘要：单行、截断。
 *
 * `arguments` 是模型原样输出的 JSON 字符串，**不解析** —— 偶发非法 JSON，
 * 解析失败不该让整条消息消失。这里只做「压缩空白 + 截断」用于预览。
 *
 * @param raw - 原始 JSON 字符串。
 * @param max - 保留的最大字符数。
 */
function argsSummary(raw, max = 80) {
  const flat = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/**
 * 一条助手消息的块序列渲染。
 *
 * @param props.blocks - 块数组（见文件头）。
 * @param props.fallback - 没有 blocks 时的纯文本兜底。
 * @param props.streaming - 是否正在流式输出（决定光标）。
 */
function MessageBlocks({ blocks, fallback, streaming = false }) {
  const [openThink, setOpenThink] = useState(true);
  const [openTools, setOpenTools] = useState(false);

  // 没有块信息时退回纯文本 —— 老消息或别的页面传的简单消息都走这条。
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  if (!hasBlocks) {
    return <div data-md-root=""><Markdown text={fallback ?? ''} /></div>;
  }

  const reasoning = blocks.filter((b) => b.type === 'reasoning');
  const tools = blocks.filter((b) => b.type === 'tool-call');
  const texts = blocks.filter((b) => b.type === 'text');

  return <div>
    {/* 思考过程：默认展开（用户想知道模型在想什么），可收起。 */}
    {reasoning.length > 0 && <div data-md-part="reasoning" style={{
      margin: '0 0 6px', borderRadius: '8px',
      background: 'var(--zw-layer, #f6f7f9)',
    }}>
      <button type="button" onClick={() => setOpenThink(!openThink)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 9px', border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: '11px', color: 'var(--zw-muted, #656d76)', font: 'inherit', textAlign: 'left',
      }}>
        <span style={{ transform: openThink ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
        <span>思考过程</span>
      </button>
      {openThink && <div style={{ padding: '0 9px 8px' }}>
        <Markdown muted text={reasoning.map((b) => b.text).join('\n\n')} />
      </div>}
    </div>}

    {/* 工具调用：默认收起成一行徽标，点开看参数与结果摘要。 */}
    {tools.length > 0 && <div data-md-part="tools" style={{
      margin: '0 0 6px', borderRadius: '8px',
      border: '0.5px solid var(--zw-line, #e8eaed)',
    }}>
      <button type="button" onClick={() => setOpenTools(!openTools)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 9px', border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: '11px', color: 'var(--zw-muted, #656d76)', font: 'inherit', textAlign: 'left',
      }}>
        <span style={{ transform: openTools ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
        <span>{tools.length} 次工具调用</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
          {tools.map((t) => t.name).join(', ')}
        </span>
      </button>
      {openTools && <div style={{ padding: '0 9px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {tools.map((tool) => <div key={tool.id || tool.name} style={{
          fontSize: '11px', fontFamily: 'ui-monospace, monospace',
          color: 'var(--zw-muted, #656d76)', wordBreak: 'break-all',
        }}>
          <span style={{ color: 'var(--zw-text, #24292f)', fontWeight: 600 }}>{tool.name}</span>
          {tool.arguments !== '' && <div style={{ opacity: 0.8 }}>{argsSummary(tool.arguments)}</div>}
        </div>)}
      </div>}
    </div>}

    {/* 正文：Markdown 渲染 + 流式光标 */}
    {texts.map((block, index) => <div key={index} data-md-part="text">
      <Markdown text={block.text} />
      {streaming && index === texts.length - 1 && <span style={{
        display: 'inline-block', width: '6px', height: '13px', marginLeft: '2px',
        background: 'var(--zw-accent, #0969da)', borderRadius: '1px',
        animation: 'zydrawer-blink 1s steps(2) infinite', verticalAlign: 'text-bottom',
      }} />}
    </div>)}

    {/* 只有思考/工具、没有正文时，也要有流式光标的位置 */}
    {streaming && texts.length === 0 && <span style={{
      display: 'inline-block', width: '6px', height: '13px',
      background: 'var(--zw-accent, #0969da)', borderRadius: '1px',
      animation: 'zydrawer-blink 1s steps(2) infinite',
    }} />}
  </div>;
}

export function AssistantDrawer({
  /** 抽屉标题；不传则用「AI 助手」。 */
  title = 'AI 助手',
  /** 是否默认展开。 */
  defaultOpen = true,
  /**
   * 发一条消息。
   *
   * `{ text, selectedText, page }` → Promise。调用方负责把结果写回 `messages`。
   * 抽屉不管传输层：SSE、普通 POST、本地推理都行。
   *
   * @returns 可选返回 `{ text }` 作为助手回复。
   */
  send,
  /** 当前上下文提示（如「正在读：Nature25-PFN」）。 */
  context,
  /** 输入框占位。 */
  placeholder = '就这篇论文提问…',
  /** 引用的选中文本；有值时输入框上方显示引用条。 */
  selection,
  /** 清除引用。 */
  onClearSelection,
  /** 折叠态图标。 */
  collapsedIcon = 'arrow',
  /**
   * 外部提供的消息列表（受控模式）。
   *
   * 传了它就由调用方管消息（例如回答来自 SSE 流）；不传则由抽屉自己
   * 追加 `send` 的返回值（非受控，适合一问一答的简单场景）。
   */
  messages: externalMessages,
  /** 外部提供的「正在回答」状态（与 `messages` 配套）。 */
  busy: externalBusy,
}) {
  const [open, setOpen] = useState(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      return raw === null ? defaultOpen : raw === '1';
    } catch { return defaultOpen; }
  });
  const [width, setWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  const [draft, setDraft] = useState('');
  const [ownBusy, setOwnBusy] = useState(false);
  const busy = externalBusy === undefined ? ownBusy : Boolean(externalBusy);
  const [ownMessages, setOwnMessages] = useState([]);
  // 受控模式下用外部消息；否则用自己的。
  const controlled = Array.isArray(externalMessages);
  const messages = controlled ? externalMessages : ownMessages;
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  /**
   * 用户是否停在底部。
   *
   * `true` → 内容变化时跟到底；`false` → 用户上翻看历史了，别拽他回去。
   *
   * 用 ref 而不是 state：它只在滚动 effect 里读，不需要触发重渲染。
   * 用 state 的话，流式期间每次滚动都要重渲染整个消息列表。
   */
  const pinnedRef = useRef(true);
  const dragRef = useRef(null);

  // 偏好持久化：失败（隐私模式）不影响使用。
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* 忽略 */ }
  }, [open]);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* 忽略 */ }
  }, [width]);

  /**
   * 内容指纹：最后一条消息的长度 + 角色。
   *
   * 流式输出时文本在**同一条消息**里增长，`messages` 数组引用不变 ——
   * 依赖只写 `[messages]` 的话，effect 不会重跑，滚动就停在半空。
   * 用「长度」当指纹，长度一变就滚。
   */
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastFingerprint = lastMessage === null ? '' : `${messages.length}:${lastMessage.role}:${String(lastMessage.text ?? '').length}`;

  /**
   * 自动滚到底。
   *
   * 规则：
   *   - **流式中强制跟随** —— 用户要的就是看回答长出来，这时候按「是否上翻」
   *     判断反而会打断他；
   *   - 非流式时才尊重用户：距底部 80px 内才跟随，上翻看历史就别把他拽回来。
   *
   * `useLayoutEffect` 而不是 `useEffect`：要在浏览器绘制前滚动，否则会看到
   * 一帧「内容已出现但还停在旧位置」。
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    /**
     * 滚到底 —— 延到下一帧。
     *
     * `useLayoutEffect` 里读到的 `scrollHeight` 可能还没算上刚提交的子元素
     * 高度（Markdown 渲染的内容尤其明显），直接用会「赋值了但没滚到底」。
     * rAF 排在布局之后，那时 `scrollHeight` 才是真实值。
     */
    const scrollToEnd = () => {
      list.scrollTop = list.scrollHeight;
      pinnedRef.current = true;
    };

    /**
     * 跟到底的条件。
     *
     * **不看 busy** —— 实测过：流式结束那一刻 `live` 置 null，busy 立刻变 false，
     * 而此时最后一条消息往往还在增长（msgs 15→16，gap 从 0 跳到 368），
     * 于是「距底部 80px 内」的旧规则就把用户丢在半空。
     *
     * 真正的信号是**用户自己有没有上翻**（`pinnedRef`）。他没动，就跟到底。
     */
    if (!pinnedRef.current) return undefined;

    // 连排两帧：内容可能在同一帧继续增长（流式回答）。
    requestAnimationFrame(() => {
      scrollToEnd();
      requestAnimationFrame(scrollToEnd);
    });
    return undefined;
  }, [lastFingerprint]);

  // 抽屉刚展开时也滚到底：否则从闲置切回来会停在顶部，看不到最新那条。
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list === null) return;
    // 重新展开时回到「跟随」状态 —— 用户刚点开，想看的必然是最新那条。
    pinnedRef.current = true;
    // 延一帧，等布局完成（同上的 rAF 理由）。
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }, [open]);

  /**
   * 跟踪用户滚动：只更新「是否贴底」，不触发重渲染。
   *
   * 阈值 24px 而不是 0：触控板惯性滚动的最后一像素很难精确停住，
   * 严格等于 0 会让「明明到底了却判定成上翻」。
   */
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    const onScroll = () => {
      const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedRef.current = gap <= 24;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [open]);

  /** 拖宽：从抽屉左缘拖动。 */
  const onDragStart = useCallback((event) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    const onMove = (e) => {
      const drag = dragRef.current;
      if (drag === null) return;
      // 向左拖 = 变宽
      const next = drag.startWidth - (e.clientX - drag.startX);
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (text === '' || busy) return;
    setDraft('');
    setError(null);
    // 受控模式下消息由调用方给（它可能来自 SSE），自己追加会重复。
    if (!controlled) setOwnMessages((prev) => [...prev, { role: 'user', text }]);
    if (typeof send !== 'function') return;
    setOwnBusy(true);
    try {
      const reply = await send({ text, selectedText: selection?.text, page: selection?.page });
      if (!controlled && reply && typeof reply.text === 'string' && reply.text !== '') {
        setOwnMessages((prev) => [...prev, { role: 'assistant', text: reply.text }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOwnBusy(false);
    }
  }, [draft, busy, send, selection]);

  // 折叠态：一条窄条，点击展开。
  if (!open) {
    return <div
      data-zw-drawer="collapsed"
      style={{
        flex: 'none', width: '36px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: '10px', gap: '8px',
        borderLeft: '0.5px solid var(--zw-line, #e8eaed)',
      }}
    >
      <button
        type="button"
        title={title}
        aria-label={`展开${title}`}
        onClick={() => setOpen(true)}
        style={{
          width: '26px', height: '26px', border: 'none', borderRadius: '6px',
          background: 'transparent', cursor: 'pointer', color: 'var(--zw-muted, #656d76)',
          display: 'grid', placeItems: 'center',
        }}
      ><Icon name={collapsedIcon} size={14}/></button>
    </div>;
  }

  return <div
    data-zw-drawer="open"
    style={{
      // `position: relative` 是拖宽手柄的定位基准 —— 手柄贴在左缘（left:-3px），
      // 没有它就会以整页为基准，跑到窗口左上角去。
      position: 'relative',
      flex: 'none', width: `${width}px`, display: 'flex', flexDirection: 'column',
      minHeight: 0, height: '100%',
      borderLeft: '0.5px solid var(--zw-line, #e8eaed)',
      background: 'var(--zw-surface, #fff)',
    }}
  >
    {/* 拖宽手柄：贴在左缘 */}
    <div
      role="separator"
      aria-orientation="vertical"
      data-zw-drawer-handle=""
      onMouseDown={onDragStart}
      style={{
        position: 'absolute', left: '-3px', top: 0, bottom: 0, width: '6px',
        cursor: 'col-resize', zIndex: 2,
      }}
    />
    {/* 顶栏 */}
    <div style={{
      flex: 'none', display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 10px', borderBottom: '0.5px solid var(--zw-line, #e8eaed)',
    }}>
      <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--zw-text, #24292f)' }}>{title}</span>
      <button
        type="button"
        title="收起"
        aria-label={`收起${title}`}
        onClick={() => setOpen(false)}
        style={{
          width: '24px', height: '24px', border: 'none', borderRadius: '6px',
          background: 'transparent', cursor: 'pointer', color: 'var(--zw-muted, #656d76)',
          display: 'grid', placeItems: 'center',
        }}
      ><Icon name="arrow" size={13}/></button>
    </div>

    {/* 上下文提示 */}
    {context !== undefined && context !== null && <div style={{
      flex: 'none', padding: '6px 10px', fontSize: '11px',
      color: 'var(--zw-muted, #656d76)', borderBottom: '0.5px solid var(--zw-line, #e8eaed)',
    }}>{context}</div>}

    {/* 消息列表 */}
    <div
      ref={listRef}
      data-zw-drawer-list=""
      style={{
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      {messages.length === 0 && <div style={{
        fontSize: '12px', color: 'var(--zw-muted, #656d76)', lineHeight: 1.7,
      }}>就当前论文提问。选中正文后再问，回答会带上那段文字作为上下文。</div>}
      {messages.map((m, i) => {
        // 流式中：最后一条助手消息带光标。
        const isStreaming = busy && m.role === 'assistant' && i === messages.length - 1;
        // 用户消息不做 Markdown 渲染：那是他自己敲的字，`*` 和 `#` 就是字面意思。
        const isUser = m.role === 'user';
        return <div
          key={m.id ?? i}
          data-zw-drawer-msg={m.role}
          style={{
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            maxWidth: isUser ? '92%' : '100%',
            padding: '7px 10px', borderRadius: '10px',
            fontSize: '13px', lineHeight: 1.65, wordBreak: 'break-word',
            background: isUser
              ? 'var(--zw-soft, rgba(9,105,218,.10))'
              : 'transparent',
            color: 'var(--zw-text, #24292f)',
          }}
        >{isUser
          ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
          : <MessageBlocks blocks={m.blocks} fallback={m.text} streaming={isStreaming} />}
        </div>;
      })}
      {busy && <div style={{ fontSize: '12px', color: 'var(--zw-muted, #656d76)' }}>思考中…</div>}
      {error !== null && <div style={{
        fontSize: '12px', color: 'var(--zw-danger, #cf222e)', lineHeight: 1.6,
      }}>{error}</div>}
    </div>

    {/* 引用条 + 输入区 */}
    <div style={{
      flex: 'none', borderTop: '0.5px solid var(--zw-line, #e8eaed)', padding: '8px 10px 10px',
      display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      {selection?.text !== undefined && selection.text !== '' && <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '6px',
        padding: '6px 8px', borderRadius: '8px',
        background: 'var(--zw-soft, rgba(9,105,218,.08))',
        fontSize: '11px', color: 'var(--zw-muted, #656d76)', lineHeight: 1.5,
      }}>
        <span style={{ flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          引用：{selection.text}
        </span>
        <button
          type="button"
          title="取消引用"
          aria-label="取消引用"
          onClick={() => onClearSelection?.()}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: '12px' }}
        >×</button>
      </div>}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter 发送，Shift+Enter 换行 —— 与宿主对话区一致的习惯
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'none',
          padding: '7px 9px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6,
          border: '0.5px solid var(--zw-line, #e8eaed)',
          background: 'var(--zw-layer, #fff)', color: 'var(--zw-text, #24292f)',
          font: 'inherit',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ flex: 1, fontSize: '11px', color: 'var(--zw-muted, #656d76)' }}>
          Enter 发送 · Shift+Enter 换行
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={busy || draft.trim() === ''}
          style={{
            padding: '5px 14px', borderRadius: '8px', border: 'none', fontSize: '12px',
            cursor: busy || draft.trim() === '' ? 'default' : 'pointer',
            opacity: busy || draft.trim() === '' ? 0.5 : 1,
            background: 'var(--zw-accent, #0969da)', color: '#fff', font: 'inherit',
          }}
        >发送</button>
      </div>
    </div>
  </div>;
}

export default AssistantDrawer;
