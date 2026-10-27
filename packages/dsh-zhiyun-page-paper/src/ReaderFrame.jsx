import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from 'dsh-zhiyun-shell-ui';
import { readerUrl } from './library.js';
import {
  createDwell,
  isTranslatableSelection,
  normalizeSelectionText,
  intersectsRects,
  unionRect,
} from './selection-text.js';
import { frameThemeCss, readThemeTokens } from './frame-theme.js';
import { attachCornellNotes } from './cornell-notes.js';

/**
 * 左侧的 PDF 阅读区：同源 iframe 承载上游阅读器 + 一层「选中英文 → 悬停即译」的桥。
 *
 * # 为什么是 iframe
 *
 * 上游阅读器是一个自渲染的 HTML（内联脚本 + 自己的 pdf.js vendor 副本），
 * 它不走 React、不认宿主插槽，唯一跟外界的接口就是 `/paper-reader/api/*`。
 * 而本仓的客户端 bundle 有一条硬守卫：**产出里不许出现本包 `src/` 之外的文件**
 * （`tests/build-seeds.test.mjs`），所以那两份 pdf.js（约 1.7MB）不可能打进我们的
 * bundle 里。iframe 正好同时满足两件事：同源（能读 `contentDocument`，能选中、
 * 能双向调用）且资源留在上游自己的路由下。
 *
 * # 「悬停触发翻译」的判定为什么这么绕
 *
 * 用户在 PDF 里划选出一段英文，手通常还压在选区上。若 `mouseup` 就发请求，
 * 每一次划选都要花一次模型调用；若要求用户把鼠标移开再移回来，动作又太刻意。
 * 所以我们用「**光标落在选区矩形内并停留 260ms**」作为「有意停留」的判据
 * （`createDwell`），并且在同一个选区内移动**不重置**计时器。
 *
 * 判定与计时全在纯模块 `selection-text.js` 里，浏览器里只做 DOM 连线 ——
 * 这类「感觉该翻的时候没翻」的 bug 在手测里几乎复现不出来。
 */

const POPOVER_GAP = 8;
const POPOVER_WIDTH = 344;

export function ReaderFrame({ topic, name, page, q, reloadKey, translate, onAskAbout, registerApi, cornellOpen }) {
  const frameRef = useRef(null);
  const hostRef = useRef(null);
  const popRef = useRef(null);
  const dwellRef = useRef(null);
  const activeRef = useRef(null);   // 当前已选中且值得翻译的选区（含矩形与页码）
  const lastPointRef = useRef(null); // 最近一次鼠标位置：划选后原地不动时用它立刻起计时
  const memoRef = useRef(new Map());
  const sinkRef = useRef(translate);
  sinkRef.current = translate;

  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState(null);
  const [pop, setPop] = useState(null);
  const cornellOpenRef = useRef(cornellOpen);
  cornellOpenRef.current = cornellOpen;
  useEffect(() => {
    frameRef.current?.contentDocument?.documentElement.classList.toggle('zp-cornell-visible', cornellOpen);
  }, [cornellOpen, ready]);

  const url = useMemo(() => readerUrl(topic, name, { page, q }), [topic, name, page, q]);

  const runTranslate = useCallback(async (text) => {
    // 本地再记一层：host 侧的缓存是权威的（跨组件存活），这一层只为了悬停时不闪。
    const cached = memoRef.current.get(text);
    if (cached) { setPop({ ...cached, rect: activeRef.current?.viewport ?? null }); return; }
    setPop({ text, status: 'loading', rect: activeRef.current?.viewport ?? null });
    try {
      const result = await sinkRef.current(text);
      const next = {
        text,
        status: 'done',
        translation: result.translation,
        model: result.model,
        truncated: result.truncated === true,
        cached: result.cached === true,
      };
      memoRef.current.set(text, next);
      setPop({ ...next, rect: activeRef.current?.viewport ?? null });
    } catch (error) {
      setPop({
        text,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        rect: activeRef.current?.viewport ?? null,
      });
    }
  }, []);

  /** 选区在 **iframe 视图坐标** → **父页面视口坐标**（浮层画在父页面里）。 */
  const toViewport = useCallback((rects) => {
    const box = frameRef.current?.getBoundingClientRect();
    const union = unionRect(rects);
    if (!box || !union) return null;
    return {
      left: box.left + union.left,
      top: box.top + union.top,
      right: box.left + union.right,
      bottom: box.top + union.bottom,
    };
  }, []);

  // dwell 只建一次；它自己管计时器。选区的 DOM 连线在下面那个 effect 里。
  useEffect(() => {
    const dwell = createDwell({
      delay: 260,
      onFire: (key, payload) => {
        if (!key || !payload) return;
        const now = activeRef.current;
        // 触发时再确认一次选区没被换掉：手快的时候这两件事会交叉。
        if (!now || now.text !== key) return;
        void runTranslate(payload.text);
      },
    });
    dwellRef.current = dwell;
    return () => { dwell.cancel(); dwellRef.current = null; };
  }, [runTranslate]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let doc = null;
    let cancelled = false;
    let detachNotes = null;

    const readSelection = () => {
      const selection = doc.defaultView.getSelection();
      const text = normalizeSelectionText(selection ? selection.toString() : '');
      if (!selection || selection.rangeCount === 0 || !isTranslatableSelection(text)) return null;
      // 只认 PDF 文本层里的选区：阅读器界面上还有别的可选中的文字（页码、状态），
      // 那些不该触发翻译。
      const anchor = selection.anchorNode;
      const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
      if (!element?.closest?.('.textLayer')) return null;
      const rects = [...selection.getRangeAt(0).getClientRects()].map((rect) => ({
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      }));
      if (rects.length === 0) return null;
      const pageNode = element.closest('.page');
      return {
        text,
        rects,
        page: pageNode ? Number(pageNode.dataset.page) || null : null,
        viewport: toViewport(rects),
      };
    };

    const onMouseUp = () => {
      // 等一拍：`mouseup` 时选区还没最终定下来（双击选词、三击选段都要下一帧才稳）。
      setTimeout(() => {
        if (cancelled || !doc) return;
        const found = readSelection();
        if (!found) { activeRef.current = null; dwellRef.current?.cancel(); setPop(null); return; }
        activeRef.current = found;
        // 划选后手常常原地压在选区里 → 立刻起计时；否则等 mousemove 进来。
        const point = lastPointRef.current;
        if (point && intersectsRects(found.rects, point.x, point.y)) dwellRef.current?.arm(found.text, found);
        else dwellRef.current?.cancel();
      }, 0);
    };

    const onMouseMove = (event) => {
      lastPointRef.current = { x: event.clientX, y: event.clientY };
      const active = activeRef.current;
      if (!active) return;
      if (intersectsRects(active.rects, event.clientX, event.clientY)) dwellRef.current?.arm(active.text, active);
      else dwellRef.current?.cancel();
    };

    const onMouseDown = () => { dwellRef.current?.cancel(); };
    const onKeyDown = (event) => { if (event.key === 'Escape') setPop(null); };

    const onLoad = () => {
      if (cancelled) return;
      doc = frame.contentDocument;
      if (!doc) { setFailure('阅读器加载失败：拿不到同源文档（iframe 被跨域隔离了？）'); return; }
      detachNotes?.();
      detachNotes = attachCornellNotes(doc, { topic, name });
      doc.documentElement.classList.toggle('zp-cornell-visible', cornellOpenRef.current);
      try {
        // 主题 + 藏掉「已经搬到本壳」的控件：只注入一张样式表，不碰上游脚本。
        const style = doc.createElement('style');
        style.dataset.zhiyunFrame = 'true';
        style.textContent = frameThemeCss(readThemeTokens(getComputedStyle(document.documentElement)));
        doc.head.append(style);
      } catch (error) {
        setFailure(`阅读器皮肤注入失败：${error instanceof Error ? error.message : String(error)}`);
      }
      doc.addEventListener('mouseup', onMouseUp);
      doc.addEventListener('mousemove', onMouseMove);
      doc.addEventListener('mousedown', onMouseDown);
      doc.addEventListener('keydown', onKeyDown);
      setReady(true);
      setFailure(null);
    };

    const onError = () => { if (!cancelled) setFailure('阅读器加载失败：请确认宿主已启用 dsh-zhiyun-host-paper。'); };

    frame.addEventListener('load', onLoad);
    frame.addEventListener('error', onError);
    // 组件重挂载时 iframe 已经加载完，不会再发一次 load。
    if (frame.contentDocument?.readyState === 'complete') onLoad();

    return () => {
      cancelled = true;
      detachNotes?.();
      frame.removeEventListener('load', onLoad);
      frame.removeEventListener('error', onError);
      if (doc) {
        doc.removeEventListener('mouseup', onMouseUp);
        doc.removeEventListener('mousemove', onMouseMove);
        doc.removeEventListener('mousedown', onMouseDown);
        doc.removeEventListener('keydown', onKeyDown);
      }
      dwellRef.current?.cancel();
    };
  }, [toViewport, reloadKey]);

  // 父页面点浮层外 → 收起。点 iframe 里的内容由上面的 mousedown 处理。
  useEffect(() => {
    if (!pop) return undefined;
    const close = (event) => { if (!popRef.current?.contains(event.target)) setPop(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pop]);

  /** 翻到某一页（页面里的助手引用页码时用）。上游把入口挂在 `contentWindow.dpr` 上。 */
  const jumpTo = useCallback((targetPage, snippet) => {
    const win = frameRef.current?.contentWindow;
    if (!win?.dpr) return false;
    win.dpr.jumpPage(targetPage, snippet);
    return true;
  }, []);

  useEffect(() => {
    registerApi?.({ jumpTo, translateSelection: runTranslate, isReady: () => ready });
    return () => registerApi?.(null);
  }, [registerApi, jumpTo, runTranslate, ready]);

  const ask = useCallback(() => {
    const active = activeRef.current;
    if (!active || !pop) return;
    onAskAbout?.({ text: active.text, page: active.page });
    setPop(null);
  }, [pop, onAskAbout]);

  return <div className="zp-reader" ref={hostRef}>
    <iframe
      ref={frameRef}
      className="zp-frame"
      title={`${topic} / ${name}`}
      src={url}
      // 刻意不加 sandbox：需要同源地读 contentDocument 才能做选区和悬停判定。
      // 上游 HTML 是本地打包产物、与宿主同源，风险等同宿主自身页面。
    />
    {failure && <div className="zp-frame-hint is-error">{failure}</div>}
    {!ready && !failure && <div className="zp-frame-hint"><span className="zp-spinner"/>正在打开阅读器…</div>}
    {pop && <SelectionPopover
      pop={pop}
      innerRef={popRef}
      onAsk={ask}
      onRetry={() => void runTranslate(pop.text)}
      onClose={() => setPop(null)}
    />}
  </div>;
}

/**
 * 译文浮层。定位在父页面（不是 iframe 内），所以能直接用本壳的 `Icon` 与 CSS。
 * 位置沿选区下沿展开；贴到视口底部时翻到上方。
 */
function SelectionPopover({ pop, innerRef, onAsk, onRetry, onClose }) {
  const rect = pop.rect;
  const style = useMemo(() => {
    if (!rect) return { left: 16, top: 16 };
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    const below = rect.bottom + POPOVER_GAP;
    const flip = below + 150 > window.innerHeight;
    const top = flip ? Math.max(8, rect.top - POPOVER_GAP - 150) : below;
    return { left, top };
  }, [rect]);

  return <div className="zp-pop" ref={innerRef} style={style} role="dialog" aria-label="选中内容翻译">
    <div className="zp-pop-source" title={pop.text}>{pop.text.length > 96 ? `${pop.text.slice(0, 96)}…` : pop.text}</div>
    {pop.status === 'loading' && <div className="zp-pop-body"><span className="zp-spinner"/><span>翻译中…</span></div>}
    {pop.status === 'error' && <div className="zp-pop-body is-error">
      <div className="zp-pop-message">{pop.message}</div>
      <div className="zp-pop-actions">
        <button type="button" onClick={onRetry}><Icon name="history" size={14}/>重试</button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </div>}
    {pop.status === 'done' && <>
      <div className="zp-pop-body"><Icon name="translate" size={15}/><p>{pop.translation}</p></div>
      {pop.truncated && <div className="zp-pop-note">选区较长，只翻译了前 1200 个字符。</div>}
      <div className="zp-pop-actions">
        <button type="button" className="is-primary" onClick={onAsk}><Icon name="chat" size={14}/>就此提问</button>
        <button type="button" onClick={onClose}>关闭</button>
        {pop.cached && <span className="zp-pop-cache">来自缓存</span>}
      </div>
    </>}
  </div>;
}
