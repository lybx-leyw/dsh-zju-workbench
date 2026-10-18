/**
 * 智云 Pro 在**宿主凭据服务**（`ctx.credentials`）上的读写封装。
 *
 * # 为什么要有这一个文件
 *
 * 本仓原本每个包各自实现凭据保管：`dsh-zhiyun-classroom` 用 DPAPI 存会话，
 * `dsh-zhiyun-omni` 另有一套 DPAPI（`accounts.json` + `credentials/*.dpapi`）。
 * 后果是**用户登录了课堂，规划页却说"未配置账号，去终端跑 configure"** ——
 * 同一份浙大账号被要求填两次，而且其中一次要开终端。
 *
 * 宿主本来就提供了 `ctx.credentials`（`@deepseek-ai/dsh-credentials`）：
 * 它是本产品保管密钥与凭据记录的正规接缝，支持 `readRecord` / `modifyRecord` /
 * `deleteRecord`，值不会回显给配置界面。两个包共用它，就只需要登录一次。
 *
 * # 记录形状
 *
 * 用 `kind: 'grant'` + `payload`（宿主允许任意 JSON）存账号与学在浙大会话：
 *
 * ```yaml
 * records:
 *   zhiyun-classroom/account:
 *     kind: grant
 *     payload: { username: '...', password: '...' }
 *   zhiyun-classroom/xzzd-session:
 *     kind: grant
 *     payload: { cookies: [...] }
 * ```
 *
 * 选 `grant` 而不是 `api-key`：后者的形状被限定成 `{key, env}`，塞不下结构化数据；
 * `grant` 语义上就是"登录流程换来的东西"，与这里要存的东西一致。
 *
 * # 兼容
 *
 * `ctx.credentials` 不可用时（精简组合、测试里的最小 ctx）**全部方法返回 null**，
 * 由调用方退回各自的老路径。本模块不认识任何磁盘格式，也不写任何文件。
 */

/** 记录键的两段：`<scope>/<id>`。scope 必须是**注册的插件名**。 */
export const RECORD_SCOPE = 'zhiyun-classroom';

/** 记录 id：账号（用户名 + 密码）。 */
export const ACCOUNT_ID = 'account';

/** 记录 id：学在浙大会话（cookie）。 */
export const XZZD_SESSION_ID = 'xzzd-session';

/**
 * 取宿主凭据服务。
 *
 * @param ctx - 插件上下文。
 * @returns 服务实例，或 null（未装配凭据存储时）。
 */
export function credentialsOf(ctx) {
  try {
    const service = ctx?.get?.('credentials') ?? ctx?.credentials;
    if (!service) return null;
    // 三个方法缺一不可：只读不能写会变成"配了一次永远改不了"
    if (typeof service.readRecord !== 'function') return null;
    if (typeof service.modifyRecord !== 'function') return null;
    return service;
  } catch {
    return null;
  }
}

/**
 * 拼记录键。宿主的记录键是 `<scope>/<id>` 字符串。
 *
 * @param id - 记录 id。
 * @returns 记录键。
 */
export function recordKey(id) {
  return `${RECORD_SCOPE}/${id}`;
}

/**
 * 读一条记录。
 *
 * @param ctx - 插件上下文。
 * @param id - 记录 id。
 * @returns 记录的 payload，或 null（没配 / 服务不可用 / 形状不对）。
 */
export async function readRecord(ctx, id) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(recordKey(id));
    if (!record || record.kind !== 'grant') return null;
    return record.payload ?? null;
  } catch {
    // 读不到就当没配：凭据存储坏掉不该让插件崩，只是要用户重配一次
    return null;
  }
}

/**
 * 写一条记录（整体替换）。
 *
 * 用 `modifyRecord` 而不是 `set`：`set` 只接受字符串 ref 值，`grant` 记录必须走
 * modify 路径（宿主注释里写明"a token refresh is read-decide-replace under one lock"）。
 *
 * @param ctx - 插件上下文。
 * @param id - 记录 id。
 * @param payload - 要存的 JSON。
 * @returns 写成功返回 true。
 */
export async function writeRecord(ctx, id, payload) {
  const service = credentialsOf(ctx);
  if (!service) return false;
  try {
    await service.modifyRecord(recordKey(id), () => ({ kind: 'grant', payload }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 删一条记录。
 *
 * @param ctx - 插件上下文。
 * @param id - 记录 id。
 * @returns 删掉返回 true；本来没有也算 true（幂等）。
 */
export async function deleteRecord(ctx, id) {
  const service = credentialsOf(ctx);
  if (!service) return false;
  try {
    await service.deleteRecord(recordKey(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读**账号**（用户名 + 密码）。
 *
 * @param ctx - 插件上下文。
 * @returns `{ username, password }` 或 null。
 */
export async function readAccount(ctx) {
  const payload = await readRecord(ctx, ACCOUNT_ID);
  if (!payload || typeof payload !== 'object') return null;
  const { username, password } = payload;
  if (typeof username !== 'string' || !username) return null;
  if (typeof password !== 'string' || !password) return null;
  return { username, password };
}

/**
 * 存**账号**。只在用户主动登录时调用 —— 本模块不主动收集密码。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 写成功返回 true。
 */
export async function writeAccount(ctx, { username, password }) {
  if (typeof username !== 'string' || !username) return false;
  if (typeof password !== 'string' || !password) return false;
  return await writeRecord(ctx, ACCOUNT_ID, { username, password });
}

/**
 * 读**学在浙大会话**。
 *
 * @param ctx - 插件上下文。
 * @returns cookie 数组，或 null。
 */
export async function readXzzdSession(ctx) {
  const payload = await readRecord(ctx, XZZD_SESSION_ID);
  if (!payload || !Array.isArray(payload.cookies) || payload.cookies.length === 0) return null;
  return payload.cookies;
}

/**
 * 存**学在浙大会话**。
 *
 * @param ctx - 插件上下文。
 * @param cookies - StoredCookie 数组。
 * @returns 写成功返回 true。
 */
export async function writeXzzdSession(ctx, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  return await writeRecord(ctx, XZZD_SESSION_ID, {
    cookies,
    saved_at: new Date().toISOString(),
  });
}
