import test from 'node:test';
import assert from 'node:assert/strict';
import { briefFromLecture, pagesFromHtmlChapters, pollGeneration, runGeneration } from '../packages/dsh-zhiyun-core-study/src/ai-teaching-generate.js';

const htmlChapters = [{ chapterId: 'c1', title: '导数', html: '<!doctype html><html><body>图解导数</body></html>', analysis: { obstacles: [] }, storyboard: { scenes: [] } }];
test('study selects HTML-first and preserves complete chapter source', () => {
  const source = '终稿全部内容'.repeat(4000);
  const brief = briefFromLecture({ chapters: [{ title: '导数', topics: [{ title: '直觉', blocks: [{ text: source }] }] }] });
  assert.equal(brief.outputFormat, 'html');
  assert.equal(brief.chapterConcurrency, 3);
  assert.ok(brief.chapters[0].sourceText.includes(source));
  assert.equal(brief.interactive, false);
  assert.equal(brief.assess, false);
});
test('HTML chapters become chapter documents, not fake slide canvases', () => {
  const pages = pagesFromHtmlChapters(htmlChapters);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].html, htmlChapters[0].html);
  assert.equal(pages[0].canvas, undefined);
  assert.equal(pages[0].title, '导数');
});
test('poll returns complete HTML chapters and rejects empty success', async () => {
  const generate = { get: () => ({ status: 'done', outputFormat: 'html', htmlChapters }) };
  const result = await pollGeneration({ generate, runId: 'r' });
  assert.equal(result.pages[0].html, htmlChapters[0].html);
  await assert.rejects(pollGeneration({ generate: { get: () => ({ status: 'done', outputFormat: 'html', htmlChapters: [] }) }, runId: 'r' }), error => error.code === 'EMPTY');
});
test('stream consumer returns HTML with no scene requirement', async () => {
  const generate = { start: () => ({ runId: 'r' }), async *stream() { yield { kind: 'run-done', payload: { format: 'html' } }; }, get: () => ({ status: 'done', outputFormat: 'html', htmlChapters }) };
  const result = await runGeneration({ generate, brief: { requirement: 'x', outputFormat: 'html' } });
  assert.equal(result.pages[0].html, htmlChapters[0].html);
});
test('progress retains chapter counters and learning-oriented phase', async () => {
  const result = await pollGeneration({ generate: { get: () => ({ status: 'running', outputFormat: 'html', chapterTotal: 3, chaptersDone: 1, phase: 'html-storyboard' }) }, runId: 'r' });
  assert.equal(result.chapterTotal, 3);
  assert.equal(result.chaptersDone, 1);
  assert.equal(result.phase, 'html-storyboard');
});
