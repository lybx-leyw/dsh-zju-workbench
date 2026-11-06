import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {labCall,blindQuestion} from '../scripts/quiz_bench/experimental-r2/policy.mjs';
import {rectifyQuestions} from '../scripts/quiz_bench/experimental-r2/rectification.mjs';
const item={stem:'按材料判断哪一项成立？',choices:'ABCD'.split('').map((label,i)=>({label,text:`描述${i}`})),answer:'B',explanation:'生成器的解释秘密',angle:'可能泄漏答案的角度'};
const request={stage:'quiz-point-review',variable:JSON.stringify({type:'mcq',strategy:'understand',source:'用于推断的合成来源材料。',items:[item]})};
const solution=(input,ambiguous=false)=>{
 const answer=input.items[0].choices.find(c=>c.text==='描述1').label;
 return {text:JSON.stringify({solutions:[{index:0,status:ambiguous?'ambiguous':'unique',answer,options:input.items[0].choices.map(c=>({label:c.label,verdict:c.label===answer?'true':'false',reason:'结合输入条件独立检查'})),solution:'独立求得的结论',assessment:{claim:'规范命题',operation:'辨析事实',conditions:[],parameters:[]}}]})};
};
test('candidate r1 is byte-for-byte frozen',async()=>{
 const m=JSON.parse(await readFile('scripts/quiz_bench/experimental/CANDIDATE.json','utf8'));
 assert.equal(m.id,'v2-candidate-r1');for(const [name,hash]of Object.entries(m.files))assert.equal(createHash('sha256').update(await readFile('scripts/quiz_bench/experimental/'+name)).digest('hex'),hash,name);
});
test('blind review excludes answer, explanation and generated metadata and maps permuted labels back',async()=>{
 const stages=[];const call=labCall(async r=>{stages.push(r.stage);const d=JSON.parse(r.variable);
  if(r.stage==='lab-blind-solve'){assert.deepEqual(Object.keys(d.items[0]).sort(),['choices','index','stem']);assert.ok(!r.variable.includes(item.explanation));assert.ok(!r.variable.includes(item.angle));return solution(d);}
  return {text:JSON.stringify({verdicts:[{index:0,valid:true,targetMatched:true,optionTruth:{A:false,B:true,C:false,D:false}}]})};
 });
 const result=JSON.parse((await call(request)).text);assert.equal(result.verdicts[0].valid,true);assert.equal(result.verdicts[0].assessment.claim,'规范命题');assert.deepEqual(stages,['lab-blind-solve','quiz-point-review']);
 const q=blindQuestion(item);assert.notEqual(q.question.choices.find(c=>c.text==='描述1').label,'B');
 const linked=blindQuestion({...item,choices:item.choices.map(c=>({...c,text:c.label==='A'?'选项B所述结论':c.text}))});assert.equal(linked.map.B,'B');
});
test('ambiguous blind solution does not receive a paid justification review',async()=>{
 const stages=[],call=labCall(async r=>{stages.push(r.stage);return solution(JSON.parse(r.variable),true);});
 const r=JSON.parse((await call(request)).text);assert.equal(r.verdicts[0].valid,false);assert.deepEqual(stages,['lab-blind-solve']);
});
test('intermediate blind result is checkpointable and reused after interruption',async()=>{
 const cache={},stages=[];let paused=false;
 const model=async r=>{stages.push(r.stage);if(r.stage==='lab-blind-solve')return solution(JSON.parse(r.variable));return {text:'{"verdicts":[{"index":0,"valid":true,"optionTruth":{"A":false,"B":true,"C":false,"D":false}}]}'};};
 await assert.rejects(labCall(model,{cache,persist:async()=>{if(!paused){paused=true;throw new Error('pause after checkpoint');}}})(request));
 const restored=structuredClone(cache);await labCall(model,{cache:restored})(request);assert.equal(stages.filter(s=>s==='lab-blind-solve').length,1);
});
test('malformed options are rejected before model use',async()=>{
 let calls=0;const r=await labCall(async()=>{calls++;throw Error('must not call');})({...request,variable:JSON.stringify({type:'mcq',items:[{...item,choices:[...item.choices,item.choices[0]]}]})});
 assert.equal(calls,0);assert.equal(JSON.parse(r.text).verdicts[0].valid,false);
});
test('dedupe requires a covered decision for every new ticket and preserves a representative',async()=>{
 const questions=[{id:'a',pointId:'p',stem:'定义是什么？'},{id:'b',pointId:'p',stem:'哪项不符合该定义？'}],saved={questions:Object.fromEntries(questions.map(q=>[q.id,q]))};
 await rectifyQuestions({saved,questions,existingQuestions:[],stagedIds:['a','b'],commit:fn=>fn(),emit:async()=>{},parallel:(items,fn)=>Promise.all(items.map(fn)),signal:new AbortController().signal,problems:[],onRectify:async()=>{},requestModel:async()=>({text:JSON.stringify({decisions:[{questionId:'a',relation:'distinct',reason:'本批唯一代表题没有较早重复对象'},{questionId:'b',relation:'duplicate',matchId:'a',reason:'正反方向不同但要求辨认同一个定义'}]})})});
 assert.equal(saved.rectify.decisions.b.matchId,'a');assert.equal(questions[0].reviewState,'ready');assert.equal(questions[1].status,'rejected');
});
