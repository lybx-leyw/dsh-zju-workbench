/**
 * 「AI 教学」栏 —— 让 AI 备课，逐页讲一节。
 *
 * # 只有一种内容：AI 生成的课件
 *
 * 这里**不再有「讲义分页」降级**。曾经有过一版：模型不可用时把讲义原文按
 * 知识点切开顶上。那是在欺骗用户 —— 界面上看起来是「课」，实际只是长文切片，
 * 既没有讲课顺序的规划，也没有每页该说什么话。用户要的是 AI 备课，
 * 给不出就如实说给不出，不能拿另一种东西冒充。
 *
 * 所以状态只有四种：
 *   idle        还没生成 → 一个「生成课件」按钮
 *   generating  正在备课 → 按钮变成「正在备课…」并禁用
 *   ready       有课件   → 逐页展示 canvas + 讲课稿
 *   error       失败     → 原因原文 + 「重试」，**不显示任何替代内容**
 *
 * # 内容从哪来
 *
 * 走 `zhiyunClassroomGenerate`（课堂生成管线）：
 *   outline 决定讲什么、什么顺序
 *   scenes  逐页产出 canvas 元素 + 口播稿
 * 这一栏只负责翻页与呈现，不自己拼 prompt —— 那是重造已经调好的管线。
 *
 * # 语音
 *
 * 这一版不接。`speech` 已由管线产出，接语音时在翻页处读它即可。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { ClassroomSlide } from 'dsh-zhiyun-classroom-renderer';

/** 宿主 Markdown 渲染器的文案。必须是模块级常量（它按身份缓存组件表）。 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

/** 管线阶段 → 用户看得懂的话。原始阶段名（outline/scenes/media/finalize）不该直接给用户看。 */
const PHASE_LABEL = {
  material: '读取讲义',
  outline: '规划讲课顺序',
  scenes: '生成每页内容',
  media: '准备配图',
  finalize: '收尾',
};

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
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  // 换节次：清空上一节的课件（不同节次的课不能混着看）
  const lessonId = state?.lesson?.subId ?? state?.lesson?.id ?? null;
  useEffect(() => {
    setPages(null);
    setStatus('idle');
    setError(null);
    setIndex(0);
    setRunId(null);
    setProgress(null);
  }, [lessonId]);

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
    try {
      // 第一段：启动，立刻拿到 runId（不等模型）
      const started = await controller.generateTeaching({});
      if (!alive.current) return;
      const id = started?.runId;
      if (!id) throw new Error('生成没有返回 runId');
      setRunId(id);
      // 第二段交给轮询 effect
    } catch (e) {
      if (!alive.current) return;
      setPages(null);
      setError(e?.message ?? '启动备课失败');
      setStatus('error');
    }
  }, [controller]);

  // 两段式的第二段：每 1.5 秒问一次进度。
  //
  // 一次备课 3-5 分钟，同步等会撞浏览器的请求超时（实测直接 crash）。
  // 轮询期间界面显示「已备好 N 页」，用户知道它在动，不是一个假死的按钮。
  useEffect(() => {
    if (!runId || status !== 'generating') return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await controller.pollTeaching(runId);
        if (stopped || !alive.current) return;
        if (r?.status === 'done') {
          const got = Array.isArray(r.pages) ? r.pages : [];
          if (!got.length) throw new Error('这一节没有生成出可讲的课件页');
          setPages(got);
          setIndex(0);
          setStatus('ready');
          setRunId(null);
          return;
        }
        setProgress({ ready: r?.ready ?? 0, phase: r?.phase ?? null });
      } catch (e) {
        if (stopped || !alive.current) return;
        setPages(null);
        setError(e?.message ?? '查询进度失败');
        setStatus('error');
        setRunId(null);
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [runId, status, controller]);

  const go = useCallback((next) => {
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
          <strong>让 AI 把这一节备成一堂课</strong>
          <p>AI 会先规划讲课顺序，再逐页生成课件（每页有标题、要素和讲课稿）。</p>
          {status === 'error' && <p className="zs-ai-err" role="alert">{error}</p>}
          <div className="zs-ai-start-actions">
            <button
              type="button"
              className="zs-primary"
              disabled={status === 'generating'}
              onClick={() => void generate()}
            >
              {status === 'generating' ? '正在备课…' : status === 'error' ? '重试' : '生成课件'}
            </button>
            {status === 'generating' && (
              <span className="zs-ai-hint">
                {progress
                  ? `已备好 ${progress.ready} 页${progress.phase ? ` · ${PHASE_LABEL[progress.phase] ?? progress.phase}` : ''}`
                  : '正在规划讲课顺序…'}
              </span>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── 有课件：逐页展示 ─────────────────────────────────────────
  return (
    <section className="zs-ai-teach" aria-label="AI 教学">
      <header className="zs-ai-head">
        <div>
          <span className="zs-eyebrow">AI 课件 · 第 {index + 1} 页 / 共 {total} 页</span>
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

      {/* 课件页：canvas 是生成管线给的（元素位置/字号/图形都在里面） */}
      {current?.canvas ? (
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
        <button type="button" className="zs-text" onClick={() => void generate()}>重新备课</button>
        <button type="button" className="zs-primary" disabled={index >= total - 1} onClick={() => go(index + 1)}>
          {index >= total - 1 ? '这一节讲完了' : '下一页'}
        </button>
      </footer>
    </section>
  );
}
