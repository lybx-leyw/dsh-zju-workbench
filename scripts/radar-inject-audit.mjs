/**
 * 检查器：上游 DSH 包的 `dsh.client.inject` 有没有 `peerDependencies` 背书。
 *
 * # 为什么需要这条
 *
 * 骨架是「锁版引入上游 DSH 包 + 外围兼容层」。锁版能不能装，`npm install` 会告诉你；
 * 但**装得上 ≠ 跑得起来**：
 *
 *   上游包在 `dsh.client.inject` 里声明「我要 `@deepseek-ai/dsh-client-ui-slots`」，
 *   却没有把它的名字写进 `peerDependencies`。于是 npm 只装 `dependencies` 里的东西，
 *   宿主代际不对时 **`npm install` 一声不报**，等到运行时才找不到那个服务。
 *
 * r80 只验到「依赖在 npm 上存在」（存在层）；本检查器补的是**声明层**：
 * 一个包说自己要 inject 什么，就必须把那些东西声明成 peer —— 否则锁版的人无从判断
 * 「这个包到底要什么代际的宿主」。
 *
 * # 判定
 *
 * - `INJECT_UNDECLARED`：inject 了某个 `@deepseek-ai/*`，但 `peerDependencies` 里没有它。
 * - 只看 `dsh.client.inject` 按 `@deepseek-ai/*` 前缀写的条目；
 *   `locale` / `slots` 这类无前缀写法单独列为「未判定」，不参与退出码。
 * - 只有「自带 `dsh` 元数据」的包才判（`dsh.bundle` / `dsh.client` 至少有一个）——
 *   普通 npm 库（cheerio、zod…）没有 `dsh` 字段，天然不适用，扫它们只会淹掉结论。
 *
 * # 用法
 *
 *   node scripts/radar-inject-audit.mjs                    # 扫骨架锁版引入的上游包
 *   node scripts/radar-inject-audit.mjs dsh-context-lens   # 只查指定包
 *   node scripts/radar-inject-audit.mjs --json             # 机器可读
 *   node scripts/radar-inject-audit.mjs --all              # 连普通库一起列（含 N/A）
 *
 * 需要联网（npm registry）。退出码：0 = 无非声明；1 = 存在 INJECT_UNDECLARED。
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREFIX = '@deepseek-ai/';

/**
 * 从骨架的 package.json 里抽出「哪些包是从上游锁版引入的」，连同锁定的版本。
 *
 * 同一包在不同骨架里可能锁不同版本（例如 `minisearch` 7.1.2 / 7.2.0）——
 * 全部保留，逐个判，不合并成一个「大概」。
 */
async function lockedUpstreams() {
  const dir = path.join(ROOT, 'packages');
  const entries = await readdir(dir, { withFileTypes: true });
  const locked = new Map(); // name -> Set<version>
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-radar-')) continue;
    let pkg;
    try {
      pkg = JSON.parse(await readFile(path.join(dir, entry.name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      if (!locked.has(name)) locked.set(name, new Set());
      locked.get(name).add(version);
    }
  }
  return [...locked.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, versions]) => ({ name, versions: [...versions].sort() }));
}

/** 读一份包的元数据（npm registry）；`want` 指定版本时优先用它，否则用 latest。 */
async function fetchMeta(name, want) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  const response = await fetch(url);
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const body = await response.json();
  const version = (want && body.versions?.[want])
    ? want
    : body['dist-tags']?.latest;
  const manifest = body.versions?.[version] ?? {};
  const hasDsh = Boolean(manifest.dsh);
  const latestTag = body['dist-tags']?.latest;
  return {
    name,
    version,
    latest: latestTag,
    drifted: Boolean(want) && Boolean(latestTag) && want !== latestTag,
    license: manifest.license ?? null,
    peerDependencies: manifest.peerDependencies ?? {},
    inject: manifest.dsh?.client?.inject ?? [],
    hasPatch: Boolean(manifest.dsh?.bundle?.patch),
    applicable: hasDsh,
  };
}

/**
 * 对一份元数据判定（纯函数，供单测直接调用）。
 *
 * @param meta - `{ name, version, peerDependencies, inject, hasPatch, applicable }`。
 * @returns 判定结果。
 */
export function audit(meta) {
  const peers = new Set(Object.keys(meta.peerDependencies ?? {}));
  const inject = meta.inject ?? [];
  const scoped = inject.filter(item => item.startsWith(PREFIX));
  const undeclared = scoped.filter(item => !peers.has(item));
  const unscoped = inject.filter(item => !item.startsWith(PREFIX));
  return {
    name: meta.name,
    version: meta.version,
    drifted: meta.drifted,
    applicable: meta.applicable,
    injectCount: inject.length,
    peerCount: peers.size,
    hasPatch: meta.hasPatch,
    undeclared,
    unscoped,
    verdict: !meta.applicable
      ? 'N/A'
      : (undeclared.length ? 'INJECT_UNDECLARED' : 'OK'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const showAll = args.includes('--all');
  const names = args.filter(arg => !arg.startsWith('--'));

  const targets = names.length
    ? names.map(name => ({ name, versions: [] }))
    : await lockedUpstreams();

  const rows = [];
  for (const target of targets) {
    const wants = target.versions.length ? target.versions : [null];
    for (const want of wants) {
      const meta = await fetchMeta(target.name, want);
      if (meta.error) {
        rows.push({ name: target.name, version: want ?? '?', verdict: 'UNREACHABLE', detail: meta.error });
        continue;
      }
      rows.push(audit(meta));
    }
  }

  const bad = rows.filter(row => row.verdict === 'INJECT_UNDECLARED');
  const judged = rows.filter(row => row.verdict === 'OK' || row.verdict === 'INJECT_UNDECLARED');
  const na = rows.filter(row => row.verdict === 'N/A');
  const dshPkgs = new Set(judged.map(row => row.name));

  if (asJson) {
    console.log(JSON.stringify({ rows, summary: { judged: judged.length, bad: bad.length, na: na.length } }, null, 2));
  } else {
    const shown = showAll ? rows : rows.filter(row => row.verdict !== 'N/A');
    console.log(
      `骨架锁版引入 ${new Set(rows.map(r => r.name)).size} 个包 → ${rows.length} 个「包@版本」；`
      + `其中带 dsh 元数据的 ${judged.length} 个\n`,
    );
    for (const row of shown) {
      if (row.verdict === 'UNREACHABLE') {
        console.log(`⚠ ${row.name}: 取不到元数据（${row.detail}）`);
        continue;
      }
      if (row.verdict === 'N/A') {
        console.log(`· ${row.name}@${row.version}  普通 npm 库，不适用`);
        continue;
      }
      const mark = row.verdict === 'OK' ? '✅' : '❌';
      const drift = row.drifted ? `  (锁的版本，latest 是 ${row.latest})` : '';
      const detail = row.verdict === 'OK'
        ? `inject ${row.injectCount} / peer ${row.peerCount}`
        : `inject ${row.injectCount} / peer ${row.peerCount}，无 peer 背书 ${row.undeclared.length}/${row.injectCount} 条：`
          + row.undeclared.map(item => item.replace(PREFIX, '')).join(', ');
      console.log(`${mark} ${row.name}@${row.version}${drift}  ${detail}`);
      if (row.unscoped?.length) {
        console.log(`     （无前缀写法，未判定：${row.unscoped.join(', ')}）`);
      }
    }
    const undeclaredHosts = new Set(bad.flatMap(row => row.undeclared));
    console.log('');
    console.log(`涉及 DSH 插件包 ${dshPkgs.size} 个，其中 INJECT_UNDECLARED：${bad.length} 个`);
    console.log(`共 ${undeclaredHosts.size} 个宿主服务被 inject 却没人声明成 peer`);
    if (!showAll && na.length) console.log(`（另有 ${na.length} 个普通 npm 库不适用，用 --all 查看）`);
  }

  if (bad.length) process.exitCode = 1;
}

// 被测试 import 时不执行（`process.argv[1]` 指向单测文件）。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
