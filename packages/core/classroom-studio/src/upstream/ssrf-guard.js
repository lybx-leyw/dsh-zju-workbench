/**
 * SSRF 防护（源文件:lib/server/ssrf-guard.ts:1-632）。
 *
 * # 为什么整份搬
 *
 * 上游把「客户端给的 baseUrl 能不能连」这件事集中在这一个文件里，四条 route
 * （`azure-voices`、`proxy-media`、`transcription`、`verify-*-provider`）都只调它。
 * 规范第 2 通道要求 handler body 原样搬，所以这里也原样保留 `validateUrlForSSRF` /
 * `validateClientBaseUrl` / `validatePublicUrlForSSRF` 三个入口与全部拒绝对策。
 *
 * # 唯一的替换：`ipaddr.js`
 *
 * 上游用 `ipaddr.js` 的 `parse()` / `range()` 判段。本包不许新增 npm 依赖
 * （任务书硬约束），所以把**用到的**那几个判据（`unicast` / `private` / `loopback` /
 * `linkLocal` / `carrierGradeNat` / `reserved` / `multicast` / `broadcast`）用纯 JS
 * 实现了一遍。判定表逐条照 `ipaddr.js` 的 `IPv4.prototype.range` /
 * `IPv6.prototype.range` 抄，**不是**按「看起来像内网」重新发明。
 * 差异记在 ROUTES.md：没有 `ipaddr.js` 的完整段表（例如 IPv6 的
 * `2001:20::/28` 等冷门段），落在 `unicast` 的极少数地址会被放行。
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

const CLOUD_METADATA_HOSTNAMES = new Set(['metadata.google.internal']);
const CLOUD_METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '169.254.170.23',
  'fd00:ec2::254',
  'fd00:ec2::23',
  '100.100.100.200',
  '168.63.129.16',
  '192.0.0.192',
]);
const ALLOW_LOCAL_DNS_TIMEOUT_MS = 3_000;

const CLOUD_METADATA_BLOCK_MESSAGE =
  'Cloud instance metadata endpoints are never allowed as outbound targets, even with ALLOW_LOCAL_NETWORKS=true.';

const LOCAL_NETWORK_BLOCK_MESSAGE =
  'Local/private network URLs are not allowed. If this is a self-hosted deployment or internal gateway (including split-horizon DNS), set ALLOW_LOCAL_NETWORKS=true to allow local network targets.';

const CLIENT_SUPPLIED_LOCAL_NETWORK_BLOCK_MESSAGE =
  'Local/private network URLs are not allowed for a client-supplied endpoint. ALLOW_LOCAL_NETWORKS does not apply to this path. The endpoint must be a provider configured by the operator in openmaic.yml.';

export class UnsafeNetworkTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeNetworkTargetError';
  }
}

/** 上游同名字段：`ALLOW_LOCAL_NETWORKS` 的进程级 opt-in。 */
export function allowLocalNetworksEnabled() {
  return process.env.ALLOW_LOCAL_NETWORKS === 'true' || process.env.ALLOW_LOCAL_NETWORKS === '1';
}

/** 沿 `cause` 链与 `AggregateError` 子项找 guard 的拒绝（源:60-75）。 */
export function findUnsafeNetworkTargetError(error) {
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    if (value instanceof UnsafeNetworkTargetError) return value;
    if (value instanceof AggregateError) {
      for (const child of value.errors) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return visit(value.cause);
  };
  return visit(error);
}

function normalizeAddress(value) {
  let normalized = String(value).trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\.+$/, '');
}

function parseIPv4(value) {
  const parts = normalizeAddress(value).split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

/** 展开 IPv6 成 8 个 hextet（源:373-406，逐行照搬）。 */
function expandIPv6(value) {
  let normalized = normalizeAddress(value);
  if (!normalized.includes(':')) return null;

  const lastPart = normalized.split(':').pop() || '';
  if (lastPart.includes('.')) {
    const dotted = parseIPv4(lastPart);
    if (!dotted) return null;
    const [first, second, third, fourth] = dotted;
    const high = ((first << 8) | second).toString(16);
    const low = ((third << 8) | fourth).toString(16);
    normalized = `${normalized.slice(0, -lastPart.length)}${high}:${low}`;
  }

  const sides = normalized.split('::');
  if (sides.length > 2) return null;

  let parts;
  if (sides.length === 2) {
    const left = sides[0] ? sides[0].split(':') : [];
    const right = sides[1] ? sides[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing <= 0) return null;
    parts = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    parts = normalized.split(':');
  }

  if (parts.length !== 8) return null;
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

/**
 * 解析成内部形态：`{kind:'v4', octets}` 或 `{kind:'v6', hextets}`；
 * IPv4-mapped IPv6 解包成 v4（`::ffff:169.254.169.254` 与 `169.254.169.254` 同判）。
 */
function parseIp(value) {
  const normalized = normalizeAddress(value);
  const v4 = parseIPv4(normalized);
  if (v4) return { kind: 'v4', octets: v4 };
  const hextets = expandIPv6(normalized);
  if (!hextets) return null;
  const mapped =
    hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff
      ? [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff]
      : null;
  if (mapped) return { kind: 'v4', octets: mapped };
  return { kind: 'v6', hextets };
}

/** IPv4 段表（`ipaddr.js` 的 `IPv4.prototype.range`）。 */
function ipv4Range(octets) {
  const [a, b, c] = octets;
  if (a === 0) return 'unspecified';
  if (a === 10) return 'private';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'linkLocal';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'carrierGradeNat';
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 192 && b === 0 && c === 2) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a === 255 && b === 255 && c === 255 && octets[3] === 255) return 'broadcast';
  if (a >= 240) return 'reserved';
  return 'unicast';
}

/** IPv6 段表（`ipaddr.js` 的 `IPv6.prototype.range`，取本文件用到的分支）。 */
function ipv6Range(hextets) {
  const [h0] = hextets;
  const allZero = hextets.every((h) => h === 0);
  if (allZero) return 'unspecified';
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return 'loopback';
  if ((h0 & 0xffc0) === 0xfe80) return 'linkLocal';
  if ((h0 & 0xfe00) === 0xfc00) return 'uniqueLocal';
  if ((h0 & 0xff00) === 0xff00) return 'multicast';
  if (h0 === 0x2001 && hextets[1] === 0x0db8) return 'reserved';
  if (h0 === 0x0100 && hextets.slice(1, 4).every((h) => h === 0)) return 'reserved';
  if (h0 === 0x2002) return '6to4';
  if (h0 === 0x0064 && hextets[1] === 0xff9b) return 'reserved';
  return 'unicast';
}

function rangeOf(ip) {
  return ip.kind === 'v4' ? ipv4Range(ip.octets) : ipv6Range(ip.hextets);
}

/** 上游 `isPrivateIP`（源:408-453）：私网 + 环回 + 链路本地 + 过渡机制内嵌 v4。 */
export function isPrivateIP(value) {
  const ip = parseIp(value);
  if (!ip) return false;
  if (ip.kind === 'v4') {
    const [a, b] = ip.octets;
    return (
      a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    );
  }
  const { hextets } = ip;
  const h0 = hextets[0];
  if (hextets.every((h) => h === 0)) return true;
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true;
  if ((h0 & 0xfe00) === 0xfc00) return true;
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if ((h0 & 0xffc0) === 0xfec0) return true;
  return tunnelEmbeddedIPv4({ kind: 'v6', hextets }).some((embedded) => isPrivateIP(embedded));
}

/** 过渡机制内嵌的 IPv4（源:114-158）。 */
function tunnelEmbeddedIPv4(ip) {
  if (ip.kind !== 'v6') return [];
  const h = ip.hextets;
  const dotted = (high, low) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  const embedded = [];
  if (h[0] === 0x2002) embedded.push(dotted(h[1], h[2]));
  if (h[0] === 0x2001 && h[1] === 0x0000) embedded.push(dotted(h[6] ^ 0xffff, h[7] ^ 0xffff));
  if ((h[4] === 0x0000 || h[4] === 0x0200) && h[5] === 0x5efe) embedded.push(dotted(h[6], h[7]));
  if (h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    embedded.push(dotted(h[6], h[7]));
  }
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0x0001) embedded.push(dotted(h[6], h[7]));
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0x0000 && !(h[6] === 0 && (h[7] === 0 || h[7] === 1))) {
    embedded.push(dotted(h[6], h[7]));
  }
  return embedded;
}

/** 元数据地址：直接命中、v4 映射、或过渡前缀内嵌（源:164-169）。 */
function isCloudMetadataAddress(value) {
  const ip = parseIp(value);
  if (!ip) return false;
  const textual = ip.kind === 'v4' ? ip.octets.join('.') : value;
  if (CLOUD_METADATA_ADDRESSES.has(textual)) return true;
  if (ip.kind === 'v4' && CLOUD_METADATA_ADDRESSES.has(ip.octets.join('.'))) return true;
  return tunnelEmbeddedIPv4(ip).some((embedded) => CLOUD_METADATA_ADDRESSES.has(embedded));
}

/** 永不允许的段：IANA 保留 / 组播 / 广播（源:183-188）。 */
function isNeverAllowedRange(value) {
  const ip = parseIp(value);
  if (!ip) return false;
  const range = rangeOf(ip);
  return range === 'reserved' || range === 'multicast' || range === 'broadcast';
}

/** opt-in 才能放行的段：私网 / 环回 / 链路本地 / CGNAT（源:197-201）。 */
function isOptInGovernedRange(value) {
  const ip = parseIp(value);
  if (!ip) return false;
  return isPrivateIP(value) || rangeOf(ip) === 'carrierGradeNat';
}

async function lookupWithTimeout(hostname, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([dns.lookup(hostname, { all: true, verbatim: true }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 上游 `assertSafeIp`（源:223-237）。 */
export function assertSafeIp(value) {
  const ip = parseIp(value);
  if (!ip) throw new UnsafeNetworkTargetError('Local/private/reserved network URLs are not allowed');
  if (isCloudMetadataAddress(value) || isPrivateIP(value) || rangeOf(ip) !== 'unicast') {
    throw new UnsafeNetworkTargetError('Local/private/reserved network URLs are not allowed');
  }
}

/** 上游 `connectionAddressBlockReason`（源:251-276）。 */
export function connectionAddressBlockReason(value, allowLocalNetworks) {
  const ip = parseIp(value);
  if (!ip) return LOCAL_NETWORK_BLOCK_MESSAGE;
  if (isCloudMetadataAddress(value)) return CLOUD_METADATA_BLOCK_MESSAGE;
  if (isNeverAllowedRange(value)) return LOCAL_NETWORK_BLOCK_MESSAGE;
  if (allowLocalNetworks) return null;
  if (isOptInGovernedRange(value)) return LOCAL_NETWORK_BLOCK_MESSAGE;
  return null;
}

export function assertSafeConnectionAddress(value, allowLocalNetworks) {
  const reason = connectionAddressBlockReason(value, allowLocalNetworks);
  if (reason) throw new UnsafeNetworkTargetError(reason);
}

/** 上游 `normalizeUrlForStrictFetch`（源:285-313）。 */
export function normalizeUrlForStrictFetch(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new UnsafeNetworkTargetError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeNetworkTargetError('Only HTTP(S) URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeNetworkTargetError('URLs containing userinfo are not allowed');
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw new UnsafeNetworkTargetError('Only ports 80 and 443 are allowed');
  }
  const hostname = normalizeAddress(parsed.hostname);
  if (CLOUD_METADATA_HOSTNAMES.has(hostname) || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new UnsafeNetworkTargetError('Local/private/reserved network URLs are not allowed');
  }
  if (isIP(hostname)) assertSafeIp(hostname);
  return parsed;
}

/** 上游 `validateUrlForSSRFWithPolicy`（源:485-592）。 */
export async function validateUrlForSSRFWithPolicy(url, policy) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Only HTTP(S) URLs are allowed';
  }

  const allowLocal = policy.allowLocalNetworks;
  const optInGovernedBlockMessage = policy.clientSupplied
    ? CLIENT_SUPPLIED_LOCAL_NETWORK_BLOCK_MESSAGE
    : LOCAL_NETWORK_BLOCK_MESSAGE;
  const hostname = normalizeAddress(parsed.hostname);

  if (CLOUD_METADATA_HOSTNAMES.has(hostname) || isCloudMetadataAddress(hostname)) {
    return CLOUD_METADATA_BLOCK_MESSAGE;
  }

  if (isNeverAllowedRange(hostname)) return LOCAL_NETWORK_BLOCK_MESSAGE;

  if (allowLocal) {
    if (isIP(hostname)) return null;
    let resolvedAddresses;
    try {
      resolvedAddresses = await lookupWithTimeout(hostname, ALLOW_LOCAL_DNS_TIMEOUT_MS);
    } catch {
      return null;
    }
    if (resolvedAddresses?.some(({ address }) => isCloudMetadataAddress(address))) {
      return CLOUD_METADATA_BLOCK_MESSAGE;
    }
    if (resolvedAddresses?.some(({ address }) => isNeverAllowedRange(address))) {
      return LOCAL_NETWORK_BLOCK_MESSAGE;
    }
    return null;
  }

  if (
    hostname === 'localhost'
    || hostname.endsWith('.local')
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || isOptInGovernedRange(hostname)
  ) {
    return optInGovernedBlockMessage;
  }

  if (isIP(hostname)) return null;

  let resolvedAddresses;
  try {
    resolvedAddresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return 'Unable to verify hostname safety';
  }
  if (resolvedAddresses.length === 0) return 'Unable to verify hostname safety';

  if (resolvedAddresses.some(({ address }) => isCloudMetadataAddress(address))) {
    return CLOUD_METADATA_BLOCK_MESSAGE;
  }
  if (resolvedAddresses.some(({ address }) => isNeverAllowedRange(address))) {
    return LOCAL_NETWORK_BLOCK_MESSAGE;
  }
  if (resolvedAddresses.some(({ address }) => isOptInGovernedRange(address))) {
    return optInGovernedBlockMessage;
  }
  return null;
}

export async function validateUrlForSSRF(url) {
  return validateUrlForSSRFWithPolicy(url, { allowLocalNetworks: allowLocalNetworksEnabled() });
}

/** 源:611-616：客户端 baseUrl 不得带 query/fragment（会被拼路径吸收）。 */
export async function validateClientBaseUrl(url) {
  if (url.includes('?') || url.includes('#')) {
    return 'Base URL must not contain a query string or fragment';
  }
  return validateUrlForSSRF(url);
}

export async function validatePublicUrlForSSRF(url) {
  return validateUrlForSSRFWithPolicy(url, { allowLocalNetworks: false, clientSupplied: true });
}
