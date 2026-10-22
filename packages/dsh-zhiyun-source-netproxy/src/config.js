/**
 * 网络代理的**配置模型与路由解析**。
 *
 * 这个文件是纯逻辑：不碰网络、不碰 socket，只回答一个问题 ——
 * 「某个主机名，应该走哪个出口」。之所以要把它单独拆出来，是因为
 * 路由的正确答案**只能有一份**：中继按它转发，设置页按它显示，
 * 测试直接断言它。三处各写一遍，迟早会漂移。
 *
 * # 配置形状
 *
 * ```jsonc
 * {
 *   "enabled": false,
 *   "proxies": [                       // 代理数量不设上限，由用户自己加
 *     { "id": "uniclash", "label": "海外代理", "protocol": "http",
 *       "host": "127.0.0.1", "port": 7993, "username": "", "password": "" }
 *   ],
 *   "rules": [                         // 按顺序匹配，先命中先用
 *     { "match": "zju.edu.cn", "target": "direct" },
 *     { "match": "github.com", "target": "uniclash" }
 *   ],
 *   "fallback": "direct"               // 全都不命中时去哪
 * }
 * ```
 *
 * `target` 是 `"direct"` 或某个代理的 `id`。**刻意不写死任何端口或域名**：
 * 代理地址、域名规则全部由用户在设置页里填，这里只负责校验与匹配。
 *
 * # 为什么不读环境变量
 *
 * 环境变量（`HTTP_PROXY` / `NO_PROXY`）是**进程级全局**的，只能表达
 * 「一个代理 + 一串绕开名单」，表达不了「域 A 走代理 1、域 B 走代理 2」。
 * 更糟的是它会和别的工具互相覆盖：本工作台此前正是被全局 `HTTPS_PROXY`
 * 影响，导致智云（国内站点）的请求被送去海外代理。所以这一版**完全不依赖
 * 环境变量**，路由答案只来自这份配置。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 支持的代理协议。两者都是「本机代理软件提供的本地端口」。 */
export const PROTOCOLS = ['http', 'socks5'];

/** 代表「不走代理」的保留目标。 */
export const DIRECT = 'direct';

export function defaults() {
  return {
    // 默认**不接管**：用户没配之前，保持宿原本的出口行为，避免「装了个插件反而断网」。
    enabled: false,
    proxies: [],
    rules: [],
    fallback: DIRECT,
  };
}

/**
 * 校验并规范化一份配置。
 *
 * 校验放在这里而不是「用到的时候再说」，是因为坏配置的表现是**静默走错出口**
 * （比如端口写成字符串，连接时才失败），比启动即报错难查得多。
 * 任何一条不合法都抛错，绝不「猜一个默认值继续跑」。
 */
export function normalize(raw) {
  const merged = { ...defaults(), ...(raw && typeof raw === 'object' ? raw : {}) };

  const seen = new Set();
  const proxies = (Array.isArray(merged.proxies) ? merged.proxies : []).map((item, index) => {
    const entry = item && typeof item === 'object' ? item : {};
    const id = String(entry.id ?? `p${index + 1}`).trim();
    if (!id) throw new Error(`第 ${index + 1} 个代理缺少 id`);
    if (seen.has(id)) throw new Error(`代理 id 重复：${id}`);
    seen.add(id);

    const protocol = String(entry.protocol ?? 'http').toLowerCase();
    if (!PROTOCOLS.includes(protocol)) {
      throw new Error(`代理「${id}」的协议不支持：${protocol}（只支持 ${PROTOCOLS.join(' / ')}）`);
    }
    const host = String(entry.host ?? '').trim();
    if (!host) throw new Error(`代理「${id}」缺少地址`);
    const port = Number(entry.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`代理「${id}」的端口无效：${JSON.stringify(entry.port)}`);
    }
    return {
      id,
      label: String(entry.label ?? '').trim() || id,
      protocol,
      host,
      port,
      username: String(entry.username ?? ''),
      password: String(entry.password ?? ''),
    };
  });

  const ids = new Set(proxies.map((proxy) => proxy.id));
  const checkTarget = (value, where) => {
    const target = String(value ?? DIRECT).trim() || DIRECT;
    if (target !== DIRECT && !ids.has(target)) {
      throw new Error(`${where}指向了不存在的代理：${target}`);
    }
    return target;
  };

  const rules = (Array.isArray(merged.rules) ? merged.rules : []).map((item, index) => {
    const entry = item && typeof item === 'object' ? item : {};
    const match = String(entry.match ?? '').trim();
    if (!match) throw new Error(`第 ${index + 1} 条规则缺少匹配的域名`);
    return { match, target: checkTarget(entry.target, `第 ${index + 1} 条规则`) };
  });

  return {
    enabled: Boolean(merged.enabled),
    proxies,
    rules,
    fallback: checkTarget(merged.fallback, '默认策略'),
  };
}

/**
 * 判断一个主机名是否命中一条规则模式。
 *
 * 支持四种写法，全部由用户自由填写：
 *   - `example.com`    本域 + 全部子域（`api.example.com` 也命中）
 *   - `.example.com`   `.` / `*.` 前缀等价，含义同上
 *   - `192.168.`      以点结尾 = 前缀匹配（对 IP 段友好，等价于 Windows 的 `192.168.*`）
 *   - `*`              命中全部
 *
 * 不做 CIDR：宿主自己的绕过匹配器也不做（操作系统绕过列表里的 `10.0.0.0/8`
 * 必须改写成前缀形式），保持一致比多支持一种写法更重要。
 */
export function matchesHost(hostname, pattern) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  let entry = String(pattern ?? '').trim().toLowerCase();
  if (!entry) return false;
  if (entry === '*') return true;

  // IPv6 字面量在 URL.hostname 里带方括号，比较时两边都归一化掉。
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (entry.startsWith('*.')) entry = entry.slice(2);
  else if (entry.startsWith('.')) entry = entry.slice(1);
  if (entry.endsWith('.*')) entry = entry.slice(0, -1);
  if (!entry) return false;

  if (entry.endsWith('.')) return host.startsWith(entry) || bare.startsWith(entry);
  return host === entry || bare === entry || host.endsWith(`.${entry}`) || bare.endsWith(`.${entry}`);
}

/** 把 `target` 解析成一个可执行的去向。 */
export function targetFor(config, target) {
  if (target === DIRECT) return { kind: DIRECT };
  const proxy = config.proxies.find((item) => item.id === target);
  // 正常情况到不了这里：`normalize()` 已保证 rules / fallback 只指向存在的代理。
  // 真出现说明配置被绕过校验改了 —— 此时**保守直连**并让调用方记录，比拿一个
  // 不存在的代理去连（表现为莫名其妙的连接失败）更容易归因。
  if (!proxy) return { kind: DIRECT, missing: target };
  return { kind: 'proxy', proxy };
}

/** 按规则顺序解析某个主机名该走哪里。 */
export function resolveRoute(config, hostname) {
  for (const rule of config.rules) {
    if (matchesHost(hostname, rule.match)) return { ...targetFor(config, rule.target), matched: rule.match };
  }
  return { ...targetFor(config, config.fallback), matched: null };
}

/** 某个主机名是否应当**完全绕开**中继（回环：中继自己、宿主 UI、本地服务）。 */
export function isLoopback(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.');
}

/**
 * 把「从环境继承来的直连域名」并进配置，作为**默认策略之前**的一道兜底。
 *
 * # 为什么需要它（真机上踩出来的）
 *
 * 用户可能在终端里写过 `NO_PROXY=api.deepseek.com`，意思是「这个域别走代理」
 * —— 因为 DeepSeek 接口在国内通常可直连，绕道海外代理只会更慢。本包接管出口后
 * 会把这条环境设置改写掉（不改写则接管不生效），所以这份意图必须**换个地方继续
 * 成立**，否则它就静默消失了。
 *
 * 消失的后果很具体：LLM 流量（选中翻译、问一问）会落到默认策略上，默认策略若是
 * 某个不可用的代理，请求就一直挂到超时。真机日志：
 *
 * ```
 * tunnel api.deepseek.com: 连接 127.0.0.1:7993 失败：connect ECONNREFUSED
 * ```
 *
 * # 优先级（顺序即语义，不要随意调整）
 *
 *   1. 用户在「网络代理」里**显式写的规则** —— 他此刻看得见、改得动的意图；
 *   2. 继承来的直连域名 —— 环境里表达过、但已不可见的意图；
 *   3. 默认策略 —— 兜底。
 *
 * 显式规则排在继承之前：面板是用户现在能看见的地方，他写了 `*` 就说明确实想让
 * 所有流量走代理；而继承来的条目他自己可能都忘了。
 *
 * 回环不参与：策略层与中继都不会把回环流量送进来，写进来只是噪音。
 */
export function withInheritedDirect(config, hosts = []) {
  const seen = new Set(config.rules.map((rule) => rule.match));
  const appended = hosts
    .map((host) => String(host ?? '').trim())
    .filter((host) => host && !isLoopback(host) && !seen.has(host))
    .map((host) => ({ match: host, target: DIRECT, inherited: true }));
  if (appended.length === 0) return config;
  return { ...config, rules: [...config.rules, ...appended] };
}

export function configPath(profileDir) {
  return path.join(profileDir, 'data', 'zhiyun-net-proxy', 'config.json');
}

/** 读配置。文件不存在或读坏时回退默认值 —— 起不来比走错出口更糟。 */
export function loadConfig(file, log = () => {}) {
  try {
    if (!existsSync(file)) return defaults();
    let raw = readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 剥离 BOM
    return normalize(JSON.parse(raw));
  } catch (error) {
    log(`warn:读取 ${file} 失败（${error.message}），本次按默认配置（不接管）运行`);
    return defaults();
  }
}

/** 原子写配置：先写临时文件再 rename，避免读到写了一半的内容。 */
export function saveConfig(file, raw) {
  const config = normalize(raw);
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return config;
}
