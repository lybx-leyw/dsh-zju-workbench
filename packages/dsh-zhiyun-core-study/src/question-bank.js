import { itemFromJson, itemToJson } from 'dsh-zhiyun-core-quiz/model';
import { randomUUID } from 'node:crypto';
import {createDeepTutorCandidateCall} from './deeptutor-quiz.js';
import {createTreeQuizRun,createNativeQuizRun,selectedQuizGraph} from './quiz-engine-runtime.js';
import {QUIZ_ENGINES,planEngineQuestions,newEngineCheckpoint,canResumeEngine,engineComplete,isNativeEngine,engineLabel} from 'dsh-zhiyun-core-quiz/engines';
import {normalizeWorkers,WorkerPoolLlm} from 'dsh-zhiyun-core-parser/worker-pool';
import { knowledgePoints, planPractice, checkpointCount,activeFacts,resolveFactId,curateFacts,rectifySummary } from 'dsh-zhiyun-core-quiz/points';

const fault = (code,message) => Object.assign(new Error(message),{code});
const codeOf = value => typeof value === 'string' ? value : value?.code;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
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
    return {id:job.id,state,resumable:canResumeEngine(job),phase:state==='paused'?'paused':job.checkpoint.phase,done,total:job.plan.count,remaining:job.plan.count-done,engineLabel:engineLabel(job.plan.engine),
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
        done:needsRepair?0:step.questionIds.length,state:needsRepair?'needs-repair':step.questionIds.length>=task.count?'completed':step.state,error:step.error};})};
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
        if(['deeptutor','deeptutor-native'].includes(payload.engine)&&(!this.owner.deepTutorOf?.()||!this.owner.learningResourceOf?.()))throw fault('NOT_WIRED','DeepTutor 服务未就绪');
        plan=planEngineQuestions(points,payload);
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
        if(['deeptutor','deeptutor-native','r3-v9'].includes(job.plan.engine)&&!job.workers?.length)throw fault('INPUT','请选择出题使用的供应商、模型和 worker 数');
        const pool=job.workers?.length?new WorkerPoolLlm({base:this.owner.parser.llm,entries:job.workers}):null;
        const candidateCall=job.plan.engine==='deeptutor'?createDeepTutorCandidateCall({tutor:this.owner.deepTutorOf?.(),resources:this.owner.learningResourceOf?.(),pool,scope:key,
          points:job.plan.tasks.map(task=>task.point),onProgress:({pointId,event})=>{if(['exploring','planning','quizzing'].includes(event.stage))runtime.upstream={pointId,stage:event.stage,at:Date.now()};}}):null;
        runtime.generator=job.plan.engine==='r3-v9'?createTreeQuizRun({pool,records:this.records(user),graph:job.plan.sourceGraph,cache:[...bank.generationJobs].reverse().find(row=>row.id!==job.id&&row.plan.engine==='r3-v9'&&row.checkpoint.engineState?.compileCache)?.checkpoint.engineState}):
          job.plan.engine==='deeptutor-native'?createNativeQuizRun({pool,tutor:this.owner.deepTutorOf(),resources:this.owner.learningResourceOf(),scope:key,onProgress:({pointId,event})=>{runtime.upstream={pointId,stage:event.stage,at:Date.now()};}}):
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
          stored.state=runtime.controller.signal.aborted?'paused':error?'failed':engineComplete(stored)?'completed':'partial';
          stored.problems=result?.problems??(error?['出题已暂停或未完成，已保存的题目和断点仍然保留。']:[]);
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
  async invoke(method,payload,user,signal) {
    if(method==='bank-progress')return this.status(user,payload.runId);
    if(method==='bank-pause')return this.pause(user,payload.runId);
    if(method==='bank-resume')return this.start(payload,user,signal,true);
    if(method==='bank-generate')return this.start(payload,user,signal);
    if (method==='bank-catalog') return {points:(await this.catalog(user,signal)).map(({text,...point})=>point),defaultEngine:'r1',engines:QUIZ_ENGINES.map(row=>({...row,available:row.id!=='deeptutor-native'||Boolean(this.owner.deepTutorOf?.()&&this.owner.learningResourceOf?.())}))};
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
