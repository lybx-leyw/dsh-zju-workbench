import test from 'node:test';
import assert from 'node:assert/strict';
import {createPointQuizGenerator,planPointQuestions} from '../packages/dsh-zhiyun-core-quiz/src/points.js';
import {parseConcepts,conceptCacheKey} from '../packages/dsh-zhiyun-core-quiz/src/concepts.js';
import {syntheticFactAudit,syntheticSourceCheck,syntheticProofReview} from '../scripts/quiz_bench/fixture.mjs';

const first='概率是随机事件发生可能性的度量。',second='互斥事件的概率可由各事件概率相加得到。';
const point={id:'point',title:'概率定义',courseId:'course',subId:'lesson',courseTitle:'合成课程',lessonTitle:'合成节次',blockIndexes:[1],text:first+'\n'+second};
const concept=(statement,words)=>({statement,blanks:words.map(text=>({text,start:statement.indexOf(text)}))});
const initial=()=>JSON.stringify({concepts:[concept(first,['概率'])]});
const added=()=>JSON.stringify({concepts:[concept(second,['互斥事件','相加'])]});
const plan=(extra={})=>planPointQuestions([point],{count:1,types:['cloze'],...extra});
function harness({completion=added,review=true}={}) {
  const cache={},history=[],calls=[],inputs=[];
  const call=async request=>{
    calls.push(request.stage);const input=JSON.parse(request.variable);inputs.push({stage:request.stage,input});
    if(request.stage==='quiz-fact-audit')return syntheticFactAudit(input);
    if(request.stage==='quiz-source-check')return syntheticSourceCheck();
    if(request.stage==='quiz-source-proof-review')return syntheticProofReview(input);
    if(request.stage==='quiz-rewrite')return {text:initial()};
    if(request.stage==='quiz-concept-complete')return {text:completion()};
    if(request.stage==='quiz-concept-complete-review')return {text:JSON.stringify({verdicts:input.concepts.map(c=>({candidateId:c.candidateId,valid:true,novel:review}))})};
    if(request.stage==='quiz-point-review')return {text:JSON.stringify({verdicts:input.items.map((_,index)=>({index,valid:true,novel:true,targetMatched:true}))})};
    const c=input.concepts[0],b=c.blanks[0];
    return {text:JSON.stringify({items:[{targetId:input.targets?.[0]?.id,conceptId:c.id,blankId:b.id,angle:'记忆：'+b.text,stem:'哪个选项符合所述定义？',answer:'A',basis:c.basis,explanation:c.statement,choices:['概率','方差','期望','频数'].map((text,i)=>({label:'ABCD'[i],text}))}]})};
  };
  const generate=createPointQuizGenerator({call,random:()=>.5});
  const run=async(extra={})=>generate({plan:plan(),conceptCache:cache,existingQuestions:history,existingStems:history.map(q=>q.stem),onConcept:(key,value)=>{cache[key]=structuredClone(value);},onQuestion:q=>history.push(q),...extra});
  return {cache,history,calls,inputs,generate,run};
}

test('later recall batches discover a previously omitted concept, verify it and prioritize its question',async()=>{
  const h=harness();assert.equal((await h.run()).produced,1);const original=h.history[0].conceptId;
  assert.equal(h.calls.filter(s=>s!=='quiz-rectify').length,2,'initial extraction and focused fact audit are independent of history');
  assert.equal((await h.run()).produced,1);
  assert.notEqual(h.history[1].conceptId,original);assert.ok(h.history[1].basis.includes('互斥事件'));
  const entry=h.cache[await conceptCacheKey(point)];assert.equal(entry.concepts.length,2);assert.equal(entry.concepts[0].id,original);
  const input=h.inputs.find(r=>r.stage==='quiz-concept-complete').input;
  assert.equal(input.source,point.text);assert.equal(input.history[0].stem,h.history[0].stem);assert.equal(input.history[0].answer,h.history[0].answer);
  assert.equal(entry.completion.addedConceptIds.length,1);assert.equal(entry.completion.addedBlankIds.length,2);
});

test('a later answer-form shortage triggers one completion before the first task consumes the point',async()=>{
  const h=harness(),p=plan();p.count=3;p.types=['mcq','cloze'];
  p.tasks=[{...p.tasks[0],type:'mcq',count:1},{...p.tasks[0],type:'cloze',count:2}];
  const result=await h.run({plan:p});assert.equal(result.produced,3);
  assert.equal(h.calls.filter(s=>s==='quiz-concept-complete').length,1);
  assert.ok(h.calls.indexOf('quiz-concept-complete')<h.calls.indexOf('quiz-point-mcq'));
});

test('same statement may gain a meaningful new position without changing its concept or old blank IDs',async()=>{
  const h=harness({completion:()=>JSON.stringify({concepts:[concept(first,['随机事件'])]})});await h.run();
  const before=structuredClone(h.cache[await conceptCacheKey(point)]);await h.run();const after=h.cache[await conceptCacheKey(point)];
  assert.equal(after.concepts.length,1);assert.equal(after.concepts[0].id,before.concepts[0].id);assert.deepEqual(after.concepts[0].blanks[0],before.concepts[0].blanks[0]);
  assert.equal(after.concepts[0].blanks.length,2);assert.equal(after.completion.addedConceptIds.length,0);assert.equal(h.history[1].answer,'随机事件');
});

test('variant-only path does not complete concepts or send historical question text to generation/review',async()=>{
  const h=harness();await h.run();const before=h.calls.length;
  await h.run({plan:plan({recallMode:'variant',types:['mcq']})});
  assert.deepEqual(h.calls.slice(before).filter(s=>s!=='quiz-rectify'),['quiz-point-mcq','quiz-point-review']);
  for(const request of h.inputs.filter(r=>r.stage==='quiz-point-mcq'||r.stage==='quiz-point-review')){
    assert.deepEqual(request.input.history.examples,[]);assert.ok(!JSON.stringify(request.input.history).includes(h.history[0].stem));
  }
  assert.equal(Object.values(h.cache)[0].concepts.length,1);
});

test('completion includes first-class history across answer forms and excludes application questions',async()=>{
  const h=harness();await h.run();
  h.history.push({...h.history[0],id:'understanding',strategy:'understand',type:'trueFalse',stem:'概念边界判断'},
    {...h.history[0],id:'application',strategy:'apply',type:'shortAnswer',stem:'应用计算题'});
  await h.run();
  const input=h.inputs.find(r=>r.stage==='quiz-concept-complete').input;
  assert.deepEqual(input.history.map(q=>q.id),[h.history[0].id,'understanding']);
});

test('duplicate increments and rejected semantic novelty never inflate the concept library',async()=>{
  for(const options of [{completion:initial},{review:false}]){
    const h=harness(options);await h.run();const key=await conceptCacheKey(point),original=structuredClone(h.cache[key].concepts);
    assert.equal((await h.run()).produced,0);assert.deepEqual(h.cache[key].concepts,original);
    const before=h.calls.length;await h.run();assert.equal(h.calls.length,before,'same-history negative completion is reused instead of repeatedly paid for');
  }
});

test('completion without original evidence fails closed and preserves all old concepts',async()=>{
  const h=harness({completion:()=>JSON.stringify({concepts:[concept('并非课内原文的定义不能成为有效考点。',['定义'])]})});await h.run();
  const before=structuredClone(Object.values(h.cache)[0].concepts),result=await h.run();
  assert.equal(result.produced,0);assert.deepEqual(Object.values(h.cache)[0].concepts,before);
  assert.ok(!h.calls.includes('quiz-concept-complete-review'));
});

test('pause after completion candidates preserves them and only resumes the unfinished review',async()=>{
  const h=harness();await h.run();const controller=new AbortController();let checkpoint;
  await assert.rejects(h.run({signal:controller.signal,onCheckpoint:value=>{checkpoint=structuredClone(value);if(value.phase==='completion-generated')controller.abort();}}));
  assert.equal(Object.values(checkpoint.completions)[0].candidates.concepts.length,1);
  const calls=h.calls.length;const result=await h.run({checkpoint});
  assert.equal(result.produced,1);assert.deepEqual(h.calls.slice(calls).filter(s=>s!=='quiz-rectify'),['quiz-concept-complete-review','quiz-fact-audit']);
  assert.equal(Object.values(h.cache)[0].concepts.length,2);
});

test('resume reconciles a committed library even if the job cursor was interrupted before saving',async()=>{
  const h=harness();await h.run();const controller=new AbortController();let checkpoint;
  await assert.rejects(h.run({signal:controller.signal,
    onConcept:(key,value)=>{h.cache[key]=structuredClone(value);if(value.completion)controller.abort();},
    onCheckpoint:value=>{if(controller.signal.aborted)throw Error('job save interrupted');checkpoint=structuredClone(value);}}));
  assert.equal(Object.values(h.cache)[0].concepts.length,2);const before=h.calls.length;
  assert.equal((await h.run({checkpoint})).produced,1);assert.deepEqual(h.calls.slice(before).filter(s=>s!=='quiz-rectify'),['quiz-fact-audit']);
  assert.equal(Object.values(h.cache)[0].concepts.length,2);
});

test('rejected or empty audits are retried after relevant history changes, not after variant-only requests',async()=>{
  const h=harness({completion:()=>JSON.stringify({concepts:[]})});await h.run();await h.run();const before=h.calls.length;
  await h.run();assert.equal(h.calls.length,before);
  h.history.push({...h.history[0],id:'new-history',strategy:'understand',angle:'另一记忆角度'});await h.run();
  assert.equal(h.calls.filter(s=>s==='quiz-concept-complete').length,2);
  assert.throws(()=>plan({recallMode:'unknown'}),{code:'INPUT'});
});
