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
import { computeSectionStats, toSeekBar } from 'dsh-zhiyun-core-player';
import { resolveTrack, burnLine, activeIndex, speechBands, TRACK_KIND } from 'dsh-zhiyun-core-playback';
import { MediaControls } from './media-controls.jsx';
import { skipTargetMs } from './skip-branch.js';
import { buildUniformPlan } from './uniform-speed.js';
import { buildTopicRanges, topicAt, topicList } from './topic-range.js';
import { mergeSegments } from './segment-merge.js';
import {
  SPLIT_DEFAULTS, ratioFromPointer, clampRatio, splitColumns, topicFits,
} from './split-pane.js';
import { TopicTrack } from './topic-track-panel.jsx';
import { HlsVideo } from './hls-video.jsx';
import { blocksForStats, sectionFacts } from './seek-bar.js';

/**
 * 是否用**自绘控制条**替换原生控制条。
 *
 * 这是唯一的回退开关：改成 `false` 就回到原生控制条（字幕照旧烧在画面上），
 * 不必回退任何文件。留它是因为上一版自绘控制条曾让整页白屏过一次 ——
 * 有个一行就能关掉的东西，比"必须回退文件再重建"安全得多。
 */
const USE_CUSTOM_CONTROLS = true;

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

/**
 * 课件页该用哪个地址显示。
 *
 * # 为什么优先本地
 *
 * 翻页卡顿的根因是**每翻一页都是一次带签名 URL 的网络往返**。宿主把每次读到的
 * 课件页缓存到本地磁盘后用 `/zhiyun-slides/<key>` 暴露出来，命中时翻页就退化成
 * 磁盘读取 —— 这才是"缓存"要换的东西，不是省流量。
 *
 * # 为什么未命中就回原始地址
 *
 * `cacheUrl` 只在**已经缓存好**时才出现（宿主不撒"稍后会有"的假地址）。
 * 没有它就用 `imageUrl`，行为与加缓存之前完全一致：先有图可看，后台再补缓存。
 *
 * 两条地址都要过 `safeMedia`：`imageUrl` 是外部数据，`cacheUrl` 虽然由宿主生成，
 * 但它最终也来自一次接口响应，同一个口径挡一遍不值得省。
 */
function slideSource(slide) {
  if (!slide) return null;
  return safeMedia(slide.cacheUrl) ?? safeMedia(slide.imageUrl);
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
 *
 * `dim`：时间不可信的条目（终稿里按比例插值出来的句子、或原始字幕里跨了几十分钟
 * 的尾噪条）。它们仍然显示 —— 用户需要看见原文 —— 但不参与高亮，视觉上退一档。
 * 不退的话，用户会以为这一句的时间是准的。
 */
function TranscriptLine({ line, index, active, onJump, domId, dim = false }) {
  return <button
    type="button"
    id={domId}
    className={`zs-video-line${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}
    onClick={() => onJump(line.startMs)}
    title={dim ? '这条的时间不可信（清洗插值或尾噪），仅供参考' : undefined}
  >
    <time>{time(line.startMs)}</time>
    <span>{line.text}</span>
  </button>;
}

function SectionFacts({ stats }) {
  return <dl className="zs-video-facts">{sectionFacts(stats).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

/**
 * 知识点的完整标签（悬停提示用）：`章 · 知识点`。
 *
 * 章可能为空（没做整节梳理时整棵树只有一章，标题也是空的），
 * 所以不能直接拼 `${chapter} · ${title}` —— 那样会出现「· 二分查找」。
 */
function topicLabel(topic) {
  const chapter = typeof topic?.chapterTitle === 'string' ? topic.chapterTitle.trim() : '';
  const title = typeof topic?.title === 'string' ? topic.title.trim() : '';
  if (chapter && title) return `${chapter} · ${title}`;
  return title || chapter;
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

export function VideoPanel({ state, seek = null }) {
  const videoRef = useRef(null);
  const [nowMs, setNowMs] = useState(0);
  const [axisMs, setAxisMs] = useState(0);
  const lesson = state.lesson;
  const slides = state.content?.slides?.items ?? [];
  /** 画面层（视频 + 烧上去的字幕）。只用于**定位**，不是全屏目标。 */
  const frameRef = useRef(null);
  /**
   * 整个视频网格（视频 + PPT 小窗 + 知识点条 + 控制条）。**全屏的目标**。
   *
   * 全屏它而不是 `frame`，是为了在全屏里仍然能「⇄」切换视频/课件主视图 ——
   * 只全屏 `frame` 会把 PPT 排除在全屏之外，切换必须退出全屏。
   */
  const stageRef = useRef(null);
  /**
   * 字幕轨：**优先走清洗后的句子**（终稿 `state.result.sentences`），没有终稿才
   * 退回原始 ASR 碎片。见 `dsh-zhiyun-core-playback/src/transcript.js`。
   *
   * 为什么不直接读 `content.subtitles.items`：那是碎片。真实一节课 915 条，
   * 前四条是「行。」「是。」「嗯。」「是嗯。」—— 铺给用户看是没法读的。
   * `resolveTrack` 会把它们合并成句子，并把时间不可信的条目降级。
   */
  const track = useMemo(
    () => resolveTrack(state.result?.sentences, state.content?.subtitles?.items),
    [state.result?.sentences, state.content?.subtitles?.items],
  );
  const subtitles = track.lines;
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
  /**
   * 用户手动钉住的课件页下标；`null` 表示"跟随视频"。
   *
   * # 为什么是下标而不是布尔 `pinned`
   *
   * 旧实现是布尔值，且 `slideIndex = pinned ? clamp(autoSlide) : autoSlide` ——
   * **两条分支都用了 `autoSlide`**，所以 pinned 从来没真正生效过：用户点「‹」
   * 翻页后，下一帧 `timeupdate` 就把他拽回当前页。这是用户报"被系统拉回"的根因。
   *
   * 记下标之后行为才定义得清楚：
   *
   * | `pinnedIndex` | 行为 |
   * |---|---|
   * | `null` | 跟着视频走（默认） |
   * | 等于当前视频页 | **仍然跟着走** —— 用户翻回当前页就是在恢复跟随 |
   * | 不等于当前视频页 | 冻结在那一页，不再被拽回；显示「回到当前页」按钮 |
   *
   * 第三条里那个"等于当前页就恢复跟随"是刻意的：用户手动翻到的那一页如果
   * 正好是视频现在讲的页，他就没有"脱离"的意图，不该还挂着一个复位按钮。
   */
  const [pinnedIndex, setPinnedIndex] = useState(null);
  /**
   * 用户手动选的章节号；`null` 表示知识点的章节跟随视频。
   *
   * 和课件同构的三态：翻回当前章就恢复跟随（`resolveBrowse` 里判断），
   * 真正脱离时显示「回到当前」。分两个 state 而不是一个"浏览中"布尔，
   * 是因为它们**互不影响**：可以翻章看知识点、同时让课件跟着视频。
   */
  const [browseChapterNo, setBrowseChapterNo] = useState(null);
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
  /**
   * 右栏显示什么：`'topic'`（知识点轨道）或 `'transcript'`（完整字幕列表）。
   *
   * 默认知识点 —— 字幕已烧在画面底部，右栏列一遍是重复；
   * 而"现在讲到哪 / 接下来是什么"只有知识点能给。
   * 没有知识点（没生成讲义）时自动落回字幕。
   */
  const [sidePanel, setSidePanel] = useState('topic');

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
  useEffect(() => { setPinnedIndex(null); setBrowseChapterNo(null); setNowMs(0); setAxisMs(0); setMain(videoUrl ? 'video' : 'ppt'); }, [lesson?.subId, videoUrl]);

  const sectionStats = useMemo(() => {
    const blocks = blocksForStats(state.result);
    if (!blocks.some((block) => Number.isFinite(block.startMs))) return null;
    const stats = computeSectionStats(blocks);
    return stats.records.length ? stats : null;
  }, [state.result]);
  /**
   * 未归并的原始分段。给**需要精确边界**的地方用（跳支线）。
   *
   * 与 `contentBar` 分开是因为职责不同：
   * - 渲染要清爽 → 归并；
   * - 跳转要精确 → 不归并。
   */
  const rawBar = useMemo(() => {
    if (!sectionStats) return null;
    const axis = axisMs > 0 ? axisMs : sectionStats.durationMs;
    if (!(axis > 0) || sectionStats.segments.length === 0) return null;
    return toSeekBar(sectionStats, axis);
  }, [sectionStats, axisMs]);
  const contentBar = useMemo(() => {
    if (!rawBar) return null;
    /* ⚠️ **渲染前归并分段**（`rawBar` 是不归并的，留给跳转用）。
     *
     * `core-player` 的分段保留的是语义边界（相邻 + 角色相同 + `facets` 全等），
     * 而 `facets` 是逐块标注的细维度 —— 于是 100 分钟的课会画出几十上百个
     * 短段，在 20px 高的轨道上就是一片密集方块（用户报的"每个主线都是一个框"）。
     *
     * 归并在**绘制层**做，不动 `core-player`：那个语义边界对统计
     * （知识点数、主线占比）有价值，而且它还有别的消费方。
     * 渲染要的是"一眼看出结构"，不是"逐块编号"。
     *
     * 归并只影响**画出来的东西**，不影响跳支线的判定（那个用 `rawBar`）。 */
    return { ...rawBar, segments: mergeSegments(rawBar.segments, rawBar.axisMs) };
  }, [rawBar]);
  const autoSlide = useMemo(() => indexAt(slides, nowMs), [slides, nowMs]);
  const followSlide = Math.max(0, autoSlide);
  /**
   * 实际显示的课件页。
   *
   * 三态（见 `pinnedIndex` 注释）：
   * - 没钉 → 跟视频；
   * - 钉的那页 = 视频当前页 → **仍然跟**（用户翻回来了，意图就是恢复跟随）；
   * - 钉的那页 ≠ 视频当前页 → 冻结在钉住的位置。
   *
   * `detached` 这个派生量给 UI 用：只有真正脱离时才显示「回到当前页」。
   */
  const detached = pinnedIndex !== null && slides.length > 0 && pinnedIndex !== followSlide;
  const slideIndex = detached
    ? Math.min(Math.max(pinnedIndex, 0), slides.length - 1)
    : followSlide;
  /**
   * 当前该高亮/该烧在画面上的那一句。
   *
   * `activeIndex` 与页面里 `indexAt` 语义相同（最后一条起点不晚于 t），
   * 但**跳过时间不可信的条目**：尾噪条（跨几十分钟的「对。」）与终稿里
   * 按比例插值出来的句子不该抢高亮，否则用户会看到一句还没讲的话先亮起来。
   */
  const activeLine = useMemo(() => activeIndex(subtitles, nowMs), [subtitles, nowMs]);
  /** 烧在画面底部的那一行。空档期会继续挂着上一句（`burnLine` 的约定）。 */
  const burn = useMemo(() => burnLine(subtitles, nowMs), [subtitles, nowMs]);
  /**
   * 「跳过支线」开关。
   *
   * 只存在组件 state 里，刷新即回到关闭 —— 这是个会**改变播放内容**的开关，
   * 不该悄悄记成默认行为。用户每次想跳都得自己按一下。
   */
  const [skipBranch, setSkipBranch] = useState(false);
  /**
   * 「均速模式」开关。默认关闭。
   *
   * 开启后：按每段实际语速自动加权，让整节课的**信息密度**一致
   * （慢的地方加速、密的地方减速）；用户设定的倍率变成**平均速度**。
   *
   * 只在有语速数据（跑过解析、有终稿）时才有计划；没数据时开关不渲染。
   * 和跳支线一样只存在组件 state 里：它会改变播放内容，不该悄悄记成默认。
   */
  const [uniform, setUniform] = useState(false);
  /** 是否处于全屏。全屏下页面的版式规则整体让位给"影院模式"。 */
  const [stageFullscreen, setStageFullscreen] = useState(false);
  /**
   * 全屏下是否**分屏**（左视频 + 右 PPT/知识点）。
   *
   * 默认 `false` —— 全屏默认只显示视频与字幕，这是用户明确定的规则：
   * "全屏默认完全不显示（PPT 与知识点）"。分屏由控制条上的按钮按需触发。
   *
   * 退出全屏时**重置为 false**（在 `fullscreenchange` 里做）——
   * 分屏是一次性的观看选择，不是长期偏好；下次进全屏应该从小画面开始。
   */
  const [splitPane, setSplitPane] = useState(false);
  /**
   * 分屏时左栏（视频）占比。可拖 45%–72%，初值 65%。
   *
   * 退出全屏时**一并重置回默认**：用户拖动是为了当前这节课看得舒服
   * （比如这节 PPT 字小），下节课情况不同，记住反而会让人困惑
   * "为什么这次是 60/40 不是 65/35"。
   */
  const [splitRatio, setSplitRatio] = useState(SPLIT_DEFAULTS.ratio);
  /**
   * 右栏扣除 PPT 之后剩下的高度（px）。用来判断知识点该不该显示。
   *
   * 为什么不用 CSS 的 `auto` 直接让它塌陷：塌陷后它的边框、内边距还在，
   * 会留下一块 20px 的空白条。必须真的 `display: none`。
   */
  const [topicAreaPx, setTopicAreaPx] = useState(Number.POSITIVE_INFINITY);
  /**
   * 说话带：按**句**算「哪里真的有人在讲」，喂给自绘控制条那一条轨道。
   *
   * 与 `computeSectionStats` 按**块**算的语速是两种粒度 —— 后者需要终稿，
   * 前者只要字幕轨就有；没有终稿时它仍然能画出内容分布。
   */
  const bands = useMemo(
    () => speechBands(subtitles, axisMs > 0 ? axisMs : (sectionStats?.durationMs ?? 0)),
    [subtitles, axisMs, sectionStats?.durationMs],
  );

  /**
   * 均速模式的变速计划。
   *
   * 用 `sectionStats.speedBuckets`（每段的真实语速）和
   * `averageCharsPerSecond`（全片平均）算出「每一时刻该用多少倍率」。
   *
   * 计划的**基准倍率固定为 1**（即"让密度等于平均语速"）；用户的平均速度
   * 由 `MediaControls` 在查表时乘进去 —— 这样用户调速度不必重建计划。
   *
   * 没有终稿（`sectionStats` 为空）时计划为空，开关也就不会渲染。
   */
  const uniformPlan = useMemo(() => {
    if (!sectionStats) return null;
    const { plan } = buildUniformPlan(
      sectionStats.speedBuckets,
      sectionStats.averageCharsPerSecond,
      1,   // 基准 = 1；用户倍率在查表时叠加
    );
    return plan.length > 0 ? plan : null;
  }, [sectionStats]);

  /**
   * 知识点时间区间：把讲义的知识点反查回视频时间轴。
   *
   * 链路是「讲义 `chapters[].topics[].blockIndexes` → 终稿块 `startMs/endMs`」。
   * 知识点是**比主线/支线高一级**的结构，用户看视频时更需要知道"现在讲到哪个
   * 知识点"，而不是"这一段是主线还是支线"。
   *
   * 没有讲义时 `ranges` 为空，UI 不显示这一行 —— 不假装有层级信息。
   */
  const topicRanges = useMemo(
    () => buildTopicRanges(state.lecture, state.result?.blocks).ranges,
    [state.lecture, state.result?.blocks],
  );
  /** 当前时刻所在的知识点。空隙里是 `null`（老师停顿/翻页），UI 要能接受。 */
  const currentTopic = useMemo(() => topicAt(topicRanges, nowMs), [topicRanges, nowMs]);
  /** 有标题的知识点列表，供「上一个 / 下一个」跳转。 */
  const topics = useMemo(() => topicList(topicRanges), [topicRanges]);
  const current = slides[slideIndex] ?? null;

  /**
   * 自动跳过支线。
   *
   * # 三条把关（任何一条不满足就不跳）
   *
   * 1. **只在播放中跳**。暂停时用户手拖到支线，那是他自己要看的，跳走等于抢方向盘。
   * 2. **拖动中不跳**。`node.seeking` 为真时不介入，避免和用户的 seek 打架。
   * 3. **必须有前进的目标**。`skipTargetMs` 保证目标严格大于当前时刻，
   *    否则写回同一个 `currentTime` 会反复触发 `timeupdate` —— 死循环。
   *
   * 依赖 `nowMs` 而不是自己监听 `timeupdate`：这一层的时间轴真源是父组件那个
   * `nowMs`（`<video>` 的 `timeupdate` 喂它），跟着它走不会出现两套时钟。
   */
  useEffect(() => {
    if (!skipBranch || !rawBar) return;
    const node = videoRef.current;
    if (!node || node.paused || node.seeking) return;
    /* ⚠️ 用**未归并**的 `rawBar`，不是给渲染用的 `contentBar`。
     *
     * 归并会把相邻同角色的短段并成一个（为了画得清爽），段边界因此变宽。
     * 拿它去算"跳到支线末尾"会跳过头 —— 原本 5 分钟的支线可能被并成 8 分钟，
     * 用户会莫名少看 3 分钟主线。渲染可以将就，跳转不行。 */
    const target = skipTargetMs(rawBar.segments, rawBar.axisMs, nowMs);
    if (target === null) return;
    node.currentTime = target / 1000;
    setNowMs(target);
  }, [nowMs, skipBranch, rawBar]);

  /** 跳到某个时刻（点字幕、翻课件都走它，保证"视频是唯一真源"）。 */
  const jumpTo = (ms) => {
    const node = videoRef.current;
    if (node && Number.isFinite(ms)) node.currentTime = Math.max(0, ms / 1000);
    setNowMs(ms);
  };

  /**
   * 全屏**整个视频舞台**（`.zs-video-grid`），不是 `<video>`、也不是只含画面的 `frame`。
   *
   * # 为什么不全屏 `<video>`
   *
   * 原生控制条的全屏按钮进的是 `video.requestFullscreen()` —— 浏览器只把那个
   * `<video>` 元素放大，**兄弟节点全部不显示**，于是烧上去的字幕在全屏里消失
   * （用户实测）。所以原生按钮被 `controlsList="nofullscreen"` 去掉了。
   *
   * # 为什么不全屏 `.zs-video-frame`
   *
   * 第一版全屏的是 `frame`（视频 + 字幕），字幕确实留住了，但**PPT 被排除在外** ——
   * 全屏后想切课件必须退出全屏再切（用户实测："上课爽全屏能自由切 PPT，我们不行"）。
   *
   * 现在全屏 `stageRef`（整个网格）：视频、PPT 小窗、知识点条、互换钮、
   * 控制条全都进去，全屏内可以照常点「⇄」切换主视图。
   */
  const toggleStageFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.()?.catch?.(() => {});
  };

  /**
   * 兜底：万一还是有一帧 `<video>` 自己被全屏了（双击画面、右键菜单、
   * 或某些浏览器忽略 `controlsList`），**退出后立刻改成全屏舞台**。
   *
   * 这里只能尽力而为：`exitFullscreen()` 之后再 `requestFullscreen()` 可能被
   * 浏览器以"缺少用户手势"拒绝。拒绝时保持原生全屏（没有字幕但视频正常），
   * 不会黑屏或卡死。
   */
  useEffect(() => {
    const onFullscreenChange = () => {
      const element = document.fullscreenElement;
      const isOurs = element !== null && element === stageRef.current;
      setStageFullscreen(isOurs);
      /* 退出全屏时重置分屏与比例。
       *
       * 用户定的规则是「全屏默认完全不显示 PPT 与知识点」—— 如果退出再进来
       * 还保持着分屏，那条规则就被破坏了。比例同理：拖动是为当下这节课
       * 看的舒服，不是长期偏好。 */
      if (!isOurs) {
        setSplitPane(false);
        setSplitRatio(SPLIT_DEFAULTS.ratio);
      }
      if (element && element === videoRef.current) {
        document.exitFullscreen?.()
          ?.then(() => stageRef.current?.requestFullscreen?.())
          ?.catch?.(() => {});
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  /**
   * 分隔条拖动。
   *
   * 用 `pointerdown` + `setPointerCapture`：拖到窗口外也要继续跟着，
   * 否则一滑出边界拖动就断（和进度条拖动同样的理由）。
   *
   * 只在 `splitPane` 为真时有意义 —— 单画面模式没有分隔条可拖。
   */
  const splitDragging = useRef(false);
  const onSplitPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitDragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onSplitPointerMove = (event) => {
    if (!splitDragging.current) return;
    const grid = stageRef.current;
    if (!grid) return;
    const next = ratioFromPointer(event.clientX, grid.getBoundingClientRect());
    // `null` 表示量不到容器宽度 —— 跳过这一帧而不是把比例设成 0。
    if (next !== null) setSplitRatio(next);
  };
  const endSplitDrag = (event) => {
    if (!splitDragging.current) return;
    splitDragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  /** 分隔条的键盘操作：左右各 2%。无障碍与"手抖调不准"都用得上。 */
  const onSplitKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 0.02 : -0.02;
    setSplitRatio((current) => clampRatio(current + step));
  };

  /**
   * 测量知识点那一格还剩多少高度（决定它该不该显示）。
   *
   * 为什么必须实测：右栏是 `PPT(自适应) + 知识点(剩余)`，PPT 的高度取决于
   * 课件图片的宽高比 —— 纯 CSS 无法表达"剩余不到 120px 就整块隐藏"
   * （`auto` 塌陷会留下边框与内边距的残影）。
   */
  useEffect(() => {
    const grid = stageRef.current;
    if (!grid || !stageFullscreen || !splitPane) return undefined;
    /** 找右栏里课件舞台那一格，用 grid 的行来算剩余。 */
    const measure = () => {
      const stage = grid.querySelector('.zs-video-stage-ppt');
      if (!stage) { setTopicAreaPx(Number.POSITIVE_INFINITY); return; }
      const gridRect = grid.getBoundingClientRect();
      const pptRect = stage.getBoundingClientRect();
      // 剩余 = 网格底部 − 课件底部 − 行间距。
      setTopicAreaPx(gridRect.bottom - pptRect.bottom);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(grid);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [stageFullscreen, splitPane]);

  // 从知识点跳回来时，这一栏可能刚刚挂上。元数据还没到就把 currentTime
  // 写上去，浏览器会丢掉；loadedmetadata 再写一次。
  useEffect(() => {
    if (seek?.nonce == null || seek.ms == null || !Number.isFinite(Number(seek.ms))) return undefined;
    const ms = Number(seek.ms);
    const apply = () => {
      const node = videoRef.current;
      if (node) node.currentTime = Math.max(0, ms / 1000);
      setNowMs(ms);
      setPinnedIndex(seek.pin ? Math.max(0, indexAt(slides, ms)) : null);
    };
    apply();
    const node = videoRef.current;
    if (!node) return undefined;
    node.addEventListener("loadedmetadata", apply);
    return () => node.removeEventListener("loadedmetadata", apply);
  }, [seek?.nonce, videoUrl]);

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
      {/* ⚠️ 视频单独包一层 `.zs-video-frame`，只为给烧上去的字幕一个**相对画面**的
          定位上下文。舞台底部还有内容条（`.zs-video-rail`），若字幕相对舞台定位，
          `bottom` 就会落在内容条上 —— 之前真的发生过：字幕压在蓝色分段条上。
          这一层不改变 `<video>` 的挂载与尺寸（它仍是 `flex: 1`），原生 controls 保留。 */}
      <div className="zs-video-frame" ref={frameRef} data-controls={USE_CUSTOM_CONTROLS ? 'custom' : 'native'}>
        {/* ⚠️ `controlsList="nofullscreen"`：把原生控制条里的全屏按钮去掉。
            原因见下面 `fullscreenchange` 那段 —— 原生全屏只把 `<video>` 放进去，
            而字幕层是它的兄弟节点，全屏后会被排除在外（用户实测：全屏看不到字幕）。
            全屏改由我们自己那个按钮全屏**整个 frame**。 */}
        <HlsVideo
          ref={videoRef}
          src={videoUrl}
          className="zs-video-media"
          preload="metadata"
          controlsList="nofullscreen"
          /* 自绘控制条接管时关掉原生；`USE_CUSTOM_CONTROLS = false` 时回到原生。 */
          controls={!USE_CUSTOM_CONTROLS}
        />
        {/* 当前知识点：贴在画面**上部**，与底部的字幕分开。
            它是比主线/支线高一级的层级（来自讲义的知识树），所以位置也在更高处：
            用户在画面上看到的纵向顺序就是层级顺序。
            空隙（老师停顿/翻页）时 `currentTopic` 为 null —— 那时**不显示**，
            而不是拿上一个顶上：假装还在讲某个知识点比空着更误导。 */}
        {currentTopic && <div className="zs-video-topic" title={topicLabel(currentTopic)}>
          {currentTopic.chapterTitle && <span className="zs-video-topic-chapter">{currentTopic.chapterTitle}</span>}
          <span className="zs-video-topic-title">{currentTopic.title}</span>
        </div>}
        {/* 字幕**烧进播放器**：贴在画面底部。只显示「时间可信」的那一句，
            空档期继续挂着上一句并淡化（见 `burnLine`）。 */}
        {burn.line && <div
          className="zs-video-burn"
          data-gap={burn.leadMs != null ? 'true' : undefined}
          aria-live="polite"
        >
          <span className="zs-video-burn-text">{burn.line.text}</span>
        </div>}
        {/* 自绘控制条：贴在画面底部。那一条轨道**既是播放进度也是内容结构**
            （缓冲段 + 说话带 + 主线/支线分段 + 播放头）。
            它自带全屏按钮，所以下面那个独立的全屏按钮在自绘模式下不渲染。 */}
        {USE_CUSTOM_CONTROLS && <MediaControls
          videoRef={videoRef}
          bar={contentBar}
          preciseBar={rawBar}
          bands={bands}
          nowMs={nowMs}
          durationMs={axisMs}
          onSeek={jumpTo}
          onFullscreen={toggleStageFullscreen}
          skipBranch={skipBranch}
          onToggleSkipBranch={() => setSkipBranch((value) => !value)}
          uniform={uniform}
          /* 切换只改开关状态。`<video>` 的倍率由 `MediaControls` 里那个 effect
             按 `uniform` / `uniformPlan` / `nowMs` / `rate` 重新计算并写入 ——
             开启时写入加权值，关闭时写回用户平均值。这里不要再插手，
             否则两处都写 `playbackRate`，谁最后生效取决于时序，很难查。 */
          onToggleUniform={() => setUniform((value) => !value)}
          uniformPlan={uniformPlan}
          /* 全屏与分屏：只在全屏时给分屏回调，页面内不显示分屏按钮
             （那里已经有「⇄」切换主视图，两个入口会让人不知道该用哪个）。 */
          fullscreen={stageFullscreen}
          split={splitPane}
          onToggleSplit={stageFullscreen ? () => setSplitPane((value) => !value) : undefined}
        />}
        {/* 原生模式下的全屏按钮：全屏 `.zs-video-grid`（整个舞台），
            不是 `<video>` —— 对 `<video>` 全屏会把字幕和 PPT 都排除在外。 */}
        {!USE_CUSTOM_CONTROLS && <button
          type="button"
          className="zs-video-fullscreen"
          aria-label="全屏"
          title="全屏（保留字幕与课件）"
          onClick={toggleStageFullscreen}
        ><span aria-hidden="true">⛶</span></button>}
        {/* 旧的「课件放大到下方」按钮已删除：它被「分屏」取代。
            那个方案把课件铺在视频下方，但**知识点被挤没了**，而且用户
            真正要的是"自己决定要不要第二屏"，不是"切换一种固定布局"。
            分屏提供的是左视频 + 右 PPT/知识点，宽度还能拖。 */}
      </div>
      {/* 自绘控制条已经承担了"内容条"的职责，旧的独立内容条在那种模式下不再渲染，
          否则屏幕上又会出现两条进度条（上一版踩过的坑）。 */}
      {!USE_CUSTOM_CONTROLS && contentBar && <ContentRail bar={contentBar} nowMs={nowMs} onJump={jumpTo} />}
    </div>
    : null;

  /**
   * 翻到某一页课件。
   *
   * @param index - 目标页下标。
   * @param follow - `true` 表示**同时把视频跳到那一页对应的时刻**（"我要看那里"）；
   *   `false` 表示**只翻课件、不动视频**（"我想翻翻看别的地方"）。
   *
   * 为什么两种都要有：
   * - 用户时间轴在这里，只是想看下一页讲什么 → 不该动视频；
   * - 用户想跳到某页去复习 → 应该连视频一起跳。
   *
   * 现在的按钮给的是第一种（只翻课件）：全屏/分屏时课件是"参考资料"，
   * 点它就把视频带走会很意外。要连视频一起跳，用知识点轨道或进度条。
   */
  const goSlide = (index, follow) => {
    if (slides.length === 0) return;
    const target = Math.min(Math.max(index, 0), slides.length - 1);
    setPinnedIndex(target);
    if (follow) jumpTo(slides[target].startMs);
  };
  /** 回到视频当前页：清掉钉住，恢复跟随。 */
  const backToLive = () => setPinnedIndex(null);

  /** 课件舞台：翻页控制 + 当前页。主视图与小窗共用同一份 DOM。 */
  const pptStage = <div className="zs-video-stage zs-video-stage-ppt">
    {main === 'ppt' && slides.length > 0
      ? <>
        <div className="zs-video-bar">
          <button
            className="zs-video-step"
            aria-label="上一页"
            disabled={slideIndex <= 0}
            onClick={() => goSlide(slideIndex - 1, false)}
          >‹</button>
          <span className="zs-video-pos">
            第 <strong>{current?.page ?? slideIndex + 1}</strong> 页
            <span className="zs-muted"> / {slides.length}</span>
            {current?.startMs != null && <span className="zs-video-at">{time(current.startMs)}</span>}
          </span>
          {/* 「回到当前页」：只有**真正脱离**视频时才出现。
              用户翻回当前页时 `detached` 为假，按钮自动消失 ——
              那时他已经恢复跟随了，不需要再点。 */}
          {detached && <button
            type="button"
            className="zs-video-follow"
            onClick={backToLive}
            title="回到视频正在讲的那一页"
          >回到当前页</button>}
          <button
            className="zs-video-step"
            aria-label="下一页"
            disabled={slideIndex >= slides.length - 1}
            onClick={() => goSlide(slideIndex + 1, false)}
          >›</button>
        </div>
        {slideSource(current)
          ? <img
            className="zs-video-slide"
            src={slideSource(current)}
            alt={`第 ${current.page ?? slideIndex + 1} 页课件`}
            /* 脱离时整张图略微变暗 + 虚线边框：让"我现在看的是别处"这件事
               在画面上就能感知到，而不是只有那个小按钮在提示。 */
            data-detached={detached ? 'true' : undefined}
          />
          : <div className="zs-video-empty"><strong>这一页没有图片</strong><p>服务端没有给这一页的帧。</p></div>}
      </>
      : (slides.length > 0 && slideSource(current)
        ? <>
          <img
            className="zs-video-slide"
            src={slideSource(current)}
            alt={`第 ${current.page ?? slideIndex + 1} 页课件（小窗）`}
            data-detached={detached ? 'true' : undefined}
          />
          {/* 小窗也要能翻页。
              ⚠️ 之前翻页按钮只在 `main === 'ppt'`（课件作主视图）时渲染，
              而默认是视频作主视图、课件缩在小窗 —— 那里没有任何翻页控件，
              于是"自由翻课件"在最常见的布局下根本用不了（用户报的"ppt 还不行"）。
              小窗空间小，所以只给两个箭头 + 一个"回到当前"，页号用悬停提示。 */}
          <div className="zs-video-mini-bar" data-detached={detached ? 'true' : undefined}>
            <button
              type="button"
              className="zs-video-mini-step"
              aria-label="上一页"
              title={`上一页（第 ${Math.max(1, slideIndex)} 页）`}
              disabled={slideIndex <= 0}
              onClick={() => goSlide(slideIndex - 1, false)}
            >‹</button>
            <button
              type="button"
              className="zs-video-mini-step"
              aria-label="下一页"
              title={`下一页（第 ${Math.min(slides.length, slideIndex + 2)} 页）`}
              disabled={slideIndex >= slides.length - 1}
              onClick={() => goSlide(slideIndex + 1, false)}
            >›</button>
            {detached && <button
              type="button"
              className="zs-video-mini-follow"
              aria-label="回到视频当前页"
              title={`回到视频当前页（第 ${followSlide + 1} 页）`}
              onClick={backToLive}
            >回到当前</button>}
          </div>
        </>
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

  /**
   * 全屏「单画面」态：只在视频 + 字幕，PPT 与侧栏都不出现。
   *
   * ⚠️ 注意这里**不能**把 `videoStage` 一起条件化 —— `<video>` 一旦被摘掉
   * 就是卸载，声音断在那一帧、`currentTime` 也丢（本栏第一条铁律）。
   * 所以只在 CSS 层把无关的格子藏起来，DOM 结构一个节点都不动。
   */
  const singleFullscreen = stageFullscreen && !splitPane;

  return <section
    className="zs-video"
    data-main={videoUrl ? main : undefined}
    data-transcript={transcriptOpen ? 'on' : 'off'}
    data-fullscreen={stageFullscreen ? 'on' : undefined}
    data-split={stageFullscreen && splitPane ? 'on' : undefined}
    /* 知识点那格高度不足时整块隐藏（CSS 的 `[data-topic-hidden="on"]` 负责）。
       只在分屏下判断 —— 页面内的版式是固定的上下两栏，不需要这个。 */
    data-topic-hidden={stageFullscreen && splitPane && !topicFits(topicAreaPx) ? 'on' : undefined}
    aria-label="课堂视频"
  >
    {!(singleFullscreen) && sectionStats && <SectionFacts stats={sectionStats} />}
    <div
      className="zs-video-grid"
      ref={stageRef}
      /* 分屏比例走内联样式：它是用户拖出来的连续值，写不进 class。 */
      style={stageFullscreen && splitPane ? { gridTemplateColumns: splitColumns(splitRatio) } : undefined}
    >
      {/* ⚠️ 有回放时两个舞台**都在树里**，靠 `data-main` 决定谁占据大格。
          顺序也不能条件化：把某一个从树下摘掉就是卸载播放器。
          没有回放时本来就没有 `<video>`，所以那条路径下只剩课件一个舞台。 */}
      {stage}

      {/* 互换钮是**小窗这个格子**的，不是某个舞台的 —— 放进课件舞台会跟着课件
          跑到主视图去。它在网格里自成一项、落在小窗那一格（`.zs-video-swap` 用
          `grid-column`/`grid-row` 定位，见 video.css），所以无论谁是主视图，
          它永远停在小窗的左上角。没有回放就没有小窗、也没得换，所以不渲染。
          全屏单画面时也不渲染：那时没有小窗可换。 */}
      {videoUrl && !singleFullscreen && <button
        type="button"
        className="zs-video-swap"
        aria-label={main === 'video' ? '切换到课件为主视图' : '切换到视频为主视图'}
        title={main === 'video' ? '课件为主视图' : '视频为主视图'}
        onClick={() => setMain((value) => (value === 'video' ? 'ppt' : 'video'))}
      ><span aria-hidden="true">⇄</span></button>}

      {/* 分屏的分隔条。**只在分屏时存在** —— 单画面没有可拖的东西。 */}
      {stageFullscreen && splitPane && <div
        className="zs-split-handle"
        role="separator"
        tabIndex={0}
        aria-label="拖动调整视频与课件的宽度"
        aria-orientation="vertical"
        aria-valuenow={Math.round(splitRatio * 100)}
        aria-valuemin={Math.round(SPLIT_DEFAULTS.min * 100)}
        aria-valuemax={Math.round(SPLIT_DEFAULTS.max * 100)}
        onPointerDown={onSplitPointerDown}
        onPointerMove={onSplitPointerMove}
        onPointerUp={endSplitDrag}
        onPointerCancel={endSplitDrag}
        onKeyDown={onSplitKeyDown}
      />}

      {/* 右栏：**知识点轨道**优先，可切回字幕。
          为什么默认是知识点：字幕已经烧在画面底部了，右栏再列一遍是同一份
          信息的第二个副本；而"现在讲到哪、接下来是什么"这个问题，
          字幕列表回答不了（它只有时间顺序，没有层级）。
          **全屏单画面时不渲染**（`singleFullscreen`）—— 那是影院模式，只留画面。 */}
      {!singleFullscreen && (sidePanel === 'topic' && topicRanges.length > 0
        ? <>
          <TopicTrack
            ranges={topicRanges}
            atMs={nowMs}
            onJump={(ms) => { setPinnedIndex(null); jumpTo(ms); }}
            browseChapterNo={browseChapterNo}
            onBrowseChapter={(no) => setBrowseChapterNo(no ?? null)}
          />
          {/* 切换钮做成浮在轨道右上角的小按钮：它是"次要出口"，
              不该和知识点的标题行争位置。 */}
          <button
            type="button"
            className="zs-side-switch zs-side-switch-topic"
            aria-label="切换到字幕列表"
            title="看完整字幕列表"
            onClick={() => setSidePanel('transcript')}
          >字幕</button>
        </>
        : <aside className="zs-video-transcript" aria-label="字幕">
          <div className="zs-video-transcript-head">
            <span>字幕</span>
            {/* 没有回放的提醒挂在这一行的右侧：它是**说明**，不是内容，
                所以不给它卡片、不占网格 —— 详情见 video.css 的 .zs-video-notice。 */}
            {!videoUrl && <span className="zs-video-notice">这一节没有回放视频</span>}
            {subtitles.length > 0 && <small>{subtitles.length} 条</small>}
            {/* 可信度必须标出来：清洗后的句子和原始 ASR 碎片长得几乎一样，
                但只有前者是能读的。不标的话，用户会以为碎片就是这节课的全部内容。 */}
            {subtitles.length > 0 && <span
              className="zs-video-track-kind"
              data-kind={track.kind}
              title={track.kind === TRACK_KIND.CLEANED
                ? '来自解析终稿的清洗句子（已纠错、已合并成句）'
                : '这节课还没有清洗，显示语音识别原始碎片'}
            >{track.kind === TRACK_KIND.CLEANED ? '清洗后' : '原始碎片'}</span>}
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
            {/* 有知识点时给一个"回知识点"的入口 —— 否则切到字幕后就没有回头路。 */}
            {topicRanges.length > 0 && <button
              type="button"
              className="zs-video-transcript-toggle"
              aria-label="切换到知识点"
              title="看知识点路径"
              onClick={() => setSidePanel('topic')}
            >知识点</button>}
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
                  dim={line.state !== 'matched'}
                  onJump={(ms) => { setPinnedIndex(null); jumpTo(ms); }}
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
                    onJump={(ms) => { setPinnedIndex(null); jumpTo(ms); }}
                  />
                  : <p className="zs-video-transcript-idle">还没讲到字幕</p>}
              </div>
            </>}
        </aside>)}
    </div>
  </section>;
}
