import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveredQuestions,normalizeQuestion} from '../scripts/quiz_bench/experimental-r4/compare.mjs';
import {validateAttributeReview,visiblePrompt,validateItemModel,evaluate,validateIndependentNumeric,normalizeDefects,defectInstruction,assertNoInternalCodes} from '../scripts/quiz_bench/experimental-r4/item-model.mjs';
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
 const model={attributes:[{id:'a'}],preconditions:['两个事件互斥'],evidenceRules:['识别互斥与独立'],errorModels:[]};
 const verdict={selfContained:true,learningValue:true,parametersMatched:true,operationMatched:true,preconditionChecks:[{index:0,satisfied:true,promptQuote:'互斥',reason:'选项给出互斥条件'}],attributeChecks:[{id:'a',required:true,promptQuote:row.choices[0].text,reason:'选项承载必答判断'}],evidenceChecks:[{ruleIndex:0,observable:true,promptQuote:row.choices[0].text,reason:'观察选择'}]};
 assert.equal(validateAttributeReview(verdict,row,model,'shortAnswer').actualAttributes[0],'a');
 assert.ok(!visiblePrompt(row).includes(row.explanation));
 const hidden=structuredClone(verdict);hidden.attributeChecks[0].promptQuote=row.explanation;assert.throws(()=>validateAttributeReview(hidden,row,model,'shortAnswer'),/学生可见题面/);
 const unused=structuredClone(verdict);unused.attributeChecks[0].required=false;assert.throws(()=>validateAttributeReview(unused,row,model,'shortAnswer'),/未必需/);
 // 前提必须有学生会看到的逐字依据；声明出来却找不到原句 = 题设不全。
 const missingPremise=structuredClone(verdict);missingPremise.preconditionChecks[0].promptQuote='题干里根本没有这句';assert.throws(()=>validateAttributeReview(missingPremise,row,model,'shortAnswer'),/逐字依据/);
 const unmet=structuredClone(verdict);unmet.preconditionChecks[0].satisfied=false;assert.throws(()=>validateAttributeReview(unmet,row,model,'shortAnswer'),/未满足题模前提/);
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

test('审核缺陷被压成「改哪个位置」，且过滤幻觉出来的选项',()=>{
 const row={stem:'题干',choices:['A','B','C','D'].map(l=>({label:l,text:'选项'+l}))};
 const verdict={defects:[
  {target:'D',kind:'ambiguous',detail:'按字面等价于 Ω 本身'},
  {target:'E',kind:'wrong',detail:'本题没有 E 项'},
  {target:'D',kind:'wrong',detail:'重复的 D'},
  {target:'stem',kind:'other',detail:'题干过长'},
  {target:'B',kind:'invented-kind',detail:'未知类型应归一为 other'},
 ]};
 const defects=normalizeDefects(verdict,row);
 assert.deepEqual(defects.map(d=>d.target),['D','stem','B']);
 assert.equal(defects.find(d=>d.target==='B').kind,'other');
 // 返工提示必须点名到具体的选项标签，而不是一段泛泛的说明。
 const instruction=defectInstruction(verdict,row);
 assert.match(instruction,/【D】/);
 assert.ok(!instruction.includes('【E】'));
 assert.ok(instruction.includes('等价于 Ω 本身'));
});

test('返工稿与历史稿完全相同时被拒，不白烧一轮',async()=>{
 // fixture 默认每次返回同一份题；新加的闸门应当在那之后拦下重复稿。
 // 这里让审核第一轮就判 false，逼出返工路径。
 const m=model();let rounds=0,seenMustFix=null;
 const call=async request=>{
  const raw=await m.call(request);
  if(request.stage==='r3-instantiate'){
   try{const input=JSON.parse(request.variable);if(input.mustFix)seenMustFix=input.mustFix;}catch{}
  }
  if(request.stage==='r3-validate-instance'){
   rounds++;
   if(rounds===1){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v.valid=false;v.reason='D 项含糊';v.defects=[{target:'D',kind:'ambiguous',detail:'等价于 Ω 本身'}];t.arguments=JSON.stringify(v);}
  }
  return raw;
 };
 // 让作者每次交完全相同的稿：把 attempt 标记抹掉，模拟「模型其实没改」。
 const frozen=async request=>{
  const raw=await call(request);
  if(request.stage==='r3-instantiate')for(const t of raw.toolCalls){
   const v=JSON.parse(t.arguments);
   for(const item of v.items??[])item.stem=String(item.stem).replace(/（第\d+次修订）$/,'');
   t.arguments=JSON.stringify(v);
  }
  return raw;
 };
 const r=await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'dup-draft',call:frozen});
 assert.equal(r.produced,0);
 // 报错必须点名「退回了第几稿」，而不是含糊地说「与之前某一稿相同」——
 // 实测含糊版本让模型连着两轮瞎改，三次尝试全废。
 assert.match(r.results[0].pending[0].reason,/与第 \d+ 稿完全相同/);
 // 返工提示里确实带上了结构化指令（点名到 D 项）。
 assert.ok(seenMustFix&&seenMustFix.includes('D'),'返工请求必须带 mustFix');
});

test('每一条返工都必须带非空 mustFix，不能把模型丢在没有方向的状态里',async()=>{
 // 实测（dsa 真实跑）：mustFix 为 null 时，模型只拿到一句结论，
 // 只能瞎改或原样交回，最后撞上判重闸整题报废。
 // 这里逐个失败源验证：不论从哪一条闸掉下来，返工请求里都必须有可执行指令。
 const cases=[
  ['干扰项机制',m=>async request=>{const raw=await m.call(request);if(request.stage==='r3-instantiate')for(const t of raw.toolCalls){const v=JSON.parse(t.arguments);for(const it of v.items??[])if(it.distractors?.length)it.distractors[1].errorId=it.distractors[0].errorId;t.arguments=JSON.stringify(v);}return raw;}],
  ['前提缺依据',m=>async request=>{const raw=await m.call(request);if(request.stage==='r3-validate-instance'){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v.preconditionChecks[0].satisfied=false;t.arguments=JSON.stringify(v);}return raw;}],
  ['技能非必需',m=>async request=>{const raw=await m.call(request);if(request.stage==='r3-validate-instance'){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v.attributeChecks[0].required=false;t.arguments=JSON.stringify(v);}return raw;}],
  ['盲解不一致',m=>async request=>{const raw=await m.call(request);if(request.stage==='r4-independent-solve'){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v.answer='999';t.arguments=JSON.stringify(v);}return raw;}],
  ['审核判否且无defects',m=>async request=>{const raw=await m.call(request);if(request.stage==='r3-validate-instance'){const t=raw.toolCalls[0],v=JSON.parse(t.arguments);v.valid=false;v.reason='解析与题干条件冲突';delete v.defects;t.arguments=JSON.stringify(v);}return raw;}],
 ];
 for(const [name,wrap]of cases){
  const m=model();let seenMustFix=null;
  const base=wrap(m);
  const call=async request=>{
   if(request.stage==='r3-instantiate'){try{const input=JSON.parse(request.variable);if(input.attempt>1)seenMustFix=input.mustFix;}catch{}}
   return base(request);
  };
  await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'mustfix-'+name,call});
  assert.ok(seenMustFix&&String(seenMustFix).trim().length>0,name+'：返工请求的 mustFix 不能为空');
  assert.match(String(seenMustFix),/必须/,name+'：mustFix 必须是可执行指令');
 }
});

test('选择题没交 choices 时要点名「缺字段」，而不是只说「恰好四项」',async()=>{
 // 实测（prob run-4）：作者连交三稿 choices 都是空数组、answer 却填了 B，
 // 它把「选项写在题干里」当成了交付。旧指令只说「恰好四项」，
 // 作者猜不到自己漏了整个字段，三次尝试全废。
 const m=model();let seenMustFix=null;
 const call=async request=>{
  const raw=await m.call(request);
  if(request.stage==='r3-instantiate'){
   const input=JSON.parse(request.variable);if(input.attempt>1)seenMustFix=input.mustFix;
   for(const t of raw.toolCalls){const v=JSON.parse(t.arguments);for(const it of v.items??[]){it.choices=[];}t.arguments=JSON.stringify(v);}
  }
  return raw;
 };
 await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'missing-choices',call});
 assert.ok(seenMustFix,'返工必须带 mustFix');
 assert.match(String(seenMustFix),/没有提交任何选项/,'缺字段必须被点名');
 assert.match(String(seenMustFix),/choices/);
 // 顺手给出可照抄的形状，作者不用猜字段结构。
 assert.match(String(seenMustFix),/"label":"A"/);
});
test('审核回执缺字段时重问审核者，而不是把「修正回执」发给作者',async()=>{
 // 实测 run-3 vision：审核漏交 distractorChecks，回执错误却被当作题目缺陷发给作者，
 // 作者改不了审核的回执，原样交回两稿后整题报废。回执错误必须回到审核者。
 const m=model();let reviewRounds=0,authorRepairs=0;
 const call=async request=>{
  const raw=await m.call(request);
  if(request.stage==='r3-validate-instance'){
   reviewRounds++;
   // 第一轮故意漏掉 distractorChecks，模拟结构不合规的回执。
   if(reviewRounds===1)for(const t of raw.toolCalls){const v=JSON.parse(t.arguments);delete v.distractorChecks;t.arguments=JSON.stringify(v);}
  }
  if(request.stage==='r3-instantiate'){
   const input=JSON.parse(request.variable);if(input.mustFix)authorRepairs++;
  }
  return raw;
 };
 const r=await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'receipt-retry',call});
 assert.equal(r.produced,1,'回执补齐后题目应当通过');
 assert.ok(reviewRounds>=2,'审核回执不合规时必须重问审核者');
 assert.equal(authorRepairs,0,'作者不该为审核的回执缺陷返工');
});

test('审核回执不合规时，fail(reviewFault(...)) 不能把指令吞掉',async()=>{
 // 这是一条独立于生成器的纯单元断言：过去 fail() 直接 Error(message)，
 // 传进去的 reviewFault 对象被字符串化，instruct 就蒸发了 ——
 // 于是 reviewFault 明明写了「preconditionChecks 怎么补」，真实跑里 mustFix 却是 null。
 const model={attributes:[{id:'a'}],preconditions:['两个条件同时成立'],evidenceRules:['观察到判断'],errorModels:[],};
 const row={stem:'题干给出两个条件',choices:[],explanation:'解析'};
 const verdict={selfContained:true,learningValue:true,parametersMatched:true,operationMatched:true,
  attributeChecks:[{id:'a',required:true,promptQuote:'题干给出两个条件',reason:'需使用'}],
  evidenceChecks:[{ruleIndex:0,observable:true,promptQuote:'题干给出两个条件',reason:'可观察'}],
  // 故意缺 preconditionChecks：这是 reviewFault 路径。
 };
 let error;
 try{validateAttributeReview(verdict,row,model,'shortAnswer');}catch(e){error=e;}
 assert.ok(error,'缺 preconditionChecks 必须报错');
 assert.ok(error.instruct&&error.instruct.trim().length>0,'reviewFault 的指令不能被吞掉');
 assert.match(error.instruct,/preconditionChecks/);
 assert.ok(!error.message.startsWith('Error: '),'消息不能被 Error 对象字符串化');
});

test('编译后被 strategy 筛掉的考法必须记账，而不是静默失踪',async()=>{
 // 让「模型」故意产出与 selection 不符的策略，模拟不听话的作者。
 const m=model();const order=['recall','understand','apply','explore'];let n=0;
 const call=async request=>{
  const raw=await m.call(request);
  if(request.stage.endsWith('-ideas'))for(const t of raw.toolCalls??[]){
   if(t.name!=='submit_idea')continue;
   const v=JSON.parse(t.arguments);
   v.strategy=order[n++%order.length];
   v.target=v.target+'（不同策略'+n+'）';
   t.arguments=JSON.stringify(v);
  }
  return raw;
 };
 const r=await runR4({graph:graph(),pointIds:['a'],count:2,requestId:'filter-accounting',call,
  strategies:['understand'],types:['mcq'],maxExpansions:0});
 assert.equal(r.produced,0);
 // 报告必须说清「编译了但被筛掉」，而不是只给一句容量不足。
 const filter=r.report.cells[0].filter;
 assert.ok(filter,'失败报告必须带过滤记账');
 assert.ok(filter.compiled>=1);
 assert.equal(filter.kept,0);
 assert.ok(filter.rejected>=1);
 assert.ok(filter.rejectedDetail.some(d=>d.why.includes('strategy')));
});

test('编译提示把 selection 的策略与题型提成硬约束，避免白编',async()=>{
 const m=model();let seen=null;
 const call=async request=>{
  if(request.stage.endsWith('-ideas')){const v=JSON.parse(request.variable);seen={only:v.onlyStrategies,onlyTypes:v.onlyTypes};}
  return m.call(request);
 };
 await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'strategy-hard',call,strategies:['apply'],types:['cloze']});
 assert.deepEqual(seen.only,['apply']);
 assert.deepEqual(seen.onlyTypes,['cloze']);
});

test('解析不得引用内部错误代号，但不得误杀代号形状的普通词',()=>{
 const model={errorModels:[{id:'E1'},{id:'E2'},{id:'E3'}]};
 // 实测原文：括号里直接写「B属E1」，学生无从理解；同一份解析还把 B 判成两种错。
 assert.throws(()=>assertNoInternalCodes('不能改说成关联（B属E1）。故C属E2；D属E3。',model),/内部错误代号/);
 assert.throws(()=>assertNoInternalCodes('选项 E1。',model),/内部错误代号/);
 // 自然语言描述应当放行
 assert.doesNotThrow(()=>assertNoInternalCodes('B 把因果关系说错；C 放错了时间节点。',model));
 // 边界：BE12 / E102 / E1A 都不是代号，不能被误杀
 assert.doesNotThrow(()=>assertNoInternalCodes('BE12 与 E102 都不是代号',model));
 assert.doesNotThrow(()=>assertNoInternalCodes('E1A 只是编号的一部分',model));
});

test('选择题模最多声明 3 类错误机制，避免编号跳号',async()=>{
 // 实测出现过 E1/E2/E4：声明 4 类、实例只用 3 类，于是编号跳号，读报告像漏了一题。
 const m=model();
 const call=async request=>{
  const raw=await m.call(request);
  if(request.stage.endsWith('-ideas'))for(const t of raw.toolCalls??[]){
   if(t.name!=='submit_idea')continue;
   const v=JSON.parse(t.arguments);
   v.itemModel.errorModels.push({id:'E9',misconception:'第四类误解',operation:'再做一次错误运算',attributeIds:v.itemModel.attributes.map(a=>a.id),expression:{op:'add',args:['x','y']}});
   t.arguments=JSON.stringify(v);
  }
  return raw;
 };
 const r=await runR4({graph:graph(),pointIds:['a'],count:1,requestId:'errmodel-cap',call});
 assert.equal(r.produced,0);
 assert.match(JSON.stringify(r.results[0]),/最多声明 3 类错误机制/);
});

test('题模校验一次报全所有问题，不撞到第一个就返回',async()=>{
 // 实测某节点连续 3 轮各只收到一条错误：先「每个预期技能都需要解题证据」，
 // 补上后才轮到「变体必须改变显式参数」。模型每轮只能修一处，白烧三次调用。
 const bad={version:'r4-item-model-v1',
  attributes:[{id:'A1',label:'x',pointIds:['a']},{id:'A2',label:'y',pointIds:['a']}],
  invariants:['i'],preconditions:['p'],evidenceRules:['e'],
  solutionSteps:[{action:'s',attributeId:'A1',basisIndexes:[0]}],
  variables:[],baseParameters:{},
  errorModels:[{id:'1bad',misconception:'m',operation:'o',attributeIds:['A1'],expression:null}],
  adaptation:{operation:'parameter-change',sourceBasisIndexes:[0],preservedKnowledge:'k',changedDemand:'d'},
  difficulty:{status:'hypothesis',rationale:'r'},numeric:null};
 let message='';
 try{await validateItemModel(bad,{idea:{types:['mcq'],relation:null},pointIds:['a'],basisCount:1,basisPointIds:[['a']]});}
 catch(error){message=error.message;}
 // 至少三处独立问题要同时出现，而不是只报第一条。
 assert.match(message,/每个预期技能都需要解题证据/);
 assert.match(message,/错误模型编号须以字母开头/);
 assert.match(message,/至少三类可核对的错误机制/);
 assert.ok(message.split('\n- ').length>=3,'应一次列出多条问题');
});
