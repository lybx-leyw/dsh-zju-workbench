import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileIdeas,createScheduler,createQuestionGenerator,inspectGraph,graphFromRecord,atPath,walkTree,validateBranchReview,validateCriticalAudit} from '../scripts/quiz_bench/experimental-r3/index.mjs';
import {runR3} from '../scripts/quiz_bench/experimental-r3/run.mjs';
import {deepTutorBenchHost} from '../scripts/quiz_bench/deeptutor-host.mjs';
import {createToolTransport,toolRequest,toolArguments,nodeToolRequest,nodeArguments,failedTool} from '../scripts/quiz_bench/experimental-r3/tools.mjs';
import {sourceParts,bindBasis} from '../scripts/quiz_bench/experimental-r3/tree.mjs';
import {reserveWithExpansion} from '../scripts/quiz_bench/experimental-r3/expansion.mjs';
import {createCapsuleStore,projectTeachingBooks,validateCapsule,readOwnedMaterial} from '../scripts/quiz_bench/experimental-r3/capsules.mjs';
const submitted=(name,data)=>name==='node'?{text:'',toolCalls:[...data.ideas.map(idea=>({id:crypto.randomUUID(),name:'submit_idea',arguments:JSON.stringify(idea)})),{id:crypto.randomUUID(),name:'finish_node',arguments:JSON.stringify(data.coverage)}]}:{text:'',toolCalls:[{id:'fixture-'+crypto.randomUUID(),name,arguments:JSON.stringify(data)}]};
const leaf=(id,text)=>({id,title:id,text,children:[]});
const graph=()=>({id:'fixture',revision:'final-1',root:{id:'root',title:'综合',children:[{id:'ab',title:'方法关系',children:[leaf('a','材料甲定义一种固定状态变更操作。'),leaf('b','材料乙说明失败后可重新发起同一请求。')]},{id:'c-group',title:'结果观察',children:[leaf('c','材料丙区分回执内容与实际执行状态。')]}]}});
const fake=()=>{const calls=[],inputs=[];let active=0,peak=0;return {calls,inputs,get peak(){return peak;},call:async r=>{
 r.signal?.throwIfAborted();calls.push(r.stage);active++;peak=Math.max(peak,active);await delay(1);active--;
 const d=JSON.parse(r.variable);inputs.push({stage:r.stage,data:d});
 const expected=r.stage==='r3-instantiate'?'submit_question':r.stage==='r3-validate-instance'?'submit_review':r.stage==='r3-critical-audit'?'submit_audit':'submit_idea';
 assert.equal(r.tools[0].name,expected);if(expected==='submit_idea'){assert.equal(r.toolChoice,'required');assert.equal(r.tools[1].name,'finish_node');}else assert.equal(r.toolChoice.function.name,expected);
 if(r.stage==='r3-leaf-ideas'||r.stage==='r3-parent-ideas'){
  const n=d.subtree,firstLeaf=node=>node.children.length?firstLeaf(node.children[0]):node;
  const basis=n.children.length?n.children.map(c=>{const leaf=firstLeaf(c);return {path:leaf.path,source:'lecture',part:leaf.lecture[0].part};}):[{path:[],source:'lecture',part:n.lecture[0].part}];
  return submitted('node',{ideas:[{key:'idea',focus:n.title+'的具体任务',target:n.title+'中的未知关系与成立边界',operation:'比较给定条件',strategy:'understand',types:['mcq','shortAnswer'],conditions:['保持已给条件'],basis,answerPoints:basis.map((b,i)=>({text:'依据该来源完成相应推理',basisIndexes:[i]})),variants:[{key:'case-b',instruction:'将操作对象换为对象乙，保留原判定条件',parameters:{case:'对象乙'}}],relation:n.children.length?{kind:'compare',explanation:'结合两个子分支的条件才能作出比较',needs:n.children.map((c,i)=>({child:i,target:c.title+'用于本次判定的未知条件',basisIndexes:[i]}))}:null}],coverage:{included:[n.title],unassessable:[]}});
 }
 if(r.stage==='r3-instantiate')return submitted('submit_question',{items:[{stem:d.idea.focus+'：'+(d.variant.parameters.case??'初始对象'),answer:'B',choices:[{label:'A',text:'忽略已知条件'},{label:'B',text:'按给定条件比较'},{label:'C',text:'假设额外前提'},{label:'D',text:'混淆判定对象'}],explanation:'依据给定条件比较即可。',rubric:['逐项对应条件'],usedBasisIndexes:d.idea.basis.map((_,i)=>i)}]});
 if(r.stage==='r3-critical-audit')return submitted('submit_audit',{explanationValid:true,unsupportedClaims:[],reason:'各推断均有依据',joint:true,neededChildren:d.requiredChildren,jointPromptQuote:d.item.stem,leakedTarget:false});
 return submitted('submit_review',{valid:true,assetMatched:true,variantMatched:true,reason:'各条件与答案一致',optionTruth:{A:false,B:true,C:false,D:false},...(d.idea.relation?{branchChecks:d.idea.relation.needs.map(n=>({child:n.child,promptQuote:d.item.stem,necessary:true,givenAway:false,reason:'本分支实际参与判定'}))}:{})});
 }};};

function capsuleFixture(idea){return {summary:'依据固定条件解释当前操作。',conditions:['保持原条件'],evidence:idea.basis.map(({path,source,page,field,part})=>({path,source,page,field,part})),steps:[{id:'s1',text:'依据原文条件作出相应判断。',kind:'restatement',evidenceIndexes:[0],dependsOn:[]}],pitfalls:[],example:{question:'在给定条件下如何处理对象甲？',answer:'按原条件执行操作。',steps:['核对条件，再执行规定操作。']},uncertainties:[]};}
function teachingFake(){const base=fake(),inputs=[];return {base,inputs,call:async r=>{
 const d=JSON.parse(r.variable);inputs.push({stage:r.stage,data:d,request:r});
 if(r.stage==='r3-capsule-compile')return submitted('submit_capsule',capsuleFixture(d.idea));
 if(r.stage==='r3-capsule-review')return submitted('submit_capsule_review',{decision:'accept',reason:'证据与范围相符',issues:[]});
 if(r.stage==='r3-blind-solve')return submitted('submit_solution',{valid:true,answer:'B',explanation:'根据原条件独立得到该结论。',reason:'唯一符合给定条件',optionTruth:{A:false,B:true,C:false,D:false}});
 if(r.tools[0].name==='submit_final_review'){assert.ok(r.constant.includes('用 submit_final_review'));assert.ok(!r.constant.includes('用 submit_audit'));return submitted('submit_final_review',{explanationValid:true,unsupportedClaims:[],reason:'推断、方案与变体一致',assetMatched:true,variantMatched:true,joint:true,neededChildren:d.requiredChildren,jointPromptQuote:d.item.stem,leakedTarget:false,...(d.requiredChildren.length?{branchChecks:d.requiredChildren.map(child=>({child,promptQuote:d.item.stem,necessary:true,givenAway:false,reason:'必答依赖'}))}:{})});}
 return base.call(r.stage==='r3-instantiate'?{...r,toolChoice:{type:'function',function:{name:'submit_question'}}}:r);
}};}

test('r3 caches teaching verification across variants and projects both books without extra model calls',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library});let cache;
 const capsules=createCapsuleStore({call:m.call,onCheckpoint:value=>{cache=value;}}),p=await s.reserve({count:1,quotas:{a:1}});
 const first=await createQuestionGenerator({library,scheduler:s,call:m.call,capsules,blind:true})(p.id);assert.equal(first.produced,1);assert.equal(first.questions[0].explanationOrigin,'independent-solver');
 const secondPlan=await s.reserve({count:1,quotas:{a:1}}),restored=createCapsuleStore({cache,call:()=>{throw Error('verified asset must be reused');}});
 const second=await createQuestionGenerator({library,scheduler:s,call:m.call,capsules:restored,blind:true})(secondPlan.id);assert.equal(second.produced,1);assert.equal(m.inputs.filter(r=>r.stage==='r3-capsule-compile').length,1);
 const before=m.inputs.length,books=await projectTeachingBooks(library,cache);assert.equal(m.inputs.length,before);
 const lesson=books.explanations.root.children[0].children[0].items[0],example=books.examples.root.children[0].children[0].items[0];assert.equal(lesson.status,'verified');assert.ok(lesson.explanation.evidence[0].quote);assert.ok(example.example.answer);assert.equal(example.explanation,undefined);assert.equal(books.examples.root.children[1].children[0].items[0].status,'uncompiled');
 const changed=structuredClone(library);changed.root.children[0].children[0].text+='资料版本发生变化';const stale=await projectTeachingBooks(changed,cache);assert.equal(stale.examples.root.children[0].children[0].items[0].status,'uncompiled');
});

test('r3 blind solver never receives author answer, explanation, blueprint or worked example',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}}),capsules=createCapsuleStore({call:m.call});
 await createQuestionGenerator({library,scheduler:s,call:m.call,capsules,blind:true})(p.id);
 const input=m.inputs.find(r=>r.stage==='r3-blind-solve').data;assert.equal(input.item.answer,undefined);assert.equal(input.item.explanation,undefined);assert.equal(input.idea,undefined);assert.equal(input.variant,undefined);assert.equal(input.capsule,undefined);assert.equal(input.example,undefined);assert.equal(input.context.subtree,undefined);assert.ok(input.context.sources[0].text);assert.ok(input.context.outline);
});

test('r3 evidence workers can read full owned material through native tool result IDs',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}}),capsules=createCapsuleStore({call:m.call});let read=false,received;
 const call=async r=>{if(r.stage==='r3-blind-solve'&&!read){read=true;return submitted('read_material',{path:[],source:'all'});}if(r.stage==='r3-blind-solve')received=r.toolFeedback;return m.call(r);};
 const result=await createQuestionGenerator({library,scheduler:s,call,capsules,blind:true})(p.id);assert.equal(result.produced,1);assert.equal(received.toolCalls[0].name,'read_material');assert.equal(received.results[0].id,received.toolCalls[0].id);assert.equal(received.results[0].material.title,'a');assert.throws(()=>readOwnedMaterial(library.root.children[0].children[0],{path:[1],source:'all'}),/超出/);
});

test('r3 holds disputed assets in their original task and does not silently publish or recompile them',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}});let reviews=0;
 const call=async r=>{if(r.stage==='r3-capsule-review'){reviews++;return submitted('submit_capsule_review',{decision:'source-review',reason:'原文两条条件矛盾',issues:[{kind:'error',text:'不能从材料确认任务成立'}]});}return m.call(r);};
 const capsules=createCapsuleStore({call}),generate=createQuestionGenerator({library,scheduler:s,call,capsules,blind:true}),result=await generate(p.id);assert.equal(result.produced,0);assert.equal(s.get(p.id).tickets[0].state,'needs-asset-review');await generate(p.id);assert.equal(reviews,1);assert.equal(m.inputs.filter(r=>r.stage==='r3-instantiate').length,0);const books=await projectTeachingBooks(library,capsules.snapshot);assert.equal(books.examples.root.children[0].children[0].items[0].example,undefined);
});

test('r3 rejects cyclic evidence chains before assets can become shared teaching material',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),node=library.root.children[0].children[0],idea=node.ideas[0],raw=capsuleFixture(idea);raw.steps[0].dependsOn=['s1'];assert.throws(()=>validateCapsule(raw,node,idea),/循环或无依据/);
});

test('r3 bounded applicability notes remain visible without blocking an independently accepted asset',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}});
 const call=async r=>{const raw=await m.call(r);if(r.stage==='r3-capsule-compile'){const d=toolArguments(raw,'submit_capsule');d.uncertainties=['结论只适用于已列出的固定条件。'];return submitted('submit_capsule',d);}if(r.stage==='r3-capsule-review'){const d=toolArguments(raw,'submit_capsule_review');d.issues=[{kind:'limitation',text:'结论只适用于已列出的条件'}];return submitted('submit_capsule_review',d);}return raw;};
 const capsules=createCapsuleStore({call}),result=await createQuestionGenerator({library,scheduler:s,call,capsules,blind:true})(p.id);assert.equal(result.produced,1);const books=await projectTeachingBooks(library,capsules.snapshot);assert.equal(books.explanations.root.children[0].children[0].items[0].explanation.limitations.length,1);
});

test('r3 independent cloze solving masks the embedded author answer in student-facing markup',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,types:['cloze'],quotas:{a:1}});
 const call=async r=>{if(r.stage==='r3-instantiate')return submitted('submit_question',{items:[{stem:'根据材料，执行规定操作前必须核对的内容是{{c1::原条件}}。',answer:'原条件',explanation:'作者解析'}]});if(r.stage==='r3-blind-solve'){const d=JSON.parse(r.variable);assert.ok(!d.item.stem.includes('原条件'));assert.ok(d.item.stem.includes('[填空]'));return submitted('submit_solution',{valid:true,answer:'原条件',explanation:'材料明确须先核对原条件。',reason:'空缺可唯一求得'});}return m.call(r);};
 const result=await createQuestionGenerator({library,scheduler:s,call,capsules:createCapsuleStore({call}),blind:true})(p.id);assert.equal(result.produced,1);
});

test('r3 short-answer independence uses the solved response rather than demanding identical author wording',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,types:['shortAnswer'],quotas:{a:1}});
 const call=async r=>{if(r.stage==='r3-instantiate')return submitted('submit_question',{items:[{stem:'解释为什么应在操作前核对给定条件。',answer:'先检查条件才可以执行操作。',explanation:'作者表述。',rubric:['说明条件与操作的关系']}]});if(r.stage==='r3-blind-solve')return submitted('submit_solution',{valid:true,answer:'操作依赖条件，须先确认条件成立。',explanation:'材料将条件作为执行操作的前提。',reason:'同一推理的独立表述'});return m.call(r);};
 const result=await createQuestionGenerator({library,scheduler:s,call,capsules:createCapsuleStore({call}),blind:true})(p.id);assert.equal(result.produced,1);assert.equal(result.questions[0].answer,'操作依赖条件，须先确认条件成立。');
});

test('r3 shared-asset feedback versions the source of truth and rechecks dependent questions',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}}),capsules=createCapsuleStore({call:m.call}),generate=createQuestionGenerator({library,scheduler:s,call:m.call,capsules,blind:true});
 const before=await generate(p.id),oldKey=before.questions[0].capsuleKey;await capsules.requestRepair(before.questions[0].ideaId,'讲解中的某个推断缺少适用条件，需要收紧。');
 const pending=await projectTeachingBooks(library,capsules.snapshot);assert.equal(pending.examples.root.children[0].children[0].items[0].status,'draft');assert.equal(pending.examples.root.children[0].children[0].items[0].example,undefined);
 const after=await generate(p.id);assert.equal(after.produced,1);assert.notEqual(after.questions[0].capsuleKey,oldKey);assert.equal(m.inputs.filter(r=>r.stage==='r3-capsule-compile').length,2);assert.equal(s.resultTree.children[0].children[0].archivedQuestions.length,1);assert.equal(Object.values(capsules.snapshot.entries)[0].past.length,1);
});

test('r3 rejects an attempt to reinterpret already completed raw questions as independently solved questions',async()=>{
 const m=teachingFake(),library=await compileIdeas({graph:graph(),call:m.base.call}),s=createScheduler({library}),p=await s.reserve({count:1,quotas:{a:1}});await createQuestionGenerator({library,scheduler:s,call:m.base.call})(p.id);
 await assert.rejects(createQuestionGenerator({library,scheduler:s,call:m.call,capsules:createCapsuleStore({call:m.call}),blind:true})(p.id),/生成模式已变化/);assert.equal(m.inputs.length,0);
});

test('bench transport retains known token usage from a truncated response without pretending it succeeded',async()=>{
 const originalFetch=globalThis.fetch,receipts=[],events=[];globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'unfinished'}}],usage:{prompt_tokens:11,completion_tokens:7,total_tokens:18}}),{status:200});
 try{const host=deepTutorBenchHost({baseUrl:'https://example.invalid',apiKey:'fixture',model:'fixture',onCall:r=>receipts.push(r),onAttempt:r=>events.push(r)}),prepared=await host.prepareCall({});await assert.rejects(async()=>{for await(const _ of prepared.stream({messages:[]})){}},/length/);assert.equal(receipts.length,1);assert.equal(receipts[0].response.usage.total_tokens,18);assert.equal(events.at(-1).status,'failed');}finally{globalThis.fetch=originalFetch;}
});

test('r3 fixes review tool schema errors in review with matching IDs and no question regeneration',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1});let reviews=0,feedback;
 const call=async r=>{if(r.stage==='r3-validate-instance'&&++reviews===1)return submitted('submit_review',{valid:true,assetMatched:true,variantMatched:true,reason:'valid',extraNote:'unexpected'});if(r.stage==='r3-validate-instance')feedback=r.toolFeedback;return m.call(r);};
 const result=await createQuestionGenerator({library,scheduler:s,call})(p.id);
 assert.equal(result.produced,1);assert.equal(reviews,2);assert.equal(m.calls.filter(x=>x==='r3-instantiate').length,1);
 assert.equal(feedback.toolCalls[0].name,'submit_review');assert.match(feedback.error,/extraNote/);assert.equal(s.get(p.id).tickets[0].attempts,1);
});

test('r3 preserves draft after exhausted protocol budget and resumes the exact failed tool',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1});
 const invalid=async r=>r.stage==='r3-validate-instance'?submitted('submit_review',{valid:true}):m.call(r);
 const partial=await createQuestionGenerator({library,scheduler:s,call:invalid})(p.id);assert.equal(partial.state,'partial');assert.ok(s.get(p.id).tickets[0].draft);assert.equal(s.get(p.id).tickets[0].previousDrafts?.length??0,0);
 const restored=createScheduler({library,ledger:s.snapshot}),resumed=await createQuestionGenerator({library,scheduler:restored,call:m.call})(p.id);
 assert.equal(resumed.produced,1);assert.equal(m.calls.filter(x=>x==='r3-instantiate').length,1);assert.equal(restored.get(p.id).tickets[0].attempts,1);
});

test('r3 attaches known provenance without forcing the model to repeat citation bookkeeping',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1});
 const call=async r=>{const raw=await m.call(r);if(r.stage==='r3-instantiate'){const data=JSON.parse(raw.toolCalls[0].arguments);delete data.items[0].usedBasisIndexes;return submitted('submit_question',data);}return raw;};
 const r=await createQuestionGenerator({library,scheduler:s,call})(p.id);assert.equal(r.produced,1);assert.equal(r.questions[0].basis.length,1);assert.deepEqual(r.questions[0].usedBasisIndexes,[0]);
});

test('r3 does not treat permanent provider errors as semantic repair requests',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:2});let requests=0;
 await assert.rejects(createQuestionGenerator({library,scheduler:s,call:async()=>{requests++;throw Error('模型接口返回 402：Insufficient Balance');}})(p.id),/402/);
 assert.ok(requests<=2);assert.ok(s.get(p.id).tickets.every(t=>t.attempts===1));
});

test('r3 extends variants only at the deficient owner and restores them across restart',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library});
 await s.reserve({count:2,quotas:{a:2},requestId:'first'});let calls=0;
 const request={count:1,types:['mcq'],scope:'local',strategies:['understand'],quotas:{a:1},requestId:'next'};
 const p=await reserveWithExpansion({library,scheduler:s,request,call:async r=>{calls++;const input=JSON.parse(r.variable);assert.equal(input.subtree.title,'a');assert.equal(input.needed,1);assert.equal(input.subtree.children.length,0);return submitted('submit_variants',{variants:[{ideaKey:'idea',key:'new-case',instruction:'新增条件并比较第二种状态下的判定结果',parameters:{state:'second'},difference:'新增对第二种状态的约束，必须重新比较条件'}],reason:'有可靠的新条件'});}});
 assert.equal(p.tickets[0].nodeId,'a');assert.equal(calls,1);assert.equal(p.tickets[0].variant.key,'new-case');
 const restored=createScheduler({library,ledger:s.snapshot});assert.equal(restored.nodeVariants([0,0])[0].variants.length,3);
 const repeated=await reserveWithExpansion({library,scheduler:restored,request,call:()=>{throw Error('idempotent reservation must not call');}});assert.equal(repeated.id,p.id);
 await assert.rejects(restored.extendVariants([0,1],[{ideaKey:'unknown'}]),/原节点/);
});

test('r3 requested presentation does not remove an otherwise valid cognitive task',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call});library.root.children[0].children[0].ideas[0].types=['shortAnswer'];
 const s=createScheduler({library}),p=await s.reserve({count:1,types:['mcq'],scope:'local',quotas:{a:1},strategies:['understand']});
 assert.equal(p.tickets[0].nodeId,'a');assert.equal(p.tickets[0].type,'mcq');assert.equal(p.tickets[0].ideaKey,'idea');
});

test('r3 accepts thirteen distinct node-owned targets without losing accepted submissions at an arbitrary twelve-item boundary',async()=>{
 const m=fake(),g={id:'many',root:leaf('root','材料定义多种可独立考查的操作。')};
 const library=await compileIdeas({graph:g,call:async r=>{const raw=await m.call(r),data=nodeArguments(raw),base=data.ideas[0];data.ideas=Array.from({length:13},(_,i)=>({...structuredClone(base),key:'target-'+i,target:'第'+i+'种操作的独立判定目标'}));return submitted('node',data);}});
 assert.equal(library.root.ideas.length,13);assert.equal(library.stats.modelCalls,1);
});

test('r3 partial title keeps valid children usable and exposes pending status instead of claiming completeness',async()=>{
 const m=fake(),call=async r=>{if(r.stage==='r3-parent-ideas')return {toolCalls:[{id:'bad-parent',name:'submit_idea',arguments:'{}'}]};return m.call(r);};
 const graphInput={id:'partial',root:{id:'title',title:'标题',children:[leaf('left','左分支材料说明原规则。'),leaf('right','右分支材料说明另一条件。')]}};
 const library=await compileIdeas({graph:graphInput,call,allowPartialTitles:true});assert.equal(library.stats.partialTitles,1);assert.match(library.root.pendingReason,/待整改/);assert.equal(library.root.ideas.length,0);assert.equal(library.root.children[0].ideas.length,1);
 const s=createScheduler({library}),p=await s.reserve({count:2,scope:'local',types:['mcq']});assert.equal(p.tickets.length,2);assert.ok(library.cache.drafts.title);
 const complete=await compileIdeas({graph:graphInput,call:m.call,cache:library.cache,allowPartialTitles:true});assert.equal(complete.stats.partialTitles,0);assert.notEqual(complete.key,library.key);assert.equal(complete.root.children[0].ideas[0].id,library.root.children[0].ideas[0].id);
});

test('r3 persists the complete compile/generate/resume chain in its own directory',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'quiz-r3-'));
 try{
  const m=fake(),g=graph(),compiled=await runR3({assetMode:'raw',graph:g,directory,call:m.call,compileOnly:true});
  assert.equal(compiled.state,'compiled');assert.equal(m.calls.length,5);
  const generated=await runR3({assetMode:'raw',graph:g,directory,call:m.call,count:2,requestId:'durable-plan'});
  assert.equal(generated.produced,2);assert.equal(m.calls.length,11);
  const restored=await runR3({assetMode:'raw',graph:g,directory,call:()=>{throw Error('completed run must not call model');},resumeId:'durable-plan'});
  assert.equal(restored.produced,2);
  const state=JSON.parse(await fs.readFile(path.join(directory,'r3-state.json'),'utf8'));
  assert.equal(Object.keys(state.ledger.allocated).length,2);assert.equal(state.library.stats.ideas,5);
  assert.equal(state.library.root.children[0].children[0].nodeId,'a');
  assert.equal([...walkTree(state.ledger.resultTrees[state.library.key])].reduce((n,{node})=>n+node.questions.length,0),2);
  await fs.writeFile(path.join(directory,'r3-state.json'),'{broken');
  await assert.rejects(runR3({assetMode:'raw',graph:g,directory,call:m.call,compileOnly:true}),SyntaxError);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('r3 compiles leaves before parents, forwards single children, and reuses a library without model calls',async()=>{
 const m=fake(),g=graph(),first=await compileIdeas({graph:g,call:m.call,concurrency:2});
 assert.equal(m.calls.length,5);assert.equal(first.stats.ideas,5);assert.equal(first.stats.nodes,6);assert.equal(m.peak,2);
 assert.ok(first.root.ideas[0].coveredNodeIds.includes('c'),'single-child wrapper preserves its actual subtree');
 assert.equal(first.assets,undefined);assert.equal(first.ideas,undefined);assert.equal(first.sources,undefined);
 const input=m.inputs.find(r=>r.stage==='r3-parent-ideas'&&r.data.subtree.title==='综合').data.subtree;
 assert.equal(input.children[0].children[0].lecture.map(p=>p.text).join('\n'),g.root.children[0].children[0].text);
 assert.equal(input.children[0].ideas.length,1);assert.equal(input.children[0].children[0].ideas.length,1);
 assert.deepEqual(input.children[0].ideas[0].basis[0].path,[0,0],'child idea sources are rebased for the parent');
 const before=m.calls.length,again=await compileIdeas({graph:g,call:m.call,cache:first.cache});assert.equal(m.calls.length,before);assert.equal(again.stats.reusedNodes,6);assert.equal(again.key,first.key);
 const changed=graph();changed.root.children[0].children[0].text+='追加一个明确限定条件。';await compileIdeas({graph:changed,call:m.call,cache:first.cache});
 assert.equal(m.calls.length-before,3,'only edited leaf and its two ancestors rebuild');
});
test('r3 rejects unsupported parent relationships and fabricated quotes instead of manufacturing coverage',async()=>{
 const m=fake();await assert.rejects(compileIdeas({graph:graph(),call:async r=>{
  const response=await m.call(r);if(r.stage==='r3-parent-ideas'){const d=nodeArguments(response);d.ideas[0].basis=d.ideas[0].basis.slice(0,1);d.ideas[0].answerPoints=[{text:'缺失另一分支',basisIndexes:[0]}];return submitted('node',d);}return response;
 }}),/两个直接子分支/);
 const duplicate=graph();duplicate.root.children[1].id='ab';assert.throws(()=>inspectGraph(duplicate),/ID唯一/);
});
test('r3 reserves distinct persisted slots across concurrent requests and keeps idempotent request IDs',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),writes=[];
 const s=createScheduler({library,onCheckpoint:async value=>{await delay(1);writes.push(value);}});
 const [a,b]=await Promise.all([s.reserve({count:3,requestId:'a'}),s.reserve({count:3,requestId:'b'})]);
 assert.equal(new Set([...a.tickets,...b.tickets].map(t=>t.slotId)).size,6);assert.deepEqual(await s.reserve({count:3,requestId:'a'}),a);
 await assert.rejects(s.reserve({count:100,requestId:'too-many'}),/槽位不足/);assert.equal(Object.keys(s.snapshot.plans).length,2);
 const restored=createScheduler({library,ledger:writes.at(-1)});assert.deepEqual(restored.get('b'),b);
 const cross=await s.reserve({count:1,scope:'cross',requestId:'parent'});assert.ok(atPath(library.root,cross.tickets[0].nodePath).children.length);
});
test('r3 generates one question per ticket concurrently, preserves cross-node provenance and coalesces duplicate runs',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),plan=await s.reserve({count:5});
 const generate=createQuestionGenerator({library,scheduler:s,call:m.call,concurrency:2}),a=generate(plan.id),b=generate(plan.id);assert.equal(a,b);
 const result=await a;assert.equal(result.state,'completed');assert.equal(result.questions.length,5);assert.equal(m.peak,2);
 assert.ok(result.questions.some(q=>q.coveredNodeIds.length===2));const before=m.calls.length;await generate(plan.id);assert.equal(m.calls.length,before);
 assert.ok(result.questions.every(q=>q.slotId&&q.ideaId&&q.libraryKey===library.key));
 for(const q of result.questions)assert.ok(atPath(result.resultTree,q.nodePath).questions.some(saved=>saved.id===q.id),'write results back to owning nodes');
});
test('r3 interruption preserves the generated draft and resumes review without generating again',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),controller=new AbortController();let saved;
 const s=createScheduler({library,onCheckpoint:async ledger=>{saved=ledger;if(Object.values(ledger.plans).some(p=>p.tickets.some(t=>t.draft&&t.state==='reviewing')))controller.abort();}}),plan=await s.reserve({count:1});
 await assert.rejects(createQuestionGenerator({library,scheduler:s,call:m.call})(plan.id,{signal:controller.signal}),{name:'AbortError'});
 const before=m.calls.filter(x=>x==='r3-instantiate').length,restored=createScheduler({library,ledger:saved});
 const r=await createQuestionGenerator({library,scheduler:restored,call:m.call})(plan.id);assert.equal(r.produced,1);assert.equal(m.calls.filter(x=>x==='r3-instantiate').length,before);
});
test('r3 exact-output collisions retain a repair ticket rather than silently reducing requested quantity',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),plan=await s.reserve({count:2});
 const result=await createQuestionGenerator({library,scheduler:s,call:async r=>{
  const raw=await m.call(r);if(r.stage==='r3-instantiate'){const data=toolArguments(raw,'submit_question');data.items[0].stem='相同的输出题目';return submitted('submit_question',data);}return raw;
 }})(plan.id,{maxAttempts:1});
 assert.equal(result.produced,1);assert.equal(result.state,'partial');assert.equal(result.pending.length,1);assert.equal(Object.keys(s.snapshot.allocated).length,2);
});
test('r3 checkpoint failures cannot publish a reservation or start paid work',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library,onCheckpoint:async()=>{throw Error('disk unavailable');}});
 const before=m.calls.length;await assert.rejects(s.reserve({count:1}),{code:'PERSIST'});assert.equal(Object.keys(s.snapshot.allocated).length,0);assert.equal(m.calls.length,before);
});
test('r3 editing another branch does not make an unchanged idea slot available again',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library});
 const first=await s.reserve({count:1,nodeIds:['b'],requestId:'before'}),changed=graph();changed.root.children[0].children[0].text+='新的局部限定条件。';
 const next=await compileIdeas({graph:changed,cache:library.cache,call:m.call}),restored=createScheduler({library:next,ledger:s.snapshot});
 assert.throws(()=>restored.get(first.id),/版本已变化/);
 const second=await restored.reserve({count:1,nodeIds:['b'],requestId:'after'});
 assert.equal(first.tickets[0].ideaId,second.tickets[0].ideaId);assert.equal(second.tickets[0].variant.key,'case-b');
});
test('r3 record bridge binds the existing semantic tree to final wording and rejects missing final nodes',()=>{
 const record={courseId:'c',subId:'s',tree:{kind:'title',title:'章',children:[{kind:'title',title:'知识点',semanticTopic:true,children:[{kind:'leaf',blocks:[{index:1}]}]}]},blocks:[{index:1,page:7,tag:{role:'主线'},text:'旧正文'}],pages:[{page:7,transcription:{pageText:'对应页的完整文字内容。',pageVisual:'对应页的流程示意图内容。'}},{page:8,transcription:{pageText:'无关页不得混入。'}}]};
 const lecture={chapters:[{title:'章',topics:[{title:'知识点',text:'这是经过润色后的真正讲义正文。',blocks:[{text:'这是经过润色后的真正讲义正文。',sourceBlockIndexes:[1]}]}]}]};
 const converted=graphFromRecord(record,lecture);assert.equal(converted.root.children[0].text,'这是经过润色后的真正讲义正文。');
 assert.deepEqual(converted.root.children[0].pages,[{page:7,text:'对应页的完整文字内容。',visual:'对应页的流程示意图内容。'}]);
 assert.throws(()=>graphFromRecord(record,{chapters:[]}),/无法唯一绑定/);
});

test('r3 parents read full descendant bodies and page details, including evidence never used by child ideas',async()=>{
 const g={id:'details',root:{id:'r',title:'关系',children:[leaf('x','甲节点已有基础说明内容。\n尚未剥离的限制条件属于甲节点。'),leaf('y','乙节点已有基础说明内容。\n尚未剥离的关联条件属于乙节点。')]}};
 g.root.children[0].pages=[{page:7,text:'页详情还明确给出一项额外约束条件。',visual:'图示分支连接到一个新的校验步骤。'}];
 const m=fake();const library=await compileIdeas({graph:g,call:async request=>{
  const raw=await m.call(request);if(request.stage!=='r3-parent-ideas')return raw;
  const d=JSON.parse(request.variable),a=d.subtree.children[0],b=d.subtree.children[1];
  assert.equal(a.pages[0].text[0].text,g.root.children[0].pages[0].text);assert.ok(a.lecture.some(p=>p.text.includes('尚未剥离')));
  assert.equal(a.ideas[0].basis[0].part,0);assert.equal(a.lecture[0].text,'甲节点已有基础说明内容。');
  assert.equal(JSON.stringify(d).includes('nodeId'),false,'internal IDs are not a model contract');
  const o=nodeArguments(raw);o.ideas[0].basis=[{path:a.path,source:'page',page:7,field:'text',part:0},{path:b.path,source:'lecture',part:1}];return submitted('node',o);
 }});
 assert.equal(library.root.ideas[0].basis[0].nodeId,'x');assert.equal(library.root.ideas[0].basis[0].source,'page');
 assert.equal(library.root.ideas[0].basis[1].quote,'尚未剥离的关联条件属于乙节点。');
 const s=createScheduler({library}),p=await s.reserve({count:1,scope:'cross',types:['shortAnswer']});assert.deepEqual(p.tickets[0].nodePath,[]);
});

test('r3 a title can discover a cross-point idea even when its children have no usable local ideas',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:async request=>{
  if(request.stage==='r3-leaf-ideas')return submitted('node',{ideas:[],coverage:{included:[],unassessable:[],reason:'没有独立局部考法，保留正文供上级推理'}});
  return m.call(request);
 }});
 assert.equal(library.root.children[0].children[0].ideas.length,0);
 assert.equal(library.root.children[0].ideas.length,1);assert.equal(library.root.ideas.length,1);
});

test('r3 subtree selection and question contexts follow ancestry without unrelated sibling material',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library});
 const selected=await s.reserve({count:3,nodeIds:['ab']});assert.deepEqual(new Set(selected.tickets.map(t=>t.nodeId)),new Set(['a','b','ab']));
 const plan=await s.reserve({count:1,nodeIds:['c'],requestId:'only-c'});await createQuestionGenerator({library,scheduler:s,call:m.call})(plan.id);
 const input=m.inputs.find(r=>r.stage==='r3-instantiate').data.context;
 assert.equal(input.subtree.ideas,undefined,'workers get source trees without unrelated blueprint lists');
 assert.equal(input.subtree.lecture[0].text,graph().root.children[1].children[0].text);assert.deepEqual(input.subtree.children,[]);
 assert.equal(JSON.stringify(input).includes('固定状态变更操作'),false);
});

test('r3 repairing invalid source references gets the actual prior output and a precise reason',async()=>{
 const m=fake();let damaged=false,sawRepair=false;
 const result=await compileIdeas({graph:graph(),call:async request=>{
  const input=JSON.parse(request.variable),raw=await m.call(request);
  if(request.stage==='r3-leaf-ideas'&&input.subtree.title==='a'){
   if(!damaged){damaged=true;const d=nodeArguments(raw);d.ideas[0].basis[0].part=999;return submitted('node',d);}
   sawRepair=true;assert.match(input.repair.error,/basis\[0\]/);assert.match(request.toolFeedback.toolCalls[0].arguments,/999/);
  }return raw;
 }});
 assert.equal(sawRepair,true);assert.equal(result.stats.modelCalls,6);
});

test('r3 editing page details only rebuilds the owning leaf and its ancestor chain',async()=>{
 const m=fake(),g=graph();g.root.children[0].children[0].pages=[{page:3,text:'页面内的一项原始约束条件。'}];
 const first=await compileIdeas({graph:g,call:m.call});g.root.children[0].children[0].pages[0].text='页面内的一项修订约束条件。';
 const second=await compileIdeas({graph:g,call:m.call,cache:first.cache});assert.equal(second.stats.modelCalls,3);assert.equal(second.stats.reusedNodes,3);
});

test('r3 a compiler checkpoint failure stops queued model work without paid repair retries',async()=>{
 const m=fake();await assert.rejects(compileIdeas({graph:graph(),call:m.call,concurrency:1,onCheckpoint:async()=>{throw Error('disk failed');}}),{code:'PERSIST'});
 assert.ok(m.calls.length<=2,'at most one request that had already acquired the next slot can be in flight');
 assert.equal(m.inputs.some(r=>r.data.repair),false);
});

test('r3 uses native tools and native tool-error replies without provider JSON mode',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(_url,request)=>{bodies.push(JSON.parse(request.body));return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'native-call-1',type:'function',function:{name:'submit_review',arguments:'{"valid":false,"assetMatched":false,"variantMatched":false,"reason":"此题不满足要求"}'}}]}}]})};});
 const host=deepTutorBenchHost({baseUrl:'https://example.test/v1',apiKey:'fixture-only',model:'fixture'}),prepared=await host.prepareCall({});
 for await(const _ of prepared.stream({messages:[{role:'user',content:[{type:'text',text:'baseline unchanged'}]}]})){}
 const call=createToolTransport(host),request=toolRequest('submit_review',{constant:'调用工具复核',variable:'{}'}),raw=await call(request);
 await call({...request,toolFeedback:failedTool(raw,Error('缺少完整复核理由'))});
 assert.equal(bodies[0].tools,undefined);assert.equal(bodies[0].tool_choice,undefined);
 assert.equal(bodies[1].tools[0].function.name,'submit_review');assert.equal(bodies[1].tool_choice.function.name,'submit_review');
 assert.equal(bodies[2].messages.at(-2).tool_calls[0].id,'native-call-1');assert.equal(bodies[2].messages.at(-1).role,'tool');assert.equal(bodies[2].messages.at(-1).tool_call_id,'native-call-1');assert.match(bodies[2].messages.at(-1).content,/缺少完整复核理由/);
 assert.ok(bodies.every(body=>body.response_format===undefined));assert.equal(toolArguments(raw,'submit_review').valid,false);
 assert.throws(()=>toolArguments({text:'{"valid":true}'},'submit_review'),/不接受正文/);
});

test('r3 refuses text-only submissions and invalid tool parameters without publishing an asset',async()=>{
 const m=fake(),plain=await m.call(nodeToolRequest({stage:'r3-leaf-ideas',variable:JSON.stringify({subtree:{title:'a',lecture:[{part:0,text:'这是完整的模拟来源正文。'}],children:[]}})}));
 const value=nodeArguments(plain);value.ideas[0].nodeId='model-invented-id';assert.throws(()=>nodeArguments(submitted('node',value)),/不是已注册工具的参数/);
 let saved;await assert.rejects(compileIdeas({graph:graph(),call:async()=>({text:JSON.stringify(value)}),onCheckpoint:c=>{saved=c;}}),/不接受正文/);
 assert.equal(Object.keys(saved.nodes).length,0);
});

test('r3 a rejected question is repaired through its original tool invocation',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1});let firstCallId,seenFeedback=false;
 const result=await createQuestionGenerator({library,scheduler:s,call:async request=>{
  const raw=await m.call(request);if(request.stage==='r3-instantiate'){
   if(!firstCallId){firstCallId=raw.toolCalls[0].id;const v=toolArguments(raw,'submit_question');v.items[0].choices=v.items[0].choices.slice(0,3);raw.toolCalls[0].arguments=JSON.stringify(v);}
   else{seenFeedback=true;assert.equal(request.toolFeedback.toolCalls[0].id,firstCallId);assert.match(request.toolFeedback.error,/四个不同选项/);}
  }return raw;
 }})(p.id);
 assert.equal(seenFeedback,true);assert.equal(result.produced,1);assert.equal(result.plan.tickets[0].attempts,2);
});

test('r3 node-owned forms do not inherit a legacy strategy/type pairing restriction',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:async request=>{
  const raw=await m.call(request);if(request.stage==='r3-leaf-ideas'){
   const d=nodeArguments(raw);d.ideas[0].strategy='apply';d.ideas[0].types=['trueFalse'];return submitted('node',d);
  }return raw;
 }}),s=createScheduler({library}),p=await s.reserve({count:1,types:['trueFalse'],strategies:['apply'],scope:'local'});
 assert.equal(p.tickets[0].type,'trueFalse');
});

test('r3 retains successful tool submissions across turns until finish_node confirms completion',async()=>{
 const m=fake();let first=true,continued=false;
 const library=await compileIdeas({graph:graph(),call:async request=>{
  const d=JSON.parse(request.variable),raw=await m.call(request);
  if(d.subtree.title==='a'){
   if(first){first=false;return {...raw,toolCalls:raw.toolCalls.filter(c=>c.name==='submit_idea')};}
   continued=true;assert.deepEqual(d.acceptedKeys,['idea']);assert.equal(request.toolFeedback.results[0].ok,true);
   return {...raw,toolCalls:raw.toolCalls.filter(c=>c.name==='finish_node')};
  }return raw;
 }});
 assert.equal(continued,true);assert.equal(library.root.children[0].children[0].ideas.length,1);assert.equal(library.stats.modelCalls,6);
});

test('r3 resumes a partially submitted node from accepted tools and their original call IDs',async()=>{
 const m=fake(),abort=new AbortController();let cache,acceptedId;
 await assert.rejects(compileIdeas({graph:graph(),signal:abort.signal,call:async request=>{
  const raw=await m.call(request);if(JSON.parse(request.variable).subtree.title==='a'){const calls=raw.toolCalls.filter(c=>c.name==='submit_idea');acceptedId=calls[0].id;return {...raw,toolCalls:calls};}return raw;
 },onCheckpoint:c=>{cache=c;if(c.drafts?.a?.ideas.idea)abort.abort();}}),{name:'AbortError'});
 assert.equal(cache.drafts.a.history[0].toolCalls[0].id,acceptedId);let resumed=false;
 const library=await compileIdeas({graph:graph(),cache,call:async request=>{
  const raw=await m.call(request);if(JSON.parse(request.variable).subtree.title==='a'){
   resumed=true;assert.equal(request.toolFeedback.toolCalls[0].id,acceptedId);assert.equal(request.toolFeedback.results[0].ok,true);
   return {...raw,toolCalls:raw.toolCalls.filter(c=>c.name==='finish_node')};
  }return raw;
 }});
 assert.equal(resumed,true);assert.equal(library.root.children[0].children[0].ideas.length,1);
});

test('r3 manual review archives a flawed result and repairs the original reserved task',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1,scope:'cross'}),generate=createQuestionGenerator({library,scheduler:s,call:m.call});
 const before=await generate(p.id),old=before.questions[0];
 await s.requestRepair(p.id,old.id,'某一分支仅为可选加分，不参与必答得分点');
 const owner=atPath(s.resultTree,old.nodePath);assert.equal(owner.questions.length,0);assert.equal(owner.archivedQuestions[0].id,old.id);
 const result=await generate(p.id);assert.equal(result.produced,1);assert.equal(result.questions[0].id,old.id);assert.equal(result.questions[0].slotId,old.slotId);assert.equal(result.plan.tickets[0].attempts,2);
});

test('r3 validates required branches against actual questions and rejects leaked targets',()=>{
 const idea={relation:{needs:[{child:0},{child:1}]}},row={stem:'请先推导第一个条件，再结合另一个关系判断最终结果。'};
 const checks=[0,1].map(child=>({child,promptQuote:row.stem,necessary:true,givenAway:false,reason:'依赖本分支的未知结论'}));
 validateBranchReview({branchChecks:checks},row,idea);
 assert.throws(()=>validateBranchReview({branchChecks:[checks[0],{...checks[1],givenAway:true}]},row,idea),/未泄漏/);
 assert.throws(()=>validateBranchReview({branchChecks:[checks[0],{...checks[1],promptQuote:'不存在的另一道题干中的原句。'}]},row,idea),/实际题干/);
 assert.throws(()=>validateBranchReview({branchChecks:[checks[0]]},row,idea),/逐分支/);
});

test('r3 parent contracts cannot borrow evidence from a different child branch',async()=>{
 const m=fake();await assert.rejects(compileIdeas({graph:graph(),call:async request=>{
  const raw=await m.call(request);if(request.stage==='r3-parent-ideas'){
   const d=nodeArguments(raw);d.ideas[0].relation.needs[0].basisIndexes=[1];return submitted('node',d);
  }return raw;
 }}),/relation.needs/);
});

test('r3 reserves all point quotas atomically and never starts a partial batch allocation',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library});
 await assert.rejects(s.reserve({count:5,quotas:{a:1,b:4}}),/槽位不足/);assert.equal(Object.keys(s.snapshot.allocated).length,0);
 const p=await s.reserve({count:4,quotas:{a:2,b:2}});assert.equal(p.tickets.filter(t=>t.nodeId==='a').length,2);assert.equal(p.tickets.filter(t=>t.nodeId==='b').length,2);
});

test('r3 critical audit cannot accept unsupported explanation claims or independent cross-point subquestions',()=>{
 const row={stem:'请用两个条件共同判断处理路径是否成立。',explanation:'没有依据的逆命题因此也成立。'},idea={relation:{needs:[{child:0},{child:1}]}};
 const audit={explanationValid:true,unsupportedClaims:[],reason:'共同使用两个分支',joint:true,neededChildren:[0,1],jointPromptQuote:row.stem,leakedTarget:false};
 validateCriticalAudit(audit,row,idea);
 assert.throws(()=>validateCriticalAudit({...audit,joint:false},row,idea),/共同推理/);
 assert.throws(()=>validateCriticalAudit({...audit,explanationValid:false,unsupportedClaims:[{quote:'没有依据的逆命题',reason:'无法从材料推出'}]},row,idea),/解析独立检查/);
 assert.throws(()=>validateCriticalAudit({...audit,unsupportedClaims:[{quote:'实际解析不存在的内容',reason:'模型臆造问题'}]},row,idea),/实际解析原句/);
});

test('r3 independent auditor does not see the supplied answer or blueprint and can trigger original-task repair',async()=>{
 const m=fake(),library=await compileIdeas({graph:graph(),call:m.call}),s=createScheduler({library}),p=await s.reserve({count:1});let audits=0;
 const result=await createQuestionGenerator({library,scheduler:s,call:async request=>{
  const raw=await m.call(request);if(request.stage==='r3-critical-audit'){
   const d=JSON.parse(request.variable);assert.equal(Object.hasOwn(d,'idea'),false);assert.equal(Object.hasOwn(d.item,'answer'),false);
   if(audits++===0)return submitted('submit_audit',{explanationValid:false,unsupportedClaims:[{quote:d.item.explanation,reason:'此推断需要缺失的前提'}],reason:'解析未充分论证'});
  }return raw;
 }})(p.id);
 assert.equal(result.produced,1);assert.equal(result.questions[0].id,p.tickets[0].id);assert.equal(result.plan.tickets[0].attempts,2);
});

test('r3 source addresses recover exact formulas without model retyping or minimum quote length',()=>{
 const text='W=0\n\nU = σd/ε；\\vec{E} 与 D 同向。',owner={nodeId:'n',text,pages:[{page:2,text:'Q = C U。',visual:'图中含有两个相对放置的极板。'}],children:[]};
 assert.deepEqual(sourceParts(text).map(p=>p.part),[0,2]);
 assert.equal(bindBasis(owner,[{path:[],source:'lecture',part:0}])[0].quote,'W=0');
 assert.equal(bindBasis(owner,[{path:[],source:'lecture',part:2}])[0].quote,text.split('\n')[2]);
 assert.equal(bindBasis(owner,[{path:[],source:'page',page:2,field:'visual',part:0}])[0].quote,owner.pages[0].visual);
 assert.throws(()=>bindBasis(owner,[{path:[],source:'lecture',part:1}]),/没有 part=1/);
});

test('r3 tool schema uses source addresses and refuses a model-supplied literal quote',async()=>{
 const m=fake(),request=nodeToolRequest({stage:'r3-leaf-ideas',variable:JSON.stringify({subtree:{title:'a',lecture:[{part:0,text:'一段完整的模拟讲义正文。'}],children:[]}})}),raw=await m.call(request),data=nodeArguments(raw);
 data.ideas[0].basis[0].quote='不应由模型重写的原句';assert.throws(()=>nodeArguments(submitted('node',data)),/不是已注册工具的参数/);
});
