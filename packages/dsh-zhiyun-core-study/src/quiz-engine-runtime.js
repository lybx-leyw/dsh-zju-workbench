import {randomUUID} from 'node:crypto';
import {graphFromRecord,inspectGraph,compileIdeas,createScheduler,reserveWithExpansion,createQuestionGenerator,createToolTransport,createCapsuleStore,contentHash,pointIdentity} from 'dsh-zhiyun-core-quiz/engines';
import {classifyError} from 'dsh-zhiyun-core-llm-error';
import {normalizeUpstreamQuestion,nativeQuizContract} from './deeptutor-quiz.js';
import {createCoreQuestionBackend} from './core-question-backend.js';

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
    catch(cause){
      // 保留 cause：只抛一句「保存失败」时，真实原因（序列化失败？schema 不合格？
      // 磁盘满？）全被丢掉，界面上只有 PERSIST 这个码，排查要从头猜。
      //
      // ⚠️ 不能只依赖 cause.message：实测有些抛出路径的 message 是空串
      // （比如 zod 校验失败被再包一层、或 AbortError），于是 detail 拼出来是空的，
      // 界面上又变成「保存失败」四个字——2026-10-31 第二次真机就是这样。
      // 所以要退到 name / code / 甚至 JSON 片段，保证一定带得出可辨识信息。
      const describe = value => {
        if (!value) return '';
        const parts = [];
        if (value.name && value.name !== 'Error') parts.push(value.name);
        if (value.code) parts.push('code=' + value.code);
        const msg = String(value.message ?? '').trim();
        if (msg) parts.push(msg);
        // 兜底：用 JSON 片段，至少能看出是哪个对象/哪类值
        if (!parts.length) {
          try {
            const text = JSON.stringify(value);
            if (text && text !== '{}') parts.push(text.slice(0, 200));
          } catch {
            parts.push(String(value).slice(0, 200));
          }
        }
        return parts.join(' | ');
      };
      const detail = describe(cause);
      const error = fault('PERSIST', detail
        ? '题目或断点保存失败：' + detail
        : '题目或断点保存失败（存储层未给出原因；检查 bank schema 与磁盘）');
      error.cause = cause;
      throw error;
    }
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

/**
 * 原生出题批次的后端选择。
 *
 * # 为什么做成开关而不是直接替换
 *
 * 重构版（core-question）已经通过质量对照：writing 0.972 / shortcuts 0.933，
 * 基线是 0.940 / 0.933。但它是一条全新的实现，出问题时需要能在一处切回去。
 * 开关放在这里而不是环境变量，是因为它必须进版本控制 —— 否则「线上跑的是
 * 哪条链」会变成一件查不清的事。
 *
 * # 为什么调用方一行不用改
 *
 * `createNativeQuizRun` 只通过 tutor 的 6 个方法访问上游。重构版的适配层
 * （core-question-backend.js）把同样的 6 个方法做成同形，于是题型校验、
 * 断点续跑、题库落盘、知识点归属全部沿用既有逻辑。
 *
 * 回退方式：把下面这行改成 'deeptutor'，其余不动。
 */
export const NATIVE_BACKEND = 'core-question';

/**
 * 按 NATIVE_BACKEND 取实际要用的 tutor 后端。
 *
 * `input.backend` 可以显式覆盖：单测需要同时验证两条链的行为，
 * 而那些断言写的是 vendor 的请求形状（`starts[0].options.mode` 之类），
 * 在重构版下本来就不该成立。给测试一个显式开关，比让测试去猜当前常量是什么可靠。
 */
function resolveTutor(tutor, factory, override = undefined) {
  const wanted = override ?? NATIVE_BACKEND;
  if (wanted !== 'core-question') return tutor;
  return factory?.() ?? tutor;
}

/** Genuine native batches. No local author, metadata LLM, review or rectification is invoked. */
export function createNativeQuizRun({pool,tutor,resources,scope,onProgress,backend:backendOverride}){
  const lifetime=new AbortController();
  return {get workers(){return pool.snapshot;},dispose:()=>lifetime.abort(),async generatePoints(input){
    const signal=AbortSignal.any([lifetime.signal,...(input.signal?[input.signal]:[])]),state=runtimeState(input),problems=[];
    const groups=new Map();
    for(const [index,task]of input.plan.tasks.entries())if(state.saved.tasks[index].questionIds.length<task.count){
      const key=JSON.stringify([task.type,task.strategy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({index,task});
    }
    // 按 NATIVE_BACKEND 决定走 vendor 还是重构版。只在函数入口解析一次，
    // 循环里不再判断 —— 一批题中途换后端会让断点语义对不上。
    //
    // 凭证不自己读环境变量：产品已经把 provider/model/凭证收在 worker pool 里，
    // 另开一条读取路径会让「界面选的模型」和「实际调用的模型」可能不是同一个。
    // 这里只把 pool 的第一条路由交给后端，凭证由 pool 内部的 llm 服务提供。
    const backend=resolveTutor(tutor,()=>{
      const made=createCoreQuestionBackend({
        pool,
        // 关键：把现成的 pooledToolCall 传进去。
        // 它封了并发调度、source 归因、finish 失败转异常、传输重试 ——
        // 自己拼 prepareCall 会把这些全丢掉（2026-10-31 真机事故）。
        pooledCall:pool?pooledToolCall(pool):null,
        llmService:pool?.base?.llm??null,
      });
      // 资源登记沿用宿主的：bundle 由宿主 fromLecture 造出，
      // schema 校验与快照落盘都在那边，本层只读不重建。
      // 注入给后端的必须是**带 attach 的实例**（tutor.resources），
      // 不是调用方传进来的 `resources` —— 后者只有 fromLecture。
      // 之前这里注错了，导致 backend.resources 返回一个没有 attach 的对象，
      // `??` 兜底也就不再触发，最终报成「resRegistry.attach is not a function」。
      made.__setHostResources?.(tutor?.resources ?? resources);
      return made;
    },backendOverride);
    // 资源登记必须用**真正提供 attach 的那个实例**。
    //
    // 调用方传进来的 `resources` 只有 `fromLecture`（负责把讲义投影成 bundle）；
    // `attach` / `release` 在 tutor.resources 上 —— 两者职责不同，不能混。
    // 重构版本层不带自己的登记处，所以它透传的也是 tutor.resources。
    // 兜底顺序：后端自带的 → tutor 的 → 调用方传的（测试里可能只给后者）。
    const resRegistry=backend.resources??tutor.resources??resources;
    for(const [key,rows]of groups){
      signal.throwIfAborted();const {point,type,strategy}=rows[0].task;
      const allRows=input.plan.tasks.map((task,index)=>({task,index})).filter(r=>JSON.stringify([r.task.type,r.task.strategy])===key);
      const points=input.plan.sourcePoints??[...new Map(allRows.map(r=>[r.task.point.id,r.task.point])).values()];
      const title=points.length===1?point.title:'所选讲义';
      const contract=nativeQuizContract({title,points,count:allRows.reduce((n,r)=>n+r.task.count,0),type,strategy,difficulty:input.plan.difficulty,existingQuestions:(input.existingQuestions??[]).filter(q=>points.some(p=>p.id===q.pointId))});
      const bundle=resources.fromLecture({resourceId:`quiz-native:${input.runId??'batch'}:${key}`,accountScope:{accountId:String(scope)},courseId:point.courseId,subId:point.subId,title,lecture:contract.lecture});
      const handle=await resRegistry.attach(bundle);let runId;
      // 重构版后端只从 start(resourceHandles) 拿到 handleId，拿不到 bundle 正文。
      // 这里在 attach 成功之后补记一句 —— 校验顺序不变，只是附加一条只读信息。
      backend.rememberBundle?.(handle.handleId,bundle);
      const cancel=()=>{if(runId)void backend.runs.cancel(runId).catch(()=>{});};
      try{
        const requested=allRows.reduce((n,r)=>n+r.task.count,0);
        let candidates=state.saved.engineState.batches?.[key]?.questions;
        if(!candidates||candidates.length<requested){
          const previous=candidates??[];
          const started=await backend.runs.start({capability:'deep_question',language:'zh',scope:String(scope),resourceHandles:[handle],
            input:contract.input,
            options:{mode:'upstream-native',workers:pool.concurrency,workerSelection:pool.snapshot.map(({provider,model,workers})=>({provider,model,workers})),llm:{provider:pool.snapshot[0].provider,model:pool.snapshot[0].model},
              config:{...contract.config,num_questions:requested-previous.length}},modelDispatch:(work,signal)=>pool.execute(work,{signal})});
          runId=started.runId;signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();signal.throwIfAborted();}
          await state.change(s=>{s.phase='native-exploring';for(const row of rows)s.tasks[row.index].state='running';});
          for await(const event of backend.runs.events({runId})){signal.throwIfAborted();onProgress?.({pointId:point.id,event});await state.change(s=>{s.phase='native-'+(['exploring','planning','quizzing'].includes(event.stage)?event.stage:'quizzing');});}
          const result=await backend.runs.result(runId);if(result.status!=='succeeded')throw fault(result.error?.kind??'UPSTREAM',result.error?.message??'DeepTutor 生成失败');
          const accepted=[];
          for(const candidate of result.questions??[]){
            try{
              const normalized=normalizeUpstreamQuestion(candidate);
              validateNativeQuestion(normalized,type);
              // 这里就要补齐知识点归属，不能只塞 id。
              //
              // accepted 会被写进 engineState.batches（第 342 行），而 checkpoint
              // 是要过 bank schema 的：questions[i] 要求 courseId/subId/pointId/
              // pointTitle/courseTitle/lessonTitle 都是非空字符串。
              //
              // 2026-10-31 的 INVALID_RECORD 就是这样来的：这里只加了三个字段，
              // 于是 questions.47.courseId 等全部是 undefined，整批保存被拒。
              // 而这些字段本来就能从 plan.tasks 的 point 拿到 —— 不是缺失，是没填。
              const owner=points.find(p=>p.title===normalized.topic)??point;
              const banked=bankQuestion(normalized,{...rows[0].task,point:owner},{
                engine:'deeptutor-native',mode:'upstream-native',runId,upstreamCommit:result.upstreamCommit,
                resourceRevision:handle.revision,
              });
              // 保留上游给的考点描述；它与知识点标题不同，是有信息量的
              if(normalized.topic&&owner?.title&&normalized.topic!==owner.title)banked.topicHint=normalized.topic;
              banked.sourcePointIds=points.map(p=>p.id);
              accepted.push(banked);
            }catch(error){problems.push(error.message);}
          }
          candidates=[...previous,...accepted].slice(0,requested);
          await state.change(s=>{s.engineState.batches??={};s.engineState.batches[key]={questions:candidates,runId};});
        }
        let cursor=0;
        // Saved candidates include already-published rows; publishing is idempotent after restart.
        for(const row of allRows)for(let i=0;i<row.task.count;i++){
          const raw=candidates[cursor++];if(!raw)break;
          // 候选可能在上一段就已经 bankQuestion 过（新产出的那些）。
          // 对它们只需校验，不能再包一次 —— 否则 id/provenance 会被覆盖，
          // 断点续跑时「已发布的题」判定也会失效。
          const alreadyBanked=raw.courseId!==undefined&&raw.pointId!==undefined;
          if(!alreadyBanked)validateNativeQuestion(raw,type);
          if(state.saved.tasks[row.index].questionIds.includes(raw.id))continue;
          const q=alreadyBanked
            ?raw
            :bankQuestion(raw,{...row.task,point:points.find(p=>p.title===raw.topic)??row.task.point},
              {engine:'deeptutor-native',mode:'upstream-native',runId:raw.upstreamRunId,upstreamCommit:raw.upstreamCommit,resourceRevision:handle.revision});
          q.sourcePointIds=points.map(p=>p.id);
          await state.change(s=>{s.tasks[row.index].questionIds.push(q.id);s.tasks[row.index].actualTask={pointId:q.pointId,title:q.pointTitle};s.questions??={};s.questions[q.id]=q;s.tasks[row.index].state=s.tasks[row.index].questionIds.length===row.task.count?'completed':'pending';s.phase='saving';return q;});
        }
        if(candidates.length<allRows.reduce((n,r)=>n+r.task.count,0))problems.push(`${point.title}：上游未生成足额题目`);
      }catch(error){
        // 重构版是进程内调用，失败不会像子进程那样留下 stderr。
        // 如果这里直接往外抛，上层只会看到「0 道可用」，用户完全不知道
        // 为什么 4 秒就结束 —— 2026-10-31 的真实反馈就是这种。
        //
        // 但要分清两类：
        //   存储/持久化失败（PERSIST）→ 必须继续抛。吞掉它会让用户以为
        //     「这批没出题」，实际是题目生成了但没存进去，重跑还会再花一次钱。
        //   生成失败 → 记进 problems 并在界面上展示，不让整批因为一组而全灭。
        if(error?.code==='PERSIST')throw error;
        problems.push(`${point.title}：${error?.message??'出题失败'}`);
        if(error?.code)problems.push(`错误码：${error.code}`);
      }finally{signal.removeEventListener('abort',cancel);backend.forgetBundle?.(handle.handleId);await resRegistry.release(handle.handleId);}
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
