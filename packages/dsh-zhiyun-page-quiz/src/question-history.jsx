import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {QUESTION_STRATEGIES,QUESTION_TYPES} from 'dsh-zhiyun-core-quiz';
const text=q=>q.stem.replace(/\{\{c\d+::[^}]*\}\}/g,'____');
function Check({mixed=false,...props}){const ref=useRef(null);useEffect(()=>{if(ref.current)ref.current.indeterminate=mixed;},[mixed]);return <input ref={ref} type="checkbox" {...props}/>;}
function Question({q,bank,questions,state,selected,toggle,archived=false}){
  return <div className="zs-qz-question-row" data-selected={selected||undefined}>
    {!archived&&<label className="zs-qz-select"><Check aria-label={`选择题目 ${text(q).slice(0,45)}`} checked={selected} onChange={toggle}/></label>}
    <details className="zs-qz-question"><summary><span className="zs-qz-type">{QUESTION_TYPES[q.type]??q.type}</span><strong>{text(q)}</strong><span>{archived?'已弃用':q.reviewState==='pending'?'待统一查重':q.reviewState==='needs-review'?'待复核':q.attempts?.length?`做过 ${q.attempts.length} 次`:'未做过'}</span></summary>
      <div className="zs-qz-question-body"><p className="zs-muted">{q.courseTitle} / {q.lessonTitle} / {q.pointTitle}</p>
        {q.choices?.map(c=><p key={c.label}>{c.label}. {c.text}</p>)}<p>答案：{q.answer}</p>{q.explanation&&<p>{q.explanation}</p>}{q.basis&&<blockquote>原文依据：{q.basis}</blockquote>}
        {q.strategy&&<p className="zs-muted">{QUESTION_STRATEGIES[q.strategy]?.label} · {q.angle}</p>}
        {q.rectifyReason&&<p className="zs-qz-rejection">查重记录：{q.rectifyReason}</p>}
        {q.discardReason==='user'&&<p className="zs-muted">由你弃用 · 历史作答记录已保留</p>}
        {q.requiresSourceReview&&<p className="zs-muted">资料有尚未确认的提示，请结合原文核对参考答案。</p>}
        {q.variantChange&&<p>变式：{q.variantChange}</p>}{q.solutionPath&&<p>解题路径：{q.solutionPath}</p>}
        {q.rubric?.length>0&&<ul>{q.rubric.map((r,i)=><li key={i}>{r}</li>)}</ul>}
        {q.parentId&&<details><summary>查看母题</summary><p>{text(questions.find(old=>old.id===q.parentId)??{stem:'母题已不可用'})}</p></details>}
        {q.sources?.map((s,i)=><p key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>：{s.quote}</p>)}
        {(q.attempts??[]).map((a,i)=><p className="zs-muted" key={a.id??i}>{new Date(a.at).toLocaleString()} · 作答：{a.response} · {a.verdict==='correct'?'掌握':a.verdict==='incorrect'?'待复习':'已记录'}</p>)}
        <div className="zs-qz-actions">{!archived&&<button type="button" className="zs-button" onClick={()=>bank.discard(q.id)}>弃用此题</button>}
        {q.pointId&&<button type="button" className="zs-button" onClick={()=>bank.openSource(q)}>查看讲义来源</button>}
        {q.materialKey&&q.blankId&&<button type="button" className="zs-button" disabled={state.busy||state.run?.state==='running'} onClick={()=>bank.blockPosition(q)}>停用此挖空位置</button>}</div>
      </div>
    </details>
  </div>;
}
export function QuestionHistory({bank,questions,state:provided}){
  const snapshot=useSyncExternalStore(bank.subscribe,bank.getSnapshot,bank.getSnapshot),state=provided??snapshot;
  const [query,setQuery]=useState(''),[strategy,setStrategy]=useState('all'),[type,setType]=useState('all'),[picked,setPicked]=useState(new Set());
  const matches=q=>(strategy==='all'||q.strategy===strategy)&&(type==='all'||q.type===type)&&[q.stem,q.pointTitle,q.courseTitle,q.lessonTitle].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const active=questions.filter(q=>q.status!=='rejected'),visible=active.filter(matches),archived=questions.filter(q=>q.status==='rejected').filter(matches),selected=active.filter(q=>picked.has(q.id)).map(q=>q.id),all=visible.length>0&&visible.every(q=>picked.has(q.id));
  const toggle=id=>setPicked(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});
  const selectAll=()=>setPicked(current=>{const next=new Set(current);for(const q of visible)all?next.delete(q.id):next.add(q.id);return next;});
  return <section className="zs-qz-history"><div className="zs-qz-section-title"><h2>历史题目</h2><span>{active.length} 道在用 · {questions.length-active.length} 道已弃用</span></div>
    <input className="zs-qz-search" type="search" aria-label="搜索历史题目" placeholder="搜索题目、知识点或课程" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="zs-qz-filters"><select aria-label="筛选出题策略" value={strategy} onChange={e=>setStrategy(e.target.value)}><option value="all">全部策略</option>{Object.entries(QUESTION_STRATEGIES).map(([id,s])=><option key={id} value={id}>{s.label}</option>)}</select><select aria-label="筛选题型" value={type} onChange={e=>setType(e.target.value)}><option value="all">全部题型</option>{Object.entries(QUESTION_TYPES).map(([id,s])=><option key={id} value={id}>{s}</option>)}</select></div>
    <div className="zs-qz-bulk" role="toolbar" aria-label="批量管理题目"><label><Check aria-label="全选当前题目" checked={all} mixed={!all&&visible.some(q=>picked.has(q.id))} onChange={selectAll}/>全选当前结果</label><span>已选 {selected.length} 道</span><button type="button" className="zs-text" disabled={!selected.length} onClick={()=>setPicked(new Set())}>清空选择</button><button type="button" className="zs-button" disabled={!selected.length} onClick={()=>{bank.discardMany(selected);setPicked(new Set());}}>批量弃用</button></div>
    <div className="zs-qz-active-questions">{visible.map(q=><Question key={q.id} q={q} bank={bank} questions={questions} state={state} selected={picked.has(q.id)} toggle={()=>toggle(q.id)}/>)}</div>
    {!visible.length&&<p className="zs-qz-empty">{active.length?'没有匹配的在用题目。':'暂无在用题目，先选择知识点生成一批。'}</p>}
    <details className="zs-qz-archive" key={state.discardRevision??0}><summary><span>已弃用</span><b>{archived.length}</b><small>保留题目与处理记录</small></summary>{archived.map(q=><Question key={q.id} q={q} bank={bank} questions={questions} state={state} archived/>)}</details>
  </section>;
}
