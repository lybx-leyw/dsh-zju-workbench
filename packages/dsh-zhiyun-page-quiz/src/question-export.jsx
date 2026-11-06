import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownText} from '@deepseek-ai/dsh-client-ui-primitives';
import {QUESTION_STRATEGIES, QUESTION_TYPES} from 'dsh-zhiyun-core-quiz';
import {
  QUIZ_EXPORT_ROOT_ID,
  buildQuizPdfOutline,
  quizPdfFilename,
  stemForPrint,
  typeBreakdown,
} from './question-export-model.js';
import printCss from './question-export.css';

/** 必须是模块级常量：`MarkdownText` 按 labels 的**身份**缓存组件表（同 question-bank.jsx）。 */
const MARKDOWN_LABELS = {code: {copyLabel: '复制', copiedLabel: '已复制'}, footnotes: '注释'};

/**
 * 纸面上的富文本。
 *
 * 走宿主的 `MarkdownText`（内部带 KaTeX）而不是拼字符串：题目里的 `$...$` 在卷面上
 * 必须是排好的公式，不能退化成原始 TeX。这一点和刷题页共用同一条渲染链，所以
 * 「页面上看到的」与「打印出来的」是一致的，不会出现公式字号两套。
 */
function Rich({text, className}) {
  const value = typeof text === 'string' ? text : '';
  if (!value.trim()) return null;
  return <div className={className}><MarkdownText text={value} labels={MARKDOWN_LABELS}/></div>;
}

const typeName = type => QUESTION_TYPES[type] ?? type ?? '题目';
const strategyName = id => QUESTION_STRATEGIES[id]?.label ?? '';

/**
 * 一道题的卷面（只有题干与选项，**不含答案**）。
 *
 * 答案统一放在卷末附录 —— 这是打印件的核心取舍：卷子上露出答案，这份卷子就只剩
 * 阅读价值，没法拿来真的做一遍。
 */
function PaperItem({entry}) {
  const q = entry.question;
  const choices = Array.isArray(q.choices) ? q.choices.filter(c => String(c.text ?? '').trim()) : [];
  return <article className="zs-pdf-q">
    <h4><span className="zs-pdf-q-no">{entry.number}</span><span className="zs-pdf-q-type">{typeName(q.type)}</span></h4>
    <Rich className="zs-pdf-stem" text={stemForPrint(q.stem)}/>
    {choices.length > 0 && <ul className="zs-pdf-choices">{choices.map(choice => <li key={choice.label}>
      <b>{choice.label}</b><Rich className="zs-pdf-choice-text" text={choice.text}/>
    </li>)}</ul>}
    {q.type === 'shortAnswer' && <p className="zs-pdf-answer-space" aria-hidden="true"/>}
  </article>;
}

/** 卷末附录里的一道题：答案 / 解析 / 评分要点。 */
function AnswerItem({entry}) {
  const q = entry.question;
  const answer = String(q.answer ?? '').trim();
  const explanation = String(q.explanation ?? '').trim();
  const rubric = Array.isArray(q.rubric) ? q.rubric.filter(item => String(item ?? '').trim()) : [];
  return <article className="zs-pdf-a">
    <h4><span className="zs-pdf-q-no">{entry.number}</span><span className="zs-pdf-q-type">{typeName(q.type)}{strategyName(q.strategy) ? ` · ${strategyName(q.strategy)}` : ''}</span></h4>
    {answer ? <Rich className="zs-pdf-answer" text={answer}/> : <p className="zs-pdf-answer zs-pdf-answer-empty">这道题没有保存参考答案。</p>}
    {rubric.length > 0 && <ol className="zs-pdf-rubric">{rubric.map((item, i) => <li key={i}>{item}</li>)}</ol>}
    {explanation && <Rich className="zs-pdf-explanation" text={explanation}/>}
    {q.requiresSourceReview && <p className="zs-pdf-flag">资料有尚未确认的提示，请结合原文核对参考答案。</p>}
  </article>;
}

/**
 * 整份 PDF 的文档组件。
 *
 * 「卷面」与「卷末答案」共用同一个 `outline` —— 题号只在 outline 里算一次，
 * 两段各自用 `entry.number` 渲染。分别编号是这类导出最常见的错位来源：
 * 卷面重新从 1 开始、附录从 1 开始，读者对不上号。
 */
export function QuizPdfDocument({outline, title, date, onReady}) {
  useEffect(() => { onReady?.(); }, []);
  const {sections, items} = outline;
  const courses = [...new Set(sections.map(s => s.courseTitle).filter(Boolean))];
  const breakdown = typeBreakdown(items);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return <div className="zs-pdf-quiz">
    <style>{printCss}</style>
    <header className="zs-pdf-cover">
      <span>题库 · 练习卷</span>
      <h1>{title}</h1>
      {courses.length > 0 && <p className="zs-pdf-courses">{courses.join(' / ')}</p>}
      <small>{items.length} 道 · {sections.length} 个节次 · 答案与解析见卷末 · {day}</small>
      {breakdown.length > 0 && <p className="zs-pdf-breakdown">{breakdown.map(row => `${typeName(row.type)} ${row.count}`).join(' · ')}</p>}
    </header>
    <main className="zs-pdf-body">
      {sections.map((section, si) => <section className="zs-pdf-section" key={section.key}>
        <h2><small>第 {si + 1} 节</small>{[section.courseTitle, section.lessonTitle].filter(Boolean).join(' / ') || '未标注课程'}</h2>
        {section.points.map((point, pi) => <section className="zs-pdf-point" key={`${point.title}-${pi}`}>
          <h3>{point.title}</h3>
          {point.items.map(entry => <PaperItem key={entry.number} entry={entry}/>)}
        </section>)}
      </section>)}
    </main>
    <section className="zs-pdf-answers">
      <h2>答案与解析</h2>
      {sections.map(section => <section className="zs-pdf-answer-section" key={`answer-${section.key}`}>
        <h3>{[section.courseTitle, section.lessonTitle].filter(Boolean).join(' / ') || '未标注课程'}</h3>
        {section.points.flatMap(point => point.items).map(entry => <AnswerItem key={entry.number} entry={entry}/>)}
      </section>)}
    </section>
  </div>;
}

/**
 * 等正文排完版：公式由 KaTeX 异步注入，字体也要等 —— 直接 `print()` 会打出
 * 半截公式和回退字体。
 *
 * 与讲义导出同一条思路（`dsh-zhiyun-page-study/src/lecture-export.jsx`）：等到 DOM
 * 静默 500ms，再等字体与图片就绪，最后等两帧。这里不 import 那边 —— 两个页面包
 * 之间只允许 study → quiz 的单向依赖，反向 import 会让客户端模块图成环。
 */
async function waitForLayout(element) {
  await new Promise((resolve, reject) => {
    let quiet;
    const finish = () => { clearTimeout(quiet); clearTimeout(limit); observer.disconnect(); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(finish, 500); });
    const limit = setTimeout(() => { clearTimeout(quiet); observer.disconnect(); reject(new Error('正文仍在排版，请稍后重试')); }, 20000);
    observer.observe(element, {childList: true, subtree: true, characterData: true, attributes: true});
    quiet = setTimeout(finish, 500);
  });
  await Promise.race([
    Promise.all([document.fonts?.ready, ...[...element.querySelectorAll('img')].map(image => image.decode())]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('字体或图片未能加载，请稍后重试')), 15000)),
  ]);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

let exporting = false;

/**
 * 把选中的题目导出成**一个** PDF。
 *
 * # 为什么要临时 DOM 而不是在页面上打印
 *
 * 页面里有导航、工具栏、折叠面板；`window.print()` 打印整个应用会把它们一起印出来
 * （讲义导出踩过同一个坑，见它的 `@media print` 注释）。这里挂一份独立的、离屏的
 * A4 排版稿，打印时用 CSS 把其余内容全部隐藏。
 *
 * # 桌面壳与浏览器两条路
 *
 * 桌面壳里 `window.zhiyunPdf.save()` 直接弹保存对话框、`printToPDF` 落盘，
 * 用户不用在打印预览里再点一次「另存为 PDF」；浏览器里退回 `window.print()`，
 * 由用户在系统打印对话框里选「另存为 PDF」。两条路的产物是同一份文档。
 *
 * @param {object} params
 * @param {Array<object>} params.questions 选中的题目（顺序 = 列表顺序）
 * @param {string} [params.title]          覆盖默认标题
 * @returns {Promise<string>} 给用户看的一句话结果
 */
export async function exportQuestionsPdf({questions, title = ''} = {}) {
  if (exporting) throw new Error('已有 PDF 正在导出，请先完成或取消');
  const outline = buildQuizPdfOutline(questions);
  if (!outline.total) throw new Error('选中的题目都已弃用，没有可导出的内容');

  exporting = true;
  const previousTitle = document.title;
  const element = document.createElement('div');
  element.id = QUIZ_EXPORT_ROOT_ID;
  element.setAttribute('aria-hidden', 'true');
  document.body.append(element);
  const root = createRoot(element);
  const date = new Date();
  const filename = quizPdfFilename(questions, date);
  const docTitle = String(title ?? '').trim() || filename.replace(/\.pdf$/i, '');
  let afterPrint;
  try {
    await new Promise(resolve => root.render(<QuizPdfDocument outline={outline} title={docTitle} date={date} onReady={resolve}/>));
    await waitForLayout(element);
    if (!element.textContent?.trim()) throw new Error('导出正文为空，请重试');
    document.title = docTitle;
    // 桌面壳优先；`lecturePdf` 是旧键，保留回落以免已有脚本/旧壳失效。
    const bridge = window.zhiyunPdf?.save ? window.zhiyunPdf : window.lecturePdf?.save ? window.lecturePdf : null;
    if (bridge?.save) {
      const result = await bridge.save(filename, 'quiz');
      if (result?.error) throw new Error(result.error);
      return result?.canceled ? '已取消导出' : `已导出 ${outline.total} 道题：${filename}`;
    }
    const finished = new Promise(resolve => { afterPrint = resolve; window.addEventListener('afterprint', afterPrint, {once: true}); });
    window.print();
    // 打印被拦掉或静默结束时不能把按钮永远卡在「正在导出…」。
    await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 30000))]);
    return '打印预览已关闭；选择「另存为 PDF」即可保存这份练习卷';
  } finally {
    if (afterPrint) window.removeEventListener('afterprint', afterPrint);
    document.title = previousTitle;
    root.unmount();
    element.remove();
    exporting = false;
  }
}

/**
 * 「导出 PDF」按钮。
 *
 * 只在**有选中题目**时可用：这个按钮导出的是勾选的那些题，空选时按下去只会得到
 * 一句报错（同批量弃用、导出到笔记库的判据）。
 */
export function ExportPdfButton({questions, disabled = false, onDone, onError}) {
  const [busy, setBusy] = useState(false);
  const count = Array.isArray(questions) ? questions.length : 0;
  const start = async () => {
    setBusy(true);
    onError?.('');
    onDone?.('正在排版练习卷…');
    try {
      onDone?.(await exportQuestionsPdf({questions}));
    } catch (error) {
      onError?.(error?.message ?? '导出失败');
      onDone?.('');
    } finally {
      setBusy(false);
    }
  };
  return <button type="button" className="zs-button" disabled={busy || disabled || !count} title="把勾选的题目排成一份练习卷（答案与解析在卷末），导出为单个 PDF" onClick={start}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>{busy ? '正在排版…' : '导出 PDF'}
  </button>;
}
