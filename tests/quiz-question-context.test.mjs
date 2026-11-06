import test from 'node:test';
import assert from 'node:assert/strict';
import {labCall} from '../packages/dsh-zhiyun-core-quiz/src/engines/r1/policy.mjs';

const missingContext={stem:'甲参加集会的概率是多少？',choices:[{label:'A',text:'0.3'},{label:'B',text:'0.4'},{label:'C',text:'0.5'},{label:'D',text:'0.05'}],answer:'B',explanation:'由题设 P(A)=P(B)=P(C)=0.4，甲参加的概率为0.4。'};
const request={stage:'quiz-point-review',variable:JSON.stringify({type:'mcq',strategy:'recall',source:'例题：P(A)=P(B)=P(C)=0.4。',items:[missingContext]})};
const review=async verdict=>JSON.parse((await labCall(async()=>({text:JSON.stringify({verdicts:[{index:0,valid:true,targetMatched:true,optionTruth:{A:false,B:true,C:false,D:false},...verdict}]})}))(request)).text).verdicts[0];

test('hidden example premises cannot pass merely because the source and answer agree',async()=>{
 const result=await review({selfContained:false,learningValue:false,reason:'题干未给事件概率，解析才引用原题数值'});
 assert.equal(result.valid,false);
 assert.match(result.reason,/题干未给事件概率/);
});
test('copying an example number is rejected even when its premise is supplied',async()=>{
 assert.equal((await review({selfContained:true,learningValue:false})).valid,false);
});
test('missing explicit context or learning-value verdicts fail closed',async()=>{
 for(const verdict of [{},{selfContained:true},{learningValue:true}])assert.equal((await review(verdict)).valid,false);
});
test('a self-contained meaningful task can retain its valid verdict',async()=>{
 assert.equal((await review({selfContained:true,learningValue:true})).valid,true);
});
test('author and reviewer explicitly distinguish unseen example premises from reusable knowledge',async()=>{
 const requests=[],call=labCall(async r=>{requests.push(r);return {text:JSON.stringify({verdicts:[]})};});
 await call({...request,stage:'quiz-point-mcq',constant:'生成题目'});
 await call(request);
 assert.match(requests[0].constant,/不让学生背诵某道例题临时给定的数值/);
 assert.match(requests[1].constant,/学生看不到 source/);
 assert.match(requests[1].constant,/通用的已学定义与公式不必/);
});
