/**
 * 出口接管：把宿主进程的出站流量引到本包的中继上。
 *
 * # 一个调用，两条通道（本文件最关键的判断）
 *
 * 宿主有两条互不相通的出站通道：
 *
 *   1. **`globalThis.fetch`** —— 绝大多数 SDK、MCP HTTP 传输、本工作台自己的
 *      `dsh-zhiyun-source-classroom` 取智云数据时走的都是它；
 *   2. **harness 代理层** —— DSH ≥ 0.1.5-rc.1 起，`web_fetch` 不再走 `globalThis.fetch`，
 *      而是先问 `@deepseek-ai/dsh-http-proxy` 的 `proxyRouteFor(url)` 决定走向。
 *
 * 两条通道必须**给出同一个答案**，否则会踩到那个包的硬约束（其 README 明写：
 * 策略层与实际 dispatcher 对同一 URL 答案不一致时，`web_fetch` 会把请求钉在
 * 策略从未放行的地址上）。所以这里不去分别接管两条通道 —— 而是调用
 * `installProxyFromEnvironment()`：它**同时**写策略记录与全局 dispatcher，
 * 一致性由宿主自己保证。两条通道的答案因此永远是同一句「走本中继」。
 *
 * # 为什么答案只有一句「走中继」
 *
 * 分域逻辑全在中继里（见 relay.js）。策略层只被喂一个代理 URL（中继自己），
 * 不参与「哪个域走哪个代理」的判断 —— 策略层本来也表达不了这件事
 * （它的 policy 形状是「一个 http 代理 + 一个 https 代理 + 一串绕开名单」）。
 *
 * # 兜底
 *
 * 宿主布局变化导致 `dsh-http-proxy` 解析不到时，退化为只装全局 dispatcher：
 * `globalThis.fetch` 仍受管辖，`web_fetch` 不跟随。这只影响 agent 自己的抓取，
 * 不影响本工作台的页面取数，所以按「降级 + 如实上报」处理，不拦启动。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PKG = '@deepseek-ai/dsh-http-proxy';
const MAIN = path.join('node_modules', '@deepseek-ai', 'dsh-http-proxy', 'lib', 'index.js');

/** 回环绕过名单：中继自己、宿主 UI、本地服务都该直连。中继会再兜一层。 */
const LOOPBACK_ONLY = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * 接管前环境里**原有的**直连名单。
 *
 * # 为什么必须保留（这一条是踩过坑的）
 *
 * 启动器在加载插件前已经按用户环境变量装过一次策略，并把结果写回了
 * `process.env`。所以这里读到的 `NO_PROXY` 就是用户的原意，例如：
 *
 * ```
 * NO_PROXY=api.deepseek.com,localhost,127.0.0.1,::1
 * ```
 *
 * 那个 `api.deepseek.com` 是**故意**的：DeepSeek 接口在国内通常可直连，
 * 绕道海外代理只会更慢。早先本文件直接把它覆盖成「只剩回环」，后果是
 * LLM 流量（选中翻译、问一问）落到路由表的默认策略上 —— 默认策略一旦是某个
 * 代理、而那个代理恰好不可用，请求就会一直卡到超时。真机上复现过：
 *
 * ```
 * tunnel api.deepseek.com: 连接 127.0.0.1:7993 失败：connect ECONNREFUSED
 * ```
 *
 * ⇒ 用户用环境变量表达过的直连意图，本包接管后必须**继续成立**。
 *    想改这些域的去向，应当去路由表写规则，而不是靠「接管顺手丢掉原配置」。
 */
export function inheritedDirectHosts(env = process.env) {
  const raw = env.NO_PROXY ?? env.no_proxy ?? '';
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/** 合并后的直连名单：原有意图在前，回环补在后，去重。 */
export function directHosts(env = process.env) {
  return [...new Set([...inheritedDirectHosts(env), ...LOOPBACK_ONLY])];
}

function looksRight(module) {
  return Boolean(module) && typeof module.installProxyFromEnvironment === 'function';
}

/**
 * 定位宿主**正在使用**的那一份 `dsh-http-proxy`。
 *
 * 顺序与上游一致，按「最可能命中真实实例」排：
 *   1. Electron 桌面端：模块打在 `app.asar(.unpacked)` 里，经 `process.resourcesPath` 定位。
 *      ESM 按 URL 缓存，因此按 file URL 导入命中的就是 harness 静态 import 的同一实例；
 *   2. 从 harness 主脚本所在目录解析 —— 覆盖 dsh CLI 独立安装的树；
 *   3. 裸 specifier —— 覆盖与 harness 共享同一 node_modules 树的布局。
 */
export async function loadHarnessProxy() {
  const attempts = [];
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (resources) {
    for (const pack of ['app.asar.unpacked', 'app.asar']) {
      const file = path.join(resources, pack, MAIN);
      try {
        const module = await import(pathToFileURL(file).href);
        if (looksRight(module)) return { module, via: pack };
        attempts.push(`${pack}: 缺少 installProxyFromEnvironment`);
      } catch (error) {
        attempts.push(`${pack}: ${error.message}`);
      }
    }
  }
  const argv1 = process.argv?.[1];
  if (argv1 && path.isAbsolute(argv1)) {
    try {
      const resolved = createRequire(argv1).resolve(PKG);
      const module = await import(pathToFileURL(resolved).href);
      if (looksRight(module)) return { module, via: 'argv' };
      attempts.push('argv: 缺少 installProxyFromEnvironment');
    } catch (error) {
      attempts.push(`argv: ${error.message}`);
    }
  }
  try {
    const module = await import(PKG);
    if (looksRight(module)) return { module, via: 'bare' };
    attempts.push('bare: 缺少 installProxyFromEnvironment');
  } catch (error) {
    attempts.push(`bare: ${error.message}`);
  }
  return { module: null, attempts };
}

/**
 * 把 `globalThis.fetch` 也引到中继上（`installProxyFromEnvironment` 不可用时的兜底）。
 *
 * 只装 `ProxyAgent`：它把所有非回环请求都送给中继，分域判断交给中继。
 * 这与策略层的答案天然一致（两边都是「走中继」）。
 */
async function installFetchOnly(relayUrl, log) {
  const undici = await import('undici');
  const previous = undici.getGlobalDispatcher();
  const agent = new undici.ProxyAgent({ uri: relayUrl });
  undici.setGlobalDispatcher(agent);
  log('warn:未定位到宿主的 dsh-http-proxy，已降级为只接管 globalThis.fetch；web_fetch 不会跟随分域路由');
  return async () => {
    undici.setGlobalDispatcher(previous);
    await agent.close().catch(() => {});
  };
}

/**
 * 安装出口接管。
 *
 * @param relayUrl - 本中继的代理 URL（形如 `http://127.0.0.1:<port>`）。
 * @param log      - 诊断回调。
 * @returns 还原函数；调用后进程回到安装前的出口策略。
 */
export async function installEgress(relayUrl, log = () => {}) {
  const { module, via, attempts } = await loadHarnessProxy();
  if (!module) {
    // 如实留痕：解析失败的原因链是排查「换了 DSH 版本后还灵不灵」的唯一线索。
    log(`warn:定位 dsh-http-proxy 失败，逐条尝试结果：\n  ${attempts.join('\n  ')}`);
    return installFetchOnly(relayUrl, log);
  }

  // 入参形状由宿主要求：Map<string, { value }>，键名小写
  // （其 resolveProxyPolicy 用 env.get(name)?.value 读取，readEnv 先查小写再回退大写）。
  //
  // `no_proxy` 用 directHosts()：**保留用户原有的直连意图**，而不是覆盖成只剩回环。
  // 覆盖掉会静默丢掉「api.deepseek.com 直连」这类设置，后果见 directHosts 的说明。
  const env = new Map([
    ['http_proxy', { value: relayUrl }],
    ['https_proxy', { value: relayUrl }],
    ['no_proxy', { value: directHosts().join(',') }],
  ]);

  const dispose = await module.installProxyFromEnvironment(env, (message) => log(`dsh-http-proxy: ${message}`));
  log(`出口已接管（经 ${via}）：http/https → 中继 ${relayUrl}`);
  return dispose;
}

/** 自检：确认一个（必然不会真的解析的）域名确实被判定为「走代理」。 */
export async function verifyEgress() {
  const { module } = await loadHarnessProxy();
  if (!module || typeof module.proxyRouteFor !== 'function') return { verified: false, reason: 'proxyRouteFor 不可用' };
  try {
    const route = module.proxyRouteFor(new URL('https://zhiyun-net-proxy-selfcheck.invalid/'));
    return { verified: route?.proxied === true, reason: route?.proxied ? null : '策略未生效' };
  } catch (error) {
    return { verified: false, reason: error.message };
  }
}
