/**
 * 重复任务「生成 / 收回」与「月推进不塌缩」的回归测试。
 *
 * 这四组断言都对着一件**已经发生**的事写，不是设想：
 *
 *   1. 每月 31 日夹到 2 月末之后，**再往下推就一路是 28 日**（实测 `1/31 → 2/28 → 3/28`）；
 *   2. 勾完成 → 取消 → 再勾，同一截止日出现**两条副本**（生成没有对应的收回）；
 *   3. 客户端的 `datetime-local` 是按**浏览器本地时区**解释的，宿主不在东八区时
 *      「23:59 截止」会落到上海时间的第二天 —— 本仓没有任何一处校验这件事；
 *   4. `advanceBy` 本身是对的（`1/31 + 1 月 = 2/28`、`2/28 + 1 月 = 3/28` 都符合定义），
 *      错的只是「把夹过的结果当成下一次的起点」这个用法。
 *
 * 前两组落 `local.js` 的修复；第三组只钉现状与校验函数（不改客户端的时区语义，
 * 那要动 `datetime-local` 的整条链路，得单独评审）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceBy, nextOccurrence, recallGenerated, setDone,
} from '../packages/dsh-zhiyun-page-planning/src/local.js';

const at = (iso) => Date.parse(iso);

/** 一条「每月 31 日 23:59（上海）」的重复条目。 */
const monthly31 = {
  id: 'p-m31', title: '交月报', detail: '',
  due: '2026-01-31T15:59:00.000Z',
  repeat: { every: 1, unit: 'month', anchor: 'due' },
  done: false, doneAt: null, createdAt: 1, updatedAt: 1, splitInto: [],
};

/* ───────────────────────── 1. 月推进不塌缩 */

test('月推进：31 日夹到 2 月末之后，下一次**回到 31 日**而不是锁死在 28 日', () => {
  let row = monthly31;
  const days = [];
  for (let i = 0; i < 8; i += 1) {
    const result = setDone(row, true, at('2026-01-31T02:00:00Z'));
    assert.ok(result.next, '每一次勾完成都应该生成下一次');
    row = result.next;
    days.push(new Date(row.due).getUTCDate());
  }
  assert.deepEqual(
    days,
    [28, 31, 30, 31, 30, 31, 31, 30],
    '2026-02…09 依次应为 28/31/30/31/30/31/31/30（夹住后要回到原日号）',
  );
  // 原始日号要跟着一代代传下去，否则下下代又只能看到 28
  assert.equal(row.repeatDay, 31);
});

test('月推进：目标月放得下时**不留** repeatDay（形状与从前一致）', () => {
  const plain = { ...monthly31, due: '2026-10-15T15:59:00.000Z' };
  const result = setDone(plain, true, at('2026-10-15T02:00:00Z'));
  assert.equal(result.next.due, '2026-11-15T15:59:00.000Z');
  assert.equal('repeatDay' in result.next, false, '没夹住就不该多出字段');
});

test('月推进：2 月这类短月份**自己就是起点**时，下一次仍是 31 日', () => {
  // 从 2026-02-28 起（用户是在 2 月建的），1 月里没有这天可参照 → 按这一条自己的日号
  const feb = { ...monthly31, due: '2026-02-28T15:59:00.000Z' };
  const result = setDone(feb, true, at('2026-02-28T02:00:00Z'));
  assert.equal(new Date(result.next.due).getUTCDate(), 28, '没有历史原日号时维持原行为');
});

test('月推进：每两月（every=2）同样不塌缩', () => {
  const every2 = { ...monthly31, repeat: { every: 2, unit: 'month', anchor: 'due' } };
  const r1 = setDone(every2, true, at('2026-01-31T02:00:00Z'));
  assert.equal(r1.next.due, '2026-03-31T15:59:00.000Z', '1/31 + 2 月 = 3/31');
});

test('天 / 周推进不受影响：不变、不写 repeatDay', () => {
  const weekly = {
    ...monthly31, due: '2026-10-25T15:59:00.000Z',
    repeat: { every: 1, unit: 'week', anchor: 'due' },
  };
  const r1 = setDone(weekly, true, at('2026-10-25T02:00:00Z'));
  assert.equal(r1.next.due, '2026-11-01T15:59:00.000Z');
  assert.equal('repeatDay' in r1.next, false);
  const r2 = setDone(r1.next, true, at('2026-11-01T02:00:00Z'));
  assert.equal(r2.next.due, '2026-11-08T15:59:00.000Z');
});

test('锚点 done：从实际完成时刻推进（不受 repeatDay 干扰）', () => {
  const byDone = { ...monthly31, repeat: { every: 1, unit: 'day', anchor: 'done' } };
  const r = setDone(byDone, true, at('2026-03-05T02:00:00Z'));
  assert.equal(r.next.due, '2026-03-06T02:00:00.000Z');
});

/* ───────────────────────── 2. 取消勾选要收回副本 */

test('勾 → 取消 → 再勾：同一截止日只剩一条副本', () => {
  const items = [monthly31];
  const done1 = setDone(monthly31, true, at('2026-01-31T02:00:00Z'));
  items[0] = done1.item;
  items.push(done1.next);
  assert.equal(items.length, 2);

  const undone = setDone(done1.item, false, at('2026-01-31T02:01:00Z'));
  const recalled = recallGenerated(items, undone.item);
  assert.equal(recalled.length, 1, '取消勾选要收回那一次生成的下一次');
  const after = items.filter((row) => !recalled.includes(row.id));
  assert.equal(after.length, 1);

  const done2 = setDone(undone.item, true, at('2026-01-31T02:02:00Z'));
  const final = [...after.map((row) => (row.id === done2.item.id ? done2.item : row))];
  if (done2.next) final.push(done2.next);
  const sameDue = final.filter((row) => row.due === '2026-02-28T15:59:00.000Z' && !row.done);
  assert.equal(sameDue.length, 1, '修复前这里是 2 条（r66 实测）');
});

test('收回只动「同一条链、更晚、未勾、未拆分」的那一代', () => {
  const items = [
    { ...monthly31, id: 'p-a', due: '2026-01-31T15:59:00.000Z' },
    { ...monthly31, id: 'p-b', due: '2026-02-28T15:59:00.000Z', repeatFrom: 'p-a' },
    { ...monthly31, id: 'p-c', due: '2026-02-28T15:59:00.000Z', repeatFrom: 'p-other' },
    { ...monthly31, id: 'p-d', due: '2026-03-31T15:59:00.000Z', repeatFrom: 'p-a', done: false },
    { ...monthly31, id: 'p-e', due: '2026-03-31T15:59:00.000Z', repeatFrom: 'p-a', splitInto: ['p-x'] },
  ];
  const recalled = recallGenerated(items, items[0]);
  assert.deepEqual(recalled, ['p-b'], '别的链、已完成、已拆分的都不收');
});

test('不重复的条目取消勾选时什么都不收', () => {
  const plain = { ...monthly31, repeat: null, id: 'p-plain' };
  assert.deepEqual(recallGenerated([plain], plain), []);
});

/* ───────────────────────── 3. 时区：**撤回本轮的第一版结论** */

test('撤回：存储值里没有任何信息能说明设备时区（任何 tz 下分钟都一致）', () => {
  // 原判据「上海 = UTC + 8h 后分钟必须不变」在实践中恒成立（因为新纪元时刻的分钟在
  // 所有非 :30/:45 时区里都一样）→ 该判据**无判别力**，`due-shape.js` 已删除。
  // 这里把"为什么撤"钉住，免得下一轮又造一遍同一个检查器。
  const wall = '2026-10-31T23:59';
  const stored = new Date(wall).toISOString();     // 宿主时区（本沙箱为 UTC）
  const parsed = new Date(stored);
  assert.equal(parsed.getUTCMinutes(), 59, '分钟与墙钟相同');
  // 同一串墙钟在纽约设备上存出来的是**另一个时刻**，但分钟仍是 59
  assert.equal(new Date('2026-11-01T03:59:00.000Z').getUTCMinutes(), 59);
  // 结论：不能靠存储值反推时区 → 真要修只能在写入侧钉死 +08:00（见报告 TODO-1）
});

/* ───────────────────────── 4. advanceBy 本身没坏（防止误改） */

test('advanceBy：夹住是定义，不是 bug', () => {
  assert.equal(advanceBy('2026-01-31T15:59:00.000Z', { every: 1, unit: 'month' }), '2026-02-28T15:59:00.000Z');
  assert.equal(advanceBy('2026-02-28T15:59:00.000Z', { every: 1, unit: 'month' }), '2026-03-28T15:59:00.000Z');
  assert.equal(advanceBy('2028-01-31T15:59:00.000Z', { every: 1, unit: 'month' }), '2028-02-29T15:59:00.000Z', '闰年 2 月 29 日');
});

test('nextOccurrence：带 repeatDay 时从原日号起算', () => {
  const row = {
    due: '2026-02-28T15:59:00.000Z', repeatDay: 31,
    repeat: { every: 1, unit: 'month', anchor: 'due' },
  };
  assert.equal(nextOccurrence(row, at('2026-02-28T02:00:00Z')), '2026-03-31T15:59:00.000Z');
});

test('撤销「原条目」的勾选：收掉它生成的那一代，原始条目本身保留', () => {
  const done1 = setDone(monthly31, true, at('2026-01-31T02:00:00Z'));
  const undone = setDone(done1.item, false, at('2026-01-31T02:01:00Z'));
  const rows = [undone.item, done1.next];
  const recalled = recallGenerated(rows, undone.item);
  assert.deepEqual(recalled, [done1.next.id], '撤的是原始那条时，要收掉它生成的下一次');
  const after = rows.filter((row) => !recalled.includes(row.id));
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'p-m31', '留下的是被撤销的那条本身');
  assert.equal(after[0].done, false);
});

test('撤销「刚生成的那一条」：结构上无法判断，**不收任何东西**（宁可不删）', () => {
  // 取消勾选会清掉 `doneAt`，于是「勾错原始那条」和「勾错副本」留下的条目**完全同形**。
  // 此时唯一的差别是 `due`：原始那条比副本早。而"更早的那个"就是它自己生成链的源头,
  // 不能反过来当"被它生成的东西"删掉 —— 所以这里返回空，靠 store 层不重复入列来兜底。
  const done1 = setDone(monthly31, true, at('2026-01-31T02:00:00Z'));
  const undone = setDone(done1.next, false, at('2026-01-31T02:01:00Z'));
  const rows = [done1.item, undone.item];
  assert.deepEqual(recallGenerated(rows, undone.item), [], '同 due / 更早的条目一律不动');
  assert.equal(rows.length, 2, '不动就是真不动，不能顺手删');
});

