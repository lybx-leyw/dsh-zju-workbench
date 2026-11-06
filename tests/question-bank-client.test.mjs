import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionBankController} from '../packages/dsh-zhiyun-core-study/src/question-bank-client.js';
const questions=()=>[1,2,3].map(id=>({id:String(id),status:'proposed',attempts:[]}));
test('source navigation resolves the exact point revision and never redirects an obsolete question to new content',async()=>{
  const opened=[],point={id:'current',chapterIndex:1,topicIndex:2};
  const bank=createQuestionBankController(async method=>method==='bank-catalog'?{points:[point]}:{questions:[],sessions:[],runs:[]},{openSource:async(q,p)=>opened.push([q,p])});
  try{await bank.openSource({pointId:'current'});assert.equal(opened.length,1);assert.equal(opened[0][1].chapterIndex,1);await bank.openSource({pointId:'old'});assert.equal(opened.length,1);assert.match(bank.getSnapshot().error,/换版/);}finally{bank.dispose();}
});
test('bulk discard responds synchronously, survives stale responses, queues writes and rolls back only failures',async()=>{
 const gates=[];let stored=questions();
 const bank=createQuestionBankController(async(method,payload)=>{
  if(method==='bank-catalog')return {points:[]};if(method==='bank-load')return {questions:structuredClone(stored),sessions:[]};
  if(method==='bank-discard')return new Promise((resolve,reject)=>gates.push({payload,resolve:()=>{stored=stored.map(q=>payload.questionIds.includes(q.id)?{...q,status:'rejected'}:q);resolve({questions:structuredClone(stored),sessions:[]});},reject}));
 });
 try{
  await bank.load();const first=bank.discardMany(['1','2']);
  assert.deepEqual(bank.getSnapshot().questions.map(q=>q.status),['rejected','rejected','proposed'],'no network round-trip is needed for the visible effect');
  const second=bank.discard('3');assert.ok(bank.getSnapshot().questions.every(q=>q.status==='rejected'));
  await bank.load(true);assert.ok(bank.getSnapshot().questions.every(q=>q.status==='rejected'),'a stale load cannot resurrect optimistic discards');
  assert.equal(gates.length,1);gates[0].resolve();await first;await Promise.resolve();
  assert.equal(gates.length,2);assert.ok(bank.getSnapshot().questions.every(q=>q.status==='rejected'));
  gates[1].reject(new Error('synthetic storage failure'));await second;
  assert.deepEqual(bank.getSnapshot().questions.map(q=>q.status),['rejected','rejected','proposed']);assert.match(bank.getSnapshot().error,/已恢复/);
 }finally{bank.dispose();}
});
test('switching accounts during an optimistic discard never restores old questions into the new account',async()=>{
 let reject;
 const bank=createQuestionBankController(async method=>method==='bank-catalog'?{points:[]}:method==='bank-load'?{questions:questions(),sessions:[]}:new Promise((_resolve,r)=>{reject=r;}));
 await bank.load();const pending=bank.discard('1');await Promise.resolve();bank.reset();reject(new Error('old account failed'));await pending;
 assert.equal(bank.getSnapshot().questions.length,0);assert.equal(bank.getSnapshot().error,null);bank.dispose();
});
