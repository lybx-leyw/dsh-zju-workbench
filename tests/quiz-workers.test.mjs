import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createPointQuizGenerator,planPointQuestions,checkpointCount,planPractice} from '../packages/dsh-zhiyun-core-quiz/src/points.js';
import {rectifyQuestions} from '../packages/dsh-zhiyun-core-quiz/src/rectification.js';
import {WorkerPoolLlm} from '../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {apply} from '../packages/dsh-zhiyun-core-quiz/src/index.js';
import {fixture,fixtureCall} from '../scripts/quiz_bench/fixture.mjs';
import {datasetFrom} from '../scripts/quiz_bench/input.mjs';
const points=()=>datasetFrom(fixture).points;

test('duplicate tickets receive the full point history and batch, preserve a representative, and repair without losing quota',async()=>{
 const point=points()[1],base=fixtureCall(),history=Array.from({length:65},(_,i)=>({id:`old-${i}`,pointId:point.id,strategy:'understand',type:'shortAnswer',stem:`历史问法 ${i}`,answer:`历史答案 ${i}`,choices:[],status:'accepted'}));
 const staged=[],contexts=[];
 const generate=createPointQuizGenerator({concurrency:2,call:async r=>{
   if(r.stage!=='quiz-point-shortAnswer')return base(r);
   const d=JSON.parse(r.variable);contexts.push(d);const repair=d.questionTask.repair;
   if(repair){assert.equal(d.history.all.length,67);assert.ok(d.history.all.some(q=>q.id==='old-0'));assert.equal(d.history.all.filter(q=>q.ticketId).length,2);assert.ok(repair.previous.length);}
   return {text:JSON.stringify({items:[{conceptId:d.concepts[0].id,stem:repair?'比较两组等均值而分散程度不同的数据，说明方差差异':'说明方差描述的离散程度',answer:'依据各取值偏离均值的平方分析。',basis:d.source.slice(0,18),angle:'离散程度',rubric:['结合偏差平方分析'],variantChange:repair?'由复述定义改为比较数据的离散程度':''}]})};
 }});
 const plan=planPointQuestions([point],{count:2,types:['shortAnswer'],strategies:[{id:'understand',weight:1}]});
 const result=await generate({plan,existingQuestions:history,onQuestion:q=>staged.push(q)});
 assert.equal(result.admitted,2);assert.equal(result.checkpoint.phase,'completed');assert.equal(staged.length,3);
 const representative=result.checkpoint.tasks[0].questionIds[0],archived=result.checkpoint.tasks[1].archivedQuestionIds[0];
 assert.equal(staged.find(q=>q.id===representative).status,'proposed');assert.equal(staged.find(q=>q.id===archived).status,'rejected');
 assert.deepEqual(staged.find(q=>q.repairRound).replacesQuestionIds,[archived]);assert.equal(contexts.filter(d=>d.questionTask.repair).length,1);
});

test('persistent duplicates remain resumable after bounded repair and can change type without regenerating the representative',async()=>{
 const point=points()[1],base=fixtureCall(),staged=[],contexts=[];let resolve=false;
 const generate=createPointQuizGenerator({call:async r=>{
   if(!['quiz-point-shortAnswer','quiz-point-trueFalse'].includes(r.stage))return base(r);
   const d=JSON.parse(r.variable);contexts.push(d);const repair=d.questionTask.repair;
   return {text:JSON.stringify({items:[{conceptId:d.concepts[0].id,stem:resolve&&repair?'两组数据的均值相同是否足以断定方差相等？':'什么是方差？',answer:d.type==='trueFalse'?'错误':'方差描述离散程度。',basis:d.source.slice(0,18),angle:'定义',explanation:'均值不决定偏差的平方。',rubric:['分析偏差平方'],variantChange:'改为辨析均值与方差关系'}]})};
 }});
 const plan=planPointQuestions([point],{count:2,types:['shortAnswer'],strategies:[{id:'understand',weight:1}]});
 plan.types.push('trueFalse');
 const first=await generate({plan,onQuestion:q=>staged.push(q)});
 assert.equal(first.admitted,1);assert.equal(first.rectify.state,'needs-repair');assert.equal(first.rectify.repairPending,1);assert.equal(first.checkpoint.phase,'partial');
 assert.ok(contexts.some(d=>d.type==='trueFalse'&&d.questionTask.repair.mode==='change-type'));
 const representative=staged[0].id,previousCalls=contexts.length;resolve=true;
 const second=await generate({plan,checkpoint:first.checkpoint,existingQuestions:staged,onQuestion:q=>staged.push(q)});
 assert.equal(second.admitted,2);assert.equal(second.checkpoint.phase,'completed');
 assert.equal(contexts.length,previousCalls+1);assert.equal(second.checkpoint.tasks[0].questionIds[0],representative);
});

test('a malformed replacement is reworked instead of cancelling its ticket, and a paused repair reuses its generated candidate',async()=>{
 const point=points()[1],base=fixtureCall(),staged=[],controller=new AbortController();let checkpoint,paused=false,generated=0;
 const generate=createPointQuizGenerator({call:async r=>{
   if(r.stage!=='quiz-point-shortAnswer')return base(r);
   const d=JSON.parse(r.variable),round=d.questionTask.repair?.round??0;generated++;
   return {text:JSON.stringify({items:[{conceptId:d.concepts[0].id,stem:round>=2?'两组数据的均值相同是否必然具有相同方差？':'什么是方差？',answer:'不必然，需比较偏差平方。',basis:d.source.slice(0,18),angle:'定义',rubric:round===1?[]:['比较偏差平方'],variantChange:'用反例辨析均值与方差关系'}]})};
 }});
 const plan=planPointQuestions([point],{count:2,types:['shortAnswer'],strategies:[{id:'understand',weight:1}]}),callbacks={onQuestion:q=>staged.push(q),onCheckpoint:s=>{checkpoint=s;if(!paused&&s.tasks.some(t=>t.repair?.round===2&&t.candidates?.length)){paused=true;controller.abort();}}};
 await assert.rejects(generate({plan,signal:controller.signal,...callbacks}),{name:'AbortError'});
 assert.ok(paused);const before=generated;
 const result=await generate({plan,checkpoint,existingQuestions:staged,...callbacks});
 assert.equal(result.admitted,2);assert.equal(result.checkpoint.phase,'completed');assert.equal(generated,before,'the saved repair candidate is reviewed, not generated again');
 assert.equal(staged.length,3,'the invalid replacement never entered the bank, but its ticket survived');
});
test('an unresolved final review is held out of practice and resume retries review without regenerating questions',async()=>{
 const base=fixtureCall(),history=[],calls=[];let valid=false,checkpoint;
 const generate=createPointQuizGenerator({call:async r=>{calls.push(r.stage);if(r.stage==='quiz-rectify')return {text:valid?'{"duplicateIndexes":[]}':'bad JSON'};return base(r);}});
 const plan=planPointQuestions([points()[1]],{count:1,types:['cloze']}),callbacks={onCheckpoint:s=>{checkpoint=structuredClone(s);},onQuestion:q=>history.push(q),onRectify:({admitted,pending})=>{for(const q of history)q.reviewState=admitted.includes(q.id)?'ready':pending.includes(q.id)?'needs-review':q.reviewState;}};
 const first=await generate({plan,...callbacks});assert.equal(first.rectify.state,'needs-review');assert.equal(planPractice(history,{count:1}).length,0);
 valid=true;const count=calls.length;const result=await generate({plan,checkpoint,existingQuestions:history,...callbacks});
 assert.equal(result.rectify.state,'completed');assert.equal(result.admitted,1);assert.deepEqual(calls.slice(count),['quiz-rectify']);assert.equal(history.length,1);assert.equal(planPractice(history,{count:1}).length,1);
});
test('semantic comparison pages cover the oldest history and reject only the new question',async()=>{
 const history=Array.from({length:61},(_,i)=>({id:`old-${i}`,stem:i?'历史题目'+i:'历史最早题目',pointId:'other',status:'accepted'})),fresh={id:'new',stem:'新题目',pointId:'new-point',strategy:'apply',answer:'答案'},saved={tasks:[{questionIds:['new']}],questions:{new:fresh}},seen=[];let rejected=[];
 await rectifyQuestions({saved,plan:{recallMode:'complete'},questions:[fresh],existingQuestions:history,stagedIds:['new'],commit:work=>work(),emit:async()=>{},parallel:(items,work)=>Promise.all(items.map(work)),signal:new AbortController().signal,problems:[],onRectify:r=>{rejected=r.rejected;},requestModel:async r=>{seen.push(r.variable);return {text:JSON.stringify({duplicateIndexes:r.variable.includes('历史最早题目')?[0]:[]})};}});
 assert.equal(seen.length,2);assert.equal(rejected[0].id,'new');assert.ok(history.every(q=>q.status==='accepted'));
});
test('different points overlap, same-point types share one extraction, and commits never expose unsaved question IDs',{timeout:10000},async()=>{
  const base=fixtureCall(),activeByPoint=new Map(),extracts=new Map(),stored=new Set();let active=0,peak=0,writing=0,peakWriting=0;
  let release;const firstPair=new Promise(resolve=>{release=resolve;});
  const generate=createPointQuizGenerator({concurrency:2,call:async r=>{
    const data=JSON.parse(r.variable),title=data.title??data.source??'review';
    active++;peak=Math.max(peak,active);activeByPoint.set(title,(activeByPoint.get(title)??0)+1);assert.equal(activeByPoint.get(title),1);
    if(r.stage==='quiz-rewrite'){extracts.set(title,(extracts.get(title)??0)+1);if(extracts.size>=2)release();}
    try{if(r.stage==='quiz-rewrite')await firstPair;await delay(5);return await base(r);}finally{active--;activeByPoint.set(title,activeByPoint.get(title)-1);}
  }});
  const write=async work=>{writing++;peakWriting=Math.max(peakWriting,writing);try{await delay(2);await work();}finally{writing--;}};
  const result=await generate({plan:planPointQuestions(points(),{count:6,types:['cloze','mcq'],recallMode:'variant'}),
    onConcept:()=>write(async()=>{}),onQuestion:(q,s)=>write(async()=>{stored.add(q.id);assert.ok(s.tasks.flatMap(t=>t.questionIds).every(id=>stored.has(id)));}),
    onCheckpoint:s=>write(async()=>assert.ok(s.tasks.flatMap(t=>t.questionIds).every(id=>stored.has(id))))});
  assert.equal(result.produced,6);assert.equal(stored.size,6);assert.equal(peak,2);assert.equal(peakWriting,1);
  assert.equal(extracts.size,3);assert.ok([...extracts.values()].every(n=>n===1));
});
test('a failed atomic question write aborts sibling lanes and cannot publish its cursor',{timeout:10000},async()=>{
  const stored=new Set(),base=fixtureCall();let failed=false,afterFailure=0;
  const generate=createPointQuizGenerator({concurrency:3,call:async r=>{await delay(2);return base(r);}});
  await assert.rejects(generate({plan:planPointQuestions(points(),{count:3,types:['cloze']}),onQuestion:async()=>{failed=true;throw new Error('synthetic storage failure');},
    onCheckpoint:async s=>{if(failed)afterFailure++;assert.equal(checkpointCount(s),stored.size);}}),{code:'PERSIST'});
  assert.ok(failed);assert.equal(afterFailure,0);
});
test('three questions for the same point run concurrently, each provider respects its quota, and text-only models work',{timeout:10000},async()=>{
  const base=fixtureCall(),active=new Map(),peaks=new Map(),calls=new Map();let service;
  let release,started=0;const questionGate=new Promise(resolve=>{release=resolve;});
  const llm={llm:{resolveModelInfo:async()=>({inputModalities:['text']})},
    resolve:async(_signal,{selection,vision}={})=>{assert.equal(vision,false);return {text:selection};},
    call:async r=>{const name=r.route.provider;active.set(name,(active.get(name)??0)+1);peaks.set(name,Math.max(peaks.get(name)??0,active.get(name)));calls.set(name,(calls.get(name)??0)+1);
      try{if(r.stage==='quiz-point-mcq'){started++;if(started===3)release();await questionGate;}await delay(5);return await base(r);}finally{active.set(name,active.get(name)-1);}}
  };
  const cleanup=await apply({provide:(_name,value)=>{service=value;return()=>{};}},{llm});
  // 池由集成层构造后注入 —— 出题包零依赖，不自己 new worker 池。
  const run=service.createRun({pool:new WorkerPoolLlm({base:llm,entries:[{provider:'a',model:'text-a',workers:1},{provider:'b',model:'text-b',workers:2}]})});
  try{
    const result=await run.generatePoints({plan:planPointQuestions([points()[1]],{count:3,types:['mcq']}),onQuestion:async()=>{}});
    assert.equal(result.produced,3);assert.equal(run.concurrency,3);assert.ok(calls.get('a')>0&&calls.get('b')>0);
    assert.equal(started,3);assert.equal(peaks.get('a'),1);assert.equal(peaks.get('b'),2);
    assert.ok(run.workers.every(row=>row.active===0));
  }finally{run.dispose();cleanup();}
});
