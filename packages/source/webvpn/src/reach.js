/**
 * 逐主机可达性检查：访问前先问一句「这个站现在通不通」。
 *
 * # 与 `doctor()` 的分工
 *
 * `doctor()` 答的是**本机的处境**（在不在校内、网关通不通、会话还有没有效），
 * 三项固定探测，不含业务站。
 *
 * 这个模块答的是**某几个具体站点**能不能到 —— 用户说「教务打不开」时，
 * 需要知道的是 `zdbk.zju.edu.cn` 通不通，而不是网关通不通。
 *
 * # 必须是真实 HTTPS 请求，不能是 TCP connect
 *
 * 本机有 TUN / 梯子时，`connect` 对**任何**地址都会"成功"。所以判据是
 * 「收到任何 HTTP 响应即算通」。5xx 也算通 —— 那是站点自己有问题，与
 * 「够不着」在排查上是两回事，混在一处会把用户引去查网络。
 *
 * # 缓存
 *
 * 逐条命令都探一次太慢，所以结果按主机缓存 10 分钟。默认**只缓存在内存**
 * （跨进程失效，不产生任何文件）；传 `cacheFile` 时落盘，跨重启复用。
 *
 * 落盘是**可选**的：这个包既不假定调用方有可写目录，也不假定它有权限。
 * 需要跨进程复用的调用方（设置页、维护脚本）自己指定路径并负责目录存在。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** 缓存有效期。10 分钟足够避掉"一条命令里探十次"，又不至于让结果太旧。 */
export const REACH_TTL_MS = 10 * 60 * 1000;

/** 单主机探测超时。给 4 秒：这不是诊断，是访问前的一道快速闸门。 */
export const REACH_TIMEOUT_MS = 4000;

/**
 * 各主机不通时给用户的解释。
 *
 * 只写**能改变下一步动作**的那几句话。没有对应条目的主机给一句中性的
 * 「不可达」，不猜原因 —— 猜错的原因比没有原因更浪费时间。
 */
export const REACH_HINTS = Object.freeze({
  'webvpn.zju.edu.cn': 'WebVPN 入口不通。它在国内公网可达；海外或被封的网段不行。先跑一次网关诊断',
  'zjuam.zju.edu.cn': '统一身份认证不通。它在国内公网可达；海外或被封的网段不行',
  'chalaoshi.de': '查老师在国内被墙，需要本机能出海（WebVPN 帮不上忙）',
  'api.chalaoshi.de': '查老师 API 子域不通，需要本机能出海',
});

/**
 * 探一个主机。
 *
 * 带 `Range: bytes=0-0` 只要一个字节 —— 我们只关心**响应头**，不需要正文。
 *
 * @param host - 主机名。
 * @param options.fetch - fetch 实现（默认全局）。
 * @param options.timeout - 超时。
 * @returns `{ host, ok, ms, cached, error? }`。
 */
export async function probeReach(host, {
  fetch: fetchImpl = globalThis.fetch,
  timeout = REACH_TIMEOUT_MS,
} = {}) {
  const name = String(host ?? '').trim();
  const startedAt = performance.now();
  try {
    await fetchImpl(`https://${name}/`, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(timeout),
    });
    return { host: name, ok: true, ms: Math.round(performance.now() - startedAt), cached: false };
  } catch (error) {
    return {
      host: name,
      ok: false,
      ms: Math.round(performance.now() - startedAt),
      cached: false,
      error: String(error?.code ?? error?.message ?? error),
    };
  }
}

/**
 * 内存缓存。形如 `Map<host, { ok, at, ms }>`，只存**成功**结果。
 *
 * 只存成功是刻意的：一次失败可能只是瞬断，把它缓存 10 分钟等于让用户
 * 在一次抖动之后持续看到"不可达"。失败每次重试，代价是 4 秒。
 */
function createMemoryCache() {
  return new Map();
}

/**
 * 读落盘缓存；文件不存在、损坏、版本不符一律当空。
 *
 * 不抛错：缓存坏掉只该让这次变慢，不该让调用失败。
 *
 * @param file - 缓存文件路径。
 * @returns `{ version, hosts }` 形状的对象。
 */
async function readCacheFile(file) {
  const empty = { version: 1, hosts: {} };
  if (!file) return empty;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.version !== 1 || typeof parsed.hosts !== 'object' || parsed.hosts === null) return empty;
    return parsed;
  } catch {
    return empty;
  }
}

/**
 * 写落盘缓存。失败**不抛** —— 缓存写不进去不该让查询失败。
 *
 * @param file - 缓存文件路径。
 * @param cache - `{ version, hosts }`。
 */
async function writeCacheFile(file, cache) {
  if (!file) return;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(cache)}\n`, 'utf8');
  } catch {
    // 缓存是加速手段，不是正确性依赖。
  }
}

/**
 * 探测一组主机。
 *
 * @param hosts - 主机名数组。
 * @param options.fresh - 跳过缓存，全部重新探测。
 * @param options.fetch - fetch 实现（默认全局）。
 * @param options.timeout - 单主机超时。
 * @param options.now - 当前时间（可注入，便于测试 TTL）。
 * @param options.memory - 复用的内存缓存（默认每次新建）。
 * @param options.cacheFile - 落盘缓存路径；不给就只走内存。
 * @returns 与 `hosts` 顺序**一致**的结果数组（调用方按位置对应，不必自己对齐）。
 */
export async function checkReachable(hosts, {
  fresh = false,
  fetch: fetchImpl = globalThis.fetch,
  timeout = REACH_TIMEOUT_MS,
  now = Date.now,
  memory = null,
  cacheFile = null,
} = {}) {
  const store = memory ?? createMemoryCache();
  const file = cacheFile ? await readCacheFile(cacheFile) : { version: 1, hosts: {} };

  const results = new Map();
  const todo = [];

  for (const host of hosts) {
    const name = String(host ?? '').trim();
    if (!name) continue;
    const hit = store.get(name) ?? file.hosts[name];
    if (!fresh && hit && hit.ok && now() - hit.at < REACH_TTL_MS) {
      results.set(name, { host: name, ok: true, ms: hit.ms, cached: true });
      continue;
    }
    todo.push(name);
  }

  const measured = await Promise.all(todo.map((name) => probeReach(name, { fetch: fetchImpl, timeout })));
  for (const result of measured) {
    const at = now();
    if (result.ok) {
      const record = { ok: true, at, ms: result.ms };
      store.set(result.host, record);
      file.hosts[result.host] = record;
    } else {
      store.delete(result.host);
      delete file.hosts[result.host];
    }
    results.set(result.host, result);
  }

  if (cacheFile && measured.length) await writeCacheFile(cacheFile, file);

  // 按入参顺序返回：调用方拿到的第 i 项对应第 i 个主机。
  return hosts
    .map((host) => results.get(String(host ?? '').trim()))
    .filter((result) => result !== undefined);
}

/**
 * 不通就抛错。
 *
 * 与 `checkReachable` 分开，是因为**有些调用方只想报告、不想失败**
 * （设置页的「测一下」按钮），而另一些必须停下（访问前的闸门）。
 *
 * 错误的 `details.hosts` 只放主机名，不放响应体、URL 原文或凭据。
 *
 * @param hosts - 主机名数组。
 * @param options - 同 `checkReachable`。
 * @returns 全部可达时的结果数组。
 */
export async function requireReachable(hosts, options = {}) {
  const results = await checkReachable(hosts, options);
  const down = results.filter((result) => !result.ok);
  if (!down.length) return results;
  const lines = down.map((result) => `${result.host}：${REACH_HINTS[result.host] ?? '不可达'}（${result.error ?? '超时'}）`);
  const error = new Error(`网络不可达：${lines.join('；')}`);
  error.code = 'TRANSPORT';
  error.details = { hosts: down.map((result) => result.host) };
  throw error;
}
