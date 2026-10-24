import React, { useEffect, useState } from 'react';
import { QUESTION_TYPES, QUESTION_STRATEGIES } from 'dsh-zhiyun-core-quiz';

const labels={running:'正在出题',paused:'已暂停',partial:'部分完成',failed:'出题中断',completed:'出题完成'};
const duration=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;};
const typeLabel=type=>QUESTION_TYPES[type]??type;
export function QuestionGenerationProgress({ bank, state }) {
  const run=state.run,[now,setNow]=useState(Date.now());
  const running=run?.state==='running';
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,run?.id]);
  if(!run)return null;
  const elapsed=run.elapsedMs+(running?Math.max(0,now-(run.observedAt??now)):0),percent=Math.min(100,Math.floor(run.done*100/Math.max(1,run.total)));
  const task=run.tasks[run.currentTask];
  const phases={queued:'等待开始',rewriting:'建立概念与挖空底稿',rewritten:'底稿已保存',searching:'检索应用背景与数据',searched:'检索来源已保存',reviewing:'复核答案与考查角度',generating:`生成${task?typeLabel(task.type):'题目'}`,cached:'复用已保存的步骤',validating:'核对题目与原文依据',saving:'保存题目与断点','task-completed':'继续下一个出题步骤','task-failed':'当前步骤待重试',completed:'本批题目已保存',partial:'可重试未完成部分',paused:'断点已保存，随时继续'};
  const completed=run.tasks.filter(task=>task.done>=task.total).length;
  return <section className="zs-qgen" aria-label="出题进度" data-state={run.state}>
    <header className="zs-qgen-heading"><div><span className="zs-qgen-status"><i aria-hidden="true"/>{labels[run.state]??run.state}</span><strong>{run.done}<small> / {run.total} 道已保存</small></strong></div>
      {running?<button type="button" className="zs-button" disabled={state.busy} onClick={()=>bank.pause()}>暂停出题</button>
        :run.remaining>0&&run.resumable!==false&&<button type="button" className="zs-button" disabled={state.busy} onClick={()=>bank.resume(run.id)}>{run.state==='paused'?'继续出题':'重试未完成'}</button>}
    </header>
    <div className="zs-qgen-bar"><progress value={run.done} max={Math.max(1,run.total)} aria-label="出题完成进度"/><span>{percent}%</span></div>
    <div className="zs-qgen-current" role="status"><span>{running?phases[run.phase]??'正在处理':run.state==='completed'?phases.completed:run.state==='paused'?phases.paused:'已保存的题目不会丢失'}</span>{running&&task&&<strong title={task.title}>{task.title} · {QUESTION_STRATEGIES[task.strategy]?.label} · {typeLabel(task.type)}</strong>}</div>
    <dl className="zs-qgen-metrics"><div><dt>用时</dt><dd>{duration(elapsed)}</dd></div><div><dt>待完成</dt><dd>{run.remaining} 道</dd></div><div><dt>速度</dt><dd>{run.done>0&&elapsed>0?`${(run.done*60000/elapsed).toFixed(1)} 题/分`:'等待首题'}</dd></div></dl>
    {running&&run.etaMs!=null&&<p className="zs-qgen-eta">预计剩余约 {duration(run.etaMs)}，随实际生成速度更新</p>}
    <p className="zs-qgen-cache"><span aria-hidden="true">✓</span> 断点已保存 · 已整理 {run.cachedRewrites} 个知识点{run.cachedDrafts>0?` · ${run.cachedDrafts} 道草稿可继续核对`:''}{run.reusedRewrites+run.reusedDrafts>0?` · 本次复用 ${run.reusedRewrites+run.reusedDrafts} 项缓存`:''}</p>
    <details className="zs-qgen-tasks"><summary>知识点、策略与题型<span>{completed} / {run.tasks.length} 项完成</span></summary><ol>{run.tasks.map((task,index)=><li key={index} data-state={task.done>=task.total?'completed':task.state}><div><strong title={task.title}>{task.title}</strong><span>{QUESTION_STRATEGIES[task.strategy]?.label} · {typeLabel(task.type)}{running&&run.currentTask===index?' · 处理中':task.error?' · 待重试':''}</span></div><span>{task.done} / {task.total}</span></li>)}</ol></details>
    {run.problems.length>0&&<details className="zs-qgen-problems"><summary>查看未完成原因 · {run.problems.length}</summary>{run.problems.map((problem,index)=><p key={index}>{problem}</p>)}</details>}
    <small className="zs-qgen-version">{run.resumable===false?'该批次使用旧出题架构；已保存的题目仍在题库中，请创建新批次。':'恢复时沿用本批次的知识点资料和分配方案。'}</small>
    {state.runs.length>1&&<label className="zs-qgen-history">出题批次<select aria-label="查看出题批次" value={run.id} disabled={running||state.busy} onChange={event=>bank.selectRun(event.target.value)}>{[...state.runs].reverse().map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.done}/{item.total} · {labels[item.state]??item.state}</option>)}</select></label>}
  </section>;
}
