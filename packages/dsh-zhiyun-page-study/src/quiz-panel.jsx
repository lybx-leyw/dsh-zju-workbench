import React, { useState } from "react";

const TYPE_OPTIONS = [
  ["cloze", "填空"],
  ["shortAnswer", "简答"],
];

/** 从已选知识片段出填空或简答。生成结果停在待审，采纳后才进入复习队列。 */
export function QuizPanel({ state, controller }) {
  const blocks = state.result?.blocks ?? [];
  const [picked, setPicked] = useState([]);
  const [types, setTypes] = useState(["cloze"]);
  const [maxCards, setMaxCards] = useState(2);
  const quiz = state.quiz;
  const toggleBlock = (index) => setPicked((value) => value.includes(index) ? value.filter((item) => item !== index) : value.length >= 6 ? value : [...value, index]);
  const toggleType = (code) => setTypes((value) => value.includes(code) ? value.filter((item) => item !== code) : [...value, code]);
  return <div className="zs-quiz">
    {!state.result ? <div className="zs-content-empty"><span>✦</span><strong>先整理这节课</strong><small>终稿出来之后，才能从知识片段出题。</small></div> : <>
      <p className="zs-layer-note">一次最多选 6 个片段。生成的题先放在待审，采纳之后才进入复习队列。选择题和案例题这一版不出。</p>
      <ul className="zs-quiz-blocks">{blocks.map((block) => <li key={block.index}><label><input type="checkbox" checked={picked.includes(block.index)} onChange={() => toggleBlock(block.index)} />第 {block.page ?? "—"} 页 · {block.tag?.summary || block.sentences?.[0]?.text || "这一段没有可用文字"}</label></li>)}</ul>
      <div className="zs-quiz-tools">
        {TYPE_OPTIONS.map(([code, label]) => <label key={code}><input type="checkbox" checked={types.includes(code)} onChange={() => toggleType(code)} />{label}</label>)}
        <label>本次最多<input type="number" min="1" max="20" value={maxCards} onChange={(event) => setMaxCards(Number(event.target.value))} />道</label>
        <button className="zs-primary" disabled={state.quizBusy || state.busy || !picked.length || !types.length} onClick={() => void controller.generateQuiz({ blockIndexes: picked, types, maxCards })}>{state.quizBusy ? "正在出题…" : "生成题目"}</button>
      </div>
      {quiz?.problems?.map((problem, index) => <p className="zs-quiz-problem" key={index}>{problem}</p>)}
      {quiz?.rejected?.map((item, index) => <p className="zs-muted" key={`rejected-${index}`}>块 {item.blockIndex}：{item.reason}</p>)}
      <QuizList title={`待审 ${quiz?.pending?.length ?? 0}`} items={quiz?.pending ?? []} empty="还没有待审的题。" actions={(item) => <>
        <button className="zs-button" disabled={state.quizBusy} onClick={() => void controller.adoptQuiz(item.id)}>采纳</button>
        <button className="zs-button" disabled={state.quizBusy} onClick={() => void controller.discardQuiz(item.id)}>丢弃</button>
      </>} />
      <QuizList title={`复习队列 ${quiz?.queue?.length ?? 0}`} items={quiz?.queue ?? []} empty="采纳后的题会出现在这里。" actions={(item) => <button className="zs-button" disabled={state.quizBusy} onClick={() => void controller.discardQuiz(item.id)}>移出队列</button>} />
      {quiz?.discarded > 0 && <p className="zs-muted">已丢弃 {quiz.discarded} 道，不在复习队列里。</p>}
    </>}
  </div>;
}

function QuizList({ title, items, empty, actions }) {
  return <section className="zs-quiz-group"><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li className="zs-quiz-item" key={item.id}><div><strong>{item.type === "shortAnswer" ? "简答" : "填空"}</strong><p>{item.stem}</p><p className="zs-muted">答案：{item.answer} · 块 {item.blockIndex}</p></div><div className="zs-quiz-actions">{actions(item)}</div></li>)}</ul> : <p className="zs-muted">{empty}</p>}</section>;
}
