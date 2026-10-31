import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrief } from '../packages/dsh-zhiyun-core-classroom-generate/src/brief.js';
import { produceChapters } from '../packages/dsh-zhiyun-core-classroom-generate/src/phases/chapters.js';
import { runPipeline } from '../packages/dsh-zhiyun-core-classroom-generate/src/pipeline.js';
import { createEventLog } from '../packages/dsh-zhiyun-core-classroom-generate/src/events.js';
import { buildOutlinePrompt, buildScenePrompt } from '../packages/dsh-zhiyun-core-classroom-generate/src/prompts.js';

const chapters = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, title: `CH${i}`, sourceText: `FULL${i}`.repeat(3000), knowledgeTree: { node: `TREE${i}` } }));
function fixture(extra = {}) {
  const record = { brief: normalizeBrief({ requirement: 'teach', chapters, ...extra }), stageId: 'stage', runId: 'run', controller: new AbortController(), outputs: new Map() };
  const writes = [];
  return { record, writes, ports: { now: () => 1 }, checkpoint: async (key) => { writes.push(key); }, emit: () => {} };
}
function model({ onCall = () => {} } = {}) {
  return { call: async (request) => {
    await onCall(request);
    if (request.stage === 'outline') return JSON.stringify({ outlines: [1, 2].map((i) => ({ type: 'slide', title: `page${i}`, keyPoints: ['point'] })) });
    return JSON.stringify({ elements: [{ id: 'text', type: 'text', content: '<p>content</p>', left: 0, top: 0, width: 300, height: 50 }], speech: 'previous-speech' });
  } };
}

test('brief retains full sources and normalizes concurrency without an artificial cap', () => {
  assert.equal(normalizeBrief({ requirement: 'x' }).chapterConcurrency, 3);
  // 章节数是天然上限，所以「不限制」不会多开 worker；写死 4 会让长课时被迫串行。
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: 99 }).chapterConcurrency, 99);
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: 8 }).chapterConcurrency, 8);
  // 非法值回默认，不静默按 1 跑。
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: 0 }).chapterConcurrency, 3);
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: -2 }).chapterConcurrency, 3);
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: 'abc' }).chapterConcurrency, 3);
  assert.equal(normalizeBrief({ requirement: 'x', chapterConcurrency: 2.7 }).chapterConcurrency, 2);
  assert.equal(normalizeBrief({ requirement: 'x', chapters }).chapters[0].sourceText, chapters[0].sourceText);
  assert.throws(() => normalizeBrief({ requirement: 'x', chapters: [{ title: 'empty' }] }), /sourceText/);
});

test('both prompt stages retain complete chapter text and knowledge tree', () => {
  const brief = normalizeBrief({ requirement: 'x', sourceText: chapters[0].sourceText, knowledgeTree: chapters[0].knowledgeTree });
  for (const prompt of [buildOutlinePrompt(brief).prompt, buildScenePrompt({ type: 'slide', title: 'x' }, { ...brief, index: 0, total: 1 }).prompt]) {
    assert.ok(prompt.includes(chapters[0].sourceText));
    assert.ok(prompt.includes('TREE0'));
  }
});

test('chapters overlap within bound, scenes remain serial and merge in input order', async () => {
  const f = fixture({ chapterConcurrency: 2 });
  let active = 0, peak = 0;
  const counts = new Map();
  f.llm = model({ onCall: async (request) => {
    const chapter = /CH\d/.exec(request.prompt)?.[0];
    if (request.stage === 'outline') { active++; peak = Math.max(peak, active); await new Promise((resolve) => setImmediate(resolve)); }
    else if (request.stage === 'scene-actions') {
      // actions 段是每个场景的第二次 LLM 调用，不参与「第几个场景」的计数。
      // 它也会带上一页口播（courseContext），但这里只校验场景内容调用。
    }
    else {
      const count = (counts.get(chapter) ?? 0) + 1; counts.set(chapter, count);
      if (count === 2) { assert.ok(request.prompt.includes('previous-speech')); active--; }
      else assert.ok(!request.prompt.includes('previous-speech'));
    }
  } });
  const result = await produceChapters(f);
  assert.equal(peak, 2);
  assert.deepEqual(result.scenes.scenes.map((s) => s.order), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(result.scenes.scenes.map((s) => s.id)).size, 12);
  assert.deepEqual(result.scenes.scenes.map((s) => s.chapterId), chapters.flatMap((c) => [c.id, c.id]));
});

test('failed chapter is explicit, successful chapters checkpoint and retry skips them', async () => {
  const f = fixture({ chapters: chapters.slice(0, 2) });
  let fail = true;
  f.llm = model({ onCall: (r) => { if (fail && r.prompt.includes('CH1')) throw new Error('chapter broken'); } });
  await assert.rejects(produceChapters(f), (error) => error.code === 'E_CHAPTER_FAILED' && error.message.includes('CH1'));
  assert.deepEqual(f.writes, ['chapter-1']);
  fail = false;
  const requests = [];
  f.llm = model({ onCall: (r) => requests.push(r) });
  const result = await produceChapters(f);
  assert.equal(result.scenes.scenes.length, 4);
  assert.ok(requests.every((r) => !r.prompt.includes('FULL0')));
  assert.deepEqual(f.writes, ['chapter-1', 'chapter-2']);
});

test('chapter outputs flow through media and finalization into one ordered classroom', async () => {
  const f = fixture({ chapters: chapters.slice(0, 2) });
  f.record.log = createEventLog();
  let saved;
  f.ports.vault = { classroom: { save: async (stageId, doc) => { saved = doc; return { stageId }; } } };
  await runPipeline({ ...f, llm: model() });
  assert.equal(f.record.status, 'done');
  assert.equal(saved.scenes.length, 4);
  assert.deepEqual(saved.scenes.map(s => s.chapterId), ['c0', 'c0', 'c1', 'c1']);
  assert.equal(new Set(saved.scenes.flatMap(s => s.actions.map(a => a.id))).size, 4);
  assert.deepEqual(f.writes, ['chapter-1', 'chapter-2', 'outline', 'scenes', 'media', 'finalize']);
});

test('abort during model call prevents subsequent chapter checkpoints', async () => {
  const f = fixture();
  f.llm = model({ onCall: () => f.record.controller.abort() });
  await assert.rejects(produceChapters(f), (error) => error.code === 'E_CANCELLED');
  assert.deepEqual(f.writes, []);
});
