/**
 * 去重键换口径时的**迁移**守卫。
 *
 * 背景：键从「`kind\0title\0text` 截前 40 字」改成「整份内容的 sha256 指纹」，
 * 因为旧口径在标题超过 40 字时会把正文完全挤出键外 —— 两条不同日记算出同一个键，
 * 第二条被静默丢弃、不落盘。
 *
 * 修好键本身不难，难的是**升级既有安装**：老文件里存的是旧键。不迁移会有两个后果，
 * 都是用户能立刻感觉到的：
 *
 *   1. 下次同步时同一批内容算出新键、与文件里的旧键对不上 → **整份内容再存一遍**；
 *   2. `plans.json` 的映射键也是旧值 → **所有条目被重新拆一遍**（AI 调用，真花钱）。
 *
 * 所以这里钉的不是"键怎么算"，而是"老数据能不能平滑过渡"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LocalStore, entryPrefix, legacyEntryPrefix,
} from '../packages/dsh-zhiyun-page-planning/src/index.js';
import { PlanStore, pickPending } from '../packages/dsh-zhiyun-page-planning/src/plans.js';

/** 造一个内存版 PlanStore（迁移只看键，不必真落盘到别处）。 */
function memoryStore(initial) {
  let saved = initial ?? null;
  return new PlanStore(
    '/memory/plans.json',
    () => saved,
    (_file, value) => { saved = JSON.parse(JSON.stringify(value)); },
  );
}

/** 写一份"旧版"的 entries.json：prefix 用旧口径算。 */
function legacyEntries(rows) {
  return {
    entries: rows.map((row) => ({
      ...row,
      prefix: legacyEntryPrefix(row),
      cachedAt: 1792320965,
    })),
  };
}

const OLD_ROWS = [
  { seq: 1, kind: 'note', title: '本周计划', text: '写代码、交作业', tags: ['plan'], at: 1792320965 },
  { seq: 2, kind: 'diary', title: '钉钉日报 2026-10-18', text: '今天开了两个会', tags: [], at: 1792322504 },
];

test('升级时把旧 prefix 就地换成新键，keyMapping 记下旧→新', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  const file = path.join(dir, 'entries.json');
  try {
    await writeFile(file, JSON.stringify(legacyEntries(OLD_ROWS)), 'utf8');

    const store = new LocalStore(file);
    assert.equal(store.list().length, 2, '条目数不该变');
    for (const row of store.list()) {
      // 迁移后每个 prefix 都必须等于「用当前内容重新算」的结果
      assert.equal(row.prefix, entryPrefix(row), `prefix 未迁移：${row.title}`);
    }
    assert.equal(Object.keys(store.keyMapping).length, 2, '两条旧键都要记进映射');
    for (const row of store.list()) {
      assert.ok(store.keyMapping[legacyEntryPrefix(row)] === row.prefix, '映射必须指向该条的新键');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('迁移后重新同步同一批内容：不新增、不重复落盘', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  const file = path.join(dir, 'entries.json');
  try {
    await writeFile(file, JSON.stringify(legacyEntries(OLD_ROWS)), 'utf8');
    const store = new LocalStore(file);
    const before = await readFile(file, 'utf8');

    // 中转站原样再给一遍（带 seq / at，没有 prefix —— 那是我们自己的字段）
    const incoming = OLD_ROWS.map(({ seq, kind, title, text, tags, at }) => ({ seq, kind, title, text, tags, at }));
    const { added } = store.absorb(incoming);

    assert.equal(added.length, 0, '迁移过的内容不该被当成"新增"');
    assert.equal(store.list().length, 2, '本地不该出现重复条目');
    assert.equal(await readFile(file, 'utf8'), before, '没有新增时不该改写文件');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('迁移幂等：第二次加载不重写文件、不产生新映射', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  const file = path.join(dir, 'entries.json');
  try {
    await writeFile(file, JSON.stringify(legacyEntries(OLD_ROWS)), 'utf8');
    new LocalStore(file); // 第一次：迁移并落盘
    const afterFirst = await readFile(file, 'utf8');

    const second = new LocalStore(file);
    assert.deepEqual(second.keyMapping, {}, '已经迁移过的文件不该再产生映射');
    assert.equal(second.migrateKeys(), 0, '幂等：第二次没有改动');
    assert.equal(await readFile(file, 'utf8'), afterFirst, '文件内容不该被重写');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plans.json 的旧键会被 rekey 改指新键（否则全部重拆、真花钱）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  const file = path.join(dir, 'entries.json');
  try {
    await writeFile(file, JSON.stringify(legacyEntries(OLD_ROWS)), 'utf8');
    const store = new LocalStore(file);

    // 旧版 plans.json：键用旧口径
    const legacyPlans = { plans: {}, runs: [] };
    for (const row of OLD_ROWS) {
      legacyPlans.plans[legacyEntryPrefix(row)] = {
        cards: [{ title: '旧卡片', action: '做', due: null, sourceTitle: row.title, tags: [] }],
        plannedAt: 1792320000,
        model: 'm1',
      };
    }
    const plans = memoryStore(legacyPlans);

    const changed = plans.rekey(store.keyMapping);
    assert.equal(changed, 2, '两条映射都该改键');

    // 迁移后：新键命中，旧键不再存在
    for (const row of store.list()) {
      assert.ok(plans.get(row.prefix), `新键应有映射：${row.title}`);
      assert.equal(plans.has(legacyEntryPrefix(row)), false, '旧键不该留着');
      // 卡片内容原样保留（只改键，不改值）
      assert.equal(plans.get(row.prefix).cards[0].title, '旧卡片');
      assert.equal(plans.get(row.prefix).model, 'm1');
    }

    // 最关键的一条：迁移后**没有**待拆条目
    assert.equal(pickPending(store.list(), plans).length, 0, '迁移后不该有任何条目被重新拆');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rekey 对已迁移的映射是幂等的', () => {
  const plans = memoryStore({ plans: { k1: { cards: [], plannedAt: 1, model: null } }, runs: [] });
  assert.equal(plans.rekey({ old: 'new' }), 0, '没有匹配的旧键就不该改动');
  assert.ok(plans.has('k1'));
});

test('两个旧键撞到同一个新键时，保留先到的那份而不是崩掉', () => {
  // 旧口径下"长标题的两条不同日记"共用同一个键，plans.json 里只有一份；
  // 迁移后它们分开了，但映射里本来就只有一条 —— 不该因此丢键或抛错。
  const plans = memoryStore({
    plans: { oldShared: { cards: [{ title: 'A' }], plannedAt: 1, model: null } },
    runs: [],
  });
  const changed = plans.rekey({ oldShared: 'newKey' });
  assert.equal(changed, 1);
  assert.deepEqual(plans.get('newKey').cards, [{ title: 'A' }]);
});

test('坏文件 / 空文件不影响启动，也不会产生映射', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  try {
    const broken = path.join(dir, 'broken.json');
    await writeFile(broken, 'not json', 'utf8');
    const store = new LocalStore(broken);
    assert.deepEqual(store.list(), []);
    assert.deepEqual(store.keyMapping, {});

    const missing = new LocalStore(path.join(dir, 'nope.json'));
    assert.deepEqual(missing.list(), []);
    assert.deepEqual(missing.keyMapping, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('没有 prefix 字段的老条目也能被补上新键', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-migrate-'));
  const file = path.join(dir, 'entries.json');
  try {
    // 更早的版本可能整条都没写 prefix
    const rows = OLD_ROWS.map(({ seq, kind, title, text, tags, at }) => ({ seq, kind, title, text, tags, at }));
    await writeFile(file, JSON.stringify({ entries: rows }), 'utf8');
    const store = new LocalStore(file);
    assert.equal(store.list().length, 2);
    for (const row of store.list()) assert.equal(row.prefix, entryPrefix(row));
    // 没有旧键可迁移，映射应为空（不该造出假映射）
    assert.deepEqual(store.keyMapping, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
