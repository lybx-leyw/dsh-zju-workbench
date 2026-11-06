/**
 * 「重复」的规则层测试。
 *
 * # 为什么单独一套
 *
 * 重复的坑几乎全在**日期推进**上，而不是在界面上：
 *
 *   - `1 月 31 日 + 1 个月` 用朴素的 `setMonth` 会得到 `3 月 3 日`
 *     （2 月没有 31 号）。对「每月交材料」这是错的，用户期待 2 月末。
 *   - `due` 与 `done` 两种锚点差别很大，混了会让拖延的人把周期越拖越长。
 *   - 「取消勾选」和「重复点一次完成」都不该再生成一条，否则会越积越多。
 *
 * 这些都不需要渲染就能测，所以放在这里用纯函数覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceBy, createLocal, nextOccurrence, normalizeRepeat,
  patchLocal, setDone, REPEAT_UNITS, REPEAT_LABEL,
} from '../packages/dsh-zhiyun-page-planning/src/local.js';

const iso = (value) => new Date(value).toISOString();

/* ────────────────────────────────────── 校验 */

test('重复规则：null / 空 都表示"不重复"，不报错', () => {
  for (const value of [null, undefined, '']) {
    assert.equal(normalizeRepeat(value), null);
  }
});

test('重复规则：缺 every 默认 1，缺 anchor 默认按截止日', () => {
  assert.deepEqual(normalizeRepeat({ unit: 'week' }), { every: 1, unit: 'week', anchor: 'due' });
});

test('重复规则：只接受 day/week/month，别的一律拒', () => {
  for (const unit of REPEAT_UNITS) {
    assert.equal(normalizeRepeat({ unit }).unit, unit);
  }
  for (const bad of ['year', 'hour', 'DAYS', '']) {
    assert.throws(() => normalizeRepeat({ unit: bad }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      return true;
    }, `unit=${bad} 应当被拒`);
  }
});

test('重复规则：间隔必须是 1–12 的整数', () => {
  for (const bad of [0, -1, 13, 1.5, 'x', null]) {
    assert.throws(() => normalizeRepeat({ every: bad, unit: 'day' }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      return true;
    }, `every=${bad} 应当被拒`);
  }
  assert.equal(normalizeRepeat({ every: 12, unit: 'day' }).every, 12);
});

test('重复规则：锚点只能是 due / done', () => {
  assert.equal(normalizeRepeat({ unit: 'day', anchor: 'done' }).anchor, 'done');
  assert.throws(() => normalizeRepeat({ unit: 'day', anchor: 'completion' }), (e) => e.code === 'INVALID_INPUT');
});

test('重复规则：不认识的字段要拒，不能静默丢弃', () => {
  assert.throws(() => normalizeRepeat({ unit: 'day', cron: '0 9 * * *' }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.match(error.message, /cron/);
    return true;
  });
});

test('每种周期都有中文标签', () => {
  for (const unit of REPEAT_UNITS) assert.ok(REPEAT_LABEL[unit], `${unit} 缺标签`);
});

/* ────────────────────────────────────── 推进：日 / 周 */

test('按天推进：+1 天 / +2 天，钟点不变', () => {
  assert.equal(advanceBy('2026-10-20T10:00:00.000Z', { every: 1, unit: 'day' }),
    iso('2026-10-21T10:00:00.000Z'));
  assert.equal(advanceBy('2026-10-20T10:00:00.000Z', { every: 2, unit: 'day' }),
    iso('2026-10-22T10:00:00.000Z'));
});

test('按周推进：+1 周 / +2 周', () => {
  assert.equal(advanceBy('2026-10-20T10:00:00.000Z', { every: 1, unit: 'week' }),
    iso('2026-10-27T10:00:00.000Z'));
  assert.equal(advanceBy('2026-10-20T10:00:00.000Z', { every: 2, unit: 'week' }),
    iso('2026-11-03T10:00:00.000Z'));
});

test('跨年也要对', () => {
  assert.equal(advanceBy('2026-12-28T08:00:00.000Z', { every: 1, unit: 'week' }),
    iso('2027-01-04T08:00:00.000Z'));
});

/* ────────────────────────────────────── 推进：月（最容易写错） */

test('按月推进：1/31 → 2/28（夹到月末，不是跳到 3 月）', () => {
  assert.equal(advanceBy('2026-01-31T15:59:00.000Z', { every: 1, unit: 'month' }),
    iso('2026-02-28T15:59:00.000Z'));
});

test('按月推进：闰年 1/31 → 2/29', () => {
  // 2028 是闰年
  assert.equal(advanceBy('2028-01-31T00:00:00.000Z', { every: 1, unit: 'month' }),
    iso('2028-02-29T00:00:00.000Z'));
});

test('按月推进：31 天的月份互相推进不夹', () => {
  assert.equal(advanceBy('2026-08-31T00:00:00.000Z', { every: 1, unit: 'month' }),
    iso('2026-09-30T00:00:00.000Z'), '9 月只有 30 天');
  assert.equal(advanceBy('2026-12-31T00:00:00.000Z', { every: 1, unit: 'month' }),
    iso('2027-01-31T00:00:00.000Z'), '12/31 → 1/31 不夹');
});

test('按月推进：非月末日期保持原日号', () => {
  assert.equal(advanceBy('2026-10-15T09:30:00.000Z', { every: 1, unit: 'month' }),
    iso('2026-11-15T09:30:00.000Z'));
});

test('按月推进：+3 个月跨年', () => {
  assert.equal(advanceBy('2026-11-30T00:00:00.000Z', { every: 3, unit: 'month' }),
    iso('2027-02-28T00:00:00.000Z'));
});

test('推进：起点无法解析时给 null，不抛', () => {
  assert.equal(advanceBy('不是时间', { every: 1, unit: 'day' }), null);
  assert.equal(advanceBy('2026-10-20T00:00:00.000Z', null), null);
});

/* ────────────────────────────────────── 两种锚点 */

const base = {
  id: 'p-1', title: '交作业', detail: '', createdAt: 1, updatedAt: 1,
  done: false, doneAt: null, splitInto: [],
  due: '2026-10-21T15:59:00.000Z',
  repeat: { every: 1, unit: 'week', anchor: 'due' },
};

test('锚点 due：从原截止日推进，与哪天做完无关', () => {
  // 周三的截止，用户拖到周六才勾
  const doneAt = Date.parse('2026-10-24T12:00:00.000Z');
  const next = nextOccurrence(base, doneAt);
  assert.equal(next, iso('2026-10-28T15:59:00.000Z'), '下次仍是周三，不是周六 + 1 周');
});

test('锚点 done：从实际完成时刻推进', () => {
  const item = { ...base, repeat: { every: 1, unit: 'week', anchor: 'done' } };
  const doneAt = Date.parse('2026-10-24T12:00:00.000Z');
  assert.equal(nextOccurrence(item, doneAt), iso('2026-10-31T12:00:00.000Z'));
});

test('没有截止时间且锚点 due → 不生成（没有起点，不瞎推）', () => {
  const item = { ...base, due: null };
  assert.equal(nextOccurrence(item, Date.now()), null);
});

test('没有截止时间但锚点 done → 可以生成（从完成时刻起算）', () => {
  const item = { ...base, due: null, repeat: { every: 2, unit: 'day', anchor: 'done' } };
  const doneAt = Date.parse('2026-10-24T00:00:00.000Z');
  assert.equal(nextOccurrence(item, doneAt), iso('2026-10-26T00:00:00.000Z'));
});

test('不重复的条目永远不生成下一次', () => {
  assert.equal(nextOccurrence({ ...base, repeat: null }, Date.now()), null);
});

/* ────────────────────────────────────── setDone：什么时候推进 */

test('勾完成：返回改后的条目 + 下一次', () => {
  const doneAt = Date.parse('2026-10-20T00:00:00.000Z');
  const { item, next } = setDone(base, true, doneAt);
  assert.equal(item.done, true);
  assert.equal(item.doneAt, Math.floor(doneAt / 1000));
  assert.ok(next, '应当生成下一次');
  assert.equal(next.done, false);
  assert.equal(next.due, iso('2026-10-28T15:59:00.000Z'));
  assert.notEqual(next.id, base.id, '下一次必须是新 id');
});

test('取消勾选：不生成下一次，且 doneAt 清空', () => {
  const done = { ...base, done: true, doneAt: 123 };
  const { item, next } = setDone(done, false, Date.now());
  assert.equal(next, null, '取消完成不该再生成');
  assert.equal(item.doneAt, null);
});

test('已经是完成态再点一次完成：不重复生成', () => {
  const already = { ...base, done: true, doneAt: 1 };
  const { next } = setDone(already, true, Date.parse('2026-10-20T00:00:00.000Z'));
  assert.equal(next, null, '幂等重放不能再生一条');
});

test('没有重复规则的条目勾完成：不生成', () => {
  const { item, next } = setDone({ ...base, repeat: null }, true, Date.now());
  assert.equal(item.done, true);
  assert.equal(next, null);
});

/* ────────────────────────────────────── 与创建/修改的接线 */

test('新建：repeat 会落进条目', () => {
  const created = createLocal({
    title: '每周交作业',
    due: '2026-10-21T15:59:00.000Z',
    repeat: { every: 1, unit: 'week' },
  });
  assert.deepEqual(created.repeat, { every: 1, unit: 'week', anchor: 'due' });
});

test('新建：不传 repeat 就是 null（不是缺字段）', () => {
  const created = createLocal({ title: '一次性的事' });
  assert.equal(created.repeat, null);
});

test('修改：不传 repeat 保持原样', () => {
  const created = createLocal({ title: 'x', repeat: { unit: 'day' } });
  const patched = patchLocal(created, { title: 'y' });
  assert.deepEqual(patched.repeat, { every: 1, unit: 'day', anchor: 'due' });
});

test('修改：传 repeat:null 是**显式取消**重复', () => {
  const created = createLocal({ title: 'x', repeat: { unit: 'day' } });
  const patched = patchLocal(created, { repeat: null });
  assert.equal(patched.repeat, null);
});

test('修改：换了周期要能生效', () => {
  const created = createLocal({ title: 'x', repeat: { every: 1, unit: 'day' } });
  const patched = patchLocal(created, { repeat: { every: 2, unit: 'week', anchor: 'done' } });
  assert.deepEqual(patched.repeat, { every: 2, unit: 'week', anchor: 'done' });
});

test('新建时 repeat 形状不对要当场报错', () => {
  assert.throws(() => createLocal({ title: 'x', repeat: { unit: 'year' } }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    return true;
  });
});
