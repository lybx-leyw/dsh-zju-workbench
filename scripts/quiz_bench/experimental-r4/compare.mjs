/** Four-arm real-model comparison. Credentials stay in memory; outputs are local. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
import {runR4} from './run.mjs';
import {createToolTransport as createR4ToolTransport} from './tools.mjs';
import {compileIdeas} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/compiler.mjs';
import {createScheduler} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/scheduler.mjs';
import {createQuestionGenerator} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/generator.mjs';
import {createCapsuleStore} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/capsules.mjs';
import {reserveWithExpansion} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/expansion.mjs';
import {createToolTransport} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tools.mjs';
import {inspectGraph} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/graph.mjs';
import {createPointQuizGenerator,planPointQuestions} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r1/points.mjs';
import {deepTutorBenchHost} from '../deeptutor-host.mjs';
import {runDeepTutorBench} from '../deeptutor.mjs';
import {tokenLedger,timingLedger} from '../accounting.mjs';
import {poolLimit} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/common.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const write=(file,value)=>writeFileAtomic(file,JSON.stringify(value,null,2),{mode:0o600});
const readJson=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}};

/**
 * 评测指纹：决定「目录里的旧结果能不能和新一次跑拼到同一份报告里」。
 *
 * 只收影响可比性的字段（资料、模型、臂、并发、批次、预算），不收时间戳。
 * 指纹不一致时**拒绝续跑**，而不是把两次不同条件的跑混成一份报告。
 */
export const runFingerprint=(spec,credentials)=>hash(JSON.stringify({
 cases:spec.cases.map(c=>c.id).sort(),arms:spec.arms??['r1','native','r3-verified','r4'],
 concurrencies:spec.concurrencies??[1,2],batches:spec.batches??[2,2],
 model:credentials.model,maxCalls:spec.maxCalls??60,r3Scope:spec.r3Scope??'all',
}));
export async function kernelHashes(){
 const files={};
 async function visit(dir){for(const row of await fs.readdir(dir,{withFileTypes:true})){if(row.name==='__pycache__')continue;const file=dir+'/'+row.name;if(row.isDirectory())await visit(file);else if(/\.(mjs|js|py|json|ya?ml)$/.test(row.name))files[file]=hash(await fs.readFile(file));}}
 for(const dir of ['scripts/quiz_bench/experimental-r4','packages/dsh-zhiyun-core-quiz/src','packages/dsh-zhiyun-host-deeptutor/src','packages/dsh-zhiyun-host-deeptutor/python','packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor'])await visit(dir);
 for(const file of ['scripts/quiz_bench/deeptutor.mjs','scripts/quiz_bench/deeptutor-host.mjs','scripts/quiz_bench/accounting.mjs','packages/dsh-zhiyun-core-parser/src/worker-pool.js','packages/dsh-zhiyun-core-study/src/deeptutor-quiz.js'])files[file]=hash(await fs.readFile(file));
 return files;
}
export const deliveredQuestions=result=>{
 if(Array.isArray(result?.results))return result.results.flatMap(r=>r.questions??[]);
 if(result?.checkpoint?.questions){const active=new Set(result.checkpoint.tasks.flatMap(t=>t.questionIds));return Object.values(result.checkpoint.questions).filter(q=>active.has(q.id)&&q.reviewState==='ready'&&q.status!=='rejected');}
 return result?.questions??[];
};
export const normalizeQuestion=q=>{
 const raw=q.choices??q.options??[],choices=Array.isArray(raw)?raw:Object.entries(raw).map(([label,value])=>typeof value==='string'?{label,text:value}:{...value,label});
 return {...q,type:q.type==='single_choice'?'mcq':q.type,choices:choices.map((c,i)=>typeof c==='string'?{label:'ABCD'[i],text:c}:{label:c.label??c.key??'ABCD'[i],text:c.text??c.content??c.value}),answer:String(q.answer??'')};
};
export async function runComparison({spec,out,credentials,onProgress=()=>{},resume=false}){
 const dir=path.resolve(out),root=path.resolve('artifacts');if(!dir.startsWith(root+path.sep))throw Error('Output must be a fresh directory under artifacts');
 await fs.mkdir(dir,{recursive:true});
 // 续跑：目录里已有产物时，只在指纹一致的前提下继续。
 // 旧实现的 `if ((await fs.readdir(dir)).length) throw` 让任何一次中途崩溃都变成
 // 「整份产物作废、必须重花一遍钱」—— 这正是授权一次实跑时最不能接受的失败模式。
 const existing=(await fs.readdir(dir)).filter(name=>name!=='run.log');
 if(existing.length&&!resume)throw Error('Comparison output must be empty (or pass resume=true to continue an interrupted run)');
 const arms=spec.arms??['r1','native','r3-verified','r4'],concurrencies=spec.concurrencies??[1,2],batches=spec.batches??[2,2];
 if(!arms.length||new Set(arms).size!==arms.length||arms.some(a=>!['r1','native','r3-verified','r3-raw-v9','r4'].includes(a))||!concurrencies.length||concurrencies.some(n=>!Number.isInteger(n)||n<1||n>8)||!batches.length||batches.some(n=>!Number.isInteger(n)||n<1||n>20)||!Array.isArray(spec.cases)||!spec.cases.length||new Set(spec.cases.map(c=>c.id)).size!==spec.cases.length||spec.cases.some(c=>!/^[-\w]{1,64}$/.test(c.id))||!Number.isInteger(spec.maxCalls??60)||(spec.maxCalls??60)<1||!['local','all'].includes(spec.r3Scope??'all'))throw Error('Invalid comparison configuration');
 const prepared=[];
 for(const c of spec.cases){const graph=JSON.parse(await fs.readFile(c.source,'utf8')),leaves=[...inspectGraph(graph).leaves.values()];
  const points=leaves.map(n=>({...n.point,id:n.point?.id??n.id,title:n.title,text:n.text+'\n'+(n.pages??[]).map(p=>`[page ${p.page}] ${p.text??''}\n${p.visual??''}`).join('\n'),courseId:c.id,subId:'bench',courseTitle:graph.root.title,lessonTitle:graph.root.title}));
  const dataset={id:c.id,title:graph.root.title,points};await write(path.join(dir,c.id+'-source.json'),dataset);await write(path.join(dir,c.id+'-graph.json'),graph);prepared.push({...c,graph,points,leaves,dataset});}
 const manifest={version:1,kind:spec.kind??'development',model:credentials.model,thinking:'disabled',startedAt:new Date().toISOString(),arms,concurrencies,batches,maxCallsPerSession:spec.maxCalls??60,
  fairness:{sameMaterialAndPages:true,primary:'understand mcq; native planning remains native',r3Scope:spec.r3Scope??'all',r4Scope:'local only; compositeCount=0',cold:'empty state per algorithm/corpus/concurrency',warm:'same session state; native retains history and disk home but restarts Python service',r3:'verified is the current product capsule+blind path; raw-v9 is explicitly a separate control, never pooled',time:'observed wall time including preparation, retries, tool repair and local persistence; never divide by workers',tokens:'provider receipts including failed/invalid generations, subset tokens not double counted',variation:'one stochastic run per setting; concurrency comparisons are descriptive, not causal estimates'},
  cases:prepared.map(c=>({id:c.id,title:c.graph.root.title,sourceKind:c.kind??'authored',materialHash:hash(JSON.stringify(c.graph)),points:c.points.length})),kernel:await kernelHashes(),runs:[]};
 // 续跑时继承旧 manifest 的 fingerprint 与已完成 runs；指纹不一致直接拒绝，
 // 免得把两次不同条件的跑拼成一份看起来可比、其实不可比的报告。
 const previous=resume?await readJson(path.join(dir,'manifest.json')):null;
 const fingerprint=runFingerprint(spec,credentials);
 if(previous){
  if(previous.fingerprint&&previous.fingerprint!==fingerprint)throw Error('续跑目录的评测指纹与本次不一致（资料/模型/臂/并发/批次变了），请换一个新目录');
  manifest.fingerprint=previous.fingerprint??fingerprint;
  manifest.runs=[...(previous.runs??[])];
  manifest.startedAt=previous.startedAt??manifest.startedAt;
  manifest.resumedAt=new Date().toISOString();
 }else manifest.fingerprint=fingerprint;
 await write(path.join(dir,'manifest.json'),manifest);
 const all=[];
 for(const [ci,c]of prepared.entries())for(const [wi,workers]of concurrencies.entries()){
  const sessions=new Map();
  for(const arm of arms){const home=path.join(dir,`${c.id}-${arm}-c${workers}`);await fs.mkdir(home,{recursive:true});
   // 断点续跑的核心：把上一次已经付过钱的调用回执、事件流水与引擎状态从磁盘读回来。
   // 旧实现每个臂都用 `state:{}` 起跑 —— 于是「崩溃后续跑」等于重花一遍全部调用，
   // 落盘的 state.json 只是摆设。calls/events 必须一起恢复，否则 token 账本会把
   // 续跑后的累计成本算成只有第二次的量。
   const calls=(await readJson(path.join(home,'calls.json')))??[];
   const events=(await readJson(path.join(home,'attempts.json'))??[])??[];
   const stages=(await readJson(path.join(home,'stages.json')))??[];
   const restored=resume?await readJson(path.join(home,'state.json')):null;
   let chain=Promise.resolve();
   const save=(file,value)=>{const copy=structuredClone(value);chain=chain.then(()=>write(path.join(home,file),copy));return chain;};
   const host=deepTutorBenchHost({...credentials,maxCalls:spec.maxCalls??60,requestTimeoutMs:spec.requestTimeoutMs??120000,onCall:r=>{calls.push(r);return save('calls.json',calls);},onAttempt:e=>{events.push(e);return save('attempts.json',events);}});
   const transport=(arm==='r4'?createR4ToolTransport:createToolTransport)(host),limit=poolLimit(workers),call=request=>limit(async()=>{stages.push({stage:request.stage,at:Date.now()});onProgress({event:'call',case:c.id,arm,workers,stage:request.stage});await save('stages.json',stages);
    if(arm!=='r1')return transport(request);
    const prepared=await host.prepareCall({},request.signal);let text='';for await(const b of prepared.stream({messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal}))if(b.type==='text-delta')text+=b.text;return {text};});
   sessions.set(arm,{home,calls,events,stages,host,call,save,flush:()=>chain,state:restored??{},concepts:(await readJson(path.join(home,'concepts.json')))??{},history:(await readJson(path.join(home,'history.json')))??[],nativeCalls:0});}
  const order=arms.map((_,i)=>arms[(i+ci+wi)%arms.length]);
  // 已完成的运行（按 id）直接从 manifest 继承：崩溃前跑完的批次不再重花一遍钱。
  const doneIds=new Set((manifest.runs??[]).filter(row=>!row.error).map(row=>row.id));
  for(const [batch,count]of batches.entries())for(const arm of batch?[...order].reverse():order){
   const s=sessions.get(arm),id=`${c.id}-${arm}-c${workers}-${batch?'warm'+batch:'cold'}`,started=Date.now(),receiptStart=s.calls.length,eventStart=s.events.length;
   if(resume&&doneIds.has(id)){
    // 冷启动批次没有前序历史，必须把它的题补给 warm 批次，否则同单元后续批次会「忘掉」已有题。
    const saved=await readJson(path.join(dir,id+'.json'));
    if(saved){s.history.push(...deliveredQuestions(saved.result).map(normalizeQuestion));onProgress({event:'skip-completed',id});continue;}
   }
   let result,error,tokens,timing;const arrivals=new Map(),progress=e=>{if(e.phase==='question-ready')arrivals.set(e.ticketId,Date.now()-started);};const signal=AbortSignal.timeout(spec.wallBudgetMs??600000);
   onProgress({event:'start',id});
   try{
    if(arm==='r4')result=await runR4({graph:c.graph,pointIds:c.points.map(p=>p.id),count,requestId:id,call:s.call,state:s.state,concurrency:workers,signal,maxCalls:spec.maxCalls??60,maxExpansions:1,onProgress:progress,onCheckpoint:async state=>{await s.save('state.json',state);s.state=state;}});
    else if(arm==='r1'){
     // r1 的恢复靠 checkpoint-<batch>.json；旧实现每次都用全新 checkpoint 起跑，
     // 断点文件写了却没人读，等于每次续跑都把这一批重买一遍。
     const resumeState=resume?await readJson(path.join(s.home,'checkpoint-'+batch+'.json')):null;
     const plan=await readJson(path.join(s.home,'plan-'+batch+'.json'))??planPointQuestions(c.points,{count,types:['mcq'],strategies:[{id:'understand',weight:1}]},()=>0.37);
     await s.save('plan-'+batch+'.json',plan);
     result=await createPointQuizGenerator({call:s.call,random:()=>0.37})({plan,checkpoint:resumeState??undefined,signal,concurrency:workers,existingQuestions:s.history,existingStems:s.history.map(q=>q.stem),conceptCache:s.concepts,onConcept:async(k,e)=>{s.concepts[k]=e;await s.save('concepts.json',s.concepts);},onCheckpoint:state=>s.save('checkpoint-'+batch+'.json',state),onQuestion:(q,state)=>{arrivals.set(q.id,Date.now()-started);return s.save('checkpoint-'+batch+'.json',state);},onRectify:({checkpoint})=>s.save('checkpoint-'+batch+'.json',checkpoint)});
    }else if(arm.startsWith('r3-')){
     if(!s.library){s.library=await compileIdeas({graph:c.graph,call:s.call,allowPartialTitles:true,cache:s.state.compileCache,concurrency:workers,signal,onCheckpoint:cache=>{s.state.compileCache=cache;return s.save('state.json',s.state);}});await s.save('library.json',s.library);}
     const scheduler=createScheduler({library:s.library,ledger:s.state.ledger,onCheckpoint:ledger=>{s.state.ledger=ledger;return s.save('state.json',s.state);}}),quotas=Object.fromEntries(c.leaves.map((n,i)=>[n.id,Math.floor(count/c.leaves.length)+(i<count%c.leaves.length?1:0)]).filter(([,n])=>n>0));
     const plan=await reserveWithExpansion({library:s.library,scheduler,request:{count,types:['mcq'],strategies:['understand'],scope:spec.r3Scope??'all',...(spec.r3Scope==='local'?{quotas}:{}),requestId:id},call:s.call,concurrency:workers,signal});s.planId=plan.id;
     const capsules=arm==='r3-verified'?createCapsuleStore({cache:s.state.capsules,call:s.call,concurrency:workers,cacheScope:credentials.model,onCheckpoint:cache=>{s.state.capsules=cache;return s.save('state.json',s.state);}}):null;
     result=await createQuestionGenerator({library:s.library,scheduler,call:s.call,concurrency:workers,capsules,blind:!!capsules,onProgress:progress})(plan.id,{signal});
    }else{
     const nativeDir=path.join(s.home,'native'),before=await fs.readFile(path.join(nativeDir,'attempts.jsonl'),'utf8').catch(()=>''),beforeRows=before.trim().split('\n').filter(Boolean).length;
     try{const r=await runDeepTutorBench({...credentials,input:path.join(dir,c.id+'-source.json'),out:nativeDir,mode:'upstream-native',workers,count,maxCalls:(spec.maxCalls??60)-s.nativeCalls,existingQuestions:s.history,signal});result=r.result;}
     finally{const calls=JSON.parse(await fs.readFile(path.join(nativeDir,'model-calls.json'),'utf8').catch(()=>'[]')),rows=(await fs.readFile(path.join(nativeDir,'attempts.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse),events=rows.slice(beforeRows),attempts=events.filter(e=>e.status==='started').length;s.nativeCalls+=attempts;const ids=new Set(events.filter(e=>e.status==='started').map(e=>e.index));tokens=tokenLedger(calls.filter(r=>ids.has(r.index)),{attempts});timing=events;}
    }
   }catch(e){
    // 只留 message 会让「为什么挂」在跑完后无从查起（这正是 deeptutor-native 那几次
    // 259ms 失败查不出原因的老问题）。code / stack / cause 一并留档，凭据一律脱敏。
    const redact=x=>String(x??'').split(credentials.apiKey).join('[REDACTED]');
    error={name:e.name,code:e.code??null,message:redact(e.message),stack:redact(e.stack).split('\n').slice(0,12),cause:e.cause?redact(e.cause.message??e.cause):null};
    if(arm.startsWith('r3-')&&s.planId){const tickets=s.state.ledger?.plans?.[s.planId]?.tickets??[];result={state:'partial',questions:tickets.filter(t=>t.state==='ready').map(t=>t.question)};}
    // 一题没出就抛错，说明是环境/契约级故障，继续跑后面 7 个批次只是把钱接着烧掉。
    if(!deliveredQuestions(result).length)onProgress({event:'abort-arm',id,code:error.code,message:error.message});
   }
   await s.flush();
   const questions=deliveredQuestions(result).map(normalizeQuestion);s.history.push(...questions);
   // 引擎不抛错却一题没交时，`error` 会是 null —— 报告只显示 produced:0，
   // 看不出这是「模型拒绝了」还是「配置错了」。把引擎自报的问题顶到 error 上，
   // 否则这一批的失败原因在跑完后彻底消失（预检时实测复现）。
   if(!error&&!questions.length){
    const reported=Array.isArray(result?.problems)?result.problems.filter(Boolean):[];
    error={name:'EmptyBatch',code:result?.state??null,message:reported[0]??'引擎未报错但一道题也没有产出；请查看该臂的 checkpoint/state 与 run.log',stack:[],cause:null};
   }
   // 历史落盘：warm 批次与续跑都靠它，不写的话恢复后「已有题去重」全部失效。
   await s.save('history.json',s.history);
   const elapsedMs=Date.now()-started,events=timing??s.events.slice(eventStart);
   const firstQuestion=questions.map(q=>arrivals.get(q.id)).filter(Number.isFinite);
   // 阶段归因：一次跑完后要能直接看出「钱花在哪一步」。
   // 不归因的话，优化前后只能比总 token，说不清是返工少了还是材料发少了。
   const stageBreakdown={};
   for(const [index,call]of s.calls.slice(receiptStart).entries()){
    const stage=s.stages[receiptStart+index]?.stage??'unknown';
    const usage=call.response?.usage??{};
    const bucket=stageBreakdown[stage]??={calls:0,inputTokens:0,outputTokens:0,ms:0};
    bucket.calls++;bucket.inputTokens+=usage.prompt_tokens??0;bucket.outputTokens+=usage.completion_tokens??0;bucket.ms+=call.ms??0;
   }
   const row={id,caseId:c.id,arm,workers,batch:batch?'warm'+batch:'cold',requested:count,produced:questions.length,elapsedMs,firstQuestionMs:firstQuestion.length?Math.min(...firstQuestion):null,error,stageBreakdown,
    tokens:tokens??tokenLedger(s.calls.slice(receiptStart),{attempts:events.filter(e=>e.status==='started').length}),timing:timingLedger(events,{wallMs:Math.max(1,elapsedMs),slots:workers,delivered:questions.length}),state:result?.state??result?.status??null};
   await write(path.join(dir,id+'.json'),{...row,result});
   const at=manifest.runs.findIndex(x=>x.id===id);if(at>=0)manifest.runs[at]=row;else manifest.runs.push(row);
   await write(path.join(dir,'manifest.json'),manifest);
   for(const q of questions)all.push({...q,bench:{id,caseId:c.id,arm,workers,batch:row.batch}});await write(path.join(dir,'questions.json'),all);
   onProgress({event:'finish',...row});
   if(/返回 (401|402|403)|Insufficient Balance/i.test(error?.message??''))throw Error('Provider refused authorization or billing; stopping paid work');
  }
 }
 manifest.kernelAfter=await kernelHashes();manifest.codeUnchanged=JSON.stringify(manifest.kernelAfter)===JSON.stringify(manifest.kernel);if(!manifest.codeUnchanged)throw Error('Code changed during the comparison; do not treat as one frozen run');
 manifest.finishedAt=new Date().toISOString();await write(path.join(dir,'manifest.json'),manifest);
 return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const argv=process.argv.slice(2);
 // --resume：同一个输出目录续跑。一次性授权的实跑必须靠它，否则崩一次全白花。
 const resume=argv.includes('--resume'),[specFile,out]=argv.filter(a=>!a.startsWith('--'));
 if(!specFile||!out)throw Error('Usage: compare.mjs <spec.json> <artifacts/dir> [--resume]');
 const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).flatMap(line=>{const i=line.indexOf('=');return i>0?[[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]:[]}));
 if(!env.APIkey||!env.BaseURL||!env.ModelName)throw Error('Model credentials/configuration missing');
 const dir=path.resolve(out);
 // 运行日志同时落盘：控制台可能滚走，事后复算/追责必须有一份完整流水。
 await fs.mkdir(dir,{recursive:true});
 const logFile=path.join(dir,'run.log');
 const log=async event=>{const line=JSON.stringify(event);console.log(line);await fs.appendFile(logFile,line+'\n').catch(()=>{});};
 await log({event:'cli-start',resume,spec:specFile,out,at:new Date().toISOString()});
 await runComparison({spec:JSON.parse(await fs.readFile(specFile,'utf8')),out,resume,credentials:{apiKey:env.APIkey,baseUrl:env.BaseURL,model:env.ModelName},onProgress:log});
 await log({event:'cli-done',at:new Date().toISOString()});
}
