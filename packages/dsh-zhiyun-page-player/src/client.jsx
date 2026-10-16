// 「看课」页：一节回放的**视频 + 课件 + 字幕**同屏。
//
// # 这一页存在的理由
//
// 本仓原先把「看回放」降级成「我的课」里一个 `target="_blank"` 外链 —— 点开跳浏览器，
// 课件与字幕留在工作台里，两边再也对不上。原始设计里这是一个**独立页面**
// （`player_page.dart`，1260 行），视频是主角，课件与字幕是它的两个跟随面。
//
// # 三条不能破的约定（照原始设计）
//
// 1. **播放器常驻**：`<video>` 在任何布局下都挂在树里。卸载它 = 声音当场断，
//    所以切页签、切布局都不许把视频节点从树里摘掉 —— 本页用 CSS 控制显隐，
//    不用条件渲染。
// 2. **时间轴是唯一真源**：当前时刻由 `<video>` 的 `timeupdate` 驱动，
//    课件页与字幕行都是它的**投影**。反过来（让课件驱动视频）会与用户拖动
//    进度条打架。
// 3. **点字幕才跳**：不自动滚动。用户可能正在读某一行，自动滚走是打断。
//
// # 与「学习」页的分工
//
// 「学习」是**整理与复习**（讲义、终稿、出题、笔记）；「看课」是**回到课堂**
// （哪一段在讲什么、对着课件看）。两者读同一份 `state.content`，但看的角度不同：
// 这一页不整理、不出题，只把原始素材按时间对齐。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Notice, mountStyle, useStudy } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';

export const name = 'zhiyun-page-player-client';
export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunPlayerStyle', css, label: 'zhiyun: player page styles' });
  // 惰性取领域状态：没装状态包时这一页显示占位，不把整个前端拖成 pending。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.player.content', () => scope.slots.register(
      { name: 'zhiyun.player.content', priority: 10 },
      () => <Player controller={scope.zhiyunStudyController} />,
    ));
  });
}

/** 毫秒 → `mm:ss`（超过一小时给 `h:mm:ss`）。 */
function time(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * 课件页与字幕的时间对齐：找**最后一条起点不晚于 `atMs`** 的条目。
 *
 * 为什么不是「最近的一条」：用户跳到 10:00 时，要看到的是 10:00 时**正在讲**的
 * 那一页/那一句，而不是时间上最近的（可能是 10:05 的下一句）。前者是"当时在讲什么"，
 * 后者是"离得最近的那句" —— 差一个语义，字幕会看起来总是领先一句。
 *
 * 找不到（`atMs` 早于第一条）时给 `-1`，调用方据此显示"还没开始"而不是硬套第 0 条。
 */
function indexAt(items, atMs, key = 'startMs') {
  let found = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (Number(items[i]?.[key]) <= atMs) found = i;
    else break;
  }
  return found;
}

/** 一条字幕行。`active` 由视频时间决定，不由点击决定 —— 点击只负责跳转。 */
function TranscriptLine({ line, index, active, onJump }) {
  return <button
    type="button"
    id={`zs-player-line-${index}`}
    className={`zs-player-line${active ? ' is-active' : ''}`}
    onClick={() => onJump(line.startMs)}
  >
    <time>{time(line.startMs)}</time>
    <span>{line.text}</span>
  </button>;
}

export function Player({ controller }) {
  const s = useStudy(controller);
  const videoRef = useRef(null);
  const [tab, setTab] = useState('ppt');
  const [nowMs, setNowMs] = useState(0);
  /** 用户手动选了某页课件时，暂停"跟时间走"（直到他再点字幕/换页签）。 */
  const [pinned, setPinned] = useState(false);

  const slides = s.content?.slides?.items ?? [];
  const subtitles = s.content?.subtitles?.items ?? [];
  const lesson = s.lesson;
  const videoUrl = lesson?.videoUrl ?? null;

  // 视频时间驱动一切。不自动滚动字幕（原始设计的约定 3）。
  useEffect(() => {
    const node = videoRef.current;
    if (!node) return undefined;
    const onTime = () => setNowMs(node.currentTime * 1000);
    node.addEventListener('timeupdate', onTime);
    node.addEventListener('seeked', onTime);
    return () => {
      node.removeEventListener('timeupdate', onTime);
      node.removeEventListener('seeked', onTime);
    };
  }, [videoUrl]);

  // 换节时把「钉住的页」放开、时间归零 —— 否则上一节的页码会带到新节上。
  useEffect(() => { setPinned(false); setNowMs(0); }, [lesson?.subId]);

  const autoSlide = useMemo(() => indexAt(slides, nowMs), [slides, nowMs]);
  const slideIndex = pinned && slides.length ? Math.min(Math.max(autoSlide, 0), slides.length - 1) : Math.max(autoSlide, 0);
  const activeLine = useMemo(() => indexAt(subtitles, nowMs), [subtitles, nowMs]);
  const current = slides[slideIndex] ?? null;

  /** 跳到某个时刻（点字幕、翻课件都走它，保证"视频是唯一真源"）。 */
  const jumpTo = (ms) => {
    const node = videoRef.current;
    if (node && Number.isFinite(ms)) node.currentTime = Math.max(0, ms / 1000);
    setNowMs(ms);
  };

  // 还没有选节：从「我的课」进来才会有上下文，直接开这一页时如实说。
  if (!lesson) {
    return <section className="zs-player">
      <div className="zs-player-empty">
        <strong>还没有选择要看的节次</strong>
        <p>先在「我的课」里展开一门课，点某一节的「看课」。</p>
        <button className="zs-primary" onClick={() => controller.navigate('courses')}>去我的课</button>
      </div>
    </section>;
  }

  return <section className="zs-player">
    <header className="zs-player-head">
      <button className="zs-button" onClick={() => controller.navigate('courses')}>← 我的课</button>
      <div className="zs-player-title">
        <strong>{lesson.title ?? '未命名节次'}</strong>
        <small>{[s.course?.title, lesson.lecturerName].filter(Boolean).join(' · ') || '课程信息未提供'}</small>
      </div>
    </header>

    <Notice>{s.error}</Notice>

    <div className="zs-player-stage">
      {videoUrl
        ? <video
          ref={videoRef}
          className="zs-player-video"
          src={videoUrl}
          controls
          preload="metadata"
          playsInline
        />
        : <div className="zs-player-novideo">
          <strong>这一节没有回放视频</strong>
          <p>课件与字幕仍然可以对照着看。</p>
        </div>}
    </div>

    <div className="zs-player-tabs" role="tablist" aria-label="课堂资料">
      <button role="tab" aria-selected={tab === 'ppt'} className={tab === 'ppt' ? 'is-active' : ''} onClick={() => setTab('ppt')}>课件 <span>{slides.length}</span></button>
      <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'is-active' : ''} onClick={() => setTab('transcript')}>字幕 <span>{subtitles.length}</span></button>
    </div>

    {s.contentLoading
      ? <p className="zs-muted">正在读取课件与字幕…</p>
      : tab === 'ppt'
        ? (slides.length === 0
          ? <div className="zs-player-empty"><strong>这节课暂时没有课件</strong><p>课堂资料同步完成后会显示在这里。</p></div>
          : <div className="zs-player-ppt">
            <div className="zs-player-ppt-bar">
              <button className="zs-button" disabled={slideIndex <= 0} onClick={() => { setPinned(true); jumpTo(slides[slideIndex - 1].startMs); }}>上一页</button>
              <span>第 <strong>{current?.page ?? slideIndex + 1}</strong> 页 <span className="zs-muted">/ {slides.length}</span>
                {current?.startMs != null && <> · 课堂时间 {time(current.startMs)}</>}
                {pinned && <span className="zs-player-pin">已手动翻页</span>}</span>
              <button className="zs-button" disabled={slideIndex >= slides.length - 1} onClick={() => { setPinned(true); jumpTo(slides[slideIndex + 1].startMs); }}>下一页</button>
            </div>
            {current?.imageUrl
              ? <img className="zs-player-slide" src={current.imageUrl} alt={`第 ${current.page ?? slideIndex + 1} 页课件`} />
              : <div className="zs-player-empty"><strong>这一页没有图片</strong><p>服务端没有给这一页的帧。</p></div>}
            {autoSlide < 0 && <p className="zs-muted">视频还没走到第一页课件的时间。</p>}
          </div>)
        : (subtitles.length === 0
          ? <div className="zs-player-empty"><strong>这节课暂时没有字幕</strong><p>课堂资料同步完成后会显示在这里。</p></div>
          : <div className="zs-player-transcript">
            {subtitles.map((line, index) => <TranscriptLine
              key={`${line.startMs}-${index}`}
              line={line}
              index={index}
              active={index === activeLine}
              onJump={(ms) => { setPinned(false); jumpTo(ms); }}
            />)}
          </div>)}
  </section>;
}
