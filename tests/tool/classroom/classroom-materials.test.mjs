import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATION_VERSION } from '../../../packages/core/lecture/src/generate.js';
import { materialEntries, catalogEntry, searchEntries } from '../../../packages/tool/classroom/src/classroom-materials.js';

const fixture = () => ({
  accountId: 'fictional-account', localPath: '/home/example/private.json',
  lecture: { generationVersion: GENERATION_VERSION, chapters: [{ title: '虚构章节', topics: [
    { title: 'Alpha 定义', fromPage: 2, toPage: 4, anchor: { page: 2, tSec: 15 }, sourceBlockIndexes: [0, 1],
      passages: [{ label: '讲解', text: '完整段落，不得被摘要替代。' }],
      blocks: [{ kind: { label: '例题' }, text: 'Beta a+b [x] 例题', solution: { steps: ['第一步', '第二步'] } }] },
    { title: '另一个主题', passages: [{ text: 'Alpha Beta 补充' }], blocks: [] },
  ] }] },
  blocks: [{ index: 7, page: 2, startMs: 15000, endMs: 19000, text: '原始完整证据', tag: { role: '主线' } },
    { page: 4, startMs: 20000, endMs: 22000, title: '虚构支线', text: '支线原文', tag: { role: '支线' } }],
});

test('complete topic structures, branches and original blocks have stable positional ids', () => {
  const record = fixture(), before = JSON.stringify(record);
  const entries = materialEntries(record);
  assert.deepEqual(entries.map(entry => entry.id), ['lecture:0:0', 'lecture:0:1', 'source:0', 'branch:1', 'source:1']);
  assert.deepEqual(entries[0].content, record.lecture.chapters[0].topics[0]);
  assert.deepEqual(entries[0].source, { fromPage: 2, toPage: 4, anchor: { page: 2, tSec: 15 }, sourceBlockIndexes: [0, 1] });
  assert.deepEqual(entries[2].source, { page: 2, startMs: 15000, endMs: 19000, sourceBlockIndexes: [7] });
  assert.deepEqual(entries[3].content, record.blocks[1]);
  entries[0].content.blocks[0].solution.steps.push('修改副本');
  assert.equal(JSON.stringify(record), before);
});

test('only current generation is exposed, never history or stale lectures', () => {
  for (const version of [undefined, 'old-generation']) {
    const record = fixture();
    record.lecture.generationVersion = version;
    record.lectureHistory = [fixture().lecture];
    assert.equal(materialEntries(record).filter(entry => entry.kind === 'lecture').length, 0);
  }
  assert.deepEqual(materialEntries(null), []);
  assert.deepEqual(materialEntries({}), []);
});

test('catalog strips bodies and private metadata while retaining provenance and routing ids', () => {
  const entry = { ...materialEntries(fixture())[0], accountId: 'fictional-account', localPath: '/tmp/example', courseId: 'fiction-course', subId: 'fiction-section' };
  const catalog = catalogEntry(entry);
  assert.deepEqual(Object.keys(catalog), ['id', 'kind', 'title', 'path', 'source', 'courseId', 'subId']);
  assert.deepEqual(catalog.source, entry.source);
  assert.ok(!JSON.stringify(catalog).includes('完整段落'));
});

test('search is literal, case insensitive AND matching with stable ranks and bounded snippets', () => {
  const entries = materialEntries(fixture());
  const matches = searchEntries(entries, '  ALPHA\n beta\t');
  assert.deepEqual(matches.map(entry => entry.id), ['lecture:0:0', 'lecture:0:1']);
  assert.ok(matches[0].rank > matches[1].rank);
  assert.equal(searchEntries(entries, 'a+b [x]')[0].id, 'lecture:0:0');
  assert.deepEqual(searchEntries(entries, '.*'), []);
  assert.deepEqual(searchEntries(entries, 'Alpha absent'), []);
  assert.deepEqual(searchEntries(entries, '  '), []);
  const long = { ...entries[0], content: { text: '前'.repeat(1000) + 'needle' + '后'.repeat(1000) } };
  const [match] = searchEntries([long], 'needle');
  assert.ok(match.snippet.includes('needle'));
  assert.ok(match.snippet.length <= 238);
  assert.ok(!('content' in match));
});

test('nested storage metadata and local paths cannot leak into material or search', () => {
  const record = fixture();
  Object.assign(record.blocks[0], { accountId: 'fictional-account', filePath: '/home/example/secret',
    nested: { accountId: 'fictional-account', localPath: 'Z:\\fictional\\example.txt' },
    text: '引用 file:///tmp/example.txt 和 /home/example/secret 仍保留其他正文' });
  const entries = materialEntries(record);
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes('fictional-account'));
  assert.ok(!serialized.includes('/home/example'));
  assert.ok(!serialized.includes('example.txt'));
  assert.equal(searchEntries(entries, 'secret').length, 0);
  assert.ok(serialized.includes('仍保留其他正文'));
});
