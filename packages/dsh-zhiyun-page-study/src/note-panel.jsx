import React, { useEffect, useState } from "react";
import { focusFromParsed, noteSegments } from "./note-links.js";

/** 当前节的 Markdown 笔记。页码和时间链接在本节的课件、字幕里定位。 */
export function NotePanel({ state, controller, slides, subtitles, pageIndex, onLocate }) {
  const saved = state.note?.markdown ?? "";
  const [draft, setDraft] = useState(saved);
  const [hint, setHint] = useState("");
  const box = React.useRef(null);
  useEffect(() => { setDraft(saved); setHint(""); }, [state.lesson?.id, state.course?.id, state.note?.updatedAt, saved]);
  if (!state.noteWired) return <div className="zs-content-empty"><span>✎</span><strong>节笔记没有接入</strong><small>笔记服务未启用时，这一节不能读写笔记。</small></div>;
  if (!state.note) return <div className="zs-content-empty"><span>✎</span><strong>这节笔记暂时读不出来</strong><small>没有读到原文之前，这里不会用空白覆盖已有笔记。</small></div>;
  const slide = slides[pageIndex];
  async function insert(kind) {
    setHint("");
    try {
      const out = await controller.request("note-link-text", {
        courseId: state.course.id, subId: state.lesson.subId, kind,
        page: slide?.page, atSec: Math.floor((slide?.startMs ?? 0) / 1000),
      });
      const node = box.current;
      const at = node?.selectionStart ?? draft.length;
      const next = `${draft.slice(0, at)}${out.markdown}${draft.slice(node?.selectionEnd ?? at)}`;
      setDraft(next);
    } catch (error) {
      setHint(error.message);
    }
  }
  async function openLink(href) {
    setHint("");
    try {
      const parsed = await controller.request("note-link", { href });
      const target = focusFromParsed(parsed.target, {
        courseId: state.note?.courseId, sectionId: state.note?.sectionId, slides, subtitles,
      });
      if (target?.kind === "page" && target.index != null) onLocate(target);
      else if (target?.kind === "time" && target.subtitleIndex != null) onLocate(target);
      else if (target?.kind === "other-section") setHint("这条链接指向另一节，本节里没法跳过去。");
      else if (target?.kind === "page") setHint("这节课里没有这一页课件。");
      else if (target?.kind === "time") setHint("这节课里没有可对齐的字幕。");
      else setHint("这条链接没有可定位的页码或时间。");
    } catch (error) {
      setHint(error.message);
    }
  }
  return <div className="zs-note">
    <p className="zs-layer-note">笔记跟这一节走。插入的页码和时间链，点开后回到本节的课件或字幕。</p>
    <div className="zs-note-tools">
      <button className="zs-button" disabled={!slide || state.noteBusy} onClick={() => void insert("page")}>插入本页</button>
      <button className="zs-button" disabled={!slide || state.noteBusy} onClick={() => void insert("time")}>插入此刻</button>
      <button className="zs-primary" disabled={state.noteBusy || draft === saved} onClick={() => void controller.saveNote(draft)}>{state.noteBusy ? "正在保存…" : "保存笔记"}</button>
    </div>
    <textarea ref={box} className="zs-note-editor" aria-label="本节笔记" value={draft} onChange={(event) => setDraft(event.target.value)} />
    {hint && <p className="zs-quiz-problem">{hint}</p>}
    <div className="zs-note-preview">{noteSegments(draft).map((part, index) => part.kind === "link"
      ? <button type="button" className="zs-text" key={index} onClick={() => void openLink(part.href)}>{part.label}</button>
      : <span key={index}>{part.text}</span>)}</div>
  </div>;
}
