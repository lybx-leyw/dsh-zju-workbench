import {randomUUID} from 'node:crypto';
import {graphFromRecord,inspectGraph,compileIdeas,createScheduler,reserveWithExpansion,createQuestionGenerator,createToolTransport,createCapsuleStore,contentHash,pointIdentity} from 'dsh-zhiyun-core-quiz/engines';
import {classifyError} from 'dsh-zhiyun-core-llm-error';
import {normalizeUpstreamQuestion,nativeQuizContract} from './deeptutor-quiz.js';

const fault=(code,message)=>Object.assign(Error(message),{code});
const serial=()=>{let pending=Promise.resolve();return work=>{const next=pending.then(work);pending=next.catch(()=>{});return next;};};

/** Preserve the existing title tree, selected leaf content and original page details. */
export function selectedQuizGraph(records,points){
  const selected=new Map(points.map(p=>[p.id,p])),graphs=[],sourceGraphs=[];
  for(const record of records){
    const relevant=points.filter(p=>String(p.courseId)===String(record.courseId)&&String(p.subId)===String(record.subId));
    if(!relevant.length)continue;
    const graph=graphFromRecord(record);
    const prune=node=>{
      if(!node.children.length){const point=selected.get(node.point?.id);return point?{...node,point:{...node.point,...point}}:null;}
      const children=node.children.map(prune).filter(Boolean);return children.length?{...node,children}:null;
    };
    const root=prune(graph.root);if(root){graphs.push(root);sourceGraphs.push({...graph,root});}
  }
  const graph={id:'quiz-selected-tree',source:'reconstructed-tree',root:{id:'quiz-selection',title:'所选讲义',kind:'collection',children:graphs}};
  if(!graphs.length)throw fault('SOURCE_TREE','r3 v9 需要已有知识图谱树与讲义定稿，请先完成讲义');
  const found=[...inspectGraph(graph).leaves.values()].map(n=>n.point.id);
  if(points.some(p=>!found.includes(p.id)))throw fault('SOURCE_TREE','部分知识点无法绑定原知识图谱树，请刷新知识点');
  return sourceGraphs.length===1?sourceGraphs[0]:graph;
}

/**
 * 把 DSH 宿主的 `finish` 块翻译成异常 —— 与 bench 的 `deeptutor-host.mjs:31` 对齐。
 *
 * # 为什么必须在适配器这一层做
 *
 * DSH 宿主适配器**不会**在 provider 失败时抛异常：它把失败规整成一个终止块
 * （`dsh-llm` 的 `adapterFailureChunk` → `{type:'finish',reason:{kind:'error',failure}}`）。
 * 而 `createToolTransport`（kernel，digest 钉在与 bench 一致的值上，不该改）只累加
 * `text-delta` / `tool-call-delta` / `usage`，**不读 `finish`**。于是 429、超时、限流
 * 全被读成 `{text:'',toolCalls:[],usage:undefined}` —— 一个"模型这次什么都没返回"的
 * 空结果。空结果不抛异常，r3 的 16 轮 / 3 次修复预算一次都不会花，整批直接失败。
 *
 * bench 的 `deeptutor-host.mjs` 恰好相反：非 stop 就 throw，所以同一份 kernel 在
 * bench 里能靠重试救回来。这个差异就是"bench 全绿、产品必挂"的全部原因，因此对齐
 * 动作落在适配器，而不是去改被测量过的 kernel。
 *
 * # 为什么要做 code 映射
 *
 * `failure.code` 用的是 DSH 词表（`dsh-llm-deepseek` 的 `providerError` 产出
 * `AUTH` / `QUOTA` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_REQUEST`
 * / `SERVER` / `HTTP_<n>`），而本仓的 `classifyError` 吃的是 HTTP 状态码 + 消息特征。
 * 直接把 DSH 的 code 丢进去会落到 `unknown` → 判成「不可重试」，那等于没修。
 * 所以这里先把 DSH 词表折回状态码，再交给唯一的分类实现。
 */
const STATUS_OF_HARNESS_CODE={RATE_LIMIT:429,QUOTA:402,ACCOUNT_QUOTA:402,AUTH:401,INVALID_REQUEST:400,CONTEXT_WINDOW_EXCEEDED:422,TIMEOUT:null,SERVER:500};

function finishFailure(finish,signal){
  if(!finish||finish.kind==='stop'||finish.kind==='tool-calls')return null;
  if(finish.kind==='max-tokens')return Object.assign(Error('模型输出被预算截断，工具调用无法安全执行'),{code:'TRUNCATED',retryable:true});
  const failure=finish.failure??{},aborted=finish.kind==='aborted'||signal?.aborted===true;
  const harnessCode=String(failure.code??'');
  const status=Number.isInteger(failure.status)?failure.status
    :Object.hasOwn(STATUS_OF_HARNESS_CODE,harnessCode)?STATUS_OF_HARNESS_CODE[harnessCode]
    :/^HTTP_(\d{3})$/.test(harnessCode)?Number(harnessCode.slice(5)):null;
  const verdict=classifyError({status,message:String(failure.message??harnessCode??''),code:harnessCode});
  return Object.assign(Error(failure.message??('模型接口失败：'+(harnessCode||finish.kind))),{
    // 取消不是失败，重试它等于"用户点了暂停还在继续烧钱"，因此单独给 CANCELLED 且永不重试。
    code:aborted?'CANCELLED':verdict.failure,retryable:!aborted&&verdict.retryable,action:verdict.action,status:verdict.status,harnessCode,
  });
}

/** 单次工具调用上限：宿主不设上限时，卡住的 provider 会让整批永久挂起（bench 用 90s）。 */
const TOOL_TIMEOUT_MS=600000;
/** 传输层重试退避（毫秒）。与上游 `agent_loop.py` 的 `_PROVIDER_RETRY_DELAYS=(0.5,1.5)` 同量级。 */
const RETRY_DELAYS_MS=Object.freeze([500,1500]);

/**
 * 在**适配器层**重试可重试的传输失败。
 *
 * # 为什么重试不能靠 kernel
 *
 * kernel（`compiler.mjs:65` / `generator.mjs:73`）的重试预算只覆盖**协议**失败
 * （工具参数 JSON 不合规 → `continue` 再来一轮）。传输失败在 `compiler.mjs:65`
 * 直接冒泡，在 `generator.mjs:73` 被打成 `TRANSPORT`，随后 `generator.mjs:110`
 * 的 `if(!['COLLISION',undefined].includes(error.code))throw error` 把它重新抛出
 * → 整批归零。kernel 的 digest 钉在与 bench 一致的值上，不该为了重试去改它，
 * 所以重试落在所有调用都必经的这一层。
 *
 * # 为什么这比"提高模型成功率"更有效
 *
 * 一批 10 题约 30~57 次串行调用，每次都可能撞 429/超时。按每批 C 次、单次成功率 p
 * 计算，整批成功率是 p^C：p=0.95、C=30 时只有 21.5%，而要把整批做到 90% 需 p≥0.997。
 * 任何真实 provider 都给不出这个 p。加上 3 次尝试后，单次有效成功率变成
 * 1-(1-p)^3，同样 C=30、p=0.95 时整批成功率升到 99.9% 量级 —— 这是把"批次规模
 * 放大失败率"这件事真正消掉的地方。
 *
 * 不可重试的（鉴权、余额、参数、上下文超限）直接抛：重发同一个请求注定同样失败，
 * 只会白烧额度并把真正的问题稀释成"偶发失败"。
 */
async function withTransportRetry(work,signal){
  for(let attempt=0;;attempt++){
    try{return await work();}
    catch(error){
      const delay=RETRY_DELAYS_MS[attempt];
      if(error?.retryable!==true||delay===undefined||signal?.aborted)throw error;
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,delay);
        signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});
      });
      signal?.throwIfAborted();
    }
  }
}

/** The measured native Tool wire protocol, using the same selected provider quotas. */
export const pooledToolCall=pool=>request=>pool.execute(async route=>{
  const host={prepareCall:async(_config,signal)=>{
    const prepared=await pool.base.llm.prepareCall(route,signal);
    return {stream:async function*(options){
      const outer=options.signal??signal;
      for await(const chunk of prepared.stream({...prepared.config,...options,messages:options.messages.map(m=>({id:randomUUID(),...m,source:{kind:m.role==='tool'?'tool':'zhiyun-quiz',...m.source}}))})){
        // kernel 只认 text / tool-call / usage，终止块必须在这里变成异常，
        // 否则 provider 失败会被静默读成"模型什么都没返回"（见 finishFailure 注释）。
        if(chunk.type==='finish'){const error=finishFailure(chunk.reason,outer);if(error)throw error;}
        yield chunk;
      }
    }};
  }};
  const signal=AbortSignal.any([AbortSignal.timeout(TOOL_TIMEOUT_MS),...(request.signal?[request.signal]:[])]);
  return withTransportRetry(()=>createToolTransport(host)({...request,signal}),signal);
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
    // v9 bench reserves the batch on the whole selected tree. Leaf quotas
    // invented by the product must not constrain the native scheduler.
    let plan;
    if(state.saved.engineState.treeBatchPlanId)plan=scheduler.get(state.saved.engineState.treeBatchPlanId);
    else{
      plan=await reserveWithExpansion({library,scheduler,request:{count:input.plan.count,types:input.plan.types,scope:input.plan.ideaScope??'all',strategies:input.plan.strategies.map(row=>row.id),requestId:await contentHash([input.runId,library.key,'v9-batch'])},call,concurrency:pool.concurrency,signal});
      await state.change(s=>{s.engineState.treeBatchPlanId=plan.id;});
    }
    await state.change(s=>{s.phase='r3-generating';for(const step of s.tasks)if(!step.questionIds.length)step.state='running';});
    // 与 bench 的 runR3 默认档（assetMode='verified'）对齐：共享讲解资产 + 独立盲解。
    // 资产按"来源/任务/契约"缓存一次，逐题复用；未通过核验的题记为 needs-asset-review 而不是作废。
    const capsules=createCapsuleStore({cache:state.saved.engineState.capsules??{},call,concurrency:pool.concurrency,
      cacheScope:'product',onCheckpoint:value=>state.change(s=>{s.engineState.capsules=value;})});
    const generate=createQuestionGenerator({library,scheduler,call,concurrency:pool.concurrency,onProgress:event=>input.onProgress?.(event),capsules,blind:true});
    const result=await generate(plan.id,{signal});
    for(const question of result.questions){
      if(state.saved.tasks.some(step=>step.questionIds.includes(question.id)))continue;
      const index=state.saved.tasks.findIndex((step,i)=>step.questionIds.length<input.plan.tasks[i].count);
      if(index<0)throw fault('UPSTREAM_FORMAT','r3 返回题数超过批次计划');
      const owner=owners.find(({node})=>node.nodeId===question.nodeId),idea=owner?.node.ideas.find(row=>row.id===question.ideaId);
      const coveredPointIds=[...new Set((question.basis??[]).map(b=>owners.find(({node})=>node.nodeId===b.nodeId)?.node.point?.id).filter(Boolean))];
      const point=points.find(p=>coveredPointIds.includes(p.id))??input.plan.tasks[index].point;
      const task={...input.plan.tasks[index],point,type:question.type,strategy:idea?.strategy??input.plan.tasks[index].strategy};
      const q=bankQuestion(question,task,{engine:'r3-v9',kernel:'tree-ideas-r3-v9-node-capacity',libraryKey:library.key,ideaId:question.ideaId});
      q.coveredPointIds=coveredPointIds;
      await state.change(s=>{const step=s.tasks[index];step.questionIds.push(q.id);step.actualTask={pointId:point.id,title:point.title,courseId:point.courseId,subId:point.subId,courseTitle:point.courseTitle,lessonTitle:point.lessonTitle,type:q.type,strategy:q.strategy};step.state='completed';step.error=null;s.questions??={};s.questions[q.id]=q;s.phase='saving';return q;});
    }
    problems.push(...result.pending.map(row=>row.reason).filter(Boolean));
    await state.change(s=>{for(const [i,step]of s.tasks.entries())if(step.questionIds.length<input.plan.tasks[i].count){step.state='failed';step.error=result.pending[0]?.reason??'原生批次尚未足额完成';}});
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
      const key=JSON.stringify([task.type,task.strategy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({index,task});
    }
    for(const [key,rows]of groups){
      signal.throwIfAborted();const {point,type,strategy}=rows[0].task;
      const allRows=input.plan.tasks.map((task,index)=>({task,index})).filter(r=>JSON.stringify([r.task.type,r.task.strategy])===key);
      const points=input.plan.sourcePoints??[...new Map(allRows.map(r=>[r.task.point.id,r.task.point])).values()];
      const title=points.length===1?point.title:'所选讲义';
      const contract=nativeQuizContract({title,points,count:allRows.reduce((n,r)=>n+r.task.count,0),type,strategy,difficulty:input.plan.difficulty,existingQuestions:(input.existingQuestions??[]).filter(q=>points.some(p=>p.id===q.pointId))});
      const bundle=resources.fromLecture({resourceId:`quiz-native:${input.runId??'batch'}:${key}`,accountScope:{accountId:String(scope)},courseId:point.courseId,subId:point.subId,title,lecture:contract.lecture});
      const handle=await tutor.resources.attach(bundle);let runId;
      const cancel=()=>{if(runId)void tutor.runs.cancel(runId).catch(()=>{});};
      try{
        const requested=allRows.reduce((n,r)=>n+r.task.count,0);
        let candidates=state.saved.engineState.batches?.[key]?.questions;
        if(!candidates||candidates.length<requested){
          const previous=candidates??[];
          const started=await tutor.runs.start({capability:'deep_question',language:'zh',scope:String(scope),resourceHandles:[handle],
            input:contract.input,
            options:{mode:'upstream-native',workers:pool.concurrency,workerSelection:pool.snapshot.map(({provider,model,workers})=>({provider,model,workers})),llm:{provider:pool.snapshot[0].provider,model:pool.snapshot[0].model},
              config:{...contract.config,num_questions:requested-previous.length}},modelDispatch:(work,signal)=>pool.execute(work,{signal})});
          runId=started.runId;signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();signal.throwIfAborted();}
          await state.change(s=>{s.phase='native-exploring';for(const row of rows)s.tasks[row.index].state='running';});
          for await(const event of tutor.runs.events({runId})){signal.throwIfAborted();onProgress?.({pointId:point.id,event});await state.change(s=>{s.phase='native-'+(['exploring','planning','quizzing'].includes(event.stage)?event.stage:'quizzing');});}
          const result=await tutor.runs.result(runId);if(result.status!=='succeeded')throw fault(result.error?.kind??'UPSTREAM',result.error?.message??'DeepTutor 生成失败');
          const accepted=[];
          for(const candidate of result.questions??[]){
            try{accepted.push({...validateNativeQuestion(normalizeUpstreamQuestion(candidate),type),id:randomUUID(),upstreamRunId:runId,upstreamCommit:result.upstreamCommit});}
            catch(error){problems.push(error.message);}
          }
          candidates=[...previous,...accepted].slice(0,requested);
          await state.change(s=>{s.engineState.batches??={};s.engineState.batches[key]={questions:candidates,runId};});
        }
        let cursor=0;
        // Saved candidates include already-published rows; publishing is idempotent after restart.
        for(const row of allRows)for(let i=0;i<row.task.count;i++){
          const raw=candidates[cursor++];if(!raw)break;validateNativeQuestion(raw,type);
          if(state.saved.tasks[row.index].questionIds.includes(raw.id))continue;
          const actual=points.length===1?points[0]:points.find(p=>p.title===raw.topic);
          const q=bankQuestion(raw,{...row.task,point:actual??row.task.point},{engine:'deeptutor-native',mode:'upstream-native',runId:raw.upstreamRunId,upstreamCommit:raw.upstreamCommit,resourceRevision:handle.revision});
          q.sourcePointIds=points.map(p=>p.id);
          if(!actual){q.pointId=null;q.pointKey=null;q.pointTitle=raw.topic??'所选讲义（上游未标注具体知识点）';}
          await state.change(s=>{s.tasks[row.index].questionIds.push(q.id);s.tasks[row.index].actualTask={pointId:q.pointId,title:q.pointTitle};s.questions??={};s.questions[q.id]=q;s.tasks[row.index].state=s.tasks[row.index].questionIds.length===row.task.count?'completed':'pending';s.phase='saving';return q;});
        }
        if(candidates.length<allRows.reduce((n,r)=>n+r.task.count,0))problems.push(`${point.title}：上游未生成足额题目`);
      }finally{signal.removeEventListener('abort',cancel);await tutor.resources.release(handle.handleId);}
    }
    await state.change(s=>{s.engineState.complete=s.tasks.every((t,i)=>t.questionIds.length===input.plan.tasks[i].count);s.phase=s.engineState.complete?'completed':'partial';});
    return {checkpoint:state.saved,produced:state.saved.tasks.reduce((n,t)=>n+t.questionIds.length,0),problems};
  }};
}

/**
 * 出题引擎的工具包：外部引擎（`dsh-zhiyun-quiz-lab`）实现 `createRun` 时需要的东西。
 *
 * # 为什么导出而不是让外部引擎复写
 *
 * 这几个是「同一件事只能有一份实现」的典型：
 *
 * - `pooledToolCall` —— 所有模型调用必经处，里面收着宿主 `finish` 块转异常、
 *   错误码折叠与传输层重试。外部引擎自己写一份，就会在某种意义上退回
 *   `architecture/quiz-bench-alignment.md` 记的那次「bench 全绿、产品必挂」。
 * - `bankQuestion` —— 引擎原生题目规整成题库形状的唯一入口。另写一份的结果是
 *   题库里出现两种 provenance / basis 形状，之后没人分得清哪条是哪条。
 * - `runtimeState` / `serial` —— 检查点提交串行化。自己实现容易出现
 *   「两个并发题同时写一份 structuredClone」的丢更新。
 * - `fault` —— 错误码约定（`PERSIST` / `INPUT` / `CANCELLED` 等）的单一来源。
 *
 * 导出的是**现有实现本身**，不是副本；本文件其余部分与导出前逐字相同。
 * `pooledToolCall` 本来就已经导出（`quiz-engine-runtime.js:114`），这里不重复列。
 */
export {bankQuestion, runtimeState, serial, fault};
