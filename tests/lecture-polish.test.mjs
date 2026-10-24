/**
 * 习坎·全文润色（无损规整）的契约测试。
 *
 * 这一层替代了旧的「无曰终审」：不再交给谁自由发挥，而是**只改写法、不改事实**。
 * 所以这里钉住的是四件事：
 *   ① 提示词把"润色"限定成六件可验收的规整，且明写不许新增内容
 *   ② 一个字没改 → `unchanged: true`（跑过但没改 ≠ 没跑）
 *   ③ 合回失败（格式被改坏）→ 抛 FORMAT，**不留半份**
 *   ④ 改动清单能如实报出"哪几行是新的"
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  kLecturePolishSystemPrompt, kPolishItems, POLISH_ITEM_NAMES,
  buildPolishVariable, describePolishChanges, createLectureAssembler,
} from '../packages/dsh-zhiyun-core-lecture/src/polish.js';
import { exportReorganization, mergeReorganization } from '../packages/dsh-zhiyun-core-lecture/src/agent-text.js';

/** 一份最小的讲义 + 记录（够 export/merge 走通）。 */
const lecture = () => ({ title: '完整课堂', chapters: [{ no: 1, title: '概率', topics: [
  { no: 1, title: '独立性', fromPage: 2, toPage: 4, sourceBlockIndexes: [3, 5],
    anchor: { page: 2, tSec: 120 }, passages: [{ text: '独立性的定义正文', label: '讲解' }], register: 'written',
    blocks: [{ kind: { wire: 'explanation', label: '讲解' }, title: '', text: '独立性的定义正文',
      sourceBlockIndexes: [3, 5], sourceUnitRefs: ['c1t1b1'] }] },
] }] });
const record = () => ({ blocks: [
  { index: 3, page: 2, tag: { role: '主线', summary: '独立性' }, sentences: [{ text: '独立性', startMs: 1000 }] },
  { index: 5, page: 4, tag: { role: '主线', summary: '独立性判断' }, sentences: [{ startMs: 4000 }] },
], outline: [] });

/** 假 llm：只回一个固定文本，并记录请求。 */
const stub = (respond) => {
  const requests = [];
  return {
    requests,
    llm: { async call(request) { requests.push(request); return { text: respond(request), usage: { total: 1 } }; } },
  };
};

test('① 提示词：六件事都是"规整"，且明写不许新增内容', () => {
  assert.equal(kPolishItems.length, 6);
  assert.deepEqual(POLISH_ITEM_NAMES, ['术语统一', '编号连续', '符号统一', '交叉引用可解析', '依附内容复位', '事实校验']);
  // 六件事的 why/how 都要有 —— 它们是 UI 上"为什么必须有这一步"的依据。
  for (const item of kPolishItems) {
    assert.ok(item.why.length > 8, `${item.name} 缺 why`);
    assert.ok(item.how.length > 8, `${item.name} 缺 how`);
  }
  // 提示词必须点明"只改写法、不改事实"与"不加原文没有的论断"。
  assert.match(kLecturePolishSystemPrompt, /只改写法，不改事实/);
  assert.match(kLecturePolishSystemPrompt, /任何原文没有的论断一律不加/);
  // 格式契约必须写在提示词里（否则模型会把锚点行改掉，合回必然失败）。
  assert.match(kLecturePolishSystemPrompt, /格式契约/);
  assert.match(kLecturePolishSystemPrompt, /#!` 开头的行/);
  assert.match(kLecturePolishSystemPrompt, />>> BLOCK/);
});

test('② 变量段把待润色全文原样带进请求，不做截断或改写', () => {
  const text = '#!section abc 讲义\n##!topic 1 1 | 独立性 | 章=概率\n>>> BLOCK 讲解 | | ref=c1t1b1 | src=3\n独立性的定义正文';
  const variable = buildPolishVariable(text);
  assert.ok(variable.includes(text));
  assert.match(variable, /待润色的讲义全文/);
});

test('③ 一个字没改 → unchanged:true，且不调合回', async () => {
  const l = lecture();
  const text = exportReorganization(l, 'sec1', record());
  const { llm, requests } = stub(() => text);      // 原样返回
  const assembler = createLectureAssembler({ llm });
  try {
    let merged = false;
    const out = await assembler.polish({ lecture: l, text, merge: () => { merged = true; return {}; } });
    assert.equal(out.unchanged, true);
    assert.deepEqual(out.changes, []);
    assert.equal(merged, false, '没改就不该合回');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].stage, 'lecture-polish');
  } finally { assembler.dispose(); }
});

test('④ 改了 → 合回并按行报出改动；合回失败则抛 FORMAT 不留半份', async () => {
  const l = lecture();
  const text = exportReorganization(l, 'sec1', record());
  const polished = text.replace('独立性的定义正文', '独立性的定义：两事件互不影响。');

  {
    const { llm } = stub(() => polished);
    const assembler = createLectureAssembler({ llm });
    try {
      const out = await assembler.polish({ lecture: l, text, merge: (t) => mergeReorganization(l, t, record(), 'sec1') });
      assert.equal(out.unchanged, false);
      assert.ok(out.changes.some((c) => c.text.includes('两事件互不影响')), JSON.stringify(out.changes));
      assert.ok(out.coverage.unitsBefore > 0 && out.coverage.sourcesCovered === out.coverage.sourcesBefore);
    } finally { assembler.dispose(); }
  }
  {
    // 把锚点行改坏 → merge 抛 FORMAT
    const { llm } = stub(() => polished.replace('##!topic', '图topic'));
    const assembler = createLectureAssembler({ llm });
    try {
      await assert.rejects(
        assembler.polish({ lecture: l, text, merge: (t) => mergeReorganization(l, t, record(), 'sec1') }),
        { code: 'FORMAT' },
      );
    } finally { assembler.dispose(); }
  }
});

test('⑤ 输入残缺一律 INPUT（空文本 / 没有讲义 / 没有合回函数）', async () => {
  const { llm } = stub(() => 'x');
  const assembler = createLectureAssembler({ llm });
  try {
    await assert.rejects(assembler.polish({ lecture: null, text: 'x', merge: () => ({}) }), { code: 'INPUT' });
    await assert.rejects(assembler.polish({ lecture: lecture(), text: '   ', merge: () => ({}) }), { code: 'INPUT' });
    await assert.rejects(assembler.polish({ lecture: lecture(), text: 'x' }), { code: 'INPUT' });
  } finally { assembler.dispose(); }
});

test('⑥ 取消 → CANCELLED，不当成"没改动"', async () => {
  const l = lecture(), text = exportReorganization(l, 'sec1', record());
  const controller = new AbortController();
  const { llm } = stub(() => { controller.abort(); return text; });
  const assembler = createLectureAssembler({ llm });
  try {
    await assert.rejects(
      assembler.polish({ lecture: l, text, signal: controller.signal, merge: () => ({}) }),
      { code: 'CANCELLED' },
    );
  } finally { assembler.dispose(); }
});

test('⑦ 改动清单只收正文行，不把协议行算成改动', () => {
  const before = '#!section s 课\n##!topic 1 1 | 标题 | 章=章\n>>> BLOCK 讲解 | | ref=c1t1b1 | src=3\n甲。';
  const after = '#!section s 课\n##!topic 1 1 | 标题 | 章=章\n>>> BLOCK 讲解 | | ref=c1t1b1 | src=3\n乙。';
  const changes = describePolishChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].text, '乙。');
  // 只动协议行时不算"改了正文"
  assert.deepEqual(describePolishChanges(before, before.replace('#!section s 课', '#!section s 课程')), []);
});
