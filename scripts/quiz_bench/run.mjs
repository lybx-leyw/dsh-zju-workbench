import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mountQuiz, modelCall } from './bridge.mjs';
import { datasetFrom,loadDataset } from './input.mjs';
import { fixture,fixtureCall } from './fixture.mjs';
import { measure,markdownReport,trialSummary } from './metrics.mjs';
import { contentHash } from '../../packages/dsh-zhiyun-core-quiz/src/concepts.js';
import { planPointQuestions,QUESTION_STRATEGIES,QUESTION_TYPES,newPointCheckpoint,POINT_QUIZ_CACHE_VERSION } from '../../packages/dsh-zhiyun-core-quiz/src/points.js';
import { resolveConfig } from '../knowledge_tree_bench/defaults.mjs';
import { createWriter,readLog } from '../knowledge_tree_bench/log.mjs';

export const defaultOptions={counts:[10],batches:3,repeats:1,strategies:['recall','understand'],types:['cloze'],mode:'uniform',difficulty:'basic',seed:42,maxCalls:120};
export function optionsOf(raw={}) {
  const config={...defaultOptions,...raw};
  for(const [key,max] of [['batches',10],['repeats',5],['maxCalls',1000]])if(!Number.isInteger(config[key])||config[key]<1||config[key]>max)throw new Error(`${key} 须为 1–${max} 的整数`);
  if(!Array.isArray(config.counts)||!config.counts.length||config.counts.length>4||config.counts.some(n=>!Number.isInteger(n)||n<1||n>100)||new Set(config.counts).size!==config.counts.length)throw new Error('题数梯度须为 1–4 个互不相同的 1–100 整数');
  for(const [key,registry] of [['strategies',QUESTION_STRATEGIES],['types',QUESTION_TYPES]])if(!Array.isArray(config[key])||!config[key].length||new Set(config[key]).size!==config[key].length||config[key].some(id=>!Object.hasOwn(registry,id)))throw new Error(`${key} 选择无效`);
  if(!['uniform','random'].includes(config.mode)||!['basic','advanced','challenge'].includes(config.difficulty)||!Number.isInteger(config.seed))throw new Error('分配、难度或种子无效');
  const scenarios=config.strategies.flatMap(strategy=>config.types.filter(type=>QUESTION_STRATEGIES[strategy].types.includes(type)).map(type=>({strategy,type})));
  if(config.strategies.some(strategy=>!scenarios.some(s=>s.strategy===strategy)))throw new Error('某个策略没有兼容的题型，请补选选择题或简答题');
  if(scenarios.length*config.counts.length*config.repeats*config.batches>200)throw new Error('评测矩阵超过 200 批，请减少组合或批次');
  return {...Object.fromEntries(Object.keys(defaultOptions).map(key=>[key,config[key]])),scenarios};
}
export function seeded(seed) {
  let state=seed>>>0;
  return ()=>{state+=0x6D2B79F5;let n=state;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};
}
export async function atomicJson(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';
  await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8');await fs.rename(temp,file);
}
const emit=value=>process.stdout.write(`@@EV@@${JSON.stringify(value)}\n`);

/** CLI and UI share this executor; injected calls are used only by harness tests. */
export async function runQuizBench(raw,{call:injected,signal,onEvent=()=>{},outDir=raw.outDir}={}) {
  const config=optionsOf(raw),model=raw.fixture?'fixture':resolveConfig(raw).model;
  if(!raw.fixture&&!injected&&(!raw.apiKey||!model))throw new Error('请输入 API Key 与有效模型');
  let provider='fixture';
  if(!raw.fixture){const url=new URL(resolveConfig(raw).baseUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(raw.apiKey&&url.href.includes(raw.apiKey)))throw new Error('接口地址须为不含凭据或查询参数的 HTTP(S) 地址');provider=url.href.replace(/\/+$/,'');}
  const dataset=raw.dataset?datasetFrom(raw.dataset):raw.fixture?datasetFrom(fixture):await loadDataset(raw.input);
  if(raw.gold)dataset.gold=raw.gold;
  if(raw.pointIds?.length)dataset.points=dataset.points.filter(p=>raw.pointIds.includes(p.id));
  if(!dataset.points.length)throw new Error('未选择可评测知识点');
  const kernelHash=await contentHash(await Promise.all(['index.js','points.js','concepts.js','strategies.js','knowledge-points.js','generate.js','quality.js'].map(file=>fs.readFile(new URL('../../packages/dsh-zhiyun-core-quiz/src/'+file,import.meta.url),'utf8'))));
  const datasetHash=await contentHash(dataset.points),fingerprint=await contentHash([datasetHash,kernelHash,config.counts,config.batches,config.repeats,config.scenarios,config.mode,config.difficulty,config.seed,provider,model]);
  const directory=path.resolve(outDir??path.join('artifacts','quiz-bench',randomUUID()));await fs.mkdir(directory,{recursive:true});
  let state;
  if(raw.resume){state=JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'));if(state.fingerprint!==fingerprint)throw new Error('恢复配置或资料已变化，请使用原配置或另建一次评测');}
  else {try{await fs.access(path.join(directory,'state.json'));throw new Error('输出目录已有评测，请使用 --resume 或新目录');}catch(error){if(error.code!=='ENOENT')throw error;}}
  state??={version:1,fingerprint,datasetHash,kernelHash,kernelVersion:POINT_QUIZ_CACHE_VERSION,title:dataset.title,provider,model,config,points:dataset.points,gold:dataset.gold??null,startedAt:new Date().toISOString(),cells:[],status:'running'};
  const previous=await readLog(path.join(directory,'events.jsonl'));
  if(previous.broken||previous.records.some((row,index)=>row.seq!==index+1))throw new Error('原日志存在坏行或序号缺口，请保留现场并另建评测');
  const writer=createWriter(path.join(directory,'events.jsonl'),{initialSeq:previous.records.at(-1)?.seq??0});
  const secret=String(raw.apiKey??''),scrub=text=>{let value=String(text??'');if(secret)value=value.split(secret).join('[REDACTED]');return value.slice(0,1000);};
  const save=()=>atomicJson(path.join(directory,'state.json'),state);
  const record=async(kind,data)=>{const row={act:kind,t:Date.now(),...data};await writer.event(row);if(writer.failures.count)throw new Error('基准日志写入失败，已停止');onEvent({kind,...data});};
  const controller=new AbortController(),combined=signal?AbortSignal.any([controller.signal,signal]):controller.signal;
  let current=null,currentBatch=0,executionCalls=0,mounted;
  const actual=injected??(raw.fixture?fixtureCall():modelCall(resolveConfig(raw)));
  const call=async request=>{
    if(executionCalls>=config.maxCalls){controller.abort(new Error('达到本次启动的模型调用上限，断点已保留'));combined.throwIfAborted();}
    executionCalls++;const started=Date.now(),entry={id:randomUUID(),stage:request.stage,batch:currentBatch,status:'running',ms:0,inputTokens:null,outputTokens:null};
    current.calls.push(entry);await save();await record('call-start',{cell:current.id,batch:currentBatch,stage:request.stage});
    try{
      const result=await actual({...request,signal:AbortSignal.any([combined,AbortSignal.timeout(240000)])});
      entry.ms=Date.now()-started;entry.inputTokens=result.usage?.prompt_tokens??result.usage?.inputTokens??null;entry.outputTokens=result.usage?.completion_tokens??result.usage?.outputTokens??null;
      entry.status='completed';
      await writer.artifact({act:'model',cell:current.id,batch:currentBatch,stage:request.stage,data:{constant:request.constant,variable:request.variable,text:result.text??result,usage:result.usage??null}});
      return result;
    }catch(error){entry.ms=Date.now()-started;entry.status='failed';entry.error=scrub(error.message);throw error;}
    finally{await save();await record('call-end',{cell:current.id,batch:currentBatch,...entry});}
  };
  try{
    await save();await writer.meta({what:'start',at:new Date().toISOString(),datasetHash,model,config,fixture:Boolean(raw.fixture)});
    mounted=await mountQuiz({call,dataDir:directory});
    state.status='running';delete state.error;
    for(const {strategy,type} of config.scenarios)for(const count of config.counts)for(let trial=1;trial<=config.repeats;trial++){
      const id=`${strategy}-${type}-${count}-${trial}`;
      current=state.cells.find(c=>c.id===id);
      if(!current){current={id,strategy,type,count,trial,conceptCache:{},questions:[],calls:[],batches:[],jobs:{}};state.cells.push(current);}
      for(let batch=1;batch<=config.batches;batch++){
        currentBatch=batch;combined.throwIfAborted();
        if(current.batches.some(row=>row.batch===batch))continue;
        const job=current.jobs[batch]??={plan:planPointQuestions(dataset.points,{count,mode:config.mode,types:[type],strategies:[{id:strategy,weight:1}],difficulty:config.difficulty},seeded(config.seed+trial*1009+batch*9176)),checkpoint:null};
        job.checkpoint??=newPointCheckpoint(job.plan);await save();
        await record('batch-start',{cell:id,batch,strategy,type,count});
        const started=Date.now();
        const result=await mounted.generatePoints({plan:job.plan,checkpoint:job.checkpoint,signal:combined,conceptCache:current.conceptCache,existingQuestions:current.questions,existingStems:current.questions.map(q=>q.stem),
          onConcept:async(key,entry)=>{current.conceptCache[key]=entry;await save();await writer.artifact({act:'concept',cell:id,batch,data:entry});},
          onCheckpoint:async checkpoint=>{job.checkpoint=checkpoint;await save();await record('phase',{cell:id,batch,phase:checkpoint.phase,done:checkpoint.tasks.reduce((n,t)=>n+t.questionIds.length,0),total:count});},
          onQuestion:async(question,checkpoint)=>{current.questions.push({...question,batch});job.checkpoint=checkpoint;await save();await record('question',{cell:id,batch,data:question});}});
        const snapshot=structuredClone(current.conceptCache),questions=current.questions.filter(q=>q.batch===batch),prior=current.questions.filter(q=>q.batch<batch);
        const metrics=measure({points:dataset.points,questions,prior,conceptCache:snapshot,calls:current.calls.filter(c=>c.batch===batch),gold:state.gold});
        current.batches.push({batch,ms:Date.now()-started,requested:count,produced:result.produced,problems:result.problems,conceptCache:snapshot,metrics});
        await save();await record('batch-end',{cell:id,batch,metrics,problems:result.problems});
      }
    }
    state.status=state.cells.some(c=>c.batches.some(b=>b.produced<b.requested))?'partial':'completed';
  }catch(error){state.status=combined.aborted?'interrupted':'failed';state.error=scrub(combined.aborted?combined.reason?.message??error.message:error.message);await record('error',{message:state.error});}
  finally{
    state.updatedAt=new Date().toISOString();
    for(const cell of state.cells)cell.metrics=measure({points:dataset.points,questions:cell.questions,conceptCache:cell.conceptCache,calls:cell.calls,gold:state.gold});
    state.trials=trialSummary(state.cells);
    await save();await atomicJson(path.join(directory,'report.json'),state);await fs.writeFile(path.join(directory,'report.md'),markdownReport(state));
    await writer.meta({what:'end',status:state.status,at:state.updatedAt});await writer.close();await mounted?.dispose();
    if(writer.failures.count)throw new Error('日志写入不完整，不能视为有效评测');
  }
  onEvent({kind:'done',status:state.status,report:state});return state;
}

async function main(){
  const args=process.argv.slice(2),arg=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
  if(args.includes('--help')){console.log('node scripts/quiz_bench/run.mjs --fixture --out artifacts/quiz-bench/demo\n实际评测：stdin JSON，含 dataset 或 input、apiKey、model；--resume 继续原输出目录。');return;}
  const raw=args.includes('--fixture')?{fixture:true,counts:[4],strategies:['recall'],types:['cloze']} : JSON.parse(await new Promise(resolve=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>resolve(text));}));
  const report=await runQuizBench({...raw,input:arg('input')??raw.input,resume:args.includes('--resume')||raw.resume,outDir:arg('out')??raw.outDir},{onEvent:emit});
  if(['failed','interrupted'].includes(report.status))process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{emit({kind:'error',message:String(error.message).slice(0,500)});process.exitCode=1;});
