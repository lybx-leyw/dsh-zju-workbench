import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../packages/dsh-zhiyun-core-lecture/src/index.js';
import { ParserCache } from '../packages/dsh-zhiyun-core-parser/src/cache.js';
const fixture = () => ({lecture:{title:'课',chapters:[{title:'章',topics:[{title:'点',sourceBlockIndexes:[1],blocks:[{kind:{wire:'explanation',label:'讲解'},text:'来源正文。',sourceBlockIndexes:[1]}]}]}]},
  sectionId:'s',record:{blocks:[{index:1,page:1,tag:{role:'主线'}}],outline:[]}});
test('成功终审持久缓存按模型和输入绑定，重复读取不再调用且重新验证来源',async()=>{
  const cache=new ParserCache(),ctx={provide(name,value){this[name]=value;}};let calls=0;
  const llm={resolve:async()=>({text:{model:'a'}}),async call(){calls++;return {text:'{"edits":[],"warnings":[]}'}}};
  const dispose=await apply(ctx,{llm,cache});
  try{
    const a=await ctx.zhiyunLecture.polish(fixture());assert.equal(a.cached,false);
    assert.equal(a.lecture.chapters[0].topics[0].blocks[0].text,'来源正文。');
    const b=await ctx.zhiyunLecture.polish(fixture());assert.equal(b.cached,true);assert.equal(calls,1);assert.deepEqual(b.calls,[]);
    const changed=fixture();changed.lecture.chapters[0].topics[0].blocks[0].text='新正文。';
    await ctx.zhiyunLecture.polish(changed);assert.equal(calls,2);
    const other={provide(name,value){this[name]=value;}};
    const close=await apply(other,{cache,llm:{...llm,resolve:async()=>({text:{model:'b'}})}});
    try{await other.zhiyunLecture.polish(fixture());assert.equal(calls,3);}finally{close();}
  }finally{dispose();}
  await assert.rejects(ctx.zhiyunLecture.polish(fixture()),{code:'DISPOSED'});
});
test('截断失败不写成功缓存，后续只重试终审',async()=>{
  const cache=new ParserCache(),ctx={provide(n,v){this[n]=v;}};let calls=0;
  const dispose=await apply(ctx,{cache,llm:{async call(){calls++;if(calls===1)throw Object.assign(new Error('截断'),{code:'LLM_TRUNCATED'});return {text:'{"edits":[]}'}}}});
  try{const partial=await ctx.zhiyunLecture.polish(fixture());assert.equal(partial.complete,false);assert.equal(partial.failures[0].code,'LLM_TRUNCATED');assert.equal(cache.memory.size,0);
    await ctx.zhiyunLecture.polish(fixture());await ctx.zhiyunLecture.polish(fixture());assert.equal(calls,2);
  }finally{dispose();}
});
test('harness来源契约失配在终审请求前拒绝，不消耗API',async()=>{
 const ctx={provide(n,v){this[n]=v;}};let calls=0;const dispose=await apply(ctx,{llm:{async call(){calls++;return{text:'{"edits":[]}'}}}});
 try{const bad=fixture();bad.record.blocks[0].cleanStatus='incomplete';await assert.rejects(ctx.zhiyunLecture.polish(bad),{code:'FORMAT'});assert.equal(calls,0);}
 finally{dispose();}
});


test('the same live service follows changed model routing instead of retaining its first model',async()=>{
  let model='first';const seen=[];
  const ctx={provide(name,value){this[name]=value;}};
  const dispose=await apply(ctx,{cache:new ParserCache(),llm:{resolve:async()=>({text:{model}}),call:async request=>{seen.push(request.route);return {text:'{"edits":[],"warnings":[]}'}}}});
  try{
    await ctx.zhiyunLecture.polish(fixture());model='second';await ctx.zhiyunLecture.polish(fixture());
    assert.deepEqual(seen.map(route=>route.model),['first','second']);
    assert.ok(seen.every(route=>route.maxTokens===32768));
  }finally{dispose();}
});
