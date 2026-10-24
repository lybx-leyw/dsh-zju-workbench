import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonObject, parseTags } from '../packages/dsh-zhiyun-core-parser/src/core.js';
import { assembleMixPage, markingRetryHint } from '../packages/dsh-zhiyun-core-parser/src/mix.js';
import { runMixUnit } from '../packages/dsh-zhiyun-core-parser/src/mix-unit.js';

const vocab = [{ name: '概念' }, { name: '公式' }];
const lines = [
  { startMs: 0, endMs: 1, text: '第一句。' },
  { startMs: 1, endMs: 2, text: '第二句。' },
  { startMs: 2, endMs: 3, text: '第三句。' },
];
const tag = (index, summary) => ({ index, role: '主线', facets: ['概念'], summary });

function page(raw) {
  return assembleMixPage(lines, 1, raw, vocab);
}
function card(tags, blocks = ['块 1-2', '块 3-3']) {
  return `## 逐块标注\n${blocks.join('\n')}\n## 块标记\n${JSON.stringify({ tags })}`;
}

test('公式反斜杠不会让整张块标记解析失败', () => {
  const raw = '{"tags":[{"index":1,"role":"主线","facets":["公式"],"summary":"场强 $\\sigma$ 与 $\\varepsilon_0$"}]}';
  assert.throws(() => JSON.parse(raw));
  const parsed = parseJsonObject(raw);
  assert.equal(parsed.tags[0].summary.includes('\\sigma'), true);
  assert.equal(parseTags(raw).tags[0].summary.includes('\\sigma'), true);
  assert.equal(parseJsonObject('{"a":"line\\nnext\\\\path"}').a, 'line\nnext\\path');
  assert.equal(parseJsonObject('{"a":"\\u03c3"}').a, 'σ');
});

test('每一块都有标记时，多出来的标记不把整页判失败', () => {
  const parsed = page(card([tag(1, '前两句'), tag(2, '第三句'), tag(3, '重复概述')]));
  assert.equal(parsed.coverage.ok, true);
  assert.equal(parsed.marking.ok, true);
  assert.deepEqual(parsed.marking.extra, [3]);
  assert.equal(parsed.drafts[0].tag.summary, '前两句');
  assert.equal(parsed.drafts[1].tag.summary, '第三句');
  assert.equal(markingRetryHint(parsed, lines.length), '');
});

test('标记比块少时不按序号硬套，并要求改成原子记录', () => {
  const parsed = page(card([tag(1, '只标了第一块')]));
  assert.equal(parsed.coverage.ok, true);
  assert.equal(parsed.marking.ok, false);
  assert.deepEqual(parsed.marking.missing, [2]);
  const hint = markingRetryHint(parsed, lines.length);
  assert.match(hint, /缺少|没有唯一/);
  assert.match(hint, /from、to/);
  assert.match(hint, /块 2：第 3–3 句/);
});

test('原子记录乱序仍然拒绝', () => {
  const tags = [
    { index: 1, from: 1, to: 1, role: '主线', facets: ['概念'], summary: '甲' },
    { index: 2, from: 2, to: 3, role: '主线', facets: ['概念'], summary: '乙' },
  ];
  const raw = tags => `## 块标记\n${JSON.stringify({ tags })}`;
  assert.equal(page(raw(tags)).marking.ok, true);
  assert.equal(page(raw([...tags].reverse())).marking.ok, false);
});

test('标记条数不足时下一次请求改要原子记录，对上的页不再重打', async () => {
  const calls = [];
  const llm = { async call({ variable }) {
    calls.push(variable);
    if (calls.length === 1) return { text: card([tag(1, '只标了第一块')]) };
    return { text: `## 逐块标注\n## 块标记\n${JSON.stringify({ tags: [
      { index: 1, from: 1, to: 2, role: '主线', facets: ['概念'], summary: '前两句' },
      { index: 2, from: 3, to: 3, role: '主线', facets: ['概念'], summary: '第三句' },
    ] })}` };
  } };
  const cache = { key() { return 'k'; }, async get() { return null; }, async put() {} };
  const limiter = { async run(task) { return task(); } };
  const out = await runMixUnit({ lines, page: 1, unitId: 'page:1', parts: { constant: 'c', variable: 'v' },
    route: 'r', llm, cache, limiter, vocabulary: vocab, events: [] });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /from、to/);
  assert.equal(out.failure, null);
  assert.equal(out.marking.ok, true);
  assert.equal(out.sentences.every(s => s.cleanStatus === 'reviewed'), true);
});
