/**
 * 断点续做：章内逐页落盘，失败后只补没画完的部分。
 *
 * 背景（这是一个真实的缺陷）：最初只有**整章**一种 checkpoint（`html-chapter-N`）。
 * 一章要串行画 5-10 页，每页一次完整模型调用；第 8 页失败时，前 7 页的成果
 * 随整个 run 一起作废，续跑等于从头再来 —— 花了钱、花了时间，什么都没留下。
 *
 * 现在的契约：
 *   `html-chapter-N`          整章完成（含 html / analysis / storyboard / slides）
 *   `html-chapter-N-partial`  章内进度（analysis + storyboard + 每页已画的 slides）
 * 续跑时从 partial 接着画，**已完成的分镜不再调模型**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHtmlChapters } from '../../../packages/core/classroom-generate/src/html-deck.js';

const slide = (title) => ({ title, points: ['短词'], summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>',
  formulas: [], explanation: '画布外讲解，长度足够说明推导依据。' });

const chapter = { chapterId: 'c1', title: '第一章', sourceText: '条件决定结论。假设成立则结论成立。' };

function scripted({ scenes = 4, failAt = null } = {}) {
  const calls = [];
  const llm = { async call(request) {
    calls.push({ stage: request.stage, sceneIndex: request.sceneIndex });
    if (request.stage === 'html-understanding') {
      return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    }
    if (request.stage === 'html-storyboard') {
      return JSON.stringify({ scenes: Array.from({ length: scenes }, (_, i) => ({
        title: `分镜${i + 1}`, explanation: '讲解', visual: '图' })) });
    }
    if (failAt !== null && request.sceneIndex === failAt) throw new Error('模型超时');
    return JSON.stringify({ slides: [slide(`第 ${request.sceneIndex + 1} 页`)] });
  } };
  return { llm, calls, contentCalls: () => calls.filter(c => c.stage === 'html').map(c => c.sceneIndex) };
}

test('each finished page is persisted immediately, not only when the chapter ends', async () => {
  const { llm } = scripted({ scenes: 4, failAt: 3 });
  const saved = [];
  await assert.rejects(generateHtmlChapters({ chapters: [chapter], llm,
    checkpointPartial: async (key, value) => { saved.push({ key, scenes: value.slidesByScene.map(p => p ? p.length : 0) }); } }), /模型超时/);
  assert.deepEqual(saved.map(s => s.key), ['html-chapter-1-partial', 'html-chapter-1-partial', 'html-chapter-1-partial']);
  assert.deepEqual(saved.map(s => s.scenes), [[1, 0, 0, 0], [1, 1, 0, 0], [1, 1, 1, 0]]);
  assert.deepEqual(saved.at(-1) && saved.length, 3, '第 4 页失败前，前三页都已落盘');
});

test('resuming redraws only the missing pages', async () => {
  // 第一次：画到第 3 页时失败。
  const first = scripted({ scenes: 4, failAt: 2 });
  const completed = new Map();
  let latest = null;
  await assert.rejects(generateHtmlChapters({ chapters: [chapter], llm: first.llm, completed,
    checkpointPartial: async (key, value) => { latest = value; completed.set(key, value); } }), /模型超时/);
  assert.deepEqual(first.contentCalls(), [0, 1, 2]);
  assert.deepEqual(latest.slidesByScene.map(p => p ? p.length : 0), [1, 1, 0, 0]);

  // 第二次：同一份 completed（模拟从盘上读回来），只应画第 3、4 页。
  const second = scripted({ scenes: 4 });
  const result = await generateHtmlChapters({ chapters: [chapter], llm: second.llm, completed });
  assert.deepEqual(second.contentCalls(), [2, 3], '只补没画完的两页，前三页不重画');
  assert.equal(result[0].slides.length, 4);
  assert.deepEqual(result[0].slides.map(s => s.title), ['第 1 页', '第 2 页', '第 3 页', '第 4 页'],
    '复用页与新画页必须按分镜顺序拼回去');
});

test('resume keeps already-drawn pages even when the storyboard is identical', async () => {
  const first = scripted({ scenes: 3, failAt: 1 });
  const completed = new Map();
  await assert.rejects(generateHtmlChapters({ chapters: [chapter], llm: first.llm, completed,
    checkpointPartial: async (key, value) => { completed.set(key, value); } }), /模型超时/);

  const second = scripted({ scenes: 3 });
  const result = await generateHtmlChapters({ chapters: [chapter], llm: second.llm, completed });
  assert.equal(second.calls.filter(c => c.stage === 'html-understanding').length, 0, '理解障碍不重算');
  assert.equal(second.calls.filter(c => c.stage === 'html-storyboard').length, 0, '分镜不重算');
  assert.deepEqual(second.contentCalls(), [1, 2]);
  assert.equal(result[0].analysis.obstacles.length, 1);
});

test('a changed source invalidates the partial and regenerates from scratch', async () => {
  const first = scripted({ scenes: 3, failAt: 1 });
  const completed = new Map();
  await assert.rejects(generateHtmlChapters({ chapters: [chapter], llm: first.llm, completed,
    checkpointPartial: async (key, value) => { completed.set(key, value); } }), /模型超时/);

  const second = scripted({ scenes: 3 });
  const changed = { ...chapter, sourceText: chapter.sourceText + '新增的条件与反例。' };
  const result = await generateHtmlChapters({ chapters: [changed], llm: second.llm, completed });
  assert.deepEqual(second.contentCalls(), [0, 1, 2], '讲义改了就不能复用旧讲解');
  assert.equal(second.calls.filter(c => c.stage === 'html-understanding').length, 1);
  assert.equal(result[0].sourceHash !== first.calls.length, true);
});

test('a corrupt partial is ignored instead of failing the whole run', async () => {
  const completed = new Map();
  completed.set('html-chapter-1-partial', { deckVersion: 2, sourceHash: 'irrelevant', slidesByScene: 'garbage' });
  const { llm, contentCalls } = scripted({ scenes: 2 });
  const result = await generateHtmlChapters({ chapters: [chapter], llm, completed });
  assert.equal(result.length, 1);
  assert.deepEqual(contentCalls(), [0, 1], '坏存档当作没有，从头画');
});

test('a fully generated chapter still short-circuits on the whole-chapter checkpoint', async () => {
  const completed = new Map();
  const first = scripted({ scenes: 2 });
  await generateHtmlChapters({ chapters: [chapter], llm: first.llm, completed,
    checkpoint: async (key, value) => { completed.set(key, value); } });

  const second = scripted({ scenes: 2 });
  const result = await generateHtmlChapters({ chapters: [chapter], llm: second.llm, completed });
  assert.equal(second.calls.length, 0, '整章已完成时一次模型都不该调');
  assert.equal(result[0].slides.length, 2);
});

test('without checkpointPartial the behaviour degrades to whole-chapter only', async () => {
  const { llm } = scripted({ scenes: 2, failAt: 1 });
  const completed = new Map();
  await assert.rejects(generateHtmlChapters({ chapters: [chapter], llm, completed }), /模型超时/);
  assert.equal(completed.size, 0, '没有逐页落盘端口时，确实什么都没存下（旧行为，明确可见）');
});
