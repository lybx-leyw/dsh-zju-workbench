import { knowledgeChapters } from 'dsh-zhiyun-core-quiz';
import React, { useEffect, useState } from "react";
import { LectureReader } from "./lecture-reader.jsx";
import { QuizPanel } from "./quiz-panel.jsx";
import { NotePanel } from "./note-panel.jsx";
import { time } from "./format.js";

const panes = [
  ["lecture", "阅读正文"],
  ["outline", "提纲"],
  ["resource", "终稿"],
  ["note", "笔记"],
  ["quiz", "题"],
];

/** 检索或终稿里的块号，落到它所属的知识点；没有章节时退回整节终稿。 */
export function entryForBlock(result, index) {
  const chapters = knowledgeChapters(result);
  for (let ci = 0; ci < chapters.length; ci += 1) {
    const topics = chapters[ci]?.topics ?? [];
    for (let ti = 0; ti < topics.length; ti += 1) {
      const topic = topics[ti];
      if (topic.blockIndexes?.includes(index)) {
        return { kind: "point", chapter: ci, topic: ti, pane: "resource", block: index };
      }
    }
  }
  return { kind: "raw", block: index };
}

function clip(text, max = 72) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "这一段没有可用文字";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function blocksIn(blocks, topic) {
  return (blocks ?? []).filter((block) => topic.blockIndexes ? topic.blockIndexes.includes(block.index) : topic.from <= block.index && block.index <= topic.to);
}

function lectureOf(lecture, title) {
  for (const chapter of lecture?.chapters ?? []) {
    const topic = (chapter.topics ?? []).find((item) => item.title === title);
    if (topic) return topic;
  }
  return null;
}

/**
 * 阅读讲义的章、知识点序号跟检索命中同一套：有 `no` 用 `no`，否则用 1 起的位置。
 * 从卡片进来时没有序号，改按标题对。对不上就不要整节倒出来冒充这一则。
 */
function lectureScope(lecture, entry, topicTitle) {
  const chapters = lecture?.chapters ?? [];
  if (entry.kind === "read" && entry.chapterNo == null && !entry.chapterTitle) return null;
  if (entry.kind === "read" && entry.chapterNo != null) {
    const ci = chapters.findIndex((chapter, index) => (chapter.no ?? index + 1) === entry.chapterNo);
    if (ci < 0) return { missing: true };
    if (entry.topicNo == null) return { chapterIndex: ci };
    const ti = (chapters[ci].topics ?? []).findIndex((topic, index) => (topic.no ?? index + 1) === entry.topicNo);
    return ti < 0 ? { missing: true } : { chapterIndex: ci, topicIndex: ti };
  }
  const title = entry.kind === "read" ? entry.chapterTitle : topicTitle;
  if (!title) return { missing: true };
  if (entry.kind === "read") {
    const ci = chapters.findIndex((chapter) => chapter.title === title);
    return ci < 0 ? { missing: true } : { chapterIndex: ci };
  }
  for (let ci = 0; ci < chapters.length; ci += 1) {
    const ti = (chapters[ci].topics ?? []).findIndex((topic) => topic.title === title);
    if (ti >= 0) return { chapterIndex: ci, topicIndex: ti };
  }
  return { missing: true };
}

function marksOf(topic, blocks, lecture, note) {
  const range = blocksIn(blocks, topic);
  const pending = range.some((block) => block.register === "draft")
    || ["draft", "failed"].includes(lectureOf(lecture, topic.title)?.register);
  const noted = Boolean(topic.title && note?.includes(topic.title));
  const first = range.find((block) => block.startMs != null) ?? range[0];
  return { pending, noted, count: range.length, when: first ? time(first.startMs ?? 0) : "" };
}

function HitNote({ searching, keywordSearch, visibleBlocks, hitCount }) {
  if (!searching || visibleBlocks.length) return null;
  return keywordSearch && hitCount
    ? <p className="zs-muted">正文已让位给检索结果：{hitCount} 条命中都在上方「检索结果」面板里，点任意一条即可回到对应位置。</p>
    : <p className="zs-muted">没有匹配的内容。</p>;
}

function ResourceBlocks({ blocks, onOpenVideo }) {
  return <div className="zs-blocks">{blocks.map((block) => <article className="zs-block" id={`zs-block-${block.index}`} key={block.index}>
    <header>
      <span>{time(block.startMs ?? 0)} · {block.page ? `第 ${block.page} 页` : "字幕"} · {block.tag?.role ?? "未标注"}</span>
      <div>
        {(block.tag?.facets ?? []).map((item) => <span className="zs-facet" key={item}>{item}</span>)}
        <button type="button" className="zs-text" onClick={() => onOpenVideo(block.startMs ?? 0)}>回到视频</button>
      </div>
    </header>
    {block.tag?.summary && <h3>{block.tag.summary}</h3>}
    {block.bridge && <p className="zs-bridge">{block.bridge}</p>}
    {(block.sentences ?? []).map((line, index) => <p key={index}>{line.text}</p>)}
  </article>)}</div>;
}

function Diagnostics({ result }) {
  return <details className="zs-diagnostics"><summary>查看整理记录</summary>
    <p>{result.sentences.length + (result.unassignedSentences?.length ?? 0)} 句字幕 · {result.blocks.length} 个知识片段 · {result.failedPages?.length ?? 0} 页需重试{result.unassignedSentences?.length ? ` · ${result.unassignedSentences.length} 句没落到任何一页（已单列保留）` : ""}</p>
    {(result.warnings ?? []).map((warning, index) => <p key={index}>{warning}</p>)}
  </details>;
}

/**
 * 知识点是学习栏的第二档。
 *
 * 有阅读讲义时，这一栏默认就是那份讲义：目录、章节、知识点、小标题。
 * 卡片和图谱只用来跳进某一则。点进去先看阅读正文；终稿是来源，不是正文。
 */
export function KnowledgeBoard({
  state, controller, Notice, slides, subtitles, entry, onEntry, onOpenVideo, onLocate, focus,
  visibleBlocks, searching, keywordSearch, hitCount,
}) {
  const result = state.result;
  const chapters = knowledgeChapters(result);
  const blocks = result?.blocks ?? [];
  const note = state.note?.markdown ?? "";
  const lectureReady = (state.lecture?.chapters ?? []).some((chapter) => (chapter.topics ?? []).length > 0);
  const [surface, setSurface] = useState(lectureReady ? "handout" : "cards");
  const [surfaceTouched, setSurfaceTouched] = useState(false);
  useEffect(() => {
    if (!surfaceTouched && lectureReady) setSurface("handout");
  }, [lectureReady, surfaceTouched]);
  const chooseSurface = (next) => { setSurfaceTouched(true); setSurface(next); onEntry(null); };
  useEffect(() => {
    if (entry?.block == null) return undefined;
    if (entry.kind !== "raw" && entry.pane !== "resource") return undefined;
    const timer = setTimeout(() => {
      document.getElementById(`zs-block-${entry.block}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => clearTimeout(timer);
  }, [entry?.kind, entry?.pane, entry?.block]);

  if (!result) {
    return <div className="zs-unparsed">
      <div className="zs-unparsed-icon">✦</div>
      <h3>让课堂内容变成自己的理解</h3>
      <p>{slides.length} 页课件 · {subtitles.length} 条字幕。整理后，这里会按章节列出知识点。</p>
      {state.content && (state.content.slides.meta.complete !== true || state.content.subtitles.meta.complete !== true)
        ? <Notice>课堂资料尚未收全，请刷新课堂后再试。</Notice>
        : <small>点击上方「生成讲义」开始。</small>}
    </div>;
  }

  const openPoint = (ci, ti) => {
    const title = chapters[ci]?.topics?.[ti]?.title;
    onEntry({ kind: "point", chapter: ci, topic: ti, pane: lectureOf(state.lecture, title) ? "lecture" : "outline" });
  };
  const back = <button type="button" className="zs-text" onClick={() => onEntry(null)}>← 全部知识点</button>;

  if (entry?.kind === "quiz") {
    return <div className="zs-k-point">
      <div className="zs-k-point-head">{back}<h3>本节出题</h3></div>
      <QuizPanel key={state.lesson?.id} state={state} controller={controller} />
    </div>;
  }

  if (entry?.kind === "read") {
    const scope = lectureScope(state.lecture, entry);
    return <div className="zs-k-point">
      <div className="zs-k-point-head">{back}<h3>{entry.chapterTitle || (entry.chapterNo != null ? "这一段阅读讲义" : "阅读整节")}</h3></div>
      {scope?.missing
        ? <div className="zs-content-empty"><strong>阅读讲义里还没有这一章</strong><small>阅读讲义按整节生成，生成后按章节标题对上。</small><button type="button" className="zs-text" onClick={() => onEntry({ kind: "read" })}>改为阅读整节</button></div>
        : <LectureReader state={state} controller={controller} focus={focus} scope={scope} onSource={(target) => {
          const index = target.sourceBlockIndexes?.[0] ?? target.blockIndexes?.[0];
          if (index == null) return;
          onEntry(entryForBlock(result, index));
        }} />}
    </div>;
  }

  if (entry?.kind === "point") {
    const chapter = chapters[entry.chapter];
    const topic = chapter?.topics?.[entry.topic];
    if (!chapter || !topic) {
      return <div className="zs-k-point"><div className="zs-k-point-head">{back}</div><p className="zs-muted">这个知识点已经不在当前整理结果里。</p></div>;
    }
    const range = blocksIn(blocks, topic);
    const shown = blocksIn(visibleBlocks, topic);
    const pane = entry.pane ?? (lectureOf(state.lecture, topic.title) ? "lecture" : "outline");
    const slideIndex = slides.findIndex((item) => item.page === range[0]?.page);
    const scope = pane === "lecture" ? lectureScope(state.lecture, entry, topic.title) : null;
    return <div className="zs-k-point">
      <div className="zs-k-point-head">
        <div className="zs-k-point-title"><button type="button" className="zs-text" onClick={() => onEntry(null)}>← {chapter.title}</button><h3>{topic.title}</h3></div>
        <button type="button" className="zs-button" onClick={() => onOpenVideo(range[0]?.startMs ?? 0)}>回到视频这一段</button>
      </div>
      <div className="zs-content-switch" role="tablist" aria-label="这一则">
        {panes.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={pane === id} onClick={() => onEntry({ ...entry, pane: id, block: undefined })}>{label}</button>)}
      </div>
      {pane === "outline" && <div className="zs-k-cues">
        <p className="zs-layer-note">下面是这一则终稿里已经有的小标题。另写的提纲还没有，这里不编。</p>
        {range.length ? range.map((block) => <div className="zs-k-cue" key={block.index}>
          <p><small>{time(block.startMs ?? 0)}{block.tag?.role ? ` · ${block.tag.role}` : ""}{block.register === "draft" ? " · 待核" : ""}</small><br />{clip(block.tag?.summary || block.sentences?.[0]?.text)}</p>
          <button type="button" className="zs-text" onClick={() => onOpenVideo(block.startMs ?? 0)}>回到视频</button>
        </div>) : <p className="zs-muted">这一则还没有终稿片段。</p>}
      </div>}
      {pane === "resource" && <>
        <HitNote searching={searching} keywordSearch={keywordSearch} visibleBlocks={shown} hitCount={hitCount} />
        {shown.length ? <ResourceBlocks blocks={shown} onOpenVideo={onOpenVideo} /> : !searching && <p className="zs-muted">这一则还没有终稿片段。</p>}
      </>}
      {pane === "lecture" && (scope?.missing
        ? <div className="zs-content-empty"><strong>阅读讲义里还没有这个知识点</strong><small>阅读讲义按整节生成。同名的知识点会出现在这里。</small><small>点击上方「生成讲义」，按整节生成。</small></div>
        : <LectureReader state={state} controller={controller} focus={focus} scope={scope} onSource={() => onEntry({ ...entry, pane: "resource", block: range[0]?.index })} />)}
      {pane === "note" && <NotePanel state={state} controller={controller} slides={slides} subtitles={subtitles} pageIndex={slideIndex >= 0 ? slideIndex : 0} onLocate={onLocate} />}
      {pane === "quiz" && <QuizPanel key={`${state.lesson?.id}:${topic.from}-${topic.to}`} state={state} controller={controller} onlyBlocks={range.map((block) => block.index)} pointTitle={topic.title} pointId={topic.pointId} />}
    </div>;
  }

  const raw = entry?.kind === "raw" || chapters.length === 0;
  const surfaceSwitch = <div className="zs-content-switch" role="group" aria-label="知识点看法">
    {lectureReady && <button type="button" aria-pressed={surface === "handout" && !entry} onClick={() => chooseSurface("handout")}>讲义</button>}
    {!raw && <button type="button" aria-pressed={surface === "cards" && !entry} onClick={() => chooseSurface("cards")}>卡片</button>}
    {!raw && <button type="button" aria-pressed={surface === "graph" && !entry} onClick={() => chooseSurface("graph")}>图谱</button>}
    <button type="button" onClick={() => controller.questionBank.open({courseId:state.course?.id,subId:state.lesson?.subId})}>全局题库</button>
  </div>;
  if (!entry && surface === "handout" && lectureReady) {
    return <div className="zs-k-home">
      <div className="zs-k-tools"><div className="zs-k-tools-main">{surfaceSwitch}</div></div>
      <LectureReader state={state} controller={controller} focus={focus} onSource={(target) => {
        const index = target.sourceBlockIndexes?.[0] ?? target.blockIndexes?.[0];
        if (index == null) return;
        onEntry(entryForBlock(result, index));
      }} />
    </div>;
  }
  return <div className="zs-k-home">
    <Notice>{result.status !== "ready" ? "部分页面或标签还未整理完成；原始字幕仍然保留，可以重新整理。" : null}</Notice>
    {raw
      ? <p className="zs-layer-note">这节课还没有划分知识点，下面是整节终稿。章节出来之后，这里会变成知识点卡片。</p>
      : <p className="zs-layer-note">{lectureReady ? "卡片用来跳进某一则。整节阅读在「讲义」里，目录按章节、知识点和小标题排。" : "学生读的是阅读讲义。它从讲义资源终稿按知识点填充，再逐点终审。"}</p>}
    <div className="zs-k-tools">
      <div className="zs-k-tools-main">
        {entry?.kind === "raw" && chapters.length > 0 && back}
        {surfaceSwitch}
      </div>
    </div>
    {result.spine && <p className="zs-k-spine">{result.spine}</p>}
    {raw
      ? <>
        <HitNote searching={searching} keywordSearch={keywordSearch} visibleBlocks={visibleBlocks} hitCount={hitCount} />
        {visibleBlocks.length > 0 && <ResourceBlocks blocks={visibleBlocks} onOpenVideo={onOpenVideo} />}
      </>
      : surface === "graph"
        ? <div className="zs-k-graph" aria-label="知识图谱">{chapters.map((chapter, ci) => <div className="zs-k-graph-col" key={ci}>
          <button type="button" className="zs-k-graph-chapter" onClick={() => onEntry({ kind: "read", chapterTitle: chapter.title })}>{chapter.title}</button>
          <div className="zs-k-graph-stem" aria-hidden="true" />
          <div className="zs-k-graph-topics">{(chapter.topics ?? []).map((topic, ti) => {
            const marks = marksOf(topic, blocks, state.lecture, note);
            return <button type="button" className="zs-k-graph-node" key={ti} onClick={() => openPoint(ci, ti)}>
              <strong>{topic.title}</strong>
              <small>{[marks.when, marks.pending ? "待核" : "", marks.noted ? "有笔记" : ""].filter(Boolean).join(" · ")}</small>
            </button>;
          })}</div>
        </div>)}</div>
        : <div className="zs-k-chapters">{chapters.map((chapter, ci) => <section className="zs-k-chapter" key={ci}>
          <div className="zs-k-chapter-head"><h3>{chapter.title}</h3><button type="button" className="zs-text" onClick={() => onEntry({ kind: "read", chapterTitle: chapter.title })}>阅读这一章</button></div>
          <div className="zs-k-cards">{(chapter.topics ?? []).map((topic, ti) => {
            const marks = marksOf(topic, blocks, state.lecture, note);
            return <button type="button" className="zs-k-card" key={ti} onClick={() => openPoint(ci, ti)}>
              <strong>{topic.title}</strong>
              <small>{marks.count} 个片段{marks.when ? ` · ${marks.when}` : ""}</small>
              {(marks.pending || marks.noted) && <span className="zs-k-marks">{marks.pending && <span className="zs-k-mark">待核</span>}{marks.noted && <span className="zs-k-mark is-note">有笔记</span>}</span>}
            </button>;
          })}</div>
        </section>)}</div>}
    <Diagnostics result={result} />
  </div>;
}
