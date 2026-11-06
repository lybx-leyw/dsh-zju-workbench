import test from 'node:test';
import assert from 'node:assert/strict';
import {requestConcepts} from '../packages/dsh-zhiyun-core-quiz/src/concepts.js';
const point={courseId:'c',subId:'s',title:'定义',text:'概率是随机事件发生可能性的度量。'};
const valid=JSON.stringify({concepts:[{statement:point.text,blanks:[{text:'随机事件'}]}]});
const request={stage:'quiz-rewrite',constant:'extract',variable:JSON.stringify({source:point.text})};
test('repairs invalid model offsets once while retaining exact source validation',async()=>{
  const stages=[];
  const entry=await requestConcepts({point,request,call:async r=>{stages.push(r.stage);if(stages.length===1)return {text:valid.replace('"随机事件"','"随机事件","start":0')};assert.equal(JSON.parse(r.variable).original.source,point.text);return {text:valid};}});
  assert.deepEqual(stages,['quiz-rewrite','quiz-rewrite-repair']);
  assert.equal(entry.concepts[0].blanks[0].start,3);
});
test('invalid repair still fails and cannot loop or invent source evidence',async()=>{
  let count=0;
  await assert.rejects(requestConcepts({point,request,call:async()=>{count++;return {text:JSON.stringify({concepts:[{statement:'这是一条不存在于材料的断言。',blanks:[{text:'断言'}]}]})};}}),/须来自知识点原文/);
  assert.equal(count,2);
});
test('valid extraction and empty completion avoid repair calls',async()=>{
  let count=0;
  await requestConcepts({point,request,call:async()=>{count++;return {text:valid};}});
  await requestConcepts({point,request,allowEmpty:true,call:async()=>{count++;return {text:'{"concepts":[]}'};}});
  assert.equal(count,2);
});
test('one invalid blank cannot discard independently grounded positions after bounded repair',async()=>{
  const mixed=JSON.stringify({concepts:[{statement:point.text,blanks:[{text:'随机事件'},{text:'不存在的词'}]},{statement:'未在材料中的伪造概念陈述。',blanks:[{text:'伪造'}]}]});
  let count=0;
  const entry=await requestConcepts({point,request,call:async()=>{count++;return {text:mixed};}});
  assert.equal(count,2);
  assert.equal(entry.concepts.length,1);
  assert.deepEqual(entry.concepts[0].blanks.map(b=>b.text),['随机事件']);
  assert.equal(entry.validation.rejected.length,2);
});
