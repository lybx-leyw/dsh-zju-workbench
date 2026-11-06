import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenLedger,timingLedger} from '../scripts/quiz_bench/accounting.mjs';
import {withDeepTutorGuidance,DEEPTUTOR_GUIDANCE_ID} from '../packages/dsh-zhiyun-core-quiz/src/deeptutor-guidance.js';
import {planPointQuestions,newPointCheckpoint,createPointQuizGenerator} from '../packages/dsh-zhiyun-core-quiz/src/points.js';

test('token ledger does not double-count cached input or reasoning output and does not invent missing bills',()=>{
  const receipts=[{usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens_details:{reasoning_tokens:5}}},{usage:{prompt_tokens:50,completion_tokens:10,total_tokens:60}}];
  const ledger=tokenLedger(receipts);assert.equal(ledger.totalTokens,180);assert.equal(ledger.inputTokensKnown,150);assert.equal(ledger.cacheHitInputTokensKnown,80);assert.equal(ledger.reasoningOutputTokensKnown,5);assert.equal(ledger.cacheUnknownReceipts,1);
  const incomplete=tokenLedger(receipts,{attempts:3});assert.equal(incomplete.totalTokens,null);assert.equal(incomplete.totalTokensKnown,180);assert.equal(incomplete.unknownUsageAttempts,1);
});
test('request timeline measures overlap while preserving observed wall time',()=>{
  const events=[{index:1,status:'started',at:0},{index:1,status:'completed',at:40000},{index:2,status:'started',at:20000},{index:2,status:'completed',at:60000},{index:3,status:'started',at:80000},{index:3,status:'completed',at:100000}];
  const ledger=timingLedger(events,{wallMs:100000,slots:2,delivered:3});
  assert.equal(ledger.wallMs,100000);assert.equal(ledger.requestServiceMs,100000);assert.equal(ledger.requestBusyUnionMs,80000);assert.equal(ledger.peakRequestConcurrency,2);assert.equal(ledger.averageRequestConcurrency,1);assert.equal(ledger.slotUtilization,0.5);assert.equal(ledger.idealServiceLowerBoundMs,50000);assert.equal(ledger.deliveredPerMinute,1.8);
});
test('guidance changes only candidate authoring and keeps the existing request/data schema',()=>{
  const request={stage:'quiz-point-mcq',constant:'existing items schema',variable:'source data'};
  assert.equal(withDeepTutorGuidance(request),request);
  assert.equal(withDeepTutorGuidance({...request,stage:'quiz-point-review'},DEEPTUTOR_GUIDANCE_ID).constant,request.constant);
  const guided=withDeepTutorGuidance(request,DEEPTUTOR_GUIDANCE_ID);assert.ok(guided.constant.startsWith(request.constant));assert.match(guided.constant,/长度和语言风格相近/);assert.equal(guided.variable,request.variable);assert.equal(request.constant,'existing items schema');assert.throws(()=>withDeepTutorGuidance(request,'unknown'),/未知/);
});
test('guided and ordinary checkpoints cannot be mixed and configuration mistakes cost no model calls',async()=>{
  const plan=planPointQuestions([{id:'p',title:'t',text:'足够明确的知识点正文材料。'}],{count:1,types:['mcq']});
  assert.notEqual(newPointCheckpoint(plan).planKey,newPointCheckpoint({...plan,guidance:DEEPTUTOR_GUIDANCE_ID}).planKey);
  let calls=0;const generate=createPointQuizGenerator({guidance:DEEPTUTOR_GUIDANCE_ID,call:async()=>{calls++;}});
  await assert.rejects(generate({plan}),/配置不一致/);assert.equal(calls,0);
});
