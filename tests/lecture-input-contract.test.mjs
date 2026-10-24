import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLecture } from '../packages/dsh-zhiyun-core-lecture/src/generate.js';
import { normalizeLectureTree } from '../packages/dsh-zhiyun-core-lecture/src/tree.js';
import { facetRole } from '../packages/dsh-zhiyun-core-parser/src/tree.js';

const record = () => {
 const blocks=[
  {index:1,page:1,text:'学科内容',lectureEligible:true,tag:{role:'主线',facets:['概念','作业'],summary:'概念'}},
  {index:2,page:1,text:'教学安排',lectureEligible:false,tag:{role:'主线',facets:['作业']}},
  {index:3,page:null,text:'没有课件的正式讲授',lectureEligible:true,tag:{role:'主线',facets:['概念']}},
 ];
 return {blocks,outline:[],tree:{kind:'title',title:'课程',children:[{kind:'title',title:'章',children:[
  {kind:'leaf',id:'片段1',blocks:[{...blocks[0],text:'重构后的第一片'}]},
  {kind:'leaf',id:'片段2',blocks:[blocks[2]]},
 ]}]}};
};

test('shared generation matches the v4 bench projection, preserves fragments and all polish sources',async()=>{
 const source=record(),snapshot=structuredClone(source),calls=[],progress=[];
 const service={
  assemble:async input=>{calls.push(['assemble',input]);return {chapters:[{title:'章',topics:[{title:'点',blocks:[]}]}],warnings:[],failures:[]};},
  polish:async input=>{calls.push(['polish',input]);return {lecture:input.lecture,complete:true,changes:[],warnings:[]};},
 };
 const out=await generateLecture({service,record:source,title:'10-20',onProgress:p=>progress.push(p),onAssembled:()=>calls.push(['saved'])});
 assert.deepEqual(calls.map(c=>c[0]),['assemble','saved','polish']);
 assert.deepEqual(calls[0][1].tree,normalizeLectureTree(source.tree));
 assert.deepEqual(calls[0][1].blocks.map(b=>b.index),[1,3]);
 assert.equal(calls[0][1].tree.chapters[0].topics[0].sourceBlocks[0].text,'重构后的第一片');
 assert.deepEqual(calls[2][1].record.blocks,source.blocks);
 assert.equal(calls[2][1].sectionId,'bench');assert.equal(calls[0][1].context,'10-20');
 assert.deepEqual(source,snapshot);assert.equal(out.lecture.generationVersion,'architecture-v4');
 assert.deepEqual(progress.map(p=>p.phase),['lecture','polish']);
});

test('old records without a reconstructed tree are rejected before any model call',async()=>{
 await assert.rejects(generateLecture({service:{assemble:()=>assert.fail('no fallback')},record:{blocks:[]}}),{code:'INPUT'});
});

test('mixed academic/meta facets obey the parser eligibility decision',()=>{
 assert.equal(facetRole({tag:{facets:['概念','作业']}}),'host');
 assert.equal(facetRole({tag:{facets:['作业']}}),'meta');
});
