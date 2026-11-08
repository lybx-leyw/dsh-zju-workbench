/**
 * 校园站点的共享 HTTP 层：`Transport` / `SessionStore` / `ClassroomError`。
 *
 * # 为什么它必须是独立包（而不是留在 campus 里）
 *
 * 这四份文件原先在 `dsh-zhiyun-source-campus/src/cas/` 下，于是出现了一个
 * **逻辑上说不通的结构**：CC98 论坛、教务、学习通三个包要 import
 * `dsh-zhiyun-source-campus/http` —— 论坛和一个数据源包没有任何业务关系，
 * 这条依赖存在只是因为「传输层恰好放在那儿」。
 *
 * 那是**位置错位的依赖**，代价很具体：
 *
 *   - 删 campus 就得先动三个无关的包；
 *   - 装 CC98 却会连带装上学在浙大/拼题A 的整套业务；
 *   - `dsh.capability` 里只能写「tier 1 依赖 tier 1」，那条守卫因此形同虚设。
 *
 * 现在它是 tier 0 的基础设施：谁都能依赖它，它不依赖任何业务包。
 *
 * # 这里刻意**不**包含的东西
 *
 * - **CAS 登录流程**：各站点用法不同（学在浙大不带 `service`，教务必须带）。
 *   把任一方的策略钉进共享层，另一方就得绕开它。
 * - **凭据读取**：那属于 `@lybx-leyw/dsh-zju-source-login`。
 * - **出口策略**：那属于 `@lybx-leyw/dsh-zju-source-webvpn` 的 `./egress`。
 *   本包的 `sharedFetch` 只是去**取**那份策略服务，不自己实现分域判断。
 */

export { Transport, AUTH_HOSTS, REFERER } from './transport.js';
export { SessionStore, dpapi } from './session.js';
export { ClassroomError, shape, object, array } from './errors.js';
export { resourceUrl } from './urls.js';

/** 登录域。它们是公网服务，与是否在校园网无关。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';
export const IDENTITY_HOST = 'identity.zju.edu.cn';

/**
 * 取一份**带自动出口**的 fetch。
 *
 * # 它解决什么
 *
 * 没有它时，各包要么直接用 `globalThis.fetch`（会走宿主为 LLM 配的全局代理 ——
 * 而浙大站点/国内站点经代理基本必失败，实测 10.7 秒后 NETWORK），要么各自
 * `new undici.Agent()`（各开一套连接池），要么各自登录 WebVPN（互相作废会话）。
 * 三种都不对。
 *
 * 这里统一从 `zhiyunEgress` 服务借那份**唯一的**出口：
 *
 *   - 非校园域（pintia.cn、cc98.org、chaoxing.com）→ 直连（绕开全局代理）；
 *   - 校园域（*.zju.edu.cn）→ 按 `auto` 策略：校内直连、校外绕 WebVPN；
 *   - 拿不到服务 → 退回 `fallback`，即宿主 fetch。
 *
 * # 为什么必须是**惰性**的
 *
 * 不能在 `apply()` 阶段把服务取出来存起来：profile 里包的装配顺序不保证
 * egress 的提供方在前，取到 `undefined` 就会被永久缓存成"没有出口"。
 * 所以返回的是一个**每次调用都重新查**的函数。
 *
 * @param ctx - 插件上下文（Cordis）。
 * @param options.fallback - 拿不到出口时用哪个 fetch（默认 `globalThis.fetch`）。
 * @returns 与 `fetch` 同签名的函数。
 */
export function sharedFetch(ctx, { fallback = globalThis.fetch } = {}) {
  return function egressAwareFetch(url, init) {
    try {
      const egress = ctx?.get?.('zhiyunEgress');
      if (egress && typeof egress.fetch === 'function') return egress.fetch(url, init);
    } catch {
      // 服务解析失败（例如 ctx 已销毁）不该把一次请求变成异常 —— 直接退回直连。
    }
    return fallback(url, init);
  };
}


/**
 * 把浏览器里复制出来的 **Cookie 串**（或整条 cURL）解析成键值对。
 *
 * # 为什么在共享层
 *
 * 纯函数：零依赖、不碰网络，只做字符串识别。需要它的不止一个包 —— campus
 * （拼题A）与 xxt（学习通）面对的是同一类输入：用户在 DevTools 里复制一整行
 * Cookie 或 cURL 粘进来。各写一份的话识别规则会漂移（本仓已有这类教训）。
 *
 * 实现逐字搬自 campus 的 `src/pta.js`，未改逻辑。
 *
 * @param input - 粘贴的文本（Cookie 头、cURL、或分号分隔的键值对）。
 * @returns `[name, value][]` 或 null。
 */
export function parsePtaCookie(input) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  const ATTRS = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly',
    'samesite', 'priority', 'partitioned', 'size', 'hostonly', 'host-only']);
  const HEADERS = new Set(['name', 'value', '名称', '值', 'cookie']);

  const pairs = [];
  const push = (name, value) => {
    const key = String(name ?? '').trim();
    const val = String(value ?? '').trim();
    if (!/^[\w-]{1,80}$/.test(key)) return;
    if (ATTRS.has(key.toLowerCase()) || HEADERS.has(key.toLowerCase())) return;
    if (HEADERS.has(val.toLowerCase())) return;
    if (!val || val.length > 512) return;
    pairs.push([key, val]);
  };

  const curl = /(?:--header|-H)\s+['"]?\s*cookie\s*:\s*([^'"\n]+)['"]?/i.exec(text)
    ?? /(?:--cookie|-b)\s+['"]([^'"]+)['"]/i.exec(text);
  const source = curl
    ? 'curl 命令'
    : /^\s*(?:[-*]\s*)?cookie\s*:/im.test(text)
      ? '请求头'
      : text.includes('\n') ? 'DevTools 表格' : 'Cookie 字符串';
  const body = curl?.[1] ?? /^\s*(?:[-*]\s*)?cookie\s*:\s*(.+)$/im.exec(text)?.[1] ?? text;

  for (const line of body.split('\n')) {
    const cells = line.includes('\t') ? line.split('\t') : line.trim().split(/\s{2,}|,(?=\s)/);
    if (cells.length >= 2 && !/[=;]/.test(cells[0])) {
      push(cells[0], cells[1]);
      continue;
    }
    for (const part of line.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) push(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  if (pairs.length === 0) return null;
  const seen = new Map();
  for (const [key, value] of pairs) seen.set(key, value);
  const cookie = [...seen].map(([name, value]) => `${name}=${value}`).join('; ');
  return { cookie, source, names: [...seen.keys()] };
}
