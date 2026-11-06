#!/usr/bin/env node
/**
 * 生态雷达的**轮换选组器**。
 *
 * # 为什么要有这个脚本
 *
 * 原轮换公式是 `day_of_year % 3` —— 只按**日期**取组，不记录「今天已经跑过哪组」。
 * 同一天多跑一次就必然重复跑同一组（2026-10-14 实际发生：三轮里后两轮关键词逐字相同）。
 *
 * 本脚本把状态落进 `docs/ecosystem-radar/rotation-state.md`（单一真源，人可读、可手改、
 * 走 git 留存），由 `scripts/radar-rotation.mjs` 提供**选组 + 记账**两个动作。
 *
 * # 取组规则（跨天照旧轮转，同日绝不重跑）
 *
 *   1. 跨天（`last_run_at` 日期 ≠ 今天）→ `(day_of_year % 3)` 对应的组，即**原公式**。
 *      ⇒ 跨天行为与改动前**完全一致**，不打乱既有节奏。
 *   2. 同日（`last_run_at` 日期 = 今天）→ 今天**尚未跑过**的组里累计次数最少的一个；
 *      三组今天都跑过则取今天最少跑过的组（并给出 `exhausted` 提示）。
 *   3. 状态缺失 / 不可解析 → 回落规则 1，并标 `stale: true`。
 *
 * # 用法
 *
 *   node scripts/radar-rotation.mjs                       # 只读：打印状态与今天该跑的组
 *   node scripts/radar-rotation.mjs --group               # 只打印组名（A|B|C）
 *   node scripts/radar-rotation.mjs --json                # 机器可读
 *   node scripts/radar-rotation.mjs --today 2026-10-15    # 以指定日期为「今天」（便于测试）
 *   node scripts/radar-rotation.mjs --commit B --at "2026-10-15 09:30"   # 跑完写回状态
 *
 * 退出码：0 正常；1 用法错误。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const STATE_PATH = join(REPO_ROOT, 'docs/ecosystem-radar/rotation-state.md');

/** 上海相对 UTC 的偏移（毫秒）。见 `nowStamp` 的说明。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 组序：下标即 `day_of_year % 3` 的结果。 */
export const GROUPS = ['A', 'B', 'C'];

// 这些正则必须**锚在取值行**上：文件顶部的「状态字段」说明表里同样出现
// `last_group` / `last_run_at` / `group_runs` 字样，宽松的 `[^|]*` 会先撞上说明表
// 而把解释文字当成取值（曾经真的撞上过：把 `A=1, B=0, C=2` 读成了 0/0/0）。
// 因此每个模式都要求**取值必须是反引号包裹的具体值 / `A=n, B=n, C=n` 形状**。
const GROUP_RUNS_RE = /\|\s*`group_runs`[^|]*\|\s*((?:[ABC]\s*=\s*\d+\s*,?\s*)+)\|/;
const LAST_GROUP_RE = /\|\s*`last_group`\s*\|\s*`([ABC])`\s*\|/;
const LAST_RUN_RE = /\|\s*`last_run_at`\s*\|\s*`([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([0-9]{2}:[0-9]{2})`\s*\|/;
const RUN_ROW_RE = /^\|\s*([0-9]{4}-[0-9]{2}-[0-9]{2})[^|]*\|\s*([ABC])\s*\|(.*)\|\s*$/;

/** 年积日（1-based），与 shell 的 `date +%j` 一致。 */
export function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const cur = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((cur - start) / 86400000) + 1;
}

/** 解析 `YYYY-MM-DD` 成 UTC 日期（避免本地时区把日期挪一天）。 */
export function parseDay(text) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 组序公式：`day_of_year % 3` → A/B/C。这是**跨天**时的取组依据，与原行为一致。 */
export function formulaGroup(date) {
  return GROUPS[dayOfYear(date) % 3];
}

/** 读出状态文件里的结构化部分。文件缺失/损坏一律回落到「无状态」。 */
export function readState(statePath = STATE_PATH) {
  let text;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch {
    return { lastGroup: null, lastRunDay: null, lastRunAt: null, groupRuns: emptyRuns(), runs: [], raw: null };
  }

  const lastGroup = LAST_GROUP_RE.exec(text)?.[1] ?? null;
  const runMatch = LAST_RUN_RE.exec(text);
  const lastRunDay = runMatch?.[1] ?? null;
  const lastRunAt = runMatch ? `${runMatch[1]} ${runMatch[2]}` : null;

  // 累计次数写作 `A=1, B=0, C=2`
  const groupRuns = emptyRuns();
  const runsText = GROUP_RUNS_RE.exec(text)?.[1] ?? '';
  for (const m of runsText.matchAll(/([ABC])\s*=\s*(\d+)/g)) groupRuns[m[1]] = Number(m[2]);

  const runs = [];
  for (const line of text.split('\n')) {
    const m = RUN_ROW_RE.exec(line);
    if (!m) continue;
    const note = m[3].replace(/^[\s|]+|[\s|]+$/g, '');
    // 表头分隔行（`---`）会被上面这条正则漏掉，但真正的数据行首格是日期，已由正则卡住。
    runs.push({ day: m[1], group: m[2], note });
  }

  return { lastGroup, lastRunDay, lastRunAt, groupRuns, runs, raw: text };
}

function emptyRuns() {
  return Object.fromEntries(GROUPS.map((g) => [g, 0]));
}

/**
 * 选组。纯函数：给定状态与「今天」，返回该跑哪组及理由。
 * @param state - `readState()` 的结果。
 * @param today - 「今天」的 UTC 日期。
 * @returns `{ group, rule, stale, exhausted, ranToday }`
 */
export function pickGroup(state, today) {
  const todayText = isoDay(today);
  // `lastRunDay` 晚于今天 = 记录本身不可能（旧版 `toISOString()` 在上海凌晨写的是**前一天**，
  // 但它同时把 `--today` 也按 UTC 算，于是两边互相错开、谁都不像个基准）。
  // 这种状态不能信，按「状态不可用」处理并回落公式 —— 宁可多跑一轮，也不要拿脏基准去去重。
  const future = Boolean(state?.lastRunDay) && String(state.lastRunDay) > todayText;
  const stale = !state?.lastRunDay || !state?.lastGroup || future;
  const sameDay = state?.lastRunDay === todayText;

  // 规则 3 / 规则 1：状态不可用，或跨天 → 回落到原公式。
  if (stale || !sameDay) {
    return {
      group: formulaGroup(today),
      rule: stale ? (future ? 'formula(future-state)' : 'formula(stale-state)') : 'formula(new-day)',
      stale,
      exhausted: false,
      ranToday: [],
    };
  }

  // 规则 2：同日 → 取今天还没跑过、且累计最少的组。
  const ranToday = []
    .concat(state.lastGroup ? [state.lastGroup] : [])
    .concat((state.runs ?? []).filter((r) => r.day === todayText).map((r) => r.group));
  const ranSet = new Set(ranToday);
  const notRunToday = GROUPS.filter((g) => !ranSet.has(g));

  if (notRunToday.length > 0) {
    // 尚未跑过的组里，累计次数最少的优先；并列按组序稳定取。
    const group = notRunToday.reduce((best, g) =>
      state.groupRuns?.[g] < state.groupRuns?.[best] ? g : best, notRunToday[0]);
    return { group, rule: 'same-day(unused)', stale: false, exhausted: false, ranToday: [...ranSet] };
  }

  // 三组今天都跑过：取今天/累计最少的一个，并明确标 exhausted。
  const group = GROUPS.reduce((best, g) =>
    (state.groupRuns?.[g] ?? 0) < (state.groupRuns?.[best] ?? 0) ? g : best, GROUPS[0]);
  return { group, rule: 'same-day(exhausted)', stale: false, exhausted: true, ranToday: [...ranSet] };
}

/** 「现在」的**上海时刻**（`YYYY-MM-DD HH:MM`，+08:00 固定偏移）。
 *
 * 为什么要固定偏移而不是 `toISOString()`：`last_run_at` 的日期被当作**上海日**
 * 与「今天」比较（见 `pickGroup`），而 `toISOString()` 给的是 **UTC** 时刻。
 * 两者在 UTC+8 的 00:00–08:00 差一天 —— 凌晨场（00:00 / 03:00 / 06:00）写进去后，
 * 下一轮会把「今天」判成新的一天，从而**绕过当日去重**、按公式重取组。
 * 也不要用 `toLocaleString()`：那会随宿主的 `TZ` 漂移，同一份状态在不同机器上读法不同。
 * 固定 +08:00 与 `parseDay` 的 UTC 日期解析口径互补：写进去是上海日，读出来也是上海日。
 * （中国 1991 年后无夏令时，固定偏移与 `Asia/Shanghai` 等价；不引 `Intl` 以免依赖 ICU 数据。） */
export function nowStamp(instant = Date.now()) {
  const shanghai = new Date(Number(instant) + SHANGHAI_OFFSET_MS);
  return `${isoDay(shanghai)} ${String(shanghai.getUTCHours()).padStart(2, '0')}:${String(shanghai.getUTCMinutes()).padStart(2, '0')}`;
}

function isoDay(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 把一次运行写回状态文件：更新 `last_group` / `last_run_at` / `group_runs`，并追加流水行。
 * 只改文件里那几张状态表，正文说明不动 —— 手改过正文也不会被覆盖。
 */
export function writeState({ group, at, note = '' }, statePath = STATE_PATH) {
  const text = readFileSync(statePath, 'utf8');
  const state = readState(statePath);
  const atText = at ?? nowStamp();
  const dayText = atText.slice(0, 10);

  const runs = { ...emptyRuns(), ...(state.groupRuns ?? {}) };
  runs[group] = (runs[group] ?? 0) + 1;

  // ⚠ 只改「## 状态」一节以内的行。
  //
  // 为什么必须限定区段：文件顶部有一张**说明表**，它的第 2 行就是
  // `| \`last_run_at\` | 最近一次跑的时间（\`YYYY-MM-DD HH:MM\`，UTC+8） | … |`。
  // 旧写法用全文 `replace()` + 无 `m` 标志，只要说明行里出现一个**反引号包裹的真实时刻**
  // （本轮的 `\`2026-10-28 00:05\`` 恰好满足），正则就会先在说明行上命中，
  // 把「取值」写进说明、而真正的取值行**原封不动** —— 2026-10-28 实跑发生过一次：
  // `last_group` 改了、`last_run_at` 与 `group_runs` 都没改，状态就此自相矛盾。
  //
  // 同样的坑 r85 / r86 在**读**侧踩过（说明表被读成取值），这里在**写**侧再踩一次。
  // 结论：读写两侧都必须以「同一节」为边界，不能靠正则的运气。
  const lines0 = text.split('\n');
  const start = lines0.findIndex((l) => /^##\s*状态\s*$/.test(l));
  const isStateRow = (l) => /^\|\s*\`(last_group|last_run_at|group_runs)\`/.test(l);
  let inState = false;
  const lines = lines0.map((l) => {
    if (start >= 0) {
      if (l === lines0[start]) { inState = true; return l; }
      if (inState && /^##\s/.test(l)) inState = false;
    } else {
      // 没有 `## 状态` 节（手写的旧文件）→ 退回「第一条取值形状的行」
      inState = isStateRow(l);
    }
    if (!inState) return l;
    if (isStateRow(l) && l.startsWith('| \`last_group\`') && LAST_GROUP_RE.test(l)) {
      return l.replace(LAST_GROUP_RE, `| \`last_group\` | \`${group}\` |`);
    }
    if (isStateRow(l) && l.startsWith('| \`last_run_at\`') && LAST_RUN_RE.test(l)) {
      return l.replace(LAST_RUN_RE, `| \`last_run_at\` | \`${atText}\` |`);
    }
    if (isStateRow(l) && l.startsWith('| \`group_runs\`') && GROUP_RUNS_RE.test(l)) {
      const runsCell = GROUPS.map((g) => `${g}=${runs[g]}`).join(', ');
      return l.replace(GROUP_RUNS_RE, `| \`group_runs\`（累计） | ${runsCell} |`);
    }
    return l;
  });
  let out = lines.join('\n');

  // 流水表追加在最末一行数据行之后。
  const outLines = out.split('\n');
  let lastData = -1;
  for (let i = 0; i < outLines.length; i += 1) if (RUN_ROW_RE.test(outLines[i])) lastData = i;
  const row = `| ${atText} | ${group} | ${note || '自动记录'} |`;
  if (lastData >= 0) outLines.splice(lastData + 1, 0, row);
  out = outLines.join('\n');

  writeFileSync(statePath, out, 'utf8');
  return { group, at: atText, groupRuns: runs };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { commit: null, at: null, today: null, json: false, group: false, note: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--commit') out.commit = argv[++i];
    else if (a === '--at') out.at = argv[++i];
    else if (a === '--today') out.today = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--group') out.group = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else return { error: `未知参数：${a}` };
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('用法：node scripts/radar-rotation.mjs [--group|--json] [--today YYYY-MM-DD] [--commit A|B|C [--at "YYYY-MM-DD HH:MM"]]');
    return 1;
  }
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('# 用法')[1]?.split('退出码')[0] ?? '');
    return 0;
  }

  // 「今天」也必须是**上海日**：`new Date()` 给的是 UTC 日，与 `last_run_at` 的上海日
  // 在 00:00–08:00 错开一天，会让 CLI 与状态文件互相判成「跨天」。
  const today = args.today ? parseDay(args.today) : parseDay(nowStamp().slice(0, 10));
  if (!today) { console.error(`无效日期：${args.today}`); return 1; }

  if (args.commit) {
    if (!GROUPS.includes(args.commit)) { console.error(`组名必须是 A/B/C，收到：${args.commit}`); return 1; }
    const saved = writeState({ group: args.commit, at: args.at, note: args.note });
    console.log(`已记录：组 ${saved.group} @ ${saved.at}｜累计 ${GROUPS.map((g) => `${g}=${saved.groupRuns[g]}`).join(', ')}`);
    return 0;
  }

  const state = readState();
  const picked = pickGroup(state, today);
  const todayText = isoDay(today);

  if (args.group) { console.log(picked.group); return 0; }
  if (args.json) { console.log(JSON.stringify({ today: todayText, ...picked, state }, null, 2)); return 0; }

  console.log(`今天        : ${todayText}（年积日 ${dayOfYear(today)}，公式取组 = ${formulaGroup(today)}）`);
  console.log(`状态        : last_group=${state.lastGroup ?? '(无)'} last_run_at=${state.lastRunAt ?? '(无)'}${picked.stale ? '  ⚠ 状态不可用，已回落公式' : ''}`);
  console.log(`累计        : ${GROUPS.map((g) => `${g}=${state.groupRuns[g]}`).join(', ')}`);
  console.log(`本轮该跑    : ${picked.group}   （依据：${picked.rule}）`);
  if (picked.ranToday.length) console.log(`今天已跑过  : ${picked.ranToday.join(', ')}`);
  if (picked.exhausted) console.log('⚠ 三组今天都已跑过 —— 不建议再跑，重复劳动不会带来新候选。');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
