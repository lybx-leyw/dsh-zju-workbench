import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../packages/dsh-zhiyun-core-lecture/src/index.js';
import { ParserCache } from '../packages/dsh-zhiyun-core-parser/src/cache.js';
const input=()=>({sectionId:'s',lecture:{title:'课',chapters:[{title:'章',topics:[1,2].map(i=>({title:'知识点'+i,sourceBlockIndexes:[i],blocks:[{kind:{wire:'explanation',label:'讲解'},text:`正文${i}。`,sourceBlockIndexes:[i]}]}))}]},
  record:{blocks:[1,2].map(i=>({index:i,page:i*10,tag:{role:'主线'},slideEvidence:[{page:i*10,text:`题设${i}`}]})),outline:[]}});
test('知识点终审隔离其他题设；一段格式失败只重试该段，已成功邻段命中缓存',async()=>{
  const ctx={provide(n,v){this[n]=v;}},cache=new ParserCache();let first=0,second=0,fail=true;
  const dispose=await apply(ctx,{cache,llm:{async call(request){
    const local=request.variable;
    if(local.includes('ref=c1t1b1')){
      first++;assert.ok(!local.includes('ref=c1t2b1'));assert.ok(!local.includes('题设2'));
      return {text:JSON.stringify({edits:[{ref:'c1t1b1',before:'正文1',after:'修改1'}]})};
    }
    second++;assert.ok(!local.includes('题设1'));
    return {text:fail?'坏JSON':JSON.stringify({edits:[],warnings:['本段待核实']})};
  }}});
  try{
    const partial=await ctx.zhiyunLecture.polish(input());
    assert.equal(partial.complete,false);assert.equal(partial.failures[0].code,'FORMAT');
    assert.equal(partial.lecture.chapters[0].topics[0].blocks[0].text,'修改1。');
    assert.equal(partial.lecture.chapters[0].topics[1].blocks[0].text,'正文2。');
    assert.equal(first,1);assert.equal(second,2);fail=false;
    const out=await ctx.zhiyunLecture.polish(input());
    assert.equal(out.complete,true);
    assert.equal(first,1);assert.equal(second,3);assert.deepEqual(out.warnings,['本段待核实']);
    assert.equal(out.lecture.chapters[0].topics[0].blocks[0].text,'修改1。');
    assert.equal(out.coverage.unitsCovered,2);
  }finally{dispose();}
});
test('模型即使知道另一知识点的ref也不能跨边界改写',async()=>{
  const ctx={provide(n,v){this[n]=v;}};let calls=0;
  const dispose=await apply(ctx,{llm:{async call(request){calls++;return {text:JSON.stringify({edits:request.variable.includes('ref=c1t1b1')?[{ref:'c1t2b1',before:'正文2',after:'污染'}]:[]})};}}});
  try{const out=await ctx.zhiyunLecture.polish(input());assert.equal(out.complete,false);assert.equal(out.failures[0].code,'FORMAT');
    assert.deepEqual(out.lecture.chapters[0].topics.map(t=>t.blocks[0].text),['正文1。','正文2。']);assert.equal(calls,3);}finally{dispose();}
});
