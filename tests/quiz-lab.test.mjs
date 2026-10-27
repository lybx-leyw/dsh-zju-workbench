import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {labCall} from '../scripts/quiz_bench/experimental/policy.mjs';
import {rectifyQuestions} from '../scripts/quiz_bench/experimental/rectification.mjs';
import {createPointQuizGenerator,planPointQuestions} from '../scripts/quiz_bench/experimental/points.mjs';
import {datasetFrom} from '../scripts/quiz_bench/input.mjs';
import {fixture,fixtureCall} from '../scripts/quiz_bench/fixture.mjs';
import {auditFacts} from '../scripts/quiz_bench/experimental/source.mjs';
import {parseConcepts} from '../packages/dsh-zhiyun-core-quiz/src/concepts.js';
import {traceInput} from '../scripts/quiz_bench/experimental/run.mjs';

test('experiment tracing preserves both JSON requests and the production plain-text dedupe protocol',()=>{
 assert.deepEqual(traceInput('{"title":"x"}'),{title:'x'});
 assert.deepEqual(traceInput('已有的题：\n0. 内容\n新出的题：'),{raw:'已有的题：\n0. 内容\n新出的题：'});
});

test('lab research fork leaves the production source snapshot unchanged',async()=>{
 const m=JSON.parse(await readFile('scripts/quiz_bench/experimental/fork-manifest.json','utf8'));
 assert.equal(createHash('sha256').update(await readFile(m.origin)).digest('hex'),m.sha256);
});
test('lab review only requires recall targets and checks all option truth values',async()=>{
 let constant;const invoke=labCall(async r=>{constant=r.constant;return {text:JSON.stringify({verdicts:[{index:0,valid:true,optionTruth:{A:true,B:true,C:false,D:false}}]})};});
 const result=await invoke({stage:'quiz-point-review',variable:JSON.stringify({type:'mcq',strategy:'understand',targets:[],items:[{answer:'A'}]})});
 assert.equal(JSON.parse(result.text).verdicts[0].valid,false);assert.ok(constant.includes('其他策略不要求目标编号'));
});
test('lab dedupe partitions points and rejects invented or backwards match IDs as unresolved',async()=>{
 const questions=[{id:'a',pointId:'p',stem:'问题甲'},{id:'b',pointId:'q',stem:'问题乙'},{id:'c',pointId:'p',stem:'问题丙'}],saved={questions:Object.fromEntries(questions.map(q=>[q.id,q]))},requests=[];
 await rectifyQuestions({saved,questions,existingQuestions:[],stagedIds:['a','b','c'],commit:fn=>fn(),emit:async()=>{},parallel:(items,fn)=>Promise.all(items.map(fn)),signal:new AbortController().signal,problems:[],onRectify:async()=>{},requestModel:async r=>{
  const d=JSON.parse(r.variable);requests.push(d);return {text:JSON.stringify({duplicates:[{duplicateId:'c',matchId:'b',sameTask:true,reason:'跨知识点错误匹配'}]})};
 }});
 assert.equal(requests.length,1);assert.deepEqual(requests[0].fresh.map(q=>q.id),['a','c']);assert.equal(saved.rectify.state,'needs-review');assert.equal(Object.keys(saved.rectify.decisions).length,0);
});
test('lab retains parallel tickets, reusable concepts, audited blueprints and ready questions',async()=>{
 const base=fixtureCall(),stages=[];
 const call=async r=>{stages.push(r.stage);const d=JSON.parse(r.variable);
  if(r.stage==='lab-source')return {text:JSON.stringify({positions:d.positions.map(p=>({position:p.position,claim:p.text,evidence:p.statement,meaningful:true,leaked:false,consistent:true})),conflicts:[]})};
  if(r.stage==='lab-blueprint')return {text:JSON.stringify({templates:d.tickets.map((t,i)=>({ticketId:t.ticketId,conceptId:d.concepts[0].id,focus:`具体方面${i}`,angle:`作答操作${i}`,basis:d.source.slice(0,18)}))})};
  if(r.stage==='lab-dedupe')return {text:'{"duplicates":[]}'};
  const raw=await base(r);if(r.stage==='quiz-point-review'){const o=JSON.parse(raw.text);o.verdicts.forEach(v=>v.optionTruth={A:true,B:false,C:false,D:false});return {text:JSON.stringify(o)};}return raw;
 };
 const plan=planPointQuestions([datasetFrom(fixture).points[1]],{count:2,types:['mcq'],strategies:[{id:'understand',weight:1}]}),generate=createPointQuizGenerator({call});
 const first=await generate({plan,concurrency:2,onQuestion:async()=>{}});
 assert.equal(first.admitted,2);assert.equal(first.checkpoint.phase,'completed');assert.equal(stages.filter(s=>s==='lab-blueprint').length,1);
 const before=stages.length;const second=await generate({plan,checkpoint:first.checkpoint,onQuestion:async()=>{}});assert.equal(second.admitted,2);assert.equal(stages.length,before);
});

test('lab source detects a zero-versus-one conflict and quarantines its branch rather than the safe definition',async()=>{
 const definition='该量的递推定义规定空对象对应的数值为零。',rule='如果对象为空，则该量的数值取一',point={id:'synthetic',courseId:'c',subId:'s',title:'合成边界定义',text:definition+rule+'。'};
 const entry=await parseConcepts(JSON.stringify({concepts:[{statement:definition,blanks:[{text:'零'}]},{statement:rule+'。',blanks:[{text:'一'}]}]}),point);
 const call=async r=>{
  const d=JSON.parse(r.variable);
  if(r.stage==='lab-source')return {text:JSON.stringify({positions:d.positions.map(p=>({position:p.position,claim:p.statement,evidence:p.statement,meaningful:true,leaked:false,consistent:true})),conflicts:[]})};
  if(r.stage==='lab-source-proof')return {text:JSON.stringify({status:'consistent',checks:[{branchId:'b1',case:'空对象',byDefinition:'按定义得到零',byRule:'按引用分支得到一',definitionValue:0,ruleValue:1,quotes:[definition,rule]}],conflicts:[]})};
  return {text:JSON.stringify({verdicts:[{index:0,faithful:true}]})};
 };
 const result=await auditFacts({entry,point,call,saveEntry:async()=>{},persist:async()=>{}});
 assert.equal(result.factAudit.conflicts.length,1);assert.equal(result.factAudit.rejected.length,1);assert.equal(result.factAudit.facts.length,1);
 assert.equal(result.factAudit.facts[0].evidence,definition);assert.deepEqual(result.factAudit.conflicts[0].unsafeQuotes,[rule]);
});
