import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lock } from '../scripts/profile.mjs';
import { mountHost, answer, lesson, png } from './fixtures/parser/host.mjs';

const partsOf = options => options.messages[0].content.filter(b => b.type === 'text').map(b => b.text);

test('资源完成声明依据语义知识点划分；超限改写只退回那一句', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'resource-contract-'));let host;
  try{
    host=await mountHost(lock.hostVersions[0],dir,options=>{
      const [constant,variable]=partsOf(options);
      if(constant.startsWith('你在给一节大学课写**整节主线**')){
        const count=Number(variable.match(/共 (\d+) 块/)?.[1]);
        return JSON.stringify({spine:'概率密度函数',outline:[{title:'概率密度',from:1,to:count}],knowledge:[{title:'概率',topics:[{title:'概率密度',from:1,to:count}]}]});
      }
      return answer(options);
    });
    const complete=await host.parser.parse(lesson());
    assert.equal(complete.resource.structureStatus,'allocated');
    assert.equal(complete.resource.topicCount,1);
    assert.equal(complete.resource.semanticOptimized,false);
    const source=lesson();source.subtitles.push({startMs:1000000,endMs:1001000,text:'没有课件对照的讲授内容。'});
    const kept=await host.parser.parse(source);
    // 桩把这句改写成无关的「旧四史」，护栏只退回这一句。资源仍完成结构划分，不把整节打回未完成。
    assert.equal(kept.resource.structureStatus,'allocated');
    assert.equal(kept.resource.unanchoredUncleanedSentenceCount,0);
    assert.equal(kept.resource.transcriptOnlySentenceCount,1);
    assert.equal(kept.resource.blockedCorrectionCount,1);
    const sentence=kept.unassignedSentences.find(s=>s.rawText==='没有课件对照的讲授内容。');
    assert.equal(sentence.text,'没有课件对照的讲授内容。');
    assert.equal(sentence.cleanStatus,'reverted');
    const block=kept.blocks.find(b=>b.sentences.some(s=>s.rawText==='没有课件对照的讲授内容。'));
    assert.equal(block.cleanStatus,'reviewed');
    assert.equal(block.lectureEligible,true);
  }finally{await host?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('mix同次完成标记，merge在填充前生成正式正文并保留clean转录来源', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mix-merge-contract-')); let host;
  try {
    const calls = [];
    host = await mountHost(lock.hostVersions[0], dir, options => {
      const [constant, variable] = partsOf(options); calls.push(constant);
      if (constant.includes('建树阶段的merge')) {
        return JSON.stringify({ blocks: JSON.parse(variable).blocks.map(b => ({ index: b.index, text: '概率密度函数用于描述连续型随机变量的概率分布。' })) });
      }
      if (constant.startsWith('你在给一节大学课做**维度标注**（分卷进行）')) throw new Error('不得单独调用tags');
      return answer(options);
    }, { parserConfig: { visionBatchSize: 1, concurrency: 2 } });
    const out = await host.parser.parse(lesson());
    assert.equal(out.status, 'ready');
    assert.equal(out.resource.label, '讲义资源终稿');
    assert.equal(out.resource.structureStatus, 'unverified', '旧宿主无详细语义分组时，改名不能冒充已完成划分');
    assert.equal(out.resource.topicCount, null);
    assert.equal(out.resource.semanticOptimized, false);
    assert.ok(out.calls.some(c => c.stage === 'mix'));
    assert.ok(!out.calls.some(c => c.stage === 'tags'));
    assert.equal(out.blocks[0].tag.role, '主线');
    assert.equal(out.blocks[0].register, 'written');
    assert.equal(out.blocks[0].text, '概率密度函数用于描述连续型随机变量的概率分布。');
    assert.equal(out.blocks[0].sourceText, out.blocks[0].sentences.map(s => s.text).join(''));
    assert.ok(out.knowledgePoints.every(p => p.blocks.every(b => b.text.includes('概率密度函数用于描述'))));
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('vision第二页未结束时第一页mix已经执行，且共用并发闸', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mix-overlap-')); let host;
  try {
    let release; const secondVision = new Promise(resolve => { release = resolve; });
    let started; const secondStarted = new Promise(resolve => { started = resolve; });
    let mixWhileVision = false, secondInFlight = false;
    const trace = [];
    host = await mountHost(lock.hostVersions[0], dir, async options => {
      const [constant, variable] = partsOf(options);
      const page = Number(variable.match(/这是第 (\d+) 页/)?.[1]);
      trace.push({ page, image: options.messages[0].content.some(b => b.type === 'image'), constant: constant.slice(0, 24), variable: variable.slice(0, 70) });
      if (options.messages[0].content.some(b => b.type === 'image') && page === 1) await secondStarted;
      if (options.messages[0].content.some(b => b.type === 'image') && page === 2) {
        secondInFlight = true; started(); await secondVision; secondInFlight = false;
      }
      if (constant.includes('逐块语音稿清洗器') && page === 1) { mixWhileVision ||= secondInFlight; release(); }
      return answer(options);
    }, { parserConfig: { visionBatchSize: 1, concurrency: 2 } });
    const out = await host.parser.parse({
      sourceId: 'fixture:overlap',
      slides: [1, 2].map((page, i) => ({ page, createdSec: i * 20 + 1, imageBytes: png, mediaType: 'image/png' })),
      subtitles: [0, 1].map(i => ({ startMs: i * 20000 + 2000, endMs: i * 20000 + 4000, text: '概率密度函数' })),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(mixWhileVision, true, JSON.stringify({ config: host.parser.visionBatchSize, trace }));
    assert.equal(out.pipeline.consumed, 2);
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('正式语言组织失败必须partial，不能把raw稿冒充正式正文', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'merge-failed-')); let host;
  try {
    host = await mountHost(lock.hostVersions[0], dir, options => {
      const [constant] = partsOf(options);
      return constant.includes('建树阶段的merge') ? '{"blocks":[]}' : answer(options);
    });
    const out = await host.parser.parse(lesson());
    assert.equal(out.status, 'partial');
    assert.equal(out.mergeFailures[0].code, 'MERGE_COVERAGE');
    assert.equal(out.blocks[0].register, 'draft');
    assert.equal(out.blocks[0].text, undefined);
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
import {organizeLeaf} from '../packages/dsh-zhiyun-core-parser/src/organize.js';
import {ParserCache,Limiter} from '../packages/dsh-zhiyun-core-parser/src/cache.js';
test('组织格式失败只修复一次，完整来源通过后才缓存；失败不污染正文', async()=>{
  const cache=new ParserCache(),limiter=new Limiter(1),events=[];let calls=0;
  const leaf=()=>({id:'a',blocks:[{index:1,page:1,sentences:[{text:'这是来源。'}]}]});
  const llm={async call(request){calls++;if(calls===1)return{text:'{"blocks":[{"index":1,"text":"非法\\(转义"}]}'};assert.match(request.variable,/MERGE_FORMAT/);return{text:'{"blocks":[{"index":1,"text":"正式正文。"}]}'};}};
  const options={llm,route:'a',cache,limiter,pages:[],events};const first=leaf();
  assert.deepEqual(await organizeLeaf(first,options),[]);assert.equal(first.blocks[0].text,'正式正文。');assert.equal(calls,2);
  assert.deepEqual(await organizeLeaf(leaf(),options),[]);assert.equal(calls,2);assert.equal(events.at(-1).cached,true);
  const bad=leaf();const failures=await organizeLeaf(bad,{...options,cache:new ParserCache(),llm:{async call(){return{text:'{"blocks":[]}'}}}});
  assert.equal(failures[0].code,'MERGE_COVERAGE');assert.equal(bad.blocks[0].register,'draft');assert.equal(bad.blocks[0].text,undefined);
  const partialLeaf={id:'p',page:7,blocks:[
    {index:10,page:7,sentences:[{text:'已写好的来源。'}]},
    {index:11,page:7,sentences:[{text:'没有回来的来源。'}]},
  ]};
  let partialCalls=0;
  const partial=await organizeLeaf(partialLeaf,{...options,cache:new ParserCache(),events:[],llm:{async call(){partialCalls++;return{text:JSON.stringify({blocks:[{index:10,text:'已经写好的正式正文。'}]})};}}});
  assert.equal(partialCalls,1);
  assert.deepEqual(partial,[{stage:'merge',page:7,blockIndexes:[11],code:'MERGE_COVERAGE'}]);
  assert.equal(partialLeaf.blocks[0].register,'written');
  assert.equal(partialLeaf.blocks[0].text,'已经写好的正式正文。');
  assert.equal(partialLeaf.blocks[1].register,'draft');
  assert.equal(partialLeaf.blocks[1].text,undefined);
  assert.equal(partialLeaf.blocks[1].sourceText,'没有回来的来源。');
});
test('知识点方案覆盖失败仅修复方案一次，成功后缓存，不重发清洗',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'plan-repair-'));let host,outlineCalls=0,mixCalls=0;
  try{host=await mountHost(lock.hostVersions[0],dir,options=>{
    const [constant,variable]=partsOf(options);
    if(constant.startsWith('你在给一节大学课写**整节主线**')){
      outlineCalls++;const count=Number(variable.match(/共 (\d+) 块/)?.[1]);
      return JSON.stringify({spine:'概率',outline:[{title:'概率',from:1,to:count}],knowledge:[{title:'概率',topics:[{title:'概率密度',from:1,to:outlineCalls===1?0:count}]}]});
    }
    if(constant.includes('同一次 mix 必须'))mixCalls++;
    return answer(options);
  });const result=await host.parser.parse(lesson());assert.equal(result.outlineFailure,null);assert.ok(result.semanticPlan);assert.equal(outlineCalls,2);
  const before=mixCalls;await host.parser.parse(lesson());assert.equal(outlineCalls,2);assert.equal(mixCalls,before);
  }finally{await host?.dispose();await rm(dir,{recursive:true,force:true});}
});
const manyLesson = (n = 8) => ({ sourceId: 'fixture:lesson', context: 'context',
  slides: Array.from({ length: n }, (_, i) => ({ page: i + 1, createdSec: i, imageBytes: png, mediaType: 'image/png' })),
  subtitles: Array.from({ length: n }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 500, text: '旧四史' })) });

test('知识点过碎时点名修复一次，修好后沿用；修不动如实报告不重跑清洗', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-grain-')); let host, outlineCalls = 0, mixCalls = 0, stubborn = false;
  try {
    host = await mountHost(lock.hostVersions[0], dir, options => {
      const [constant, variable] = partsOf(options);
      if (constant.startsWith('你在给一节大学课写**整节主线**')) {
        outlineCalls += 1;
        const count = Number(variable.match(/共 (\d+) 块/)?.[1]);
        const repaired = variable.includes('知识点过碎');
        const topics = repaired
          ? [{ title: '概率密度函数', from: 1, to: count }]
          : Array.from({ length: count }, (_, i) => ({ title: '片段' + (i + 1), from: i + 1, to: i + 1 }));
        const knowledge = stubborn
          ? [{ title: '概率', topics: Array.from({ length: count }, (_, i) => ({ title: '片段' + (i + 1), from: i + 1, to: i + 1 })) }]
          : [{ title: '概率密度', topics }];
        return JSON.stringify({ spine: '概率密度', outline: [{ title: '概率密度', from: 1, to: count }], knowledge });
      }
      if (constant.includes('同一次 mix 必须')) mixCalls += 1;
      return answer(options);
    });
    const out = await host.parser.parse(manyLesson());
    assert.equal(outlineCalls, 2, '碎方案只修复一次');
    assert.equal(out.semanticPlan.length, 1);
    assert.equal(out.semanticPlan[0].topics.length, 1, '修复后同一主题收成一个知识点');
    const firstMix = mixCalls;
    await host.parser.parse(manyLesson());
    assert.equal(outlineCalls, 2, '修好的方案进缓存，不再请求模型');
    assert.equal(mixCalls, firstMix, '粒度修复不重跑清洗');
    stubborn = true;
    const still = await host.parser.parse({ ...manyLesson(9), sourceId: 'fixture:stubborn' });
    assert.equal(still.status, 'ready');
    assert.ok(still.warnings.some(w => /粒度/.test(w)), '修不动要如实报告: ' + JSON.stringify(still.warnings));
    assert.equal(still.semanticPlan[0].topics.length, 9, '不静默改写模型的方案');
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('无图时间段走mix同次清洗标记，失败段隔离，字幕来源恰好一次',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'unanchored-work-'));let host,failed=false,sourceCalls=0;
 try{host=await mountHost(lock.hostVersions[0],dir,options=>{
  const [constant,variable]=partsOf(options);
  if(variable.includes('【依据类型】仅语音转录')){
   sourceCalls++;if(failed)return '## 逐块标注\n块 1-1\n## 块标记\n{"tags":[]}';
   const count=[...variable.matchAll(/^\d+\. \[/gm)].length;
   return `## 逐块标注\n块 1-${count}\n## 块标记\n`+JSON.stringify({tags:[{index:1,from:1,to:count,role:'主线',facets:['概念'],summary:'独立讲授内容'}]});
  }
  if(constant.startsWith('你在给一节大学课写**整节主线**')){const count=+variable.match(/共 (\d+) 块/)[1];return JSON.stringify({spine:'定义',outline:[{title:'定义',from:1,to:count}],knowledge:[{title:'定义',topics:[{title:'定义',from:1,to:count}]}]});}
  return answer(options);
 });const input=lesson();input.subtitles.push({startMs:1000000,endMs:1001000,text:'独立讲授的定义。'},{startMs:1000000,endMs:1001000,text:'独立讲授的定义。'});
 const out=await host.parser.parse(input);assert.equal(out.resource.unanchoredUncleanedSentenceCount,0);assert.equal(out.resource.transcriptOnlySentenceCount,2);
 assert.deepEqual([...out.sentences.map(s=>s.sourceIndex)].sort((a,b)=>a-b),[0,1,2,3]);assert.equal(out.blocks.filter(b=>b.fromUnanchored).length,1);
 const block=out.blocks.find(b=>b.fromUnanchored);assert.equal(block.tag.role,'主线');assert.equal(block.cleanStatus,'reviewed');assert.deepEqual(block.slideEvidence,[]);
 const before=sourceCalls;await host.parser.parse(input);assert.equal(sourceCalls,before);
 failed=true;input.subtitles[2].text+='新的来源版本。';const partial=await host.parser.parse(input);
 assert.equal(partial.resource.unanchoredUncleanedSentenceCount,2);assert.equal(partial.status,'partial');assert.equal(partial.sentences.length,4);
 assert.ok(partial.board.some(b=>b.why==='待标记'||b.why==='待清洗'));
 assert.ok(!partial.knowledgePoints.some(p=>p.blocks.some(b=>b.cleanStatus==='incomplete')));
 }finally{await host?.dispose();await rm(dir,{recursive:true,force:true});}
});
import {assembleMixPage} from '../packages/dsh-zhiyun-core-parser/src/mix.js';
test('原子块记录绑定自己的区间和标记，拒绝乱序编号及无效区间',()=>{
 const lines=[{startMs:0,endMs:1,text:'定义。'},{startMs:1,endMs:2,text:'应用。'}],vocab=[{name:'概念'}];
 const card=tags=>'## 块标记\n'+JSON.stringify({tags});
 const tags=[{index:1,from:1,to:1,role:'主线',facets:['概念'],summary:'定义'},{index:2,from:2,to:2,role:'支线',facets:[],summary:'事务'}];
 const parsed=assembleMixPage(lines,null,card(tags),vocab);assert.equal(parsed.marking.ok,true);assert.equal(parsed.coverage.ok,true);assert.equal(parsed.drafts[1].tag.role,'支线');
 assert.equal(assembleMixPage(lines,null,card([...tags].reverse()),vocab).marking.ok,false);
 assert.equal(assembleMixPage(lines,null,card([{...tags[0],to:2},tags[1]]),vocab).coverage.ok,false);
 const invalid=assembleMixPage(lines,null,card([null,tags[1]]),vocab);assert.equal(invalid.marking.ok,false);assert.equal(invalid.coverage.ok,false);
});
