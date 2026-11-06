/**
 * AI 自动规划：拆分、校验、以及**映射关系**。
 *
 * 映射是本功能的核心承诺：同一条原文不该被重复拆分。断言分四类：
 *
 *   1. 校验：模型的输出是**不可信输入**，多字段/坏日期/空标题一律拒；
 *   2. 解析：模型爱包 ```json 围栏或加寒暄，剥不开就必须报错而不是凑半个结果；
 *   3. 映射：拆过的条目被记住，默认不再拆；force 才重拆；
 *   4. 归属：卡片要能对回它来自哪条原文，对不上时不能悄悄塞进某一条。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CARD_FIELDS,
  PLAN_BATCH_LIMIT,
  PlanStore,
  normalizeCard,
  parsePlanJson,
  pickPending,
  planTitle,
  readPlanResponse,
  toPlanInput,
} from '../packages/dsh-zhiyun-page-planning/src/plans.js';
import { entryPrefix } from '../packages/dsh-zhiyun-page-planning/src/entries.js';

/** 内存版 PlanStore，避免每个用例都碰磁盘。 */
function memoryStore() {
  let saved = null;
  return new PlanStore(
    '/memory/plans.json',
    () => saved,
    (_file, value) => { saved = JSON.parse(JSON.stringify(value)); },
  );
}

const ENTRY = {
  seq: 1, kind: 'note', title: '下周要交的三件事',
  text: '1. 周三前交第三章作业\n2. 周五概率论小测\n3. 月底前交实验报告',
  tags: [], at: 1792320965,
};

/* ───────────────────────────────────────── 卡片校验（模型输出不可信） */

test('合法卡片被原样接受，due=null 是正常值', () => {
  const card = normalizeCard({
    title: '交第三章作业', action: '去学习页提交', due: null, sourceTitle: '下周要交的三件事', tags: ['作业'],
  });
  assert.deepEqual(card, {
    title: '交第三章作业', action: '去学习页提交', due: null, sourceTitle: '下周要交的三件事', tags: ['作业'],
  });
});

test('多出白名单外的字段 → 拒绝（模型的形状不能随心情变化）', () => {
  for (const extra of ['priority', 'estimate', 'done', 'id']) {
    const card = normalizeCard({ title: 'a', action: 'b', due: null, [extra]: 1 });
    assert.equal(card, null, `${extra} 不在白名单，应拒绝`);
  }
});

test('空标题 / 超长标题 / 空动作 → 拒绝', () => {
  assert.equal(normalizeCard({ title: '', action: 'b' }), null);
  assert.equal(normalizeCard({ title: '   ', action: 'b' }), null);
  assert.equal(normalizeCard({ title: 'x'.repeat(81), action: 'b' }), null);
  assert.equal(normalizeCard({ title: 'a', action: '' }), null);
  assert.equal(normalizeCard({ title: 'a', action: 'x'.repeat(401) }), null);
});

test('due 给了就必须可解析；非法日期拒绝而不是猜', () => {
  assert.equal(normalizeCard({ title: 'a', action: 'b', due: '不是日期' }), null);
  assert.equal(normalizeCard({ title: 'a', action: 'b', due: 12345 }), null);
  const ok = normalizeCard({ title: 'a', action: 'b', due: '2026-10-20T23:59:59+08:00' });
  assert.ok(ok.due, '合法 ISO 时间应被规范化保留');
  assert.equal(Number.isNaN(Date.parse(ok.due)), false);
});

test('tags 超 3 个时截断而不是整卡丢弃', () => {
  const card = normalizeCard({ title: 'a', action: 'b', tags: ['1', '2', '3', '4', '5'] });
  assert.deepEqual(card.tags, ['1', '2', '3']);
});

test('字段白名单是显式导出的常量（页面与测试共用同一份）', () => {
  assert.deepEqual([...CARD_FIELDS].sort(), ['action', 'due', 'sourceTitle', 'tags', 'title']);
});

/* ───────────────────────────────────────── 解析（剥围栏但不猜） */

test('纯 JSON 直接解析', () => {
  assert.deepEqual(parsePlanJson('{"cards":[]}'), { cards: [] });
});

test('剥掉 ```json 围栏', () => {
  assert.deepEqual(parsePlanJson('```json\n{"cards":[]}\n```'), { cards: [] });
  assert.deepEqual(parsePlanJson('```\n{"cards":[]}\n```'), { cards: [] });
});

test('前后多一句寒暄时取首尾花括号之间的内容', () => {
  assert.deepEqual(
    parsePlanJson('好的，这是结果：\n{"cards":[]}\n希望有帮助。'),
    { cards: [] },
  );
});

test('截断的 JSON → 报 BAD_JSON，不凑半个结果', () => {
  // 这一条很重要：把截断回包解析成"半份卡片"比直接失败更难发现
  assert.throws(() => parsePlanJson('{"cards":[{"title":"a"'), (error) => {
    assert.equal(error.code, 'BAD_JSON');
    return true;
  });
});

test('空响应 / 非对象 → 报错', () => {
  assert.throws(() => parsePlanJson(''), (e) => e.code === 'EMPTY_RESPONSE');
  assert.throws(() => parsePlanJson('[1,2,3]'), (e) => e.code === 'BAD_JSON');
});

test('整份读取：坏卡丢弃但报出丢了几张', () => {
  const raw = JSON.stringify({
    cards: [
      { title: '好的', action: '做', due: null, sourceTitle: 'x', tags: [] },
      { title: '坏的', action: '做', due: 'not-a-date', sourceTitle: 'x' },
      { title: '', action: '做' },
    ],
  });
  const { cards, dropped } = readPlanResponse(raw);
  assert.equal(cards.length, 1);
  assert.equal(dropped, 2, '要如实报出丢弃数，不能静默');
});

test('一张可用卡片都没有 → NO_CARDS（不是静默成功）', () => {
  assert.throws(
    () => readPlanResponse(JSON.stringify({ cards: [{ title: '' }] })),
    (e) => e.code === 'NO_CARDS',
  );
  assert.throws(() => readPlanResponse('{"cards":"nope"}'), (e) => e.code === 'BAD_SHAPE');
});

/* ───────────────────────────────────────── 送模型的输入 */

test('送模型的输入只保留必要字段，超长正文截断并标注', () => {
  const [row] = toPlanInput([{ ...ENTRY, text: 'x'.repeat(5000) }]);
  assert.deepEqual(Object.keys(row).sort(), ['at', 'kind', 'text', 'title']);
  assert.ok(row.text.endsWith('（原文过长，已截断）'), '要让模型知道内容不全');
  assert.ok(row.text.length < 5000);
});

test('标题截断只有一个落点：送到模型的标题 = 回包归属用的标题', () => {
  // 早先 `toPlanInput` 截到 80 字，而宿主 `byTitle` 用完整标题做键 ——
  // 长标题条目上模型照抄截断标题，查不到，整批卡片被算成 orphan 静默丢弃。
  const longTitle = '第'.repeat(120) + '三章作业';
  const entry = { ...ENTRY, title: longTitle };
  const [row] = toPlanInput([entry]);
  assert.equal(row.title.length, 80, '送模型的标题被截到 80');
  // 回包归属必须用同一个函数取标题
  assert.equal(planTitle(entry), row.title, 'planTitle 必须与 toPlanInput 给出同一个标题');
  // 短标题不受影响
  assert.equal(planTitle(ENTRY), ENTRY.title);
  // 兜底：没有 title 的条目不抛错
  assert.equal(planTitle({}), '');
  assert.equal(planTitle(null), '');
});

/* ───────────────────────────────────────── 映射关系（核心） */

test('拆过就记住：同一条不再进待拆队列', () => {
  const store = memoryStore();
  const entries = [ENTRY];
  assert.equal(pickPending(entries, store).length, 1, '第一次应该要拆');

  store.record(entryPrefix(ENTRY), [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  assert.equal(pickPending(entries, store).length, 0, '拆过之后默认不再拆');
});

test('force 才重新拆', () => {
  const store = memoryStore();
  store.record(entryPrefix(ENTRY), [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  assert.equal(pickPending([ENTRY], store, { force: true }).length, 1);
});

test('映射按内容前缀稳定：中转站重建（seq 变了）仍认得出来', () => {
  const store = memoryStore();
  const renamed = { ...ENTRY, seq: 99 }; // seq 变，内容没变
  store.record(entryPrefix(ENTRY), [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  assert.equal(pickPending([renamed], store).length, 0, 'seq 变化不该导致重拆');
});

test('内容变了就是新的一条（要重拆）', () => {
  const store = memoryStore();
  const edited = { ...ENTRY, title: '完全不同的另一条' };
  store.record(entryPrefix(ENTRY), [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  assert.equal(pickPending([edited], store).length, 1);
});

test('新条目优先：队列按 at 倒序，且不超过批量上限', () => {
  const store = memoryStore();
  const many = Array.from({ length: PLAN_BATCH_LIMIT + 5 }, (_, i) => ({
    seq: i, kind: 'note', title: `第${i}条`, text: 'x', at: 1000 + i,
  }));
  const picked = pickPending(many, store);
  assert.equal(picked.length, PLAN_BATCH_LIMIT);
  assert.equal(picked[0].title, `第${many.length - 1}条`, '最新的排最前');
});

test('忘掉一条后它重新进队列', () => {
  const store = memoryStore();
  const prefix = entryPrefix(ENTRY);
  store.record(prefix, [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  assert.equal(pickPending([ENTRY], store).length, 0);
  store.forget(prefix);
  assert.equal(pickPending([ENTRY], store).length, 1);
});

/* ───────────────────────────────────────── 持久化 */

test('PlanStore 落盘后可读回，映射不丢', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-store-'));
  const file = path.join(dir, 'plans.json');
  try {
    const { writeFileSync, readFileSync } = await import('node:fs');
    const write = (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8');
    const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

    const store = new PlanStore(file, read, write);
    const prefix = entryPrefix(ENTRY);
    store.record(prefix, [{ title: 'a', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }], { model: 'm1' });

    const reopened = new PlanStore(file, read, write);
    assert.ok(reopened.has(prefix), '重新打开后映射还在');
    assert.equal(reopened.get(prefix).cards.length, 1);
    assert.equal(reopened.get(prefix).model, 'm1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('重拆同一条会覆盖旧结果（不需要攒历史版本）', () => {
  const store = memoryStore();
  const prefix = entryPrefix(ENTRY);
  store.record(prefix, [{ title: '旧', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] }]);
  store.record(prefix, [
    { title: '新1', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] },
    { title: '新2', action: 'b', due: null, sourceTitle: ENTRY.title, tags: [] },
  ]);
  assert.equal(store.get(prefix).cards.length, 2);
  assert.equal(store.get(prefix).cards[0].title, '新1');
  assert.equal(store.recentRuns().length, 2, '但活动记录保留两次');
});

test('坏文件不让插件崩：退回空映射', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-bad-'));
  const file = path.join(dir, 'plans.json');
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, 'not json', 'utf8');
    const store = new PlanStore(file, (f) => {
      try { return JSON.parse(require('node:fs').readFileSync(f, 'utf8')); } catch { return null; }
    }, () => {});
    assert.deepEqual(store.all(), {});
    assert.equal(store.has('x'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('活动记录只留最近 20 次', () => {
  const store = memoryStore();
  for (let i = 0; i < 25; i += 1) {
    store.record(`p${i}`, [{ title: 'a', action: 'b', due: null, sourceTitle: '', tags: [] }]);
  }
  assert.equal(store.recentRuns().length, 20);
});
