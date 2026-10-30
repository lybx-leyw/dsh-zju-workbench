import { itemFromJson, itemToJson } from 'dsh-zhiyun-core-quiz/model';
import { randomUUID } from 'node:crypto';
import {createDeepTutorCandidateCall} from './deeptutor-quiz.js';
import {createTreeQuizRun,createNativeQuizRun,selectedQuizGraph,bankQuestion as bankNormalize,NATIVE_BACKEND} from './quiz-engine-runtime.js';
import {QUIZ_ENGINES,engineEntries,selectableEngines,isSelectableEngine,DEFAULT_ENGINE,registeredEngines,planEngineQuestions,newEngineCheckpoint,canResumeEngine,engineComplete,isNativeEngine,engineLabel,isBuiltinEngine} from 'dsh-zhiyun-core-quiz/engines';
import {normalizeWorkers,WorkerPoolLlm} from 'dsh-zhiyun-core-parser/worker-pool';
import { knowledgePoints, planPractice, checkpointCount,activeFacts,resolveFactId,curateFacts,rectifySummary } from 'dsh-zhiyun-core-quiz/points';

const fault = (code,message) => Object.assign(new Error(message),{code});
const codeOf = value => typeof value === 'string' ? value : value?.code;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,'').toLowerCase();

/**
 * 批次失败 → 给用户看的处理记录。
 *
 * 为什么不能直接显示 `error.message`：错误码（`E_DEPS_MISSING` / `E_CAPABILITY_UNAVAILABLE`）
 * 是给程序分支用的，而用户需要的是「下一步做什么」。两张都要，所以先给一句人话
 * （按 code 查表，认不出就退回原文），再附上原始码与原文供排查。
 *
 * 为什么必须带原文：`deeptutor-native` 那几次失败只活了 259–901ms，`phase` 还停在
 * `queued`，说明死在 `tutor.runs.start()` 之前。如果只写一句「未完成」，那个
 * "到底是 Python 没装、依赖缺失、还是能力未就绪"的关键区分就永久丢了。
 */
const BATCH_FAILURE_HINTS={
  E_DISABLED:'DeepTutor 宿主服务未启用，请在插件设置中开启 zhiyun-deeptutor',
  E_PYTHON_MISSING:'没有可用的 Python 3.11–3.14 解释器，请安装或在设置中指定路径',
  E_PYTHON_VERSION:'Python 版本不受支持，需要 3.11–3.14',
  E_DEPS_MISSING:'DeepTutor 运行依赖未安装（vendor/deeptutor/requirements/server.txt）',
  E_BRIDGE_UNAVAILABLE:'DeepTutor 的 Python 桥未就绪，请重启工作台或等待自动恢复',
  E_CAPABILITY_UNAVAILABLE:'DeepTutor 缺少所需能力，未装好或未开放',
  E_RESOURCE_INVALID:'讲义资源未通过校验，请重新读取讲义后再出题',
  NOT_WIRED:'所选出题引擎尚未接入本机服务',
  INPUT:'出题参数不完整（例如没有选择供应商与并发数）',
  BUSY:'已有出题批次在运行，请先暂停',
  SOURCE_TREE:'所选知识点缺少知识图谱树，请先完成讲义',
  CAPACITY:'可用考法与变体槽位不足，无法凑足计划题数',
  PROTOCOL:'模型未能按要求提交工具参数，修复预算已用完',
  TRANSPORT:'模型接口多次失败（网络/限流/服务端故障）',
  PERSIST:'题目或断点保存失败',
  TRUNCATED:'模型输出被预算截断，工具调用无法安全执行',
};
export function batchProblems(error,aborted){
  if(aborted)return ['已暂停，已保存的题目和断点仍然保留。'];
  if(!error)return [];
  const code=codeOf(error),message=String(error?.message??'').trim();
  const hint=code?BATCH_FAILURE_HINTS[code]:'';
  // 有 hint 时它已经消化了原因，只在原文带来**额外**信息时才附上
  // （避免「依赖未安装（依赖未安装：…）」这种重复）。
  //
  // ⚠️ 判断「是否带来额外信息」不能用 startsWith(hint.slice(0,8))：
  // 保存失败的 message 形如「题目或断点保存失败：<真实原因>」，
  // 前 8 个字恰好与 hint 相同，于是真实原因被判定为「没有额外信息」而丢弃 ——
  // 2026-10-31 连续两次真机都只看到「题目或断点保存失败（错误码 PERSIST）」，
  // 真实原因明明在 message 里却被这一行吞了。
  //
  // 正确判据：去掉 hint 前缀后的**剩余部分**是否非空。
  const remainder = hint && message && message.startsWith(hint)
    ? message.slice(hint.length).replace(/^[：:，,。\s]+/, '').trim()
    : message;
  const detail=[hint?remainder:message,code?`错误码 ${code}`:''].filter(Boolean).join('；');
  if(!hint)return [detail?`${message||'出题中断'}（${detail}）`:`${message||'出题中断'}。`];
  return [detail?`${hint}（${detail}）`:`${hint}。`];
}

const coverageOf=bank=>{
  const questions=bank.questions.filter(q=>q.status!=='rejected');
  return {questions:questions.length,points:new Set(questions.map(q=>q.pointKey??q.pointId)).size,
    concepts:new Set(questions.map(q=>q.conceptId).filter(Boolean)).size,
    angles:new Set(questions.filter(q=>q.angle).map(q=>JSON.stringify([q.pointKey??q.pointId,q.angle]))).size,
    families:new Set(questions.map(q=>q.familyId).filter(Boolean)).size,
    cachedPoints:Object.keys(bank.conceptCache).length};
};
const publicPlan = plan => ({engine:plan.engine??'local',ideaScope:plan.ideaScope,mode:plan.mode,requested:plan.count,pointIds:plan.pointIds,types:plan.types,strategies:plan.strategies,strategyAllocation:plan.strategyAllocation,difficulty:plan.difficulty,source:plan.source,recallMode:plan.recallMode??'complete',totalPoints:plan.totalPoints,coveredPoints:plan.coveredPoints,maxCoverage:plan.maxCoverage,
  allocation:plan.tasks.map(task => ({pointId:task.point.id,title:task.point.title,type:task.type,strategy:task.strategy,count:task.count}))});

/** Orchestration only: durable bank uses the same host domain as the lecture records. */
export class QuestionBank {
  constructor(owner) { this.owner=owner; this.runs=new Map(); this.writes=new Map(); this.starting=new Set(); }
  records(user) { return this.owner.knowledge.listByAccount({accountId:String(user.id)}); }
  async catalog(user,signal) {
    const records=this.records(user);
    let courses=[];
    try { courses=(await this.owner.classroom.listCourses({signal})).items ?? []; } catch { /* Stored records remain usable while course metadata is unavailable. */ }
    const courseNames=new Map(courses.map(course=>[String(course.id),course.title]));
    const lessonNames=new Map(),courseIds=[...new Set(records.map(record=>record.courseId))];
    if(typeof this.owner.classroom.listLessons==='function')for(let i=0;i<courseIds.length;i+=6){
      await Promise.allSettled(courseIds.slice(i,i+6).map(async courseId=>{
        const lessons=await this.owner.classroom.listLessons(courseId,{onlyPlayable:false,signal});
        for(const lesson of lessons.items ?? [])lessonNames.set(courseId+':'+lesson.subId,lesson.title);
      }));
      signal?.throwIfAborted();
    }
    return records.flatMap(record=>knowledgePoints({...record,courseTitle:courseNames.get(record.courseId) ?? record.courseTitle ?? record.courseId,
      lessonTitle:lessonNames.get(record.courseId+':'+record.subId) ?? record.lessonTitle ?? record.title ?? record.subId}));
  }
  baseBank(user) {
    const bank=this.owner.knowledge.questionBank(String(user.id));bank.generationJobs??=[];bank.conceptCache??={};return bank;
  }
  bank(user) {
    const bank=this.baseBank(user);
    // Archive the previous per-section questions once. They survive later lecture replacement.
    for (const record of this.records(user)) for (const raw of record.quiz?.items ?? []) {
      const parsed=itemFromJson({...raw,courseId:record.courseId,sectionId:record.subId,type:codeOf(raw.type),status:codeOf(raw.status)});
      if(!parsed || !parsed.stem.trim() || !parsed.answer.trim())throw fault('CORRUPT','历史题目格式无法读取');
      const item=itemToJson(parsed);
      const id=`legacy:${record.courseId}:${record.subId}:${item.id}`;
      if (bank.questions.some(q=>q.id===id)) continue;
      const points=knowledgePoints(record), point=points.find(p=>p.blockIndexes.includes(item.blockIndex));
      bank.questions.push({...item,id,type:codeOf(item.type),status:codeOf(item.status) ?? 'proposed',courseId:record.courseId,subId:record.subId,
        courseTitle:record.courseTitle ?? record.courseId,lessonTitle:record.title ?? record.subId,
        pointId:point?.id ?? `legacy:${record.courseId}:${record.subId}:${item.blockIndex}`,pointTitle:point?.title ?? '历史题目',
        attempts:(record.quiz?.attempts ?? []).filter(a=>a.quizId===item.id),choices:item.choices ?? []});
    }
    bank.generationJobs ??= [];
    return bank;
  }
  async transaction(user,signal,work,{final=false,archive=true}={}) {
    const key=String(user.id),previous=this.writes.get(key)??Promise.resolve();
    const pending=previous.catch(()=>{}).then(async()=>{
      const bank=archive?this.bank(user):this.baseBank(user);
      if(final)return work(bank,signal);
      return this.owner.mutate('question-bank:'+key,signal,combined=>work(bank,combined));
    });
    this.writes.set(key,pending);
    try{return await pending;}finally{if(this.writes.get(key)===pending)this.writes.delete(key);}
  }
  async archive(user,signal) {
    if(!this.records(user).some(record=>record.quiz?.items?.length))return;
    await this.transaction(user,signal,async bank=>{
      if(bank.questions.length!==this.owner.knowledge.questionBank(String(user.id)).questions.length)await this.save(bank);
    });
  }
  view(job,user) {
    if(!job)return null;
    const runtime=this.runs.get(String(user.id)),active=runtime?.job.id===job.id && !runtime.finished;
    const done=checkpointCount(job.checkpoint);
    const state=active?'running':['queued','running'].includes(job.state)?'paused':job.state;
    const elapsedMs=active?runtime.baseElapsed+Date.now()-runtime.startedAt:job.elapsedMs??0;
    const entries=Object.values(job.checkpoint.concepts??{}),audits=entries.map(e=>e.factAudit).filter(Boolean),facts=new Set(entries.flatMap(activeFacts).map(f=>f.id));
    const canonical=q=>resolveFactId(entries.find(e=>e.materialKey===q.materialKey)??{},q.factId);
    const covered=new Set(this.baseBank(user).questions.filter(q=>q.status!=='rejected'&&['recall','understand'].includes(q.strategy)&&facts.has(canonical(q))).map(canonical));
    const native=isNativeEngine(job.plan.engine),rectify=native?{state:job.checkpoint.engineState.complete?'completed':state==='running'?'running':'pending',admitted:done,total:done,pending:0,repairPending:0,rewritten:0}:rectifySummary(job.checkpoint);
    return {id:job.id,state,resumable:canResumeEngine(job),phase:state==='paused'?'paused':job.checkpoint.phase,done,total:job.plan.count,remaining:Math.max(0,job.plan.count-rectify.admitted),engineLabel:engineLabel(job.plan.engine),
      createdAt:job.createdAt,updatedAt:job.updatedAt,observedAt:Date.now(),elapsedMs,perMinute:elapsedMs>0?done*60000/elapsedMs:0,
      etaMs:done>=2 && done<job.plan.count ? elapsedMs/done*(job.plan.count-done):null,
      upstream:active?runtime.upstream??null:null,currentTask:job.checkpoint.currentTask,plan:publicPlan(job.plan),problems:job.problems??[],
      concurrency:(job.workers??[]).reduce((sum,row)=>sum+row.workers,0)||1,workers:(runtime?.job.id===job.id?runtime.generator?.workers:null)??job.workerStats??job.workers??[],
      activeTasks:active?job.checkpoint.tasks.flatMap((step,index)=>step.state==='running'?[index]:[]):[],
      compiledNodes:Object.keys(job.checkpoint.engineState?.compileCache?.nodes??{}).length,cachedBatches:Object.keys(job.checkpoint.engineState?.batches??{}).length,
      cachedRewrites:Object.keys(job.checkpoint.rewrites).length,cachedDrafts:job.checkpoint.tasks.reduce((sum,t)=>sum+Math.max(0,(t.drafts?.length??0)-t.cursor),0),
      reusedRewrites:job.checkpoint.reusedRewrites??0,reusedDrafts:job.checkpoint.reusedDrafts??0,
      factCoverage:{ready:facts.size,covered:covered.size,rejectedPositions:audits.reduce((n,a)=>n+a.rejected.length,0),sourceConflicts:audits.reduce((n,a)=>n+a.conflicts.length,0),unconfirmedChecks:audits.reduce((n,a)=>n+(a.warnings?.length??0),0)},
      completion:{checked:Object.values(job.checkpoint.completions??{}).filter(s=>s.status==='completed').length,
        addedConcepts:Object.values(job.checkpoint.completions??{}).filter(s=>!s.reused).reduce((n,s)=>n+(s.result?.addedConceptIds?.length??0),0),
        addedPositions:Object.values(job.checkpoint.completions??{}).filter(s=>!s.reused).reduce((n,s)=>n+(s.result?.addedBlankIds?.length??0),0)},
      // 统一整改：最后一步把本次挂账的题和题库原有题放在一起查重，判掉的题仍留在题库里（status='rejected'）。
      rectify,
      tasks:job.plan.tasks.map((task,index)=>{const step=job.checkpoint.tasks[index],needsRepair=step.questionIds.some(id=>job.checkpoint.rectify?.decisions?.[id]);return {ticketId:step.assignment?.id??`question-${index+1}`,focus:step.assignment?.focus??step.focus,angle:step.assignment?.angle??step.angle,phase:step.phase,pointId:task.point.id,courseId:task.point.courseId,subId:task.point.subId,lessonTitle:task.point.lessonTitle,conceptId:step.assignment?.conceptId,repair:step.repair?.round??0,title:task.point.title,courseTitle:task.point.courseTitle,type:step.repair?.type??task.type,strategy:task.strategy,total:task.count,
        done:needsRepair?0:step.questionIds.length,state:needsRepair?'needs-repair':step.questionIds.length>=task.count?'completed':step.state,error:step.error,...(step.actualTask??{})};})};
  }
  status(user,id=null) {
    const bank=this.baseBank(user),runtime=this.runs.get(String(user.id));
    const jobs=bank.generationJobs;
    const selected=id?jobs.find(job=>job.id===id):runtime&&!runtime.finished?runtime.job:jobs.at(-1);
    if(id&&!selected)throw fault('NOT_FOUND','找不到出题批次');
    return {run:this.view(selected,user),runs:jobs.map(job=>this.view(job,user))};
  }
  async start(payload,user,signal,resume=false) {
    if(this.owner.configBusy)throw fault('BUSY','配置正在保存，请稍后出题');
    const key=String(user.id),existing=this.runs.get(key);
    if(this.starting.has(key)||existing&&!existing.finished)throw fault('BUSY','已有出题批次正在运行');
    this.starting.add(key);
    try{
      const generator=this.owner.quizOf();
      if(!generator?.generatePoints)throw fault('NOT_WIRED','知识点出题尚未接入');
      let plan;
      if(!resume){
        if(!Array.isArray(payload.pointIds)||!payload.pointIds.length||payload.pointIds.length>1000||new Set(payload.pointIds).size!==payload.pointIds.length)throw fault('INPUT','请选择知识点');
        const catalog=await this.catalog(user,signal),points=payload.pointIds.map(id=>catalog.find(p=>p.id===id));
        if(points.some(point=>!point))throw fault('INPUT','知识点已更新，请刷新选择');
        // 收起来的引擎只保留「读旧断点」的能力，新批次在这里拦下。
        // 闸放在产品边界而不是内核 planEngineQuestions：内核是纯规划函数，
        // r1/r3 的算法自身仍需要能被规划、被测试；把「产品是否还开放它」
        // 塞进内核会让算法失去可测性，也会让旧断点的语义变得含混。
        if(payload.engine!==undefined&&!isSelectableEngine(payload.engine))throw fault('INPUT','该出题引擎已停用，请改用 DeepTutor 直调');
        // 预检也要跟实际后端一致：走重构版时不依赖 DeepTutor 服务，
        // 拿它当门槛会让「Python 没装 pydantic」这种事挡住一个纯 JS 实现。
        if(['deeptutor','deeptutor-native'].includes(payload.engine)&&NATIVE_BACKEND!=='core-question'&&(!this.owner.deepTutorOf?.()||!this.owner.learningResourceOf?.()))throw fault('NOT_WIRED','DeepTutor 服务未就绪');
        plan=planEngineQuestions(points,{...payload,engine:payload.engine??DEFAULT_ENGINE});
        if(plan.engine==='r3-v9')plan.sourceGraph=selectedQuizGraph(this.records(user),plan.mode==='random'?[...new Map(plan.tasks.map(t=>[t.point.id,t.point])).values()]:points);
      }
      if(String((await this.owner.user()).id)!==key)throw fault('SESSION_EXPIRED','账号已切换');
      const job=await this.transaction(user,signal,async bank=>{
        let job;
        if(resume){
          job=bank.generationJobs.find(job=>job.id===payload.runId);
          if(!job)throw fault('NOT_FOUND','出题批次不存在');
          if(!canResumeEngine(job))throw fault('CHECKPOINT_VERSION','断点版本已变化');
          if(engineComplete(job)&&job.checkpoint.phase==='completed'){job.state='completed';await this.save(bank);return structuredClone(job);}
        }else{
          const selection=payload.workers??this.owner.effectiveWorkers('quiz');
          const workers=payload.workers!==undefined?normalizeWorkers(payload.workers):selection.length?normalizeWorkers(selection):[];
          if(workers.length&&!generator.createRun)throw fault('NOT_WIRED','出题 worker 池尚未接入');
          job={id:randomUUID(),state:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),elapsedMs:0,plan,workers,
            checkpoint:newEngineCheckpoint(plan),problems:[]};bank.generationJobs.push(job);
        }
        job.state='running';job.updatedAt=new Date().toISOString();job.problems=[];await this.save(bank);return structuredClone(job);
      });
      if(engineComplete(job)&&job.checkpoint.phase==='completed')return {run:this.view(job,user),plan:publicPlan(job.plan)};
      this.launch(job,user,generator);
      return {run:this.view(job,user),plan:publicPlan(job.plan)};
    }finally{this.starting.delete(key);}
  }
  launch(job,user,generator) {
    const key=String(user.id),runtime={job,controller:new AbortController(),baseElapsed:job.elapsedMs??0,startedAt:Date.now(),finished:false,done:null};
    this.runs.set(key,runtime);
    const checkpoint=async(saved,question=null)=>{
      await this.transaction(user,runtime.controller.signal,async(bank,signal)=>{
        signal.throwIfAborted();
        const stored=bank.generationJobs.find(row=>row.id===job.id);
        if(!stored)throw fault('NOT_FOUND','出题批次不存在');
        if(question&&!bank.questions.some(q=>q.id===question.id))bank.questions.push({...question,generationEngine:job.plan.engine??'local'});
        stored.checkpoint=structuredClone(saved);stored.elapsedMs=runtime.baseElapsed+Date.now()-runtime.startedAt;stored.updatedAt=new Date().toISOString();
        await this.save(bank);runtime.job=structuredClone(stored);
      },{archive:false});
    };
    runtime.done=(async()=>{
      let result,error;
      try{
        const bank=this.bank(user);
        // 需要 worker 池的引擎：`deeptutor`（历史候选路径）+ 原生引擎 + 任何声明 native 的注册引擎。
        // ⚠️ 必须显式保留 `deeptutor`：它走的是候选生成路径，`isNativeEngine` 对它为假，
        //    但旧白名单里一直有它。只靠 isNativeEngine 会把它漏掉，于是用户可以不带
        //    worker 发起一个必然缺池的批次。
        if((job.plan.engine==='deeptutor'||isNativeEngine(job.plan.engine))&&!job.workers?.length)throw fault('INPUT','请选择出题使用的供应商、模型和 worker 数');
        const pool=job.workers?.length?new WorkerPoolLlm({base:this.owner.parser.llm,entries:job.workers}):null;
        const candidateCall=job.plan.engine==='deeptutor'?createDeepTutorCandidateCall({tutor:this.owner.deepTutorOf?.(),resources:this.owner.learningResourceOf?.(),pool,scope:key,
          points:job.plan.tasks.map(task=>task.point),onProgress:({pointId,event})=>{if(['exploring','planning','quizzing'].includes(event.stage))runtime.upstream={pointId,stage:event.stage,at:Date.now()};}}):null;
        runtime.generator=job.plan.engine==='r3-v9'?createTreeQuizRun({pool,records:this.records(user),graph:job.plan.sourceGraph,cache:[...bank.generationJobs].reverse().find(row=>row.id!==job.id&&row.plan.engine==='r3-v9'&&row.checkpoint.engineState?.compileCache)?.checkpoint.engineState}):
          job.plan.engine==='deeptutor-native'?createNativeQuizRun({pool,tutor:this.owner.deepTutorOf(),resources:this.owner.learningResourceOf(),scope:key,onProgress:({pointId,event})=>{runtime.upstream={pointId,stage:event.stage,at:Date.now()};}}):
          // 外部引擎（如 dsh-zhiyun-quiz-lab 的 r4-lab）：查注册表，拿到工厂就交给它。
          // hosts 只含计算资源，落库仍由本文件的 onCheckpoint / onQuestion 完成。
          !isBuiltinEngine(job.plan.engine)&&registeredEngines().some(row=>row.id===job.plan.engine)?
            registeredEngines().find(row=>row.id===job.plan.engine).createRun({pool,records:this.records(user),graph:job.plan.sourceGraph,concurrency:pool?.concurrency,bankQuestion:bankNormalize}):
          pool?generator.createRun({pool,candidateCall,engine:job.plan.engine}):job.plan.engine==='r1'?{generatePoints:generator.generateR1Points}:generator;
        if(typeof runtime.generator.generatePoints!=='function')throw fault('NOT_WIRED','所选出题引擎尚未就绪');
        result=await runtime.generator.generatePoints({plan:job.plan,checkpoint:job.checkpoint,signal:runtime.controller.signal,
          runId:job.id,
          existingStems:bank.questions.map(q=>q.stem),existingQuestions:bank.questions,conceptCache:bank.conceptCache,
          onConcept:async(cacheKey,entry)=>this.transaction(user,runtime.controller.signal,async(bank,signal)=>{signal.throwIfAborted();bank.conceptCache[cacheKey]=entry;await this.save(bank);},{archive:false}),
          onCheckpoint:saved=>checkpoint(saved),onQuestion:(question,saved)=>checkpoint(saved,question),
          // 统一整改判掉的题不删除，只把库里那条记录的 status 改成 rejected —— 挂账痕迹留着才知道「为什么少一道」。
          onRectify:async({rejected,admitted=[],pending=[],checkpoint:saved})=>{
            await this.transaction(user,runtime.controller.signal,async(bank,signal)=>{
              signal.throwIfAborted();
              const at=new Date().toISOString();
              for(const row of rejected){
                const stored=bank.questions.find(q=>q.id===row.id);
                if(!stored)continue;
                stored.status='rejected';stored.reviewState='rejected';stored.rectifyReason=row.reason;stored.rectifiedAt=at;
              }
              for(const id of admitted){const q=bank.questions.find(q=>q.id===id);if(q&&q.status!=='rejected')q.reviewState='ready';}
              for(const id of pending){const q=bank.questions.find(q=>q.id===id);if(q&&q.status!=='rejected')q.reviewState='needs-review';}
              if(saved){const stored=bank.generationJobs.find(row=>row.id===job.id);stored.checkpoint=structuredClone(saved);runtime.job=structuredClone(stored);}
              await this.save(bank);
            },{archive:false});
          }});
      }catch(cause){error=cause;}
      try{
        await this.transaction(user,null,async bank=>{
          const stored=bank.generationJobs.find(row=>row.id===job.id);if(!stored)return;
          const aborted=runtime.controller.signal.aborted;
          stored.state=aborted?'paused':error?'failed':engineComplete(stored)?'completed':'partial';
          // 真实错误必须上屏。旧写法 `result?.problems ?? [一句通用话术]` 把 error 整个吞掉：
          // 用户只看到「出题已暂停或未完成」，而真正的原因（能力未就绪 / 上游崩溃 / 未选供应商）
          // 只活在内存里，随进程消失。deeptutor-native 那几次 259ms 失败就是这样查不出原因的。
          stored.problems=result?.problems??batchProblems(error,aborted);
          stored.elapsedMs=runtime.baseElapsed+Date.now()-runtime.startedAt;stored.updatedAt=new Date().toISOString();
          stored.workerStats=runtime.generator?.workers??[];
          if(stored.state==='paused')stored.checkpoint.phase='paused';
          await this.save(bank);runtime.job=structuredClone(stored);
        },{final:true,archive:false});
      }catch{ /* The last atomic checkpoint remains resumable if storage itself is unavailable. */ }
      finally{if(runtime.generator!==generator)runtime.generator?.dispose?.();runtime.finished=true;}
    })();
  }
  async pause(user,id) {
    const runtime=this.runs.get(String(user.id));
    if(runtime&&!runtime.finished&&(!id||runtime.job.id===id)){runtime.controller.abort();await runtime.done;}
    return this.status(user,id);
  }
  async stopAll() {
    for(const runtime of this.runs.values())if(!runtime.finished)runtime.controller.abort();
    await Promise.allSettled([...this.runs.values()].map(runtime=>runtime.done));
    await Promise.allSettled([...this.writes.values()]);
  }
  async save(bank) { await this.owner.knowledge.saveQuestionBank(bank); }
  /**
   * 出题引擎是否真的能用。
   *
   * ⚠️ 旧实现只判「服务对象在不在」（`Boolean(deepTutorOf?.() && learningResourceOf?.())`），
   * 于是 Python 没装、依赖缺失、桥崩溃时按钮**照旧可点**，`· 未就绪` 永远不会出现；
   * 用户点下去，等一会儿，拿到的是一句被吞掉的错误。这里改为向宿主问一次运行状态，
   * 并把不可用的原因一并带出去 —— 界面能写原因，用户才知道该去装什么。
   */
  async engineCatalog(){
    let ready=false,reason='';
    // 就绪判定必须跟着**实际会用哪个后端**走。
    //
    // 重构版（core-question）是纯 JS、零第三方依赖，只需要模型可用；
    // 它根本不会去起 Python 子进程。若这里仍拿 vendor 的 status() 当门槛，
    // 用户会看到「DeepTutor 直调 · 未就绪 / No module named 'pydantic'」——
    // 报的是一个跟当前实现毫无关系的原因（2026-10-31 实测就是这个现象）。
    if(NATIVE_BACKEND==='core-question'){
      // 只要宿主能拿到模型路由就算就绪；拿不到才拦。
      const selection=this.owner.effectiveWorkers?.('quiz')??[];
      if(selection.length){
        ready=true;
      }else{
        const routes=this.owner.parser?.llm?.routes??{};
        const fallback=routes.text??routes.vision??null;
        if(fallback?.provider&&fallback?.model)ready=true;
        else reason='未选择出题模型，请先在「生成模型」里选一个';
      }
    }else if(this.owner.deepTutorOf?.()&&this.owner.learningResourceOf?.()){
      try{
        const status=await this.owner.deepTutorOf().status();
        // 宿主用 warnings 说明为何不可用（未装 Python / 依赖缺失 / 桥崩溃…）。
        ready=status?.state==='ready';
        if(!ready)reason=(status?.warnings??[])[0]??`DeepTutor 状态为 ${status?.state??'未知'}`;
      }catch(error){reason=error?.message??'DeepTutor 状态未知';}
    }else reason='DeepTutor 服务未安装';
    // 只列出**仍可发起新批次**的引擎。收起来的那些仍在 engineEntries() 里
    // （老断点要靠它查版本号），但不该出现在新建下拉里。
    return selectableEngines().map(row=>({...row,available:row.id!=='deeptutor-native'||ready,...(row.id==='deeptutor-native'&&reason?{reason}:{})}));
  }
  async invoke(method,payload,user,signal) {
    if(method==='bank-progress')return this.status(user,payload.runId);
    if(method==='bank-pause')return this.pause(user,payload.runId);
    if(method==='bank-resume')return this.start(payload,user,signal,true);
    if(method==='bank-generate')return this.start(payload,user,signal);
    if (method==='bank-catalog') return {points:(await this.catalog(user,signal)).map(({text,...point})=>point),defaultEngine:DEFAULT_ENGINE,engines:await this.engineCatalog()};
    return this.transaction(user,signal,async(bank,signal)=>{
      if (method==='bank-load') {
        if (bank.questions.length!==this.owner.knowledge.questionBank(String(user.id)).questions.length) await this.save(bank);
        return {questions:bank.questions,sessions:bank.sessions,coverage:coverageOf(bank),...this.status(user)};
      }
      if (method==='bank-practice') {
        if (payload.pointIds!=null && (!Array.isArray(payload.pointIds)||payload.pointIds.some(id=>typeof id!=='string'))) throw fault('INPUT','练习范围无效');
        const chosen=planPractice(bank.questions,payload);
        if (!chosen.length) throw fault('NO_QUESTIONS','当前模式没有可练习的题目');
        const session={id:randomUUID(),mode:payload.mode ?? 'new',freshRatio:payload.freshRatio??null,requested:payload.count ?? 10,questionIds:chosen.map(q=>q.id),createdAt:new Date().toISOString(),answers:[]};
        for (const q of chosen) q.status='accepted'; // Explicitly starting practice adopts those drafts.
        bank.sessions.push(session);await this.save(bank);
        return {session,questions:chosen,available:chosen.length,requested:payload.count ?? 10};
      }
      if (method==='bank-answer') {
        const session=bank.sessions.find(s=>s.id===payload.sessionId),question=bank.questions.find(q=>q.id===payload.questionId);
        if (!session || !question || !session.questionIds.includes(question.id)) throw fault('NOT_FOUND','找不到本次练习的题目');
        const previous=session.answers.find(a=>a.questionId===question.id);
        if (previous) return {attempt:previous,answer:question.answer,explanation:question.explanation,basis:question.basis};
        if (typeof payload.response!=='string' || payload.response.length>5000) throw fault('INPUT','作答内容无效');
        const blanks=[...question.stem.matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g)].map(m=>m[1]);
        const actual=question.type==='mcq' ? question.answer : blanks.length ? blanks.join(';') : question.answer;
        const response=payload.response.replace(/[；|]/g,';');
        const correct=[actual,...(question.acceptedAnswers??[])].some(answer=>normalize(response)===normalize(answer));
        if(question.type==='shortAnswer'&&!['correct','incorrect','partial'].includes(payload.selfVerdict))throw fault('INPUT','请对照参考答案选择自评结果');
        const attempt={id:randomUUID(),questionId:question.id,sessionId:session.id,response:payload.response,verdict:question.type==='shortAnswer'?payload.selfVerdict:correct?'correct':'incorrect',grading:question.type==='shortAnswer'?'self':'exact',at:new Date().toISOString()};
        (question.attempts??=[]).push(attempt);session.answers.push(attempt);
        if (session.answers.length===session.questionIds.length) session.finishedAt=new Date().toISOString();
        await this.save(bank);
        return {attempt,answer:question.answer,explanation:question.explanation,basis:question.basis,rubric:question.rubric??[]};
      }
      if (method==='bank-discard') {
        const ids=payload.questionIds??[payload.questionId];
        if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw fault('INPUT','请选择有效且不重复的题目');
        const questions=ids.map(id=>bank.questions.find(q=>q.id===id));if(questions.some(q=>!q))throw fault('NOT_FOUND','部分题目已不存在，请刷新');
        const at=new Date().toISOString();for(const q of questions){q.status='rejected';q.discardedAt=at;q.discardReason='user';}
        await this.save(bank);return {questions:bank.questions,sessions:bank.sessions};
      }
      if(method==='bank-curate'){
        if(this.starting.has(String(user.id))||this.runs.get(String(user.id))&&!this.runs.get(String(user.id)).finished)throw fault('BUSY','请先暂停出题，再修订考点');
        const entry=bank.conceptCache[payload.materialKey];if(!entry)throw fault('NOT_FOUND','考点底稿不存在');
        const updated=curateFacts(entry,payload);
        bank.conceptCache[payload.materialKey]=updated;
        // Paused jobs must see the same correction when they resume their saved draft cursor.
        for(const job of bank.generationJobs)if(job.checkpoint?.concepts?.[payload.materialKey])job.checkpoint.concepts[payload.materialKey]=structuredClone(updated);
        await this.save(bank);return {questions:bank.questions,sessions:bank.sessions};
      }
      throw fault('INPUT','未知题库操作');
    });
  }
}
