// 轮换选组器的测试。
//
// 钉住的是**行为**，不是实现：核心承诺有两条 ——
//   1. 跨天行为与原公式 `day_of_year % 3` 完全一致（不改变既有节奏）；
//   2. 同一天绝不重复取组（这正是本次修复的缺陷）。
// 任何一条被破坏，下面都会有测试变红。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUPS,
  dayOfYear,
  formulaGroup,
  parseDay,
  nowStamp,
  pickGroup,
  readState,
  writeState,
} from '../scripts/radar-rotation.mjs';

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const day = (s) => parseDay(s);

/** 造一份状态：`runsToday` 是「今天已跑过的组」，累计次数按 `cumulative` 给。 */
function stateOf({ lastGroup = null, lastRunDay = null, groupRuns = {}, runs = [] } = {}) {
  return {
    lastGroup,
    lastRunDay,
    lastRunAt: lastRunDay ? `${lastRunDay} 09:00` : null,
    groupRuns: { A: 0, B: 0, C: 0, ...groupRuns },
    runs,
    raw: '',
  };
}

test('dayOfYear 与 shell 的 date +%j 一致（10-14 = 287）', () => {
  assert.equal(dayOfYear(day('2026-10-14')), 287);
  assert.equal(dayOfYear(day('2026-01-01')), 1);
  assert.equal(dayOfYear(day('2026-12-31')), 365);
});

test('formulaGroup 复刻原公式 day_of_year % 3', () => {
  // 10-14 → 287 % 3 = 2 → C（正是当日实际跑的组）
  assert.equal(formulaGroup(day('2026-10-14')), 'C');
  // 10-15 → 288 % 3 = 0 → A
  assert.equal(formulaGroup(day('2026-10-15')), 'A');
});

test('跨天时取组与原公式完全一致 —— 不管状态里 last_group 是什么', () => {
  const today = day('2026-10-15');
  // last_run_at 是昨天，today 是今天 → 必须走公式
  const picked = pickGroup(stateOf({ lastGroup: 'A', lastRunDay: '2026-10-14' }), today);
  assert.equal(picked.group, formulaGroup(today));
  assert.equal(picked.rule, 'formula(new-day)');
  assert.equal(picked.stale, false);
});

test('同日续跑：不重复 last_group，顺延到今天没跑过的组', () => {
  const today = day('2026-10-14');
  // 今天已跑 C（公式给 C），同日再跑必须换组
  const picked = pickGroup(stateOf({ lastGroup: 'C', lastRunDay: '2026-10-14', groupRuns: { C: 1 } }), today);
  assert.notEqual(picked.group, 'C');
  assert.equal(picked.rule, 'same-day(unused)');
  assert.ok(GROUPS.includes(picked.group));
});

test('同日续跑：优先取累计次数最少的未跑组', () => {
  const today = day('2026-10-14');
  const picked = pickGroup(
    stateOf({ lastGroup: 'C', lastRunDay: '2026-10-14', groupRuns: { A: 5, B: 0, C: 1 } }),
    today,
  );
  assert.equal(picked.group, 'B'); // B 累计最少且今天没跑过
  assert.equal(picked.rule, 'same-day(unused)');
});

test('同日三组都跑过 → 标 exhausted 并给出提示依据', () => {
  const today = day('2026-10-14');
  const picked = pickGroup(
    stateOf({
      lastGroup: 'B', lastRunDay: '2026-10-14', groupRuns: { A: 1, B: 1, C: 1 },
      runs: [
        { day: '2026-10-14', group: 'A', note: '' },
        { day: '2026-10-14', group: 'C', note: '' },
        { day: '2026-10-14', group: 'B', note: '' },
      ],
    }),
    today,
  );
  assert.equal(picked.exhausted, true);
  assert.equal(picked.rule, 'same-day(exhausted)');
});

test('状态缺失 → 回落公式并标 stale（不崩）', () => {
  const today = day('2026-10-14');
  const picked = pickGroup(stateOf(), today);
  assert.equal(picked.group, formulaGroup(today));
  assert.equal(picked.stale, true);
  assert.equal(picked.rule, 'formula(stale-state)');
});

test('readState 对不存在的文件不抛错', () => {
  const state = readState('/nonexistent/rotation-state.md');
  assert.equal(state.lastGroup, null);
  assert.equal(state.raw, null);
  assert.deepEqual(state.groupRuns, { A: 0, B: 0, C: 0 });
});

test('仓库内真实的 rotation-state.md 可解析且字段自洽', () => {
  const state = readState(); // 默认路径 = docs/ecosystem-radar/rotation-state.md
  assert.ok(state.raw, '状态文件必须存在（轮换的单一真源）');
  assert.ok(GROUPS.includes(state.lastGroup), `last_group 应为 A/B/C，实际 ${state.lastGroup}`);
  assert.match(state.lastRunAt ?? '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  for (const g of GROUPS) {
    assert.equal(typeof state.groupRuns[g], 'number', `group_runs 缺 ${g}`);
    assert.ok(state.groupRuns[g] >= 0);
  }
  assert.ok(state.runs.length > 0, '流水至少应有一条（回填的历史轮次）');
});

test('readState 不把顶部「状态字段」说明表当成取值（回归：曾读出 A=0,B=0,C=0）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    writeFileSync(file, [
      '## 状态字段',
      '',
      '| 字段 | 含义 |',
      '| --- | --- |',
      '| `last_group` | 最近一次跑的组（`A` / `B` / `C`） |',
      '| `last_run_at` | 最近一次跑的时间（`YYYY-MM-DD HH:MM`，UTC+8） |',
      '| `group_runs` | 各组历史累计运行次数，用于按「跑得最少」优先排序 |',
      '',
      '## 状态',
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `C` |',
      '| `last_run_at` | `2026-10-14 23:01` |',
      '| `group_runs`（累计） | A=1, B=0, C=2 |',
      '',
    ].join('\n'), 'utf8');

    const state = readState(file);
    assert.equal(state.lastGroup, 'C');
    assert.equal(state.lastRunAt, '2026-10-14 23:01');
    // 关键断言：必须读到真实取值，而不是说明表里的文字
    assert.equal(state.groupRuns.A, 1);
    assert.equal(state.groupRuns.B, 0);
    assert.equal(state.groupRuns.C, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState 更新的是状态取值行，不误改顶部的说明表', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    const original = [
      '| `group_runs` | 各组历史累计运行次数，用于按「跑得最少」优先排序 |',
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `A` |',
      '| `last_run_at` | `2026-10-14 09:00` |',
      '| `group_runs`（累计） | A=1, B=0, C=0 |',
      '',
    ].join('\n');
    writeFileSync(file, original, 'utf8');

    writeState({ group: 'C', at: '2026-10-15 10:00', note: 'x' }, file);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /各组历史累计运行次数/, '说明表必须原样保留');
    assert.match(text, /\| `group_runs`（累计） \| A=1, B=0, C=1 \|/, '取值行应被更新');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState 写入后能读回，且累计次数递增', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    writeFileSync(file, [
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `A` |',
      '| `last_run_at` | `2026-10-14 09:00` |',
      '| `group_runs`（累计） | A=1, B=0, C=0 |',
      '',
      '| 时间 | 组 | 说明 |',
      '| --- | --- | --- |',
      '| 2026-10-14 09:00 | A | 首轮 |',
      '',
    ].join('\n'), 'utf8');

    const saved = writeState({ group: 'B', at: '2026-10-15 10:00', note: '测试' }, file);
    assert.equal(saved.groupRuns.A, 1);
    assert.equal(saved.groupRuns.B, 1);

    const back = readState(file);
    assert.equal(back.lastGroup, 'B');
    assert.equal(back.lastRunDay, '2026-10-15');
    assert.equal(back.groupRuns.B, 1);
    assert.ok(back.runs.some((r) => r.group === 'B' && r.day === '2026-10-15'));

    // 写入后「今天」= 10-15，而 last_run_at 也是 10-15 → 必须走同日分支，不重复取 B
    const picked = pickGroup(back, parseDay('2026-10-15'));
    assert.notEqual(picked.group, 'B');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 时区口径（r87）────────────────────────────────────────────────────────
//
// 缺陷：`--commit` 不传 `--at` 时用 `new Date().toISOString()` 取「现在」，
// 那是 **UTC** 时刻写进 `last_run_at`，可同一行的日期又被当作**上海日**来比。
// 两者在 UTC+8 的 00:00–08:00 恰好差一天：
//
//   上海 2026-10-28 00:00  →  写入 `2026-10-27 16:00`  →  下一次跑时「今天」= 10-28，
//   last_run_at 的日期 = 10-27  →  判「跨天」→ 按公式重取组，**当日去重被绕过**。
//
// 这个窗口正好覆盖每 3 小时一轮的凌晨场次（00:00 / 03:00 / 06:00）。

test('nowStamp 按固定 +08:00 取「现在」，不随宿主 TZ 漂移', () => {
  // 上海 2026-10-28 00:00 == UTC 2026-10-27 16:00
  const utc = Date.UTC(2026, 9, 27, 16, 0);
  assert.equal(nowStamp(utc), '2026-10-28 00:00');
  // 跨年边界：上海 2027-01-01 07:59 == UTC 2026-12-31 23:59
  assert.equal(nowStamp(Date.UTC(2026, 11, 31, 23, 59)), '2027-01-01 07:59');
});

test('nowStamp 不受 process.env.TZ 影响（宿主时区无关）', () => {
  const prev = process.env.TZ;
  const utc = Date.UTC(2026, 9, 27, 16, 0);
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Shanghai', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(nowStamp(utc), '2026-10-28 00:00', `TZ=${tz} 时 nowStamp 漂了`);
    }
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('回归：上海 00:30 跑完 → 同日再跑必须走「同日」分支，不得回落公式', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    writeFileSync(file, [
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `C` |',
      '| `last_run_at` | `2026-10-27 21:00` |',
      '| `group_runs`（累计） | A=1, B=1, C=1 |',
      '',
    ].join('\n'), 'utf8');

    // 上海 2026-10-28 00:30（= UTC 2026-10-27 16:30）跑 B
    writeState({ group: 'B', at: nowStamp(Date.UTC(2026, 9, 27, 16, 30)), note: '凌晨场' }, file);
    const back = readState(file);
    assert.equal(back.lastRunDay, '2026-10-28', 'last_run_at 必须记上海日，而不是 UTC 日');

    // 同一天 03:00 再跑：今天 = 10-28，必须识别出 B 今天已跑过
    const picked = pickGroup(back, parseDay('2026-10-28'));
    assert.notEqual(picked.rule, 'formula(new-day)', '凌晨场被误判成跨天 → 当日去重失效');
    assert.ok(picked.ranToday.includes('B'), `ranToday 应含 B，实际 ${picked.ranToday.join(',')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState 默认时间戳走 +08:00（不传 --at 时）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    writeFileSync(file, [
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `A` |',
      '| `last_run_at` | `2026-10-27 09:00` |',
      '| `group_runs`（累计） | A=1, B=0, C=0 |',
      '',
    ].join('\n'), 'utf8');
    const saved = writeState({ group: 'A' }, file);
    // 与「现在」的上海时刻相比，允许 2 分钟（跑测试本身耗时）
    const expected = nowStamp(Date.now());
    const toMin = (s) => Date.parse(`${s.replace(' ', 'T')}:00Z`);
    assert.ok(Math.abs(toMin(saved.at) - toMin(expected)) <= 2 * 60 * 1000,
      `默认时间戳不是上海时刻：${saved.at} vs ${expected}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回归：CLI 的「今天」取上海日，不是 UTC 日', async () => {
  // 子进程里把 TZ 设成 UTC 也要拿到上海日（不靠宿主 TZ）
  const { execFileSync } = await import('node:child_process');
  // 不用 `--json`：它把 `state.raw`（整份状态文件）也序列化进去，体积大且脆。
  // 这里只断言「今天」那一行 —— 正是本次要修的字段。
  const out = execFileSync(process.execPath, ['scripts/radar-rotation.mjs'], {
    env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8',
  });
  const line = out.split('\n').find((l) => l.startsWith('今天'));
  assert.ok(line, 'CLI 未输出「今天」行');
  assert.ok(line.includes(nowStamp().slice(0, 10)), `CLI 的今天不是上海日：${line}`);
});

test('last_run_at 晚于今天 → 视为脏状态，回落公式（不拿不可能的未来日期做去重基准）', () => {
  const today = parseDay('2026-10-27');
  const picked = pickGroup(stateOf({ lastGroup: 'C', lastRunDay: '2026-10-28' }), today);
  assert.equal(picked.rule, 'formula(future-state)');
  assert.equal(picked.group, formulaGroup(today));
});

test('回归（写侧）：说明表里恰好含一个反引号时刻时，writeState 仍只改「## 状态」节', () => {
  // 2026-10-28 实跑踩到：说明表第 2 行是 ``| `last_run_at` | `2026-10-28 00:05` | …|``，
  // 全文 replace() 先在说明行命中 → last_group 改了、last_run_at 与 group_runs 没改。
  const dir = mkdtempSync(join(tmpdir(), 'radar-rotation-'));
  const file = join(dir, 'rotation-state.md');
  try {
    writeFileSync(file, [
      '## 状态字段',
      '',
      '| 字段 | 含义 |',
      '| --- | --- |',
      '| `last_group` | 最近一次跑的组（`A` / `B` / `C`） |',
      '| `last_run_at` | `2026-10-28 00:05` |',
      '| `group_runs` | 各组历史累计运行次数 |',
      '',
      '## 状态',
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      '| `last_group` | `C` |',
      '| `last_run_at` | `2026-10-27 22:35` |',
      '| `group_runs`（累计） | A=1, B=1, C=1 |',
      '',
    ].join('\n'), 'utf8');

    writeState({ group: 'B', at: '2026-10-28 00:05', note: 't' }, file);
    const back = readState(file);
    assert.equal(back.lastGroup, 'B');
    assert.equal(back.lastRunAt, '2026-10-28 00:05', 'last_run_at 必须写进取值行');
    assert.equal(back.groupRuns.B, 2, 'group_runs 必须跟着 +1');

    const text = readFileSync(file, 'utf8');
    const explainRow = text.split('\n').find((l) => l.startsWith('| `last_run_at` | `2026-10-28 00:05` |'));
    assert.ok(explainRow, '说明表那一行不应被改写（它本来就长这样）');
    // 说明表里「最近一次跑的组」那条必须是原样
    assert.ok(text.includes('| `last_group` | 最近一次跑的组（`A` / `B` / `C`） |'), '说明表被写了取值');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
