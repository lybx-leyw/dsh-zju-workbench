import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deepTutorBenchHost} from '../deeptutor-host.mjs';
import {tokenLedger,timingLedger} from '../accounting.mjs';
import {loadDataset} from '../input.mjs';
import {mountQuiz} from '../bridge.mjs';
import {WorkerPoolLlm} from '../../../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {DEEPTUTOR_GUIDANCE_ID} from '../../../packages/dsh-zhiyun-core-quiz/src/deeptutor-guidance.js';
import {planPointQuestions as basePlan} from '../../../packages/dsh-zhiyun-core-quiz/src/points.js';
import {createPointQuizGenerator,planPointQuestions} from './points.mjs';
export function traceInput(value){try{return JSON.parse(value);}catch{return {raw:value};}}

export async function runLab({input,out,mode='lab-v2',seed=43,count=6,workers=2,maxCalls=85,apiKey,baseUrl,model,signal}){
 if(!['baseline','lab-v2'].includes(mode))throw Error('Unknown experimental mode');
 await fs.mkdir(out,{recursive:true});
 if(await fs.access(path.join(out,'result.json')).then(()=>true,()=>false))throw Error('Use a fresh directory');
 const calls=[],attempts=[],trace=[];let writes=Promise.resolve();
 const write=(name,value)=>{writes=writes.then(()=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)));return writes;};
 const host=deepTutorBenchHost({apiKey,baseUrl,model,maxCalls,onAttempt:a=>{attempts.push(a);return write('attempts.json',attempts);},onCall:c=>{calls.push(c);return write('model-calls.json',calls);}});
 const transport=async request=>{
  trace.push({stage:request.stage,at:Date.now(),input:traceInput(request.variable)});await write('trace.json',trace);
  const prepared=await host.prepareCall({},request.signal);let text='',usage;
  for await(const chunk of prepared.stream({messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal})){
   if(chunk.type==='text-delta')text+=chunk.text;if(chunk.type==='usage')usage=chunk.usage;
  }return {text,usage};
 };
 const pool=new WorkerPoolLlm({base:{llm:host,resolve:async()=>({text:{provider:'bench',model}}),call:transport},entries:[{provider:'bench',model,workers}]});
 const dataset=await loadDataset(input);let randomState=seed>>>0;const random=()=>{randomState+=0x6D2B79F5;let n=randomState;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};
 const plan=(mode==='baseline'?basePlan:planPointQuestions)(dataset.points,{count,types:['mcq'],strategies:[{id:'understand',weight:1}]},random);
 if(mode==='baseline')plan.guidance=DEEPTUTOR_GUIDANCE_ID;
 await write('plan.json',plan);let mounted,checkpoint,result,error;const start=Date.now();
 try{
  if(mode==='baseline')mounted=await mountQuiz({call:r=>pool.call(r),config:{pointGuidance:DEEPTUTOR_GUIDANCE_ID},dataDir:out});
  const generate=mounted?.generatePoints??createPointQuizGenerator({call:r=>pool.call(r)});
  result=await generate({plan,concurrency:workers,signal,onCheckpoint:c=>{checkpoint=c;return write('checkpoint.json',c);},onQuestion:(_q,c)=>{checkpoint=c;return write('checkpoint.json',c);},onRectify:({checkpoint:c})=>{checkpoint=c;return write('checkpoint.json',c);}});
 }catch(e){error={code:e.code,message:String(e.message).split(apiKey).join('[REDACTED]')};}
 finally{await mounted?.dispose();await writes;}
 const elapsedMs=Date.now()-start,report={mode,seed,model,workers,count,calls:host.attempts,elapsedMs,tokens:tokenLedger(calls,{attempts:host.attempts}),timing:timingLedger(attempts,{wallMs:elapsedMs,slots:workers,delivered:result?.admitted??0}),result:result??{checkpoint},error};
 await write('result.json',report);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [out,experiment='paired']=process.argv.slice(2);if(!out)throw Error('Provide a new ignored artifact directory');
 const values=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).map(line=>{const i=line.indexOf('=');return i>0?[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]:[];}).filter(row=>row.length));
 const input='artifacts/quiz-bench-real-20261025/source.json',files=['points.js','blueprint.js','rectification.js','facts.js','index.js','concepts.js'].map(f=>'packages/dsh-zhiyun-core-quiz/src/'+f);
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(f)).digest('hex')])));
 const manifest={experiment,model:values.ModelName,count:6,workers:2,sourceHash:createHash('sha256').update(await fs.readFile(input)).digest('hex'),productionBefore:await hashes(),startedAt:new Date().toISOString(),runs:[]};
 await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 const cases=experiment==='preflight'?[{mode:'lab-v2',seed:99,repeat:0}]:[1,2,3].flatMap(repeat=>(repeat%2?['baseline','lab-v2']:['lab-v2','baseline']).map(mode=>({mode,seed:42+repeat,repeat})));
 for(const item of cases){const id=`r${item.repeat}-${item.mode}`;console.log(JSON.stringify({event:'start',id}));
  const result=await runLab({...item,input,out:path.join(out,id),apiKey:values.APIkey,baseUrl:values.BaseURL,model:values.ModelName,signal:AbortSignal.timeout(600000)});
  manifest.runs.push({...item,id,status:result.error?'failed':'finished',error:result.error,ms:result.elapsedMs,calls:result.calls,admitted:result.result.admitted,phase:result.result.checkpoint?.phase,tokens:result.tokens,timing:result.timing});
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({event:'finish',...manifest.runs.at(-1)}));
 }
 manifest.productionAfter=await hashes();manifest.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
}
