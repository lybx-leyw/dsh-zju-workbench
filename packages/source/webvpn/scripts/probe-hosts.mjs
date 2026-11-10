#!/usr/bin/env node
/**
 * 重新生成 `src/hosts.js` 的实测部分。
 *
 * # 为什么需要这个脚本
 *
 * `hosts.js` 里的 campus / public 名单是**一次实测的快照**（`generatedAt` 会写进
 * 那个文件）。学院站会换域名、加 CDN、改目录结构，表过期后表现为：
 *   - 本来能直连的被判 campus → 用户无谓多绕一次网关（慢，但不报错）；
 *   - 本来要绕网关的被判 public → 校外直接失败（错）。
 *
 * 两种都不会自己发声，所以这张表必须能**重新测**，而不是靠人凭印象改。
 *
 * # 判法（与上游 `hosts.ts:84-91` 同口径）
 *
 * 跟着跳转走到底，看最后停在哪：
 *   - 停在统一身份认证登录页（`zjuam.zju.edu.cn/cas`）→ `public` + `cas: true`
 *   - 200 → `public`
 *   - 落到 `/nopermit_zjusub.jsp`（网站群的「无权访问」页）→ `campus`
 *   - 连不上 / 超时 / 403 / 5xx → `campus`
 *
 * **必须在校园网外测**：在校园网内测，所有站点都会「可达」，这张表就没有意义了。
 * 脚本会先自查是否在校内，是的话直接拒绝运行。
 *
 * # 用法
 *
 * ```bash
 * # 自查网络位置后测全部已知主机
 * node packages/source/webvpn/scripts/probe-hosts.mjs
 *
 * # 只测指定主机（调试用）
 * node packages/source/webvpn/scripts/probe-hosts.mjs --hosts zdbk.zju.edu.cn,cc98.org
 *
 * # 输出 JSON 到文件，不打印表格
 * node packages/source/webvpn/scripts/probe-hosts.mjs --json > probe.json
 * ```
 *
 * 脚本**不直接改写 `hosts.js`**：那份文件是人审过的，机器生成的内容应该先
 * 输出给人看，确认后再改。这也是 `docs/contributing/AGENTS.md`「提交前需确认」
 * 的要求。
 */

import { CAMPUS_PROBE_URL, classifyHost, HOSTS, needsCas } from '../src/index.js';

/** 一次探测的超时。站点慢的时候 8 秒够了；更长会把整轮拖到几分钟。 */
const TIMEOUT_MS = 8000;

/** 网站群「只给校内看」的拒绝页路径，与 `egress.js` 里的同名常量一致。 */
const NO_PERMIT_PATH = '/nopermit_zjusub.jsp';

/** 统一身份认证的主机名。停在它上面说明这个站要 CAS。 */
const CAS_HOST = 'zjuam.zju.edu.cn';

/**
 * 问一下本机在不在校园网内。
 *
 * `1` / `2` 表示在校园网内。**在校园网内测这张表是没有意义的** —— 所有站点都可达，
 * 会把只在校内的站误标成 public。
 *
 * @returns `true` 在校园网内、`false` 在校外、`null` 探不到。
 */
async function probeCampus() {
  try {
    const response = await fetch(CAMPUS_PROBE_URL, {
      redirect: 'manual',
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status !== 200) return null;
    const text = (await response.text()).trim();
    return text === '1' || text === '2';
  } catch {
    return null;
  }
}

/**
 * 跟跳转走到底，判定一个主机。
 *
 * 用 `redirect: 'follow'` 让 undici 自己跟，但保留 `response.url` 看最终落点 ——
 * 这正是判法需要的两个信息（最终地址 + 状态码）。
 *
 * @param host - 主机名，可带端口。
 * @returns `{ host, network, cas, status, final, error? }`。
 */
async function probeHost(host) {
  const url = `https://${host}/`;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 zju-workbench-probe' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const final = response.url || url;
    let landed;
    try {
      landed = new URL(final);
    } catch {
      landed = null;
    }
    const status = response.status;

    // 停在统一身份认证 → 公网可达，但打开要 CAS。
    if (landed && landed.hostname === CAS_HOST) {
      return { host, network: 'public', cas: true, status, final };
    }
    // 落到「无权访问」页 → 只给校内看。
    if (landed && landed.pathname === NO_PERMIT_PATH) {
      return { host, network: 'campus', cas: false, status, final };
    }
    // 200 → 公网可达。
    if (status === 200) return { host, network: 'public', cas: false, status, final };
    // 403 / 5xx / 其它非 200 → 当作只在校内（保守）。
    return { host, network: 'campus', cas: false, status, final };
  } catch (error) {
    // 连不上、超时、DNS 失败 → 当作只在校内（保守）。
    return {
      host,
      network: 'campus',
      cas: false,
      status: 0,
      final: '',
      error: String(error?.code ?? error?.message ?? error),
    };
  }
}

/** 从参数里取主机名单；没给就返回整张表。 */
function targets(argv) {
  const flag = argv.findIndex(a => a === '--hosts');
  if (flag >= 0) {
    const raw = argv[flag + 1] ?? '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // 默认测表里已有的全部主机，外加几个已知的「应该判 campus」的站点做对照。
  return [...new Set([...HOSTS.public, ...HOSTS.campus])].sort();
}

/**
 * 主流程。
 *
 * 并发度刻意压到 4：这些是学校的小站，打太猛容易被当成扫描。
 */
async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');

  const inside = await probeCampus();
  if (inside === true) {
    process.stderr.write(
      '检测到本机在校园网内。这张表的判法依赖「校外能不能访问」，\n'
      + '在校园网内测会把只在校内的站误标成 public。请在校园网外重跑。\n',
    );
    process.exitCode = 2;
    return;
  }
  if (inside === null && !asJson) {
    process.stderr.write(
      '提示：探不到校园网探测端点（可能离线或端点变了），继续按「校外」处理。\n',
    );
  }

  const hosts = targets(argv);
  if (!hosts.length) {
    process.stderr.write('没有要测的主机。\n');
    process.exitCode = 1;
    return;
  }

  const results = [];
  const queue = [...hosts];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const host = queue.shift();
      if (host === undefined) return;
      results.push(await probeHost(host));
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.host.localeCompare(b.host));

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString().slice(0, 10),
      via: 'local',
      results,
    }, null, 2)}\n`);
    return;
  }

  // 表格输出。与表里现值不一致的用 `!` 标出来 —— 那才是有信息量的部分。
  const changed = [];
  const lines = ['主机 | 实测 | 表里现值 | 状态码 | 最终地址'];
  lines.push('--- | --- | --- | --- | ---');
  for (const item of results) {
    const current = classifyHost(item.host);
    const differs = current !== 'unknown' && current !== item.network;
    if (differs) changed.push(item);
    lines.push(
      `${differs ? '**!' : ''}${item.host}${differs ? '**' : ''} | ${item.network}`
      + ` | ${current} | ${item.status} | ${item.final || item.error || ''}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n\n`);

  const publicCount = results.filter(r => r.network === 'public').length;
  const campusCount = results.length - publicCount;
  process.stdout.write(
    `${results.length} 个主机：public ${publicCount}，campus ${campusCount}。\n`,
  );
  if (changed.length) {
    process.stdout.write(
      `\n与表里现值不一致 ${changed.length} 个（上面用 ! 标出）。\n`
      + '确认后手工改 `src/hosts.js` 的名单与 `HOSTS_GENERATED_AT`。\n',
    );
  } else {
    process.stdout.write('\n与表里现值完全一致，无需改动。\n');
  }

  // CAS 面单独提一句：它只用于诊断，改动时别把它和 network 混了。
  const casHosts = results.filter(r => r.cas).map(r => r.host);
  if (casHosts.length) {
    process.stdout.write(`\n实测需要 CAS 的主机：${casHosts.join('、')}\n`);
    const tableCas = hosts.filter(h => needsCas(h));
    const missing = casHosts.filter(h => !tableCas.includes(h));
    if (missing.length) {
      process.stdout.write(`⚠️ 表里未标 CAS 的：${missing.join('、')}\n`);
    }
  }
}

await main();
