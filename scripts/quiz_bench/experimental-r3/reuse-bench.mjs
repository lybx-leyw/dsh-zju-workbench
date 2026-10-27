/** Matched-task reuse experiment. Credentials and real materials stay in ignored artifacts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareCase} from './compare.mjs';
import {compileIdeas,createScheduler,createQuestionGenerator,createCapsuleStore,projectTeachingBooks,reserveWithExpansion,openState,walkTree,createToolTransport} from './index.mjs';
import {deepTutorBenchHost} from '../deeptutor-host.mjs';
import {tokenLedger,timingLedger} from '../accounting.mjs';
import {WorkerPoolLlm} from '../../../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function kernels(){const out={};for(const dir of ['experimental','experimental-r3'])for(const f of await fs.readdir('scripts/quiz_bench/'+dir))if(f.endsWith('.mjs'))out[dir+'/'+f]=hash(await fs.readFile('scripts/quiz_bench/'+dir+'/'+f));return out;}
export async function runReuseBench({spec,out,credentials}){
 if(spec.model&&credentials.model!==spec.model)throw Error('模型与预注册不一致，不能更换模型提高分数');
 const dir=path.resolve(out),allowed=path.resolve('artifacts');if(!dir.startsWith(allowed+path.sep))throw Error('输出必须在artifacts独立目录');await fs.mkdir(dir,{recursive:true});if((await fs.readdir(dir)).length&&!spec.resume)throw Error('必须使用空输出目录，恢复需显式resume');
 const read=async(p,fallback)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const write=(p,v)=>fs.writeFile(path.join(dir,p),JSON.stringify(v,null,2)+'\n'),newKernel=await kernels(),manifest=await read(path.join(dir,'manifest.json'),null)??{model:credentials.model,workers:2,protocol:'matched-assets-r10-v1',batches:[2,2,2],kernel:newKernel,cases:[],runs:[],startedAt:new Date().toISOString()};if(spec.resume){for(const [file,h]of Object.entries(manifest.kernel))if(file!=='experimental-r3/reuse-bench.mjs'&&newKernel[file]!==h)throw Error('恢复时语义内核变化：'+file);manifest.resumedKernel=newKernel;}await write('manifest.json',manifest);
 async function session(id){
  const home=path.join(dir,id);await fs.mkdir(home,{recursive:true});const calls=await read(path.join(home,'calls.json'),[]),attempts=await read(path.join(home,'attempts.json'),[]),trace=await read(path.join(home,'trace.json'),[]),offset=Math.max(0,...attempts.map(r=>r.index));let writes=Promise.resolve();
  const save=(name,data)=>{const text=JSON.stringify(data,null,2);writes=writes.then(()=>fs.writeFile(path.join(home,name),text));return writes;};
  const host=deepTutorBenchHost({...credentials,maxCalls:Math.max(0,160-attempts.filter(e=>e.status==='started').length),onCall:r=>{calls.push({...r,index:r.index+offset});return save('calls.json',calls);},onAttempt:r=>{attempts.push({...r,index:r.index+offset});return save('attempts.json',attempts);}}),transport=createToolTransport(spec.maxOutputTokens?{...host,prepareCall:(config,signal)=>host.prepareCall({...config,maxTokens:spec.maxOutputTokens},signal)}:host);
  const pool=new WorkerPoolLlm({base:{llm:host,resolve:async()=>({text:{provider:'bench',model:credentials.model}}),call:async request=>{trace.push({stage:request.stage,input:JSON.parse(request.variable),tools:request.tools.map(t=>t.name)});await save('trace.json',trace);console.log(JSON.stringify({event:'model',id,stage:request.stage}));return transport(request);}},entries:[{provider:'bench',model:credentials.model,workers:2}]});
  return {home,calls,attempts,call:r=>pool.call(r),flush:()=>writes};
 }
 async function phase(id,s,work){
  console.log(JSON.stringify({event:'start',id}));const start=Date.now(),from=s.calls.length,ev=s.attempts.length;let result,error;
  try{result=await work(AbortSignal.timeout(600000));}catch(e){error={name:e.name,message:String(e.message).split(credentials.apiKey).join('[REDACTED]'),code:e.code,cause:e.cause?{code:e.cause.code,message:String(e.cause.message).split(credentials.apiKey).join('[REDACTED]')}:undefined};}
  await s.flush();const elapsedMs=Date.now()-start,events=s.attempts.slice(ev),report={id,elapsedMs,result,error,tokens:tokenLedger(s.calls.slice(from),{attempts:events.filter(e=>e.status==='started').length}),timing:timingLedger(events,{wallMs:Math.max(elapsedMs,1),slots:2,delivered:result?.produced??0})};await write(id+'-attempt'+manifest.runs.filter(r=>r.id===id).length+'.json',report);await write(id+'.json',report);
  manifest.runs.push({...report,result:undefined,produced:result?.produced,state:result?.state});await write('manifest.json',manifest);console.log(JSON.stringify({event:'finish',...manifest.runs.at(-1)}));if(error)throw Error(id+': '+error.message);return result;
 }
 for(const c of spec.cases){
  const setup=await session(c.id+'-setup');let library,inheritedTokens=0;
  const existingLibrary=await read(path.join(dir,c.id+'-library.json'),null);
  if(existingLibrary){library=existingLibrary;inheritedTokens=manifest.cases.find(x=>x.id===c.id)?.inheritedCompileTokens??0;}
  else if(c.cachedState){const saved=JSON.parse(await fs.readFile(c.cachedState,'utf8'));library=structuredClone(saved.library);inheritedTokens=c.inheritedCompileTokens??0;}
  else{const {graph}=await prepareCase(c);const compiled=await phase(c.id+'-compile',setup,signal=>compileIdeas({graph,call:setup.call,concurrency:2,allowPartialTitles:true,signal}));const {cache,...asset}=compiled;library=asset;}
  // Fixed serialized first understand target at each leaf, without looking at quality outcomes.
  const leaves=[];for(const {node}of walkTree(library.root)){if(node.children.length){node.ideas=[];continue;}node.ideas=node.ideas.filter(i=>i.strategy==='understand').slice(0,1);if(!node.ideas.length)throw Error('叶节点没有理解考法，不能临时改挑更容易的目标');leaves.push(node);}
  if(leaves.length!==2)throw Error('本实验固定两叶、三批各一题，避免配额变动混入复用比较');if(!existingLibrary)library.key=hash(JSON.stringify([library.key,'fixed-first-understand-v1',leaves.map(n=>n.ideas[0])]));
  let extensions=await read(path.join(dir,c.id+'-extensions.json'),null);
  const oldSetup=await read(path.join(dir,c.id+'-variant-setup.json'),null);
  if(!extensions&&oldSetup?.result?.tickets){extensions={};for(const t of oldSetup.result.tickets){const own=leaves.find(n=>n.nodeId===t.nodeId).ideas.find(i=>i.id===t.ideaId);if(!own.variants.some(v=>v.key===t.variant.key)){extensions[own.id]??=[];if(!extensions[own.id].some(v=>v.key===t.variant.key))extensions[own.id].push(t.variant);}}}
  const shared=createScheduler({library});
  if(!extensions)await phase(c.id+'-variant-setup',setup,signal=>reserveWithExpansion({library,scheduler:shared,request:{count:6,types:['mcq'],strategies:['understand'],scope:'local',quotas:Object.fromEntries(leaves.map(n=>[n.nodeId,3])),requestId:'shared-plan'},call:setup.call,concurrency:2,signal}));
  extensions??=shared.snapshot.extensions;await write(c.id+'-extensions.json',extensions);await write(c.id+'-library.json',library);if(!manifest.cases.some(x=>x.id===c.id))manifest.cases.push({id:c.id,libraryKey:library.key,inheritedCompileTokens:inheritedTokens,selected:leaves.map(n=>({nodeId:n.nodeId,ideaKey:n.ideas[0].key,target:n.ideas[0].target,operation:n.ideas[0].operation}))});await write('manifest.json',manifest);
  const arms={};for(const mode of ['raw','assets']){
   const s=await session(c.id+'-'+mode),state=await openState(path.join(s.home,'state')),scheduler=createScheduler({library,ledger:state.snapshot.ledger??{extensions},onCheckpoint:ledger=>state.update(v=>({...v,ledger}))}),capsules=mode==='assets'?createCapsuleStore({cache:state.snapshot.capsules,call:s.call,cacheScope:credentials.model,onCheckpoint:capsules=>state.update(v=>({...v,capsules}))}):null;
   arms[mode]={s,state,scheduler,capsules,generate:createQuestionGenerator({library,scheduler,call:s.call,concurrency:2,capsules,blind:mode==='assets'})};
  }
  for(let batch=0;batch<3;batch++)for(const mode of batch%2?['assets','raw']:['raw','assets']){
   const a=arms[mode],id=`${c.id}-${mode}-batch${batch}`;if(manifest.runs.some(r=>r.id===id&&!r.error))continue;
   await phase(id,a.s,async signal=>{const plan=await a.scheduler.reserve({count:2,types:['mcq'],scope:'local',strategies:['understand'],quotas:Object.fromEntries(leaves.map(n=>[n.nodeId,1])),requestId:'batch'+batch});return a.generate(plan.id,{signal});});
   if(a.capsules)await write(c.id+'-books.json',await projectTeachingBooks(library,a.capsules.snapshot,{cacheScope:credentials.model}));
  }
 }
 manifest.kernelAfter=await kernels();if(JSON.stringify(newKernel)!==JSON.stringify(manifest.kernelAfter))throw Error('实验期间源码变化');manifest.finishedAt=new Date().toISOString();await write('manifest.json',manifest);return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [spec,out]=process.argv.slice(2),env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).flatMap(l=>{const i=l.indexOf('=');return i>0?[[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]:[]}));if(!spec||!out||!env.APIkey)throw Error('需要规格、输出目录和.env凭证');await runReuseBench({spec:{...JSON.parse(await fs.readFile(spec,'utf8')),resume:process.argv[4]==='resume'},out,credentials:{apiKey:env.APIkey,baseUrl:env.BaseURL,model:env.ModelName}});
}
