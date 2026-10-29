import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveredQuestions,normalizeQuestion} from '../scripts/quiz_bench/experimental-r4/compare.mjs';
import {validateAttributeReview,visiblePrompt,validateItemModel,evaluate,validateIndependentNumeric} from '../scripts/quiz_bench/experimental-r4/item-model.mjs';
import {toolRequest,createToolTransport,toolArguments} from '../scripts/quiz_bench/experimental-r4/tools.mjs';
import {validateQuestion} from '../scripts/quiz_bench/experimental-r4/generator.mjs';
import {attemptOffset,tokenLedger} from '../scripts/quiz_bench/accounting.mjs';
import {runR4} from '../scripts/quiz_bench/experimental-r4/run.mjs';
import {graph,model} from '../scripts/quiz_bench/experimental-r4/fixture.mjs';

test('comparison counts delivered r4 cells and active admitted r1 items, never archived drafts',()=>{
 const q={id:'kept',reviewState:'ready'},old={id:'old',reviewState:'ready'},rejected={id:'bad',reviewState:'rejected'};
 assert.deepEqual(deliveredQuestions({results:[{questions:[q]},{questions:[]}]}),[q]);
 assert.deepEqual(deliveredQuestions({questions:[q,old,rejected],checkpoint:{tasks:[{questionIds:['kept','bad']}],questions:{kept:q,old,bad:rejected}}}),[q]);
});
test('comparison preserves genuine native options dictionaries without manufacturing choices',()=>{
 const q=normalizeQuestion({type:'mcq',stem:'test',options:{A:'one',B:'two',C:'three',D:'four'},answer:'C'});
 assert.deepEqual(q.choices,[{label:'A',text:'one'},{label:'B',text:'two'},{label:'C',text:'three'},{label:'D',text:'four'}]);assert.equal(q.answer,'C');
});
test('skill and observable evidence may quote visible options, but never hidden explanation',()=>{
 const row={stem:'以下哪个说法成立？',choices:[{label:'A',text:'互斥且概率为正的两个事件不独立'}],explanation:'隐藏条件不能用于补全题设'};
 const model={attributes:[{id:'a'}],evidenceRules:['识别互斥与独立'],errorModels:[]};
 const verdict={selfContained:true,learningValue:true,parametersMatched:true,operationMatched:true,attributeChecks:[{id:'a',required:true,promptQuote:row.choices[0].text,reason:'选项承载必答判断'}],evidenceChecks:[{ruleIndex:0,observable:true,promptQuote:row.choices[0].text,reason:'观察选择'}]};
 assert.equal(validateAttributeReview(verdict,row,model,'shortAnswer').actualAttributes[0],'a');
 assert.ok(!visiblePrompt(row).includes(row.explanation));
 const hidden=structuredClone(verdict);hidden.attributeChecks[0].promptQuote=row.explanation;assert.throws(()=>validateAttributeReview(hidden,row,model,'shortAnswer'),/学生可见题面/);
 const unused=structuredClone(verdict);unused.attributeChecks[0].required=false;assert.throws(()=>validateAttributeReview(unused,row,model,'shortAnswer'),/未必需/);
});
test('author tool binds reserved parameters and error identities without leaking them to the blind solver',()=>{
 const binding={idea:{itemModel:{baseParameters:{x:1},errorModels:[{id:'E1'},{id:'E2'},{id:'E3'}]}},variant:{parameters:{x:7}},type:'mcq'};
 const schema=toolRequest('submit_question',{},binding).tools[0].parameters.properties.items.items;
 assert.deepEqual(schema.properties.parameters.properties.x.enum,[7]);assert.deepEqual(schema.properties.distractors.items.properties.errorId.enum,['E1','E2','E3']);
 const blind=JSON.stringify(toolRequest('submit_solution',{},binding));assert.ok(!blind.includes('E1'));assert.ok(!blind.includes('"x"'));
});
test('generic terminal failures cannot masquerade as an empty tool result',async()=>{
 const host={prepareCall:async()=>({async *stream(){yield {type:'finish',reason:{kind:'error',failure:{code:'SERVER',message:'fixture provider failure'}}};}})};
 await assert.rejects(createToolTransport(host)({constant:'c',variable:'v',tools:[]}),{code:'SERVER'});
});
test('a truncated generic stream is rejected even if it contains tool arguments',async()=>{
 const host={prepareCall:async()=>({async *stream(){yield {type:'tool-call-delta',index:0,id:'call-1',name:'submit_solution',argumentsDelta:'{}'};}})};
 await assert.rejects(createToolTransport(host)({constant:'c',variable:'v',tools:[]}),{code:'INCOMPLETE'});
});
test('resumed native accounting keeps failed-attempt indices distinct from receipt count',()=>{
 const receipts=[{index:1,response:{usage:{prompt_tokens:2,completion_tokens:3}}}],events=[{index:1,status:'started'},{index:1,status:'completed'},{index:2,status:'started'},{index:2,status:'failed'}];
 assert.equal(attemptOffset(receipts,events),2);assert.equal(attemptOffset([],[]),0);
 const ledger=tokenLedger(receipts,{attempts:2});assert.equal(ledger.totalTokens,null);assert.equal(ledger.totalTokensKnown,5);assert.equal(ledger.unknownUsageAttempts,1);
});
test('complete generic native-tool streams preserve arguments and usage',async()=>{
 const host={prepareCall:async()=>({async *stream(){yield {type:'tool-call-delta',index:0,id:'call-ok',name:'submit_solution',argumentsDelta:'{"valid":true}'};yield {type:'usage',usage:{input:10,output:2}};yield {type:'finish',reason:{kind:'tool-calls'}};}})};
 const response=await createToolTransport(host)({constant:'c',variable:'v',tools:[]});assert.equal(response.toolCalls[0].id,'call-ok');assert.equal(JSON.parse(response.toolCalls[0].arguments).valid,true);assert.equal(response.usage.input,10);
});
test('all invalid variants are reported together so one repair can fix the whole submission',async()=>{
 const m=model();let sent=false,feedback;
 const call=async request=>{if(request.toolFeedback)feedback=request.toolFeedback;const raw=await m.call(request);if(request.stage.endsWith('-ideas')&&!sent){sent=true;for(const t of raw.toolCalls)if(t.name==='submit_idea'){const v=JSON.parse(t.arguments);v.variants=['bad-one','bad-two'].map(key=>({key,instruction:'保留基础实例但用不同编号再提交'+key,parameters:{}}));t.arguments=JSON.stringify(v);}}return raw;};
 const r=await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'all-variant-errors',call});assert.equal(r.produced,1);assert.equal(m.calls.filter(c=>c.stage.endsWith('-ideas')).length,2);const error=feedback.results.find(r=>!r.ok).error;assert.match(error,/bad-one/);assert.match(error,/bad-two/);
});
test('self-contained and learning-value confirmations must be explicit booleans',async()=>{
 for(const [key,value]of [['selfContained',undefined],['selfContained','true'],['learningValue',false]]){
  const m=model(),call=async request=>{const raw=await m.call(request);if(request.stage==='r3-validate-instance'){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v[key]=value;t.arguments=JSON.stringify(v);}return raw;};
  const r=await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'explicit-quality',call});assert.equal(r.produced,0);
 }
});
test('global call budget survives concurrent work across two demand cells',async()=>{
 const m=model(),r=await runR4({graph:graph(),pointIds:['a','b'],count:2,requestId:'concurrent-budget',call:m.call,concurrency:2,maxCalls:3});assert.equal(m.calls.length,3);assert.equal(r.usage.modelCalls,3);assert.equal(r.state,'partial');assert.equal(Object.keys(r.checkpoint.explorations).length,2);
});
test('Chinese variable identifiers work in typed parameter domains and data-only arithmetic',async()=>{
 const m=model(),raw=await m.call({stage:'r3-leaf-ideas',variable:JSON.stringify({subtree:{title:'example',children:[]},selection:{pointIds:['a'],types:['mcq'],strategies:['understand']},acceptedKeys:[]})}),idea=JSON.parse(raw.toolCalls[0].arguments);
 const replace=x=>typeof x==='string'?(x==='x'?'甲':x==='y'?'乙':x):Array.isArray(x)?x.map(replace):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,replace(v)])):x;
 idea.itemModel=replace(idea.itemModel);idea.itemModel.baseParameters={甲:6,乙:2};
 const checked=await validateItemModel(idea.itemModel,{idea,pointIds:['a'],basisCount:1,basisPointIds:[['a']]});assert.equal(evaluate(checked.numeric.answer,checked.baseParameters),8);
});
test('literal fractions and percentages are checked without evaluating arbitrary expressions',()=>{
 const model={numeric:{answer:{op:'divide',args:[1,2]}}};
 for(const answer of ['0.5','1/2','50%','$\\frac{1}{2}$','\\(\\frac{1}{2}\\)'])assert.doesNotThrow(()=>validateIndependentNumeric({answer},model,{},'shortAnswer'));
 for(const answer of ['1/0','process.exit()','1e999','0.5 A'])assert.throws(()=>validateIndependentNumeric({answer},model,{},'shortAnswer'));
});
test('blind true/false and MCQ output formats are explicit and do not expose a key',()=>{
 assert.deepEqual(toolRequest('submit_solution',{}, {type:'trueFalse'}).tools[0].parameters.properties.answer.enum,['正确','错误','无法确定']);
 assert.deepEqual(toolRequest('submit_solution',{}, {type:'mcq'}).tools[0].parameters.properties.answer.enum,['A','B','C','D','无法确定']);
 assert.throws(()=>toolArguments({toolCalls:[{id:17,name:'submit_solution',arguments:{valid:true,selfContained:true,answer:'A',explanation:'ok',reason:'ok'}}]},'submit_solution'),/字符串call ID/);
});
test('MCQ options duplicated into the stem are rejected before independent solving',()=>{
 const choices='ABCD'.split('').map(label=>({label,text:'完整候选陈述和理由'+label}));
 const row={stem:'选择正确项\n'+choices.map(c=>c.label+'. '+c.text).join('\n'),choices,answer:'A',explanation:'fixture explanation'};
 assert.throws(()=>validateQuestion(row,'mcq',{basis:[]}),/重复列出了选项/);
});
