import test from 'node:test';
import assert from 'node:assert/strict';
import { briefFromLecture, sourceFromLecture, pagesFromScenes } from '../packages/core/study/src/ai-teaching-generate.js';

test('teaching sends full finalized chapters and matches knowledge branches by title', () => {
  const tail = '正文末尾不得丢失';
  const lecture = { chapters: [
    { title: '甲章', topics: [{ title: '甲知识点', blocks: [{ text: '前文'.repeat(9000) + tail }] }] },
    { title: '乙章', topics: [{ title: '乙知识点', blocks: [{ paragraphs: ['乙正文', '乙结论'] }] }] },
  ] };
  const tree = { kind: 'title', title: '根', children: [
    { kind: 'title', title: '乙章', children: [] },
    { kind: 'title', title: '甲章', children: [] },
  ] };
  const brief = briefFromLecture(lecture, tree);
  assert.equal(brief.chapterConcurrency, 3);
  assert.equal(brief.chapters.length, 2);
  assert.ok(brief.sourceText.includes(tail));
  assert.ok(brief.chapters[0].sourceText.includes(tail));
  assert.equal(brief.chapters[0].knowledgeTree.title, '甲章');
  assert.equal(brief.chapters[1].knowledgeTree.title, '乙章');
  assert.ok(brief.chapters[1].sourceText.includes('乙正文乙结论'));
  assert.equal(brief.knowledgeTree, tree);
  assert.notEqual(brief.chapters[0].id, brief.chapters[1].id);
});

test('missing tree falls back to finalized topic slots without unrelated source text', () => {
  const brief = briefFromLecture({ chapters: [{ title: '终稿章', topics: [{ title: '终稿点', blocks: ['讲义正文'] }] }] },
    { chapters: [{ title: '无关章', topics: [{ title: '无关正文' }] }] });
  assert.equal(brief.chapters[0].knowledgeTree.title, '终稿章');
  assert.equal(brief.chapters[0].knowledgeTree.topics[0].title, '终稿点');
  assert.ok(sourceFromLecture({ chapters: [] }) === '');
});

test('slide outputs retain canvas and merge narration only', () => {
  const canvas = { elements: [] };
  assert.deepEqual(pagesFromScenes([{ id: 's1', title: '页', content: { type: 'slide', canvas }, actions: [
    { type: 'speech', text: '讲解' }, { type: 'other', text: '不口播' },
  ] }]), [{ id: 's1', title: '页', canvas, speech: '讲解', points: [] }]);
});
