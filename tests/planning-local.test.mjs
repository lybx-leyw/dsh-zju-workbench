/**
 * 「我的规划」——用户在本机手写的规划。
 *
 * 这一块是**新增能力**，不是修 bug，所以断言分三类：
 *
 *   1. 写入校验：手打的输入与模型输出一样不可信，形状不对要拒而不是猜；
 *   2. 生命周期：改、勾完成、删（含级联）—— 这些是"能改"这个承诺的全部内容；
 *   3. 拆分：AI 拆自己写的规划，幂等、可重拆、源删了子项也跟着走。
 *
 * 另有一条**边界**测试：本地规划绝不能写进中转站那个只增不改的仓库
 * （`entries.json` 是别人的内容的缓存，混进去会破坏"只增"的前提）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalPlanStore } from '../packages/dsh-zhiyun-page-planning/src/index.js';
import {
  createLocal, createSplit, normalizeLocalInput, patchLocal, setDone,
} from '../packages/dsh-zhiyun-page-planning/src/local.js';

/* ─────────────────────────────────────────────── 写入校验 */

test('只写标题就能建一条：截止时间不是必填', () => {
  // 逼着填时间会让"随手记一条"变麻烦，而没有时间的规划本来就最常见
  const item = createLocal({ title: '想读那篇论文' }, 1792320965000);
  assert.equal(item.title, '想读那篇论文');
  assert.equal(item.due, null, 'due 为 null 是正常值');
  assert.equal(item.done, false);
  assert.equal(item.doneAt, null);
  assert.deepEqual(item.splitInto, [], '空数组而不是 undefined：页面只判一种形状');
});

test('标题必填、有长度上限', () => {
  for (const bad of ['', '   ', null, undefined, 123]) {
    assert.throws(() => normalizeLocalInput({ title: bad }), (e) => e.code === 'INVALID_INPUT', `${String(bad)} 应被拒`);
  }
  assert.throws(() => normalizeLocalInput({ title: 'x'.repeat(81) }), (e) => e.code === 'INVALID_INPUT');
  assert.equal(normalizeLocalInput({ title: 'x'.repeat(80) }).title.length, 80, '刚好 80 字要收');
});

test('白名单外的字段一律拒（客户端不能借写入改 id / done）', () => {
  for (const extra of ['id', 'done', 'createdAt', 'splitInto', 'doneAt']) {
    assert.throws(
      () => normalizeLocalInput({ title: 'x', [extra]: 1 }),
      (e) => e.code === 'INVALID_INPUT',
      `${extra} 不该能从写入路径改`,
    );
  }
});

test('截止时间给了就必须可解析，空值当"没说"', () => {
  assert.equal(normalizeLocalInput({ title: 'x', due: null }).due, null);
  assert.equal(normalizeLocalInput({ title: 'x', due: '' }).due, null);
  assert.equal(normalizeLocalInput({ title: 'x', due: undefined }).due, null);
  assert.throws(() => normalizeLocalInput({ title: 'x', due: '不是日期' }), (e) => e.code === 'INVALID_INPUT');
  // 归一成 ISO：同一个时刻只该有一种写法
  assert.equal(normalizeLocalInput({ title: 'x', due: '2026-10-21T23:59:00+08:00' }).due, '2026-10-21T15:59:00.000Z');
});

test('备注是可选文本，超长要拒', () => {
  assert.equal(normalizeLocalInput({ title: 'x' }).detail, '');
  assert.equal(normalizeLocalInput({ title: 'x', detail: '  乖  ' }).detail, '乖');
  assert.throws(() => normalizeLocalInput({ title: 'x', detail: 'x'.repeat(501) }), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => normalizeLocalInput({ title: 'x', detail: 42 }), (e) => e.code === 'INVALID_INPUT');
});

/* ─────────────────────────────────────────────── 生命周期 */

test('改一条：只改传了的字段，不会把别的字段清空', () => {
  const base = createLocal({ title: '交作业', detail: '第三章', due: '2026-10-21T15:59:00.000Z' }, 1792320965000);
  const renamed = patchLocal(base, { title: '交第四章作业' }, 1792321000000);
  assert.equal(renamed.title, '交第四章作业');
  assert.equal(renamed.detail, '第三章', '没传的字段必须原样保留');
  assert.equal(renamed.due, '2026-10-21T15:59:00.000Z');
  assert.equal(renamed.updatedAt, 1792321000, 'updatedAt 要跟着走');
  assert.equal(renamed.createdAt, base.createdAt, 'createdAt 不该被改');
});

test('改一条可以显式清掉截止时间', () => {
  const base = createLocal({ title: 'x', due: '2026-10-21T15:59:00.000Z' }, 1792320965000);
  assert.equal(patchLocal(base, { due: null }).due, null, 'null 是"清掉"，与"没传"不同');
});

test('勾完成与取消完成：doneAt 要跟着对', () => {
  const base = createLocal({ title: 'x' }, 1792320965000);
  // `setDone` 返回 `{ item, next }`：`next` 是重复任务的下一次（不重复时为 null）
  const { item: done } = setDone(base, true, 1792322000000);
  assert.equal(done.done, true);
  assert.equal(done.doneAt, 1792322000);

  const { item: undone } = setDone(done, false, 1792323000000);
  assert.equal(undone.done, false);
  assert.equal(undone.doneAt, null, '取消完成必须清掉 doneAt —— 否则"做完了吗"有两个答案');
});

test('id 不重复（删了再建也不会撞）', () => {
  const dir = path.join(tmpdir(), `plan-local-id-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const item = store.create({ title: `第${i}条` });
    assert.equal(seen.has(item.id), false, `id 撞了：${item.id}`);
    seen.add(item.id);
  }
  return rm(dir, { recursive: true, force: true });
});

test('落盘后可读回；坏文件退回空表而不是抛错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-local-'));
  const file = path.join(dir, 'local.json');
  try {
    const store = new LocalPlanStore(file);
    store.create({ title: '留一条', due: '2026-10-21T15:59:00.000Z' });

    const reopened = new LocalPlanStore(file);
    assert.equal(reopened.list().length, 1);
    assert.equal(reopened.list()[0].title, '留一条');

    await writeFile(file, 'not json', 'utf8');
    assert.deepEqual(new LocalPlanStore(file).list(), [], '坏文件退回空表');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('单条记录坏了只丢那一条，不连坐整份规划', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-local-'));
  const file = path.join(dir, 'local.json');
  try {
    await writeFile(file, JSON.stringify({
      items: [
        { id: 'a', title: '好的', detail: '', due: null, done: false, createdAt: 1, updatedAt: 1, doneAt: null },
        { id: 'b' },              // 没有 title
        { title: '没有 id' },      // 没有 id
        null,
        'garbage',
      ],
    }), 'utf8');
    const store = new LocalPlanStore(file);
    assert.equal(store.list().length, 1, '只留下形状可用的那条');
    assert.equal(store.list()[0].title, '好的');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ─────────────────────────────────────────────── 拆分 */

test('拆一条：子项带 splitFrom，源带 splitInto', () => {
  const dir = path.join(tmpdir(), `plan-local-split-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  const source = store.create({ title: '下周要交的三件事' });

  const result = store.split(source.id, [
    { title: '交第三章作业', action: '去学习页提交' },
    { title: '概率论小测', action: '复习', due: '2026-10-23T15:59:00.000Z' },
  ]);
  assert.equal(result.created.length, 2);
  assert.equal(store.find(source.id).splitInto.length, 2, '源条目要记住自己拆出了哪几条');

  for (const child of result.created) {
    assert.equal(child.splitFrom, source.id, '子项要记住自己从哪来');
    assert.equal(child.done, false);
  }
  // 模型的 action 落到 detail 上，不另开一列
  assert.equal(result.created[0].detail, '去学习页提交');

  return rm(dir, { recursive: true, force: true });
});

test('已经拆过的默认不再拆（拆一次花一次模型钱）', () => {
  const dir = path.join(tmpdir(), `plan-local-split-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  const source = store.create({ title: 'x' });

  store.split(source.id, [{ title: 'a', action: 'b' }]);
  const again = store.split(source.id, [{ title: 'c', action: 'd' }]);
  assert.equal(again.skipped, true);
  assert.equal(again.created.length, 0);
  assert.equal(store.list().length, 2, '总条数不该变（1 源 + 1 子）');

  return rm(dir, { recursive: true, force: true });
});

test('force 重拆会先清掉上一批，不会出现两遍', () => {
  const dir = path.join(tmpdir(), `plan-local-split-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  const source = store.create({ title: 'x' });

  store.split(source.id, [{ title: '旧1', action: 'b' }, { title: '旧2', action: 'b' }]);
  const redone = store.split(source.id, [{ title: '新1', action: 'b' }], { force: true });

  assert.equal(redone.removed, 2, '要如实报出清掉了几条');
  assert.equal(redone.created.length, 1);
  const titles = store.list().map((item) => item.title);
  assert.deepEqual(titles, ['x', '新1'], '旧的那批必须消失');
  assert.equal(store.find(source.id).splitInto.length, 1);

  return rm(dir, { recursive: true, force: true });
});

test('删源条目时它拆出的子项一起走（不留孤儿）', () => {
  const dir = path.join(tmpdir(), `plan-local-split-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  const keep = store.create({ title: '留着' });
  const source = store.create({ title: '要删的' });
  store.split(source.id, [{ title: '子1', action: 'a' }, { title: '子2', action: 'b' }]);

  assert.equal(store.list().length, 4);
  assert.equal(store.remove(source.id), true);
  assert.deepEqual(store.list().map((item) => item.title), ['留着'], '源与它拆出的子项都该消失');
  assert.ok(store.find(keep.id), '无关的条目不该被波及');

  return rm(dir, { recursive: true, force: true });
});

test('拆不存在的源返回 null，不静默造出孤儿', () => {
  const dir = path.join(tmpdir(), `plan-local-split-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const store = new LocalPlanStore(path.join(dir, 'local.json'));
  assert.equal(store.split('nope', [{ title: 'a', action: 'b' }]), null);
  return rm(dir, { recursive: true, force: true });
});

test('createSplit 带 splitFrom；createLocal 不带', () => {
  const child = createSplit({ title: '子', detail: '动作', due: null }, 'src-1', 1792320965000);
  assert.equal(child.splitFrom, 'src-1');
  assert.equal(createLocal({ title: '普通' }).splitFrom, undefined);
});

/* ─────────────────────────────────────────────── 边界 */

test('本地规划不写进 entries.json（那是别人的内容的缓存，只增不改）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-local-boundary-'));
  const mineFile = path.join(dir, 'local.json');
  const entriesFile = path.join(dir, 'entries.json');
  try {
    // entries.json 不存在时，本地规划也不该顺手把它建出来
    const store = new LocalPlanStore(mineFile);
    store.create({ title: '我自己写的' });
    await assert.rejects(readFile(entriesFile, 'utf8'), /ENOENT/, '本地规划不该碰 entries.json');

    // 反过来：中转站那份缓存存在时，也不该被本地规划动到
    await writeFile(entriesFile, JSON.stringify({ entries: [] }), 'utf8');
    store.create({ title: '又一条' });
    assert.deepEqual(JSON.parse(await readFile(entriesFile, 'utf8')), { entries: [] }, 'entries.json 未被改动');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
