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
