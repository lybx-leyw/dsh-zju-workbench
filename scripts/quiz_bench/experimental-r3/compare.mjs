/** Isolated three-way benchmark. Model content and credentials stay in ignored artifacts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadGraph} from './run.mjs';
import {compileIdeas,createScheduler,createQuestionGenerator,openState,walkTree,createToolTransport,reserveWithExpansion,createCapsuleStore} from './index.mjs';
import {createPointQuizGenerator,planPointQuestions} from '../experimental/points.mjs';
import {runDeepTutorBench} from '../deeptutor.mjs';
import {deepTutorBenchHost} from '../deeptutor-host.mjs';
import {WorkerPoolLlm} from '../../../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {tokenLedger,timingLedger} from '../accounting.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const random=initial=>{let seed=initial>>>0;return()=>{seed+=0x6D2B79F5;let n=seed;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};};
const withinArtifacts=out=>{const directory=path.resolve(out),root=path.resolve('artifacts');if(!directory.startsWith(root+path.sep))throw Error('评测输出必须为 artifacts 下的独立目录');return directory;};

export async function prepareCase(spec){
 const full=await loadGraph(spec.source);let root=full.root;for(const i of spec.select??[])root=root.children[i];
 if(!root)throw Error('指定的已有图谱子树不存在');root=structuredClone(root);if(spec.firstChildren!=null)root.children=root.children.slice(0,spec.firstChildren);
 const graph={...full,id:'compare:'+spec.id,root},leaves=[...walkTree(root)].filter(({node})=>!node.children.length).map(({node})=>node);
 const points=leaves.map(node=>({...node.point,id:node.id,title:node.title,courseId:spec.id,subId:'comparison',courseTitle:root.title,lessonTitle:root.title,
  text:[node.text,...(node.pages??[]).map(p=>`\n[相关页 ${p.page} 的文字]\n${p.text??''}\n[相关页 ${p.page} 的画面描述]\n${p.visual??''}`)].join('\n')}));
 return {graph,leaves,dataset:{id:'compare:'+spec.id,title:root.title,points},materialHash:hash(JSON.stringify(leaves.map(n=>({title:n.title,text:n.text,pages:n.pages??[]}))))};
}

async function currentHashes(){
 const files={};for(const dir of ['experimental','experimental-r3'])for(const f of (await fs.readdir('scripts/quiz_bench/'+dir)).filter(n=>n.endsWith('.mjs'))){const file='scripts/quiz_bench/'+dir+'/'+f;files[file]=hash(await fs.readFile(file));}
 for(const file of ['scripts/quiz_bench/deeptutor.mjs','scripts/quiz_bench/deeptutor-host.mjs','scripts/quiz_bench/accounting.mjs','packages/dsh-zhiyun-core-parser/src/worker-pool.js'])files[file]=hash(await fs.readFile(file));
 async function visit(dir){for(const row of await fs.readdir(dir,{withFileTypes:true})){if(row.name==='__pycache__'||row.name==='.git')continue;const file=dir+'/'+row.name;if(row.isDirectory())await visit(file);else if(/\.(js|mjs|py|md|ya?ml)$/.test(row.name))files[file]=hash(await fs.readFile(file));}}
 for(const dir of ['packages/dsh-zhiyun-core-quiz/src','packages/dsh-zhiyun-host-deeptutor/src','packages/dsh-zhiyun-host-deeptutor/python','packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor']){
  try{await visit(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
 }return files;
}

export async function runComparison({spec,out,credentials,onProgress=()=>{}}){
 const dir=withinArtifacts(out);await fs.mkdir(dir,{recursive:true});
 if(spec.kind==='formal'&&(await fs.readdir(dir)).length)throw Error('正式评测必须从空目录与冷缓存开始');
 if(await fs.access(path.join(dir,'manifest.json')).then(()=>true,()=>false))throw Error('请使用新的输出目录，禁止覆盖正式结果');
 const write=(name,value)=>fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2));
 const frozen=JSON.parse(await fs.readFile('scripts/quiz_bench/experimental/CANDIDATE.json','utf8'));
 for(const [file,expected]of Object.entries(frozen.files))if(hash(await fs.readFile('scripts/quiz_bench/experimental/'+file))!==expected)throw Error('冻结 r1 文件发生变化：'+file);
 if(spec.kind==='formal'){
  const candidate=JSON.parse(await fs.readFile('scripts/quiz_bench/experimental-r3/CANDIDATE.json','utf8'));
  for(const [file,expected]of Object.entries(candidate.files))if(hash(await fs.readFile('scripts/quiz_bench/experimental-r3/'+file))!==expected)throw Error('正式评测前 r3 摘要不一致：'+file);
 }
 const arms=spec.arms??['r1','native','r3'],batches=spec.batches??[4,2],workers=spec.workers??2,maxCalls=spec.maxCalls??85;
 if(arms.some(a=>!['r1','native','r3'].includes(a))||!batches.length||batches.some(n=>!Number.isInteger(n)||n<1))throw Error('评测组别或题数无效');
 const prepared=[];for(const c of spec.cases)prepared.push({...c,...await prepareCase(c)});
 const manifest={kind:spec.kind??'development',benchmark:'Codex自判定基准集',model:credentials.model,workers,batches,arms,maxCallsPerArmAndCorpus:maxCalls,sideCount:spec.crossCount??0,startedAt:new Date().toISOString(),kernel:await currentHashes(),cases:prepared.map(c=>({id:c.id,title:c.graph.root.title,materialHash:c.materialHash,leaves:c.leaves.map(n=>({title:n.title,nodeId:n.id,chars:n.text.length,pages:n.pages?.length??0}))})),fairness:{sameLectureAndPageInformation:true,treesRetainedForR3:true,primary:'uniform local understand MCQ',warm:'all arms retain prior generated questions; native reuses disk home/resources but restarts service process',cross:'R3-only capability test excluded from primary comparison',wall:'observed parallel wall clock; never divided by workers'},runs:[]};
 await write('manifest.json',manifest);
 for(const c of prepared){await write(c.id+'-graph.json',c.graph);await write(c.id+'-source.json',c.dataset);}
 async function session(id,toolMode){
  const home=path.join(dir,id);await fs.mkdir(home,{recursive:true});const calls=[],attempts=[],trace=[];let writes=Promise.resolve();
  const save=(name,v)=>{const text=JSON.stringify(v,null,2);writes=writes.then(()=>fs.writeFile(path.join(home,name),text));return writes;};
  const host=deepTutorBenchHost({...credentials,maxCalls,onCall:c=>{calls.push(c);return save('calls.json',calls);},onAttempt:a=>{attempts.push(a);return save('attempts.json',attempts);}});
  const native=createToolTransport(host),transport=async request=>{
   trace.push({at:Date.now(),stage:request.stage,input:JSON.parse(request.variable),tools:request.tools?.map(t=>t.name),toolFeedback:request.toolFeedback});await save('trace.json',trace);onProgress({event:'model',arm:id,stage:request.stage});
   if(toolMode)return native(request);
   const prepared=await host.prepareCall({},request.signal);let text='';for await(const chunk of prepared.stream({messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal}))if(chunk.type==='text-delta')text+=chunk.text;return {text};
  };
  const pool=new WorkerPoolLlm({base:{llm:host,resolve:async()=>({text:{provider:'bench',model:credentials.model}}),call:transport},entries:[{provider:'bench',model:credentials.model,workers}]});
  return {home,calls,attempts,host,call:r=>pool.call(r),save,flush:()=>writes};
 }
 async function phase(id,s,work){
  const start=Date.now(),callStart=s?.calls.length??0,eventStart=s?.attempts.length??0;onProgress({event:'start',id});let result,error,external;
  try{const value=await work(AbortSignal.timeout(spec.wallBudgetMs??600000));if(value?.external){external=value.external;result=external.result;error=external.error;}else result=value;}
   catch(e){error={name:e?.name,message:String(e?.message??e).split(credentials.apiKey).join('[REDACTED]')};}
  await s?.flush();const events=s?.attempts.slice(eventStart)??[],ms=Date.now()-start;
  const delivered=result?.admitted??result?.produced??result?.questions?.length??0;
  const nativeTiming=external?{...external.timing,wallMs:Math.max(1,ms),averageRequestConcurrency:external.timing.requestServiceMs/Math.max(1,ms),slotUtilization:external.timing.requestServiceMs/(workers*Math.max(1,ms)),deliveredPerMinute:delivered*60000/Math.max(1,ms)}:null;
  const report={id,elapsedMs:ms,result,error,...(external?{engineElapsedMs:external.elapsedMs,tokens:external.tokens,timing:nativeTiming,calls:external.calls}:{tokens:tokenLedger(s?.calls.slice(callStart)??[],{attempts:events.filter(e=>e.status==='started').length}),timing:timingLedger(events,{wallMs:Math.max(1,ms),slots:workers,delivered})})};
  await write(id+'.json',report);manifest.runs.push({id,elapsedMs:report.elapsedMs,produced:result?.produced??result?.questions?.length,admitted:result?.admitted,state:result?.state,error,tokens:report.tokens,timing:report.timing});await write('manifest.json',manifest);onProgress({event:'finish',...manifest.runs.at(-1)});if(/(?:返回\s+(?:401|402|403)|Insufficient Balance)/i.test(error?.message??''))throw Error('供应商拒绝请求，停止后续付费阶段：'+error.message);return report;
 }
 for(const [ci,c]of prepared.entries()){
  const r1=arms.includes('r1')?await session(c.id+'-r1',false):null,r3=arms.includes('r3')?await session(c.id+'-r3',true):null,state=r3?await openState(path.join(r3.home,'state')):null;
  let library,scheduler,generator,concepts={},history=[],nativeHistory=[],nativeCalls=0;
  const runArm=async(arm,batch)=>{
   const count=batches[batch],label=batch?'warm'+batch:'cold',id=`${c.id}-${arm}-${label}`;
   if(arm==='r1')return phase(id,r1,async signal=>{
    const plan=planPointQuestions(c.dataset.points,{count,types:['mcq'],strategies:[{id:'understand',weight:1}]},random((spec.seed??801)+ci+100*batch));await r1.save('plan-'+batch+'.json',plan);
    const result=await createPointQuizGenerator({call:r1.call,random:random((spec.seed??801)+ci+1000*batch)})({plan,signal,concurrency:workers,existingQuestions:history,existingStems:history.map(q=>q.stem),conceptCache:concepts,onConcept:(key,entry)=>{concepts[key]=entry;return r1.save('concepts.json',concepts);},onCheckpoint:checkpoint=>r1.save('checkpoint-'+batch+'.json',checkpoint),onQuestion:(_q,checkpoint)=>r1.save('checkpoint-'+batch+'.json',checkpoint),onRectify:({checkpoint})=>r1.save('checkpoint-'+batch+'.json',checkpoint)});
    const ids=result.checkpoint.tasks.flatMap(t=>t.questionIds);history.push(...ids.map(qid=>result.checkpoint.questions[qid]).filter(Boolean));await r1.save('history.json',history);return result;
   });
   if(arm==='native')return phase(id,null,async signal=>{
    const nativeDir=path.join(dir,c.id+'-native'),read=async(name,jsonl=false)=>{try{const text=await fs.readFile(path.join(nativeDir,name),'utf8');return jsonl?text.trim().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(text);}catch(e){if(e.code==='ENOENT')return [];throw e;}},priorCalls=(await read('model-calls.json')).length,priorEvents=(await read('attempts.jsonl',true)).length,start=Date.now();let report;
    try{if(nativeCalls>=maxCalls)throw Error('达到本语料直调请求预算');report=await runDeepTutorBench({...credentials,input:path.join(dir,c.id+'-source.json'),out:nativeDir,mode:'upstream-native',workers,count,maxCalls:maxCalls-nativeCalls,existingQuestions:nativeHistory,signal});}
    catch(e){const calls=(await read('model-calls.json')).slice(priorCalls),events=(await read('attempts.jsonl',true)).slice(priorEvents),elapsedMs=Date.now()-start,attempts=events.filter(e=>e.status==='started').length;report={elapsedMs,error:{name:e?.name,message:String(e?.message??e).split(credentials.apiKey).join('[REDACTED]')},result:{questions:[]},calls:attempts,tokens:tokenLedger(calls,{attempts}),timing:timingLedger(events,{wallMs:Math.max(1,elapsedMs),slots:workers,delivered:0})};}
    nativeCalls+=report.calls;nativeHistory.push(...(report.result.questions??[]));return {external:report};
   });
   if(batch===0)await phase(c.id+'-r3-compile',r3,async signal=>{
    library=await compileIdeas({graph:c.graph,allowPartialTitles:true,call:r3.call,cache:state.snapshot.compileCache,concurrency:workers,signal,onCheckpoint:compileCache=>state.update(s=>({...s,compileCache}))});
    const {cache,...saved}=library;await state.update(s=>({...s,library:saved}));scheduler=createScheduler({library,ledger:state.snapshot.ledger,onCheckpoint:ledger=>state.update(s=>({...s,ledger}))});const capsules=spec.r3AssetMode==='raw'?null:createCapsuleStore({cache:state.snapshot.capsules,call:r3.call,concurrency:workers,cacheScope:credentials.model,onCheckpoint:capsules=>state.update(s=>({...s,capsules}))});generator=createQuestionGenerator({library,scheduler,call:r3.call,concurrency:workers,capsules,blind:Boolean(capsules)});return {state:library.stats.partialTitles?'compiled-partial':'compiled',stats:library.stats};
   });
   return phase(id,r3,async signal=>{
    if(!scheduler)throw Error('考法树编译未完成，不能绕过编译直接出题');
    const quotas=Object.fromEntries(c.leaves.map((n,i)=>[n.id,Math.floor(count/c.leaves.length)+(i<count%c.leaves.length?1:0)]).filter(([,n])=>n>0));
    const p=await reserveWithExpansion({library,scheduler,request:{count,types:['mcq'],strategies:['understand'],scope:'local',quotas,requestId:id},call:r3.call,concurrency:workers,signal});return generator(p.id,{signal});
   });
  };
  const rotated=arms.map((_,i)=>arms[(i+ci)%arms.length]);for(let batch=0;batch<batches.length;batch++)for(const arm of batch%2?[...rotated].reverse():rotated)await runArm(arm,batch);
  if(r3&&spec.crossCount)await phase(c.id+'-r3-cross',r3,async signal=>{if(!scheduler)throw Error('考法树未完成');const p=await scheduler.reserve({count:spec.crossCount,scope:'cross',types:['shortAnswer'],requestId:c.id+'-cross'});return generator(p.id,{signal});});
 }
 manifest.kernelAfter=await currentHashes();for(const [file,before]of Object.entries(manifest.kernel))if(manifest.kernelAfter[file]!==before)throw Error('评测中代码发生变化：'+file);
 manifest.finishedAt=new Date().toISOString();await write('manifest.json',manifest);return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [file,out]=process.argv.slice(2);if(!file||!out)throw Error('用法：node compare.mjs <实验规格.json> <artifacts/新目录>');
 const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).flatMap(l=>{const i=l.indexOf('=');return i>0?[[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]:[]}));
 if(!env.APIkey||!env.BaseURL||!env.ModelName)throw Error('缺少模型凭证或配置');
 await runComparison({spec:JSON.parse(await fs.readFile(file,'utf8')),out,credentials:{apiKey:env.APIkey,baseUrl:env.BaseURL,model:env.ModelName},onProgress:e=>console.log(JSON.stringify(e))});
}
