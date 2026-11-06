import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConcepts} from '../packages/dsh-zhiyun-core-quiz/src/concepts.js';
import {auditFacts,factSlots,factFor,parseSourceReview,needsSourceProof,sourceBranches} from '../packages/dsh-zhiyun-core-quiz/src/facts.js';
import {persistWithRetry} from '../packages/dsh-zhiyun-core-quiz/src/durability.js';
import {createPointQuizGenerator,planPointQuestions} from '../packages/dsh-zhiyun-core-quiz/src/points.js';
import {syntheticFactAudit,syntheticSourceCheck,syntheticProofReview,fixtureCall,fixture} from '../scripts/quiz_bench/fixture.mjs';
const sentences=['在本模型中，速率定义为单位时间内发生的事件次数。','事件次数与观测时长的比值称为速率。','该速率采用每秒事件数作为度量单位。','对于这个模型，一个很重要的标准是测量是否稳定。'];
const point={id:'p',courseId:'c',subId:'s',title:'合成测量',blockIndexes:[0],text:sentences.join('\n')};
test('formal and piecewise rules proactively require proof even if the cheap audit reports no conflict',()=>{
  assert.ok(needsSourceProof('定义长度为最短路径。若节点只有一个分支，则结果为子节点值加一。'));
  assert.ok(needsSourceProof('将数值代入定义式，得所需电容。'));
  assert.equal(needsSourceProof('制度是人为设定的制约，减少不确定性。'),false);
});
test('a generic derivation cannot stand in for checking an explicit conditional rule',()=>{
  const text='若结构只有一个子项，则取该子项的值加一；若结构没有子项，其值为零。',branches=sourceBranches(text);
  assert.equal(branches.length,2);
  const raw={status:'consistent',checks:[{case:'一个子项',byDefinition:'得到零',byRule:'用更合理通用公式得到零',definitionValue:0,ruleValue:0,quotes:['若结构没有子项，其值为零']}],conflicts:[]};
  assert.throws(()=>parseSourceReview(JSON.stringify(raw),{text},branches),{code:'PARSE'});
  raw.checks=branches.map(b=>({...raw.checks[0],branchId:b.id,quotes:[b.quote]}));
  assert.equal(parseSourceReview(JSON.stringify(raw),{text},branches).status,'consistent');
});
test('same-batch fact references resolve forward and circular references fail closed',async()=>{
  const base=await entryOf();
  const entry=await auditFacts({entry:base,point,persist:async()=>{},saveEntry:async()=>{},call:async r=>{
    const data=JSON.parse(r.variable);return {text:JSON.stringify({positions:data.positions.map((p,i)=>({position:p.ref,claim:i===0?'改写事实':'独立定义',sameAs:i===0?'s2':null,evidence:p.statement,meaningful:true,leaked:false,consistent:true})),conflicts:[]})};
  }});
  assert.equal(factFor(entry,base.concepts[0].id,base.concepts[0].blanks[0].id).id,factFor(entry,base.concepts[1].id,base.concepts[1].blanks[0].id).id);
  const cycle=await audited(base,{positions:base.concepts.map((c,i)=>({position:`s${i+1}`,claim:'循环引用',sameAs:i===0?'s2':'s1',evidence:c.statement,meaningful:true,leaked:false,consistent:true}))});
  assert.equal(cycle.factAudit.facts.length,0);
});
test('unequal derivation values override a contradictory model agreement flag',()=>{
  const review=parseSourceReview({text:JSON.stringify({status:'consistent',checks:[{case:'合成最小反例',byDefinition:'得到零',byRule:'得到一',definitionValue:0,ruleValue:1,agrees:true,quotes:sentences.slice(0,2)}],conflicts:[]})},point);
  assert.equal(review.status,'conflicted');assert.equal(review.checks[0].agrees,false);assert.equal(review.conflicts.length,1);
});
test('different symbolic unit expressions require equivalence review, not a text-mismatch contradiction',()=>{
  const review=parseSourceReview({text:JSON.stringify({status:'consistent',checks:[{case:'合成单位换算',byDefinition:'单位定义',byRule:'等价单位换算',definitionValue:'1 F=1 C/V',ruleValue:'1 F=10^6 μF',quotes:sentences.slice(0,2)}],conflicts:[]})},point);
  assert.equal(review.status,'consistent');assert.equal(review.checks[0].agrees,null);assert.equal(review.conflicts.length,0);
});
async function entryOf(){return parseConcepts(JSON.stringify({concepts:sentences.map((statement,i)=>({statement,blanks:[{text:['速率','速率','每秒事件数','很重要的标准'][i]}]}))}),point);}
async function audited(entry,overrides={}){
  return auditFacts({entry,point,state:{},persist:async()=>{},saveEntry:async()=>{},call:async r=>{
    if(r.stage==='quiz-source-check')return syntheticSourceCheck();
    if(r.stage==='quiz-source-proof-review')return syntheticProofReview(JSON.parse(r.variable));
    const d=JSON.parse(r.variable);const response={positions:d.positions.map((p,i)=>({position:p.ref,claim:i<2?'速率等于事件次数除以观测时长':i===2?'速率的单位为每秒事件数':'模型标准',evidence:p.statement,meaningful:true,leaked:false,consistent:true,sameAs:null})),conflicts:[],...overrides};return {text:JSON.stringify(response)};
  }});
}
test('coverage groups paraphrases across answer forms, preserves distinct units and excludes filler',async()=>{
  const entry=await audited(await entryOf());assert.equal(entry.factAudit.facts.length,2);assert.equal(entry.factAudit.rejected.length,1);
  const first=entry.concepts[0],second=entry.concepts[1];
  assert.equal(factFor(entry,first.id,first.blanks[0].id).id,factFor(entry,second.id,second.blanks[0].id).id);
  assert.equal(factSlots(entry,[],'cloze',10).length,2,'one fact per batch');
  const history=[{strategy:'recall',type:'trueFalse',conceptId:first.id,blankId:first.blanks[0].id,factId:entry.factAudit.facts[0].id}];
  assert.equal(factSlots(entry,history,'mcq',10).length,1,'switching form cannot bypass fact coverage');
  assert.ok(factSlots(entry,history,'mcq',10,{complete:false}).length>1,'variant mode may practice an existing fact');
});
test('an affirmative model review cannot admit blanks that include the question cue',async()=>{
  const point={courseId:'test',subId:'test',title:'合成符号',text:'该量用于描述样本离散程度，其符号记为 S。'};
  const entry=await parseConcepts(JSON.stringify({concepts:[{statement:point.text,blanks:[{text:'符号记为 S'},{text:'S'}]}]}),point);
  const result=await auditFacts({entry,point,persist:async()=>{},saveEntry:async()=>{},call:async r=>syntheticFactAudit(JSON.parse(r.variable))});
  assert.ok(result.factAudit.rejected.some(r=>r.reason.includes('提示语')));
  const slots=factSlots(result,[],'cloze',10);assert.equal(slots.length,1);assert.equal(slots[0].blank.text,'S');
});
test('grounded contradiction evidence quarantines related positions even when a row says consistent',async()=>{
  const entry=await audited(await entryOf(),{conflicts:[{quotes:[sentences[0],sentences[1]],reason:'合成冲突标记，仅验证隔离逻辑'}]});
  assert.equal(entry.factAudit.facts.length,1);assert.equal(entry.factAudit.conflicts.length,1);
  assert.ok(entry.factAudit.rejected.some(r=>r.reason.includes('冲突')));
});
test('missing position judgments fail closed and fabricated conflict citations cannot become evidence',async()=>{
  const entry=await audited(await entryOf(),{positions:[]});assert.equal(entry.factAudit.facts.length,0);assert.equal(entry.factAudit.rejected.length,4);
  const invalid=await audited(await entryOf(),{conflicts:[{quotes:['并不存在于资料的句子。','另一句不真实的材料引文。'],reason:'invented'}]});
  assert.equal(invalid.factAudit.conflicts.length,0);assert.equal(invalid.factAudit.warnings.length,1);
});
test('unlocated proof uncertainty is disclosed and cannot quarantine unrelated positively reviewed positions',async()=>{
  const entry=await entryOf();const updated=await auditFacts({entry,point,policy:'full',state:{},persist:async()=>{},saveEntry:async()=>{},call:async r=>{
    const d=JSON.parse(r.variable);
    if(r.stage==='quiz-source-check')return syntheticSourceCheck();
    if(r.stage==='quiz-source-proof-review')return {text:JSON.stringify({verdicts:[{index:0,faithful:false,reason:'推演偷换规则'}]})};
    return syntheticFactAudit(d);
  }});
  assert.equal(updated.factAudit.sourceReview.status,'uncertain');assert.ok(updated.factAudit.warnings.length);assert.ok(updated.factAudit.facts.length>0);
});
test('unrecognized targets and failed semantic target alignment cannot save recall questions',async()=>{
  for(const kind of ['unknown-target','wrong-fact']){
    const base=fixtureCall();const generator=createPointQuizGenerator({call:async r=>{
      const response=await base(r),d=JSON.parse(response.text);
      if(kind==='unknown-target'&&r.stage==='quiz-point-mcq')d.items[0].targetId='t999';
      if(kind==='wrong-fact'&&r.stage==='quiz-point-review')for(const v of d.verdicts)v.targetMatched=false;
      return {...response,text:JSON.stringify(d)};
    }});
    const result=await generator({plan:planPointQuestions([fixture.points[0]],{count:1,types:['mcq']}),onQuestion:()=>assert.fail('invalid target admitted')});
    assert.equal(result.produced,0);assert.ok(result.problems.length);
  }
});
test('identical repeated options normalize losslessly but conflicting labels remain invalid',async()=>{
  for(const conflicting of [false,true]){
    const base=fixtureCall(),history=[];
    const generator=createPointQuizGenerator({call:async r=>{const result=await base(r);if(r.stage!=='quiz-point-mcq')return result;const data=JSON.parse(result.text);data.items[0].choices.push(...structuredClone(data.items[0].choices));if(conflicting)data.items[0].choices[4].text='冲突选项';return {...result,text:JSON.stringify(data)};}});
    const result=await generator({plan:planPointQuestions([fixture.points[0]],{count:1,types:['mcq']}),onQuestion:q=>history.push(q)});
    assert.equal(result.produced,conflicting?0:1);if(!conflicting)assert.equal(history[0].choices.length,4);
  }
});
test('fact audit reuses the source-bound cache without model calls',async()=>{
  const entry=await audited(await entryOf());
  assert.equal(await auditFacts({entry,point,call:()=>assert.fail('cached'),persist:async()=>{},saveEntry:async()=>{}}),entry);
});
test('transient contention retries persistence, permanent errors stop immediately',async()=>{
  let attempts=0;await persistWithRetry(async()=>{if(attempts++<2)throw Object.assign(Error('locked'),{code:'EBUSY'});});assert.equal(attempts,3);
  attempts=0;await assert.rejects(persistWithRetry(async()=>{attempts++;throw Object.assign(Error('full'),{code:'ENOSPC'});}));assert.equal(attempts,1);
});
test('saved model response survives parse/checkpoint interruption without another paid generation',async()=>{
  const calls=[],history=[];let snapshot,stop=true;
  const generator=createPointQuizGenerator({call:async r=>{
    calls.push(r.stage);const d=JSON.parse(r.variable);
    if(r.stage==='quiz-rewrite')return {text:JSON.stringify({concepts:[{statement:sentences[0],blanks:[{text:'速率'}]}]})};
    if(r.stage==='quiz-fact-audit')return syntheticFactAudit(d);
    if(r.stage==='quiz-source-check')return syntheticSourceCheck();
    if(r.stage==='quiz-source-proof-review')return syntheticProofReview(d);
    if(r.stage==='quiz-point-review')return {text:JSON.stringify({verdicts:[{index:0,valid:true,targetMatched:true,novel:true}]})};
    return {text:JSON.stringify({items:[{targetId:'t1',stem:'所给材料中，该量称为什么？',choices:['速率','方差','均值','概率'].map((text,i)=>({label:'ABCD'[i],text})),answer:'A',basis:sentences[0],angle:'名称',explanation:sentences[0]}]})};
  }});
  const plan=planPointQuestions([point],{count:1,types:['mcq']});
  await assert.rejects(generator({plan,onQuestion:q=>history.push(q),onCheckpoint:s=>{snapshot=structuredClone(s);if(stop&&s.phase==='model-saved'&&calls.at(-1)==='quiz-point-mcq'){stop=false;throw Error('interruption after durable response');}}}),{code:'PERSIST'});
  const result=await generator({plan,checkpoint:snapshot,onQuestion:q=>history.push(q)});
  assert.equal(result.produced,1);assert.equal(calls.filter(s=>s==='quiz-point-mcq').length,1);assert.ok(history[0].factId);assert.ok(history[0].blankId);
});
