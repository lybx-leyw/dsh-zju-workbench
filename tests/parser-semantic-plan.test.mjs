import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemanticPlan, findPlanIssues, describePlanIssues, planThresholds, kPlanCheckMinBlocks } from '../packages/dsh-zhiyun-core-parser/src/semantic-plan.js';
import { buildTreeFromBlocks, leavesOf } from '../packages/dsh-zhiyun-core-parser/src/tree.js';
import { normalizeLectureTree } from '../packages/dsh-zhiyun-core-lecture/src/tree.js';
const blocks = [1,2,3,4].map(index=>({index,page:index<4?1:2,text:`来源${index}。`.repeat(60),register:'written',
  slideEvidence:[{page:1,text:'题设 q 与 Q 为不同电荷'}],sentences:[{text:`来源${index}。`.repeat(60)}],tag:{role:'主线',facets:['概念'],summary:`很长的课堂摘要${index}`}}));
const plan=[{title:'导体与介质',topics:[{title:'电势',from:1,to:2},{title:'电容',from:3,to:4}]}];
test('语义边界优先于同页归并和token装桶，碎片归回同一讲义知识点',()=>{
  const built=buildTreeFromBlocks(structuredClone(blocks),{semanticPlan:plan,splitLine:300});
  const tree=normalizeLectureTree(built.tree);
  assert.deepEqual(tree.chapters[0].topics.map(t=>t.title),['电势','电容']);
  assert.deepEqual(tree.chapters[0].topics.map(t=>t.blockIndexes),[[1,2],[3,4]]);
  for(const t of tree.chapters[0].topics){
    assert.equal(t.slideEvidence.length,1);
    for(const index of t.blockIndexes)assert.equal(t.sourceBlocks.filter(b=>b.index===index).map(b=>b.text).join(''),blocks[index-1].text);
  }
  assert.deepEqual([...new Set(leavesOf(built.tree).flatMap(l=>l.blocks.map(b=>b.index)))],[1,2,3,4]);
});
test('拒绝遗漏和重叠的语义方案，旧宿主无方案时明确返回null',()=>{
  assert.deepEqual(parseSemanticPlan(JSON.stringify({knowledge:plan}),blocks),plan);
  assert.equal(parseSemanticPlan('{"outline":[]}',blocks),null);
  for(const topics of [[{title:'漏',from:1,to:2}],[{title:'甲',from:1,to:3},{title:'乙',from:3,to:4}]])
    assert.throws(()=>parseSemanticPlan(JSON.stringify({knowledge:[{title:'章',topics}]}),blocks),{code:'SEMANTIC_PLAN'});
});

test('区间边界依据全部来源块，允许学科段跨过被排除的元信息；纯元信息投影不造知识点',()=>{
  const main=blocks.slice(0,3);
  const raw=JSON.stringify({knowledge:[{title:'学科',topics:[{title:'概念',from:1,to:4},{title:'教学安排',from:5,to:6}]}]});
  const plan=parseSemanticPlan(raw,main,6);
  assert.deepEqual(plan,[{title:'学科',topics:[{title:'概念',from:1,to:4}]}]);
  assert.throws(()=>parseSemanticPlan(raw,main,5),{code:'SEMANTIC_PLAN'},'超过真实末块依然拒绝');
});

test('粒度体检点名过碎的章与点，短节不做判断', () => {
  const long = Array.from({ length: 128 }, (_, i) => ({ index: i + 1, text: '长'.repeat(160) }));
  const fragmented = [
    { title: '课程说明', topics: [{ title: '安排', from: 1, to: 3 }] },
    { title: '读书无用论', topics: [
      { title: '背景', from: 4, to: 4 }, { title: '抗战时期', from: 5, to: 5 },
      { title: '改革开放', from: 6, to: 7 }, { title: '辨析', from: 8, to: 20 },
      { title: '就业压力', from: 21, to: 22 }, { title: '理性看待', from: 23, to: 26 },
      { title: '大学目的', from: 27, to: 40 }, { title: '通识教育', from: 41, to: 50 },
      { title: '结语', from: 51, to: 128 }] },
  ];
  const issues = findPlanIssues(fragmented, long);
  assert.equal(issues.filter(i => i.code === 'CHAPTER_TOO_WIDE').length, 1, '一章 9 点超过上限');
  const small = issues.filter(i => i.code === 'TOPIC_TOO_SMALL');
  assert.deepEqual(small.map(i => i.title), ['安排', '背景', '抗战时期', '改革开放', '就业压力'], '只点名真的过碎的点');
  const text = describePlanIssues(issues);
  assert.match(text, /读书无用论/);
  assert.match(text, /块 4–4/, '修复说明要带块号，便于模型只改分组');
  assert.match(text, /章内知识点过多/);

  const healthy = [{ title: '读书无用论', topics: [{ title: '读书无用论', from: 1, to: 70 }, { title: '通识教育', from: 71, to: 128 }] }];
  assert.deepEqual(findPlanIssues(healthy, long), []);

  const short = long.slice(0, kPlanCheckMinBlocks - 1);
  assert.deepEqual(findPlanIssues(fragmented, short), [], '短节不做粒度判断');
  assert.equal(planThresholds(128).minChars, 600);
  assert.equal(planThresholds(20).minChars, 400);
});

test('两块但字幕超过 600 字可以单独成点，正式语言尚未写上的 text 不参加计数', () => {
  const blocks = Array.from({ length: 80 }, (_, i) => ({
    index: i + 1, text: '',
    sentences: [{ text: '字'.repeat(i < 2 ? 410 : 80) }],
  }));
  const plan = [{ title: '教育改革', topics: [
    { title: '义务教育与扩招', from: 1, to: 2 },
    { title: '其余', from: 3, to: 80 },
  ] }];
  assert.deepEqual(findPlanIssues(plan, blocks), []);
  blocks[0].sentences = [{ text: '短'.repeat(100) }];
  blocks[1].sentences = [{ text: '短'.repeat(173) }];
  const small = findPlanIssues(plan, blocks).filter(i => i.code === 'TOPIC_TOO_SMALL');
  assert.deepEqual(small.map(i => [i.title, i.blocks, i.chars]), [['义务教育与扩招', 2, 273]]);
});
