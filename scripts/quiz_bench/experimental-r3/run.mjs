import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {graphFromRecord,graphFromDataset,compileIdeas,createScheduler,createQuestionGenerator,openState,reserveWithExpansion,createCapsuleStore} from './index.mjs';
import {loadDataset} from '../input.mjs';
import {deepTutorBenchHost} from '../deeptutor-host.mjs';
import {tokenLedger,timingLedger} from '../accounting.mjs';
import {WorkerPoolLlm} from '../../../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {createToolTransport} from './tools.mjs';

export async function loadGraph(input){
 if((await fs.stat(input)).isDirectory()){
  const record=JSON.parse(await fs.readFile(path.join(input,'parsed.json'),'utf8')),lecture=JSON.parse(await fs.readFile(path.join(input,'lecture-final.json'),'utf8'));
  return graphFromRecord(record,lecture);
 }
 const data=JSON.parse((await fs.readFile(input,'utf8')).replace(/^\uFEFF/,''));
 if(data.root)return data;
 if(data.tree)return graphFromRecord(data,data.lecture);
 return graphFromDataset(await loadDataset(input));
}
/** Callable hook for lecture polish completion, without installing it into production. */
export async function runR3({graph,directory,call,count=6,types=['mcq'],scope='all',nodeIds=null,strategies=null,quotas=null,concurrency=2,signal,onProgress=()=>{},compileOnly=false,requestId,resumeId,assetMode='verified',cacheScope=''}){
 if(!['raw','verified'].includes(assetMode))throw Error('未知考法资产模式');
 const state=await openState(directory),started=Date.now();
 const library=await compileIdeas({graph,call,allowPartialTitles:true,cache:state.snapshot.compileCache,concurrency,signal,onProgress,onCheckpoint:cache=>state.update(s=>({...s,compileCache:cache}))});
 const {cache,...savedLibrary}=library;await state.update(s=>({...s,library:savedLibrary}));
 if(compileOnly)return {state:library.stats.partialTitles?'compiled-partial':'compiled',library:savedLibrary,elapsedMs:Date.now()-started};
 const scheduler=createScheduler({library,ledger:state.snapshot.ledger,onCheckpoint:ledger=>state.update(s=>({...s,ledger}))});
 const plan=resumeId?scheduler.get(resumeId):await reserveWithExpansion({library,scheduler,request:{count,types,scope,nodeIds,strategies,quotas,requestId},call,concurrency,signal});
 const capsules=assetMode==='verified'?createCapsuleStore({cache:state.snapshot.capsules,call,concurrency,cacheScope,onCheckpoint:capsules=>state.update(s=>({...s,capsules}))}):null;
 const generate=createQuestionGenerator({library,scheduler,call,concurrency,onProgress,capsules,blind:Boolean(capsules)}),result=await generate(plan.id,{signal});
 return {...result,library:savedLibrary,elapsedMs:Date.now()-started};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [input,out,action='compile',value]=process.argv.slice(2);if(!input||!out||!['compile','generate','resume'].includes(action))throw Error('用法：node run.mjs <图谱记录.json或讲义工作目录> <独立输出目录> [compile|generate|resume] [题数或计划ID]');
 const dir=path.resolve(out);await fs.mkdir(dir,{recursive:true});const lock=path.join(dir,'.r3-lock');await fs.mkdir(lock).catch(()=>{throw Error('该实验目录已有写入者或遗留锁，请确认后再运行');});
 try{
  const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).flatMap(l=>{const i=l.indexOf('=');return i>0?[[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]:[];}));
  if(!env.APIkey||!env.BaseURL||!env.ModelName)throw Error('.env 缺少 APIkey、BaseURL 或 ModelName');
  if(action==='resume'&&!value)throw Error('恢复运行必须提供计划ID');
  const calls=[],attempts=[];let writes=Promise.resolve();const id=crypto.randomUUID(),save=()=>{const snapshot=JSON.stringify({calls,attempts},null,2);writes=writes.then(()=>fs.writeFile(path.join(dir,'calls-'+id+'.json'),snapshot));return writes;};
  const host=deepTutorBenchHost({apiKey:env.APIkey,baseUrl:env.BaseURL,model:env.ModelName,maxCalls:120,onCall:c=>{calls.push(c);return save();},onAttempt:a=>{attempts.push(a);return save();}});
  const transport=createToolTransport(host);
  const pool=new WorkerPoolLlm({base:{llm:host,resolve:async()=>({text:{provider:'bench',model:env.ModelName}}),call:transport},entries:[{provider:'bench',model:env.ModelName,workers:2}]});
  const start=Date.now();let result,failure;
  try{result=await runR3({graph:await loadGraph(input),directory:dir,call:r=>pool.call(r),compileOnly:action==='compile',count:action==='generate'?Number(value??6):6,resumeId:action==='resume'?value:undefined,cacheScope:env.ModelName,concurrency:2,signal:AbortSignal.timeout(600000),onProgress:e=>process.stdout.write(JSON.stringify(e)+'\n')});}
  catch(error){failure=error;}
  await writes;await fs.writeFile(path.join(dir,'result-'+id+'.json'),JSON.stringify({result,error:failure?{name:failure.name,message:failure.message}:undefined,tokens:tokenLedger(calls,{attempts:host.attempts}),timing:timingLedger(attempts,{wallMs:Math.max(1,Date.now()-start),slots:2,delivered:result?.produced??0})},null,2));
  if(failure)throw failure;
 }finally{if(path.dirname(lock)!==dir)throw Error('锁目录越界');await fs.rm(lock,{recursive:true,force:true});}
}
