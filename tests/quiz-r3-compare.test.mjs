import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareCase,runComparison} from '../scripts/quiz_bench/experimental-r3/compare.mjs';

test('three-way input bridge preserves r3 hierarchy and gives both legacy arms the same page information',async()=>{
 const root=path.resolve('artifacts'),directory=await fs.mkdtemp(path.join(root,'quiz-compare-test-'));
 try{
  const graph={id:'fixture',root:{id:'root',title:'课程',children:[{id:'chapter',title:'章',children:[{id:'a',title:'甲',text:'甲节点自己的完整定稿正文。',pages:[{page:3,text:'相关页面的完整文字。',visual:'相关页的图形细节。'}],children:[]},{id:'b',title:'乙',text:'乙节点自己的完整定稿正文。',children:[]}]}]}};
  const source=path.join(directory,'graph.json');await fs.writeFile(source,JSON.stringify(graph));
  const c=await prepareCase({id:'case',source,select:[0],firstChildren:2});
  assert.equal(c.graph.root.id,'chapter');assert.equal(c.graph.root.children[0].text,graph.root.children[0].children[0].text);
  assert.equal(c.graph.root.children[0].pages[0].visual,'相关页的图形细节。');
  assert.match(c.dataset.points[0].text,/甲节点自己的完整定稿正文/);assert.match(c.dataset.points[0].text,/相关页面的完整文字/);assert.match(c.dataset.points[0].text,/相关页的图形细节/);
  assert.equal(c.dataset.points[0].id,c.leaves[0].id);assert.match(c.materialHash,/^[a-f0-9]{64}$/);
 }finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true});}
});

test('formal comparison refuses a pre-populated output before any model request',async()=>{
 const root=path.resolve('artifacts'),directory=await fs.mkdtemp(path.join(root,'quiz-formal-guard-'));
 try{
  await fs.writeFile(path.join(directory,'prior-cache.json'),'{}');
  await assert.rejects(runComparison({spec:{kind:'formal'},out:directory,credentials:{}}),/空目录与冷缓存/);
  assert.equal(await fs.readFile(path.join(directory,'prior-cache.json'),'utf8'),'{}');
 }finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true});}
});

test('comparison cannot write experiment data outside the ignored artifact root',async()=>{
 await assert.rejects(runComparison({spec:{},out:'docs/show',credentials:{}}),/artifacts 下的独立目录/);
});
