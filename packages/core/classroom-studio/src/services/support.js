/**
 * 服务层的公共接缝（不搬任何 route 逻辑，只把 Next 的形状换成本仓的形状）。
 *
 * # 三类返回
 *
 * 1. `{ httpStatus, body, headers }` —— 上游 `NextResponse.json(...)`，`body` 就是
 *    上游的第一个参数（可能是 `{success:…}` 信封，也可能是 `{error:{code,message}}`）；
 * 2. `{ httpStatus, body: 'Not found', headers }` —— 上游 `new Response('Not found')`
 *    的纯文本分支（`agents` / `folders` / `stages` / `materials` 的「没有持久层」）；
 * 3. `{ httpStatus, buffer, mimeType, headers }` —— 二进制分支（proxy-media），
 *    规范要求 `Buffer` + `{ mimeType }`，不用 Node stream。
 *
 * # owner 接缝
 *
 * 上游每条 owner-scoped route 都包一层 `withRequestOwner(req, (principal, headers) => …)`：
 * principal 是请求的 owner（**永远不是请求参数**），headers 里可能带着新铸的
 * Set-Cookie，必须挂在**成功与失败**两种响应上。
 *
 * 本包的 `owner` 端口把这层抽象成 `resolve(req)`：
 *
 * ```js
 * owner.resolve({ ownerId?, headers? }) -> { ok: true, ownerId, headers: Headers }
 *                                        | { ok: false, httpStatus, body }
 * ```
 *
 * 默认实现（未注入时）= 单机单用户：`ownerId = req.ownerId ?? 'local'`，无 cookie。
 * 注入真身份服务后，`withOwner` 的行为与上游一致，**route body 不用改**。
 */

import { missingService } from '../errors.js';

/** 一条纯文本响应（上游 `new Response('Not found', { status })`）。 */
export function plainResponse(httpStatus, body, headers = new Headers()) {
  return { httpStatus, body, headers };
}

/** 上游 `NextResponse.json(body, { status, headers })`。 */
export function jsonResponse(body, httpStatus = 200, headers = new Headers()) {
  return { httpStatus, body, headers };
}

/** 上游 owner-scoped route 的 `{ error: { code, message } }` 信封（folders / model-config）。 */
export function jsonError(httpStatus, code, message, headers = new Headers()) {
  return jsonResponse({ error: { code, message } }, httpStatus, headers);
}

/** 二进制响应：规范要求 `Buffer` + `{ mimeType }`（不用 Node stream）。 */
export function binaryResponse(httpStatus, buffer, mimeType, headers = new Headers()) {
  return { httpStatus, buffer, mimeType, headers };
}

export const NOT_FOUND = 'Not found';

/**
 * 默认 owner 端口：没有身份服务时，所有请求都是同一个本地 owner。
 * 与上游「匿名 owner = 这个浏览器」等价（单机只有一个浏览器）。
 */
export const localOwner = {
  name: 'local',
  async resolve(request) {
    const ownerId = (request && typeof request.ownerId === 'string' && request.ownerId.trim())
      ? request.ownerId.trim()
      : 'local';
    return { ok: true, ownerId, headers: new Headers() };
  },
};

/**
 * 把 route handler 包成「先解析 owner，再跑 body」的形状（`withRequestOwner` 的等价物）。
 *
 * @param {object} deps
 * @param {object|undefined} request `{ ownerId?, headers? }`
 * @param {(ctx: { ownerId: string, headers: Headers }) => Promise<object>} run
 */
export async function withOwner(deps, request, run) {
  const resolved = await deps.owner.resolve(request ?? {});
  if (resolved?.ok === false) {
    return {
      httpStatus: resolved.httpStatus ?? 401,
      body: resolved.body ?? NOT_FOUND,
      headers: resolved.headers ?? new Headers(),
    };
  }
  const headers = resolved?.headers instanceof Headers ? resolved.headers : new Headers();
  const result = await run({ ownerId: resolved.ownerId, headers });
  // 上游 `withOwnerResponseHeaders`：owner 头必须挂在**每一种**响应上。
  if (result && result.headers instanceof Headers) {
    for (const [key, value] of headers) result.headers.append(key, value);
  }
  return result;
}

/** 取头（大小写不敏感），`Headers` 与普通对象都支持。 */
export function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

/** 取 query（`{ query }` 或 `URLSearchParams`）。 */
export function searchParam(source, name) {
  if (!source) return null;
  if (typeof source.get === 'function') return source.get(name);
  if (source.query && typeof source.query.get === 'function') return source.query.get(name);
  if (source.query && typeof source.query === 'object') {
    const value = source.query[name];
    return value === undefined ? null : String(value);
  }
  return null;
}

/** 是否有这个 query 键（上游 `searchParams.has(...)`；空值也算「有」）。 */
export function hasSearchParam(source, name) {
  if (!source) return false;
  if (typeof source.has === 'function') return source.has(name);
  if (source.query && typeof source.query.has === 'function') return source.query.has(name);
  if (source.query && typeof source.query === 'object') return name in source.query;
  return false;
}

/**
 * 惰性取一个宿主服务。取不到时**不抛**，由调用方决定是降级还是抛
 * `E_MISSING_SERVICE`（规范 §4：apply 永不因上游缺失而抛错）。
 */
export function serviceOf(deps, key) {
  try {
    const value = typeof deps[key] === 'function' ? deps[key]() : deps[key];
    return value ?? null;
  } catch {
    return null;
  }
}

/** 取存储服务，取不到就抛（被调用时，不是 apply 时）。 */
export function requireVault(deps) {
  const vault = serviceOf(deps, 'vault');
  if (!vault) {
    throw missingService('zhiyunClassroomVault', '课堂持久层未装载：classroom / folders / runs / materials 都需要它');
  }
  return vault;
}
