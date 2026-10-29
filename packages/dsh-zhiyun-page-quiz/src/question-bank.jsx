import {QuestionHistory} from './question-history.jsx';
export {QuestionHistory} from './question-history.jsx';
import { QuestionGenerationProgress } from './question-generation-progress.jsx';
import {GenerationModels} from './generation-models.jsx';
import React, { useEffect, useState, useSyncExternalStore,useRef,useId } from 'react';
import { useStudy } from 'dsh-zhiyun-shell-ui';
import { QUESTION_STRATEGIES, QUESTION_TYPES, STRATEGY_PRESETS, allocateStrategies } from 'dsh-zhiyun-core-quiz';

const useBank = bank => useSyncExternalStore(bank.subscribe,bank.getSnapshot,bank.getSnapshot);
const questionText = question => question.stem.replace(/\{\{c\d+::[^}]*\}\}/g,'____');
const typeName = type => QUESTION_TYPES[type] ?? type;
const strategyName=id=>QUESTION_STRATEGIES[id]?.label??'历史题目';

const engineName=item=>item?.label??({'r1':'r1（推荐）','r3-v9':'r3 v9（实验）','deeptutor-native':'DeepTutor 直调'})[item?.id]??'出题模式';

export function QuestionBankPage({ controller }) {
  const study=useStudy(controller),bank=controller.questionBank,state=useBank(bank);
  const [tab,setTab]=useState('出题');
  useEffect(()=>{if(study.user)void bank.load(true);},[study.user?.id]);
  // 未登录时也保留页面骨架：标题与签入入口，别把整页塌成一行字。
  if(!study.user)return <div className="zs-qz-page" data-page="quiz">
    <header className="zs-qz-header">
      <div className="zs-qz-header-text">
        <span className="zs-qz-eyebrow">题库</span>
        <h1>按知识点出题，按知识点复习</h1>
        <p>跨课程挑知识点生成新题，再按新题与旧题的比例组卷练习。题目和作答记录都留在自己的文件里。</p>
      </div>
      <div className="zs-qz-header-actions"><button className="zs-primary" onClick={()=>controller.openAccount()}>登录智云课堂</button></div>
    </header>
    <section className="zs-qz-gate"><p>登录后才能读取课程知识点与历史题目。</p></section>
  </div>;
  const tabs=[['出题','新题'],['练习','组卷'],['历史题库',String(state.questions.length)]];
  const stats=state.coverage?[['题目',state.coverage.questions],['知识点',state.coverage.points],['概念',state.coverage.concepts],['考察角度',state.coverage.angles]]:null;
  return <div className="zs-qz-page" data-page="quiz">
    <header className="zs-qz-header">
      <div className="zs-qz-header-text">
        <span className="zs-qz-eyebrow">题库</span>
        <h1>按知识点出题，按知识点复习</h1>
      </div>
      <div className="zs-qz-header-actions">
        <button className="zs-button" disabled={state.busy||state.loading} onClick={()=>bank.load(true)}>刷新题库</button>
      </div>
    </header>
    {/* 分段导航与统计并成一行：旧的「页头 + 统计卡 + 导航」三段占了首屏 200px，
        而这一页真正要看的是一屏内的出题设置。统计收成导航右端的一串读数。 */}
    <div className="zs-qz-toolbar">
      <nav className="zs-qz-tabs" aria-label="题库功能">{tabs.map(([label,meta])=><button type="button" aria-pressed={tab===label} key={label} onClick={()=>setTab(label)}>{label}<b>{meta}</b></button>)}</nav>
      {stats&&<dl className="zs-qz-stats">{stats.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    </div>
    {state.loading&&<p className="zs-muted zs-qz-loading">正在读取知识点与历史题目…</p>}
    {state.error&&<p role="alert" className="zs-qz-error">{state.error}</p>}
    {state.notice&&<p role="status" className="zs-qz-notice">{state.notice}</p>}
    {tab==='出题'&&<PointQuizComposer controller={controller}/>}
    {tab==='练习'&&<Practice bank={bank} state={state}/>}
    {tab==='历史题库'&&<QuestionHistory bank={bank} questions={state.questions} state={state}/>}
  </div>;
}

/**
 * 出题设置：一屏读完。
 *
 * 旧版把 17 个控件竖着排成一张长卡（策略说明 4 张 200 字卡片、三段说明文字、
 * 两个折叠区、进度卡也塞在同一列里），1440×900 下要滚两屏才看得见生成按钮。
 * 现在按「一行一个决策」排：知识点 / 策略 / 题型各一行 inline chip，
 * 三个数字类字段并成一行，低频项收进「更多设置」浮窗，生成按钮固定在设置卡底部。
 * 进度不再占设置列，改到右栏常驻（没有批次时显示空态卡，而不是整块空白）。
 */
export function PointQuizComposer({ controller, scope=null }) {
  const bank=controller.questionBank,state=useBank(bank),generating=state.run?.state==='running';
  const [count,setCount]=useState(10),[mode,setMode]=useState('uniform'),[types,setTypes]=useState(['mcq','cloze']),[query,setQuery]=useState('');
  const [strategies,setStrategies]=useState([{id:'recall',weight:1}]),[difficulty,setDifficulty]=useState('basic'),[source,setSource]=useState('course');
  const [recallMode,setRecallMode]=useState('complete'),[engine,setEngine]=useState('r1'),[ideaScope,setIdeaScope]=useState('all');
  const drawer=useRef(null),drawerTrigger=useRef(null),drawerId=useId(),[drawerOpen,setDrawerOpen]=useState(false);
  const more=useRef(null),moreTrigger=useRef(null),moreId=useId(),[moreOpen,setMoreOpen]=useState(false);
  useEffect(()=>{const element=drawer.current;if(!element)return;const toggle=e=>setDrawerOpen(e.newState==='open');element.addEventListener('toggle',toggle);return()=>element.removeEventListener('toggle',toggle);},[Boolean(scope)]);
  useEffect(()=>{const element=more.current;if(!element)return;const toggle=e=>setMoreOpen(e.newState==='open');element.addEventListener('toggle',toggle);return()=>element.removeEventListener('toggle',toggle);},[]);
  const closeDrawer=()=>{drawer.current?.hidePopover();drawerTrigger.current?.focus();};
  const closeMore=()=>{more.current?.hidePopover();moreTrigger.current?.focus();};
  useEffect(()=>{void bank.load(true);},[bank]);
  useEffect(()=>{
    if(!state.run)return;
    setCount(state.run.total);setMode(state.run.plan.mode);
    setTypes(state.run.plan.types??[...new Set(state.run.plan.allocation.map(task=>task.type))]);
    setStrategies(state.run.plan.strategies??[{id:'recall',weight:1}]);setDifficulty(state.run.plan.difficulty??'basic');setSource(state.run.plan.source??'course');
    // 恢复一次出题设置时，引擎要**原样保留**，不能静默回落成 r1：
    // 一个已被卸载的引擎（比如关掉实验室后的 r4-lab）如果被当成 r1，
    // 用户会按 r1 的断点语义去续跑一份 r4 的断点，语义完全对不上。
    // 查不到目录时保留原值，由下方的 chosenEngine / blockers 说明它为什么不可用。
    setRecallMode(state.run.plan.recallMode??'complete');
    setEngine(state.run.plan.engine??'r1');
    setIdeaScope(state.run.plan.ideaScope??'all');
    if(!scope&&state.run.plan.pointIds)bank.pick(state.run.plan.pointIds.filter(id=>state.points.some(point=>point.id===id)));
  },[state.run?.id]);
  const points=state.points.filter(point=>!scope || String(point.courseId)===String(scope.courseId)&&String(point.subId)===String(scope.subId)
    &&(scope.pointId?point.id===scope.pointId:(!scope.pointTitle || point.title===scope.pointTitle)&&(!scope.blockIndexes?.length || point.blockIndexes.some(id=>scope.blockIndexes.includes(id)))));
  const selected=scope?points.map(p=>p.id):state.picked;
  const matches=points.filter(point=>[point.title,point.courseTitle,point.lessonTitle].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups=new Map();
  for(const point of matches){if(!groups.has(point.courseId))groups.set(point.courseId,{title:point.courseTitle,lessons:new Map(),ids:[]});const course=groups.get(point.courseId);course.ids.push(point.id);
    if(!course.lessons.has(point.subId))course.lessons.set(point.subId,{title:point.lessonTitle,points:[]});course.lessons.get(point.subId).points.push(point);}
  const toggle=(ids,checked)=>bank.pick(checked?[...new Set([...selected,...ids])]:selected.filter(id=>!ids.includes(id)));
  const mismatched=strategies.filter(row=>!types.some(type=>QUESTION_STRATEGIES[row.id].types.includes(type)));
  const engines=state.engines?.length?state.engines:[{id:'r1',label:'r1（推荐）',description:'知识点规划、并发生成，结合历史题统一复核与整改。'},{id:'r3-v9',label:'r3 v9（实验）',description:'沿知识图谱树提取、复用考法，再生成题目。'},{id:'deeptutor-native',label:'DeepTutor 直调',description:'由 DeepTutor 原生链路规划并生成。'}];
  const chosenEngine=engines.find(row=>row.id===engine);
  // 资料来源限制改由目录自己声明（`source:'course'`）：注册进来的引擎不必再改这里的白名单。
  const courseOnly=chosenEngine?.source==='course'||['r3-v9','deeptutor-native'].includes(engine);
  // 目录里没有这个引擎 = 提供它的包已被卸载。此时不能当成「可用」，
  // 也不能当成 r1 —— 要明确说「已卸载」，并禁止用它发起新批次。
  const engineUnloaded=!chosenEngine;
  const engineReady=chosenEngine?.available!==false&&!engineUnloaded;
  const countReady=Number.isInteger(count)&&count>=1&&count<=100;
  const weightsReady=strategies.every(row=>Number.isFinite(row.weight)&&row.weight>0&&row.weight<=100);
  const valid=engineReady&&countReady&&selected.length>0&&types.length>0&&strategies.length>0&&weightsReady&&!mismatched.length;
  // 7 项合取里「哪一项不满足」必须说出来：旧版只有生成按钮变灰 + hover title，
  // 而「右侧展开配置」在单列布局下还是错的方向。
  const blockers=[];
  if(!selected.length)blockers.push('先选知识点：点下面「选择知识点」勾一门课里的考点。');
  if(!types.length)blockers.push('至少选一个题型。');
  if(!strategies.length)blockers.push('至少选一个出题策略。');
  if(!countReady)blockers.push('总题数要在 1 到 100 之间。');
  if(!weightsReady)blockers.push('策略比例要在 1 到 100 之间。');
  if(mismatched.length)blockers.push(`${mismatched.map(row=>strategyName(row.id)).join('、')}没有可选题型，加选「选择题」或「简答题」。`);
  if(!engineReady)blockers.push(engineUnloaded
    ?`出题引擎「${engine}」已卸载（提供它的插件被关掉了）。已生成的题目仍可查看，但不能用它发起新批次；请在上方切换出题模式。`
    :`${engineName(chosenEngine)}当前不可用，请在上方切换出题模式。`);
  const allocation=valid?allocateStrategies(count,strategies):[];
  const covered=mode==='uniform'?Math.min(count,Math.max(selected.length,0)):Math.min(count,Math.max(1,Math.floor(selected.length*2/3)));
  const updateStrategy=(id,checked)=>setStrategies(current=>checked?[...current,{id,weight:1}]:current.filter(row=>row.id!==id));
  const preset=id=>{setStrategies(STRATEGY_PRESETS[id].strategies.map(row=>({...row})));setTypes([...STRATEGY_PRESETS[id].types]);};
  const advanced=source!=='course'||recallMode!=='complete'||strategies.length>1;
  return <div className="zs-qz-composer" data-embedded={scope?'true':undefined}>
    {!scope&&<section id={drawerId} ref={drawer} popover="auto" role="dialog" aria-label="选择知识点" className="zs-qz-scope zs-qz-scope-drawer"><div className="zs-qz-section-title"><div><h2>选择课程与知识点</h2><span>已选 {selected.length} 个知识点</span></div><button type="button" className="zs-button" aria-label="关闭知识点选择" onClick={closeDrawer}>×</button></div>
      <input type="search" className="zs-qz-search" aria-label="查找课程或知识点" placeholder="查找课程、节次或知识点" value={query} onChange={event=>setQuery(event.target.value)}/>
      {matches.length>0&&<div className="zs-qz-scope-actions"><button type="button" className="zs-text" disabled={state.busy||generating} onClick={()=>toggle(matches.map(p=>p.id),true)}>全选当前列表</button><button type="button" className="zs-text" disabled={state.busy||generating} onClick={()=>bank.pick([])}>清空选择</button></div>}
      {[...groups].map(([id,course])=><details className="zs-qz-course" key={id} open><summary className="zs-qz-scope-row"><span className="zs-qz-scope-chevron" aria-hidden="true">›</span><input aria-label={`选择课程 ${course.title}`} type="checkbox" disabled={state.busy||generating} checked={course.ids.every(id=>selected.includes(id))} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} onChange={e=>toggle(course.ids,e.target.checked)}/><span className="zs-qz-scope-title">{course.title}</span><small>{course.ids.length}</small></summary>
        {[...course.lessons].map(([lessonId,lesson])=><details className="zs-qz-lesson" key={lessonId} open><summary className="zs-qz-scope-row"><span className="zs-qz-scope-chevron" aria-hidden="true">›</span><input aria-label={`选择节次 ${lesson.title}`} type="checkbox" disabled={state.busy||generating} checked={lesson.points.every(p=>selected.includes(p.id))} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} onChange={e=>toggle(lesson.points.map(p=>p.id),e.target.checked)}/><span className="zs-qz-scope-title">{lesson.title}</span><small>{lesson.points.length}</small></summary><div>{lesson.points.map(point=><label className="zs-qz-scope-row zs-qz-scope-point" key={point.id}><span aria-hidden="true"/><input type="checkbox" disabled={state.busy||generating} checked={selected.includes(point.id)} onChange={e=>toggle([point.id],e.target.checked)}/><span className="zs-qz-scope-title">{point.title}</span><span/></label>)}</div></details>)}
      </details>)}
      {!state.loading&&!points.length&&<p className="zs-muted">还没有可出题的知识点。先在学习页生成讲义。</p>}
      {points.length>0&&!matches.length&&<p className="zs-muted">没有匹配的课程或知识点。</p>}
      <footer className="zs-qz-scope-drawer-footer"><span>已选 {selected.length} 个知识点</span><button type="button" className="zs-primary" onClick={closeDrawer}>完成选择</button></footer>
    </section>}
    <section className="zs-qz-setup">
      <div className="zs-qz-setup-head"><h2>{scope?'这个知识点的出题设置':'出题设置'}</h2><p className="zs-qz-setup-sub">{scope?(points.map(point=>point.title).join('、')||'没有找到可出题的知识点，请先完成讲义。'):(selected.length?`已选 ${selected.length} 个知识点`:'还没有选择知识点')}</p></div>
      <div className="zs-qz-row">
        <span className="zs-qz-row-label">出题模式</span>
        <div className="zs-qz-chips" role="group" aria-label="出题模式">{engines.map(item=><button type="button" className="zs-qz-preset" key={item.id} aria-pressed={engine===item.id} title={item.available===false?`${item.description}${item.reason?` · ${item.reason}`:' 服务未就绪'}`:item.description} disabled={state.busy||state.loading||generating||item.available===false} onClick={()=>{setEngine(item.id);if(item.id!=='r1')setSource('course');}}>{engineName(item)}{item.available===false?' · 未就绪':''}</button>)}</div>
      </div>
      {/* 未就绪的原因必须写出来：只把按钮变灰，用户不知道要去装 Python、补依赖，还是重启工作台。 */}
      {!engineReady&&chosenEngine?.reason&&<p className="zs-qz-explanation" role="status">{engineName(chosenEngine)}不可用：{chosenEngine.reason}</p>}
      {!scope&&<div className="zs-qz-row" data-required={!selected.length}>
        <span className="zs-qz-row-label">知识点</span>
        <button type="button" className="zs-qz-scope-chip" ref={drawerTrigger} data-empty={!selected.length} aria-label="选择知识点" aria-expanded={drawerOpen} aria-controls={drawerId} aria-haspopup="dialog" onClick={()=>drawer.current.togglePopover()}>
          <span aria-hidden="true">☷</span>{selected.length?`已选 ${selected.length} 个知识点`:'选择知识点（必选）'}<i aria-hidden="true">›</i>
        </button>
      </div>}
      <div className="zs-qz-row">
        <span className="zs-qz-row-label">出题策略</span>
        <div className="zs-qz-chips" role="group" aria-label="出题策略">
          {Object.entries(STRATEGY_PRESETS).map(([id,item])=><button type="button" className="zs-qz-preset" key={id} disabled={state.busy||state.loading||generating} onClick={()=>preset(id)}>{item.label}</button>)}
          <span className="zs-qz-chips-sep" aria-hidden="true"/>
          {Object.entries(QUESTION_STRATEGIES).map(([id,item])=><label className="zs-qz-chip" data-on={strategies.some(row=>row.id===id)} title={item.description} key={id}><input type="checkbox" disabled={state.busy||state.loading||generating} checked={strategies.some(row=>row.id===id)} onChange={event=>updateStrategy(id,event.target.checked)}/><span>{item.label}</span></label>)}
        </div>
      </div>
      <div className="zs-qz-row">
        <span className="zs-qz-row-label">题型</span>
        <div className="zs-qz-chips" role="group" aria-label="题型">{Object.entries(QUESTION_TYPES).map(([type,label])=><label className="zs-qz-chip" data-on={types.includes(type)} key={type}><input type="checkbox" disabled={state.busy||state.loading||generating} checked={types.includes(type)} onChange={event=>setTypes(current=>event.target.checked?[...current,type]:current.filter(t=>t!==type))}/><span>{label}</span></label>)}</div>
      </div>
      <div className="zs-qz-fields">
        <label className="zs-qz-field">题数<input aria-label="总题数" type="number" min="1" max="100" value={count} disabled={state.busy||generating} onChange={event=>setCount(Number(event.target.value))}/></label>
        <label className="zs-qz-field">分配方式<select aria-label="分配方式" value={mode} disabled={state.busy||generating} onChange={event=>setMode(event.target.value)}><option value="uniform">均匀覆盖</option><option value="random">随机抽样</option></select></label>
        <label className="zs-qz-field">难度<select aria-label="难度" value={difficulty} disabled={state.busy||generating||engine==='r3-v9'} onChange={event=>setDifficulty(event.target.value)}><option value="basic">基础</option><option value="advanced">进阶</option><option value="challenge">挑战</option></select></label>
        <button type="button" className="zs-qz-more-trigger" ref={moreTrigger} data-active={advanced||undefined} aria-expanded={moreOpen} aria-controls={moreId} aria-haspopup="dialog" onClick={()=>more.current.togglePopover()}>更多设置{advanced&&<i aria-hidden="true"/>}</button>
      </div>
      <div className="zs-qz-setup-foot">
        <p className="zs-qz-hint" data-blocked={blockers.length>0||undefined}>
          {blockers.length?blockers[0]:<>{count} 道 · {courseOnly?`所选 ${selected.length} 个知识点 · ${engine==='r3-v9'?'树上考法统一分配':'上游整批规划'}`:`覆盖 ${covered} / ${selected.length} 个知识点`}{!courseOnly&&allocation.length>1&&<> · {allocation.map(row=><span key={row.id}>{strategyName(row.id)} <b>{row.count}</b> </span>)}</>}</>}
        </p>
        <GenerationModels controller={controller} purpose="quiz" disabled={state.busy||generating} generationDisabled={!valid||state.busy||state.loading||generating} onGenerate={workers=>bank.generate({pointIds:selected,count,mode,types,strategies,difficulty,source,recallMode,workers:workers?.length?workers:undefined,engine,ideaScope})} label={generating?'正在出题':state.busy?'正在处理…':'生成题目'}/>
      </div>
      <div id={moreId} ref={more} popover="auto" role="dialog" aria-label="更多出题设置" className="zs-qz-more">
        <div className="zs-qz-more-head"><strong>更多设置</strong><button type="button" className="zs-config-close" aria-label="关闭更多设置" onClick={closeMore}>×</button></div>
        <div className="zs-qz-more-body">
          {engine==='r3-v9'&&<label className="zs-qz-field">考法范围<select aria-label="考法范围" value={ideaScope} disabled={state.busy||generating} onChange={e=>setIdeaScope(e.target.value)}><option value="all">局部与跨考点</option><option value="local">单个知识点</option><option value="cross">跨考点综合</option></select><small className="zs-qz-explanation">标题节点的综合题会保留它涉及的全部知识点；范围内没有可靠考法时保留缺额。</small></label>}
          <label className="zs-qz-field">资料来源<select aria-label="资料来源" value={source} disabled={state.busy||generating||courseOnly} onChange={event=>setSource(event.target.value)}><option value="course">课内资料</option><option value="web">课内 + 联网案例</option></select>{courseOnly&&<small className="zs-qz-explanation">当前引擎只用课内讲义。</small>}</label>
          {!courseOnly&&strategies.some(s=>s.id==='recall')&&<label className="zs-qz-field">基础巩固怎么补<select aria-label="基础巩固怎么补" value={recallMode} disabled={state.busy||generating} onChange={event=>setRecallMode(event.target.value)}><option value="complete">先补缺失的考点</option><option value="variant">只用已有底稿变体</option></select><small className="zs-qz-explanation">补全模式会对照完整讲义与同类历史题查漏，新考点先核对再入库。</small></label>}
          {!courseOnly&&strategies.length>1&&<div className="zs-qz-weights" role="group" aria-label="策略比例">{strategies.map(row=><label key={row.id}>{strategyName(row.id)}<input type="number" aria-label={`${strategyName(row.id)}比例`} min="1" max="100" disabled={state.busy||generating} value={row.weight} onChange={event=>setStrategies(current=>current.map(item=>item.id===row.id?{...item,weight:Number(event.target.value)}:item))}/></label>)}</div>}
          <p className="zs-qz-explanation">{mode==='uniform'?`均匀覆盖：${selected.length} 个知识点各约 ${selected.length?Math.floor(count/selected.length):0} 道，余数随机均摊，各点最多差一道。`:`随机抽样：最多覆盖 ${Math.max(1,Math.floor(selected.length*2/3))} / ${selected.length} 个知识点，允许重复考点、避免重复题干。`}{mode==='uniform'&&count<selected.length?' 本次题数少于知识点数，覆盖不全。':''}</p>
          {mismatched.length>0&&<p role="alert" className="zs-qz-error">{mismatched.map(row=>strategyName(row.id)).join('、')}没有匹配题型，请加选「选择题」或「简答题」。</p>}
        </div>
        <div className="zs-qz-more-foot"><span>改完直接生效</span><button type="button" className="zs-primary" onClick={closeMore}>完成</button></div>
      </div>
    </section>
    <aside className="zs-qz-aside"><QuestionGenerationProgress bank={bank} state={state}/></aside>
  </div>;
}

function Practice({ bank,state }) {
  const [mode,setMode]=useState('new'),[count,setCount]=useState(10),[scope,setScope]=useState('all'),[ratio,setRatio]=useState(50),[strategy,setStrategy]=useState('all'),[type,setType]=useState('all');
  const eligible=state.questions.filter(q=>q.status!=='rejected'&&!['pending','needs-review'].includes(q.reviewState)&&QUESTION_TYPES[q.type]&&(scope!=='selected'||state.picked.includes(q.pointId))&&(strategy==='all'||q.strategy===strategy)&&(type==='all'||q.type===type));
  const fresh=eligible.filter(q=>!q.attempts?.length).length,old=eligible.filter(q=>q.attempts?.length).length;
  if(state.practice)return <PracticeSession key={state.practice.session.id} bank={bank} state={state}/>;
  return <section className="zs-qz-practice"><h2>开始一组练习</h2><p className="zs-muted">未做过 {fresh} 道 · 做过 {old} 道</p>
    <label className="zs-qz-field">练习方式<select aria-label="练习方式" value={mode} onChange={event=>setMode(event.target.value)}><option value="new">未做题</option><option value="review">复习已做题</option><option value="mixed">新旧交错</option></select></label>
    {mode==='mixed'&&<label className="zs-qz-field">未做题比例 · {ratio}%<input aria-label="未做题比例" type="range" min="0" max="100" step="10" value={ratio} onChange={event=>setRatio(Number(event.target.value))}/></label>}
    {/* 范围里的「已勾选知识点」是跨 Tab 依赖：出题页没勾时这里没有可选内容，
        旧的写法是照样可选、点了才发现组不出卷。现在直接把数量写在选项上并禁用空选项。 */}
    <label className="zs-qz-field">范围<select aria-label="练习范围" value={scope} onChange={event=>setScope(event.target.value)}><option value="all">整个题库</option><option value="selected" disabled={!state.picked.length}>出题页勾选的知识点（{state.picked.length}）</option></select></label>
    <label className="zs-qz-field">练习题数<input aria-label="练习题数" type="number" min="1" max="100" value={count} onChange={event=>setCount(Number(event.target.value))}/></label>
    <div className="zs-qz-filters"><label>出题策略<select aria-label="练习出题策略" value={strategy} onChange={event=>setStrategy(event.target.value)}><option value="all">全部策略</option>{Object.entries(QUESTION_STRATEGIES).map(([id,item])=><option value={id} key={id}>{item.label}</option>)}</select></label><label>题型<select aria-label="练习题型" value={type} onChange={event=>setType(event.target.value)}><option value="all">全部题型</option>{Object.entries(QUESTION_TYPES).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label></div>
    <button className="zs-primary" disabled={state.busy||!Number.isInteger(count)||count<1||count>100||scope==='selected'&&!state.picked.length} onClick={()=>bank.practice({mode,count,...mode==='mixed'?{freshRatio:ratio/100}:{},...scope==='selected'?{pointIds:state.picked}:{},...strategy!=='all'?{strategies:[strategy]}:{},...type!=='all'?{types:[type]}:{}})}>开始练习</button>
    <p className="zs-qz-explanation">从已有题库组卷，不自动生成。交错模式按比例抽取未做题与已做题；某类不足时用另一类补齐。简答题对照评分要点自评。</p>
  </section>;
}
function PracticeSession({ bank,state }) {
  const [index,setIndex]=useState(0),[response,setResponse]=useState(''),[revealed,setRevealed]=useState(false);
  const question=state.practice.questions[index],grade=state.answers[question.id];
  return <section className="zs-qz-practice"><div className="zs-qz-section-title"><h2>第 {index+1} / {state.practice.questions.length} 题 · {typeName(question.type)}</h2><button className="zs-text" onClick={()=>bank.finish()}>结束本次练习</button></div>
    <p className="zs-muted">{question.courseTitle} / {question.pointTitle}</p><p className="zs-qz-stem">{questionText(question)}</p>
    {question.requiresSourceReview&&<p className="zs-muted">资料有尚未确认的提示，请结合原文核对参考答案。</p>}
    <form onSubmit={event=>{event.preventDefault();if(question.type==='shortAnswer')setRevealed(true);else void bank.answer(question.id,response);}}>
      {['mcq','trueFalse'].includes(question.type)?<fieldset disabled={Boolean(grade)||state.busy}><legend>选择答案</legend>{(question.type==='mcq'?question.choices:[{label:'正确',text:''},{label:'错误',text:''}]).map(choice=><label className="zs-qz-choice" key={choice.label}><input type="radio" name={question.id} value={choice.label} checked={response===choice.label} onChange={event=>setResponse(event.target.value)}/>{choice.label}{choice.text?`. ${choice.text}`:''}</label>)}</fieldset>
        :question.type==='shortAnswer'?<label className="zs-qz-field">你的解答<textarea aria-label="你的解答" rows="6" maxLength="5000" disabled={Boolean(grade)||revealed||state.busy} value={response} onChange={event=>setResponse(event.target.value)} placeholder="写出推理、计算过程或实验方案"/></label>
        :<label className="zs-qz-field">填写答案<input aria-label="填写答案" disabled={Boolean(grade)||state.busy} value={response} onChange={event=>setResponse(event.target.value)} placeholder="多个空用分号分隔"/></label>}
      {!grade&&!revealed&&<button className="zs-primary" disabled={state.busy||!response.trim()}>{question.type==='shortAnswer'?'对照参考答案':'提交答案'}</button>}
    </form>
    {revealed&&!grade&&<div className="zs-qz-feedback"><strong>参考答案 · 请按要点评价自己的解答</strong><p>{question.answer}</p>{question.explanation&&<p>{question.explanation}</p>}<ul>{question.rubric?.map((item,i)=><li key={i}>{item}</li>)}</ul><div className="zs-qz-self-grade">{[['correct','掌握了'],['partial','部分掌握'],['incorrect','需要复习']].map(([value,label])=><button type="button" className="zs-button" disabled={state.busy} key={value} onClick={()=>bank.answer(question.id,response,value)}>{label}</button>)}</div></div>}
    {grade&&<div className="zs-qz-feedback"><strong>{grade.attempt.grading==='self'?'自评已记录':grade.attempt.verdict==='correct'?'回答正确':'对照答案，再巩固一次'}</strong>{grade.attempt.grading==='self'&&<p>本次自评：{({correct:'掌握了',partial:'部分掌握',incorrect:'需要复习'})[grade.attempt.verdict]}</p>}<p>答案：{grade.answer}</p>{grade.explanation&&<p>{grade.explanation}</p>}{question.rubric?.length>0&&<ul>{question.rubric.map((item,i)=><li key={i}>{item}</li>)}</ul>}{grade.basis&&<blockquote>原文依据：{grade.basis}</blockquote>}{question.type==='cloze'&&<small>填空按标准答案和已知同义表达比对，其余表达可对照自行判断。</small>}
      <div><button className="zs-primary" onClick={()=>{if(index+1<state.practice.questions.length){setIndex(index+1);setResponse('');setRevealed(false);}else bank.finish();}}>{index+1<state.practice.questions.length?'下一题':'完成练习'}</button></div></div>}
  </section>;
}
