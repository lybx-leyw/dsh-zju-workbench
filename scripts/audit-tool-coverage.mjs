#!/usr/bin/env node
/**
 * 生成「上游 provides → 本仓 tool action」的对照表。
 *
 * 判据是**硬编码的映射**，不是模糊匹配：每一条都要指名它由哪个工具、
 * 哪个 action 覆盖。这样清单可复算、可审查。
 */

/** 上游 provides → { tool, action } 或 { kind: 'session' | 'none' } | { kind: 'sourceGap' | 'dropped' } */
const MAP = {
  // ── zdbk ──────────────────────────────────────────────
  'zdbk timetable': { tool: 'campus_zdbk_read', action: 'timetable' },
  'zdbk exams': { tool: 'campus_zdbk_read', action: 'exams' },
  'zdbk grades': { tool: 'campus_zdbk_read', action: 'grades' },
  'zdbk plan list': { tool: 'campus_zdbk_read', action: 'planList' },
  'zdbk plan view': { tool: 'campus_zdbk_read', action: 'planView' },
  'zdbk selection context': { tool: 'campus_zdbk_read', action: 'selectionContext' },
  'zdbk selection courses': { tool: 'campus_zdbk_read', action: 'selectionCourses' },
  'zdbk selection search': { tool: 'campus_zdbk_read', action: 'selectionSearch' },
  'zdbk selection sections': { tool: 'campus_zdbk_read', action: 'selectionSections' },
  'zdbk selection selected': { tool: 'campus_zdbk_read', action: 'selectionSelected' },
  'zdbk selection credits': { tool: 'campus_zdbk_read', action: 'selectionCredits' },
  'zdbk selection select': { tool: 'campus_course_select', action: 'select' },
  'zdbk selection reorder': { tool: 'campus_course_select', action: 'reorder' },
  'zdbk selection drop': { tool: 'campus_course_select', action: 'drop' },
  'zdbk session login': { kind: 'session' },
  'zdbk session status': { kind: 'session' },
  'zdbk session logout': { kind: 'session' },

  // ── xuezai ────────────────────────────────────────────
  'xuezai todos': { tool: 'campus_xuezai_read', action: 'todos' },
  'xuezai course list': { tool: 'campus_xuezai_read', action: 'courseList' },
  'xuezai course view': { tool: 'campus_xuezai_read', action: 'courseView' },
  'xuezai material list': { tool: 'campus_xuezai_read', action: 'materialList' },
  'xuezai homework list': { tool: 'campus_xuezai_read', action: 'homeworkList' },
  'xuezai homework view': { tool: 'campus_xuezai_read', action: 'homeworkView' },
  'xuezai homework submit': { tool: 'campus_homework', action: 'submit' },
  'xuezai homework retract': { tool: 'campus_homework', action: 'retract' },
  'xuezai rollcall': { tool: 'campus_checkin', action: '（无 action，整工具）' },
  'xuezai rollcall number': { tool: 'campus_checkin', action: '（数字点名走同一工具）' },
  'xuezai rollcall status': { tool: 'campus_xuezai_read', action: 'rollcallHistory' },
  'xuezai rollcall history': { tool: 'campus_xuezai_read', action: 'rollcallHistory' },
  'xuezai rollcall all': { tool: 'campus_checkin', action: 'all: true（一次签全部待签）' },
  'xuezai material download': { tool: 'campus_xuezai_read', action: 'materialDownload' },
  'xuezai homework download': { tool: 'campus_xuezai_read', action: 'homeworkDownload' },
  'xuezai session login': { kind: 'session' },
  'xuezai session status': { kind: 'session' },
  'xuezai session logout': { kind: 'session' },

  // ── cc98 ──────────────────────────────────────────────
  'cc98 hot': { tool: 'campus_cc98_read', action: 'hot' },
  'cc98 search': { tool: 'campus_cc98_read', action: 'search' },
  'cc98 user': { tool: 'campus_cc98_read', action: 'user' },
  'cc98 board list': { tool: 'campus_cc98_read', action: 'boardList' },
  'cc98 board topics': { tool: 'campus_cc98_read', action: 'boardTopics' },
  'cc98 board tags': { tool: 'campus_cc98_read', action: 'boardTags' },
  'cc98 board post': { tool: 'campus_post', action: 'post' },
  'cc98 topic view': { tool: 'campus_cc98_read', action: 'topic' },
  'cc98 topic reply': { tool: 'campus_post', action: 'reply' },
  'cc98 topic favorite': { tool: 'campus_react', action: 'favorite' },
  'cc98 topic download': { tool: 'campus_cc98_read', action: 'topicDownload' },
  'cc98 floor like': { tool: 'campus_react', action: 'like / down / unlike' },
  'cc98 floor rate': { tool: 'campus_react', action: 'rate' },
  'cc98 floor rating-reasons': { tool: 'campus_cc98_read', action: 'ratingReasons' },
  'cc98 floor original': { tool: 'campus_cc98_read', action: 'original' },
  'cc98 floor edit': { tool: 'campus_post', action: 'edit' },
  'cc98 private-message list': { tool: 'campus_cc98_read', action: 'messageList' },
  'cc98 private-message view': { tool: 'campus_cc98_read', action: 'messageView' },
  'cc98 private-message send': { tool: 'campus_post', action: 'message' },
  'cc98 account overview': { tool: 'campus_cc98_read', action: 'overview' },
  'cc98 account topics': { tool: 'campus_cc98_read', action: 'myTopics' },
  'cc98 account posts': { tool: 'campus_cc98_read', action: 'myPosts' },
  'cc98 account history': { tool: 'campus_cc98_read', action: 'history' },
  'cc98 account favorites': { tool: 'campus_cc98_read', action: 'favorites' },
  'cc98 account following': { tool: 'campus_cc98_read', action: 'following' },
  'cc98 account feed': { tool: 'campus_cc98_read', action: 'feed' },
  'cc98 account notifications': { tool: 'campus_cc98_read', action: 'notifications' },
  'cc98 account signin': { tool: 'campus_signin', action: '（无 action）' },
  'cc98 account signin-month': { tool: 'campus_cc98_read', action: 'signinMonth' },
  'cc98 session login': { kind: 'session' },
  'cc98 session status': { kind: 'session' },
  'cc98 session logout': { kind: 'session' },

  // ── sztz ──────────────────────────────────────────────
  'sztz credits': { tool: 'campus_sztz_read', action: 'credits' },
  'sztz activity list': { tool: 'campus_sztz_read', action: 'activities' },
  'sztz activity new': { tool: 'campus_sztz_read', action: 'newActivities' },
  'sztz activity mine': { tool: 'campus_sztz_read', action: 'mine' },
  'sztz activity signup': { tool: 'campus_activity', action: 'signup' },
  'sztz activity favorite': { tool: 'campus_activity', action: 'favorite / unfavorite' },
  'sztz projects': { tool: 'campus_sztz_read', action: 'projects' },
  'sztz notices': { tool: 'campus_sztz_read', action: 'notices' },

  // ── tyys ──────────────────────────────────────────────
  'tyys venue list': { tool: 'campus_tyys_read', action: 'venueList' },
  'tyys venue book': { tool: 'campus_venue', action: 'book' },
  'tyys venue order list': { tool: 'campus_tyys_read', action: 'orderList' },
  'tyys venue order cancel': { tool: 'campus_venue', action: 'cancel' },
  'tyys venue notice': { tool: 'campus_tyys_read', action: 'venueNotice' },
  'tyys rollcall history': { tool: 'campus_tyys_read', action: 'rollcallHistory' },
  'tyys session login': { kind: 'session' },
  'tyys session status': { kind: 'session' },
  'tyys session logout': { kind: 'session' },

  // ── pta ───────────────────────────────────────────────
  'pta homework list': { tool: 'campus_pta_read', action: 'setList' },
  'pta homework view': { tool: 'campus_pta_read', action: 'setView' },
  'pta homework start': { kind: 'dropped', note: '开始答题会启动计时，本仓刻意不替用户做' },
  'pta homework finish': { kind: 'dropped', note: '同上' },
  'pta problem view': { tool: 'campus_pta_read', action: 'problemView / problemList' },
  'pta problem save': { tool: 'campus_answer', action: 'save' },
  'pta problem submit': { tool: 'campus_answer', action: 'submit' },
  'pta submission list': { tool: 'campus_pta_read', action: 'submissionList' },
  'pta submission view': { tool: 'campus_pta_read', action: 'submissionView' },
  'pta reconcile': { tool: 'campus_pta_read', action: 'reconcile' },
  'pta session login': { kind: 'session' },
  'pta session status': { kind: 'session' },
  'pta session logout': { kind: 'session' },
  'pta session import-cookie': { kind: 'session' },

  // ── lab ───────────────────────────────────────────────
  'lab timetable': { tool: 'campus_lab_read', action: 'timetable' },
  'lab courses': { tool: 'campus_lab_read', action: 'courseList' },
  'lab labs': { tool: 'campus_lab_read', action: 'labList' },
  'lab selected': { tool: 'campus_lab_read', action: 'mySelections' },
  'lab select': { tool: 'campus_lab_select', action: 'select / cancel' },
  'lab notices': { tool: 'campus_lab_read', action: 'notices' },
  'lab session login': { kind: 'session' },
  'lab session status': { kind: 'session' },
  'lab session logout': { kind: 'session' },

  // ── classroom / zhiyun ────────────────────────────────
  'zhiyun search courses': { tool: 'campus_classroom_read', action: 'searchCourses / courseList' },
  'zhiyun search lessons': { tool: 'campus_classroom_read', action: 'lessonList' },
  'zhiyun timetable': { tool: 'campus_classroom_read', action: 'courseList' },
  'zhiyun search resources': { tool: 'campus_classroom_read', action: 'resourceList' },
  'zhiyun search subtitles': { tool: 'campus_classroom_read', action: 'captionSearch' },
  'zhiyun live status': { tool: 'campus_classroom_read', action: 'liveStatus' },
  'zhiyun live text': { tool: 'campus_classroom_read', action: 'liveText' },
  'zhiyun text': { tool: 'campus_classroom_read', action: 'liveText' },
  'zhiyun download': { kind: 'gap' },
  'zhiyun setup': { kind: 'sourceGap', note: 'FFmpeg / ASR 模型安装动作未做' },
  'zhiyun check': { kind: 'sourceGap', note: '部分' },
  'zhiyun trans audio': { kind: 'sourceGap', note: 'transcribeAudio 在，但无装配方注入 ASR 内核' },
  'zhiyun live start': { kind: 'sourceGap', note: 'liveStart 在，直播链路未真机验证' },
  'zhiyun live stop': { kind: 'sourceGap', note: '同上' },
  'zhiyun session login': { kind: 'session' },
  'zhiyun session status': { kind: 'session' },
  'zhiyun session logout': { kind: 'session' },

  // ── 小包 ──────────────────────────────────────────────
  'notice list': { tool: 'campus_notice_read', action: 'list' },
  'notice view': { tool: 'campus_notice_read', action: 'view' },
  'notice new': { tool: 'campus_notice_read', action: 'new' },
  'notice sources': { tool: 'campus_notice_read', action: 'sources' },
  'chalaoshi search': { tool: 'campus_chalaoshi_read', action: 'search' },
  'chalaoshi teacher': { tool: 'campus_chalaoshi_read', action: 'teacher' },
  'chalaoshi course': { tool: 'campus_chalaoshi_read', action: 'course' },
  'ebook search': { tool: 'campus_ebook_read', action: '（无 action）' },
  'yjsy timetable': { tool: 'campus_yjsy_read', action: '（无 action）' },
  'webvpn probe': { kind: 'noTool', note: '库函数已有（probe.js），更适合设置页诊断而非 agent 工具' },
  'webvpn check': { kind: 'noTool', note: '同上' },
  'webvpn url encode': { kind: 'noTool', note: '同上（纯本地计算）' },
  'webvpn url decode': { kind: 'noTool', note: '同上' },
  'webvpn session login': { kind: 'session' },
  'webvpn session status': { kind: 'session' },
  'webvpn session logout': { kind: 'session' },
  'webvpn session import-cookie': { kind: 'session' },
  'zjuam session login': { kind: 'session' },
  'zjuam session status': { kind: 'session' },
  'zjuam session logout': { kind: 'session' },

  // ── chaoxing / cnki / doc ─────────────────────────────
  'chaoxing course list': { tool: 'campus_xxt_read', action: 'courseList' },
  'chaoxing chapter list': { tool: 'campus_xxt_read', action: 'chapterList' },
  'chaoxing material list': { tool: 'campus_xxt_read', action: 'materialList' },
  'chaoxing material download': { tool: 'campus_xxt_read', action: 'materialDownload' },
  'chaoxing video list': { tool: 'campus_xxt_read', action: 'videoList' },
  'chaoxing video download': { tool: 'campus_xxt_read', action: 'videoDownload' },
  'chaoxing homework list': { tool: 'campus_xxt_read', action: 'homeworkList' },
  'chaoxing session login': { kind: 'session' },
  'chaoxing session status': { kind: 'session' },
  'chaoxing session logout': { kind: 'session' },

  'doc text': { tool: 'campus_doc', action: 'text' },
  'doc pdf': { tool: 'campus_doc', action: 'pdf' },
  'doc pages': { tool: 'campus_doc', action: 'pages' },
  'doc find': { tool: 'campus_doc', action: 'find' },

  'cnki search': { kind: 'dropped', note: '用户明说不做知网' },
  'cnki download': { kind: 'dropped', note: '同上' },
  'cnki session login': { kind: 'session' },
  'cnki session status': { kind: 'session' },
  'cnki session logout': { kind: 'session' },
};

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const LIB = 'packages/vendor/zju-assistant/core/zju/lib';
const all = [];
for (const dir of readdirSync(LIB)) {
  let j;
  try { j = JSON.parse(readFileSync(path.join(LIB, dir, 'module.json'), 'utf8')); } catch { continue; }
  for (const p of j.provides ?? []) all.push({ module: j.name, provides: p });
}

const buckets = { covered: [], gap: [], sourceGap: [], session: [], dropped: [], noTool: [], unmapped: [] };
for (const { provides } of all) {
  const m = MAP[provides];
  if (!m) { buckets.unmapped.push(provides); continue; }
  if (m.tool) buckets.covered.push({ provides, ...m });
  else if (m.kind === 'session') buckets.session.push(provides);
  else if (m.kind === 'dropped') buckets.dropped.push({ provides, ...m });
  else if (m.kind === 'noTool') buckets.noTool.push({ provides, ...m });
  else if (m.kind === 'sourceGap') buckets.sourceGap.push({ provides, ...m });
  else buckets.gap.push(provides);
}

/**
 * 自检：映射表里点名的每个工具都必须**真的存在于 packages/tool 下**。
 *
 * # 为什么必须有这一步
 *
 * 2026-11-12 我出过一次错：清单说「CC98 读侧 21 条全缺」，实际上
 * `campus_cc98_read` 早就做完了。根因是**枚举工具名时用了 `[a-z_]+`，
 * 而工具名里有数字**（`campus_cc98_read` 的 `98`），于是脚本看不见它。
 *
 * 那次错误让清单数字错了 22 条。这个自检能挡住同类问题：只要映射表引用了
 * 一个不存在的工具，就直接报错。
 */
const TOOL_DIR = 'packages/tool';
const existing = new Set();
for (const dir of readdirSync(TOOL_DIR)) {
  const srcDir = path.join(TOOL_DIR, dir, 'src');
  if (!existsSync(srcDir)) continue;
  for (const file of readdirSync(srcDir).filter((x) => x.endsWith('.js'))) {
    const text = readFileSync(path.join(srcDir, file), 'utf8');
    // ⚠️ 字符类必须含 0-9：`campus_cc98_read`。
    // 前缀也要含 `raw`：`raw_transcript` / `raw_slides` 是 2026-11-12 新增的
    // 「原始素材」工具组，只在 campus|study 里找会漏掉它们。
    for (const m of text.matchAll(/name:\s*['"]((?:campus|study|raw)_[a-z0-9_]+)['"]/g)) existing.add(m[1]);
  }
}

const referenced = new Set(
  Object.values(MAP).filter((m) => m.tool).map((m) => m.tool),
);
const phantom = [...referenced].filter((name) => !existing.has(name));
if (phantom.length) {
  console.error(`\n❌ 映射表引用了不存在的工具：${phantom.join(', ')}`);
  console.error('   要么改映射，要么那个工具确实没做 —— 先查清再继续。');
  process.exit(1);
}

console.log(`总计 ${all.length} 条`);
console.log(`工具包里实际存在 ${existing.size} 个工具；映射表引用了 ${referenced.size} 个\n`);
for (const [k, label] of [
  ['covered', '✅ 已有 tool 覆盖'],
  ['gap', '⬜ A 类：只缺 tool'],
  ['sourceGap', '🟧 B 类：source 也要补'],
  ['noTool', '⚪ 不需要 tool（库函数/设置页）'],
  ['dropped', '⛔ C 类：明确不做'],
  ['session', '⚙️ 会话动作（无需 tool）'],
  ['unmapped', '❓ 未映射'],
]) {
  console.log(`${label}: ${buckets[k].length}`);
}
console.log('');
const sum = Object.values(buckets).reduce((a, b) => a + b.length, 0);
console.log(`核对: ${sum} (应为 ${all.length})`);
console.log('');
console.log('=== A 类明细 ===');
for (const p of buckets.gap) console.log('  ' + p);
console.log('');
console.log('=== B 类明细 ===');
for (const x of buckets.sourceGap) console.log(`  ${x.provides}  — ${x.note}`);
console.log('');
if (buckets.unmapped.length) {
  console.log('=== 未映射（必须修）===');
  for (const p of buckets.unmapped) console.log('  ' + p);
}
