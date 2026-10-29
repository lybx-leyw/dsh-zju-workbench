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
export async function runComparison({spec,out,credentials,onProgress=()=>{}}){
 const dir=path.resolve(out),root=path.resolve('artifacts');if(!dir.startsWith(root+path.sep))throw Error('Output must be a fresh directory under artifacts');
 await fs.mkdir(dir,{recursive:true});if((await fs.readdir(dir)).length)throw Error('Comparison output must be empty');
 const arms=spec.arms??['r1','native','r3-verified','r4'],concurrencies=spec.concurrencies??[1,2],batches=spec.batches??[2,2];
 if(!arms.length||new Set(arms).size!==arms.length||arms.some(a=>!['r1','native','r3-verified','r3-raw-v9','r4'].includes(a))||!concurrencies.length||concurrencies.some(n=>!Number.isInteger(n)||n<1||n>8)||!batches.length||batches.some(n=>!Number.isInteger(n)||n<1||n>20)||!Array.isArray(spec.cases)||!spec.cases.length||new Set(spec.cases.map(c=>c.id)).size!==spec.cases.length||spec.cases.some(c=>!/^[-\w]{1,64}$/.test(c.id))||!Number.isInteger(spec.maxCalls??60)||(spec.maxCalls??60)<1||!['local','all'].includes(spec.r3Scope??'all'))throw Error('Invalid comparison configuration');
 const prepared=[];
 for(const c of spec.cases){const graph=JSON.parse(await fs.readFile(c.source,'utf8')),leaves=[...inspectGraph(graph).leaves.values()];
  const points=leaves.map(n=>({...n.point,id:n.point?.id??n.id,title:n.title,text:n.text+'\n'+(n.pages??[]).map(p=>`[page ${p.page}] ${p.text??''}\n${p.visual??''}`).join('\n'),courseId:c.id,subId:'bench',courseTitle:graph.root.title,lessonTitle:graph.root.title}));
  const dataset={id:c.id,title:graph.root.title,points};await write(path.join(dir,c.id+'-source.json'),dataset);await write(path.join(dir,c.id+'-graph.json'),graph);prepared.push({...c,graph,points,leaves,dataset});}
 const manifest={version:1,kind:spec.kind??'development',model:credentials.model,thinking:'disabled',startedAt:new Date().toISOString(),arms,concurrencies,batches,maxCallsPerSession:spec.maxCalls??60,
  fairness:{sameMaterialAndPages:true,primary:'understand mcq; native planning remains native',r3Scope:spec.r3Scope??'all',r4Scope:'local only; compositeCount=0',cold:'empty state per algorithm/corpus/concurrency',warm:'same session state; native retains history and disk home but restarts Python service',r3:'verified is the current product capsule+blind path; raw-v9 is explicitly a separate control, never pooled',time:'observed wall time including preparation, retries, tool repair and local persistence; never divide by workers',tokens:'provider receipts including failed/invalid generations, subset tokens not double counted',variation:'one stochastic run per setting; concurrency comparisons are descriptive, not causal estimates'},
  cases:prepared.map(c=>({id:c.id,title:c.graph.root.title,sourceKind:c.kind??'authored',materialHash:hash(JSON.stringify(c.graph)),points:c.points.length})),kernel:await kernelHashes(),runs:[]};
 await write(path.join(dir,'manifest.json'),manifest);
 const all=[];
 for(const [ci,c]of prepared.entries())for(const [wi,workers]of concurrencies.entries()){
  const sessions=new Map();
  for(const arm of arms){const home=path.join(dir,`${c.id}-${arm}-c${workers}`);await fs.mkdir(home,{recursive:true});const calls=[],events=[],stages=[];let chain=Promise.resolve();
   const save=(file,value)=>{const copy=structuredClone(value);chain=chain.then(()=>write(path.join(home,file),copy));return chain;};
   const host=deepTutorBenchHost({...credentials,maxCalls:spec.maxCalls??60,requestTimeoutMs:spec.requestTimeoutMs??120000,onCall:r=>{calls.push(r);return save('calls.json',calls);},onAttempt:e=>{events.push(e);return save('attempts.json',events);}});
   const transport=(arm==='r4'?createR4ToolTransport:createToolTransport)(host),limit=poolLimit(workers),call=request=>limit(async()=>{stages.push({stage:request.stage,at:Date.now()});onProgress({event:'call',case:c.id,arm,workers,stage:request.stage});await save('stages.json',stages);
    if(arm!=='r1')return transport(request);
    const prepared=await host.prepareCall({},request.signal);let text='';for await(const b of prepared.stream({messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal}))if(b.type==='text-delta')text+=b.text;return {text};});
   sessions.set(arm,{home,calls,events,host,call,save,flush:()=>chain,state:{},concepts:{},history:[],nativeCalls:0});}
  const order=arms.map((_,i)=>arms[(i+ci+wi)%arms.length]);
  for(const [batch,count]of batches.entries())for(const arm of batch?[...order].reverse():order){
   const s=sessions.get(arm),id=`${c.id}-${arm}-c${workers}-${batch?'warm'+batch:'cold'}`,started=Date.now(),receiptStart=s.calls.length,eventStart=s.events.length;
   let result,error,tokens,timing;const arrivals=new Map(),progress=e=>{if(e.phase==='question-ready')arrivals.set(e.ticketId,Date.now()-started);};const signal=AbortSignal.timeout(spec.wallBudgetMs??600000);
   onProgress({event:'start',id});
   try{
    if(arm==='r4')result=await runR4({graph:c.graph,pointIds:c.points.map(p=>p.id),count,requestId:id,call:s.call,state:s.state,concurrency:workers,signal,maxCalls:spec.maxCalls??60,maxExpansions:1,onProgress:progress,onCheckpoint:async state=>{await s.save('state.json',state);s.state=state;}});
    else if(arm==='r1'){
     const plan=planPointQuestions(c.points,{count,types:['mcq'],strategies:[{id:'understand',weight:1}]},()=>0.37);await s.save('plan-'+batch+'.json',plan);
     result=await createPointQuizGenerator({call:s.call,random:()=>0.37})({plan,signal,concurrency:workers,existingQuestions:s.history,existingStems:s.history.map(q=>q.stem),conceptCache:s.concepts,onConcept:async(k,e)=>{s.concepts[k]=e;await s.save('concepts.json',s.concepts);},onCheckpoint:state=>s.save('checkpoint-'+batch+'.json',state),onQuestion:(q,state)=>{arrivals.set(q.id,Date.now()-started);return s.save('checkpoint-'+batch+'.json',state);},onRectify:({checkpoint})=>s.save('checkpoint-'+batch+'.json',checkpoint)});
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
   }catch(e){error={name:e.name,message:String(e.message).split(credentials.apiKey).join('[REDACTED]')};if(arm.startsWith('r3-')&&s.planId){const tickets=s.state.ledger?.plans?.[s.planId]?.tickets??[];result={state:'partial',questions:tickets.filter(t=>t.state==='ready').map(t=>t.question)};}}
   await s.flush();
   const questions=deliveredQuestions(result).map(normalizeQuestion);s.history.push(...questions);
   const elapsedMs=Date.now()-started,events=timing??s.events.slice(eventStart);
   const firstQuestion=questions.map(q=>arrivals.get(q.id)).filter(Number.isFinite);
   const row={id,caseId:c.id,arm,workers,batch:batch?'warm'+batch:'cold',requested:count,produced:questions.length,elapsedMs,firstQuestionMs:firstQuestion.length?Math.min(...firstQuestion):null,error,
    tokens:tokens??tokenLedger(s.calls.slice(receiptStart),{attempts:events.filter(e=>e.status==='started').length}),timing:timingLedger(events,{wallMs:Math.max(1,elapsedMs),slots:workers,delivered:questions.length}),state:result?.state??result?.status??null};
   await write(path.join(dir,id+'.json'),{...row,result});manifest.runs.push(row);await write(path.join(dir,'manifest.json'),manifest);
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
 const [specFile,out]=process.argv.slice(2);if(!specFile||!out)throw Error('Usage: compare.mjs <spec.json> <artifacts/new-directory>');
 const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).flatMap(line=>{const i=line.indexOf('=');return i>0?[[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]:[]}));
 if(!env.APIkey||!env.BaseURL||!env.ModelName)throw Error('Model credentials/configuration missing');
 await runComparison({spec:JSON.parse(await fs.readFile(specFile,'utf8')),out,credentials:{apiKey:env.APIkey,baseUrl:env.BaseURL,model:env.ModelName},onProgress:e=>console.log(JSON.stringify(e))});
}
