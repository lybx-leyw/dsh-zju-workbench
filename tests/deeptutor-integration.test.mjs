import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createLlmBridge,toHostMessages} from '../packages/dsh-zhiyun-host-deeptutor/src/models.js';
import {withWireOptions} from '../packages/dsh-zhiyun-host-deeptutor/src/wire-options.js';
import {createService} from '../packages/dsh-zhiyun-host-deeptutor/src/service.js';
import {createResourceRegistry} from '../packages/dsh-zhiyun-host-deeptutor/src/resources.js';
import {validate,contentHash,revisionOf,fromLecture,project} from '../packages/dsh-zhiyun-core-learning-resource/src/index.js';
import {createDeepTutorCandidateCall,normalizeUpstreamQuestion} from '../packages/dsh-zhiyun-core-study/src/deeptutor-quiz.js';
import {createRunStore} from '../packages/dsh-zhiyun-host-deeptutor/src/run-store.js';
import {deepTutorBenchHost} from '../scripts/quiz_bench/deeptutor-host.mjs';

test('assistant tool calls remain paired with tool results in host history',()=>{
  const messages=toHostMessages([{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'lookup',arguments:'{"q":"test"}'}}]},{role:'tool',tool_call_id:'c1',content:'answer'}],{provider:'p',model:'m'});
  assert.deepEqual(messages[0].content,[{type:'tool-call',id:'c1',name:'lookup',arguments:'{"q":"test"}'}]);
  assert.equal(messages[1].source.callId,'c1');
});

test('model callbacks use their registered run selection without a global default model',async()=>{
 let route;
 const bridge=createLlmBridge({llm:{resolveModelInfo:async()=>({}),prepareCall:async config=>{route=config;return {config,async *stream(){yield {type:'text-delta',text:'synthetic'};}};}}});
 bridge.registerRun('selected-run',[{provider:'selected-provider',model:'selected-model',workers:1}]);
 try{
  await bridge.handleRequest('llm.complete',{runId:'selected-run',model:'selected-model',provider:null,messages:[{role:'user',content:'synthetic'}]});
  assert.equal(route.provider,'selected-provider');assert.equal(route.model,'selected-model');
 }finally{await bridge.dispose();}
});

test('Python history normalization, Node model bridge and HTTP transport preserve a complete tool round trip',async t=>{
  const python=fileURLToPath(new URL('../.runtime/deeptutor-py311/Scripts/python.exe',import.meta.url));
  if(!existsSync(python))return t.skip('需要受管 Python 3.11 解释器');
  const script=fileURLToPath(new URL('../packages/dsh-zhiyun-host-deeptutor/python',import.meta.url));
  const code='import sys,json;sys.path.insert(0,sys.argv[1]);from llm_shim import build_params,set_selection;set_selection({"provider":"p","model":"m"});print(json.dumps(build_params(prompt="",messages=[{"role":"assistant","content":None,"tool_calls":[{"id":"c1","type":"function","function":{"name":"lookup","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"result"},{"role":"user","content":"continue"}])))';
  const {stdout}=await promisify(execFile)(python,['-c',code,script]);
  let received;
  const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;received=JSON.parse(text);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'ok'}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const bridge=createLlmBridge({llm:deepTutorBenchHost({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'fixture-key',model:'m'}),selection:()=>({provider:'p',model:'m'})});
  try{const result=await bridge.handleRequest('llm.complete',JSON.parse(stdout));assert.equal(result.content,'ok');assert.equal(received.messages[0].tool_calls[0].id,'c1');assert.equal(received.messages[1].tool_call_id,'c1');assert.equal(received.messages[1].role,'tool');}
  finally{await bridge.dispose();await new Promise(resolve=>server.close(resolve));}
});

test('upstream fill-in blanks map to product notation without guessing or rewriting answers',()=>{
  assert.equal(normalizeUpstreamQuestion({type:'cloze',stem:'电容 C = ____。',answer:'Q/U'}).stem,'电容 C = {{c1::Q/U}}。');
  assert.equal(normalizeUpstreamQuestion({type:'cloze',stem:'____ 和 ____',answer:['甲','乙']}).answer,'甲;乙');
  assert.throws(()=>normalizeUpstreamQuestion({type:'cloze',stem:'____ 和 ____',answer:'甲，乙'}),/无歧义/);
  assert.equal(normalizeUpstreamQuestion({type:'trueFalse',stem:'判断',answer:false}).answer,'错误');
});

test('structured-output constraints reach the wire and concurrent overrides are isolated',async()=>{
  const received=[];
  const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;received.push(JSON.parse(text));res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/chat/completions`;
    await Promise.all([1,2].map(seed=>withWireOptions({responseFormat:{type:'json_object'},wireOptions:{seed}},async()=>{
      await fetch(url,{method:'POST',body:JSON.stringify({messages:[{role:'user',content:String(seed)}]})});
    })));
    assert.equal(received.length,2);
    for(const body of received){assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.seed,Number(body.messages[0].content));}
    await assert.rejects(withWireOptions({responseFormat:{type:'json_object'}},async()=>({text:'unconstrained'})),e=>e.kind==='E_CAPABILITY_UNAVAILABLE');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('all model callbacks acquire quota, enforce workers, and cancellation releases slots',async()=>{
  let active=0,peak=0,acquired=0,released=0;
  const bridge=createLlmBridge({selection:()=>({provider:'p',model:'m'}),quota:{acquire:async()=>{acquired++;return {granted:true};},release:async()=>{released++;}},
    llm:{resolveModelInfo:async()=>({}),prepareCall:async(config,signal)=>({config,async *stream(){active++;peak=Math.max(peak,active);try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,25);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});yield {type:'text-delta',index:0,text:'ok'};}finally{active--;}}})}});
  bridge.registerRun('r',[{provider:'p',model:'m',workers:2}]);
  const params={runId:'r',messages:[{role:'user',content:'test'}]};
  await Promise.all(Array.from({length:5},()=>bridge.handleRequest('llm.complete',params)));
  assert.equal(peak,2);assert.equal(acquired,5);assert.equal(released,5);
  const pending=bridge.handleRequest('llm.complete',params);await new Promise(r=>setTimeout(r,5));bridge.cancelRun('r');
  await assert.rejects(pending,e=>e.kind==='E_CANCELLED');assert.equal(acquired,released);await bridge.dispose();
});

test('registered selected resource text and anchors reach upstream; cache keys include config and account',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dt-integration-'));let listener;const calls=[];
  const registry=createResourceRegistry({dataDir:dir,snapshotsDir:join(dir,'snapshots'),validate,contentHash,revision:revisionOf,project});
  const bundle=fromLecture({accountScope:{accountId:'a'},courseId:'c',subId:'s',lecture:{chapters:[{title:'ch',topics:[{title:'selected',blocks:[{kind:'paragraph',text:'真实讲义正文用于验证资料能够送达模型。',page:3}]},{title:'excluded',blocks:[{kind:'paragraph',text:'不得送达的未选内容。'}]}]}]},selectedTopicIds:['t1-1']});
  try{
    const handle=await registry.attach(bundle);
    const bridge={state:()=> 'ready',onNotification:fn=>{listener=fn;return()=>{};},request:async(method,params)=>{calls.push(params);queueMicrotask(()=>listener('run.result',{runId:params.runId,status:'succeeded',result:{response:'ok'}}));return {turnId:'turn'};}};
    const service=createService({bridge,resources:registry,catalog:{get:async name=>({name,upstream:true,depsAvailable:true,configured:true,exposed:true})},config:{python:{ok:true,version:'3.11.9'},deps:{installed:true}}});
    const args={capability:'deep_question',scope:'a',resourceHandles:[handle],input:'generate',options:{config:{count:1}}};
    const first=await service.runs.start(args);await service.runs.result(first.runId);
    assert.match(calls[0].resources[0].text,/真实讲义/);assert.doesNotMatch(calls[0].resources[0].text,/不得送达/);assert.equal(Object.values(calls[0].resources[0].anchorIndex)[0].page,3);
    assert.equal((await service.runs.start(args)).cached,true);
    const changed=await service.runs.start({...args,options:{config:{count:6}}});assert.notEqual(changed.runId,first.runId);await service.runs.result(changed.runId);
    await assert.rejects(service.runs.start({...args,scope:'b'}),e=>e.kind==='E_RESOURCE_INVALID');
    await service.dispose();
  }finally{await registry.dispose();await rm(dir,{recursive:true,force:true});}
});

test('page candidate path invokes upstream, forwards shared workers and preserves immutable question with provenance',async()=>{
  let started,released=false;const point={id:'p1',title:'topic',text:'资料中有连续八个字以上的可核对依据。',courseId:'c',subId:'s',page:2,blockIndexes:[0]};
  const candidate={type:'mcq',stem:'upstream stem',answer:'A',options:{A:'one',B:'two',C:'three',D:'four'},explanation:'original explanation',anchors:[{page:2}]};
  const call=createDeepTutorCandidateCall({scope:'a',points:[point],resources:{fromLecture},pool:{snapshot:[{provider:'p',model:'m',workers:2}],execute:async work=>work({provider:'p',model:'m'}),call:async()=>({text:JSON.stringify({items:[{stem:'altered',answer:'B',basis:point.text,conceptId:'c1',angle:'a'}]})})},tutor:{resources:{attach:async()=>({handleId:'h',revision:'v1'}),release:async()=>{released=true;}},runs:{start:async request=>{started=request;return {runId:'r'};},events:async function*(){yield {kind:'stage-start',stage:'exploring'};},result:async()=>({status:'succeeded',questions:[candidate],fingerprint:'f'}),cancel:async()=>{}}}});
  const out=JSON.parse((await call({stage:'quiz-point-mcq',constant:'generate',variable:JSON.stringify({title:point.title,source:point.text,type:'mcq'}),signal:new AbortController().signal})).text).items[0];
  assert.equal(out.stem,candidate.stem);assert.equal(out.answer,'A');assert.equal(out.explanation,candidate.explanation);assert.equal(out.choices.length,4);assert.equal(out.provenance.runId,'r');assert.equal(started.options.mode,'integrated-parallel');assert.equal(typeof started.modelDispatch,'function');assert.equal(released,true);
  assert.equal(started.options.config.num_questions,1);assert.deepEqual(started.options.config.question_types,['choice']);assert.equal(started.options.config.topic,undefined,'topic must not replace the resource-bearing user content');
});

test('a cold service reuses durable adapted results across new resource handles',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dt-cold-'));let listener,calls=0;
  const bridge={state:()=> 'ready',onNotification:fn=>{listener=fn;return()=>{};},request:async(method,params)=>{calls++;queueMicrotask(()=>listener('run.result',{runId:params.runId,status:'succeeded',result:{questions:[{question_type:'choice',question:'Which?',options:{A:'1',B:'2',C:'3',D:'4'},correct_answer:'A',explanation:'Because.'}]}}));return {turnId:'t'};}};
  const make=()=>createService({bridge,runStore:createRunStore({runsDir:dir}),catalog:{get:async name=>({name,upstream:true,depsAvailable:true,configured:true,exposed:true})},config:{python:{ok:true,version:'3.11.9'},deps:{installed:true}}});
  const args={capability:'deep_question',scope:'a',resourceHandles:[{handleId:'h1',resourceId:'r',revision:'v1'}],input:'question',options:{config:{num_questions:1}}};
  try{
    const first=make(),run=await first.runs.start(args),result=await first.runs.result(run.runId);assert.equal(result.questions.length,1);await first.dispose();
    const cold=make(),cached=await cold.runs.start({...args,resourceHandles:[{handleId:'h2',resourceId:'r',revision:'v1'}]});assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal((await cold.runs.result(cached.runId)).questions[0].stem,'Which?');
    const other=await cold.runs.start({...args,scope:'b'});await cold.runs.result(other.runId);assert.equal(calls,2);await cold.dispose();
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a failed result write is reported instead of advertising a recoverable result',async()=>{
  let listener;
  const service=createService({bridge:{state:()=> 'ready',onNotification:fn=>{listener=fn;return()=>{};},request:async(_method,params)=>{queueMicrotask(()=>listener('run.result',{runId:params.runId,status:'succeeded',result:{response:'ok'}}));return {};}},runStore:{writeResult:async()=>{throw new Error('disk full');}},catalog:{get:async name=>({name,upstream:true,depsAvailable:true,configured:true,exposed:true})},config:{python:{ok:true,version:'3.11.9'},deps:{installed:true}}});
  const run=await service.runs.start({capability:'chat',input:'hi'});await assert.rejects(service.runs.result(run.runId),e=>e.kind==='E_INTERNAL');await service.dispose();
});
