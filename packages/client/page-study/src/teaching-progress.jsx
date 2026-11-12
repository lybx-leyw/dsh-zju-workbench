/**
 * 备课进度面板：总进度 + 每章三个阶段的状态。
 *
 * # 为什么不能只显示「已完成 N/M 章」
 *
 * 一章内部是串行三段：先预判理解障碍，再设计视觉讲解分镜，最后逐页画图。
 * 后两段耗时远大于第一段，而「已完成 N 章」在整章跑完之前一直是同一个数字 ——
 * 用户盯着不动的界面，无法判断是卡住了还是正在正常推进。
 *
 * 所以这里把**阶段**画出来：每一章都显示三段各自的状态（已完成 / 进行中 / 未开始），
 * 进行中的那一段还会带上「第几页 / 共几页」。用户随时能回答两个问题：
 * 「现在在做什么」「还要多久」。
 *
 * # 为什么阶段是固定的三步
 *
 * 这三步来自管线本身（`html-deck.js` 的 `onProgress` 只发这几个 stage），
 * 不是前端猜的。未知 stage 落到最后一步并标注原名 —— 宁可显示原始字符串，
 * 也不要把不认识的阶段伪装成已知步骤。
 */
import React, { useEffect, useRef, useState } from 'react';

/** 管线里真实存在的阶段 → 界面上的三步骤。 */
const STEPS = [
  { key: 'understanding', label: '预判理解障碍', hint: '找出容易卡住的概念' },
  { key: 'storyboard', label: '设计视觉讲解', hint: '决定每一页用哪张图' },
  { key: 'pages', label: '逐页生成图示', hint: '示意图、公式与讲解' },
];

/**
 * 阶段名 → 步骤下标。
 *
 * 管线发的 stage（见 `html-deck.js`）：
 *   html-understanding / html-storyboard / html / html-layout-review /
 *   html-layout-repair / html-scene-complete / html-chapter-complete
 * 后三个都属于「逐页生成」—— 修复版式与逐页完成都是这一步的组成部分。
 */
const STAGE_INDEX = {
  'html-understanding': 0,
  understanding: 0,
  'html-storyboard': 1,
  storyboard: 1,
  'html-resume': 2,
  html: 2,
  'html-layout-review': 2,
  'html-layout-repair': 2,
  'html-scene-complete': 2,
  'html-scene-reused': 2,
  'html-chapter-complete': 2,
};

/** 阶段名 → 用户看得懂的中文。未知阶段原样返回（见文件头）。 */
const STAGE_LABEL = {
  'html-understanding': '正在预判理解障碍',
  understanding: '正在预判理解障碍',
  'html-storyboard': '正在设计视觉讲解',
  storyboard: '正在设计视觉讲解',
  'html-resume': '正在继续上次的进度',
  html: '正在逐页生成图示',
  'html-layout-review': '正在检查画面边界',
  'html-layout-repair': '正在修复版式',
  'html-scene-complete': '正在逐页生成图示',
  'html-scene-reused': '正在继续上次的进度',
  'html-chapter-complete': '已完成',
};

/**
 * @param {object} props
 * @param {object} props.progress `pollTeaching` 的 running 返回值
 * @param {number} [props.startedAt] 开始时间（毫秒），用来显示已用时间
 */
export function TeachingProgress({ progress, startedAt }) {
  // 已用时间由「现在 - 开始时间」算出来，`now` 只是每秒推动重渲染的计时器。
  //
  // ⚠️ 不能把 elapsed 做成「effect 里累加」的状态：那样首次渲染永远是 0
  //    （SSR 和首帧都跑不到 effect），用户会先看到「已用 0 秒」闪一下，
  //    服务端渲染出的静态页面更是完全没有时间。
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!startedAt) return undefined;
    const tick = () => { if (alive.current) setNow(Date.now()); };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [startedAt]);
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;

  const chapters = Array.isArray(progress?.chapterProgress) ? progress.chapterProgress : [];
  const chapterTotal = progress?.chapterTotal ?? 0;
  const chaptersDone = progress?.chaptersDone ?? 0;
  const slidesDone = progress?.slidesDone ?? 0;
  // 续跑开场时报出的已存页数：让用户知道「上次的成果没丢」，而不是以为又从 0 开始。
  const resumedPages = chapters.reduce((sum, chapter) => sum + (chapter.resumed ? chapter.slidesDone : 0), 0);
  const stageIndex = STAGE_INDEX[progress?.phase] ?? null;
  const stageLabel = progress?.phase ? (STAGE_LABEL[progress.phase] ?? progress.phase) : '正在准备';
  // 续跑开场可能还没有阶段事件，但已有已存页 —— 这时说「继续上次的进度」比「正在准备」准确。
  const displayStage = !progress?.phase && resumedPages > 0 ? '正在继续上次的进度' : stageLabel;

  // 总进度：章节完成度为主；没有章节信息时退回页数。
  const percent = chapterTotal > 0
    ? Math.min(100, Math.round((chaptersDone / chapterTotal) * 100))
    : 0;

  return <section className="zws-teach-progress" aria-label="备课进度">
    <header className="zws-teach-progress-head">
      <div>
        <strong>{displayStage}</strong>
        <span>
          {chapterTotal > 0 ? `已备好 ${chaptersDone}/${chapterTotal} 章` : '正在拆分章节'}
          {slidesDone > 0 ? ` · 共 ${slidesDone} 页` : ''}
          {resumedPages > 0 ? ` · 其中 ${resumedPages} 页是上次画好的` : ''}
          {elapsed >= 1000 ? ` · 已用 ${formatElapsed(elapsed)}` : ''}
        </span>
      </div>
      {chapterTotal > 0 && <b className="zws-teach-percent">{percent}%</b>}
    </header>

    <div className="zws-teach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-label={`备课总进度 ${percent}%`}>
      <i style={{ width: `${percent}%` }} />
    </div>

    {/* 章节列表：每章三段各自的勾/点/圈，一眼看出「同时跑的三章各在哪一步」。 */}
    {chapters.length ? <ol className="zws-teach-chapter-list">
      {chapters.map(chapter => {
        const stage = chapter.status === 'done' ? STEPS.length : (STAGE_INDEX[chapter.stage] ?? -1);
        const pages = chapter.scenesTotal
          ? `第 ${(chapter.sceneIndex ?? 0) + 1}/${chapter.scenesTotal} 页`
          : null;
        return <li key={chapter.chapterId ?? chapter.chapterIndex} data-status={chapter.status}>
          <div className="zws-teach-chapter-line">
            <span className="zws-teach-chapter-name" title={chapter.title}>
              {chapter.title || `第 ${chapter.chapterIndex + 1} 章`}
            </span>
            <span className="zws-teach-chapter-meta">
              {chapter.status === 'done'
                ? `完成 · ${chapter.slidesDone} 页`
                : pages ? `${pages} · 已定 ${chapter.slidesDone} 页` : `已定 ${chapter.slidesDone} 页`}
            </span>
          </div>
          <ol className="zws-teach-steps">
            {STEPS.map((step, i) => {
              // done = 已经走过；active = 正在做；其余是未开始。
              const state = i < stage ? 'done' : i === stage ? 'active' : 'pending';
              return <li key={step.key} data-state={state} title={step.hint}>
                <i aria-hidden="true" />
                <span>{step.label}</span>
                <em className="zws-teach-sr-only">
                  {state === 'done' ? '已完成' : state === 'active' ? '进行中' : '未开始'}
                </em>
              </li>;
            })}
          </ol>
        </li>;
      })}
    </ol> : null}

    {/* 还没拿到章节列表时，至少把三步画出来，让用户知道接下来会发生什么。 */}
    {!chapters.length && stageIndex !== null ? <ol className="zws-teach-steps zws-teach-steps-standalone">
      {STEPS.map((step, i) => <li key={step.key} data-state={i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'pending'} title={step.hint}>
        <i aria-hidden="true" />
        <span>{step.label}</span>
      </li>)}
    </ol> : null}
  </section>;
}

/** 毫秒 → 「2 分 14 秒」；不足一分钟只报秒。 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}
