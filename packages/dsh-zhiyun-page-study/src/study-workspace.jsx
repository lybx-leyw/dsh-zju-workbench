import React, { useEffect, useMemo, useState } from "react";
import { GenerationQueue } from './generation-queue.jsx';
import { useStudy } from 'dsh-zhiyun-shell-ui';
import { VideoPanel } from "./video-panel.jsx";
import { AiTeaching } from './ai-teaching.jsx';
import { BranchBoard } from './branch-board.jsx';
import { KnowledgeBoard, entryForBlock } from "./knowledge-board.jsx";
import { HlsVideo } from "./hls-video.jsx";
import { time, lessonWhen } from "./format.js";
import { QueryMode, queryModes, defaultQueryMode, queryModeOf, LayerId, defaultSearchLayers, layerLabel, availableLayers, layerRegistry, lineRoles, facetOptions } from "./layers.js";
import { searchLesson, hitBlockIndexes, lessonCatalog, searchNote } from "./layered-search.js";
import { corpusRows } from "./corpus.js";

// Keep the unfinished live experience off the UI; enable here when it is ready.
const LIVE_UI_ENABLED = false;

/**
 * 直播时段的读法。
 *
 * `beginSec` / `endSec` 是「当天第几秒」（`classroom/live.js` 的 `clockSec` 归一化过），
 * 和 `format.js` 里的 `time(ms)` 不是一回事 —— 那个读的是视频时间轴（`mm:ss`，分钟
 * 不进位），直播要的是墙上的钟点（`08:00–09:35`），所以单独写一个，两处共用。
 * 时间窗缺一半就只说有一半的那一边：编一个"结束时间"比留空更误导。
 */
function clockOf(second) {
  const total = Math.floor(Number(second));
  if (!Number.isFinite(total) || total < 0) return null;
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}`;
}
function liveWhen(item) {
  const begin = clockOf(item?.beginSec), end = clockOf(item?.endSec);
  if (begin && end) return `${begin}–${end}`;
  return begin ? `${begin} 起` : item?.statusLabel ?? "";
}

/**
 * 把 `state.liveError` 翻成一句「用户能据此决定要不要再点一次」的话。
 *
 * 这里只能按**文案**认出「未接入」，因为 `code` 没有跨过 RPC 边界：`client.jsx`
 * 抛的是 `Object.assign(new Error(message), { code })`，而控制器（`model.js` 的
 * `loadLiveToday` / `loadLiveStreams`）只把 `e.message` 写进 `state.liveError`。
 * 于是判断只能落在文案上 —— `workbench.js` 的 `liveSource()` 在宿主没有
 * `classroom.live` 时抛 `NOT_WIRED`，而 `publicError` 把该码统一翻成
 * 「所需加工插件未启用，请检查插件配置。」（原话「直播未接入」被这句话替掉）。
 * 两种写法都要认，否则换个入口就漏。
 *
 * 分这两类的意义在于**要不要让人重试**：
 *   · 网络 / 网关抖动 —— 值得再试；
 *   · 直播通路没接上 —— 再试一百次也一样。必须明说「这是配置、不是抖动」，
 *     并把「别处都还能用」写出来，否则用户会把一条可选通路的缺失理解成
 *     整个学习页坏了，反复点、反复等。
 */
const liveWired = (message) => !/未接入|未启用/.test(String(message ?? ""));
const liveReason = (message) => (liveWired(message)
  ? message
  : `${message}这是配置问题而不是网络抖动，重试也一样；课程、回放、整理与讲义都不受影响。`);

function CorpusSearch({ state, controller, onOpen }) {
  const [text, setText] = useState("");
  const view = corpusRows(state.corpusHits, state.courses);
  return <div className="zs-corpus">
    <label className="zs-tree-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="在已整理的终稿里找" placeholder="在已整理的终稿里找，回车" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void controller.searchCorpus(text); }} /></label>
    {state.corpusBusy && <p className="zs-tree-hint">正在查找…</p>}
    {state.corpusError && <p className="zs-tree-hint">{state.corpusError}</p>}
    {state.corpusHits && !state.corpusBusy && !view.rows.length && <p className="zs-tree-hint">终稿里没有这几个字。</p>}
    {view.rows.length > 0 && <div className="zs-corpus-list">{view.rows.map((row) => <button type="button" className="zs-corpus-hit" key={`${row.courseId}:${row.subId}`} onClick={() => onOpen(row)}><strong>{row.title}</strong>{row.snippet ? <small>{row.snippet}</small> : null}</button>)}{view.truncated && <p className="zs-tree-hint">只列出前 {view.rows.length} 节</p>}</div>}
  </div>;
}

/**
 * 课程目录顶部的「正在直播」折叠区。
 *
 * # 为什么默认折叠、展开才请求
 *
 * `live-today` 不是本地数据：它要拿 JWT 打一遍直播网关，还要为每个时段分别请求
 * （见 `classroom/live.js` 的 `listLiveDay`）。一进学习页就发，等于给「看一眼目录」
 * 这个动作绑上一条**和用户意图无关**的网络往返，而且多数时候结果是空的（课间、
 * 周末、假期）。折叠态只显示场数，用户点开才 `loadLiveToday()` —— 那一刻他要的
 * 就是这份列表，请求才花得值。
 *
 * 标题区分尚未查看、读取中与读取失败，只有成功读取后才显示场数。
 */
function LiveNowFold({ state, controller, onPick }) {
  const [open, setOpen] = useState(false);
  // 惰性：只有展开过才允许请求；`opened` 记住「这份数据是因为用户想看才去取的」，
  // 于是重开折叠区时可以直接复用，不必每点一次打一遍网关。
  //
  // 刷新是另一颗按钮（见展开区里的「重试」）：自动重取会让「收起再展开」变成一个
  // 隐形的刷新动作，而直播列表本来就变得慢 —— 用户收起只是想腾地方，不是想再请求一次。
  const [opened, setOpened] = useState(false);
  const items = state.liveToday?.items ?? [];
  const loading = state.liveTodayLoading;
  // ⚠️ `liveError` 是「直播这条通路」的共用槽位，`loadLiveStreams` 失败也写这里
  //     （见 `model.js` 两处 `update({ liveError })`）。所以在折叠区里报它之前先确认
  //     「手上确实没有今天的列表」—— 否则用户在右边点了一个放不了的机位，左边这块
  //     会一起变成红字，看起来像「今天的直播也挂了」。
  const error = state.liveToday || items.length ? null : state.liveError;
  const reload = () => { setOpened(true); void controller.loadLiveToday(); };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !opened) reload();
  };
  return <section className="zs-live-fold">
    {/* `aria-controls` 只在展开时给：收起态那块面板根本不在树里，
        指向一个不存在的 id 会被辅助技术当成失效引用，比不给更容易误导。 */}
    <button type="button" className="zs-live-fold-toggle" aria-expanded={open} aria-controls={open ? "zs-live-fold-body" : undefined} onClick={toggle}>
      <span className="zs-live-fold-dot" aria-hidden="true" data-on={items.length > 0 ? "on" : "off"} />
      <span className="zs-live-fold-title">正在直播 · {loading ? "读取中" : error ? "读取失败" : state.liveToday ? `${items.length} 场` : "待查看"}</span>
      <span className="zs-live-fold-chevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    {open && <div className="zs-live-fold-body" id="zs-live-fold-body">
      {loading && <p className="zs-tree-hint">正在查看此刻的直播…</p>}
      {/* 先报错、再报空：两条同时为真时（这次没读到 + 上一次结果为空），
          「此刻没有在播的课」会把失败说成事实。 */}
      {!loading && error && <p className="zs-tree-hint zs-live-reason">{liveReason(error)}</p>}
      {/* 重试只在「值得重试」时给：未接入是配置事实，再点一次只会得到同一句话；
          给它一颗按钮等于邀请用户做一件注定失败的事。 */}
      {!loading && error && liveWired(error) && <button type="button" className="zs-text zs-live-retry" onClick={reload}>重新查看 →</button>}
      {!loading && !error && !items.length && <p className="zs-tree-hint">此刻没有在播的课。</p>}
      {!loading && items.length > 0 && <div className="zs-live-fold-list">
        {items.map((item) => <button
          type="button"
          className="zs-live-fold-item"
          key={`${item.courseId}:${item.subId}`}
          onClick={() => void onPick(item)}
        >
          <strong>{item.title}</strong>
          <small>{[item.lecturerName, item.roomName, liveWhen(item)].filter(Boolean).join(" · ")}</small>
        </button>)}
      </div>}
      {/* `meta.complete === false` 是「按时段分片请求里有个别时段失败了」的唯一依据
          （`classroom/live.js` 的 `partial-quantum`）。此时列表可能少了课，
          但已经拿到的那些是真数据 —— 所以照常列出，只在下面补一句说明。 */}
      {!loading && state.liveToday?.meta?.complete === false && <p className="zs-tree-hint">部分时段未取到，列表可能不全。</p>}
    </div>}
  </section>;
}

function CourseTree({ state, controller, onOpenHit, onPickLive, collapsed, onToggle }) {
  const [query, setQuery] = useState("");
  const courses = state.courses.filter((course) => `${course.title} ${course.teacher ?? ""} ${course.termName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  // ⚠️ `aria-expanded` 不能挂在这个 aside 上：它只对可交互角色有效，挂在 aside / generic
  //    上会被辅助技术直接丢弃（还会触发 aria 规则告警）。开合状态由里面那颗按钮自己报，
  //    aside 只留「这片区域是什么」。
  return <aside className={`zs-course-tree${collapsed ? " is-collapsed" : ""}`} aria-label="课程与节次">
    {collapsed
      ? <button className="zs-tree-expand" aria-label="展开课程目录" aria-expanded={false} title="展开课程目录" onClick={onToggle}><span aria-hidden="true">⇥</span><span className="zs-tree-expand-text">目录</span></button>
      : <>
        <div className="zs-tree-top"><div><span className="zs-eyebrow">学习空间</span><h2>课程目录</h2></div><span className="zs-course-total">{state.courses.length}</span>{!state.lesson && <GenerationQueue controller={controller} />}<button className="zs-tree-collapse" aria-label="收起课程目录" aria-expanded={true} title="收起课程目录" onClick={onToggle}>⇤</button></div>
        {/* 直播入口夹在「课程目录」标题与搜索框之间：它答的是「今天有什么可以**现在**看」，
            而下面整片答的是「往期有什么可以**回头**看」。放进课程列表里会让两种时间语义
            混在同一份滚动流里，而它自己的折叠区又需要稳定位置 —— 于是给它一段固定的顶栏。 */}
        {LIVE_UI_ENABLED && <LiveNowFold state={state} controller={controller} onPick={onPickLive} />}
        <label className="zs-tree-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="查找课程" placeholder="查找课程" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <CorpusSearch state={state} controller={controller} onOpen={onOpenHit} />
        <div className="zs-course-list">
      {courses.map((course) => {
        const id = String(course.id), isOpen = Boolean(state.expandedCourses[id]), loading = Boolean(state.loadingCourses[id]);
        // 不可回放的节次在写入控制器时就被丢掉了（`model.js` 的 `loadCourse`），
        // 所以这里直接渲染，渲染路径上不再过滤。
        //
        // 计数只在节次读回来之后才显示：课程表槽位数（概率论 15）和可回放节数
        // （3）差得很远，先显示前者会在展开的瞬间跳成后者。
        const lessons = state.lessonsByCourse[id] ?? [], meta = state.lessonMetaByCourse[id];
        const hidden = state.lessonHiddenByCourse[id] ?? 0;
        const count = meta ? lessons.length : null;
        return <section className={`zs-course-group${isOpen ? " is-open" : ""}`} key={id}>
          <button className="zs-course-toggle" aria-expanded={isOpen} onClick={() => controller.toggleCourse(course)}><span className="zs-chevron" aria-hidden="true">{isOpen ? "⌄" : "›"}</span><span className="zs-course-name"><strong>{course.title}</strong><small>{course.termName ?? course.teacher ?? "课程"}</small></span>{count !== null && <span className="zs-course-count">{count}</span>}</button>
          {isOpen && <div className="zs-tree-lessons">{loading && !lessons.length ? <p className="zs-tree-hint">正在读取节次…</p> : lessons.map((lesson) => {
            const key = `${id}:${lesson.subId}`, status = state.sectionStates[key], selected = state.course?.id === course.id && state.lesson?.id === lesson.id;
            const job = status?.job ?? (state.activeJob?.courseId === course.id && state.activeJob?.subId === lesson.subId ? state.activeJob : null);
            const label = job?.state === "queued" ? "排队中" : job?.state === "running" ? "生成中" : status?.parsed ? status.resultStatus === "ready" ? "已整理" : "待完善" : status ? "待整理" : "课堂资料";
            return <button className={`zs-tree-lesson${selected ? " is-selected" : ""}`} key={lesson.id} aria-current={selected ? "page" : undefined} onClick={() => void controller.selectLesson(lesson, course)}>
              <span className={`zs-state-dot${job?.state === "running" ? " is-running" : status?.parsed ? " is-ready" : ""}`} aria-hidden="true" />
              <span className="zs-tree-lesson-copy"><strong>{lesson.title}</strong><small>{lessonWhen(lesson.startAt)}</small></span><span className="zs-state-label">{label}</span>
            </button>;
          })}{!loading && !lessons.length && <p className="zs-tree-hint">{meta ? meta.complete === false ? "节次未收全，可刷新重试。" : "这门课还没有可回放的节" : "暂无节次"}</p>}{lessons.length > 0 && hidden > 0 && <p className="zs-tree-hint">课程表里另有 {hidden} 个槽位不可回放，已隐藏</p>}{meta?.complete === false && <p className="zs-tree-hint">节次列表尚未收全</p>}</div>}
        </section>;
      })}
      {!courses.length && <div className="zs-tree-empty"><p>{query ? "没有找到匹配课程。" : state.error ? "课程列表暂时无法读取。" : "这里还没有课程。"}</p>{!query && <button className="zs-text" onClick={() => controller.refresh()}>重新读取课程 →</button>}</div>}
    </div>
      <div className="zs-tree-footer">{state.coursesMeta?.complete === false && <span>课程列表尚未收全</span>}</div>
      </>}
  </aside>;
}

// 高级检索的选项住在搜索框右边的浮窗里：检索入口、2×11 维与层范围都与 tab 无关，
// 不打开时整块收起，学习页面上不留任何控件痕迹。
//
// 每张 chip 都带本节条数微标（`lessonCatalog`）：0 条的虚化、点不动 ——
// 点下去只会得到「没有命中」，那是假反馈。标签过滤一旦按维度收窄，
// 页面层/主线/术语表就没有块级标签可用，那几张 chip 转成「本轮不参与」的灰态，
// 并在行下写明原因，免得「选了『图上的字』却一条不出」无从解释。
function Chip({ label, count, on, disabled, idle, title, onClick }) {
  const cls = `zs-chip${on ? " is-on" : ""}${disabled ? " is-off" : ""}${idle ? " is-idle" : ""}`;
  return <button type="button" className={cls} aria-pressed={on} disabled={disabled} title={title} onClick={onClick}>{label}{count == null ? null : <span className="zs-chip-count">{count}</span>}</button>;
}

function AdvancedSearchPanel({ state, mode, setMode, role, setRole, facets, setFacets, layers, setLayers, modeHint, tagMode, filtersActive, catalog, layerOn, toggleLayer, toggleFacet }) {
  const blockLayers = new Set([LayerId.finalDoc, LayerId.teacher]);
  return (
    <div className="zs-filter-panel" role="dialog" aria-label="高级检索选项">
      <div className="zs-filter-row"><span className="zs-filter-label">检索入口</span><div className="zs-chips">{queryModes.map((item) => <button type="button" key={item.id} className={`zs-chip${mode === item.id ? " is-on" : ""}`} aria-pressed={mode === item.id} title={item.hint} onClick={() => setMode(item.id)}>{item.label}</button>)}</div></div>
      <p className="zs-filter-hint">{modeHint}</p>
      {tagMode && <>
        <div className="zs-filter-row"><span className="zs-filter-label">主支线</span><div className="zs-chips"><Chip label="全部" count={catalog.layers[LayerId.finalDoc] ?? 0} on={!role} title="不按主支线收窄" onClick={() => setRole("")} />{lineRoles.map((item) => <Chip key={item} label={item} count={catalog.roles[item] ?? 0} on={role === item} disabled={!(catalog.roles[item] ?? 0)} title={catalog.roles[item] ? `${item}：本节 ${catalog.roles[item]} 个片段` : `本节没有标成「${item}」的片段`} onClick={() => setRole(item)} />)}</div></div>
        <div className="zs-filter-row"><span className="zs-filter-label">内容类型</span><div className="zs-chips">{facetOptions(state.result).map((item) => { const count = catalog.facets[item] ?? 0; return <Chip key={item} label={item} count={count} on={facets.includes(item)} disabled={!count} title={count ? `${item}：本节 ${count} 个片段` : `本节没有标成「${item}」的片段`} onClick={() => toggleFacet(item)} />; })}</div></div>
        {(facets.length > 0 || Boolean(role)) && <button type="button" className="zs-text" onClick={() => { setFacets([]); setRole(""); }}>清空筛选</button>}
      </>}
      <div className="zs-filter-row"><span className="zs-filter-label">层范围</span><div className="zs-chips">{availableLayers.map((spec) => { const count = catalog.layers[spec.id] ?? 0; const idle = filtersActive && !blockLayers.has(spec.id); return <Chip key={spec.id} label={spec.label} count={count} on={layerOn(spec.id)} disabled={!count} idle={idle} title={!count ? "本节这一层没有内容" : idle ? `${spec.label}：标签过滤已按维度收窄，这一层本轮不参与（它没有块级标签）` : `${spec.label}：本节 ${count} 条`} onClick={() => toggleLayer(spec.id)} />; })}</div></div>
      {filtersActive && <p className="zs-filter-hint">已按维度收窄：只有「讲义资源（块级）」与「老师原话（句子层）」能出结果，其余层本轮不参与。</p>}
      <div className="zs-filter-row"><span className="zs-filter-label">未接入</span><div className="zs-chips">{layerRegistry.filter((spec) => !spec.available).map((spec) => <span key={spec.id} className="zs-chip is-off" title={spec.reason}>{spec.label}</span>)}</div></div>
      {layers && <button type="button" className="zs-text" onClick={() => setLayers(null)}>恢复默认层</button>}
    </div>
  );
}

// 课堂内容的 tab 组按 WAI-ARIA APG 的 tabs 模式做 roving tabindex：
// 整组只留当前选中的那一个在 Tab 序列里（tabIndex=0），其余是 -1。
// 顶栏只有两档。课件和字幕是视频栏里的开关，终稿、讲义、笔记和题
// 收进知识点。直播不占这一排：它从左侧「正在直播」进来，落在视频栏的直播画面上。
const contentTabs = ["视频", "知识点", "支线黑板", "AI教学"];

function ContentTabs({ tab, setTab }) {
  const items = React.useRef([]);
  items.current.length = contentTabs.length;
  // 焦点与选中一起移动：APG 的自动激活（automatic activation）里，方向键移动的
  // 就是「当前 tab」本身，内容随之切换。拆成「先移焦点、回车才选中」会让读屏
  // 用户多按一次键才知道内容变了。
  // item 已经是当前 tab 时也要给焦点：已在首/尾时按 Home/End 不该把焦点留在原处。
  const activate = (index) => {
    const item = contentTabs[index];
    if (!item) return;
    if (item !== tab) setTab(item);
    items.current[index]?.focus();
  };
  // 键盘处理委托在容器上：一排同构按钮没必要各挂一个监听，容器也天然能
  // 「看住」整组。焦点不在任何 tab 上时不接管按键，将来容器里多出别的控件不会被吃掉。
  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.current.findIndex((node) => node === document.activeElement);
    if (index < 0) return;
    const last = items.current.length - 1;
    // 右/左是循环的：末尾的下一个回到第一个，这与 APG 示例一致 ——
    // tab 条尽头再按一下停在原地，用户会以为是键盘失灵。
    if (event.key === "ArrowRight") activate(index === last ? 0 : index + 1);
    else if (event.key === "ArrowLeft") activate(index === 0 ? last : index - 1);
    else if (event.key === "Home") activate(0);
    else if (event.key === "End") activate(last);
    else return;
    // 这次按键已经用来换 tab 了，就不该再触发页面的横向/纵向滚动。
    event.preventDefault();
  };
  return <div className="zs-content-switch" role="tablist" aria-label="课堂内容" onKeyDown={onKeyDown}>
    {/* id / role / aria-controls 与样式都是外部契约（另一个工位在改这批 tab 的
        CSS，tabpanel 靠 aria-labelledby={`zs-tab-${tab}`} 回指），
        所以这里只补 tabIndex 与 type，不动命名与结构。 */}
    {contentTabs.map((item, index) => <button key={item} type="button" ref={(node) => { items.current[index] = node; }} id={`zs-tab-${item}`} role="tab" tabIndex={tab === item ? 0 : -1} aria-controls="zs-content-panel" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}
  </div>;
}

/**
 * 机位排序：教师 → 屏幕 → 学生 → 其他。
 *
 * 顺序**不照后端返回的顺序**：`classroom/live.js` 的 `pack()` 是「谁先被遍历到谁在前」，
 * 那取决于上游 `sub_content` 里字段的排列，属于实现的偶然。教师机位是「听讲解」的
 * 主视角，屏幕是「看板书」的主视角，学生/其他是补充 —— 这是产品判断，得由界面定，
 * 不能让它跟着回复字段顺序漂移。`Array.prototype.sort` 在 ES2019 之后是稳定的，
 * 所以同一 rank 的机位仍保持后端给的相对次序。
 */
const liveSeatRank = (key) => ({ teacher: 0, screen: 1, student: 2 }[key] ?? 3);
const liveSeatName = (key) => ({ teacher: "教师", screen: "屏幕", student: "学生" }[key] ?? "其他");

/**
 * 「直播」这一栏：机位切换 + 直出。
 *
 * # 为什么这里只放 `<video>`，不 import hls.js
 *
 * 直播流是 HLS（m3u8 + ts），Chrome 原生放不了，得挂 hls.js —— **但那段接入归
 * `video-panel.jsx`**（它正在被另一个协作者改）。本组件只负责「挑哪一路机位、把它的
 * `playUrl` 交给 `<video>`」，HLS 的 `MediaSource` 接线见 video-panel.jsx。
 * 两个组件各写一份 `new Hls()` 会得到两个 MSE 实例抢同一路转发连接，那是比
 * 缺功能更难查的故障。**所以这里不要加 hls.js 的 import 或实例化。**
 *
 * # `playable: false` 的机位为什么 disabled 而不是隐藏
 *
 * 隐藏会让人以为「这节直播只有一个机位」。上游的 webrtc / rtmp 流是真实存在的，
 * 只是浏览器吃不下（转发端点只放行 https，见 `workbench.js` 的 `relayStream`），
 * 所以照样给按钮、在 `title` 里说清为什么点不动 —— 用户看到「屏幕机位灰着」会知道
 * 是限制，看到「没有屏幕机位」只会以为课程没开。
 *
 * # 为什么多一个 `pick`
 *
 * `liveStreams` 只带 `courseId` / `subId`，不带标题与时段；而取流失败时控制器会把
 * `liveStreams` 清成 null，这时连 ID 都没了。`pick` 是用户点开那条直播的原始条目，
 * 由调用方记住 —— 它让「失败了」也还能显示「哪节课失败了」，并且能就地重试。
 */
function LivePane({ state, controller, pick }) {
  const [want, setWant] = useState(null);
  const bundle = state.liveStreams;
  const streams = useMemo(() => [...(bundle?.streams ?? [])].sort((a, b) => liveSeatRank(a?.key) - liveSeatRank(b?.key)), [bundle]);
  const dropped = bundle?.dropped ?? [];
  // 换了另一节课就忘掉上一节选中的机位：`key` 在课与课之间复用（teacher/screen…），
  // 留着它会让「在 A 节看屏幕，再点 B 节」直接落在 B 的屏幕机位上 —— 而用户对 B 的
  // 第一期望是默认视角（教师），不是继承上一门课的偏好。
  const identity = `${bundle?.courseId ?? ""}:${bundle?.subId ?? ""}`;
  useEffect(() => { setWant(null); }, [identity]);
  // 默认落在第一个**能播**的机位上：`streams[0]` 可能是一路只有 flv 的屏幕流，
  // 拿它当默认就是打开一个播不了的播放器。
  const fallback = streams.find((item) => item?.playable && item.playUrl) ?? null;
  const current = streams.find((item) => item?.key === want && item?.playable && item.playUrl) ?? fallback;
  const retry = () => { if (!pick) return; void controller.loadLiveStreams(pick.courseId, pick.subId).catch(() => { /* 原因已由控制器写进 liveError */ }); };
  // 标题里的课名/时段不能读 `state.course`：用户可能是在另一节课的正文里点开直播的
  // （`loadLiveStreams` 不动选中节次）。所以先看 `pick`，再回 `liveToday` 按 ID 捞同一条。
  const courseId = bundle?.courseId ?? pick?.courseId, subId = bundle?.subId ?? pick?.subId;
  const info = pick ?? (courseId == null ? null : (state.liveToday?.items ?? []).find((item) => String(item?.courseId) === String(courseId) && String(item?.subId) === String(subId)) ?? null);
  // ⚠️ `loadLiveStreams` 成功才写 `liveStreams`，失败与在途都不清旧的（见 `model.js`）。
  //    所以「手上这份清单还是不是用户刚点的那一节」必须**自己比 ID** —— 否则点了 B，
  //    标题已经是 B，画面里还在放 A 的机位，而这两件事都是真的，谁也没报错。
  const stale = Boolean(bundle && pick && (String(bundle.courseId) !== String(pick.courseId) || String(bundle.subId) !== String(pick.subId)));
  const head = <header className="zs-live-head">
    <div className="zs-live-head-copy">
      <strong className="zs-live-title">{info?.title ?? "课堂直播"}</strong>
      <small className="zs-live-meta">{[info?.lecturerName, info?.roomName, liveWhen(info)].filter(Boolean).join(" · ") || "直播机位"}</small>
    </div>
    {state.liveBusy && <span className="zs-live-busy">正在取流…</span>}
  </header>;
  // 还没点过任何一节：这里就是「直播」栏的常态空态。它**不**自动去取流 ——
  // 取哪一节是用户的选择，界面替他猜一节，等于把「我点错了」变成「它自己跳的」。
  //
  // 但 `pick` 还在、`liveStreams` 却是空的，说明控制器在别处把它清掉了
  // （`selectLesson` / `selectCourse` 都会清，因为换节之后旧的机位不属于新的选择）。
  // 这时用户并没有改变主意，只是中间点了一下回放 —— 所以给他一颗「重新取流」，
  // 而不是让他再去左侧找一遍那节课。
  if (!bundle) return <div className="zs-live-empty">
    <span aria-hidden="true">◎</span>
    <strong>{state.liveBusy ? "正在取流…" : "从左侧「正在直播」选一节课"}</strong>
    {!state.liveBusy && <small>{pick ? `上次看的是「${pick.title ?? "这一节"}」，可以接着看。` : "选中之后，这里会列出这节直播的机位并直接开始播放。"}</small>}
    {!state.liveBusy && state.liveError && <p className="zs-live-reason">{liveReason(state.liveError)}</p>}
    {!state.liveBusy && pick && (!state.liveError || liveWired(state.liveError)) && <button type="button" className="zs-text" onClick={retry}>重新取流 →</button>}
  </div>;
  return <section className="zs-live" aria-label="课堂直播">
    {head}
    {/* 清单还是上一节的：不渲染机位与播放器，只说明「正在换」。播放旧画面比空着更糟 ——
        那是**别人那一节**的课堂内容。 */}
    {stale ? <div className="zs-live-noplay"><strong>{state.liveBusy ? "正在取这一节的机位…" : "这一节的机位还没取到"}</strong><small>{state.liveBusy ? "取到之后会自动换成这一节的画面。" : "可以重新取流，或者从左侧换一节课。"}</small>{!state.liveBusy && <button type="button" className="zs-text" onClick={retry}>重新取流 →</button>}</div> : <>
      {streams.length > 0 && <div className="zs-live-seats" role="group" aria-label="机位">
        {streams.map((stream) => {
          const playable = Boolean(stream?.playable && stream.playUrl);
          const on = current?.key === stream?.key;
          return <button
            key={stream.key}
            type="button"
            className={`zs-live-seat${on ? " is-on" : ""}`}
            aria-pressed={on}
            disabled={!playable}
            title={playable ? `切到${stream.label ?? liveSeatName(stream.key)}机位` : `该机位只提供 ${stream.type ?? "未知"} 流，浏览器放不了`}
            onClick={() => setWant(stream.key)}
          >{stream.label ?? liveSeatName(stream.key)}</button>;
        })}
      </div>}
      {/* `key` 跟着流地址走：换机位是换源，让 React 重建这个 `<video>` 比改 `src` 干净 ——
          改 src 会留着上一路流的缓冲与 `currentTime`，而直播里那两项都没有意义，
          只会让切换后先看到一段旧画面。

          播放器用 `HlsVideo` 而不是裸 `<video>`：直播是 m3u8，Chrome/Edge 的
          `<video>` 不认识它，直接给 `src` 是**黑屏且不报错**。接线的取舍见
          `hls-video.jsx` 与 `hls.js` 的文件头。 */}
      {current
        ? <HlsVideo key={current.playUrl} src={current.playUrl} live className="zs-live-video" />
        : <div className="zs-live-noplay">
          {/* 「一路都没有」与「有路但都放不了」是两件事，不能共用一句话：
              前者（还没开播、已经结束）不是缺陷，后者是**能力限制**。
              把前者也说成「只提供 webrtc/rtmp」是在编造一个后端没给的事实。 */}
          <strong>{streams.length ? "这节直播没有浏览器能播的机位" : "这一节现在没有可用的机位"}</strong>
          <small>{streams.length ? "所有机位都只提供 webrtc / rtmp 流，需要客户端播放器。" : "直播可能还没开始或已经结束；过一会儿可以从左侧再看一次。"}</small>
        </div>}
      {/* dropped 只留一行说明、不做按钮：那些机位本来就没有地址，给按钮只会换来一次注定失败的点击。 */}
      {dropped.length > 0 && <p className="zs-live-dropped">另有 {dropped.length} 路机位未采用：{dropped.map((item) => `${item?.label ?? liveSeatName(item?.key)}（${item?.type ?? "未知"}）`).join("、")}。这些是 webrtc / rtmp 之类，浏览器放不了。</p>}
    </>}
  </section>;
}

// 命中列表住在节次头部下方的抽屉里（正常文档流）：它只在「正在检索」时出现，
// 位置稳定，不会被浮窗挡住，也不占用终稿 tab 的工具栏。
function SearchResults({ outcome, jumpToHit }) {
  return (
    <div className="zs-results" role="region" aria-label="检索结果">
      <p className="zs-results-head">{outcome.hits.length ? `命中 ${outcome.hits.length} 条` : "没有命中"}{outcome.omitted ? ` · 另有 ${outcome.omitted} 条未显示` : ""}</p>
      <p className="zs-results-note">{searchNote(outcome)}</p>
      <div className="zs-hit-list">{outcome.hits.map((hit, index) => <button type="button" className="zs-hit" key={`${hit.id}-${index}`} onClick={() => jumpToHit(hit)}>
        <span className="zs-hit-top"><span className="zs-chip is-on zs-hit-layer">{layerLabel(hit.layer)}</span><span className="zs-hit-where">{hit.chapterNo != null ? `第 ${hit.chapterNo} 章 · 知识点 ${hit.topicNo}` : hit.page != null ? `第 ${hit.page} 页` : hit.atSec != null ? time(hit.atSec * 1000) : ""}{hit.chapterNo == null && hit.page != null && hit.atSec != null ? ` · ${time(hit.atSec * 1000)}` : ""}</span></span>
        <span className="zs-hit-text">{hit.preview}</span>
      </button>)}</div>
    </div>
  );
}

export function StudyWorkspace({ controller, Notice, ModelSettings, safeLink }) {
  const state = useStudy(controller), [tab, setTab] = useState("知识点"), [query, setQuery] = useState(""), [mode, setMode] = useState(defaultQueryMode.id), [role, setRole] = useState(""), [facets, setFacets] = useState([]), [layers, setLayers] = useState(null), [optionsOpen, setOptionsOpen] = useState(false), [lectureFocus, setLectureFocus] = useState(null), [entry, setEntry] = useState(null), [screen, setScreen] = useState("replay"), [videoSeek, setVideoSeek] = useState(null), [mobileTree, setMobileTree] = useState(false), [treeCollapsed, setTreeCollapsed] = useState(false), [livePick, setLivePick] = useState(null);
  // 「用户点开的那条直播」住在页面而不是控制器里：`liveStreams` 只带 ID，
  // 且取流失败时会被控制器清成 null —— 标题与时段那时就只剩这份副本还记得。
  // 它也不该进 `state`：选直播**不改变选中节次**（回放与直播是两条通路），
  // 所以 `course`/`lesson` 不该跟着动，而 `livePick` 正是「我在看直播」这件事的住址。
  const liveOn = LIVE_UI_ENABLED && screen === "live";
  /**
   * 点左侧「正在直播」里的某一场。
   *
   * 先切栏、再取流：取流是一次网络往返，等它回来再切会让点击好几百毫秒没有反应。
   * 失败**不吞也不弹横幅** —— 控制器已经把原因写进 `state.liveError`，而直播是附加
   * 信息，让一条拉不到的通路把整页顶成「出错」是错的口径（`model.js` 里也是这么定的）。
   */
  const openLive = (item) => {
    if (!LIVE_UI_ENABLED) return;
    setLivePick(item);
    setScreen("live");
    setTab("视频");
    void controller.loadLiveStreams(item.courseId, item.subId).catch(() => { /* 原因见 state.liveError */ });
  };
  const advancedRef = React.useRef(null);
  useEffect(() => {
    setQuery(""); setRole(""); setFacets([]); setOptionsOpen(false); setLectureFocus(null); setScreen("replay"); setVideoSeek(null);
    const focus = state.focusTab;
    const openQuiz = focus?.tab === "出题" && String(focus.courseId) === String(state.course?.id) && String(focus.subId) === String(state.lesson?.subId);
    const openSource=focus?.tab==='题目来源'&&String(focus.courseId)===String(state.course?.id)&&String(focus.subId)===String(state.lesson?.subId);
    // 有回放的节次默认停在「视频」。没有回放就停在知识点。
    // 从今天页点一道已采纳的题进来，直接打开这一节的出题，不再单开一栏。
    setEntry(openSource?{kind:'read',chapterNo:focus.chapterNo,topicNo:focus.topicNo}:openQuiz ? { kind: "quiz" } : null);
    if(openSource)setLectureFocus({chapterNo:focus.chapterNo,topicNo:focus.topicNo,nonce:Date.now()});
    setTab(openSource || openQuiz || !state.lesson?.videoUrl ? "知识点" : "视频");
  }, [state.lesson?.id, state.course?.id, state.focusTab]);
  // 浮窗是「选项」的住处，点外面或按 Esc 就收；它只覆盖在自己那一角，不接管正文的点击。
  useEffect(() => {
    if (!optionsOpen) return undefined;
    const onPointerDown = (event) => { if (!advancedRef.current?.contains(event.target)) setOptionsOpen(false); };
    const onKeyDown = (event) => { if (event.key === "Escape") setOptionsOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [optionsOpen]);
  const slides = state.content?.slides.items ?? [], subtitles = state.content?.subtitles.items ?? [], active = state.activeJob, running = active?.state === "running", ownRunning = ["running", "queued"].includes(state.job?.state);
  // 检索是纯函数的输入输出：档位 + 2×11 维 + 层范围进，命中集出。控制器不参与。
  const wanted = layers ?? defaultSearchLayers;
  const outcome = searchLesson(state.result, { query, mode, role, facets, layers: wanted });
  const hitBlocks = hitBlockIndexes(outcome);
  const catalog = lessonCatalog(state.result);
  const tagMode = mode === QueryMode.tagFilter.id;
  // 「这次到底在检索」＝有关键词，或者标签过滤档位下给了维度（App `_SearchBlockState._searching`）。
  const keywordSearch = Boolean(query.trim());
  const searching = keywordSearch || (tagMode && (facets.length > 0 || Boolean(role)));
  // 两种检索的正文语义不同，不能混为一谈：
  //   · 有关键词 —— 这是**查找**，正文让位给结果：命中正文渲染在抽屉里，
  //     正文区不再用「减法」（原本那样会剩下几个未命中块，甚至空态与命中列表自相矛盾）。
  //   · 只有维度（标签过滤档）—— 这是**筛选**，正文就是筛选后的块本身，保持原样。
  const blocks = keywordSearch ? [] : searching ? (state.result?.blocks ?? []).filter((block) => hitBlocks.has(block.index)) : state.result?.blocks ?? [];
  const modeHint = `${queryModeOf(mode).hint}${tagMode ? "；可以不给关键词，只给筛选" : "（筛选只在「标签过滤」档位生效）"}`;
  const layerOn = (id) => (layers ? layers.includes(id) : defaultSearchLayers.has(id));
  const toggleLayer = (id) => { const base = layers ?? [...defaultSearchLayers]; setLayers(base.includes(id) ? base.filter((item) => item !== id) : [...base, id]); };
  const toggleFacet = (label) => setFacets((value) => (value.includes(label) ? value.filter((item) => item !== label) : [...value, label]));
  const jumpToHit = (hit) => {
    // 命中可能在另一档。关键词检索时终稿正文是空的：先退出检索，再打开那一块。
    if (hit.blockIndex != null) {
      if (keywordSearch) { setQuery(""); setOptionsOpen(false); }
      const branch = state.result?.blocks?.find(block => block.index === hit.blockIndex)?.tag?.role === "支线";
      setTab(branch ? "支线黑板" : "知识点");
      setEntry({ ...entryForBlock(state.result, hit.blockIndex), nonce: Date.now() });
    } else if (hit.layer === LayerId.lecture) {
      setLectureFocus({ chapterNo: hit.chapterNo, topicNo: hit.topicNo, nonce: Date.now() });
      setTab("知识点");
      setEntry({ kind: "read", chapterNo: hit.chapterNo, topicNo: hit.topicNo });
    } else if (hit.page != null) {
      const index = slides.findIndex((item) => item.page === hit.page);
      if (index >= 0) {
        setScreen("replay");
        setTab("视频");
        setVideoSeek({ ms: slides[index]?.startMs ?? 0, nonce: Date.now(), pin: true });
      }
    }
  };
  const locateMedia = (target) => {
    setScreen("replay");
    setTab("视频");
    if (target?.kind === "page") {
      const slide = slides[target.index];
      setVideoSeek({ ms: slide?.startMs ?? 0, nonce: Date.now(), pin: true });
    } else if (target?.kind === "time") {
      const line = subtitles[target.subtitleIndex];
      setVideoSeek({ ms: line?.startMs ?? 0, nonce: Date.now() });
    }
  };
  const openVideoAt = (ms) => {
    setScreen("replay");
    setTab("视频");
    setVideoSeek({ ms: ms ?? 0, nonce: Date.now() });
  };
  // 没有选中节次、但用户从左侧点了直播：正文区整块让给直播。
  //
  // 为什么不是「请先选一节课」：一门**只有直播、没有可回放节**的课在回放列表里是空的
  // （`model.js` 的 `loadCourse` 会丢掉不可回放的节次），要求用户先去点一节不存在的
  // 回放才能看直播，等于把这条路封死。所以直播自己撑得起正文区。
  //
  // 这一块**不带 tab 条**：视频和知识点读的都是「这一节的资料」，没有节次时它们全是空的。
  // 给一排按下去只剩空态的按钮，比不给更糟 —— 用户会以为是自己点错了。
  const liveOnly = <section className="zs-content-section">
    <div className="zs-content-heading"><div><span className="zs-eyebrow">此刻直播</span><h2>课堂直播</h2></div></div>
    <LivePane state={state} controller={controller} pick={livePick} />
  </section>;
  if (state.loading) return <div className="zs-workspace-loading"><span className="zs-spinner" />正在连接课堂与学习资料…</div>;
  if (!state.user) return <div className="zs-workspace-signin"><div className="zs-signin-mark">知</div><h1>连接智云课堂</h1><p>登录后，课程、课件与课堂字幕会汇集到这间学习工作台。</p><button className="zs-primary" onClick={() => controller.openAccount()}>登录智云课堂</button><Notice>{state.error}</Notice></div>;
  return <section className="zs-study" aria-label="学习工作台">
    <div className="zs-workbench-shell">
      <button className="zs-mobile-tree-toggle" aria-expanded={mobileTree} onClick={() => setMobileTree((value) => !value)}><span>课程目录</span><span>{state.course?.title ?? "选择一门课程"}</span><span aria-hidden="true">{mobileTree ? "⌃" : "⌄"}</span></button>
      <div className={`zs-workbench${mobileTree ? " is-tree-open" : ""}${treeCollapsed ? " is-tree-collapsed" : ""}`}>
        <CourseTree state={state} controller={controller} collapsed={treeCollapsed} onToggle={() => setTreeCollapsed((value) => !value)} onPickLive={openLive} onOpenHit={async (row) => { const opened = await controller.openCorpusHit(row); if (opened) setQuery(state.corpusQuery || ""); }} />
        <main className="zs-reader">
          <Notice>{state.error}</Notice>
          {/* 直播分支排在「没有节次」之前：点了直播但还没选节次时，用户要的是直播，
              不是那张「从一节课开始」的引导页 —— 后者会让人以为点击没生效。
              只看 `tab`、不看 `livePick`：`livePick` 是页面重挂载（切走再回来、
              刷新）时会丢的组件内状态，而「我在直播栏」这件事不该跟着它一起丢。 */}
          {!state.lesson && liveOn ? liveOnly : !state.lesson ? <div className="zs-reader-empty"><span className="zs-motto-text">海纳江河，启真厚德</span><h1>从一节课开始，搭建自己的知识脉络。</h1><p>展开左侧课程，选择一节课堂。课件、字幕和解析内容会在这里自然汇合。</p><div className="zs-empty-hint"><span>01</span><div><strong>选择课程与节次</strong><small>课程资料会按课堂归档</small></div><span>02</span><div><strong>阅读与整理</strong><small>在同一处查看课件、字幕与讲义</small></div></div></div> : <>
            <header className="zs-current-section">
              <div className="zs-breadcrumb-row">
                <div className="zs-breadcrumb"><span>{state.course?.title}</span><span aria-hidden="true">/</span><span>{state.lesson.title}</span></div>
                {state.result && <div className="zs-search-entry" ref={advancedRef}>
                  <label className="zs-search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="查找解析正文" placeholder={tagMode ? "按标签筛（可留空）：如「所有例题」" : "检索本节：正文、讲义、课件…"} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setOptionsOpen(false); event.currentTarget.blur(); } }} />{query && <button type="button" className="zs-search-clear" aria-label="清空检索" onClick={() => setQuery("")}>×</button>}</label>
                  <button type="button" className="zs-search-trigger" aria-expanded={optionsOpen} aria-controls="zs-advanced-popover" onClick={() => setOptionsOpen((value) => !value)}>高级检索</button>
                  {optionsOpen && <div className="zs-advanced-popover" id="zs-advanced-popover">
                    <AdvancedSearchPanel state={state} mode={mode} setMode={setMode} role={role} setRole={setRole} facets={facets} setFacets={setFacets} layers={layers} setLayers={setLayers} modeHint={modeHint} tagMode={tagMode} filtersActive={outcome.filtersActive} catalog={catalog} layerOn={layerOn} toggleLayer={toggleLayer} toggleFacet={toggleFacet} />
                  </div>}
                </div>}
              </div>
              {/* 只有**一行**表头。
                  课程名与节次名已经在左侧目录里高亮着，这里再写一遍大标题就是同一件事说两次，
                  而它占掉的两行高度是从主视图（视频/课件）身上割的肉。留下的这一行是
                  目录里没有的信息：整理状态、时间、教师，以及右侧的动作。
                  时间取不到时整格不出（`lessonWhen` 兜底的「课堂学习」在这里没有信息量）。 */}
              <div className="zs-current-main"><div className="zs-current-meta"><span className={`zs-current-state${state.result?.status === "ready" ? " is-ready" : ""}`}><i />{ownRunning ? state.job.state === "queued" ? "等待生成" : "正在生成" : state.result ? state.result.status === "ready" ? "学习资料已整理" : "解析部分完成" : "等待整理"}</span>{state.lesson.startAt && <span className="zs-current-when">{lessonWhen(state.lesson.startAt)}{state.lesson.lecturerName ? ` · ${state.lesson.lecturerName}` : ""}</span>}</div><div className="zs-current-actions"><GenerationQueue controller={controller} />
                {/* `state.live` 是控制器按 courseId/subId 从 `liveToday` **派生**出来的
                    （见 `model.js` 的 `liveOf`），所以它非空就等于「这一节此刻真在播」。
                    用它做一份就地入口：用户已经在这节回放上，不必再回头去左侧目录里
                    找同一节课。排在「课堂回放」左边 —— 直播是**过时就没了**的那一个。 */}
                {LIVE_UI_ENABLED && state.live && <button className="zs-button" onClick={() => openLive(state.live)}><span aria-hidden="true">◉</span> 正在直播</button>}
                {state.lesson.videoUrl && <button className="zs-button" onClick={() => { setScreen("replay"); setTab("视频"); }}><span aria-hidden="true">▷</span> 课堂回放</button>}<ModelSettings controller={controller} requiresVision={Boolean(state.content?.slides?.items?.length)} disabled={running || state.busy} generationDisabled={state.busy || ownRunning || state.contentLoading || !state.content || state.content.slides.meta.complete !== true || state.content.subtitles.meta.complete !== true} onGenerate={() => controller.start()} label={ownRunning ? state.job.state === "queued" ? "已加入队列" : "正在生成讲义" : state.result ? "重新生成讲义" : "生成讲义"} /></div></div>
            </header>
            {state.result && searching && <div className="zs-search-drawer" id="zs-search-drawer">
              <SearchResults outcome={outcome} jumpToHit={jumpToHit} />
            </div>}
            <section className="zs-content-section">
              {/* 「直播」栏的标题不带「当前课堂」：它可能和下面这一节的资料无关
                  （用户可以在 A 节的正文里看 B 节的直播，`loadLiveStreams` 不动选中节次）。 */}
              <div className="zs-content-heading"><div><span className="zs-eyebrow">{tab === "视频" && liveOn ? "此刻直播" : "当前课堂"}</span><h2>{tab === "视频" ? (liveOn ? "课堂直播" : "课堂视频") : tab}</h2></div><div className="zs-content-tools">{LIVE_UI_ENABLED && tab === "视频" && (state.live || livePick) && <div className="zs-content-switch" role="group" aria-label="画面"><button type="button" aria-pressed={!liveOn} onClick={() => setScreen("replay")}>回放</button><button type="button" aria-pressed={liveOn} onClick={() => openLive(state.live ?? livePick)}>直播</button></div>}<ContentTabs tab={tab} setTab={setTab} /><button className="zs-icon-button" title="刷新课堂" aria-label="刷新课堂" disabled={state.loading || state.busy} onClick={() => controller.refresh()}>↻</button></div></div>
              {/* 直播栏**不排**在 `contentLoading` 后面：它读的是直播网关，不是这一节的
                  课件与字幕。等一份跟它无关的请求，只会让点了直播的人对着「正在读取课件
                  与字幕…」发呆 —— 而那两样东西本来就不是他要的。 */}
              {tab === "视频" && liveOn ? <div id="zs-content-panel" role="tabpanel" aria-labelledby={`zs-tab-${tab}`}><LivePane state={state} controller={controller} pick={livePick} /></div>
                : state.contentLoading ? <div className="zs-content-loading"><span className="zs-spinner" />正在读取课件与字幕…</div> : <div id="zs-content-panel" role="tabpanel" aria-labelledby={`zs-tab-${tab}`}>
                {tab === "视频"
                  ? <VideoPanel state={state} seek={videoSeek} />
                  : tab === "支线黑板"
                    ? <BranchBoard key={state.lesson?.id} result={state.result} onOpenVideo={openVideoAt} focus={entry} />
                    : tab === "AI教学"
                    ? <AiTeaching state={state} controller={controller} />
                    : <KnowledgeBoard key={state.lesson?.id} state={state} controller={controller} Notice={Notice} slides={slides} subtitles={subtitles} entry={entry} onEntry={setEntry} onOpenVideo={openVideoAt} onLocate={locateMedia} focus={lectureFocus} visibleBlocks={blocks} searching={searching} keywordSearch={keywordSearch} hitCount={outcome.hits.length} />}
              </div>}
            </section>
          </>}
        </main>
      </div>
    </div>
  </section>;
}
