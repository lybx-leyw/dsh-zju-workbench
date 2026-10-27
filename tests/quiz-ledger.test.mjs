import test from 'node:test';
import assert from 'node:assert/strict';
import {activeFacts,curateFacts,reconcileLedger} from '../packages/dsh-zhiyun-core-quiz/src/ledger.js';
import {coveredFacts,factSlots} from '../packages/dsh-zhiyun-core-quiz/src/facts.js';
const entry=()=>({materialKey:'m',concepts:[{id:'c',statement:'单位时间内发生的事件次数定义为速率。',blanks:[{id:'b',text:'速率',start:17,aliases:[]}]}],factAudit:{facts:[{id:'f1',claim:'速率定义',evidence:'单位时间内发生的事件次数',positions:[{conceptId:'c',blankId:'b'}]}],rejected:[]}});
test('reaudit rephrasing preserves the identity of an unchanged position and its coverage',()=>{
  const old=entry(),next=structuredClone(old);next.factAudit.facts[0].id='f2';next.factAudit.facts[0].claim='用单位时间的事件数描述速率';
  const updated=reconcileLedger(old,next);assert.equal(activeFacts(updated)[0].id,'f1');
  assert.equal(factSlots(updated,[{strategy:'recall',factId:'f1'}],'mcq',10).length,0);
});
test('manual merge resolves old history without rewriting historic questions or allowing reverse cycles',()=>{
  const old=entry();old.factAudit.facts.push({id:'f2',claim:'同义定义',evidence:'单位时间内发生的事件次数',positions:[{conceptId:'c',blankId:'b2'}]});
  const updated=curateFacts(old,{materialKey:'m',type:'merge',factId:'f2',into:'f1'});
  assert.equal(activeFacts(updated).length,1);assert.ok(coveredFacts(updated,[{strategy:'recall',factId:'f2'}]).has('f1'));
  assert.throws(()=>curateFacts(updated,{materialKey:'m',type:'merge',factId:'f1',into:'f2'}));
});
test('manual position blocks survive reaudits and rejected source positions never revive from the ledger',()=>{
  const old=entry(),blocked=curateFacts(old,{materialKey:'m',type:'block-position',conceptId:'c',blankId:'b'});
  assert.equal(activeFacts(reconcileLedger(blocked,old)).length,0);
  const rejected={...old,factAudit:{facts:[],rejected:[{conceptId:'c',blankId:'b'}]}};
  assert.equal(activeFacts(reconcileLedger(old,rejected)).length,0);
  assert.throws(()=>curateFacts(old,{materialKey:'wrong',type:'disable-fact',factId:'f1'}));
});
test('source quarantine requires exact evidence and removes only overlapping positions',()=>{
  const old=entry(),quote='单位时间内发生的事件次数';
  assert.throws(()=>curateFacts(old,{materialKey:'m',type:'quarantine-source',quote:'不存在于来源的引用语句',reason:'核对'},old.concepts[0].statement));
  const updated=curateFacts(old,{materialKey:'m',type:'quarantine-source',quote,reason:'待核对'},old.concepts[0].statement);
  assert.equal(activeFacts(updated).length,0);assert.equal(updated.factLedger.operations.length,1);
});
