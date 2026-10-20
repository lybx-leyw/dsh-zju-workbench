/**
 * 让「做完了」这件事在**所有能勾的地方**都成立。
 *
 * 上一版只给「我的规划」加了勾选框，AI 从中转站拆出的卡片却一个都勾不了 ——
 * 而它们往往是数量最多的那一类。根因不是设计取舍，是覆盖漏了：
 * 那些卡片的完成状态本来就该存在我们自己的 `plans.json` 里。
 *
 * 这里钉两件事：
 *   1. `PlanStore.setCardDone` 的语义（下标定位、取消时清 doneAt、重拆重置）；
 *   2. 路由层的边界（不做编码变换、越界下标要拒、不写回中转站）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PlanStore } from '../packages/dsh-zhiyun-page-planning/src/plans.js';
import { createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

const PREFIX = 'note\u0000标题\u0000abcdef0123456789';

/** 内存版 PlanStore，避免每个用例都碰磁盘。 */
function memoryStore(initial) {
  let saved = initial ?? { plans: {}, runs: [] };
  const store = new PlanStore(
    '/memory/plans.json',
    () => saved,
    (_file, value) => { saved = JSON.parse(JSON.stringify(value)); },
  );
  return store;
}

/**
 * 每次都给**新的一份**卡片。
 *
 * 不能共用一个模块级的数组：`setCardDone` 会就地替换 `cards[i]`，用例之间
 * 会互相污染（这正是 `record()` 里那份拷贝要防的事，测试自己也别踩）。
 */
const cards = () => [
  { title: '交第三章作业', action: '去提交', due: '2026-10-21T15:59:00.000Z', sourceTitle: '原文', tags: [] },
  { title: '概率论小测', action: '复习', due: null, sourceTitle: '原文', tags: [] },
  { title: '写实验报告', action: '整理', due: null, sourceTitle: '原文', tags: [] },
];

/* ──────────────────────────────────────── PlanStore.setCardDone */

test('勾一张卡片：下标定位，写进 cards[i].done 并记 doneAt', () => {
  const store = memoryStore();
  store.record(PREFIX, cards());

  const card = store.setCardDone(PREFIX, 1, true, 1792322000000);
  assert.ok(card, '应返回改后的卡片');
  assert.equal(card.title, '概率论小测', '下标 1 对应第二张');
  assert.equal(card.done, true);
  assert.equal(card.doneAt, 1792322000);

  // 其它卡片不受影响 —— 这是"按下标"最容易写错的地方
  const all = store.get(PREFIX).cards;
  assert.equal(all[0].done, undefined);
  assert.equal(all[2].done, undefined);
});

test('取消完成要清掉 doneAt（否则"做完了吗"有两个答案）', () => {
  const store = memoryStore();
  store.record(PREFIX, cards());
  store.setCardDone(PREFIX, 0, true, 1792322000000);
  const card = store.setCardDone(PREFIX, 0, false, 1792323000000);
  assert.equal(card.done, false);
  assert.equal(card.doneAt, null);
});

test('下标越界 / 前缀不存在 / 非整数都返回 null，不静默造出卡片', () => {
  const store = memoryStore();
  store.record(PREFIX, cards());
  assert.equal(store.setCardDone(PREFIX, 3, true), null, '越界');
  assert.equal(store.setCardDone(PREFIX, -1, true), null, '负数');
  assert.equal(store.setCardDone(PREFIX, 1.5, true), null, '非整数');
  assert.equal(store.setCardDone(PREFIX, 'x', true), null, '不是数字');
  assert.equal(store.setCardDone('不存在的键', 0, true), null);
  // 越界调用之后卡片数量不该变
  assert.equal(store.get(PREFIX).cards.length, 3);
});

test('勾选可以落盘并读回（这是它存在的意义）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-card-done-'));
  const file = path.join(dir, 'plans.json');
  const { writeFileSync, readFileSync } = await import('node:fs');
  try {
    const write = (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8');
    const read = (f) => {
      try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
    };
    const store = new PlanStore(file, read, write);
    store.record(PREFIX, cards());
    store.setCardDone(PREFIX, 2, true);

    const reopened = new PlanStore(file, read, write);
    assert.equal(reopened.get(PREFIX).cards[2].done, true, '完成状态要能跨重启');
    assert.equal(reopened.get(PREFIX).cards[0].done, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('重拆会重置完成状态（新卡片对应的是新的事）', () => {
  const store = memoryStore();
  store.record(PREFIX, cards());
  store.setCardDone(PREFIX, 0, true);
  // 重拆：新的卡片数组
  store.record(PREFIX, [{ title: '新的第一张', action: 'x', due: null, sourceTitle: '原文', tags: [] }]);
  assert.equal(store.get(PREFIX).cards.length, 1);
  assert.equal(store.get(PREFIX).cards[0].done, undefined, '重拆后不该继承旧的勾选');
});

test('record 存的是拷贝：勾一张卡不会改掉调用方手上的那份数组', () => {
  // 这条曾经是真 bug：`record` 直接存调用方的数组引用，而 `setCardDone` 是就地
  // 替换 `cards[i]` —— 于是勾一下就连带改掉了调用方的数据。表现是"上一条用例的
  // 数据被下一条改坏"，在生产上则是同一批卡片被两处持有时行为不可预期。
  const mine = cards();
  const store = memoryStore();
  store.record(PREFIX, mine);

  store.setCardDone(PREFIX, 0, true);
  assert.equal(mine[0].done, undefined, '调用方那份必须原封不动');
  assert.equal(store.get(PREFIX).cards[0].done, true, '库里的那份才该被改');

  // 反向也成立：改调用方那份不该影响库
  mine[1].title = '在外面改的';
  assert.equal(store.get(PREFIX).cards[1].title, '概率论小测');
});

/* ──────────────────────────────────────── 路由 */

function makeHandler({ plan }) {
  return createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({}),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan,
  });
}

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43120', 'x-zhiyun-planning': '1' },
      [Symbol.asyncIterator]: async function* iterator() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body));
      },
    };
    const res = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(chunk) { resolve({ status: this.status, body: JSON.parse(chunk) }); },
    };
    handler(req, res);
  });
}

test('路由能勾卡片，并把结果放进快照', async () => {
  const store = memoryStore();
  store.record(PREFIX, cards());
  const plan = {
    run: async () => ({}),
    list: () => store.all(),
    plannedKeys: () => Object.keys(store.all()),
    forget: () => {},
    setCardDone: (p, i, d) => store.setCardDone(p, i, d),
  };
  const handler = makeHandler({ plan });

  const r = await call(handler, 'POST', '/?plan-card-done', { prefix: PREFIX, index: 0, done: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.card.done, true);
  // 快照里的 plans 要带上新状态，页面据此渲染勾选
  assert.equal(r.body.plans[PREFIX].cards[0].done, true);
});

test('前缀里的 \\u0000 原样传回即可，不做编码变换', async () => {
  // 前缀是 `kind\0标题\0哈希`，JSON 天然能承载 \0；多一层 encode 反而会与
  // plans.json 的键对不上
  const store = memoryStore();
  store.record(PREFIX, cards());
  const plan = {
    run: async () => ({}), list: () => store.all(), plannedKeys: () => [], forget: () => {},
    setCardDone: (p, i, d) => store.setCardDone(p, i, d),
  };
  const r = await call(makeHandler({ plan }), 'POST', '/?plan-card-done', {
    prefix: PREFIX, index: 1, done: true,
  });
  assert.equal(r.status, 200);
  assert.equal(store.get(PREFIX).cards[1].done, true, '原样的键必须能命中');
});

test('缺 prefix / 坏 index / 不存在的卡片各有明确拒绝', async () => {
  const store = memoryStore();
  store.record(PREFIX, cards());
  const plan = {
    run: async () => ({}), list: () => store.all(), plannedKeys: () => [], forget: () => {},
    setCardDone: (p, i, d) => store.setCardDone(p, i, d),
  };
  const handler = makeHandler({ plan });

  let r = await call(handler, 'POST', '/?plan-card-done', { index: 0, done: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /prefix/);

  r = await call(handler, 'POST', '/?plan-card-done', { prefix: PREFIX, index: -1, done: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /index/);

  r = await call(handler, 'POST', '/?plan-card-done', { prefix: PREFIX, index: 99, done: true });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /不存在/);
});

test('没有模型服务时勾卡片仍可用（勾选不需要 AI）', async () => {
  // 这一条是刻意的：勾完成是纯本地写，不该被"没配模型"挡住
  const store = memoryStore();
  store.record(PREFIX, cards());
  const plan = {
    run: async () => ({}), list: () => store.all(), plannedKeys: () => [], forget: () => {},
    setCardDone: (p, i, d) => store.setCardDone(p, i, d),
  };
  const r = await call(makeHandler({ plan }), 'POST', '/?plan-card-done', {
    prefix: PREFIX, index: 2, done: true,
  });
  assert.equal(r.status, 200);
});

test('plan 服务缺席时勾卡片回 400 而不是崩', async () => {
  const r = await call(makeHandler({ plan: undefined }), 'POST', '/?plan-card-done', {
    prefix: PREFIX, index: 0, done: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /未启用/);
});
