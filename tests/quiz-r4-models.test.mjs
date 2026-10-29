import test from 'node:test';
import assert from 'node:assert/strict';
import {runR4} from '../scripts/quiz_bench/experimental-r4/run.mjs';
import {graph,model} from '../scripts/quiz_bench/experimental-r4/fixture.mjs';
import {evaluate,validateItemModel} from '../scripts/quiz_bench/experimental-r4/item-model.mjs';
import {compileDemand} from '../scripts/quiz_bench/experimental-r4/compiler.mjs';
import {createScheduler} from '../scripts/quiz_bench/experimental-r4/scheduler.mjs';

const args=()=>({graph:graph(),pointIds:['a'],count:1,requestId:'model-test'});
const mutate=(base,stage,change)=>async request=>{
 const raw=await base.call(request);
 if(request.stage===stage)for(const tool of raw.toolCalls){const value=JSON.parse(tool.arguments);change(value);tool.arguments=JSON.stringify(value);}
 return raw;
};

test('blueprint, M/Q, family accounting and uncalibrated difficulty survive generation',async()=>{
 const m=model(),r=await runR4({...args(),call:m.call});
 assert.equal(r.produced,1);assert.equal(r.report.cells[0].usable,1);assert.equal(r.report.instances,1);assert.equal(r.report.modelFamilies,1);
 assert.equal(r.report.M[0].status,'design-hypothesis');assert.equal(r.report.Q[0].status,'model-reviewed-unvalidated');
 assert.equal(r.report.psychometricValidation.calibrated,false);assert.equal(r.report.psychometricValidation.studentMastery,null);
 assert.deepEqual(r.report.M[0].attributes,r.report.Q[0].attributes);
 const blind=m.calls.find(c=>c.stage==='r4-independent-solve').input;
 assert.equal(blind.idea,undefined);assert.equal(blind.item.answer,undefined);assert.equal(blind.item.explanation,undefined);assert.equal(blind.item.parameters,undefined);
});
test('explicit blueprint enforces cognitive and format quotas and rejects mismatched totals before work',async()=>{
 const m=model(),settings={graph:graph(),pointIds:['a','b'],count:2,compositeCount:0,types:['mcq','shortAnswer'],strategies:['understand','apply'],requestId:'blueprint',call:m.call};
 const blueprint=[{id:'one',kind:'local',pointIds:['a'],type:'mcq',strategy:'understand',count:1},{id:'two',kind:'local',pointIds:['b'],type:'shortAnswer',strategy:'apply',count:1}];
 const r=await runR4({...settings,blueprint});assert.equal(r.produced,2);assert.deepEqual(r.report.cells.map(c=>[c.type,c.strategy,c.usable]),[['mcq','understand',1],['shortAnswer','apply',1]]);
 const before=m.calls.length;await assert.rejects(runR4({...settings,blueprint:[blueprint[0]]}),/配额不匹配/);assert.equal(m.calls.length,before);
});
test('all four item formats use instance and independent-answer validation',async()=>{
 for(const type of ['mcq','cloze','trueFalse','shortAnswer']){
  const m=model(),r=await runR4({...args(),types:[type],call:m.call});assert.equal(r.produced,1,type);
  if(type==='cloze')assert.ok(!JSON.stringify(m.calls.find(c=>c.stage==='r4-independent-solve').input.item).includes('{{c'));
 }
});
test('out of domain parameters and wrong numeric keys never reach ready state',async()=>{
 for(const change of [v=>v.items[0].parameters.x=100,v=>v.items[0].choices[1].text='999',v=>v.items[0].choices[1].text='1e999']){
  const m=model(),r=await runR4({...args(),call:mutate(m,'r3-instantiate',change)});assert.equal(r.produced,0);assert.equal(r.state,'partial');
  assert.equal(m.calls.filter(c=>c.stage==='r4-independent-solve').length,0);
 }
});
test('distractor must be obtained from its declared error operation',async()=>{
 const m=model(),r=await runR4({...args(),call:mutate(m,'r3-instantiate',v=>v.items[0].choices[0].text='99')});
 assert.equal(r.produced,0);assert.match(r.results[0].pending[0].reason,/干扰项与错误操作/);
});
test('valid-looking author cannot override a missing-premise independent verdict',async()=>{
 const m=model(),r=await runR4({...args(),call:mutate(m,'r4-independent-solve',v=>{v.selfContained=false;v.reason='题面缺少事件条件';})});
 assert.equal(r.produced,0);assert.match(r.results[0].pending[0].reason,/缺少事件条件/);
});

test('removing visible instance data cannot be repaired by hidden author parameters',async()=>{
 const m=model(),r=await runR4({...args(),call:mutate(m,'r3-instantiate',v=>{v.items[0].stem='教材的这道例题中，所求结果为多少？';})});
 assert.equal(r.produced,0);assert.match(r.results[0].pending[0].reason,/题面未给出/);
});
test('declared M attributes cannot be copied over an actual Q mismatch',async()=>{
 const m=model(),r=await runR4({...args(),call:mutate(m,'r3-validate-instance',v=>{v.attributeChecks[0].required=false;})});
 assert.equal(r.produced,0);assert.equal(r.report.Q.length,0);assert.match(r.results[0].pending[0].reason,/实际作答未必需/);
});
test('semantic error-mechanism mismatch and missing explicit review fields reject candidates',async()=>{
 for(const change of [v=>v.distractorChecks[0].errorMatched=false,v=>delete v.learningValue]){
  const m=model(),r=await runR4({...args(),call:mutate(m,'r3-validate-instance',change)});assert.equal(r.produced,0);
 }
});
test('ten-item mixed batch expands model families within budget and restores without calls',async()=>{
 const m=model({expandModels:true}),settings={graph:graph(),pointIds:['a','b'],count:10,compositeCount:2,requestId:'ten',call:m.call};
 const first=await runR4(settings);assert.equal(first.produced,10);assert.equal(first.report.modelFamilies,5);assert.equal(first.report.cells.filter(c=>c.kind==='composite').reduce((n,c)=>n+c.usable,0),2);
 const before=m.calls.length,restored=await runR4({...settings,state:first.checkpoint});assert.equal(restored.produced,10);assert.equal(m.calls.length,before);assert.equal(restored.usage.modelCalls,0);
});
test('assessment cap prevents disguising more same-model instances as coverage',async()=>{
 const m=model(),settings={...args(),purpose:'assessment',maxExpansions:0,call:m.call},first=await runR4(settings);
 const next=await runR4({...settings,requestId:'assessment-next',state:first.checkpoint});assert.equal(next.produced,0);assert.match(next.results[0].error,/不足/);
});
test('call budget and cancellation bound paid work and retain resumable state',async()=>{
 const m=model(),r=await runR4({...args(),maxCalls:2,call:m.call});assert.equal(r.state,'partial');assert.equal(m.calls.length,2);assert.ok(Object.keys(r.checkpoint.explorations).length);
 const controller=new AbortController();controller.abort();const before=m.calls.length;await assert.rejects(runR4({...args(),signal:controller.signal,call:m.call}));assert.equal(m.calls.length,before);
});
test('arithmetic verifier is finite, data-only and rejects unknown names or operators',()=>{
 assert.equal(evaluate({op:'divide',args:[{op:'add',args:['x',2]},2]},{x:6}),4);
 for(const expression of [{op:'divide',args:[1,0]},{op:'exec',args:[1,2]},'process.exit()',Infinity,{op:'power',args:[10,1000]}])assert.throws(()=>evaluate(expression,{}));
});

test('item models require grounded adaptation and evidence from the attributed point',async()=>{
 for(const change of [v=>delete v.itemModel.adaptation,v=>v.itemModel.solutionSteps[1].basisIndexes=[0]]){
  const m=model(),call=async request=>{const raw=await m.call(request);if(request.stage.endsWith('-ideas'))for(const t of raw.toolCalls)if(t.name==='submit_idea'){const v=JSON.parse(t.arguments);change(v);t.arguments=JSON.stringify(v);}return raw;};
  const r=await runR4({...args(),pointIds:['a','b'],compositeCount:1,call});assert.equal(r.produced,0);assert.equal(m.calls.some(c=>c.stage==='r3-instantiate'),false);
 }
});

test('evidence rules are reviewed against actual prompts rather than inherited labels',async()=>{
 const m=model(),r=await runR4({...args(),call:mutate(m,'r3-validate-instance',v=>{v.evidenceChecks[0].observable=false;})});
 assert.equal(r.produced,0);assert.match(r.results[0].pending[0].reason,/可观察作答证据/);
});

test('changing base numbers alone cannot manufacture a new cognitive family',async()=>{
 const m=model(),r=await runR4({...args(),call:m.call}),e=Object.values(r.checkpoint.explorations)[0];
 const idea=structuredClone(e.compileCache.nodes.a.raw.ideas[0]),before=r.results[0].questions[0].familyId;
 idea.itemModel.baseParameters.x=9;
 const after=await validateItemModel(idea.itemModel,{idea,pointIds:['a'],basisCount:1,basisPointIds:[['a']]});assert.equal(after.familyId,before);
});

test('family limits span concurrently reserved blueprint formats',async()=>{
 const settings={...args(),count:2,types:['mcq','shortAnswer'],purpose:'assessment',maxExpansions:0};
 const m=model(),first=await runR4({...settings,call:m.call});assert.equal(first.produced,1);assert.equal(first.report.modelFamilies,1);
 const expanded=model({expandModels:true}),second=await runR4({...settings,maxExpansions:1,call:expanded.call});assert.equal(second.produced,2);assert.equal(second.report.modelFamilies,2);
});

test('duplicate outputs remain blocked after a library revision',async()=>{
 const m=model(),r=await runR4({...args(),call:m.call}),e=Object.values(r.checkpoint.explorations)[0];
 const scoped=graph();scoped.root=scoped.root.children[0];
 const library=await compileDemand({graph:scoped,selection:{types:['mcq'],strategies:['understand'],attributeIds:[],pointIds:['a'],maxPerFamily:2},cache:e.compileCache,call:m.call});
 library.key='expanded-library';const scheduler=createScheduler({library,ledger:e.ledger});
 const plan=await scheduler.reserve({count:1,requestId:'duplicate-after-expand'}),ticket=plan.tickets[0];
 const old=r.results[0].questions[0],question={...old,id:ticket.id,ideaId:ticket.ideaId,nodeId:ticket.nodeId};
 await assert.rejects(scheduler.update(plan.id,ticket.id,{question,state:'ready'}),{code:'COLLISION'});
});

test('budget exhaustion resumes cached work and a failed durable write stops further calls',async()=>{
 const m=model(),partial=await runR4({...args(),maxCalls:2,call:m.call});
 const restored=await runR4({...args(),call:m.call,state:JSON.parse(JSON.stringify(partial.checkpoint))});assert.equal(restored.produced,1);assert.equal(restored.usage.modelCalls,3);
 const broken=model();await assert.rejects(runR4({...args(),call:broken.call,onCheckpoint:async()=>{if(broken.calls.length>=2)throw Error('injected write failure');}}),{code:'PERSIST'});assert.equal(broken.calls.length,2);
});

test('a later expansion cannot invalidate an older unfinished or completed batch',async()=>{
 const m=model({expandModels:true}),settings={...args(),requestId:'older',call:m.call};
 const partial=await runR4({...settings,maxCalls:2});assert.equal(partial.produced,0);
 const plan=Object.values(partial.checkpoint.explorations)[0].ledger.plans,old=Object.values(plan)[0];
 const newer=await runR4({...settings,count:2,requestId:'newer',state:partial.checkpoint});assert.equal(newer.produced,2);
 const restored=await runR4({...settings,state:JSON.parse(JSON.stringify(newer.checkpoint))});assert.equal(restored.produced,1);assert.equal(restored.results[0].error,undefined);assert.equal(restored.usage.modelCalls,3);
 assert.equal(restored.results[0].questions[0].ideaId,old.tickets[0].ideaId);
 const complete=await runR4({...settings,state:restored.checkpoint});assert.equal(complete.produced,1);assert.equal(complete.results[0].error,undefined);assert.equal(complete.usage.modelCalls,0);
});

test('numeric short-answer contradictions and absent explicit consistency verdicts fail closed',async()=>{
 const m=model(),wrong=await runR4({...args(),types:['shortAnswer'],call:mutate(m,'r4-independent-solve',v=>{v.answer='999';})});
 assert.equal(wrong.produced,0);assert.match(wrong.results[0].pending[0].reason,/数值简答/);assert.equal(m.calls.filter(c=>c.stage==='r3-validate-instance').length,0);
 for(const change of [v=>delete v.independentMatched,v=>v.independentMatched=false,v=>v.independentReason='']){
  const m=model(),r=await runR4({...args(),types:['shortAnswer'],call:mutate(m,'r3-validate-instance',change)});assert.equal(r.produced,0);assert.match(r.results[0].pending[0].reason,/一致性/);
 }
});

test('duplicate variant parameter sets are rejected before instantiation',async()=>{
 const m=model(),call=async request=>{const raw=await m.call(request);if(request.stage.endsWith('-ideas'))for(const t of raw.toolCalls)if(t.name==='submit_idea'){const v=JSON.parse(t.arguments);v.variants.push({...v.variants[0],key:'another-name',instruction:'使用完全相同的数值但换一个变体编号'});t.arguments=JSON.stringify(v);}return raw;};
 const result=await runR4({...args(),call});assert.equal(result.produced,0);assert.match(result.results[0].error,/变体参数重复/);assert.equal(m.calls.some(c=>c.stage==='r3-instantiate'),false);
});

test('renaming an existing variant cannot reserve the same parameter instance again',async()=>{
 const m=model(),r=await runR4({...args(),count:2,maxPerFamily:4,call:m.call}),e=Object.values(r.checkpoint.explorations)[0];assert.equal(r.produced,2);
 const library=structuredClone(Object.values(e.ledger.libraries)[0]);library.key='renamed-library';library.root.ideas[0].variants[1].key='renamed';
 const scheduler=createScheduler({library,ledger:e.ledger,maxPerFamily:4});await assert.rejects(scheduler.reserve({count:1,requestId:'renamed'}),{code:'CAPACITY'});
});

test('ambiguous point identities are rejected before model work',async()=>{
 const input=graph();input.root.children[1].point.id='a';const m=model();
 await assert.rejects(runR4({...args(),graph:input,call:m.call}),/歧义材料/);assert.equal(m.calls.length,0);
});
