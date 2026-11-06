/** Run the actual vendored facade; native and integrated modes are deliberately separate. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PythonBridge} from '../../packages/dsh-zhiyun-host-deeptutor/src/runtime.js';
import {createLlmBridge} from '../../packages/dsh-zhiyun-host-deeptutor/src/models.js';
import {createService} from '../../packages/dsh-zhiyun-host-deeptutor/src/service.js';
import {createRunStore} from '../../packages/dsh-zhiyun-host-deeptutor/src/run-store.js';
import {createResourceRegistry} from '../../packages/dsh-zhiyun-host-deeptutor/src/resources.js';
import * as resources from '../../packages/dsh-zhiyun-core-learning-resource/src/index.js';
import {createDeepTutorCandidateCall,nativeQuizContract} from '../../packages/dsh-zhiyun-core-study/src/deeptutor-quiz.js';
import {WorkerPoolLlm} from '../../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {deepTutorBenchHost} from './deeptutor-host.mjs';
import {loadDataset} from './input.mjs';
import {mountQuiz} from './bridge.mjs';
import {planPointQuestions} from '../../packages/dsh-zhiyun-core-quiz/src/points.js';
import {DEEPTUTOR_GUIDANCE_ID} from '../../packages/dsh-zhiyun-core-quiz/src/deeptutor-guidance.js';
import {tokenLedger,timingLedger,attemptOffset} from './accounting.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),pkg=path.join(root,'packages/dsh-zhiyun-host-deeptutor');
export async function runDeepTutorBench({input,out,apiKey,baseUrl='https://api.deepseek.com/v1',model='deepseek-flash',mode='upstream-native',workers=2,count=3,maxCalls=60,seed=42,existingQuestions=[],signal}={}){
  if(!apiKey)throw new Error('请提供模型凭证');
  if(!['local','local-guided','upstream-native','integrated-parallel'].includes(mode)||!Number.isInteger(count)||count<1||count>50||!Number.isInteger(workers)||workers<1||workers>32)throw new Error('评测模式、题数或 workers 无效');
  const dataset=await loadDataset(input),dir=path.resolve(out);await fs.mkdir(dir,{recursive:true});
  let calls=[];try{calls=JSON.parse(await fs.readFile(path.join(dir,'model-calls.json'),'utf8'));}catch{}
  const priorCalls=calls.length;let writes=Promise.resolve();
  const previousAttempts=(await fs.readFile(path.join(dir,'attempts.jsonl'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).trim().split('\n').filter(Boolean).map(JSON.parse),offset=attemptOffset(calls,previousAttempts);
  let attemptWrites=Promise.resolve();const attempts=[];
  const events=[],host=deepTutorBenchHost({apiKey,baseUrl,model,maxCalls,onAttempt:attempt=>{attempts.push(attempt);attemptWrites=attemptWrites.then(()=>fs.appendFile(path.join(dir,'attempts.jsonl'),JSON.stringify({...attempt,index:offset+attempt.index})+'\n'));return attemptWrites;},onCall:call=>{calls.push({...call,index:offset+call.index});writes=writes.then(()=>fs.writeFile(path.join(dir,'model-calls.json'),JSON.stringify(calls,null,2)));return writes;}});
  const bridge=new PythonBridge({rootDir:pkg,pythonPath:path.join(root,'.runtime/deeptutor-py311/Scripts/python.exe'),vendorPath:path.join(pkg,'vendor/deeptutor'),homeDir:path.join(dir,'home'),startTimeoutMs:60000,requestTimeoutMs:240000});
  const llm=createLlmBridge({llm:host,selection:()=>({provider:'bench',model})});llm.attachTo(bridge);
  const registry=createResourceRegistry({dataDir:path.join(dir,'resources'),validate:resources.validate,contentHash:resources.contentHash,project:resources.project});
  const runStore=createRunStore({runsDir:path.join(dir,'runs')});
  const tutor=createService({bridge,llmBridge:llm,resources:registry,runStore,catalog:{get:async name=>({name,upstream:true,depsAvailable:true,configured:true,exposed:true})},config:{python:{ok:true,version:'3.11.9'},deps:{installed:true}}});
  const abort=()=>void tutor.dispose();signal?.addEventListener('abort',abort,{once:true});
  const started=Date.now();let mounted;
  try{
    signal?.throwIfAborted();let result;
    if(mode==='upstream-native'){
      const contract=nativeQuizContract({title:dataset.title,points:dataset.points,count,existingQuestions});
      const bundle=resources.fromLecture({accountScope:{accountId:'bench'},courseId:'bench',subId:'all',title:dataset.title,lecture:contract.lecture});
      const handle=await registry.attach(bundle);
      const run=await tutor.runs.start({capability:'deep_question',language:'zh',scope:'bench',resourceHandles:[handle],input:contract.input,options:{mode,workers,config:contract.config}});
      for await(const event of tutor.runs.events({runId:run.runId})){events.push(event);await fs.writeFile(path.join(dir,'events.json'),JSON.stringify(events,null,2));}
      result=await tutor.runs.result(run.runId);
      if(result.status!=='succeeded')throw new Error(result.error?.message??'上游失败');
    }else{
      const narrow=async request=>{const prepared=await host.prepareCall({},request.signal);let text='',usage;for await(const chunk of prepared.stream({messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal})){if(chunk.type==='text-delta')text+=chunk.text;if(chunk.type==='usage')usage=chunk.usage;}return {text,usage};};
      const pool=new WorkerPoolLlm({base:{llm:host,resolve:async()=>({text:{provider:'bench',model}}),call:narrow},entries:[{provider:'bench',model,workers}]});
      const candidateCall=createDeepTutorCandidateCall({tutor,resources,pool,scope:'bench',points:dataset.points,onProgress:event=>events.push(event)});
      mounted=await mountQuiz({call:request=>mode==='integrated-parallel'&&/^quiz-point-(mcq|trueFalse|shortAnswer|cloze)$/.test(request.stage)?candidateCall(request):pool.call(request),config:{pointGuidance:mode==='local-guided'?DEEPTUTOR_GUIDANCE_ID:null},dataDir:dir});
      let plan,checkpoint;
      try{plan=JSON.parse(await fs.readFile(path.join(dir,'plan.json'),'utf8'));checkpoint=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));}catch{}
      if(plan&&(plan.count!==count||plan.tasks.some(t=>!dataset.points.some(p=>p.id===t.point.id&&p.text===t.point.text))))throw new Error('断点与当前资料或题数不一致，请使用新的输出目录');
      let randomState=seed>>>0;const random=()=>{randomState+=0x6D2B79F5;let n=randomState;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};
      const desiredGuidance=mode==='local-guided'?DEEPTUTOR_GUIDANCE_ID:null;
      if(plan&&(plan.guidance??null)!==desiredGuidance)throw new Error('断点的通用指引与当前实验不一致');
      plan??=planPointQuestions(dataset.points,{count,types:['mcq'],strategies:[{id:'understand',weight:1}]},random);plan.engine=mode==='integrated-parallel'?'deeptutor':'local';if(desiredGuidance)plan.guidance=desiredGuidance;
      await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));
      const save=checkpoint=>fs.writeFile(path.join(dir,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
      result=await mounted.generatePoints({plan,checkpoint,signal,concurrency:workers,onCheckpoint:save,onQuestion:(_question,checkpoint)=>save(checkpoint),onRectify:async({checkpoint,rejected=[],admitted=[],pending=[]})=>{
        if(!checkpoint)return;for(const row of rejected){const q=checkpoint.questions[row.id];if(q)Object.assign(q,{status:'rejected',reviewState:'rejected',rectifyReason:row.reason});}
        for(const id of admitted)if(checkpoint.questions[id])checkpoint.questions[id].reviewState='ready';
        for(const id of pending)if(checkpoint.questions[id])checkpoint.questions[id].reviewState='needs-review';await save(checkpoint);
      }});
    }
    await writes;await attemptWrites;
    const elapsedMs=Date.now()-started;
    const report={mode,model,workers,count,seed,elapsedMs,calls:host.attempts,totalCompletedCalls:calls.length,tokens:tokenLedger(calls.slice(priorCalls),{attempts:host.attempts}),timing:timingLedger(attempts,{wallMs:elapsedMs,slots:workers,delivered:result.admitted??result.questions?.length??0}),result};
    await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));return report;
  }finally{signal?.removeEventListener('abort',abort);await mounted?.dispose();await tutor.dispose();await bridge.stop({drain:false});await llm.dispose();await registry.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [input,out,mode='upstream-native']=process.argv.slice(2);
  if(!input||!out)throw new Error('用法：node scripts/quiz_bench/deeptutor.mjs <资料.json> <输出目录> [upstream-native|integrated-parallel]；凭证从 DEEPSEEK_API_KEY 读取');
  const result=await runDeepTutorBench({input,out,mode,apiKey:process.env.DEEPSEEK_API_KEY,baseUrl:process.env.DEEPSEEK_BASE_URL,model:process.env.DEEPSEEK_MODEL});
  console.log(JSON.stringify({mode:result.mode,calls:result.calls,elapsedMs:result.elapsedMs,questions:result.result.questions?.length??0}));
}
