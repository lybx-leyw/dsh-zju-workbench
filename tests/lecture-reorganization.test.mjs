import test from 'node:test';
import assert from 'node:assert/strict';
import {exportReorganization,mergeReorganization} from '../packages/dsh-zhiyun-core-lecture/src/agent-text.js';
const lecture=()=>({title:'课',chapters:[{no:1,title:'旧章',topics:[{title:'封面',sourceBlockIndexes:[1,2],blocks:[{kind:'definition',title:'定义',text:'定义正文'},{kind:'example',title:'例题',stem:'题目条件',solution:'已讲的解答'}]}]}]});
const record={blocks:[{index:1,page:4,startMs:1000,tag:{role:'主线',summary:'定义'}},{index:2,page:7,startMs:2000,tag:{role:'主线',summary:'例题'}}],outline:[]};
const organized=()=>`#!section x 课
##!topic 1 1 | 概念 | 章=理论
>>> BLOCK 定义 | 概念定义 | ref=c1t1b1 | src=1
定义正文
##!topic 2 1 | 应用 | 章=练习
>>> BLOCK 例题 | 条件与求解 | ref=c1t1b2 | src=2
题目条件
>>> SOLUTION
已讲的解答`;
test('reorganization accepts renaming, new chapters, accurate source-derived anchors and separate examples',()=>{
 const original=lecture(), snapshot=JSON.stringify(original);const out=mergeReorganization(original,organized(),record,'x');
 assert.equal(out.lecture.chapters.length,2);assert.equal(out.lecture.chapters[0].title,'理论');assert.equal(out.lecture.chapters[1].topics[0].title,'应用');
 assert.equal(out.lecture.chapters[1].topics[0].fromPage,7);assert.equal(out.lecture.chapters[1].topics[0].anchor.startMs,2000);
 assert.equal(out.lecture.chapters[1].topics[0].blocks[0].solution,'已讲的解答');assert.equal(JSON.stringify(original),snapshot);
 assert.deepEqual(out.coverage,{unitsBefore:2,unitsCovered:2,sourcesBefore:2,sourcesCovered:2});
 const round=mergeReorganization(out.lecture,exportReorganization(out.lecture,'x',record),record,'x');assert.equal(round.lecture.chapters.length,2);
});
test('malformed or incomplete reorganizations fail instead of silently restoring old titles',()=>{
 for(const text of [organized().replace('ref=c1t1b2','ref=invented'),organized().replace('src=2','src=99'),organized().split('##!topic 2')[0],organized().replace('>>> SOLUTION\n已讲的解答',''),organized().replace('ref=c1t1b1','ref=c1t1b1,c1t1b2').split('##!topic 2')[0],organized().replace('section x','section foreign')])assert.throws(()=>mergeReorganization(lecture(),text,record,'x'),{code:'FORMAT'});
});
test('Markdown body headings survive and split blocks can reference the same original unit',()=>{
 const text=organized().replace('定义正文','### 正文标题\n定义正文\n>>> BLOCK 讲解 | 补充 | ref=c1t1b1 | src=1\n同一原稿的另一部分');const out=mergeReorganization(lecture(),text,record,'x');
 assert.equal(out.lecture.chapters[0].topics[0].blocks.length,2);assert.match(out.lecture.chapters[0].topics[0].blocks[0].text,/### 正文标题/);
});
test('例题题干为空但解答有内容时，导出与合回一致（不许自相矛盾地判为空块）', () => {
  const original = () => ({ title: '课', chapters: [{ no: 1, title: '章', topics: [{ title: '点', sourceBlockIndexes: [1], blocks: [
    { kind: 'example', title: '例题', stem: '', solution: '整段只有解答的例题。' },
  ] }] }] });
  const rec = { blocks: [{ index: 1, page: 1, startMs: 1000, tag: { role: '主线', summary: '例题' } }], outline: [] };
  const text = exportReorganization(original(), 'x', rec);
  const out = mergeReorganization(original(), text, rec, 'x');
  assert.equal(out.lecture.chapters[0].topics[0].blocks[0].solution, '整段只有解答的例题。');
  // 整块一个字都没有才算空 —— 这条仍必须拒绝。
  const blank = text.replace('>>> SOLUTION\n整段只有解答的例题。', '>>> SOLUTION\n');
  assert.throws(() => mergeReorganization(original(), blank, rec, 'x'), { code: 'FORMAT' });
});

test('终审合回后重新判成稿状态：课堂称呼不会被写成成稿', () => {
  const original = () => ({ title: '课', chapters: [{ no: 1, title: '章', topics: [
    { title: '点', draft: '各位同学，我们来看这个式子。', register: 'draft', sourceBlockIndexes: [1], blocks: [{ kind: '讲解', title: '', text: '各位同学，我们来看这个式子。' }] },
  ] }] });
  const rec = { blocks: [{ index: 1, page: 1, startMs: 1000, tag: { role: '主线', summary: '点' } }], outline: [] };
  const out = mergeReorganization(original(), exportReorganization(original(), 'x', rec), rec, 'x');
  assert.equal(out.lecture.chapters[0].topics[0].register, 'draft');
  assert.ok(out.lecture.chapters[0].topics[0].notes.some((n) => n.includes('各位同学')));
});

test('本来就是成稿的知识点，终审原样返回仍是成稿', () => {
  const original = () => ({ title: '课', chapters: [{ no: 1, title: '章', topics: [
    { title: '点', draft: '静电场是保守场，环路积分为零。', register: 'written', sourceBlockIndexes: [1], blocks: [{ kind: '讲解', title: '', text: '静电场是保守场，环路积分为零。' }] },
  ] }] });
  const rec = { blocks: [{ index: 1, page: 1, startMs: 1000, tag: { role: '主线', summary: '点' } }], outline: [] };
  const out = mergeReorganization(original(), exportReorganization(original(), 'x', rec), rec, 'x');
  assert.equal(out.lecture.chapters[0].topics[0].register, 'written');
  assert.deepEqual(out.lecture.chapters[0].topics[0].notes, []);
});
