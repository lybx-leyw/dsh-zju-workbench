import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Icon } from 'dsh-zhiyun-shell-ui';
import { AssistantDrawer } from './AssistantDrawer.jsx';
import { LibraryPanel } from './LibraryPanel.jsx';
import { ReaderFrame } from './ReaderFrame.jsx';
import { loadPaper, loadTranslateState, transcribePaper, translateSelection } from './library.js';

/**
 * 「论文」页：左边读 PDF，右边是对着这篇文献说话的 AI 抽屉。
 *
 * 三块拼装：
 *   - `LibraryPanel`：页头的文献库下拉（上传 / 新建专题 / 切论文）；
 *   - `ReaderFrame`：同源 iframe 承载上游阅读器（pdf.js + 可选中文本层 + 选中即译浮层）；
 *   - `AssistantDrawer`：右侧抽屉，订阅上游的会话 SSE。
 *
 * 阅读器里链接到别处（或抽屉里点页码）都只用页内状态跳转，不刷整页 ——
 * iframe 换 src 会重建 pdf.js，代价高；所以用 `reloadKey` 触发重挂载。
 */

const LAST_KEY = 'zhiyun.paper.last';

function readLast() {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.topic === 'string' && typeof parsed.name === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLast(value) {
  try { globalThis.localStorage?.setItem(LAST_KEY, JSON.stringify(value)); } catch { /* 隐私模式就算了 */ }
}

export function Paper({ controller }) {
  const [paper, setPaper] = useState(readLast);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cornellOpen, setCornellOpen] = useState(false);
  const [selection, setSelection] = useState(null);
  const [jump, setJump] = useState(null); // { page, q, key }
  const [meta, setMeta] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const readerApiRef = useRef(null);

  const pick = useCallback((next) => {
    setPaper({ topic: next.topic, name: next.name });
    setSelection(null);
    setJump(null);
    setMeta(null);
    setTranscript(null);
    writeLast({ topic: next.topic, name: next.name });
  }, []);

  // 打开一篇文献就顺手读一次元信息（页数 / 是否已转录）与译文状态。
  useEffect(() => {
    if (!paper) return undefined;
    let live = true;
    loadPaper(paper.topic, paper.name).then(
      (value) => { if (live) setMeta(value); },
      () => { if (live) setMeta(null); },
    );
    loadTranslateState(paper.topic, paper.name).then(
      (value) => { if (live) setTranscript(value); },
      () => { if (live) setTranscript(null); },
    );
    return () => { live = false; };
  }, [paper]);

  // 跨窗口进来的 `zhiyun.paper.open`（例如从「问一问」的回答里点链接）也接住。
  useEffect(() => {
    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'zhiyun.paper.open') return;
      if (typeof data.topic !== 'string' || typeof data.name !== 'string') return;
      pick({ topic: data.topic, name: data.name });
      if (data.page) setJump({ page: Number(data.page), q: data.q, key: Date.now() });
    };
    globalThis.addEventListener?.('message', onMessage);
    return () => globalThis.removeEventListener?.('message', onMessage);
  }, [pick]);

  const jumpToPage = useCallback((page, q) => {
    if (!Number.isFinite(page) || page < 1) return;
    const api = readerApiRef.current;
    if (api?.jumpTo) { api.jumpTo(page, q); return; }
    // 阅读器还没就绪（或用户刚切论文）：记下来，等 `load` 后补跳。
    setJump({ page, q, key: Date.now() });
  }, []);

  const askAbout = useCallback((payload) => {
    setSelection(payload);
    setDrawerOpen(true);
  }, []);

  // 选中即译的出口。走本包自己的 `/api/translate`（宿主 llm + 内存缓存），
  // 不是上游的整篇翻译端点 —— 两者共用设置里的同一个端点配置，但请求路径不同。
  const translate = useCallback((text, signal) => translateSelection(text, signal), []);

  const onTranscribe = useCallback(async () => {
    if (!paper) return;
    setTranscript((current) => ({ ...(current ?? {}), busy: true }));
    try {
      const result = await transcribePaper(paper.topic, paper.name);
      setTranscript({ ...result, busy: false });
    } catch (error) {
      setTranscript((current) => ({ ...(current ?? {}), busy: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [paper]);

  if (!paper) {
    return <div className="zp-landing">
      <Empty icon="paper" title="还没有打开文献">
        <p>从本地挑一篇 PDF 开始。选中英文会自动翻译，右侧抽屉可以就着这一段提问。</p>
      </Empty>
      <div className="zp-landing-actions">
        <LibraryPanel current={null} onPick={pick}/>
      </div>
    </div>;
  }

  const pages = meta?.pageCount ? `${meta.pageCount} 页` : '页数未知';
  const transcribed = meta?.hasTranscript ?? transcript?.hasTranscript;

  return <div className={`zp-page${drawerOpen ? ' is-drawer-open' : ''}`}>
    <div className="zp-main">
      <div className="zp-bar">
        <button type="button" className="zp-cornell-toggle" aria-expanded={cornellOpen}
          onClick={() => setCornellOpen((value) => !value)} title="展开或收起康奈尔笔记">
          {cornellOpen ? '‹' : '›'} 康奈尔笔记
        </button>
        <LibraryPanel current={paper} onPick={pick}/>
        <span className="zp-bar-meta">{pages}{transcribed ? ' · 已转录' : ''}</span>
        <div className="zp-bar-actions">
          <button type="button" onClick={onTranscribe} disabled={transcript?.busy} title="转录成文本，让检索与问答能定位到原文">
            <Icon name="layers" size={15}/>{transcript?.busy ? '转录中…' : transcribed ? '重新转录' : '转录'}
          </button>
          <button type="button" className={drawerOpen ? 'is-primary' : undefined} onClick={() => setDrawerOpen((value) => !value)} title="展开或收起 AI 助手">
            <Icon name="chat" size={15}/>AI 助手
          </button>
          {controller && <button type="button" onClick={() => controller.navigate('ask')} title="去「问一问」继续这段对话">
            <Icon name="arrow" size={15}/>问一问
          </button>}
        </div>
      </div>

      {transcript?.error && <div className="zp-bar-error">{transcript.error}</div>}

      <ReaderFrame
        key={JSON.stringify([paper.topic, paper.name])}
        cornellOpen={cornellOpen}
        topic={paper.topic}
        name={paper.name}
        page={jump?.page}
        q={jump?.q}
        reloadKey={jump?.key}
        translate={translate}
        onAskAbout={askAbout}
        registerApi={(api) => {
          readerApiRef.current = api;
          if (api && jump?.page) api.jumpTo?.(jump.page, jump.q);
        }}
      />
    </div>

    <AssistantDrawer
      topic={paper.topic}
      name={paper.name}
      open={drawerOpen}
      onToggle={() => setDrawerOpen((value) => !value)}
      selection={selection}
      onSelectionConsumed={() => setSelection(null)}
      onJumpToPage={(page) => jumpToPage(page)}
    />
  </div>;
}
