import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
import {runR4} from './run.mjs';
import {graph,model} from './fixture.mjs';

// Explicit offline entry point: no settings, environment or credential reader.
globalThis.fetch=()=>{throw Error('Offline r4 smoke forbids fetch');};
const out=new URL('../../../artifacts/quiz-r4-smoke/',import.meta.url);
await mkdir(out,{recursive:true});
const save=(name,value)=>writeFileAtomic(fileURLToPath(new URL(name,out)),JSON.stringify(value,null,2),{mode:0o600});
const input={graph:graph(),pointIds:['a','b'],count:10,compositeCount:2,requestId:'offline-ten'};
const fake=model({expandModels:true});
const first=await runR4({...input,call:fake.call,onCheckpoint:state=>save('checkpoint.json',state)});
assert.equal(first.state,'completed');assert.equal(first.produced,10);assert.equal(first.report.modelFamilies,5);
const checkpoint=JSON.parse(await readFile(new URL('checkpoint.json',out),'utf8'));
const resume=await runR4({...input,state:checkpoint,call:async()=>{throw Error('Completed restore must not call model');}});
assert.equal(resume.produced,10);assert.equal(resume.usage.modelCalls,0);
await save('questions.json',first.results.flatMap(r=>r.questions));

const one={graph:graph(),pointIds:['a'],count:1,requestId:'offline-recovery'},budgetFake=model({expandModels:true});
const partial=await runR4({...one,call:budgetFake.call,maxCalls:2,onCheckpoint:state=>save('budget-checkpoint.json',state)});
assert.equal(partial.produced,0);assert.equal(partial.usage.modelCalls,2);
const paused=JSON.parse(await readFile(new URL('budget-checkpoint.json',out),'utf8'));
const oldPlan=Object.values(Object.values(paused.explorations)[0].ledger.plans)[0];
const later=await runR4({...one,count:2,requestId:'offline-later-expansion',call:budgetFake.call,state:paused,onCheckpoint:state=>save('interleaved-checkpoint.json',state)});
assert.equal(later.produced,2);
const recovered=await runR4({...one,call:budgetFake.call,state:JSON.parse(await readFile(new URL('interleaved-checkpoint.json',out),'utf8'))});
assert.equal(recovered.produced,1);assert.equal(recovered.usage.modelCalls,3);
assert.equal(recovered.results[0].questions[0].libraryKey,oldPlan.libraryKey);
assert.equal(recovered.results[0].questions[0].ideaId,oldPlan.tickets[0].ideaId);

const faults={};
for(const [name,stage,change]of [
 ['missingPremise','r3-instantiate',v=>{v.items[0].stem='教材的这道例题中，所求结果为多少？';}],
 ['wrongParameter','r3-instantiate',v=>{v.items[0].parameters.x=100;}],
 ['wrongDistractor','r3-instantiate',v=>{v.items[0].choices[0].text='99';}],
 ['unusedAttribute','r3-validate-instance',v=>{v.attributeChecks[0].required=false;}],
 ['unobservableEvidence','r3-validate-instance',v=>{v.evidenceChecks[0].observable=false;}],
]){
 const m=model(),call=async request=>{const raw=await m.call(request);if(request.stage===stage)for(const t of raw.toolCalls){const v=JSON.parse(t.arguments);change(v);t.arguments=JSON.stringify(v);}return raw;};
 const result=await runR4({...one,requestId:name,call});assert.equal(result.produced,0);
 faults[name]={rejected:true,calls:m.calls.length,reason:result.results[0].pending?.[0]?.reason??result.results[0].error};
}
const contradictory=model(),contradiction=await runR4({...one,types:['shortAnswer'],requestId:'numeric-short-conflict',call:async request=>{const raw=await contradictory.call(request);if(request.stage==='r4-independent-solve'){const v=JSON.parse(raw.toolCalls[0].arguments);v.answer='999';raw.toolCalls[0].arguments=JSON.stringify(v);}return raw;}});
assert.equal(contradiction.produced,0);
faults.numericShortConflict={rejected:true,calls:contradictory.calls.length,reason:contradiction.results[0].pending[0].reason};
const broken=model();
await assert.rejects(runR4({...one,call:broken.call,onCheckpoint:async()=>{if(broken.calls.length>=2)throw Error('Injected storage failure');}}),{code:'PERSIST'});
assert.equal(broken.calls.length,2);

const report={synthetic:true,realModelCalls:0,credentialsUsed:false,qualityEvaluated:false,
 requested:first.requested,produced:first.produced,blueprint:first.report,modelCalls:first.usage.modelCalls,
 preparationCalls:fake.calls.filter(c=>c.stage.endsWith('-ideas')).length,
 expansions:first.results.reduce((n,r)=>n+r.expansions,0),resumeCalls:resume.usage.modelCalls,
 budgetRecovery:{firstCalls:partial.usage.modelCalls,resumeCalls:recovered.usage.modelCalls,produced:recovered.produced,laterBatchProduced:later.produced,pinnedAssetRetained:true},
 faults,storageFailure:{stopped:true,calls:broken.calls.length},treeComplete:false};
await save('report.json',report);
const markdown=['# r4 离线冒烟记录','','全程合成材料与模型替身，未使用真实凭证，真实模型调用0次。','',`- 本批完成：${first.produced}/${first.requested}题（8道非综合、2道综合），${first.report.modelFamilies}个结构题模。`,`- 替身调用：${first.usage.modelCalls}次；容量扩展${report.expansions}次；落盘恢复新增调用${resume.usage.modelCalls}次。`,'- 交错恢复：旧批次2次调用后暂停，新批次扩展并完成2题；旧批次读取磁盘断点，以原资产继续3次调用完成。','- 存储失败：第2次调用后停止。','','## 故障注入','',...Object.entries(faults).map(([name,v])=>`- ${name}：拒收；${v.reason}`),'','## 证据边界','','仅验证流程与拒收机制，不证明真实模型审题质量、题模语义多样性或测量效度。考法树仍不完整。','','[机器报告](report.json) · [合成题目](questions.json)'];
await writeFileAtomic(fileURLToPath(new URL('REPORT.md',out)),markdown.join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
