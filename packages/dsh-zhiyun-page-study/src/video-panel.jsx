// 「视频」栏：一节回放的**主视图 + 小窗 + 字幕**同屏。
//
// # 为什么它是「学习」页里的一栏，而不是一个页面
//
// 它原先是一个独立页面（`dsh-zhiyun-page-player`，从「我的课」点节次进来）。
// 但换一节看、看完整理、整理完再回看 —— 这三件事是**同一段动线**，拆成两个页面
// 的代价是每次都要离开当前上下文：看课时读不到讲义，读讲义时又回不到那一段。
//
// 现在它是学习页正文区的一栏（`zs-content-switch` 里的「视频」）。课程目录、
// 节次、解析终稿、出题、笔记全在同一页，切栏不换页，`<video>` 也就不会因为
// 切栏而重建 —— 那正是下面第一条约定要保的东西。
//
// # 版式
//
//   ┌───────────────────────────┬─────────────┐
//   │                           │  小窗（可换）│
//   │        主视图（可换）      ├─────────────┤
//   │                           │             │
//   │                           │  字幕        │
//   └───────────────────────────┴─────────────┘
//
// **主视图与小窗互换**：默认视频当主视图、课件当小窗；点小窗左上角的「⇄」
// 就把课件放主视图、视频缩进小窗。字幕固定在右下角，不参与互换 —— 它是"跟随"，
// 不是"主角"，位置一变就失去"扫一眼就能读"的作用。
//
// **没有回放时版式降级**：小窗整个不渲染，课件独占左边两行，右侧只剩字幕。
// 小窗那一格是**内容位**，拿它装一句"没有内容"才是真的占位 —— 那句提醒降级成
// 栏顶一行淡淡的字。这不违反约定 1：没有 `videoUrl` 就没有 `<video>`，没什么可卸载。
//
// **字幕可折叠**：折叠后只留"当前正在讲的那一句"，把右栏的高度还给课件。
//
// # 三条不能破的约定（照原始设计）
//
// 1. **播放器常驻**：`<video>` 在任何布局下都挂在树里。卸载它 = 声音当场断，
//    所以互换**只用 CSS 换位置**（改 `data-main`，两个舞台互换网格区域），
//    绝不用条件渲染摘节点。
// 2. **时间轴是唯一真源**：当前时刻由 `<video>` 的 `timeupdate` 驱动，
//    课件页与字幕行都是它的**投影**。反过来（让课件驱动视频）会与用户拖动
//    进度条打架。
// 3. **点字幕才跳**：不自动滚动。用户可能正在读某一行，自动滚走是打断。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computeSectionStats, toSeekBar } from 'dsh-zhiyun-player';
import { HlsVideo } from './hls-video.jsx';
import { blocksForStats, sectionFacts } from './seek-bar.js';

/**
 * 只放行 http(s) 的媒体地址。
 *
 * `videoUrl` 来自课堂接口，是外部数据；`src` 虽然不会像 `href` 那样执行
 * `javascript:`，但 `data:` 之类同样不该直接进播放器。这里与学习页正文里的
 * 链接用同一套口径（`safeLink`），取不到合法地址就当作"这一节没有回放"。
 */
function safeMedia(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, globalThis.location?.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
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

/**
 * 一条字幕行。`active` 由视频时间决定，不由点击决定 —— 点击只负责跳转。
 *
 * `domId` 可选：折叠态那一行是**同一行**的第二份渲染，两份同时在树里（列表用
 * `display: none` 收起），带同一个 id 就成了重复 id。所以锚点 id 只给列表那一份。
 */
function TranscriptLine({ line, index, active, onJump, domId }) {
  return <button
    type="button"
    id={domId}
    className={`zs-video-line${active ? ' is-active' : ''}`}
    onClick={() => onJump(line.startMs)}
  >
    <time>{time(line.startMs)}</time>
    <span>{line.text}</span>
  </button>;
}

function SectionFacts({ stats }) {
  return <dl className="zs-video-facts">{sectionFacts(stats).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function ContentRail({ bar, nowMs, onJump }) {
  const play = bar.axisMs > 0 ? Math.min(1, Math.max(0, nowMs / bar.axisMs)) : 0;
  const current = bar.segments.find((segment) => play >= segment.from && play < segment.to) ?? null;
  const seek = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || !(bar.axisMs > 0)) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onJump(ratio * bar.axisMs);
  };
  const nudge = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 5000 : -5000;
    onJump(Math.min(bar.axisMs, Math.max(0, nowMs + step)));
  };
  return <div className="zs-video-rail">
    <div className="zs-video-heat" aria-hidden="true">{bar.heat.map((bucket, index) => <span key={index} className="zs-video-heat-cell" data-empty={bucket.heat == null ? 'true' : undefined} style={{ left: `${bucket.from * 100}%`, width: `${Math.max(0, (bucket.to - bucket.from) * 100)}%`, '--heat': bucket.heat ?? 0 }} />)}</div>
    <div className="zs-video-seek" role="slider" tabIndex={0} aria-label="按课堂内容跳转" aria-valuemin={0} aria-valuemax={Math.round(bar.axisMs)} aria-valuenow={Math.round(Math.min(bar.axisMs, Math.max(0, nowMs)))} onClick={seek} onKeyDown={nudge}>
      {bar.segments.map((segment, index) => <span key={index} className="zs-video-seg" data-role={segment.role ?? 'none'} title={segment.summary || undefined} style={{ left: `${segment.from * 100}%`, width: `${Math.max(0, (segment.to - segment.from) * 100)}%` }} />)}
      <span className="zs-video-playhead" style={{ left: `${play * 100}%` }} />
    </div>
    <p className="zs-video-rail-note"><span data-role="main">主线</span><span data-role="branch">支线</span><span>细条是语速，灰段是估不出来</span>{current?.summary ? <span className="zs-video-rail-now">{current.summary}</span> : null}</p>
  </div>;
}

export function VideoPanel({ state }) {
  const videoRef = useRef(null);
  const [nowMs, setNowMs] = useState(0);
  const [axisMs, setAxisMs] = useState(0);
  const lesson = state.lesson;
  const slides = state.content?.slides?.items ?? [];
  const subtitles = state.content?.subtitles?.items ?? [];
  const videoUrl = safeMedia(lesson?.videoUrl);
  /**
   * 主视图放什么：`'video'` 或 `'ppt'`。
   *
   * 只影响**位置**，不影响挂载 —— 两个舞台都在树里，靠 CSS 互换网格区域。
   * 这是本栏最容易被写坏的地方：用条件渲染"把视频换成课件"会让 `<video>` 卸载，
   * 声音断在那一帧，而且 `currentTime` 也丢了。
   *
   * 没有回放的节次**默认课件做主视图**：一块全黑、中央一行小字的舞台看着就是
   * "坏了"。何况这种情况下视频舞台根本不存在（见下面 `videoStage`），
   * 这个默认值只是让换节时不必特殊对待。
   */
  const [main, setMain] = useState(() => (videoUrl ? 'video' : 'ppt'));
  /** 用户手动翻了课件时暂停"跟时间走"，直到他再点字幕。 */
  const [pinned, setPinned] = useState(false);
  /**
   * 字幕是否展开。
   *
   * 默认展开：第一次进这一栏的人先要看"讲了什么"，那比"课件多大"重要。
   * 收起是读过之后的主动选择 —— 1300 多条常驻右栏时，课件被挤成邮票。
   *
   * 收起态不换渲染分支、也不摘 `<video>`：只是让列表 `display: none`，
   * 折叠行仍然用 `activeLine` 显示当前这一句。
   */
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  // 视频时间驱动一切。不自动滚动字幕（原始设计的约定 3）。
  useEffect(() => {
    const node = videoRef.current;
    if (!node) return undefined;
    const onTime = () => setNowMs(node.currentTime * 1000);
    const onDuration = () => setAxisMs(Number.isFinite(node.duration) ? node.duration * 1000 : 0);
    node.addEventListener('timeupdate', onTime);
    node.addEventListener('seeked', onTime);
    node.addEventListener('loadedmetadata', onDuration);
    node.addEventListener('durationchange', onDuration);
    onDuration();
    return () => {
      node.removeEventListener('timeupdate', onTime);
      node.removeEventListener('seeked', onTime);
      node.removeEventListener('loadedmetadata', onDuration);
      node.removeEventListener('durationchange', onDuration);
    };
  }, [videoUrl]);

  // 换节时把「钉住的页」放开、时间归零、主视图也回到这一节的默认 ——
  // 否则上一节的页码与主视图选择会带到新节上。
  useEffect(() => { setPinned(false); setNowMs(0); setAxisMs(0); setMain(videoUrl ? 'video' : 'ppt'); }, [lesson?.subId, videoUrl]);

  const sectionStats = useMemo(() => {
    const blocks = blocksForStats(state.result);
    if (!blocks.some((block) => Number.isFinite(block.startMs))) return null;
    const stats = computeSectionStats(blocks);
    return stats.records.length ? stats : null;
  }, [state.result]);
  const contentBar = useMemo(() => {
    if (!sectionStats) return null;
    const axis = axisMs > 0 ? axisMs : sectionStats.durationMs;
    if (!(axis > 0) || sectionStats.segments.length === 0) return null;
    return toSeekBar(sectionStats, axis);
  }, [sectionStats, axisMs]);
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

  if (state.contentLoading) {
    return <div className="zs-video-loading"><span className="zs-spinner" />正在读取课件与字幕…</div>;
  }

  // 没有回放就**没有视频舞台**。小窗那一格是内容位：拿它装一句"没有回放"，
  // 等于让一块不是内容的东西长期占座，把本该给课件的空间锁死。那句提醒降级成
  // 栏顶一行小字（见下面的 `zs-video-notice`），不配卡片。
  //
  // 这不违反"播放器常驻"：没有 `videoUrl` 也就没有 `<video>` 可卸载。有回放时
  // 两个舞台照旧都在树里，只有 `data-main` 变。
  //
  // ⚠️ 为什么用 `HlsVideo` 而不是裸 `<video src>`：回放地址通常是 mp4（原生可播），
  //    但历史课件里也有 HLS 源。裸 `<video>` 在 Chrome 上碰到 m3u8 是**黑屏且
  //    不报错**；`HlsVideo` 只在「是 m3u8 且原生不支持」时才去拉 hls.js，mp4
  //    路径一个字节都不变（见 `hls.js` 的 `needsHlsJs`）。
  //    它仍然把同一个 `ref` 交回来 —— `timeupdate` / `currentTime` 那套时间轴
  //    契约完全没有变，这是本栏"时间轴是唯一真源"的前提。
  const videoStage = videoUrl
    ? <div className="zs-video-stage zs-video-stage-video">
      <HlsVideo ref={videoRef} src={videoUrl} className="zs-video-media" preload="metadata" />
      {contentBar && <ContentRail bar={contentBar} nowMs={nowMs} onJump={jumpTo} />}
    </div>
    : null;

  /** 课件舞台：翻页控制 + 当前页。主视图与小窗共用同一份 DOM。 */
  const pptStage = <div className="zs-video-stage zs-video-stage-ppt">
    {main === 'ppt' && slides.length > 0
      ? <>
        <div className="zs-video-bar">
          <button
            className="zs-video-step"
            aria-label="上一页"
            disabled={slideIndex <= 0}
            onClick={() => { setPinned(true); jumpTo(slides[slideIndex - 1].startMs); }}
          >‹</button>
          <span className="zs-video-pos">
            第 <strong>{current?.page ?? slideIndex + 1}</strong> 页
            <span className="zs-muted"> / {slides.length}</span>
            {current?.startMs != null && <span className="zs-video-at">{time(current.startMs)}</span>}
            {pinned && <span className="zs-video-pin">已手动翻页</span>}
          </span>
          <button
            className="zs-video-step"
            aria-label="下一页"
            disabled={slideIndex >= slides.length - 1}
            onClick={() => { setPinned(true); jumpTo(slides[slideIndex + 1].startMs); }}
          >›</button>
        </div>
        {current?.imageUrl
          ? <img className="zs-video-slide" src={current.imageUrl} alt={`第 ${current.page ?? slideIndex + 1} 页课件`} />
          : <div className="zs-video-empty"><strong>这一页没有图片</strong><p>服务端没有给这一页的帧。</p></div>}
      </>
      : (slides.length > 0 && current?.imageUrl
        ? <img className="zs-video-slide" src={current.imageUrl} alt={`第 ${current.page ?? slideIndex + 1} 页课件（小窗）`} />
        : <div className="zs-video-empty"><strong>这节课暂时没有课件</strong></div>)}
  </div>;

  /**
   * 折叠态的那一行：只放 `activeLine` 算出来的"正在讲的这一句"。
   *
   * 还没讲到第一条时 `activeLine` 是 -1（`indexAt` 的约定），这时给一句淡提示，
   * 而不是硬套第 0 条 —— 那会让"还没开始"看起来像"已经讲到第一句"。
   */
  const activeTranscriptLine = activeLine >= 0 ? subtitles[activeLine] : null;

  // `data-main` 只在有回放时才有意义：它的职责是"哪个舞台占大格"，没有视频就没有
  // 可换的两块。不写这个属性时 CSS 走「课件独占主视图」的那条规则（见 video.css）。
  const stage = videoUrl ? <>{videoStage}{pptStage}</> : pptStage;

  return <section
    className="zs-video"
    data-main={videoUrl ? main : undefined}
    data-transcript={transcriptOpen ? 'on' : 'off'}
    aria-label="课堂视频"
  >
    {sectionStats && <SectionFacts stats={sectionStats} />}
    <div className="zs-video-grid">
      {/* ⚠️ 有回放时两个舞台**都在树里**，靠 `data-main` 决定谁占据大格。
          顺序也不能条件化：把某一个从树下摘掉就是卸载播放器。
          没有回放时本来就没有 `<video>`，所以那条路径下只剩课件一个舞台。 */}
      {stage}

      {/* 互换钮是**小窗这个格子**的，不是某个舞台的 —— 放进课件舞台会跟着课件
          跑到主视图去。它在网格里自成一项、落在小窗那一格（`.zs-video-swap` 用
          `grid-column`/`grid-row` 定位，见 video.css），所以无论谁是主视图，
          它永远停在小窗的左上角。没有回放就没有小窗、也没得换，所以不渲染。 */}
      {videoUrl && <button
        type="button"
        className="zs-video-swap"
        aria-label={main === 'video' ? '切换到课件为主视图' : '切换到视频为主视图'}
        title={main === 'video' ? '课件为主视图' : '视频为主视图'}
        onClick={() => setMain((value) => (value === 'video' ? 'ppt' : 'video'))}
      ><span aria-hidden="true">⇄</span></button>}

      <aside className="zs-video-transcript" aria-label="字幕">
        <div className="zs-video-transcript-head">
          <span>字幕</span>
          {/* 没有回放的提醒挂在这一行的右侧：它是**说明**，不是内容，
              所以不给它卡片、不占网格 —— 详情见 video.css 的 .zs-video-notice。 */}
          {!videoUrl && <span className="zs-video-notice">这一节没有回放视频</span>}
          {subtitles.length > 0 && <small>{subtitles.length} 条</small>}
          {subtitles.length > 0 && <button
            type="button"
            className="zs-video-transcript-toggle"
            aria-expanded={transcriptOpen}
            aria-label={transcriptOpen ? '收起字幕' : '展开字幕'}
            title={transcriptOpen ? '收起字幕，只留当前一句' : '展开字幕，看完整列表'}
            onClick={() => setTranscriptOpen((value) => !value)}
          >
            <span aria-hidden="true">{transcriptOpen ? '▾' : '▸'}</span>
            {transcriptOpen ? '收起' : '展开'}
          </button>}
        </div>
        {subtitles.length === 0
          ? <p className="zs-video-transcript-empty">这节课暂时没有字幕</p>
          : <>
            <div className="zs-video-transcript-body">
              {subtitles.map((line, index) => <TranscriptLine
                key={`${line.startMs}-${index}`}
                domId={`zs-video-line-${index}`}
                line={line}
                index={index}
                active={index === activeLine}
                onJump={(ms) => { setPinned(false); jumpTo(ms); }}
              />)}
            </div>
            {/* 折叠时才显示的一行。放在 body 之后是因为它和列表**不同时可见**
                （CSS 用 `display: none` 切换，见 .zs-video[data-transcript="off"]）。 */}
            <div className="zs-video-transcript-active">
              {activeTranscriptLine
                ? <TranscriptLine
                  line={activeTranscriptLine}
                  index={activeLine}
                  active
                  onJump={(ms) => { setPinned(false); jumpTo(ms); }}
                />
                : <p className="zs-video-transcript-idle">还没讲到字幕</p>}
            </div>
          </>}
      </aside>
    </div>
  </section>;
}
