#!/usr/bin/env node
/**
 * 重新生成 `src/hosts.js` 的实测部分 —— `src/probe.js` 的命令行包装。
 *
 * # 判据都在库里，这里只做三件事
 *
 * 1. **自查网络位置**（在校园网内拒绝运行 —— 见下）；
 * 2. 把一批主机并发测一遍；
 * 3. 把结果排成给人看的表格，**与表里现值不一致的用 `!` 标出**。
 *
 * 真正的判定逻辑（DoH 解析、私网判定、跟跳转、CAS 识别、TUN 警告）在
 * `src/probe.js` 里，因为它**也被设置页与 agent 用**。这个脚本只是它的 CLI。
 *
 * # 为什么必须拒绝在校园网内跑
 *
 * 这张表的判法依赖「校外能不能访问」。在校园网内测，所有站都会可达，
 * 会把只在校内的站误标成 public —— 表就完全反了。
 *
 * 上游用 `--via <ssh主机>` 解决同一问题（换机器）；这里两个都有：
 * 本机自查（默认）+ `--via`（换到干净主机）。
 *
 * # 用法
 *
 * ```bash
 * # 自查网络位置后测全部已知主机
 * node packages/source/webvpn/scripts/probe-hosts.mjs
 *
 * # 只测指定主机
 * node packages/source/webvpn/scripts/probe-hosts.mjs --hosts zdbk.zju.edu.cn,cc98.org
 *
 * # 在一台校外主机上实测（本机开着 TUN 时用这个）
 * node packages/source/webvpn/scripts/probe-hosts.mjs --via my-server
 *
 * # 输出 JSON
 * node packages/source/webvpn/scripts/probe-hosts.mjs --json
 * ```
 *
 * 脚本**不直接改写 `hosts.js`**：那份文件是人审过的，机器生成的内容应该先
 * 输出给人看，确认后再改。
 */

import { CAMPUS_PROBE_URL, classifyHost, HOSTS, needsCas } from '../src/index.js';
import { probeHost, tunInterfaces } from '../src/probe.js';

/** 统一身份认证的主机名。停在它上面说明这个站要 CAS。 */
const CAS_HOST = 'zjuam.zju.edu.cn';

/** 一次探测的超时。站点慢的时候 8 秒够了；更长会把整轮拖到几分钟。 */
const TIMEOUT_MS = 8000;

/**
 * 问一下本机在不在校园网内。
 *
 * `1` / `2` 表示在校园网内。**在校园网内测这张表是没有意义的** —— 所有站点
 * 都可达，会把只在校内的站误标成 public。
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

/** 从参数里取主机名单；没给就返回整张表。 */
function targets(argv) {
  const flag = argv.findIndex((arg) => arg === '--hosts');
  if (flag >= 0) {
    const raw = argv[flag + 1] ?? '';
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [...new Set([...HOSTS.public, ...HOSTS.campus])].sort();
}

/** 取 `--via` 的值。 */
function viaTarget(argv) {
  const flag = argv.findIndex((arg) => arg === '--via');
  if (flag < 0) return undefined;
  const value = argv[flag + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/** 单个主机的探测 —— 转成「表格一行」需要的形状。 */
async function measure(host, { via }) {
  const report = await probeHost(host, { via, timeout: TIMEOUT_MS });
  return {
    host: report.host,
    network: report.suggested.network,
    cas: report.suggested.auth === 'cas',
    status: report.direct.status ?? 0,
    final: report.direct.final ?? '',
    error: report.direct.error,
    caveats: report.caveats,
    via: report.via,
  };
}

/**
 * 主流程。
 *
 * 并发度刻意压到 4：这些是学校的小站，打太猛容易被当成扫描。
 */
async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const via = viaTarget(argv);

  if (via === undefined) {
    const inside = await probeCampus();
    if (inside === true) {
      process.stderr.write(
        '检测到本机在校园网内。这张表的判法依赖「校外能不能访问」，\n'
        + '在校园网内测会把只在校内的站误标成 public。请在校园网外重跑，\n'
        + '或用 --via <ssh 主机别名> 换到一台校外主机上测。\n',
      );
      process.exitCode = 2;
      return;
    }
    if (inside === null && !asJson) {
      process.stderr.write(
        '提示：探不到校园网探测端点（可能离线或端点变了），继续按「校外」处理。\n',
      );
    }
    const tunnels = tunInterfaces();
    if (tunnels.length && !asJson) {
      process.stderr.write(
        `警告：本机有隧道接口 ${tunnels.join('、')}，IP 直连可能被劫持 —— `
        + '结果不可信，建议加 --via 换到校外主机复核。\n',
      );
    }
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
      try {
        results.push(await measure(host, { via }));
      } catch (error) {
        results.push({
          host,
          network: 'campus',
          cas: false,
          status: 0,
          final: '',
          error: String(error?.message ?? error),
          caveats: [],
          via: via ?? 'local',
        });
      }
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.host.localeCompare(b.host));

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString().slice(0, 10),
      via: via ?? 'local',
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

  const publicCount = results.filter((item) => item.network === 'public').length;
  const campusCount = results.length - publicCount;
  process.stdout.write(`${results.length} 个主机：public ${publicCount}，campus ${campusCount}。\n`);
  if (changed.length) {
    process.stdout.write(
      `\n与表里现值不一致 ${changed.length} 个（上面用 ! 标出）。\n`
      + '确认后手工改 `src/hosts.js` 的名单与 `HOSTS_GENERATED_AT`。\n',
    );
  } else {
    process.stdout.write('\n与表里现值完全一致，无需改动。\n');
  }

  // CAS 面单独提一句：它只用于诊断，改动时别把它和 network 混了。
  const casHosts = results.filter((item) => item.cas).map((item) => item.host);
  if (casHosts.length) {
    process.stdout.write(`\n实测需要 CAS 的主机：${casHosts.join('、')}\n`);
    const tableCas = hosts.filter((host) => needsCas(host));
    const missing = casHosts.filter((host) => !tableCas.includes(host));
    if (missing.length) {
      process.stdout.write(`⚠️ 表里未标 CAS 的：${missing.join('、')}\n`);
    }
  }

  // caveats 汇总：TUN 劫持、校内域名、auth 不确定都在这里，别埋在表格里。
  const caveats = results.flatMap((item) => item.caveats.map((note) => `${item.host}：${note}`));
  if (caveats.length) {
    process.stdout.write(`\n需要人工复核的：\n${caveats.map((line) => `- ${line}`).join('\n')}\n`);
  }

  // 提醒一句：--via 的报告里 `direct.reachable` 由 curl 状态码决定，
  // 不再区分「公网可达但被挡到无权访问页」—— 那种情形要看 final 落点。
  if (via === undefined) {
    const blocked = results.filter((item) => item.error && /无权访问/.test(item.error));
    if (blocked.length) {
      process.stdout.write(`\n被网站群挡到「无权访问」页（判 campus）：${blocked.map((item) => item.host).join('、')}\n`);
    }
  }
}

await main();
