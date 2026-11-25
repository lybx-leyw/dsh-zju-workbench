import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const GROUPS = ['client', 'core', 'source', 'tool', 'preset'];

/**
 * 保留集里每个包都真实存在，且**不会在运行时去加载不存在的本仓包**。
 *
 * # 为什么需要这条
 *
 * 2026-11-18 清理仓库时按「package.json 依赖 + cordis.patch.yml 插件名」做可达分析，
 * 归档了 125 个包。结果出题链一道题都产不出来，界面只显示 phase=partial。
 *
 * 根因：`packages/core/study/src/core-question-backend.js` 用**字符串**动态
 * import 四个包，而 `core/study/package.json` 从未声明它们。声明式依赖图看不到
 * 这条边，`tool/doc` 的 `inject: ['zwDoc']` 同理（服务由 `core/doc` 提供）。
 *
 * 所以这里从三个角度兜：
 *   1. 源码里出现的 `@lybx-leyw/dsh-zju-*` 包名，要么是真的包，要么明确标为文档引用；
 *   2. 每个包的 `inject` 声明所要求的服务，必须能由保留集里的某个 `provide` 满足；
 *   3. 动态 `load('@lybx-leyw/...')` 的目标必须存在。
 */

async function ownPackages() {
  const found = new Map();
  for (const group of GROUPS) {
    let entries;
    try { entries = await readdir(path.join(root, 'packages', group), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(path.join(root, 'packages', group, entry.name, 'package.json'), 'utf8'));
        found.set(manifest.name, path.join(root, 'packages', group, entry.name));
      } catch { /* not a package */ }
    }
  }
  return found;
}

async function walkSource(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkSource(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('保留集里不存在「引用了本仓包名但那个包不在」的源码', async () => {
  const own = await ownPackages();
  // 下限随退役收缩：2026-11 归档四个页面与它们独占的 core 包后，保留集从 37 降到 30。
  assert.ok(own.size >= 25, `只读到 ${own.size} 个包，扫描可能失效`);

  const problems = [];
  for (const [name, dir] of own) {
    for (const file of await walkSource(path.join(dir, 'src'))) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/(@lybx-leyw\/dsh-zju-[a-z0-9-]+|@lybx-leyw\/dsh-pages)/g)) {
        const specifier = match[0];
        if (own.has(specifier) || specifier === '@lybx-leyw/dsh-pages') continue;
        const lineStart = text.lastIndexOf('\n', match.index) + 1;
        const lineEnd = text.indexOf('\n', match.index);
        const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        const inComment = /^\s*(?:\*|\/\/|\/\*)/.test(line);
        if (inComment) continue;
        // 模板拼接（`dsh-zju-page-${id}`）不是固定包名：它在运行时由 id 决定，
        // 且拼出来的名字只用于 bundle 名，不参与 import。跳过。
        const isTemplate = /`[^`]*\$\{/.test(line) && /\$\{/.test(line);
        if (isTemplate) continue;
        // 面向用户的**错误提示文案**里提到包名是允许的：它告诉运维该装哪个包，
        // 不是一次 import。这类只出现在字符串字面量中，且同处带有「需要/未启用/
        // 请先启用」之类的措辞。
        if (/需要|未启用|请先启用|请安装|缺/.test(line)) continue;
        problems.push(`${path.relative(root, file)}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(problems, [], `这些源码位置引用了不存在的本仓包：\n${problems.join('\n')}`);
});

/**
 * 已知的「可选端口」：这些服务缺失时插件**仍应工作**，只是对应能力降级。
 *
 * 理由在包的源码注释里写明了（`core/classroom-generate` 的「端口注入」一节：
 * 「缺任何一个端口都不阻止 start：管线在需要它的那一段降级」）。
 *
 * 列在这里而不是放行全部，是为了让新增的可选端口必须显式登记 —— 否则
 * 「可选」会变成「悬空也没人管」的托词。
 */
const OPTIONAL_PORTS = new Map([
  ['zwClassroomStudio', 'core/classroom-generate：无 studio 时走确定性 planScenes 兜底'],
  ['zwClassroomAgent', 'core/classroom-generate：无 agent 时 agent 段降级'],
  ['zwClassroomPbl', 'core/classroom-generate：无 pbl 时 PBL 段降级'],
  ['zwClassroomMedia', 'core/classroom-generate：无 media 时不出配音配图'],
  ['zwClassroomVault', 'core/classroom-generate：无 vault 时产物不落段'],
]);

test('每个 inject 声明的服务都能被保留集里的某个包满足（可选端口须显式登记）', async () => {
  const own = await ownPackages();
  const provided = new Set([
    // 宿主/DSH 提供的服务，不是本仓的包。
    'tools', 'llm', 'attachments', 'agentDefaultModel', 'profileContext',
    'storageDomain', 'connection', 'loader', 'agentPresets', 'slots', 'modules', 'remote',
  ]);
  for (const [, dir] of own) {
    for (const file of await walkSource(path.join(dir, 'src'))) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/provide\(\s*['"]([A-Za-z][\w.]*)['"]/g)) provided.add(match[1]);
    }
  }
  const problems = [];
  for (const [name, dir] of own) {
    let entry;
    try { entry = await readFile(path.join(dir, 'src', 'index.js'), 'utf8'); } catch { continue; }
    const match = /export const inject\s*=\s*\[([^\]]*)\]/.exec(entry);
    if (!match) continue;
    const services = [...match[1].matchAll(/'([^']+)'/g)].map(row => row[1]);
    for (const service of services) {
      if (provided.has(service)) continue;
      if (OPTIONAL_PORTS.has(service)) continue;
      problems.push(`${name}: inject 声明了 '${service}'，但保留集里没有包 provide 它`);
    }
  }
  assert.deepEqual(problems, [], `服务依赖悬空（挂载后该插件不会激活）：\n${problems.join('\n')}`);
});

test('登记的「可选端口」确实没有提供者，且数量没有失控', async () => {
  // 这条防两件事：登记表腐烂（端口其实已经有人提供），以及有人把硬依赖
  // 随手塞进 OPTIONAL_PORTS 让守卫闭嘴。
  const own = await ownPackages();
  const provided = new Set();
  for (const [, dir] of own) {
    for (const file of await walkSource(path.join(dir, 'src'))) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/provide\(\s*['"]([A-Za-z][\w.]*)['"]/g)) provided.add(match[1]);
    }
  }
  for (const service of OPTIONAL_PORTS.keys()) {
    assert.equal(provided.has(service), false, `${service} 已经有提供者了，应从 OPTIONAL_PORTS 移除`);
  }
  assert.ok(OPTIONAL_PORTS.size <= 8, `可选端口登记了 ${OPTIONAL_PORTS.size} 个，偏多 —— 确认它们真的是「可选」而不是硬依赖`);
});

test('动态 load 的本仓包名都指向真实存在的包', async () => {
  const own = await ownPackages();
  const problems = [];
  for (const [, dir] of own) {
    for (const file of await walkSource(path.join(dir, 'src'))) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/load\(\s*['"](@lybx-leyw\/dsh-zju-[a-z0-9-]+)['"]/g)) {
        if (!own.has(match[1])) problems.push(`${path.relative(root, file)}: load('${match[1]}')`);
      }
    }
  }
  assert.deepEqual(problems, [], `动态加载目标不存在（运行时会静默失败）：\n${problems.join('\n')}`);
});
