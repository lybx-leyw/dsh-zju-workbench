import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {optionsOf,seeded,runQuizBench} from '../scripts/quiz_bench/run.mjs';
import {fixture,fixtureCall} from '../scripts/quiz_bench/fixture.mjs';
import {datasetFrom,fromLectureLog,loadDataset} from '../scripts/quiz_bench/input.mjs';
import {measure,applyReview,reviewTemplate,trialSummary} from '../scripts/quiz_bench/metrics.mjs';
import {readLog} from '../scripts/knowledge_tree_bench/log.mjs';
import {startServer} from '../scripts/quiz_bench/bench.mjs';
import {modelCall} from '../scripts/quiz_bench/bridge.mjs';
import http from 'node:http';

const defaults={fixture:true,counts:[3],batches:2,repeats:1,strategies:['recall'],types:['cloze']};
const temporary=async work=>{const dir=await fs.mkdtemp(path.join(tmpdir(),'zhiyun-quiz-bench-'));try{return await work(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}};

test('quiz bench validates a bounded matrix and seeds the product allocation deterministically',()=>{
  assert.equal(optionsOf().scenarios.length,2);
  assert.throws(()=>optionsOf({counts:[1,1]}));assert.throws(()=>optionsOf({strategies:['explore'],types:['trueFalse']}));
  assert.throws(()=>optionsOf({batches:10,repeats:5,counts:[1,2,3,4],strategies:['recall','understand'],types:['cloze','mcq']}));
  const a=seeded(42),b=seeded(42);assert.deepEqual(Array.from({length:20},a),Array.from({length:20},b));
});

test('knowledge-tree logs use final full text and refuse truncated lecture-only events',()=>{
  const rows=[{kind:'meta',what:'start',title:'示例'},
    {kind:'event',act:'lecture',data:{title:'概念',text:'这是已截断的概要',chars:9000}},
    {kind:'event',act:'polish',data:{text:'#!section bench 示例\n##!topic 1 1 | 概念 | P1-1 | src=1 | 章=第一章\n>>> BLOCK 定义\n这是终稿中的完整概念定义与原始依据。'}}];
  const dataset=fromLectureLog(rows);assert.equal(dataset.points.length,1);assert.equal(dataset.points[0].text,'这是终稿中的完整概念定义与原始依据。');
  assert.throws(()=>fromLectureLog(rows.slice(0,2)),/可能截断/);
});

test('bench work directory uses the product knowledge-point projection',()=>temporary(async dir=>{
  await fs.writeFile(path.join(dir,'parsed.json'),JSON.stringify({courseId:'course',subId:'lesson',blocks:[]}));
  await fs.writeFile(path.join(dir,'lecture-final.json'),JSON.stringify({generationVersion:'architecture-v4',revision:'fixed',chapters:[{title:'章',topics:[{title:'点',blocks:[{kind:'definition',text:'这是可读的原始定义与知识点正文。'}]}]}]}));
  const dataset=await loadDataset(dir);assert.equal(dataset.points[0].id,'course:lesson:fixed:0:0');
}));

test('missing independent gold is unknown; system concept coverage is never presented as gold coverage',()=>{
  const points=datasetFrom(fixture).points;
  const m=measure({points,questions:[],conceptCache:{}});assert.equal(m.reference.available,false);assert.equal(m.reference.questionCoverage,undefined);assert.equal(m.internalConceptCoverage.rate,null);
});

test('growth and duplicate metrics distinguish existing families from new concepts',()=>{
  const points=[{id:'p',text:'完整的课堂原文依据。'}],base={pointId:'p',pointKey:'p',basis:points[0].text,conceptId:'c',familyId:'family',angle:'定义',stem:'什么是概率？',strategy:'recall'};
  const m=measure({points,prior:[{...base,id:'q1'}],questions:[{...base,id:'q2',parentId:'q1'}],conceptCache:{key:{concepts:[{id:'c'}]}},calls:[]});
  assert.equal(m.growth.newConcepts,0);assert.equal(m.growth.cumulativePointCoverage,1);assert.equal(m.diversity.exactRepeats,1);assert.equal(m.diversity.variants,1);assert.equal(m.calls.inputTokens,null);
});

test('real plugin runs cold trials independently, reuses cache within batches and writes replayable evidence',()=>temporary(async dir=>{
  const report=await runQuizBench({...defaults,repeats:2,outDir:dir});
  assert.equal(report.cells.length,2);assert.ok(report.cells.every(c=>c.batches.length===2));
  assert.equal(report.cells[0].calls.length,3);assert.equal(report.cells[1].calls.length,3,'independent trials do not share a warm concept cache');
  assert.equal(report.cells[0].batches[1].metrics.calls.count,0);
  assert.equal(report.trials[0].trials,2);assert.equal(report.trials[0].pointCoverage.mean,1);
  const log=await readLog(path.join(dir,'events.jsonl'));assert.equal(log.broken,0);assert.ok(log.records.some(r=>r.kind==='artifact'&&r.act==='model'));assert.equal(log.records.at(-1).what,'end');
  assert.ok((await fs.readFile(path.join(dir,'report.md'),'utf8')).includes('无法判定'));
}));

test('budget interruption resumes durable plans and concepts without redoing completed calls',()=>temporary(async dir=>{
  const first=await runQuizBench({...defaults,outDir:dir,maxCalls:1});assert.equal(first.status,'interrupted');
  const plan=first.cells[0].jobs[1].plan;
  const second=await runQuizBench({...defaults,outDir:dir,resume:true,maxCalls:20});
  assert.deepEqual(second.cells[0].jobs[1].plan,plan);assert.equal(second.cells[0].calls.filter(c=>c.stage==='quiz-rewrite').length,3);
  const log=await readLog(path.join(dir,'events.jsonl'));assert.equal(new Set(log.records.map(r=>r.seq)).size,log.records.length);
  await assert.rejects(runQuizBench({...defaults,outDir:dir,resume:true,counts:[4]}),/配置或资料已变化/);
}));

test('credentials stay out of state, reports, event logs and sanitized model failures',()=>temporary(async dir=>{
  const secret='fixture-private-secret-for-redaction';
  await runQuizBench({...defaults,apiKey:secret,outDir:dir},{call:async()=>{throw Error('provider echoed '+secret);}});
  for(const name of ['state.json','events.jsonl','report.json','report.md'])assert.ok(!(await fs.readFile(path.join(dir,name),'utf8')).includes(secret),name);
}));

test('manual review supplies independent gold mappings and rejects wrong datasets and unknown IDs',()=>temporary(async dir=>{
  const report=await runQuizBench({...defaults,outDir:dir}),review=reviewTemplate(report);
  review.gold={concepts:[{id:'required',label:'必考概念',weight:2},{id:'missing',label:'另一概念',weight:1}]};
  review.concepts[0].reviewed=true;review.concepts[0].goldIds=['required'];
  review.questions[0].reviewed=true;review.questions[0].goldIds=['required'];review.questions[0].correct=true;
  const checked=applyReview(report,review),metric=checked.cells[0].metrics.reference;
  assert.equal(metric.questionCoverage,.5);assert.equal(metric.weightedCoverage,2/3);assert.equal(metric.complete,false);assert.equal(metric.quality.correct.rate,1);
  assert.throws(()=>applyReview(report,{...review,datasetHash:'wrong'}));
  assert.throws(()=>applyReview(report,{...review,questions:[{questionId:'missing',reviewed:true}]}));
  assert.equal(report.cells[0].metrics.reference.available,false,'original report remains unchanged');
}));

test('localhost bench protects artifacts and runs from cross-origin or unauthenticated requests',()=>temporary(async dir=>{
  const runtime=await startServer({outDir:dir,sourceDir:dir});
  try{
    const url=new URL(runtime.url),base=url.origin,token=url.searchParams.get('t');
    assert.equal((await fetch(base+'/api/runs')).status,403);
    assert.equal((await fetch(base+'/api/runs',{headers:{'x-bench-token':token,origin:'https://example.org'}})).status,403);
    const response=await fetch(base+'/api/run',{method:'POST',headers:{'content-type':'application/json','x-bench-token':token},body:JSON.stringify(defaults)});
    assert.equal(response.status,200);const lines=(await response.text()).split('\n\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6)));
    const id=lines.find(e=>e.kind==='run').id;assert.ok(lines.some(e=>e.kind==='done'));
    assert.equal((await fetch(base+'/api/report?id='+id,{headers:{'x-bench-token':token}})).status,200);
    assert.equal((await fetch(base+'/api/report?id=../other',{headers:{'x-bench-token':token}})).status,400);
  }finally{await runtime.close();}
}));

test('shared streaming transport passes the chosen model and rejects missing finish or truncated output',async()=>{
  let finish='stop',observed;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;observed=JSON.parse(body);
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'完整中文响应'},...(finish?{finish_reason:finish}:{})}]} )+'\n\n');
    res.end('data: '+JSON.stringify({usage:{prompt_tokens:12,completion_tokens:8},choices:[]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const call=modelCall({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic-key',model:'selected-model'}),request={stage:'quiz-rewrite',constant:'说明',variable:'材料'};
    const result=await call(request);assert.equal(result.text,'完整中文响应');assert.equal(result.usage.prompt_tokens,12);assert.equal(observed.model,'selected-model');
    finish='length';await assert.rejects(call(request),/未完整结束/);
    finish=null;await assert.rejects(call(request),/未完整结束/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
