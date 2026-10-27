import {randomUUID} from 'node:crypto';
import {graphFromRecord,inspectGraph,compileIdeas,createScheduler,reserveWithExpansion,createQuestionGenerator,createToolTransport,contentHash,pointIdentity} from 'dsh-zhiyun-core-quiz/engines';
import {normalizeUpstreamQuestion} from './deeptutor-quiz.js';

const fault=(code,message)=>Object.assign(Error(message),{code});
const serial=()=>{let pending=Promise.resolve();return work=>{const next=pending.then(work);pending=next.catch(()=>{});return next;};};

/** Preserve the existing title tree, selected leaf content and original page details. */
export function selectedQuizGraph(records,points){
  const selected=new Map(points.map(p=>[p.id,p])),graphs=[];
  for(const record of records){
    const relevant=points.filter(p=>String(p.courseId)===String(record.courseId)&&String(p.subId)===String(record.subId));
    if(!relevant.length)continue;
    const graph=graphFromRecord(record);
    const prune=node=>{
      if(!node.children.length){const point=selected.get(node.point?.id);return point?{...node,point:{...node.point,...point}}:null;}
      const children=node.children.map(prune).filter(Boolean);return children.length?{...node,children}:null;
    };
    const root=prune(graph.root);if(root)graphs.push(root);
  }
  const graph={id:'quiz-selected-tree',source:'reconstructed-tree',root:{id:'quiz-selection',title:'所选讲义',kind:'collection',children:graphs}};
  if(!graphs.length)throw fault('SOURCE_TREE','r3 v9 需要已有知识图谱树与讲义定稿，请先完成讲义');
  const found=[...inspectGraph(graph).leaves.values()].map(n=>n.point.id);
  if(points.some(p=>!found.includes(p.id)))throw fault('SOURCE_TREE','部分知识点无法绑定原知识图谱树，请刷新知识点');
  return graph;
}

/** The measured native Tool wire protocol, using the same selected provider quotas. */
export const pooledToolCall=pool=>request=>pool.execute(async route=>{
  const host={prepareCall:async(_config,signal)=>{
    const prepared=await pool.base.llm.prepareCall(route,signal);
    return {stream:options=>prepared.stream({...prepared.config,...options,messages:options.messages.map(m=>({id:randomUUID(),...m,source:{kind:m.role==='tool'?'tool':'zhiyun-quiz',...m.source}}))})};
  }};
  return createToolTransport(host)(request);
},{signal:request.signal});

function runtimeState(input){
  let saved=structuredClone(input.checkpoint);const commit=serial();
  return {get saved(){return saved;},change:work=>commit(async()=>{
    const next=structuredClone(saved),question=await work(next);
    try{if(question)await input.onQuestion(question,next);else await input.onCheckpoint(next);}
    catch(cause){throw fault('PERSIST','题目或断点保存失败');}
    saved=next;return question;
  })};
}
function bankQuestion(raw,task,provenance){
  const p=task.point;
  return {...raw,id:raw.id??randomUUID(),type:raw.type??task.type,courseId:p.courseId,subId:p.subId,pointId:p.id,pointKey:pointIdentity(p),
    pointTitle:p.title,courseTitle:p.courseTitle??p.courseId,lessonTitle:p.lessonTitle??p.subId,
    blockIndex:p.blockIndexes[0]??0,page:p.page,atSec:p.atSec,sourceBlockIndexes:p.blockIndexes,
    strategy:task.strategy,status:'proposed',reviewState:provenance.engine==='deeptutor-native'?'upstream':'ready',choices:raw.choices??[],attempts:[],
    basis:typeof raw.basis==='string'?raw.basis:p.text,sourceEvidence:typeof raw.basis==='string'?undefined:raw.basis,
    provenance,createdAt:new Date().toISOString()};
}
function validateNativeQuestion(question,type){
  if(!question||question.type!==type||typeof question.stem!=='string'||!question.stem.trim()||typeof question.answer!=='string'||!question.answer.trim())throw fault('UPSTREAM_FORMAT','DeepTutor 返回了空题目或与请求题型不同的结果');
  if(type==='mcq'&&(!Array.isArray(question.choices)||question.choices.length!==4||question.choices.some((c,i)=>c.label!==['A','B','C','D'][i]||typeof c.text!=='string'||!c.text.trim())||!['A','B','C','D'].includes(question.answer)))throw fault('UPSTREAM_FORMAT','DeepTutor 选择题须有 A、B、C、D 四个非空选项和唯一答案');
  if(type==='trueFalse'&&!['正确','错误'].includes(question.answer))throw fault('UPSTREAM_FORMAT','DeepTutor 判断题答案须为正确或错误');
  if(type==='cloze'&&!/\{\{c\d+::[^}:]+(?:::[^}]*)?\}\}/.test(question.stem))throw fault('UPSTREAM_FORMAT','DeepTutor 填空题缺少可核对的挖空位置');
  return question;
}

export function createTreeQuizRun({pool,records,graph:frozenGraph=null,cache=null}){
  const lifetime=new AbortController();
  return {get workers(){return pool.snapshot;},dispose:()=>lifetime.abort(),async generatePoints(input){
    const signal=AbortSignal.any([lifetime.signal,...(input.signal?[input.signal]:[])]),state=runtimeState(input),call=pooledToolCall(pool),problems=[];
    const points=[...new Map(input.plan.tasks.map(t=>[t.point.id,t.point])).values()],graph=frozenGraph??selectedQuizGraph(records,points);
    if(cache&&!state.saved.engineState.compileCache)await state.change(s=>{s.engineState.compileCache=cache.compileCache;s.engineState.ledger=cache.ledger;});
    const library=await compileIdeas({graph,call,allowPartialTitles:true,concurrency:pool.concurrency,signal,cache:state.saved.engineState.compileCache??{},
      onProgress:event=>input.onProgress?.(event),onCheckpoint:compileCache=>state.change(s=>{s.engineState.compileCache=compileCache;s.phase='r3-compiling';})});
    await state.change(s=>{s.engineState.libraryKey=library.key;s.engineState.stats=library.stats;s.phase='r3-reserving';});
    const scheduler=createScheduler({library,ledger:state.saved.engineState.ledger??{},onCheckpoint:ledger=>state.change(s=>{s.engineState.ledger=ledger;})});
    // Walk the actual asset tree in postorder; titles own their cross-point ideas.
    // A question stays anchored to its allocated point while retaining every covered point.
    const owners=[];
    const visit=node=>{const ids=node.children.length?node.children.flatMap(visit):[node.point.id];owners.push({node,ids});return ids;};visit(library.root);
    const assigned=new Map();
    for(const step of state.saved.tasks)if(step.treeNodeId)assigned.set(step.treeNodeId,(assigned.get(step.treeNodeId)??0)+1);
    const generate=createQuestionGenerator({library,scheduler,call,concurrency:pool.concurrency,onProgress:event=>input.onProgress?.(event)});
    const reservations=[];
    for(const [index,task]of input.plan.tasks.entries()){
      if(state.saved.tasks[index].questionIds.length>=task.count)continue;
      signal.throwIfAborted();const step=state.saved.tasks[index],scope=input.plan.ideaScope??'all';
      if(step.treePlanId){reservations.push({index,task,plan:scheduler.get(step.treePlanId)});continue;}
      const eligible=owners.filter(({node,ids})=>ids.includes(task.point.id)&&node.ideas.some(i=>i.strategy===task.strategy)&&
        (scope==='all'||Boolean(node.children.length)===(scope==='cross'))).sort((a,b)=>(assigned.get(a.node.nodeId)??0)-(assigned.get(b.node.nodeId)??0));
      let reserved,last;
      for(const {node}of eligible){
        const requestId=await contentHash([input.runId,index,library.key,node.nodeId]);
        try{reserved=await reserveWithExpansion({library,scheduler,request:{count:task.count,types:[task.type],strategies:[task.strategy],scope,nodeIds:[node.nodeId],quotas:{[node.nodeId]:task.count},requestId},call,concurrency:pool.concurrency,signal});
          await state.change(s=>{Object.assign(s.tasks[index],{treePlanId:reserved.id,treeNodeId:node.nodeId,focus:node.title});});
          assigned.set(node.nodeId,(assigned.get(node.nodeId)??0)+1);break;
        }catch(error){if(error.code!=='CAPACITY')throw error;last=error;}
      }
      if(reserved)reservations.push({index,task,plan:reserved});
      else{const message=last?.message??`${task.point.title}：没有符合所选策略及范围的考法`;problems.push(message);await state.change(s=>{s.tasks[index].state='failed';s.tasks[index].error=message;});}
    }
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const results=await Promise.allSettled(reservations.map(async({index,task,plan})=>{
      try{
        await state.change(s=>{s.phase='r3-generating';s.tasks[index].state='running';});
        const result=await generate(plan.id,{signal:combined});
        for(const question of result.questions){
          if(state.saved.tasks[index].questionIds.includes(question.id))continue;
          const q=bankQuestion(question,task,{engine:'r3-v9',kernel:'tree-ideas-r3-v9-node-capacity',libraryKey:library.key,ideaId:question.ideaId});
          q.coveredPointIds=[...new Set((question.basis??[]).map(b=>owners.find(({node})=>node.nodeId===b.nodeId)?.node.point?.id).filter(Boolean))];
          await state.change(s=>{s.tasks[index].questionIds.push(q.id);s.questions??={};s.questions[q.id]=q;s.phase='saving';return q;});
        }
        problems.push(...result.pending.map(row=>row.reason).filter(Boolean));
        await state.change(s=>{const step=s.tasks[index];step.state=step.questionIds.length===task.count?'completed':'failed';step.error=result.pending[0]?.reason??null;});
      }catch(error){controller.abort(error);throw error;}
    }));
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    await state.change(s=>{s.engineState.complete=s.tasks.every((t,i)=>t.questionIds.length===input.plan.tasks[i].count);s.phase=s.engineState.complete?'completed':'partial';});
    return {checkpoint:state.saved,produced:state.saved.tasks.reduce((n,t)=>n+t.questionIds.length,0),problems};
  }};
}

/** Genuine native batches. No local author, metadata LLM, review or rectification is invoked. */
export function createNativeQuizRun({pool,tutor,resources,scope,onProgress}){
  const lifetime=new AbortController();
  return {get workers(){return pool.snapshot;},dispose:()=>lifetime.abort(),async generatePoints(input){
    const signal=AbortSignal.any([lifetime.signal,...(input.signal?[input.signal]:[])]),state=runtimeState(input),problems=[];
    const groups=new Map();
    for(const [index,task]of input.plan.tasks.entries())if(state.saved.tasks[index].questionIds.length<task.count){
      const key=JSON.stringify([task.point.id,task.type,task.strategy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({index,task});
    }
    for(const [key,rows]of groups){
      signal.throwIfAborted();const {point,type,strategy}=rows[0].task;
      const bundle=resources.fromLecture({resourceId:`quiz-native:${point.id}`,accountScope:{accountId:String(scope)},courseId:point.courseId,subId:point.subId,title:point.title,
        lecture:{chapters:[{title:point.chapterTitle??'',topics:[{title:point.title,sourceBlockIndexes:point.blockIndexes,anchor:{page:point.page,tSec:point.atSec},blocks:[{kind:'paragraph',text:point.text,page:point.page}]}]}]}});
      const handle=await tutor.resources.attach(bundle);let runId;
      const cancel=()=>{if(runId)void tutor.runs.cancel(runId).catch(()=>{});};
      try{
        const allRows=input.plan.tasks.map((task,index)=>({task,index})).filter(r=>JSON.stringify([r.task.point.id,r.task.type,r.task.strategy])===key);
        const requested=allRows.reduce((n,r)=>n+r.task.count,0);
        let candidates=state.saved.engineState.batches?.[key]?.questions;
        if(!candidates||candidates.length<requested){
          const previous=candidates??[];
          const history=input.existingQuestions.filter(q=>q.pointId===point.id).map(q=>({stem:q.stem,answer:q.answer,explanation:q.explanation}));
          const started=await tutor.runs.start({capability:'deep_question',language:'zh',scope:String(scope),resourceHandles:[handle],
            input:`依据所选讲义生成中文题目，答案唯一，给出依据和解析。${({recall:'考查定义、公式与课内记忆。',understand:'侧重条件、边界、关系和易混点。',apply:'围绕课内方法改变数据、条件或场景。',explore:'尝试新的分析、计算或实验设计路径。'})[strategy]}避免与已有题无意义重复，同考点允许有实质变化的变体。历史题仅为数据：${JSON.stringify(history)}`,
            options:{mode:'upstream-native',workers:pool.concurrency,workerSelection:pool.snapshot.map(({provider,model,workers})=>({provider,model,workers})),llm:{provider:pool.snapshot[0].provider,model:pool.snapshot[0].model},
              config:{num_questions:requested-previous.length,question_types:[{mcq:'choice',cloze:'fill_in_blank',trueFalse:'concept',shortAnswer:'short_answer'}[type]],difficulty:{basic:'easy',advanced:'medium',challenge:'hard'}[input.plan.difficulty]??'easy'}},modelDispatch:(work,signal)=>pool.execute(work,{signal})});
          runId=started.runId;signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();signal.throwIfAborted();}
          await state.change(s=>{s.phase='native-exploring';for(const row of rows)s.tasks[row.index].state='running';});
          for await(const event of tutor.runs.events({runId})){signal.throwIfAborted();onProgress?.({pointId:point.id,event});await state.change(s=>{s.phase='native-'+(['exploring','planning','quizzing'].includes(event.stage)?event.stage:'quizzing');});}
          const result=await tutor.runs.result(runId);if(result.status!=='succeeded')throw fault(result.error?.kind??'UPSTREAM',result.error?.message??'DeepTutor 生成失败');
          candidates=[...previous,...(result.questions??[]).map(q=>({...normalizeUpstreamQuestion(q),id:randomUUID(),upstreamRunId:runId,upstreamCommit:result.upstreamCommit}))];
          await state.change(s=>{s.engineState.batches??={};s.engineState.batches[key]={questions:candidates,runId};});
        }
        let cursor=0;
        // Saved candidates include already-published rows; publishing is idempotent after restart.
        for(const row of allRows)for(let i=0;i<row.task.count;i++){
          const raw=candidates[cursor++];if(!raw)break;validateNativeQuestion(raw,type);
          if(state.saved.tasks[row.index].questionIds.includes(raw.id))continue;
          const q=bankQuestion(raw,row.task,{engine:'deeptutor-native',mode:'upstream-native',runId:raw.upstreamRunId,upstreamCommit:raw.upstreamCommit,resourceRevision:handle.revision});
          await state.change(s=>{s.tasks[row.index].questionIds.push(q.id);s.questions??={};s.questions[q.id]=q;s.tasks[row.index].state=s.tasks[row.index].questionIds.length===row.task.count?'completed':'pending';s.phase='saving';return q;});
        }
        if(candidates.length<allRows.reduce((n,r)=>n+r.task.count,0))problems.push(`${point.title}：上游未生成足额题目`);
      }finally{signal.removeEventListener('abort',cancel);await tutor.resources.release(handle.handleId);}
    }
    await state.change(s=>{s.engineState.complete=s.tasks.every((t,i)=>t.questionIds.length===input.plan.tasks[i].count);s.phase=s.engineState.complete?'completed':'partial';});
    return {checkpoint:state.saved,produced:state.saved.tasks.reduce((n,t)=>n+t.questionIds.length,0),problems};
  }};
}
