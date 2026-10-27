/**
 * 检查器：骨架里锁的版本，**对着哪个宿主**是成立的？
 *
 * # 为什么需要这条
 *
 * r80（存在层/共存层）与 r81（声明层）之后，还剩下一个没人回答的问题：
 *
 * > `packages/dsh-radar-X/package.json` 里锁的那些版本，**今天**还满足上游自己声明的 peer 区间吗？
 *
 * 三件事叠加，让这个问题无法靠 `npm` 回答：
 *
 *   1. **骨架是快照，上游是流水。** 锁版那一刻 `peer` 区间是满足的（「⑥ 可锁版」这道门），
 *      但上游之后可以随时 PATCH 一次、把 peer 收紧 —— 锁版**依然安静通过** `npm install`，
 *      直到运行时 `ctx` 里没有那个服务。
 *   2. **宿主窗口是复数的。** `runtime.lock.json` 的 `hostVersions` 是两个版本
 *      （`0.2.0-rc.2` / `0.2.1-alpha.1`），而不是一个。上游 peer 写 `^0.2.1-rc.2` 时，
 *      **一个宿主满足、另一个不满足** —— 只报「不相容」会丢掉这个区别。
 *   3. **宿主包不在 npm 的默认视野里。** 直接对 `@deepseek-ai/dsh-client-ui-slots` 发
 *      `registry.npmjs.org` 请求，在只装了依赖的环境里会回落成 **本地代理的假版本**
 *      （r83 实测：`128.0.1`）—— 拿不到真实元数据时，不能把 `satisfies()` 的
 *      `false` 当成「不相容」，那只是「没查到」。
 *
 * 所以本检查器只做一件事：**把每条锁版依赖映射到「上游当前发布的 peer 区间」，
 * 再逐一对 `runtime.lock.json` 里的每个宿主求值**，给出 `OK / DRIFT / UNKNOWN` 三类结论。
 *
 * # 判定
 *
 * - `OK`：所有可判宿主都满足。`hosts: { …: true }`。
 * - `DRIFT`：至少一个宿主**确定**不满足，且至少对另一个宿主判断有依据。
 *   这也是 r83 记下的「宿主版本窗口」问题的**可计算形态**。
 * - `UNKNOWN`：取不到上游元数据（离线 / 404 / 代理假版本），或区间写法本工具不认。
 *   **UNKNOWN 不进退出码** —— 它不是「不相容」。
 *
 * 「是否所有宿主都满足」单独放 `allHostsOk`：`hosts` 里只要有 `null`（判断无依据），
 * `allHostsOk` 就是 `false`，但它**不算 DRIFT**。两者混在一起，报告会说谎。
 *
 * # 语义版本注意
 *
 * 宿主版本带预发布号（`rc.N` / `alpha.N`），上游区间也带。按 semver 规范，
 * `^0.2.1-rc.2` **不**包含 `0.2.0-rc.2`（主次版本更小），也**不**包含 `0.2.1-alpha.1`
 * （同一三元组下 `alpha < rc`）。同理 `>=0.1.0-rc.5` **不**包含 `0.2.0-rc.2` ——
 * 预发布版本默认被区间排除。本文件不复刻 semver 实现，直接调用 `semver` 包
 * （本仓根 `devDependencies` 里已有；缺失时退化为 `UNKNOWN` 而不是猜测）。
 *
 * 判据已用真实 `npm install` 双向校准（r84 §3）：`dsh-kb-rag@1.6.8` 配
 * `@deepseek-ai/dsh-tools@0.2.0-rc.2` 装得上、配 `0.2.1-alpha.1` 报 `ERESOLVE`，
 * 与本文件结论一致。
 *
 * # 宿主是「快照」，不是「版本窗口」
 *
 * `runtime.lock.json` 里的 `0.2.0-rc.2` / `0.2.1-alpha.1` 是两个**互斥的完整宿主快照**，
 * 不是可以自由组合的版本区间：`@deepseek-ai/dsh-tools@0.2.1-alpha.1` 把自己同代包
 * （`dsh-llm`/`dsh-agent`/`dsh-session`…）的 peer 写成**精确版本** `0.2.1-alpha.1`，
 * `0.2.0-rc.2` 同理。实测把它们混搭会直接 `ERESOLVE`（r84 §3 M-3）。
 *
 * 所以本文件给的 `DRIFT` 要读成：**「这个骨架只能挂在满足的那个快照上」**，
 * 而不是「它坏了」。只有两个快照都不满足，才是「两个宿主都挂不上」。
 * 下游 `preferredHostVersion = 0.2.0-rc.2`（`scripts/profile.mjs` 的默认起点），
 * 故只有 rc 满足的骨架**当前**可挂；只有 alpha 满足的，要等首选宿主换代。
 *
 * # 用法
 *
 *   node scripts/radar-host-window.mjs                 # 全部骨架
 *   node scripts/radar-host-window.mjs --drift-only    # 只列有宿主 peer 的那一层（汇总表）
 *   node scripts/radar-host-window.mjs --offline       # 不联网：只做「锁版 vs 宿主」结构检查
 *   node scripts/radar-host-window.mjs --json          # 机器可读
 *   node scripts/radar-host-window.mjs dsh-radar-kb-rag  # 只查一个骨架
 *
 * `semver` 的取法：仓库根 → `$RADAR_SEMVER_DIR/node_modules/semver`（仓库外安装点）。
 * 本仓 `npm ci` 长期失败（L-15），沙箱里通常没有 `node_modules`，所以留了这个后门；
 * 它只读，不写任何文件。
 *
 * 退出码：存在 `DRIFT` 时为 1；`UNKNOWN` 不置失败。
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCOPE = '@deepseek-ai/';
/** 宿主层：只有 `@deepseek-ai/dsh-*` 跟 `runtime.lock.json` 的 `hostVersions` 同一条版本线。 */
const HOST_PREFIX = `${SCOPE}dsh-`;
/**
 * 框架层：`@deepseek-ai/cordis` 是 cordis 框架包，版本线是 **4.x**，跟宿主的 `0.2.x` 不同源。
 * 把它当宿主比会得出「全部不相容」的假结论 —— 本轮第一版就踩了（r84 §3 M-1）。
 * 它只对 `runtime.lock.json` 的 `cordisMajor` 负责。
 */
const FRAMEWORK = `${SCOPE}cordis`;
const REGISTRY = 'https://registry.npmjs.org/';

/** 读取运行时锁文件里的宿主窗口与框架大版本。读不到就返回空窗口，让调用方判 `UNKNOWN`。 */
export async function hostWindow(root = ROOT) {
  try {
    const lock = JSON.parse(await readFile(path.join(root, 'runtime.lock.json'), 'utf8'));
    return {
      hosts: Array.isArray(lock.hostVersions) ? lock.hostVersions.filter(Boolean) : [],
      cordisMajor: Number.isInteger(lock.cordisMajor) ? lock.cordisMajor : null,
    };
  } catch {
    return { hosts: [], cordisMajor: null };
  }
}

/**
 * 判定层（纯函数，供单测直接调用）。
 *
 * @param deps - `{ [name]: version }`，骨架锁的依赖（版本必须精确）。
 * @param peers - `{ [name]: { [peerName]: range } }`，上游各包的 peer 区间。
 * @param hosts - 宿主版本数组，来自 `runtime.lock.json`。
 * @param satisfies - `(version, range) => boolean`；不传则无法判断 → 全部 `null`。
 * @returns `{ rows, summary }`。
 */
export function checkWindow(deps, peers, hosts, satisfies, frameworkMajor = 4) {
  const rows = [];
  for (const [name, locked] of Object.entries(deps ?? {})) {
    const peerMap = peers?.[name];
    if (!peerMap) {
      rows.push({ name, locked, verdict: 'UNKNOWN', reason: 'no-metadata', hosts: {}, peerRange: null });
      continue;
    }
    // 只看宿主层（`@deepseek-ai/dsh-*`）。`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`
    // 是框架/工具层，版本线不同源，混进来会把所有 ✅ 判成 ❌（r84 §3 M-1）。
    const hostPeers = Object.entries(peerMap)
      .filter(([peerName]) => peerName.startsWith(HOST_PREFIX))
      .sort(([a], [b]) => a.localeCompare(b));
    const framework = peerMap[FRAMEWORK] ?? null;

    const frameworkOk = framework
      ? satisfiedByAnything(satisfies, String(frameworkMajor), framework)
      : true;

    if (!hostPeers.length) {
      // 对本工具而言「没有宿主 peer」是**信息**，不是通过：
      // 它说明这个包不靠 peer 表达宿主需求（可能全在 inject 里，见 r81）。
      rows.push({
        name, locked, verdict: 'NO_HOST_PEER', reason: 'no-host-peer',
        hosts: {}, peerRange: null, framework, frameworkOk,
      });
      continue;
    }

    // 一条锁版依赖可能对多个宿主包都有区间；逐个宿主求值后取交集语义：
    // 任一宿主包的不满足 ⇒ 该宿主不满足（保守，且这正是 npm 的解析行为）。
    const perHost = {};
    for (const host of hosts ?? []) {
      let ok = true;
      let unknown = false;
      for (const [, range] of hostPeers) {
        const result = typeof satisfies === 'function'
          ? safeSatisfies(satisfies, host, range)
          : null;
        if (result === null) { unknown = true; continue; }
        if (!result) ok = false;
      }
      perHost[host] = unknown && ok ? null : ok;
    }

    const verdict = grade(perHost, hosts);
    rows.push({
      name,
      locked,
      verdict,
      reason: reasonOf(verdict),
      hosts: perHost,
      peerRange: Object.fromEntries(hostPeers),
      framework,
      frameworkOk,
      allHostsOk: Object.values(perHost).length > 0
        && Object.values(perHost).every(value => value === true),
    });
  }

  const summary = { total: rows.length, ok: 0, drift: 0, unknown: 0, noHostPeer: 0 };
  for (const row of rows) {
    if (row.verdict === 'OK') summary.ok += 1;
    else if (row.verdict === 'DRIFT') summary.drift += 1;
    else if (row.verdict === 'NO_HOST_PEER') summary.noHostPeer += 1;
    else summary.unknown += 1;
  }
  return { rows, summary };
}

function safeSatisfies(satisfies, version, range) {
  try {
    const result = satisfies(version, range);
    return typeof result === 'boolean' ? result : null;
  } catch {
    return null;
  }
}

/**
 * 框架层判定：`cordisMajor`（4）这条线上，上游区间是否放行**任何一个** 4.x。
 * 不能只试 `4.0.0` —— `^4.0.2` 会拒绝 `4.0.0`，那是补丁级差异，不是代际差异。
 * 试 `4.0.0` … `4.0.9`：覆盖「>="、`^4.0.x`、`||` 三种写法；都不行才判大版本不符。
 */
function satisfiedByAnything(satisfies, major, range) {
  if (typeof satisfies !== 'function') return null;
  let sawNull = false;
  for (let patch = 0; patch < 10; patch += 1) {
    const result = safeSatisfies(satisfies, `${major}.0.${patch}`, range);
    if (result === null) { sawNull = true; continue; }
    if (result) return true;
  }
  return sawNull ? null : false;
}

/**
 * 由「每个宿主的判定」推结论。三条边界必须分开，否则报告会说谎：
 *
 * - 没有宿主窗口（`runtime.lock.json` 坏了）→ `UNKNOWN`，不是「全都不满足」；
 * - 有宿主确定不满足 → `DRIFT`（哪怕另一个宿主满足 —— 那正是「宿主窗口」的字面含义：
 *   这个包只在一个宿主上成立）；
 * - 一个 true 都没有、但全是 null → `UNKNOWN`（没查到，不等于不相容）。
 */
export function grade(perHost, hosts) {
  const values = Object.entries(perHost ?? {});
  if (!(hosts ?? []).length || !values.length) return 'UNKNOWN';
  if (values.some(([, value]) => value === false)) return 'DRIFT';
  if (values.every(([, value]) => value === true)) return 'OK';
  return 'UNKNOWN';
}

/** 区间太长时截断：只保留前 3 个候选，用来判断「这是不是一条 `||` 白名单」。 */
function trimRange(range) {
  const parts = String(range).split('||').map(part => part.trim());
  return parts.length > 3 ? `${parts.slice(0, 3).join(' || ')} || …(共 ${parts.length} 项)` : String(range);
}

function reasonOf(verdict) {
  if (verdict === 'OK') return 'all-hosts-ok';
  if (verdict === 'DRIFT') return 'host-unsatisfied';
  return 'inconclusive';
}

/**
 * 取**锁定那个版本**的 manifest。
 *
 * 不能用 `dist-tags.latest`：`dsh-panda-calendar` 锁的是 `1.2.4`（`peerDependencies` 为
 * `undefined`），而 `latest` 已到 `1.2.5`（有四条 peer）—— 拿 latest 的 peer 去评 1.2.4，
 * 会凭空判出一个「不相容」（r84 §3 M-2）。**判的是锁的那个版本，不是这个包。**
 */
async function fetchManifest(name, version) {
  try {
    const response = await fetch(`${REGISTRY}${name.replace('/', '%2F')}`, {
      headers: { 'user-agent': 'zhiyun-radar' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const body = await response.json();
    const manifest = body.versions?.[version];
    if (!manifest) return { error: `no-such-version(${version})`, latest: body['dist-tags']?.latest };
    return {
      version,
      latest: body['dist-tags']?.latest ?? null,
      drifted: (body['dist-tags']?.latest ?? version) !== version,
      peerDependencies: manifest.peerDependencies ?? {},
      declared: Object.prototype.hasOwnProperty.call(manifest, 'peerDependencies'),
    };
  } catch (error) {
    return { error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error) };
  }
}

/** 抽出骨架目录与其锁版依赖（只认精确版本；带 `^ ~ >=` 的直接标出来，那是结构缺陷）。 */
async function lockedSkeletons(root = ROOT, only = null) {
  const dir = path.join(root, 'packages');
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-radar-')) continue;
    if (only && entry.name !== only) continue;
    let pkg;
    try {
      pkg = JSON.parse(await readFile(path.join(dir, entry.name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const deps = pkg.dependencies ?? {};
    if (!Object.keys(deps).length) continue;
    const imprecise = Object.entries(deps)
      .filter(([, version]) => /^[\^~><=]/.test(version))
      .map(([name]) => name);
    out.push({ dir: entry.name, deps, imprecise });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

async function loadSatisfies() {
  const candidates = [
    'semver',
    // 本仓 `npm ci` 长期失败（L-15：一条 404 的 vendor 依赖），沙箱里通常没有 node_modules。
    // 允许从环境变量指定的、**仓库之外**的安装点取 semver —— 只读，不写任何文件。
    process.env.RADAR_SEMVER_DIR && path.join(process.env.RADAR_SEMVER_DIR, 'node_modules', 'semver', 'index.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      const fn = mod.satisfies ?? mod.default?.satisfies;
      if (typeof fn === 'function') return fn;
    } catch {
      // 下一个
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const offline = args.includes('--offline');
  const only = args.find(arg => !arg.startsWith('--')) ?? null;
  const driftOnly = args.includes('--drift-only');

  const window = await hostWindow(ROOT);
  const hosts = window.hosts;
  const satisfies = await loadSatisfies();
  const skeletons = await lockedSkeletons(ROOT, only);

  // 按「包@锁定的版本」取 manifest —— 同一个包被不同骨架锁成两个版本时，peer 可能是两份。
  const required = [...new Set(skeletons.flatMap(item => item.imprecise.length
    ? []
    : Object.entries(item.deps).map(([name, version]) => `${name}@${version}`)))].sort();
  const meta = {};
  for (const key of required) {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (offline) { meta[key] = { error: 'offline' }; continue; }
    meta[key] = await fetchManifest(name, version);
  }

  const results = [];
  for (const skeleton of skeletons) {
    const deps = Object.fromEntries(Object.entries(skeleton.deps)
      .filter(([, version]) => !/^[\^~><=]/.test(version)));
    const peers = {};
    for (const [name, version] of Object.entries(deps)) {
      const entry = meta[`${name}@${version}`];
      if (entry && !entry.error) peers[name] = entry.peerDependencies;
    }
    const { rows, summary } = checkWindow(deps, peers, hosts, satisfies, window.cordisMajor ?? 4);
    // 「取不到」要区分 404 与「版本已不存在（有更新的 latest）」—— 后者是新鲜度问题，不是不相容。
    const unreachable = Object.entries(deps)
      .filter(([name, version]) => meta[`${name}@${version}`]?.error)
      .map(([name, version]) => ({
        name, version,
        error: meta[`${name}@${version}`].error,
        latest: meta[`${name}@${version}`].latest ?? null,
      }));
    const drifted = Object.entries(deps)
      .filter(([name, version]) => meta[`${name}@${version}`]?.drifted)
      .map(([name, version]) => ({ name, version, latest: meta[`${name}@${version}`].latest }));
    results.push({ dir: skeleton.dir, imprecise: skeleton.imprecise, rows, summary, unreachable, drifted });
  }

  const totals = { ok: 0, drift: 0, unknown: 0, noHostPeer: 0, imprecise: 0, unreachable: 0 };
  for (const result of results) {
    totals.ok += result.summary.ok;
    totals.drift += result.summary.drift;
    totals.unknown += result.summary.unknown;
    totals.noHostPeer += result.summary.noHostPeer;
    totals.imprecise += result.imprecise.length;
    totals.unreachable += result.unreachable.length;
  }

  if (asJson) {
    console.log(JSON.stringify({ hosts, cordisMajor: window.cordisMajor, semver: Boolean(satisfies), results, totals }, null, 2));
  } else {
    console.log(`宿主窗口：${hosts.length ? hosts.join(' / ') : '（runtime.lock.json 读不到）'}｜框架 cordis@${window.cordisMajor ?? '?'}`);
    console.log(`semver 可用：${satisfies ? '是' : '否（全部判 UNKNOWN）'}｜模式：${offline ? 'offline' : 'online'}\n`);
    if (driftOnly) {
      // 汇总视图：只列能判的（有宿主 peer 的）那一层，一行一个骨架。
      console.log('骨架'.padEnd(30) + '上游包@锁版'.padEnd(46) + '0.2.0-rc.2  0.2.1-alpha.1  结论');
      for (const result of results) {
        for (const row of result.rows) {
          if (row.verdict === 'NO_HOST_PEER' || row.verdict === 'UNKNOWN') continue;
          const cell = (host) => (row.hosts[host] === undefined ? '—' : (row.hosts[host] === null ? '?' : (row.hosts[host] ? '✅' : '❌')));
          console.log(
            result.dir.padEnd(30)
            + `${row.name}@${row.locked}`.padEnd(46)
            + `${cell(hosts[0])}         `.padEnd(13)
            + `${cell(hosts[1])}             `.padEnd(16)
            + row.verdict,
          );
        }
      }
      console.log('');
      console.log(`合计 ${results.length} 个骨架（有锁版依赖）：OK ${totals.ok}｜DRIFT ${totals.drift}｜UNKNOWN ${totals.unknown}｜无宿主 peer ${totals.noHostPeer}`);
      if (totals.drift) process.exitCode = 1;
      return;
    }
    for (const result of results) {
      console.log(`${result.dir}`);
      for (const row of result.rows) {
        const mark = row.verdict === 'OK' ? '✅' : (row.verdict === 'DRIFT' ? '❌' : '·');
        if (row.verdict === 'NO_HOST_PEER') {
          console.log(`  ${mark} ${row.name}@${row.locked}  peer 里没有 ${HOST_PREFIX}* → 不表达宿主需求（见 r81 声明层）`);
          continue;
        }
        const per = Object.entries(row.hosts)
          .map(([host, value]) => `${host}=${value === null ? '?' : (value ? 'ok' : 'NG')}`)
          .join(' ');
        const entries = Object.entries(row.peerRange ?? {});
        const short = entries.slice(0, 2)
          .map(([host, value]) => `${host.replace(HOST_PREFIX, '')}@${trimRange(value)}`)
          .join(' ∧ ');
        const range = `${short}${entries.length > 2 ? ` ∧ …（${entries.length} 个宿主包）` : ''}`;
        const fw = row.framework
          ? `  cordis ${row.framework}${row.frameworkOk === false ? '（大版本不符）' : ''}`
          : '';
        console.log(`  ${mark} ${row.name}@${row.locked}  ${range}  ${per}  → ${row.verdict}${fw}`);
      }
      for (const item of result.unreachable) {
        const hint = item.latest ? `，latest 已是 ${item.latest}` : '';
        console.log(`  · ${item.name}@${item.version}: 取不到元数据（${item.error}${hint}）`);
      }
      for (const item of result.drifted) console.log(`  ℹ 锁的 ${item.name}@${item.version} 落后 latest ${item.latest}（判的是锁的那个版本）`);
      if (result.imprecise.length) console.log(`  ⚠ 未精确锁版：${result.imprecise.join(', ')}`);
      void 0;
    }
    console.log('');
    console.log(`合计 ${results.length} 个骨架：OK ${totals.ok}｜DRIFT ${totals.drift}｜UNKNOWN ${totals.unknown}｜无宿主 peer ${totals.noHostPeer}`);
    if (totals.unreachable) console.log(`另有 ${totals.unreachable} 条取不到上游元数据（离线或 404，不算不相容）`);
  }

  if (totals.drift) process.exitCode = 1;
}

// 被测试 import 时不执行（`process.argv[1]` 指向单测文件）。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
