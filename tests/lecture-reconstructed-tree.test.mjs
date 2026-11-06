import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLectureTree } from '../packages/dsh-zhiyun-core-lecture/src/tree.js';
import { createLectureAssembler } from '../packages/dsh-zhiyun-core-lecture/src/polish.js';

const tree = () => ({ kind: 'title', title: '静电学', children: [
  { kind: 'title', title: '电容', children: [
    { kind: 'title', title: '分片一', children: [{ kind: 'leaf', id: 'n1', blocks: [
      { index: 7, page: 2, text: '第一片内容。', tag: { summary: '电容定义' } },
    ] }] },
    { kind: 'title', title: '分片二', children: [{ kind: 'leaf', id: 'n2', blocks: [
      { index: 7, page: 2, text: '第二片内容。', tag: { summary: '电容计算' } },
    ] }] },
  ] },
] });

test('重构树投影保留分片正文和原始来源，不按重复的块号回填整块', () => {
  const normalized = normalizeLectureTree(tree());
  const topics = normalized.chapters.flatMap(c => c.topics);
  assert.equal(topics.length, 2);
  assert.deepEqual(topics.map(t => t.sourceBlocks[0].text), ['第一片内容。', '第二片内容。']);
  assert.deepEqual(topics.map(t => t.blockIndexes), [[7], [7]]);
});

test('真实装配接口接受重构树，模型失败时仅保留各自分片，不重复整块', async () => {
  const assembler = createLectureAssembler({ llm: { call: async () => { throw new Error('offline'); } } });
  try {
    const out = await assembler.assemble({ tree: tree(), blocks: [{ index: 7, text: '整块内容不应被重复。' }] });
    assert.deepEqual(out.chapters.flatMap(c => c.topics.map(t => t.draft)), ['第一片内容。', '第二片内容。']);
  } finally { assembler.dispose(); }
});

test('merge已正式组织的正文不因沿用原文而被误报为口述草稿', async () => {
  const text = '电容定义为导体所带电荷量与其电势的比值，单位为法拉。';
  const root = { kind: 'title', title: '电容', children: [{ kind: 'leaf', id: 'n1', blocks: [
    { index: 1, page: 1, text, register: 'written', tag: { summary: '电容定义' } },
  ] }] };
  const assembler = createLectureAssembler({ llm: { call: async () => ({ text: JSON.stringify({ c: 1, t: 1, slots: [{ kind: 'elaboration', text }] }) }) } });
  try {
    const out = await assembler.assemble({ tree: root });
    assert.equal(out.chapters[0].topics[0].register, 'written');
    assert.ok(!out.failures.some(f => f.includes('与口述相同')));
  } finally { assembler.dispose(); }
});
