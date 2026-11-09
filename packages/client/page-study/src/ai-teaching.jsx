/**
 * AI 教学：章节 HTML 内含固定横版 slides 与画布外讲解区，仅公式逐步显现。
 * iframe 不允许同源访问；内容、样式和导航由生成管线的确定性 shell 负责。
 * 不调用 TTS 或图片生成，也不将原文切片冒充生成成功。旧 canvas 存档仍可读取。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { ClassroomSlide } from '@lybx-leyw/dsh-zju-core-classroom-renderer';
import { TeachingGenerate } from './teaching-generate.jsx';
import { TeachingProgress } from './teaching-progress.jsx';

/** 宿主 Markdown 渲染器的文案。必须是模块级常量（它按身份缓存组件表）。 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

/**
 * AI 教学栏。
 *
 * 不给降级：`pages` 为 null 时界面只有「生成课件」按钮或错误原因，
 * 绝不用讲义原文冒充课件。
 */
export function AiTeaching({ state, controller }) {
  const [pages, setPages] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [index, setIndex] = useState(0);
  // 两段式生成的中间态：runId 用于轮询，progress 用于显示「已备好 N 页」
  const [runId, setRunId] = useState(null);
  const [progress, setProgress] = useState(null);
  // 导出 PPTX 的独立状态：它和「生成」是两件事，不能共用一个 loading
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  // 是否是从磁盘读回来的（用来提示「这是上次保存的」）
  const [loadedFromDisk, setLoadedFromDisk] = useState(false);
  // 章内页进度：章节 HTML 是单文件多页，页号由 iframe 内 shell 通过 postMessage 上报。
  // 没有它界面只能显示「第 1/2 章」，用户看不出这一章还有多少页。
  const [deckState, setDeckState] = useState(null);
  const frameRef = useRef(null);
  // 开始时间：只在本地记，用来显示「已用 2 分 14 秒」。
  // 服务端也回传 startedAt（重启后续跑能对上），优先用它的。
  const startedAtRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'html-deck:state' || event.source !== frameRef.current?.contentWindow) return;
      // 只认整数：页面里能跑的是我们自己的 shell，但状态仍不该被任意数字污染。
      const int = (value, max) => Number.isInteger(value) && value >= 0 && value <= max ? value : null;
      const { slideCount } = data;
      if (!Number.isInteger(slideCount) || slideCount < 1) return;
      const slideIndex = int(data.slideIndex, slideCount - 1);
      const formulaCount = int(data.formulaCount, 10000);
      const formulaStep = int(data.formulaStep, formulaCount ?? 0);
      if (slideIndex === null) return;
      setDeckState({ slideIndex, slideCount, formulaStep: formulaStep ?? 0, formulaCount: formulaCount ?? 0 });
    };
    globalThis.addEventListener?.('message', onMessage);
    return () => globalThis.removeEventListener?.('message', onMessage);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // 换节次：清空上一节，然后**先尝试加载已保存的备课**。
  //
  // 生成一次 3-5 分钟，如果只在内存里留着，重启/刷新/隔天打开就全没了。
  // 段产物其实一直在磁盘上（vault），所以进入时先问一句：有就秒开。
  const lessonId = state?.lesson?.subId ?? state?.lesson?.id ?? null;
  const lessonKey = `${state?.course?.id ?? state?.course?.courseId ?? ''}:${lessonId ?? ''}`;
  const activeLesson = useRef(lessonKey);
  activeLesson.current = lessonKey;
  useEffect(() => {
    setPages(null);
    setStatus('idle');
    setError(null);
    setIndex(0);
    setRunId(null);
    setProgress(null);
    setLoadedFromDisk(false);
    setDeckState(null);
    if (!lessonId) return undefined;

    let cancelled = false;
    (async () => {
      if (typeof controller?.loadTeaching !== 'function') return;
      try {
        const r = await controller.loadTeaching();
        if (cancelled || !alive.current) return;
        const got = Array.isArray(r?.pages) ? r.pages : [];
        if (got.length) {
          setPages(got);
          setStatus('ready');
          setLoadedFromDisk(true);
          setRunId(r?.runId ?? null);
        } else if (r?.runId && r?.resumable) {
          setRunId(r.runId);
          setStatus(r.status === 'running' ? 'generating' : 'error');
          if (r.status !== 'running') setError('上次备课尚未完成，可继续未成功的章节。');
        }
      } catch {
        // 加载失败不打扰用户：当作「没有存档」，正常显示生成入口
      }
    })();
    return () => { cancelled = true; };
  }, [lessonKey, controller]);

  // 导出要用「这一次备课的 runId」—— 它在生成完成后仍保留（见上面轮询的收尾）。
  const runIdToExport = runId;
  const total = pages?.length ?? 0;
  const current = pages?.[Math.min(index, Math.max(0, total - 1))] ?? null;

  const generate = useCallback(async () => {
    if (typeof controller?.generateTeaching !== 'function') {
      setError('学习页还没接上宿主，无法生成');
      setStatus('error');
      return;
    }
    setStatus('generating');
    setError(null);
    setProgress(null);
    setRunId(null);
    setLoadedFromDisk(false);
    startedAtRef.current = Date.now();
    const requestedLesson = lessonKey;
    try {
      // 第一段：启动，立刻拿到 runId（不等模型）。
      // 章节并发不在这里传：它等于服务端「供应商 + worker 数」池子的总并发，
      // 由 workbench 在启动时按已落盘的配额算出来。
      const started = await controller.generateTeaching({});
      if (!alive.current || activeLesson.current !== requestedLesson) return;
      const id = started?.runId;
      if (!id) throw new Error('生成没有返回 runId');
      setRunId(id);
      // 第二段交给轮询 effect
    } catch (e) {
      if (!alive.current || activeLesson.current !== requestedLesson) return;
      setPages(null);
      setError(e?.message ?? '启动备课失败');
      setStatus('error');
    }
  }, [controller, lessonKey]);

  // 两段式的第二段：每 1.5 秒问一次进度。
  //
  // 一次备课 3-5 分钟，同步等会撞浏览器的请求超时（实测直接 crash）。
  // 轮询期间界面显示「已备好 N 页」，用户知道它在动，不是一个假死的按钮。
  useEffect(() => {
    if (!runId || status !== 'generating') return undefined;
    let stopped = false;
    let polling = false;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try {
        const r = await controller.pollTeaching(runId);
        if (stopped || !alive.current) return;
        if (r?.status === 'done') {
          const got = Array.isArray(r.pages) ? r.pages : [];
          if (!got.length) throw new Error('这一节没有生成出可讲的课件页');
          setPages(got);
          setIndex(0);
          setStatus('ready');
          // 保留 runId：导出 PPTX 要靠它反查这次备课的 scenes。
          // 轮询会自己停（effect 的条件是 status === 'generating'）。
          return;
        }
        setProgress({ ready: r?.ready ?? 0, phase: r?.phase ?? null,
          chapterTotal: r?.chapterTotal ?? 0, chaptersDone: r?.chaptersDone ?? 0,
          slidesDone: r?.slidesDone ?? 0,
          chapterProgress: Array.isArray(r?.chapterProgress) ? r.chapterProgress : [],
          startedAt: r?.startedAt ?? null });
      } catch (e) {
        if (stopped || !alive.current) return;
        setPages(null);
        setError(e?.message ?? '查询进度失败');
        setStatus('error');
        // 保留失败 runId，让「断点续作」可以重试未完成章节。
      } finally {
        polling = false;
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [runId, status, controller]);

  /**
   * 断点续作：接着没跑完的那次继续。
   *
   * 与 `generate`（从头开始）的区别：已完成的段不重跑 —— 省时间也省钱，
   * 而且不会因为模型非确定性把已经备好的页换掉。
   * 失败时优先给这个按钮，只有 run 不在了才退回「重试」。
   */
  const resume = useCallback(async () => {
    if (!runId) return;
    if (typeof controller?.resumeTeaching !== 'function') {
      setError('学习页还没接上宿主，无法续跑');
      return;
    }
    setStatus('generating');
    setError(null);
    try {
      await controller.resumeTeaching(runId);
      if (!alive.current) return;
      // 继续用同一个 runId 轮询，进度会从断点接着涨
    } catch (e) {
      if (!alive.current) return;
      setError(e?.message ?? '续跑失败');
      setStatus('error');
    }
  }, [runId, controller]);

  /**
   * 导出 PPTX。
   *
   * RPC 走 JSON 传不了二进制，所以服务端给 base64，这里转 Blob 再用
   * 一个临时 <a download> 触发保存 —— 不依赖宿主提供文件下载接口。
   */
  const exportPptx = useCallback(async () => {
    if (!runIdToExport) { setExportError('还没有可导出的内容'); return; }
    if (typeof controller?.exportTeaching !== 'function') {
      setExportError('学习页还没接上宿主，无法导出');
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const r = await controller.exportTeaching(runIdToExport);
      if (!alive.current) return;
      const b64 = r?.base64;
      if (!b64) throw new Error('导出没有返回文件');
      // base64 → Uint8Array → Blob
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r?.fileName || 'classroom.pptx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 让浏览器有机会开始下载再回收
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!alive.current) return;
      setExportError(e?.message ?? '导出失败');
    } finally {
      if (alive.current) setExporting(false);
    }
  }, [runIdToExport, controller]);

  const exportHtml = useCallback(() => {
    if (!current?.html) return;
    const url = URL.createObjectURL(new Blob([current.html], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${String(current.title || 'chapter').replace(/[\\/:*?"<>|]/g, '-')}.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [current]);

  const go = useCallback((next) => {
    setDeckState(null);
    setIndex((value) => {
      const target = typeof next === 'function' ? next(value) : next;
      return Math.min(Math.max(0, target), Math.max(0, total - 1));
    });
  }, [total]);

  // 键盘：左右翻页
  useEffect(() => {
    const onKey = (event) => {
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [index, go]);

  // ── 未生成 / 生成中 / 失败：只给入口与原因 ────────────────────
  if (status !== 'ready' || !total) {
    return (
      <section className="zs-ai-teach" aria-label="AI 教学">
        <div className="zs-ai-start">
          <strong>把抽象内容变成看得懂的讲解</strong>
          <p>预判理解障碍，再用示意图、例子和逐步推导生成章节 HTML。章节并发，章内串行；不生成语音和图片。</p>
          {status === 'error' && <p className="zs-ai-err" role="alert">{error}</p>}
          <div className="zs-ai-start-actions">
            {/* 失败且还留着 runId → 优先「继续」（不重跑已完成的章）；
                只有在没有可续的 run 时才从头生成。
                「继续」是独立的两个按钮，不套并发配置 —— 续跑不重新规划章节。 */}
            {status === 'error' && runId ? (
              <>
                <button type="button" className="zs-primary" onClick={() => void resume()}>继续上次备课</button>
                <button type="button" className="zs-text" onClick={() => void generate()}>从头开始</button>
              </>
            ) : (
              <TeachingGenerate
                controller={controller}
                disabled={status === 'generating'}
                running={status === 'generating'}
                hasResult={false}
                onGenerate={() => void generate()}
              />
            )}
          </div>
          {/* 备课进度：三步骤 + 每章状态 + 已用时间。只报「已完成 N 章」时，
              整章跑完之前界面是静止的 —— 用户无法判断卡住还是在正常推进。 */}
          {status === 'generating' ? (
            <TeachingProgress progress={progress} startedAt={progress?.startedAt ?? startedAtRef.current} />
          ) : null}
        </div>
      </section>
    );
  }

  // ── 有课件：逐页展示 ─────────────────────────────────────────
  return (
    <section className="zs-ai-teach" aria-label="AI 教学">
      <header className="zs-ai-head">
        <div>
          <span className="zs-eyebrow">
            AI 讲解 · 第 {index + 1} {current?.html ? '章' : '页'} / 共 {total} {current?.html ? '章' : '页'}{loadedFromDisk ? ' · 上次保存的' : ''}
            {current?.html && deckState ? ` · 本章第 ${deckState.slideIndex + 1}/${deckState.slideCount} 页` : ''}
            {current?.html && deckState?.formulaCount ? ` · 公式 ${deckState.formulaStep}/${deckState.formulaCount}` : ''}
          </span>
          <h2>{current?.title}</h2>
        </div>
        <div className="zs-ai-nav">
          <button type="button" className="zs-button" disabled={index === 0} onClick={() => go(index - 1)} aria-label="上一页">←</button>
          <span className="zs-ai-count">{index + 1} / {total}</span>
          <button type="button" className="zs-button" disabled={index >= total - 1} onClick={() => go(index + 1)} aria-label="下一页">→</button>
        </div>
      </header>

      <div className="zs-ai-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1}>
        <i style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      {/* 章内页进度：章节 HTML 自己会画一条；这里再给一条外层可读的，避免 iframe 缩放后看不见。 */}
      {current?.html && deckState ? (
        <div className="zs-ai-deck-progress" role="progressbar" aria-label="本章页进度"
          aria-valuemin={1} aria-valuemax={deckState.slideCount} aria-valuenow={deckState.slideIndex + 1}>
          <i style={{ width: `${((deckState.slideIndex + 1) / deckState.slideCount) * 100}%` }} />
        </div>
      ) : null}

      {/* 课件页：canvas 是生成管线给的（元素位置/字号/图形都在里面）。
          章节 HTML 用 class 承载尺寸（见 style.css 的 .zs-ai-slide-frame）：
          父容器原本 max-width:760px，会把 iframe 压到 HTML 自己的 <900px 堆叠断点里，
          于是「左右两栏」永远显示成「上下」。 */}
      {current?.html ? (
        <div className="zs-ai-slide-frame">
          <iframe ref={frameRef} key={current.id} title={current.title} srcDoc={current.html} sandbox="allow-scripts"
            referrerPolicy="no-referrer" />
        </div>
      ) : current?.canvas ? (
        <div className="zs-ai-slide">
          <ClassroomSlide slide={current.canvas} width={720} />
        </div>
      ) : (
        <p className="zs-ai-err" role="alert">这一页缺少画面内容（生成时未产出 canvas）</p>
      )}

      {/* 讲课稿：AI 要说的话，与页面内容不是一回事，单独一块 */}
      {current?.speech ? (
        <div className="zs-ai-speech">
          <span className="zs-ai-speech-label">讲课稿</span>
          <MarkdownText text={current.speech} labels={MARKDOWN_LABELS} />
        </div>
      ) : null}

      <footer className="zs-ai-foot">
        <div className="zs-ai-foot-left">
          <TeachingGenerate
            controller={controller}
            running={false}
            hasResult
            onGenerate={() => void generate()}
          />
          <button
            type="button"
            className="zs-text"
            disabled={!current?.html && (exporting || !runIdToExport)}
            onClick={() => current?.html ? exportHtml() : void exportPptx()}
          >
            {current?.html ? '保存本章 HTML' : exporting ? '正在导出…' : '保存为 PPT'}
          </button>
        </div>
        <button type="button" className="zs-primary" disabled={index >= total - 1} onClick={() => go(index + 1)}>
          {index >= total - 1 ? '这一节讲完了' : '下一页'}
        </button>
      </footer>

      {/* 导出失败要说清楚原因，而不是让按钮闪一下什么都不发生 */}
      {exportError && <p className="zs-ai-err" role="alert">{exportError}</p>}
    </section>
  );
}
