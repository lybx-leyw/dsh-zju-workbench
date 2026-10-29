import test from 'node:test';
import assert from 'node:assert/strict';
import {runR4,planDemands} from '../scripts/quiz_bench/experimental-r4/run.mjs';
import {graph,model} from '../scripts/quiz_bench/experimental-r4/fixture.mjs';
test('composite exploration reads complete assigned material without exploring any child',async()=>{
 const m=model();const r=await runR4({graph:graph(),pointIds:['a','b'],count:1,compositeCount:1,requestId:'cross',call:m.call});
 assert.equal(r.produced,1);assert.equal(r.treeComplete,false);
 const exploration=m.calls.filter(c=>c.stage.endsWith('-ideas'));assert.equal(exploration.length,1);assert.equal(exploration[0].stage,'r3-parent-ideas');
 const children=exploration[0].input.subtree.children;
 assert.deepEqual(children.map(c=>c.title),['a','b']);assert.ok(children.every(c=>c.ideas.length===0));
 assert.ok(children.every(c=>c.lecture[0].text.includes('第二部分')));assert.equal(children[0].pages[0].visual[0].text,'图示条件');
 assert.ok(!JSON.stringify(m.calls).includes('知识点c'));
});
test('local exploration skips ancestors and siblings and resume makes no model calls',async()=>{
 const m=model(),args={graph:graph(),pointIds:['a'],count:1,requestId:'local',call:m.call};const first=await runR4(args),before=m.calls.length;
 assert.equal(first.produced,1);assert.deepEqual(m.calls.filter(c=>c.stage.endsWith('-ideas')).map(c=>c.input.subtree.title),['a']);
 const second=await runR4({...args,state:first.checkpoint});assert.equal(second.produced,1);assert.equal(m.calls.length,before);
 assert.ok(Object.values(second.checkpoint.explorations).every(e=>e.complete===false));
});
test('mixed quotas produce local and composite questions and later batches reuse exploration',async()=>{
 const m=model(),args={graph:graph(),pointIds:['a','b'],count:4,compositeCount:2,requestId:'mixed',call:m.call};
 const first=await runR4(args);assert.equal(first.produced,4);assert.equal(first.results.filter(r=>r.kind==='composite').reduce((n,r)=>n+r.produced,0),2);
 const explored=m.calls.filter(c=>c.stage.endsWith('-ideas')).length;
 const next=await runR4({...args,requestId:'next',count:1,compositeCount:0,state:first.checkpoint});assert.equal(next.produced,1);
 assert.equal(m.calls.filter(c=>c.stage.endsWith('-ideas')).length,explored);
});
test('unrelated material edits reuse cache; selected material edits do not',async()=>{
 const m=model(),args={graph:graph(),pointIds:['a'],count:1,requestId:'change',call:m.call},first=await runR4(args),before=m.calls.length;
 const unrelated=graph();unrelated.root.children[2].text+='无关修改';
 await runR4({...args,graph:unrelated,requestId:'unrelated',state:first.checkpoint});
 assert.equal(m.calls.filter(c=>c.stage.endsWith('-ideas')).length,1);
 const selected=graph();selected.root.children[0].text+='相关修改';
 await runR4({...args,graph:selected,requestId:'selected',state:first.checkpoint});
 assert.ok(m.calls.length>before);assert.equal(m.calls.filter(c=>c.stage.endsWith('-ideas')).length,2);
});
test('capacity shortage remains partial rather than relabeling local questions as composite',async()=>{
 const m=model();const r=await runR4({graph:graph(),pointIds:['a','b'],count:3,compositeCount:3,requestId:'short',call:m.call});
 assert.equal(r.state,'partial');assert.equal(r.produced,0);assert.match(r.results[0].error,/不足/);assert.equal(r.treeComplete,false);
});
test('invalid allocation and conflicting request identity fail before paid work',async()=>{
 assert.throws(()=>planDemands({graph:graph(),pointIds:['a'],count:1,compositeCount:1}));
 const m=model(),args={graph:graph(),pointIds:['a'],count:1,requestId:'same',call:m.call},r=await runR4(args),before=m.calls.length;
 await assert.rejects(runR4({...args,count:2,state:r.checkpoint}),/不能更改/);assert.equal(m.calls.length,before);
});
test('persistence failure and invalid strategy cannot trigger model work',async()=>{
 const m=model(),args={graph:graph(),pointIds:['a'],count:1,requestId:'fail',call:m.call};
 await assert.rejects(runR4({...args,onCheckpoint:async()=>{throw Error('disk unavailable');}}),{code:'PERSIST'});
 await assert.rejects(runR4({...args,strategies:['invented']}),/策略无效/);
 assert.equal(m.calls.length,0);
});
