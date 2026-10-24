import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {knowledgeChapters,knowledgePoints,planPointQuestions,planPractice,createPointQuizGenerator} from '../packages/dsh-zhiyun-core-quiz/src/points.js';
import {StudyWorkbench} from '../packages/dsh-zhiyun-core-study/src/workbench.js';
import {mountKnowledge} from './fixtures/study-storage.mjs';
import {parseConcepts,conceptCacheKey,nearDuplicate} from '../packages/dsh-zhiyun-core-quiz/src/concepts.js';

const text='随机事件发生可能性的度量称为概率，概率的取值在零和一之间。';
const record=(courseId='10',subId='20',accountId='fixture')=>({accountId,courseId,subId,sourceId:`source-${courseId}-${subId}`,schema:2,status:'ready',fetchedAt:'2026-01-01T00:00:00Z',sourceVersion:'source-v1',
  sentences:[],blocks:[{index:1,page:1,sentenceFrom:1,sentenceTo:1,startMs:1000,bridge:'',tag:{role:'主线',summary:'概率',facets:['定义']},sentences:[{startMs:1000,endMs:2000,text}]}],
  spine:'',outline:[],warnings:[],vocabulary:[],pages:[],unassignedSentences:[],failedPages:[],
  semanticPlan:[{title:'第一章',topics:[{title:'概率定义',from:1,to:1}]}],
  lecture:{generationVersion:'architecture-v4',revision:'lecture-v1',chapters:[{title:'第一章',topics:[{title:'概率定义',sourceBlockIndexes:[1],blocks:[{kind:'definition',text,sourceBlockIndexes:[1]}]}]}]}});
const sourcePoints=Array.from({length:12},(_,i)=>({id:`p-${i}`,title:`点 ${i}`}));

test('uniform allocation conserves total and differs by at most one, including fewer questions than points',()=>{
  for(let count=1;count<=100;count++){
    const plan=planPointQuestions(sourcePoints,{count,mode:'uniform'});
    const counts=sourcePoints.map(point=>plan.tasks.filter(t=>t.point.id===point.id).reduce((sum,t)=>sum+t.count,0));
    assert.equal(counts.reduce((a,b)=>a+b),count);assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
    assert.equal(plan.coveredPoints,Math.min(count,sourcePoints.length));
  }
});
test('random allocation caps distinct coverage at two thirds and preserves repeated exam points',()=>{
  for(let n=1;n<=30;n++){
    const points=Array.from({length:n},(_,i)=>({id:String(i)}));
    const plan=planPointQuestions(points,{count:100,mode:'random'});
    assert.ok(plan.coveredPoints<=Math.max(1,Math.floor(n*2/3)));
    assert.equal(plan.tasks.reduce((sum,t)=>sum+t.count,0),100);
  }
  assert.throws(()=>planPointQuestions(sourcePoints,{count:0}),{code:'INPUT'});
  assert.throws(()=>planPointQuestions(sourcePoints,{count:1,types:['invalid']}),{code:'INPUT'});
});
test('knowledge point material follows the lecture topic and only anchors to main blocks',()=>{
  const r=record();r.blocks.push({...r.blocks[0],index:2,tag:{role:'支线'},sentences:[{text:'支线内容'}]});
  const [point]=knowledgePoints(r);assert.equal(point.text,text);assert.deepEqual(point.blockIndexes,[1]);
  assert.notEqual(point.id,knowledgePoints({...r,lecture:{...r.lecture,revision:'new'}})[0].id);
});
test('mixed practice alternates unseen and attempted questions without duplicates; shortage is explicit to caller',()=>{
  const items=Array.from({length:8},(_,i)=>({id:String(i),type:i%2?'mcq':'cloze',status:'proposed',attempts:i<4?[]:[{id:'attempt'}]}));
  const mixed=planPractice(items,{mode:'mixed',count:8});
  assert.deepEqual(mixed.map(q=>Boolean(q.attempts.length)),[false,true,false,true,false,true,false,true]);
  assert.equal(new Set(mixed.map(q=>q.id)).size,8);
  assert.equal(planPractice(items,{mode:'review',count:10}).length,4);
  assert.ok(planPractice(items,{mode:'new',count:10}).every(q=>!q.attempts.length));
});
let sequence=0;
const fakeCall=async request=>{
  if(request.stage==='quiz-rewrite')return{text:JSON.stringify({concepts:[{statement:text,blanks:['随机事件','可能性','概率','零','一','度量','取值','发生'].map(value=>({text:value,start:text.indexOf(value)}))}]})};
  const input=JSON.parse(request.variable);
  if(request.stage==='quiz-point-review')return{text:JSON.stringify({verdicts:input.items.map((_,index)=>({index,valid:true,novel:true}))})};
  const candidates=input.concepts.flatMap(c=>c.blanks.map(blank=>({concept:c,blank}))).filter(({blank})=>!input.history.usedPositions.some(item=>item.blankId===blank.id&&item.type===input.type));
  return{text:JSON.stringify({items:Array.from({length:input.count},(_,i)=>({type:input.type,conceptId:candidates[i%candidates.length].concept.id,blankId:candidates[i%candidates.length].blank.id,angle:`记忆：${candidates[i%candidates.length].blank.text}`,
    stem:input.type==='mcq'?`在所述定义中，哪一项是随机事件可能性的度量？编号${sequence++}`:`所述度量称为{{c1::概率}}。编号${sequence++}`,
    answer:input.type==='mcq'?'A':'概率',basis:input.source.slice(0,15),explanation:'依据材料中的定义。',
    choices:input.type==='mcq'?[{label:'A',text:'概率'},{label:'B',text:'方差'},{label:'C',text:'样本量'},{label:'D',text:'频数'}]:[]}))})};
};
test('knowledge point generator produces both supported types with source evidence and stays proposed',async()=>{
  const [point]=knowledgePoints(record()),saved=[],calls=[];
  const generate=createPointQuizGenerator({call:async request=>{calls.push(request.stage);return fakeCall(request);}});
  const result=await generate({plan:planPointQuestions([point],{count:4}),onQuestion:q=>saved.push(q)});
  assert.equal(result.produced,4);assert.equal(saved.length,4);assert.deepEqual(new Set(saved.map(q=>q.type)),new Set(['mcq','cloze']));
  assert.ok(saved.every(q=>q.status==='proposed'&&point.text.includes(q.basis)&&q.pointId===point.id));
  assert.equal(calls.filter(stage=>stage==='quiz-rewrite').length,1);
});
test('bad provenance and malformed options are rejected; storage failures stop paid work',async()=>{
  const [point]=knowledgePoints(record()),plan=planPointQuestions([point],{count:1,types:['mcq']});
  const generate=createPointQuizGenerator({call:async request=>request.stage==='quiz-rewrite'?fakeCall(request):{text:JSON.stringify({items:[{stem:'问题',answer:'A',basis:'这段文字并不在材料之中',choices:[]}]})}});
  const result=await generate({plan,onQuestion:()=>assert.fail('must reject bad evidence')});assert.equal(result.produced,0);assert.ok(result.problems.length);
  const working=createPointQuizGenerator({call:fakeCall});
  await assert.rejects(working({plan,onQuestion:()=>{throw new Error('write failed');}}),{code:'PERSIST'});
});

test('global bank spans courses, preserves questions across regeneration and restart, grades once, and isolates accounts',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zhiyun-point-bank-'));let host,service,user={id:'fixture'};
  const open=async()=>{
    host=await mountKnowledge(directory);
    service=new StudyWorkbench({directory,knowledge:host.service,classroom:{getCurrentUser:async()=>user,listCourses:async()=>({items:[{id:'10',title:'甲课程'},{id:'11',title:'乙课程'}]})},
      parser:{llm:{routes:{}}},llm:{},quiz:()=>({generatePoints:createPointQuizGenerator({call:fakeCall})})});await service.ready;
  };
  try{
    await open();await host.service.put(record());await host.service.put(record('11','21'));
    const catalog=await service.invoke('bank-catalog');assert.equal(catalog.points.length,2);assert.equal(catalog.points[0].courseTitle,'甲课程');
    const result=await service.invoke('bank-generate',{pointIds:catalog.points.map(p=>p.id),mode:'uniform',count:4,types:['cloze','mcq'],accountId:'another-user'});
    assert.equal(result.run.total,4);assert.equal(result.plan.coveredPoints,2);
    await service.questionBank.runs.get(String(user.id)).done;
    assert.equal((await service.invoke('bank-progress',{runId:result.run.id})).run.state,'completed');
    const practice=await service.invoke('bank-practice',{mode:'new',count:10});assert.equal(practice.available,4);
    const q=practice.questions[0],response=q.answer;
    const answer=await service.invoke('bank-answer',{sessionId:practice.session.id,questionId:q.id,response});assert.equal(answer.attempt.verdict,'correct');
    const duplicate=await service.invoke('bank-answer',{sessionId:practice.session.id,questionId:q.id,response:'wrong'});assert.equal(duplicate.attempt.id,answer.attempt.id);
    assert.equal((await service.invoke('bank-load')).questions.find(item=>item.id===q.id).attempts.length,1);
    assert.equal((await service.invoke('bank-practice',{mode:'review',count:2})).available,1);
    await host.service.put({...record(),lecture:null,quiz:null});assert.equal((await service.invoke('bank-load')).questions.length,4);
    await service.dispose();await host.dispose();await open();assert.equal((await service.invoke('bank-load')).questions.length,4);
    user={id:'other'};assert.equal((await service.invoke('bank-load')).questions.length,0);assert.equal((await service.invoke('bank-catalog')).points.length,0);
    await assert.rejects(service.invoke('bank-answer',{sessionId:practice.session.id,questionId:q.id,response}),{code:'NOT_FOUND'});
  }finally{await service?.dispose();await host?.dispose();await rm(directory,{recursive:true,force:true});}
});

test('legacy section questions are archived before a lecture can replace the section result',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zhiyun-bank-legacy-')),host=await mountKnowledge(directory);
  const user={id:'fixture'},service=new StudyWorkbench({directory,knowledge:host.service,classroom:{getCurrentUser:async()=>user},parser:{llm:{routes:{}}},llm:{}});
  try{
    const old={id:'old',type:'cloze',status:'accepted',stem:'称为{{c1::概率}}',answer:'概率',blockIndex:1,createdAt:new Date().toISOString()};
    await host.service.put({...record(),quiz:{items:[old],attempts:[]}});
    await service.questionBank.archive(user);
    await host.service.put({...record(),lecture:null,quiz:null});
    const bank=await service.invoke('bank-load');assert.equal(bank.questions.length,1);assert.equal(bank.questions[0].stem,old.stem);
    await service.questionBank.archive(user);assert.equal((await service.invoke('bank-load')).questions.length,1);
  }finally{await service.dispose();await host.dispose();await rm(directory,{recursive:true,force:true});}
});


test('v4 tree-only results expose the same card and bank point identifiers',()=>{
  const r=record();delete r.semanticPlan;
  const points=knowledgePoints(r),chapters=knowledgeChapters(r);
  assert.equal(chapters.length,1);assert.equal(chapters[0].topics.length,1);
  assert.equal(chapters[0].topics[0].pointId,points[0].id);
  assert.deepEqual(chapters[0].topics[0].blockIndexes,[1]);
});

test('checkpoint resume reuses rewrite and unprocessed drafts without repeating completed questions',async()=>{
  const [point]=knowledgePoints(record()),plan=planPointQuestions([point],{count:4,types:['cloze','mcq']});
  const controller=new AbortController(),saved=[],calls=[];let checkpoint;
  const generate=createPointQuizGenerator({call:async request=>{calls.push(request.stage);return fakeCall(request);}});
  await assert.rejects(generate({plan,signal:controller.signal,onCheckpoint:value=>{checkpoint=structuredClone(value);},onQuestion:(q,value)=>{
    saved.push(q);checkpoint=structuredClone(value);controller.abort();
  }}));
  assert.equal(saved.length,1);assert.ok(checkpoint.tasks[0].drafts.length>checkpoint.tasks[0].cursor);
  const result=await generate({plan,checkpoint,existingStems:saved.map(q=>q.stem),onQuestion:q=>saved.push(q)});
  assert.equal(result.produced,4);assert.equal(result.newlyProduced,3);assert.equal(new Set(saved.map(q=>q.id)).size,4);
  assert.equal(calls.filter(stage=>stage==='quiz-rewrite').length,1);
  assert.equal(calls.filter(stage=>stage==='quiz-point-cloze').length,0,'cached concept blanks are rendered without a model call');
  assert.equal(calls.filter(stage=>stage==='quiz-point-mcq').length,1);
  assert.ok(result.checkpoint.reusedDrafts>0);
  await assert.rejects(generate({plan:{...plan,tasks:plan.tasks.map(t=>({...t,count:t.count+1}))},checkpoint,onQuestion:()=>{}}),{code:'CHECKPOINT_VERSION'});
});

test('a failed question write resumes from the persisted draft cursor, without another model call',async()=>{
  const [point]=knowledgePoints(record()),plan=planPointQuestions([point],{count:1,types:['mcq']});let checkpoint,calls=0;
  const generate=createPointQuizGenerator({call:async request=>{calls++;return fakeCall(request);}});
  await assert.rejects(generate({plan,onCheckpoint:value=>{checkpoint=structuredClone(value);},onQuestion:()=>{throw new Error('disk unavailable');}}),{code:'PERSIST'});
  assert.equal(checkpoint.tasks[0].cursor,0);assert.equal(checkpoint.tasks[0].questionIds.length,0);
  const before=calls,saved=[];const result=await generate({plan,checkpoint,onQuestion:q=>saved.push(q)});
  assert.equal(calls,before);assert.equal(result.produced,1);assert.equal(saved.length,1);
});

test('background progress remains readable, pauses durably and resumes the identical random plan after host restart',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zhiyun-bank-checkpoint-'));let host,service;
  const user={id:'fixture'},calls=[];let entered,firstPhase=new Promise(resolve=>entered=resolve),block=true;
  const call=async request=>{
    calls.push(request.stage);
    if(block&&request.stage.startsWith('quiz-point-')){
      entered();await new Promise((_,reject)=>{if(request.signal.aborted)return reject(request.signal.reason);request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});
    }
    return fakeCall(request);
  };
  const open=async()=>{
    host=await mountKnowledge(directory);service=new StudyWorkbench({directory,knowledge:host.service,classroom:{getCurrentUser:async()=>user,listCourses:async()=>({items:[]})},parser:{llm:{routes:{}}},llm:{},quiz:()=>({generatePoints:createPointQuizGenerator({call})})});await service.ready;
  };
  try{
    await open();await host.service.put(record());await host.service.put(record('11','21'));
    const {points}=await service.invoke('bank-catalog');
    const started=await service.invoke('bank-generate',{pointIds:points.map(p=>p.id),mode:'random',count:4,types:['mcq','cloze']});
    await firstPhase;
    const progress=await service.invoke('bank-progress',{runId:started.run.id});
    assert.equal(progress.run.state,'running');assert.equal(progress.run.cachedRewrites,1);assert.equal(progress.run.done,0);
    assert.equal((await service.invoke('bank-load')).run.state,'running','reads do not wait for the model call');
    await assert.rejects(service.invoke('bank-generate',{pointIds:points.map(p=>p.id),count:1}),{code:'BUSY'});
    const paused=await service.invoke('bank-pause',{runId:started.run.id});assert.equal(paused.run.state,'paused');
    const allocation=paused.run.plan.allocation;
    await service.dispose();await host.dispose();block=false;await open();
    const loaded=await service.invoke('bank-load');assert.equal(loaded.run.state,'paused');assert.equal(loaded.run.cachedRewrites,1);
    const resumed=await service.invoke('bank-resume',{runId:started.run.id});assert.deepEqual(resumed.run.plan.allocation,allocation);
    await service.questionBank.runs.get(String(user.id)).done;
    const final=await service.invoke('bank-progress',{runId:started.run.id});assert.equal(final.run.state,'completed');assert.equal(final.run.done,4);
    assert.equal(calls.filter(stage=>stage==='quiz-rewrite').length,1,'the persisted rewrite survives host restart');
    assert.equal((await service.invoke('bank-load')).questions.length,4);
  }finally{await service?.dispose();await host?.dispose();await rm(directory,{recursive:true,force:true});}
});

test('retry fills only failed allocations and leaves completed question ids unchanged',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zhiyun-bank-retry-')),host=await mountKnowledge(directory),user={id:'fixture'};
  let failNext=true;const calls=[];
  const generate=createPointQuizGenerator({call:async request=>{
    calls.push(request.stage);
    if(failNext&&request.stage.startsWith('quiz-point-')){failNext=false;throw new Error('temporary provider failure');}
    return fakeCall(request);
  }});
  const service=new StudyWorkbench({directory,knowledge:host.service,classroom:{getCurrentUser:async()=>user,listCourses:async()=>({items:[]})},parser:{llm:{routes:{}}},llm:{},quiz:()=>({generatePoints:generate})});
  try{
    await host.service.put(record());await host.service.put(record('11','21'));
    const {points}=await service.invoke('bank-catalog');
    const started=await service.invoke('bank-generate',{pointIds:points.map(p=>p.id),mode:'uniform',count:4,types:['mcq']});
    await service.questionBank.runs.get(String(user.id)).done;
    const partial=await service.invoke('bank-progress',{runId:started.run.id});assert.equal(partial.run.state,'partial');assert.equal(partial.run.done,2);
    const previous=(await service.invoke('bank-load')).questions.map(q=>q.id);
    await service.invoke('bank-resume',{runId:started.run.id});await service.questionBank.runs.get(String(user.id)).done;
    const finished=await service.invoke('bank-progress',{runId:started.run.id});assert.equal(finished.run.state,'completed');assert.equal(finished.run.done,4);
    const questions=(await service.invoke('bank-load')).questions;
    assert.ok(previous.every(id=>questions.some(q=>q.id===id)));assert.equal(new Set(questions.map(q=>q.id)).size,4);
    assert.equal(calls.filter(stage=>stage==='quiz-rewrite').length,2);
    assert.equal(calls.filter(stage=>stage==='quiz-point-mcq').length,3,'one failed call and two successful allocations, without replaying the completed allocation');
  }finally{await service.dispose();await host.dispose();await rm(directory,{recursive:true,force:true});}
});

const allStrategies=['recall','understand','apply','explore'];
const advancedCall=async request=>{
  if(['quiz-rewrite','quiz-point-review'].includes(request.stage))return fakeCall(request);
  const input=JSON.parse(request.variable),concept=input.concepts[0];
  return {text:JSON.stringify({items:Array.from({length:input.count},(_,i)=>{
    const serial=sequence++,parent=input.history.examples.find(q=>q.solutionPath);
    return {conceptId:concept.id,blankId:concept.blanks[i%concept.blanks.length].id,
      angle:`${input.strategy} 独立考查方向 ${serial}`,solutionPath:`依据概率公理建立事件关系 ${serial}`,
      stem:`分析给定事件的可能性并说明推理依据 ${serial}`,answer:'概率是随机事件可能性的度量。',basis:input.source.slice(0,15),
      explanation:'直接对照概率定义。',rubric:['说明度量对象','说明取值范围'],choices:[],
      ...(parent&&input.strategy==='apply'?{parentId:parent.id,variantChange:'改变情境中的事件描述'}:{}),
      ...(input.external.length?{sources:[{url:input.external[0].url,quote:input.external[0].snippet}]}:{})};
  })})};
};

test('four strategies conserve weighted counts independently of point distribution and reject incompatible forms',()=>{
  for(const mode of ['uniform','random'])for(let count=1;count<=100;count++){
    const plan=planPointQuestions(sourcePoints,{count,mode,strategies:allStrategies.map((id,i)=>({id,weight:i+1})),types:['shortAnswer']});
    assert.equal(plan.strategyAllocation.reduce((sum,row)=>sum+row.count,0),count);
    for(const row of plan.strategyAllocation)assert.equal(plan.tasks.filter(t=>t.strategy===row.id).reduce((sum,t)=>sum+t.count,0),row.count);
    assert.ok(plan.tasks.every(t=>t.type==='shortAnswer'));
  }
  assert.throws(()=>planPointQuestions(sourcePoints,{count:10,strategies:[{id:'explore',weight:1}],types:['cloze']}),{code:'INPUT'});
  assert.throws(()=>planPointQuestions(sourcePoints,{count:10,strategies:[{id:'recall',weight:0}]}),{code:'INPUT'});
});

test('concept identity follows material, validates original statements and exact blank offsets',async()=>{
  const [point]=knowledgePoints(record()),entry=await parseConcepts((await fakeCall({stage:'quiz-rewrite'})).text,point);
  assert.equal(entry.materialKey,await conceptCacheKey({...point,id:'regenerated-id',revision:'v2'}));
  assert.notEqual(entry.materialKey,await conceptCacheKey({...point,text:point.text+'补充材料'}));
  await assert.rejects(parseConcepts(JSON.stringify({concepts:[{statement:'并非课堂原文中的知识定义。',blanks:[{text:'定义'}]}]}),point));
  await assert.rejects(parseConcepts(JSON.stringify({concepts:[{statement:text,blanks:[{text:'概率'}]}]}),point),'ambiguous repeated tokens require a position');
  await assert.rejects(parseConcepts(JSON.stringify({concepts:[{statement:text,blanks:[{text:'概率',start:0}]}]}),point));
});

test('recall cloze reuses cached concepts across batches, never repeats a blank and reports exhaustion',async()=>{
  const [point]=knowledgePoints(record()),cache={},history=[],calls=[];
  const generate=createPointQuizGenerator({call:async request=>{calls.push(request.stage);return fakeCall(request);}});
  const plan=planPointQuestions([point],{count:2,types:['cloze']});
  for(let i=0;i<6;i++){
    const result=await generate({plan,conceptCache:cache,existingQuestions:history,existingStems:history.map(q=>q.stem),onConcept:(key,value)=>{cache[key]=value;},onQuestion:q=>history.push(q)});
    if(i===5)assert.ok(result.problems.some(problem=>problem.includes('挖空位置已用完')));
  }
  assert.equal(calls.length,1,'only the initial concept extraction calls a model');
  assert.equal(new Set(history.map(q=>q.blankId)).size,history.length);
  assert.ok(history.every(q=>q.familyId===q.conceptId));
});

test('orthogonal generation receives covered angles and rejects paraphrases even when review says novel',async()=>{
  const [point]=knowledgePoints(record()),history=[];let context;
  const generate=createPointQuizGenerator({call:async request=>{
    if(request.stage.startsWith('quiz-point-')&&request.stage!=='quiz-point-review')context=JSON.parse(request.variable);
    const response=await advancedCall(request);
    if(context&&request.stage!=='quiz-point-review'&&request.stage!=='quiz-rewrite'&&history.length){const parsed=JSON.parse(response.text);parsed.items[0].angle=history[0].angle;return {text:JSON.stringify(parsed)};}
    return response;
  }});
  const plan=planPointQuestions([point],{count:1,types:['shortAnswer'],strategies:[{id:'understand',weight:1}]});
  assert.equal((await generate({plan,onQuestion:q=>history.push(q)})).produced,1);
  const result=await generate({plan,existingQuestions:history,existingStems:history.map(q=>q.stem),onQuestion:()=>assert.fail('covered angle must not be admitted')});
  assert.equal(result.produced,0);assert.ok(context.history.covered.includes(history[0].angle));
  assert.ok(nearDuplicate('随机事件发生的可能性如何用概率来度量？','随机事件发生的可能性如何用概率来度量。'));
});

test('application variants retain parent and family, and independent review can reject an answer',async()=>{
  const [point]=knowledgePoints(record()),history=[],plan=planPointQuestions([point],{count:1,types:['shortAnswer'],strategies:[{id:'apply',weight:1}]});
  const generate=createPointQuizGenerator({call:advancedCall});
  await generate({plan,onQuestion:q=>history.push(q)});
  assert.equal(history[0].parentId,null);
  await generate({plan,existingQuestions:history,onQuestion:q=>history.push(q)});
  assert.equal(history[1].parentId,history[0].id);assert.equal(history[1].familyId,history[0].familyId);
  const invalid=createPointQuizGenerator({call:async request=>request.stage==='quiz-point-review'?{text:JSON.stringify({verdicts:[{index:0,valid:false,novel:true,reason:'计算结果错误'}]})}:advancedCall(request)});
  const result=await invalid({plan,onQuestion:()=>assert.fail('failed answer review')});
  assert.equal(result.produced,0);assert.ok(result.problems.some(p=>p.includes('计算结果错误')));
});

test('a pause during independent review preserves generated candidates and does not regenerate them',async()=>{
  const [point]=knowledgePoints(record()),plan=planPointQuestions([point],{count:1,types:['shortAnswer'],strategies:[{id:'explore',weight:1}]});
  let checkpoint,stop=true;const calls=[];
  const generate=createPointQuizGenerator({call:async request=>{
    calls.push(request.stage);if(request.stage==='quiz-point-review'&&stop)throw new Error('interrupted review');return advancedCall(request);
  }});
  assert.equal((await generate({plan,onCheckpoint:value=>{checkpoint=value;},onQuestion:()=>{}})).produced,0);
  assert.equal(checkpoint.tasks[0].candidates.length,1);stop=false;
  assert.equal((await generate({plan,checkpoint,onQuestion:()=>{}})).produced,1);
  assert.equal(calls.filter(s=>s==='quiz-point-shortAnswer').length,1);
  assert.equal(calls.filter(s=>s==='quiz-point-review').length,2);
});

test('web application questions cache search results, validate citations and never invent unavailable search',async()=>{
  const [point]=knowledgePoints(record()),plan=planPointQuestions([point],{count:1,source:'web',types:['shortAnswer'],strategies:[{id:'explore',weight:1}]});
  let searches=0;
  const generate=createPointQuizGenerator({call:advancedCall,search:async()=>{searches++;return {sources:[{url:'https://example.org/lesson',title:'公开教学案例',snippet:'在已知随机事件下计算概率并解释结果。'}]};}});
  const saved=[];assert.equal((await generate({plan,onQuestion:q=>saved.push(q)})).produced,1);assert.equal(searches,1);assert.equal(saved[0].sources[0].url,'https://example.org/lesson');
  const missing=await createPointQuizGenerator({call:advancedCall})({plan,onQuestion:()=>assert.fail('must not fabricate web evidence')});
  assert.equal(missing.produced,0);assert.ok(missing.problems.some(p=>p.includes('联网检索尚未配置')));
});

test('mixed practice honors the requested proportion and supports strategy and question-form filters',()=>{
  const items=Array.from({length:20},(_,i)=>({id:String(i),type:i%2?'trueFalse':'shortAnswer',strategy:i%2?'recall':'apply',status:'proposed',attempts:i<10?[]:[{}]}));
  const mixed=planPractice(items,{mode:'mixed',count:10,freshRatio:.7});
  assert.equal(mixed.filter(q=>!q.attempts.length).length,7);assert.equal(new Set(mixed.map(q=>q.id)).size,10);
  assert.ok(planPractice(items,{mode:'new',count:10,strategies:['apply'],types:['shortAnswer']}).every(q=>q.strategy==='apply'&&q.type==='shortAnswer'));
});

test('global bank persists concept caches and records short answers as explicit self-assessments',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zhiyun-strategy-bank-'));let host,service;const user={id:'fixture'},calls=[];
  const open=async()=>{host=await mountKnowledge(directory);service=new StudyWorkbench({directory,knowledge:host.service,classroom:{getCurrentUser:async()=>user,listCourses:async()=>({items:[]})},parser:{llm:{routes:{}}},llm:{},quiz:()=>({generatePoints:createPointQuizGenerator({call:async request=>{calls.push(request.stage);return advancedCall(request);}})})});};
  try{
    await open();await host.service.put(record());const {points}=await service.invoke('bank-catalog');
    for(const strategy of ['understand','apply']){
      const started=await service.invoke('bank-generate',{pointIds:[points[0].id],count:1,types:['shortAnswer'],strategies:[{id:strategy,weight:1}]});
      await service.questionBank.runs.get(user.id).done;
      assert.equal((await service.invoke('bank-progress',{runId:started.run.id})).run.state,'completed');
      if(strategy==='understand'){await service.dispose();await host.dispose();await open();}
    }
    assert.equal(calls.filter(s=>s==='quiz-rewrite').length,1,'concept cache survives a host restart and is shared across strategies');
    const loaded=await service.invoke('bank-load');assert.equal(loaded.coverage.concepts,1);assert.equal(loaded.coverage.angles,2);
    const practice=await service.invoke('bank-practice',{mode:'new',count:1,types:['shortAnswer']});
    const payload={sessionId:practice.session.id,questionId:practice.questions[0].id,response:'我的推理过程'};
    await assert.rejects(service.invoke('bank-answer',payload),{code:'INPUT'});
    const grade=await service.invoke('bank-answer',{...payload,selfVerdict:'partial'});assert.equal(grade.attempt.verdict,'partial');assert.equal(grade.attempt.grading,'self');
    await service.dispose();await host.dispose();await open();
    assert.equal((await service.invoke('bank-load')).questions.find(q=>q.id===payload.questionId).attempts[0].grading,'self');
  }finally{await service?.dispose();await host?.dispose();await rm(directory,{recursive:true,force:true});}
});
