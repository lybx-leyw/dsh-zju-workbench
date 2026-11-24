#!/usr/bin/env node
/**
 * 把本机记忆区（~/.yonkik）脱敏成可入仓的**初始记忆种子**。
 *
 * # 为什么要有这个脚本
 *
 * 记忆区是真机探索出来的，里面有大量**只对探索者本人成立**的东西：
 * 学号、真名、本地绝对路径、上过哪些课、登录态 cookie。这些东西留在本地是资产，
 * 进了公开仓库就是泄露。所以「附赠种子」不能靠手工挑，必须靠一个**可复跑、
 * 可复核**的脚本产出 —— 下次重新导出时，脱敏规则仍然是同一套。
 *
 * # 保留什么 / 丢弃什么
 *
 * 保留（**知识**）：
 *   sites/<key>/wiki.md        接口与鉴权手册
 *   sites/<key>/endpoints.json 端点清单
 *   sites/<key>/site.json      元数据（状态 / 鉴权类型 / 限流）
 *   sites/_dir.md              一行式目录
 *   sites/_playbook.md         跨站可迁移经验
 *   sites/_sso.json            CAS 家族归类
 *   sites/default-sites.json   默认站点集
 *   MEMORY.md                  目标完成记录（会脱敏）
 *
 * 丢弃（**不是知识**）：
 *   state.json / token.json    登录态 cookie 与 JWT
 *   *_login/ _scratch/ _downloads/
 *   my-courses.json profile.json 等个人读数
 *   _*.md 审计文档（过程产物，含本地路径与个人上下文）
 *   截图 / PDF / HTML 快照
 *
 * # 脱敏规则
 *
 * 1. 学号（10 位、3 开头）→ \`<学号>\`
 * 2. 真名 → \`<姓名>\`
 * 3. 本地绝对路径 → \`<本地路径>\`
 * 4. 「已验证实例」整节删除（见下方 README 的说明）
 * 5. 个人课程 / 教师名 → 占位
 *
 * # 用法
 *
 *   node scripts/yonkik-export-seed.mjs [--source ~/.yonkik] [--dest <dir>] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SOURCE = path.resolve(argOf('source', path.join(os.homedir(), '.yonkik')));
const DEST = path.resolve(argOf('dest', path.join(ROOT, 'packages/yonkik/yonkik-init/memory')));
const DRY = args.includes('--dry');

/** 只复制这些文件名（各站目录内）。 */
const KEEP_PER_SITE = ['wiki.md', 'endpoints.json', 'site.json'];
/** 这些顶层条目整份复制。 */
const KEEP_TOP = ['_index.json', '_dir.md', '_playbook.md', '_sso.json', 'default-sites.json'];

/**
 * 额外的敏感词（真人姓名等），由调用方给出，**不写进本文件**。
 *
 * 为什么：这个仓库是公开的，把某个人的真名写进脱敏脚本自身，等于把要脱敏的
 * 目标一起发布了 —— 脚本反而成了泄露源。所以具体姓名从外部传入：
 *
 *   YONKIK_REDACT_NAMES="张三,李四" node scripts/yonkik-export-seed.mjs
 *
 * 结构化的姓名字段（下面 RULES 里那条 `"xm"`）不需要点名，规则本身就能覆盖。
 */
const EXTRA_NAMES = (process.env.YONKIK_REDACT_NAMES ?? '')
  .split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);

/** 脱敏规则：按顺序应用，后者覆盖前者。 */
const RULES = [
  // 学号：浙大 10 位、3 开头。避免误伤普通数字（要求前后不是数字）。
  { re: /(?<!\d)3\d{9}(?!\d)/g, to: '<学号>' },
  // 外部点名的真名（命令行给，不进仓库）。
  ...EXTRA_NAMES.map(name => ({ re: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to: '<姓名>' })),
  // 结构化姓名字段：教务 / 用户信息接口的 `xm`（姓名）。
  { re: /("xm"\s*:\s*")[^"]{2,10}(")/g, to: '$1<姓名>$2' },
  // 本地绝对路径：Windows 与 POSIX 两种写法。
  // Windows 盘符路径。反斜杠可能被 markdown 转义成两个（`C:\\\\Users\\\\x`），
  // 所以分隔符用 [\\/]{1,4} —— 一个正则同时覆盖 `C:\\Users\\x`、`C:\\\\Users\\\\x`、`C:/Users/x`。
  { re: /[A-Za-z]:[\\/]{1,4}Users[\\/]{1,4}[^\s'"`<>|]+/g, to: '<本地路径>' },
  // POSIX 家目录。
  { re: /\/Users\/[A-Za-z0-9._-]+\//g, to: '<本地路径>/' },
  { re: /\/home\/[A-Za-z0-9._-]+\//g, to: '<本地路径>/' },
];

/**
 * 整节删除的标题（含该节到下一个同级或更高级标题之前）。
 *
 * 为什么要删「已验证实例」：那些小节写的是**探索者本人**上过哪门课、哪位老师、
 * 拿过哪些作业材料。它对读者没有复用价值（那是别人的选课），却会暴露探索者的
 * 学习记录。而「这条接口经过实测」这件事可以用一句脱敏的说明表达，不需要真课名。
 */
const DROP_SECTIONS = [
  /^#{2,4} 已验证实例.*$/m,
];

/** 行级删除：目录里指向上述小节的一行。 */
const DROP_LINES = [
  /^- 已验证实例.*$/gm,
];

function sanitize(text) {
  let out = text;
  for (const { re, to } of RULES) out = out.replace(re, to);
  for (const heading of DROP_SECTIONS) out = dropSection(out, heading);
  for (const line of DROP_LINES) out = out.replace(line, '');
  return out.replace(/\n{3,}/g, '\n\n');
}

/** 删掉一个 markdown 小节（标题行 + 到下一个同级或更高级标题之前）。 */
function dropSection(text, headingRe) {
  const m = headingRe.exec(text);
  if (!m) return text;
  const level = (m[0].match(/^#+/) ?? ['##'])[0].length;
  const rest = text.slice(m.index + m[0].length);
  const nextRe = new RegExp('^#{1,' + level + '} ', 'm');
  const next = nextRe.exec(rest);
  const end = next ? m.index + m[0].length + next.index : text.length;
  return text.slice(0, m.index).replace(/\n?$/, '\n') + text.slice(end);
}

/** 递归列出文件，跳过被排除的目录。 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (/^_(login|scratch|downloads)$/.test(entry.name)) continue;
      if (entry.name === 'node_modules') continue;
      walk(path.join(dir, entry.name), out);
    } else out.push(path.join(dir, entry.name));
  }
  return out;
}

const sitesDir = path.join(SOURCE, 'sites');
if (!fs.existsSync(sitesDir)) {
  console.error('找不到记忆区：' + SOURCE);
  process.exit(1);
}

const written = [];
const skipped = [];
function emit(rel, content) {
  const target = path.join(DEST, rel);
  if (!DRY) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  written.push(rel);
}

for (const name of fs.readdirSync(sitesDir)) {
  if (name.startsWith('_')) continue;
  const dir = path.join(sitesDir, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of KEEP_PER_SITE) {
    const src = path.join(dir, file);
    if (!fs.existsSync(src)) { skipped.push(path.join(name, file)); continue; }
    emit(path.join('sites', name, file), sanitize(fs.readFileSync(src, 'utf8')));
  }
}

for (const file of KEEP_TOP) {
  const src = path.join(sitesDir, file);
  if (!fs.existsSync(src)) continue;
  emit(path.join('sites', file), sanitize(fs.readFileSync(src, 'utf8')));
}

/**
 * MEMORY.md 的固定前言。
 *
 * 放在导出器里而不是手改 memory/MEMORY.md：这份文件每次导出都会被覆盖，
 * 手写的前言会在下一次导出时消失 —— 而这条警告恰恰是最不能丢的那一条。
 */
const MEMORY_PREAMBLE = [
  '',
  '> ## ⚠️ 先读这一段：记忆是**过去的实测**，不是当前事实',
  '>',
  '> 这份记忆来自**另一台机器、另一个时间点**的探索。里面每一条「已验证」「实测通过」',
  '> 都只说明**当时**在**那台机器**上成立。',
  '>',
  '> **环境会变，记忆未必仍然准确**：站点改版、接口下线、鉴权方式调整、学校换系统、',
  '> 网络位置不同 —— 任何一条都能让一条「已验证」的结论失效。',
  '>',
  '> 所以：',
  '>',
  '> 1. **拿它当假设，不当结论。** 动手前用一次真实请求确认，别直接按记忆写死逻辑。',
  '> 2. **发现不符就以实测为准**，并把记忆改掉 —— 记忆的价值在于持续被修正。',
  '> 3. **记忆里的「已验证」不是承诺。** 它记录的是某次探索的结果，不是担保今天仍可用。',
  '>',
  '> 记忆保留，但**必须重新验证**。',
  '',
].join('\n');

const memSrc = path.join(SOURCE, 'MEMORY.md');
if (fs.existsSync(memSrc)) {
  const body = sanitize(fs.readFileSync(memSrc, 'utf8'));
  // 插在一级标题之后，保证「先读这一段」确实是第一眼看到的。
  const firstLineEnd = body.indexOf('\n');
  const spliced = firstLineEnd < 0
    ? body + MEMORY_PREAMBLE
    : body.slice(0, firstLineEnd + 1) + MEMORY_PREAMBLE + body.slice(firstLineEnd + 1);
  emit('MEMORY.md', spliced);
}

console.log(JSON.stringify({
  source: SOURCE, dest: DEST, dry: DRY,
  written: written.length, skipped: skipped.length,
  files: written.slice(0, 6),
}, null, 2));
