/**
 * **浙大一卡通**账号密码：智云课堂与学在浙大**共用**的唯一凭证来源。
 *
 * # 为什么单独一层
 *
 * 原来凭据散在两处：`@lybx-leyw/dsh-zju-source-classroom` 登录时写进宿主凭据
 * （`zw-classroom/account`），`dsh-zhiyun-source-omni` / `@lybx-leyw/dsh-zju-source-campus` 各读各的。
 * 而写入点是「个人」页那个**连接课堂**表单 —— 那意味着"想用学在浙大待办，
 * 得先点一次连接课堂"，两件不相关的事被绑在一起。
 *
 * 现在改成：
 *
 * ```text
 * 设置里填「浙大一卡通」→ 宿主凭据服务（加密、不回显）
 *                       ├→ 智云课堂 取会话
 *                       └→ 学在浙大 取会话
 * ```
 *
 * 个人页不再承担登录职责（它将来会接我们自己的账号体系，与浙大凭证无关）。
 *
 * # 语义边界（重要，别混）
 *
 * 「浙大一卡通」在本仓是**对浙大统一身份认证账号密码的称呼** —— 学号 + 密码，
 * 也就是 CAS（`zjuam.zju.edu.cn`）认的那一套。它**不是**校园卡的消费查询密码。
 *
 * 这个区分必须写在代码里而不是只写在文档里：将来若真要接校园卡消费记录，
 * 那是**另一套**凭证、另一个记录 id，不能复用这里。
 *
 * # 存储
 *
 * 沿用宿主 `ctx.credentials` 的 `kind: 'grant'` 记录（DPAPI 加密，
 * 值不回显给任何界面）。记录 id 保持 `zw-classroom/account` ——
 * **不是**为了"还叫课堂"，而是因为已经登录过的用户数据就在那里；
 * 换 id 会让所有现有用户凭空丢掉凭据、被迫重登一次。
 * 语义上它现在表示"浙大一卡通账号"，别名见 `CARD_RECORD_KEY`。
 */

// 设置路由 / 写头 / 打码值三条常量定义在 `shared.js` —— 客户端半边也要 import 它们，
// 但它**不能** import 本文件（那会把宿主半边的 `apply` 打进浏览器产物），所以常量
// 挪到那个纯数据文件里。这里 import + 重新导出，导出名保持不变：
//   · 写了第二份字面量的话，漂移的表现是"点了保存没反应"（路由打错或写头差一个字母
//     被 403 拒掉，两种都不报错）。
import path from 'node:path';

import { ClassroomError, SessionStore, Transport } from '@lybx-leyw/dsh-zju-source-http';

import { casLogin } from './cas.js';
import { MASK, ROUTE_PATH, WRITE_HEADER } from './shared.js';

/** 记录键。沿用旧 id 以免既有用户丢凭据（语义已是"一卡通"）。 */
export const CARD_RECORD_KEY = 'zw-classroom/account';

/**
 * WebVPN「上网账号」的记录键。**与一卡通分开存**。
 *
 * # 为什么不能复用一卡通那一份
 *
 * WebVPN 网关认的是**上网账号**，与统一身份认证是两套系统：账号通常都是学号，
 * 但密码未必相同。拿一卡通密码去登网关，失败时用户会以为"密码错了"，于是去改
 * 一个本来正确的密码 —— 这正是本仓在 CAS 归因上已经踩过的同一个坑。
 *
 * 分开存还有一个好处：清除其中一个不会顺手动掉另一个。
 */
export const WEBVPN_RECORD_KEY = 'zw-campus/webvpn';

/** 语义别名：新代码里读它，比记忆"为什么叫 classroom"清楚。 */
export const CARD_RECORD_KEY_LEGACY_NOTE = '沿用旧记录 id：换 id 会让已有用户丢凭据';

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
    // 三个方法缺一不可：只能读不能写会变成"配了一次永远改不了"
    if (typeof service.readRecord !== 'function') return null;
    if (typeof service.modifyRecord !== 'function') return null;
    return service;
  } catch {
    return null;
  }
}

/**
 * 读「浙大一卡通」账号。
 *
 * 每次调用都**现取**凭据服务，不在 apply 阶段缓存 —— 服务可能晚于本包就绪
 * （凭据包在 profile 里排在后面是常态），缓存成 null 会永久失效。
 *
 * @param ctx - 插件上下文。
 * @returns `{ username, password }`，或 null（没配 / 读不到）。
 */
export async function readCard(ctx) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(CARD_RECORD_KEY);
    if (!record || record.kind !== 'grant') return null;
    const { username, password } = record.payload ?? {};
    if (typeof username !== 'string' || !username) return null;
    if (typeof password !== 'string' || !password) return null;
    return { username, password };
  } catch {
    // 凭据存储读坏不该让插件崩，只是要用户重配一次
    return null;
  }
}

/**
 * 凭据记录的形状。**只在这里构造一次。**
 *
 * 为什么值得单独一个函数：这张记录现在有两个写入入口（设置里「保存」= `writeCard`、
 * 登录成功后回填 = `fillCardIfEmpty`），将来还可能有第三个。形状散在几处写，
 * 迟早会漂。
 *
 * # ⚠️ `grant` 记录只允许两个字段：`kind` 与 `payload`
 *
 * 宿主 `dsh-credentials-local` 的 `parseRecord` 对 `grant` 做的是**白名单**校验：
 *
 * ```js
 * assertFields(key, fields, ["kind", "payload"], filename);  // 多一个字段直接抛
 * ```
 *
 * 而这个校验发生在**启动加载时**（`loadInitial` → `parseCredentialsDocument`），
 * 不是写入时。所以往记录里多塞一个字段（比如 `label`）的后果不是"这次写入失败"，
 * 而是**整个工作台起不来**——一次把用户挡在门外，且报错信息指向 yaml 文件解析，
 * 看不出是哪段代码写的。
 *
 * 用途说明只能放进 `payload` 里（`payload` 是任意 JSON，宿主不校验它的键）。
 * 这也是为什么本函数把 `label` 收进 payload 而不是放在顶层。
 *
 * @param account - 已校验过的 `{ username, password }`。
 * @returns 宿主 `kind: 'grant'` 记录。
 */
function cardRecord({ username, password }) {
  return {
    kind: 'grant',
    payload: {
      username: username.trim(),
      password,
      // 给人看的用途说明。放在 payload 里而不是顶层 —— 见上面的白名单说明。
      label: CARD_LABEL,
    },
  };
}

/** 记录的用途说明。显示在宿主凭据列表里，表明它是什么。 */
export const CARD_LABEL = '浙大一卡通';

/** WebVPN 那份凭据在宿主凭据列表里的说明。 */
export const WEBVPN_LABEL = 'WebVPN 上网账号';

/**
 * CC98 账号的记录键。**与一卡通分开存**。
 *
 * # 为什么必须分开
 *
 * CC98 有**自己的账号体系**（`openid.cc98.org` 的 OAuth2），与浙大统一认证
 * （`zjuam.zju.edu.cn` 的 CAS）是两套东西：
 *
 * - 只用 CC98 的人（校外、已毕业、只注册过论坛）没有浙大统一认证身份；
 * - 有浙大身份的人，CC98 密码也未必与一卡通密码相同。
 *
 * 早先 cc98 数据包是**借**一卡通那份记录去登 CC98 的 —— 在那个假设下，
 * 只有 CC98 账号的人永远登不进去，而失败提示还把用户指向「改一卡通密码」，
 * 方向完全相反。这正是 WebVPN 那条注释里描述过的同一个坑。
 *
 * 分开存还有两个好处：清除其中一个不会顺手动掉另一个；失败时能明确说清
 * 「是哪一套账号被拒了」。
 */
export const CC98_RECORD_KEY = 'zw-cc98/account';
/** 实验课平台自己的账号（`auth: "own"`：与统一身份认证**不是**同一份）。 */
export const LAB_RECORD_KEY = 'zw-lab/account';
export const LAB_LABEL = '实验课平台';
/**
 * 浙大邮箱的**客户端专用密码**（16 位，在邮箱网页版生成）。
 *
 * ⚠️ 它**不是**统一身份认证密码，也不是 CAS 会话 —— IMAP/SMTP 的 SASL 认证
 * 只认这串专用密码（依据：上游 `plugin/client/MailSettings.tsx` 硬校验 16 位，
 * 并给出「设置 → 安全设置 → 客户端专用密码」的生成路径）。
 */
export const MAIL_RECORD_KEY = 'zw-mail/account';
export const MAIL_LABEL = '邮箱';

/** CC98 那份凭据在宿主凭据列表里的说明。 */
export const CC98_LABEL = 'CC98 论坛账号';

/** 造 WebVPN 记录。形状与 `cardRecord` 一致（`grant` 只允许 kind + payload）。 */
function webvpnRecord({ username, password }) {
  return {
    kind: 'grant',
    payload: { username: username.trim(), password, label: WEBVPN_LABEL },
  };
}

/** 造 CC98 记录。 */
function cc98Record({ username, password }) {
  return {
    kind: 'grant',
    payload: { username: username.trim(), password, label: CC98_LABEL },
  };
}

/**
 * 校验并规整一份账号。
 *
 * @param account - 任意输入。
 * @returns `{ username, password }`，或 null（不合法）。
 */
function validAccount(account) {
  const { username, password } = account ?? {};
  if (typeof username !== 'string' || !username.trim()) return null;
  if (typeof password !== 'string' || !password) return null;
  return { username, password };
}

/**
 * 写「浙大一卡通」账号（**无条件覆盖**）。
 *
 * 这是「设置里点保存」的语义：用户明确说"就用这一份"，所以覆盖是对的。
 * 不要用它做登录后的回填 —— 那需要 `fillCardIfEmpty`。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 写成功返回 true。
 */
export async function writeCard(ctx, account) {
  const valid = validAccount(account);
  if (!valid) return false;
  const service = credentialsOf(ctx);
  if (!service) return false;
  try {
    await service.modifyRecord(CARD_RECORD_KEY, () => cardRecord(valid));
    return true;
  } catch {
    return false;
  }
}

/**
 * **只在还没有凭据时**写一份（登录成功后回填用）。
 *
 * # 为什么必须是一个原子操作
 *
 * 「先 `readCard()` 看有没有，没有再 `writeCard()`」是**两步**，中间那个窗口里
 * 用户完全可能在设置里点了保存 —— 于是回填把它覆盖掉，用户刚配的账号凭空变成
 * 他登录时用的那个。表现极难复现，而且用户会以为是设置没保存。
 *
 * 宿主的 `modifyRecord` 本身就是 read-decide-replace under one lock，
 * 所以判空与写入必须写在**同一个回调**里：要么读到旧的、要么写入新的，没有中间态。
 *
 * # 与 `writeCard` 的分工
 *
 *   - `writeCard`        —— "以我为准"（设置里保存，用户明确覆盖）
 *   - `fillCardIfEmpty`  —— "只补空缺"（登录后回填，绝不覆盖用户配的）
 *
 * 这两条语义**必须是两个函数**。合成一个带布尔参数的函数，早晚会有人传错。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 真的写下去了返回 true；已有凭据（没动它）返回 false。
 */
export async function fillCardIfEmpty(ctx, account) {
  const valid = validAccount(account);
  if (!valid) return false;
  const service = credentialsOf(ctx);
  if (!service) return false;
  let written = false;
  try {
    await service.modifyRecord(CARD_RECORD_KEY, (existing) => {
      // 判空与写入在同一个锁内：这里没有"判完到写之前"的窗口
      if (existing && existing.kind === 'grant' && existing.payload?.username && existing.payload?.password) {
        return existing;
      }
      written = true;
      return cardRecord(valid);
    });
    return written;
  } catch {
    return false;
  }
}

/**
 * 删掉「浙大一卡通」账号。
 *
 * @param ctx - 插件上下文。
 * @returns 删掉返回 true；本来没有也算 true（幂等）。
 */
export async function clearCard(ctx) {
  const service = credentialsOf(ctx);
  if (!service || typeof service.deleteRecord !== 'function') return false;
  try {
    await service.deleteRecord(CARD_RECORD_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 凭据是否已配置（**只回有无，不回值**）。
 *
 * @param ctx - 插件上下文。
 * @returns `{ configured, username }`；`username` 可回显（它不是秘密）。
 */
export async function cardStatus(ctx) {
  const card = await readCard(ctx);
  if (!card) return { configured: false, username: '' };
  return { configured: true, username: card.username };
}

/* ────────────────────────────────────────── WebVPN 上网账号（另一份凭据） */

/**
 * 读 WebVPN 的「上网账号」。
 *
 * 与 `readCard` 同构：每次现取服务、形状不对就 null、读坏不抛。
 *
 * @param ctx - 插件上下文。
 * @returns `{ username, password }` 或 null。
 */
export async function readWebvpn(ctx) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(WEBVPN_RECORD_KEY);
    if (!record || record.kind !== 'grant') return null;
    const { username, password } = record.payload ?? {};
    if (typeof username !== 'string' || !username) return null;
    if (typeof password !== 'string' || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * 写 WebVPN 的「上网账号」（无条件覆盖）。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 写成功返回 true。
 */
export async function writeWebvpn(ctx, account) {
  const valid = validAccount(account);
  if (!valid) return false;
  const service = credentialsOf(ctx);
  if (!service) return false;
  try {
    await service.modifyRecord(WEBVPN_RECORD_KEY, () => webvpnRecord(valid));
    return true;
  } catch {
    return false;
  }
}

/** 删掉 WebVPN 上网账号（幂等）。 */
export async function clearWebvpn(ctx) {
  const service = credentialsOf(ctx);
  if (!service || typeof service.deleteRecord !== 'function') return false;
  try {
    await service.deleteRecord(WEBVPN_RECORD_KEY);
    return true;
  } catch {
    return false;
  }
}

/** WebVPN 凭据状态（只回有无，不回值）。 */
export async function webvpnStatus(ctx) {
  const account = await readWebvpn(ctx);
  if (!account) return { configured: false, username: '' };
  return { configured: true, username: account.username };
}

/**
 * 读 CC98 账号。
 *
 * 返回 null 表示「没配」，**不代表 CC98 与一卡通等价** —— 调用方不该拿
 * 一卡通那份来兜底，那会把「没配 CC98 账号」变成「用错账号登不上」。
 *
 * @param ctx - 插件上下文。
 * @returns `{ username, password }` 或 null。
 */
export async function readCc98(ctx) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(CC98_RECORD_KEY);
    if (!record || record.kind !== 'grant') return null;
    const { username, password } = record.payload ?? {};
    if (typeof username !== 'string' || !username) return null;
    if (typeof password !== 'string' || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * 读实验课平台的账号。
 *
 * # 为什么它不跟「浙大一卡通」合并
 *
 * 实验课平台是 `auth: "own"`：它有自己的账号体系。用户名**通常**是学号，
 * 但**密码与统一身份认证不是同一个**。合并成一份的后果是：拿一卡通密码去登，
 * 一直失败，而用户以为「一卡通密码填错了」。
 *
 * @param ctx - 插件上下文。
 * @returns `{ username, password } | null`。
 */
export async function readLab(ctx) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(LAB_RECORD_KEY);
    if (!record || record.kind !== 'grant') return null;
    const { username, password } = record.payload ?? {};
    if (typeof username !== 'string' || !username) return null;
    // 实验课平台允许空密码？不允许 —— 它的登录要密码换 JWT。
    if (typeof password !== 'string' || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * 写实验课平台的账号（无条件覆盖）。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 写成功返回 true。
 */
export async function writeLab(ctx, account) {
  const service = credentialsOf(ctx);
  if (!service) return false;
  const username = String(account?.username ?? '').trim();
  const password = String(account?.password ?? '');
  if (!username) throw new ClassroomError('CREDENTIALS', '需要实验课平台的用户名（通常是学号）。');
  if (!password) throw new ClassroomError('CREDENTIALS', '需要实验课平台的密码（与统一身份认证不是同一份）。');
  // ⚠️ `modifyRecord` 的第二个参数是**函数** `(existing) => record` —— 直接传对象
  // 会让宿主把它当函数调，报 `mutate is not a function`。
  await service.modifyRecord(LAB_RECORD_KEY, () => ({ kind: 'grant', payload: { username, password } }));
  return true;
}

/** 清掉实验课平台的账号。 */
export async function clearLab(ctx) {
  const service = credentialsOf(ctx);
  if (!service || typeof service.deleteRecord !== 'function') return false;
  try {
    // 清一条记录要用 `deleteRecord`（`modifyRecord(key, null)` 不是合法写法）。
    await service.deleteRecord(LAB_RECORD_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读邮箱账号。
 *
 * 返回 `{ address, password }`：`address` 是完整邮箱地址，`password`
 * 是 16 位客户端专用密码。
 *
 * @param ctx - 插件上下文。
 * @returns `{ address, password } | null`。
 */
export async function readMail(ctx) {
  const service = credentialsOf(ctx);
  if (!service) return null;
  try {
    const record = await service.readRecord(MAIL_RECORD_KEY);
    if (!record || record.kind !== 'grant') return null;
    const { address, password } = record.payload ?? {};
    if (typeof address !== 'string' || !address.includes('@')) return null;
    if (typeof password !== 'string' || !password) return null;
    return { address, password };
  } catch {
    return null;
  }
}

/**
 * 写邮箱账号（无条件覆盖）。
 *
 * # 关于「16 位」这条提示：只警告，不拦
 *
 * 上游 `MailSettings.tsx` 把「保存」按钮直接绑在 `password.length !== 16` 上。
 * 本仓原先照搬了这个硬校验，但**实测证明它是过严的**（2026-11-17）：浙大邮箱
 * 实际接受的客户端密码并不总是 16 位。
 *
 * 关键证据在 `source/mail`：它走 IMAP，凭据处理只有 `text(password, 128, false)`
 * —— 也就是「非空、不超长」，没有任何长度要求。既然真正的认证方不要求 16 位，
 * 拦在这里只会把一条**本可走通**的路堵死，而且给的理由（"你可能填错了"）
 * 在用户确实是对的时，会让他反复去生成新密码。
 *
 * 所以现在是：**照常保存，长度不等于 16 时给一条提示**（不改返回值、不抛错）。
 * 提示的价值在于「如果你填的是统一身份认证密码，这里可能就是原因」，
 * 而不是「你不许保存」。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ address, password }`。
 * @returns `true` 写成功；`false` 没有凭据服务。长度异常时附 `warning` 字段。
 * @throws {ClassroomError} 地址格式不对。
 */
export async function writeMail(ctx, account) {
  const service = credentialsOf(ctx);
  if (!service) return false;
  const address = String(account?.address ?? '').trim();
  const password = String(account?.password ?? '').trim();
  // 这一版走**专用密码**这条路：账号是完整邮箱地址。学号 / CAS / OAuth2
  // 属于后续工作，混进来会让失败原因说不清。
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) {
    throw new ClassroomError('CREDENTIALS', '请填写完整的邮箱地址（例如 1234567890@zju.edu.cn）。');
  }
  if (!password) {
    // 空密码是真的没法用，这个必须拦。
    throw new ClassroomError('CREDENTIALS', '请填写邮箱密码。');
  }

  await service.modifyRecord(MAIL_RECORD_KEY, () => ({ kind: 'grant', payload: { address, password } }));

  /**
   * 长度提示（**不阻断保存**）。
   *
   * 常见来源是「把统一身份认证密码填进来了」。但 16 位不是硬性事实，
   * 所以这里只给一句可忽略的提示，由调用方（设置卡片）决定怎么显示。
   */
  if (password.length !== 16) {
    return {
      saved: true,
      warning: '浙大邮箱通常用「客户端专用密码」（网页版「设置 → 安全设置」生成），'
        + '一般 16 位。已按你填的保存；若之后认证失败，先怀疑是不是填成了统一身份认证密码。',
    };
  }
  return { saved: true };
}

/** 清掉邮箱账号。 */
export async function clearMail(ctx) {
  const service = credentialsOf(ctx);
  if (!service || typeof service.deleteRecord !== 'function') return false;
  try {
    await service.deleteRecord(MAIL_RECORD_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 邮箱凭据的状态（含是否配过）。**只回有无，不回密码。** */
export async function mailStatus(ctx) {
  const account = await readMail(ctx);
  return { configured: Boolean(account), address: account?.address ?? '' };
}

/** 实验课平台凭据的状态（含是否配过）。 */
export async function labStatus(ctx) {
  const account = await readLab(ctx);
  return { configured: Boolean(account), username: account?.username ?? '' };
}

/**
 * 写 CC98 账号（无条件覆盖）。
 *
 * @param ctx - 插件上下文。
 * @param account - `{ username, password }`。
 * @returns 写成功返回 true。
 */
export async function writeCc98(ctx, account) {
  const valid = validAccount(account);
  if (!valid) return false;
  const service = credentialsOf(ctx);
  if (!service) return false;
  try {
    await service.modifyRecord(CC98_RECORD_KEY, () => cc98Record(valid));
    return true;
  } catch {
    return false;
  }
}

/** 删掉 CC98 账号（幂等）。 */
export async function clearCc98(ctx) {
  const service = credentialsOf(ctx);
  if (!service || typeof service.deleteRecord !== 'function') return false;
  try {
    await service.deleteRecord(CC98_RECORD_KEY);
    return true;
  } catch {
    return false;
  }
}

/** CC98 凭据状态（只回有无与账号名，不回密码）。 */
export async function cc98Status(ctx) {
  const account = await readCc98(ctx);
  if (!account) return { configured: false, username: '' };
  return { configured: true, username: account.username };
}

/* ══════════════════════════════════════════════════════════ 宿主半边 */

export const name = 'zw-login';

/** 只硬依赖 `profileContext`：凭据走 `ctx.credentials` 惰性取。 */
export const inject = ['profileContext'];

export { MASK, ROUTE_PATH, WRITE_HEADER };

/**
 * 「跑一次，失败**重试一次**」——CAS 登录的固定策略。
 *
 * # 为什么需要（照上游 `zdbk/client.ts:113-123` 的实测结论）
 *
 * 上游原话：「两台机器短时间内交替登录时，回跳偶尔仍落在登录页
 * （2026-10-03 实测，**连续多次登录后更常见**）；隔一会儿再走一次」。
 *
 * 设置页一次要问九个数据源，等于**短时间连登多次 CAS** —— 正是那个形状。
 * 用户看到的就是「每次总挂一两个」。
 *
 * # 三条规矩
 *
 * 1. **只重试一次**：连续失败说明是密码/权限问题，再试只是拖时间；
 * 2. **凭据类错误不重试**（`CREDENTIALS` / `AUTH_REJECTED`）：改密码才有用；
 * 3. **重试前等 1.5 秒**：上游用这个间隔，太短会撞上同一个坏状态。
 *
 * 抽成独立函数是为了能单测 —— 埋在 `casTransport` 闭包里的话，
 * 这层「失败自动重启」的语义一条测试都覆盖不到。
 *
 * @param options.run - 真正跑一次登录的异步函数。
 * @param [options.wait] - 等待函数（测试注入，默认 setTimeout）。
 * @param [options.onRetry] - 重试前的回调（记日志用）。
 * @returns `run()` 的返回值。
 * @throws 最后一次 `run()` 抛的错误。
 */
export async function createCasRetry({ run, wait, onRetry } = {}) {
  if (typeof run !== 'function') throw new ClassroomError('CONFIG', 'createCasRetry 需要一个 run 函数');
  const sleep = typeof wait === 'function'
    ? wait
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = error?.code;
      // 凭据错/被拒：重试没有意义。
      if (code === 'CREDENTIALS' || code === 'AUTH_REJECTED') throw error;
      if (attempt === 2) throw error;
      onRetry?.(error);
      await sleep(1500);
    }
  }
  // 走不到这里。
  throw new ClassroomError('AUTH_REJECTED', 'CAS 登录失败');
}

/** 只接受回环 Host，防 DNS rebinding。 */
function hostOf(header) {
  const value = String(header ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value : value.slice(1, close);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
    return value.slice(0, colon);
  }
  return value;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, limit = 8 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 校验账号。
 *
 * 只做"看得出来不合法"的检查：空值、含空白。**不校验格式** ——
 * 学号形态会变，而错误的格式校验会把合法账号挡在门外。
 *
 * @param value - 用户填的账号。
 * @returns 规整后的账号，或 null。
 */
export function normalizeUsername(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/\s/.test(text)) return null;
  if (text.length > 64) return null;
  return text;
}

/**
 * 校验密码。
 *
 * @param value - 用户填的密码。
 * @returns 原密码（不 trim：密码里的空格是密码的一部分），或 null。
 */
export function normalizePassword(value) {
  const text = String(value ?? '');
  if (!text) return null;
  if (text.length > 256) return null;
  return text;
}

/**
 * 三种凭据的**同一套**读写口径。
 *
 * 一卡通、WebVPN 上网账号、CC98 论坛账号的记录形状、校验规则、打码语义完全相同 ——
 * 差别只有记录键与"它是哪套系统"的说明。把差别收进这张表，而不是把 handler 复制成
 * 三份：复制出来的第二份迟早会漏掉"密码传打码值表示不改"这类规则。
 */
const RECORDS = {
  card: { key: CARD_RECORD_KEY, label: CARD_LABEL, read: readCard, write: writeCard, clear: clearCard, status: cardStatus },
  webvpn: { key: WEBVPN_RECORD_KEY, label: WEBVPN_LABEL, read: readWebvpn, write: writeWebvpn, clear: clearWebvpn, status: webvpnStatus },
  cc98: { key: CC98_RECORD_KEY, label: CC98_LABEL, read: readCc98, write: writeCc98, clear: clearCc98, status: cc98Status },
  // 实验课平台是 `auth: "own"`：它有自己的账号，**不并入一卡通**。
  lab: { key: LAB_RECORD_KEY, label: LAB_LABEL, read: readLab, write: writeLab, clear: clearLab, status: labStatus },
  // 邮箱是 `auth: "own"` 且凭据**不是**任何浙大密码 —— 是 16 位客户端专用密码。
  mail: { key: MAIL_RECORD_KEY, label: MAIL_LABEL, read: readMail, write: writeMail, clear: clearMail, status: mailStatus },
};

/** 把一份凭据状态画成页面直接能用的形状（密码永远只给打码值）。 */
function credentialView(status) {
  return {
    configured: status.configured,
    username: status.username,
    // 密码永远不回显明文；配过就给打码值，让页面知道"有个密码"
    password: status.configured ? MASK : '',
  };
}

/**
 * 路由处理函数。
 *
 * 动作：
 *   GET  ?                读三份凭据的状态（账号名回显、密码打码）
 *   POST ?save            存一卡通账号密码（密码传打码值表示不改）
 *   POST ?clear           清除一卡通
 *   POST ?webvpn-save     存 WebVPN 上网账号
 *   POST ?webvpn-clear    清除 WebVPN 上网账号
 *   POST ?cc98-save       存 CC98 论坛账号
 *   POST ?cc98-clear      清除 CC98 论坛账号
 *
 * 三份凭据**互不影响**：清一卡通不会动 WebVPN 或 CC98，反之亦然。
 *
 * ⚠️ 动作名与 `RECORDS` 的键**刻意不统一**：`save` / `clear` 是历史动作名
 *   （沿用一卡通那一份），改它会让已经写死的调用方（设置页、脚本）403。
 *   新加凭据一律用 `<kind>-save` / `<kind>-clear`。
 *
 * @param options - `{ ctx, log }`。
 */
export function createHandler({ ctx, log = () => {} }) {
  /**
   * 动作名 → 凭据种类。
   *
   * 从"两个三元表达式"改成表，是因为第三种凭据一进来，三元就会长成
   * `a ? x : b ? y : c ? z : null` —— 那种链子加第四种时必错。
   */
  const ACTION_KIND = {
    save: 'card',
    clear: 'card',
    'webvpn-save': 'webvpn',
    'webvpn-clear': 'webvpn',
    'cc98-save': 'cc98',
    'cc98-clear': 'cc98',
    'lab-save': 'lab',
    'lab-clear': 'lab',
    'mail-save': 'mail',
    'mail-clear': 'mail',
  };

  /**
   * 探测「学在浙大」：出口是否可达。
   *
   * 只读服务上已有的状态，不主动登录 —— 主动登录要密码，而这里只要
   * 「现在能不能用」，不必替用户重登。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`；异常也收成同形状，不向外抛。
   */
  /**
   * 探测「学在浙大」。
   *
   * # 服务名换过了（这里曾经是 bug）
   *
   * `source/campus` 拆成 `xuezai` + `pta` 之后，服务名从 `zwCampus` 变成
   * `zwXuezai`。这一段没跟着改，于是它**永远**返回 `NOT_INSTALLED`
   * —— 设置页里「学在浙大」那一行恒显示「数据源未启用」，即使它明明装着。
   *
   * # 为什么用 `egress()` 而不是读一次数据
   *
   * 这一行要回答的是「这份 CAS 凭据能不能用来访问学在浙大」。多数情况下
   * 那取决于**出口**（校内直连 / 经 WebVPN / 校外且没配），而不是会话本身：
   * 会话没建立时下一次读取会自动走 CAS 登录。所以出口判定比真读一次更贴近
   * 用户真正会遇到的失败原因。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeCampusSource = async (ctx) => {
    try {
      const xuezai = ctx?.get?.('zwXuezai');
      if (!xuezai) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      if (typeof xuezai.egress !== 'function') {
        return { ok: false, code: 'PROBE_FAILED', detail: '服务未暴露 egress()' };
      }
      // ⚠️ 带 `probe: true`：不带的话 `egress.state()` 的 `campus` 是 `'unknown'`
      // （探测缓存还是空的），而它**不代表校外** —— 先前把它判成 OFF_CAMPUS，
      // 于是「明明在校内」也显示「校外且未配 WebVPN」。同一时刻 xuezai 的会话
      // 探测却能成功，两个结论互相矛盾，那就是这个 bug 的现场。
      const egress = await xuezai.egress({ probe: true }).catch(() => null);
      const usingVpn = egress?.viaWebvpn === true;
      const campus = egress?.campus ?? 'unknown';
      if (campus === 'unknown') {
        // 探不出来就说探不出来，不猜。
        return { ok: false, code: 'PROBE_UNKNOWN', detail: '网络出口没测出来（探测失败或被跳过）' };
      }
      const inside = campus === 'inside';
      return {
        ok: inside || usingVpn,
        code: inside ? 'INSIDE' : usingVpn ? 'VIA_WEBVPN' : 'OFF_CAMPUS',
        detail: inside ? '校内直连' : usingVpn ? '经 WebVPN' : '校外且未配 WebVPN',
      };
    } catch (error) {
      return { ok: false, code: 'PROBE_FAILED', detail: String(error?.message ?? error) };
    }
  };

  /**
   * 探测「智云课堂」：能不能拿到当前用户。
   *
   * `getCurrentUser()` 是最轻的一次授权校验：会话有效就返回用户，失效就抛错。
   * 比「列课程」便宜，也不会因为某门课没权限而误报。
   */
  /**
   * 探测「智云课堂」。
   *
   * # 不能用 `getCurrentUser()`
   *
   * 它只从 cookie jar 里找 `JWTUser` 并解析 —— **不触发登录**。没有会话时
   * 返回 `null`，用它探测会把「还没登录」报成「登录失败」，而用户配的密码
   * 可能完全正确。探错对象比误报更难查：界面上给的是确定的错误结论。
   *
   * 正确入口是 `restoreSession()`：它内部真的 `listCourses()`，成功即已登录、
   * `SESSION_EXPIRED` 即未登录。这与教务那边用 `login()` 而不是 `hasSession()`
   * 是同一个道理 —— **要测「能不能用」，就得真的用一次**。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeClassroom = async (ctx) => {
    try {
      const classroom = ctx?.get?.('zwClassroom');
      if (!classroom) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      // 没配凭据时先给准确提示，不去跑一次注定失败的登录。
      const card = await cardStatus(ctx).catch(() => null);
      if (!card?.configured) {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      if (typeof classroom.restoreSession !== 'function') {
        return { ok: false, code: 'PROBE_FAILED', detail: '服务未暴露 restoreSession()' };
      }

      /**
       * 先用现成会话；**没有会话就用刚存的凭据真登一次**。
       *
       * # 这里原来只做 `restoreSession()`
       *
       * `restoreSession` 只试已有会话，**不会**拿凭据去登录。于是用户填完学号密码、
       * 立刻点「重新检测」时，必然得到「会话已失效，需重新登录」——
       * 他会以为刚填的密码有问题，其实只是还没登过。
       *
       * 这与「教务」那条探测的口径也不一致：`probeZdbk` 是直接 `login()` 的。
       * 同一个设置页里两套口径，用户看到的结论就没法互相比。
       */
      const restored = await classroom.restoreSession({});
      if (restored?.authenticated === true) {
        return { ok: true, code: 'OK', detail: restored.user?.name ?? '已登录' };
      }
      // 会话不可用 → 用存着的那份凭据登录（`login` 失败会抛，交给下面的 catch 分类）
      if (typeof classroom.login !== 'function') {
        return { ok: false, code: 'NEEDS_LOGIN', detail: '会话已失效，且服务未暴露 login()' };
      }
      /**
       * ⚠️ 这里必须用 `readCard()`，**不能用 `cardStatus()`**。
       *
       * `cardStatus()` 是给界面看的：它只回 `{ configured, username }`，
       * **刻意不带密码**（凭据不回显是设计）。拿它去登录，`password` 就是
       * `undefined`，`authenticate()` 立刻抛
       * 「请先在「设置 → 浙大一卡通」填入学号与密码」——
       * 用户明明填了，页面却让他再填一次。
       *
       * `readCard()` 是内部读取，回 `{ username, password }` 全文，正是登录要的东西。
       */
      const full = await readCard(ctx).catch(() => null);
      if (!full?.username || !full?.password) {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      const user = await classroom.login({ username: full.username, password: full.password });
      return { ok: true, code: 'OK', detail: user?.name ?? '已登录' };
    } catch (error) {
      const code = error?.code ?? 'PROBE_FAILED';
      // ⚠️ 只有**明确**的「没凭据」才报 NEEDS_CREDENTIAL。其余一律如实说是登录失败，
      //    并把站点或网络给的原话带上 —— 把密码错/网络问题说成「还没配」会把用户
      //    赶去反复重填一份本来就对的账号。
      if (code === 'NEED_CREDENTIAL') {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };

  /**
   * 探测「教务」。
   *
   * # 教务走浙大统一身份认证
   *
   * 它没有独立账号 —— `cas.js` 里 `CREDENTIALS` 的原文就是「请先填入学号与密码」。
   * 所以三种状态必须分开报，否则一律「需登录」，用户不知道该改什么。
   *
   * # 关键：不能用 `hasSession()`
   *
   * `hasSession()` 内部只调 `SessionStore.load()` —— **那是从磁盘读会话文件，
   * 从不登录**。文件不存在时它在 `ENOENT` 分支直接 return 空 jar，
   * 于是永远返回 false。用它探测会得到「配了正确的密码也说登录失败」，
   * 这不是误报，是**探错了对象**：它反映的是「磁盘上有没有旧会话」，
   * 不是「能不能拿到会话」。
   *
   * 真正建立会话的是 `openTransport()`（内部调 `casLogin`）。服务为此暴露了
   * `login()` / `verify`：「强制走一次完整登录 + 业务验证」。它的代价是一次
   * 真实登录，但这正是「这份凭据能不能用」唯一诚实的答案。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeZdbk = async (ctx) => {
    try {
      const zdbk = ctx?.get?.('zwZdbk');
      if (!zdbk) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      // 没配凭据时先给出准确提示，不去跑一次注定失败的登录。
      const card = await cardStatus(ctx).catch(() => null);
      if (!card?.configured) {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      if (typeof zdbk.login !== 'function') {
        return { ok: false, code: 'PROBE_FAILED', detail: '服务未暴露 login()' };
      }
      await zdbk.login();
      return { ok: true, code: 'OK', detail: '已登录' };
    } catch (error) {
      const code = error?.code ?? 'PROBE_FAILED';
      /**
       * ⚠️ 只有 `NEED_CREDENTIAL` 才报「还没配」。
       *
       * 原先把 `NEED_LOGIN` 也归到这一支，但 `zdbk.login()` 在 **CAS 拒绝**
       * 或**网络失败**时抛的正是 `NEED_LOGIN`（见 `source/zdbk/src/index.js`：
       * `AUTH_REJECTED` / `CREDENTIALS` 都被转成它）。于是「密码不对」和
       * 「根本没配」在页面上长得一模一样 —— 用户按提示去重填一份本来就对的密码，
       * 而真正的原因（CAS 不认、或网不通）永远看不到。
       *
       * 现在把 `error.message` 原样带出去：那句话里就是站点给的原因。
       */
      if (code === 'NEED_CREDENTIAL') {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };

  /* ──────────────────────────────────────────────────────────────
   * 其余六个数据源的探测。
   *
   * # 为什么要逐个探，而不是只看 `ready()`
   *
   * 「服务已就绪」和「这份 CAS 凭据现在能用」是两件事：前者只说模块装配完了，
   * 后者才是用户在看到设置页时想知道的事。只有真去要一次东西（或读它自己维护的
   * 会话记录），才能把「没配账号 / 会话过期 / 平台拒绝 / 真的能用」分开。
   *
   * # 为什么都**不联网**
   *
   * `zdbk` / `classroom` / `xuezai` 的探测会真的登录一次 —— 那是各自唯一的诚实判据
   * （见它们自己的注释）。其余五个不这样做：一次登录要拉一串页面
   * （`sztz` / `tyys` / `notice`）或者只需看本地状态（`campus` 只看出口、`mail` 只看凭据）。
   * 这一页要的是「一眼看清各源状态」，为了它触发五次登录并不划算，
   * 而且校外未配 WebVPN 时会让整页转圈。
   *
   * 所以这几个报的是「**本机会话/凭据的状态**」，措辞里也如实这么写 ——
   * 不把它们说成「已验证可用」。
   *
   * ⚠️ `lab` 与 `cnki` **都不在这个列表里**：
   * - `lab` 有自己的账号与独立设置分区，状态在那块显示；
   * - `cnki`（知网）**用户明确不做**，整个数据源已删除，见 `coverage-gaps.md`。
   * ────────────────────────────────────────────────────────────── */

  /**
   * 调一个包的 `ready()`，**同步异步都吃**。
   *
   * # 为什么需要它（这里踩过坑）
   *
   * 有的包的 `ready()` 是同步的（直接返回布尔），有的是异步的。先前一律写成
   * `await xxx.ready().catch(...)` —— 同步的那个没有 `.catch` 方法，于是抛
   * `ready(...).catch is not a function`，被外层 catch 兜成「登录失败」。
   * 设置页里四个包同时恒红就是这个原因。
   *
   * 这里先求值再判：结果是不是 thenable 决定要不要 await；抛错一律当 false
   * —— 「就绪探测」失败不该让整行变成错误结论。
   *
   * @param service - 数据源服务。
   * @returns Promise<boolean>
   */
  const safeReady = async (service) => {
    if (typeof service?.ready !== 'function') return false;
    try {
      const value = service.ready();
      const settled = value && typeof value.then === 'function' ? await value : value;
      return Boolean(settled);
    } catch {
      return false;
    }
  };



  /**
   * 探测「学在浙大」的会话。
   *
   * # 为什么用 `fingerprint()`
   *
   * 它内部先 `ensureSession()`（需要时走一次 CAS），再把会话 cookie 摘成指纹。
   * 指纹为空就是「没拿到会话」。这比读一次待办便宜得多，也不会因为某门课没
   * 权限而误报。
   *
   * ⚠️ 它会**触发一次 CAS 登录**（会话不存在时）。所以这一步同样走
   * `withDeadline`，与 `zdbk` / `classroom` 保持一致。
   *
   * 注意这一项与 `campus`（出口）是**两件事**：出口回答「网络能不能到」，
   * 这一项回答「会话建没建起来」。两者都报，用户才知道是网的问题还是账号的问题。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeXuezai = async (ctx) => {
    try {
      const xuezai = ctx?.get?.('zwXuezai');
      if (!xuezai) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      const card = await cardStatus(ctx).catch(() => null);
      if (!card?.configured) {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      if (typeof xuezai.fingerprint !== 'function') {
        return { ok: false, code: 'PROBE_FAILED', detail: '服务未暴露 fingerprint()' };
      }
      const fingerprint = await xuezai.fingerprint();
      return fingerprint
        ? { ok: true, code: 'OK', detail: '会话已建立' }
        : { ok: false, code: 'NEEDS_LOGIN', detail: '没有会话' };
    } catch (error) {
      const code = error?.code ?? 'PROBE_FAILED';
      if (code === 'NEED_LOGIN' || code === 'CREDENTIALS' || code === 'CONFIG') {
        return { ok: false, code: 'NEEDS_CREDENTIAL', detail: '还没配统一身份认证' };
      }
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };

  /**
   * 探测「二课」（`sztz` / 三课堂）。
   *
   * 它自己维护一份登录态（`setSessionProvider` 注入的那条链路），服务面
   * 只暴露 `ready()`。所以这里报的是「有没有拿到会话凭据」，不是「平台可用」。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeSztz = async (ctx) => {
    try {
      const sztz = ctx?.get?.('zwSztz');
      if (!sztz) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      // `ready()` 是**同步**的（直接返回布尔）；先前按 Promise 写 `.catch()` 会抛
    // `ready(...).catch is not a function` —— 那正是设置页四个包恒报「登录失败」的原因。
    const ready = await safeReady(sztz);
      return ready
        ? { ok: true, code: 'OK', detail: '已接入登录（首次读取时确认）' }
        : { ok: false, code: 'NEEDS_LOGIN', detail: '还没有会话' };
    } catch (error) {
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };

  /**
   * 探测「体育场馆」（`tyys`）。
   *
   * 场馆平台用的是体艺 App 的 jwt，与 CAS 是两套。所以它「没登录」不代表
   * 统一身份认证不对 —— 措辞里要把这层区分写出来。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeTyys = async (ctx) => {
    try {
      const tyys = ctx?.get?.('zwTyys');
      if (!tyys) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      const ready = await safeReady(tyys);
      return ready
        ? { ok: true, code: 'OK', detail: '已接入登录（首次读取时确认）' }
        : { ok: false, code: 'NEEDS_LOGIN', detail: '还没有体艺会话（首次读取时自动登录）' };
    } catch (error) {
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };

  /**
   * 探测「通知」。
   *
   * 通知要读的站点一半在校内、一半在公网，所以「能不能用」主要取决于**出口**，
   * 而不是某个会话。会话那一层只决定「要不要先登录」。
   *
   * @param ctx - 插件上下文。
   * @returns `{ ok, code, detail }`。
   */
  const probeNotice = async (ctx) => {
    try {
      const notice = ctx?.get?.('zwNotice');
      if (!notice) return { ok: false, code: 'NOT_INSTALLED', detail: '数据源未启用' };
      const ready = await safeReady(notice);
      return ready
        ? { ok: true, code: 'OK', detail: '已接入登录（站点多在校内）' }
        : { ok: false, code: 'NEEDS_LOGIN', detail: '还没有会话' };
    } catch (error) {
      return { ok: false, code: 'NEEDS_LOGIN', detail: String(error?.message ?? error) };
    }
  };


  /**
   * 给探测加一个上限时间，超时不算失败、算「没测出来」。
   *
   * 教务与智云课堂的探测会**真的登录一次** —— 那是唯一诚实的判据（见各自的注释）。
   * 但登录要访问网络：校外没配 WebVPN 时，三个请求会各自等到 TCP 超时，
   * 用户打开设置页只是想填个密码，不该为此干等。
   *
   * # 为什么超时不算「失败」
   *
   * `PROBE_TIMEOUT` 是独立状态码：它表达「现在没测出来」，不是「不能用」。
   * 把超时报成「登录失败」会让用户去改一个本来正确的密码 —— 那正是这一轮
   * 反复在修的那类错误。
   *
   * @param promise - 探测的 Promise。
   * @param name - 数据源名（日志用）。
   * @param ms - 上限毫秒。
   * @returns `{ ok, code, detail }`；超时返回 `PROBE_TIMEOUT`。
   */
  /**
   * 各数据源的分项状态**缓存**。
   *
   * # 为什么缓存（C 方案的落地）
   *
   * 真探测要发网络请求（有几项还要真的登录一次 CAS）。先前每次打开设置页都
   * 现探一遍，代价是十几秒，而且**用户只是来填密码也会触发一串登录**。
   *
   * 现在：
   * - `GET` 只回缓存；没探过就是 `{ ok: null, code: 'UNKNOWN' }`（「未检测」）；
   * - 只有显式点了「重新检测」（`POST probe`）才真探一遍并刷新缓存。
   *
   * # 为什么不给缓存加过期时间
   *
   * 过期自动重探等于「打开页面就可能触发登录」—— 那正是要避免的。
   * 页面显示采样时间，由用户决定要不要重新检测。
   *
   * @type {{ at: number | null, values: Record<string, {ok: boolean|null, code: string, detail: string}> }}
   */
  const probeCache = { at: null, values: {} };

  /**
   * 未探测过的占位。
   *
   * 它**不是**「失败」—— 说「未检测」是诚实的，编一个「登录失败」不是。
   */
  const UNPROBED = Object.freeze({ ok: null, code: 'UNKNOWN', detail: '未检测（点「重新检测」才会真的连一次）' });

  /**
   * 真探一遍全部分项，写入缓存。**只由显式动作调用。**
   *
   * @param signal - 取消信号。
   * @returns 采样时间与结果。
   */
  const runProbes = async (signal) => {
    const [campus, classroom, zdbk, xuezai, sztz, tyys, notice] = await Promise.all([
      withDeadline(probeCampusSource(ctx), 'campus'),
      withDeadline(probeClassroom(ctx), 'classroom'),
      withDeadline(probeZdbk(ctx), 'zdbk'),
      withDeadline(probeXuezai(ctx), 'xuezai'),
      withDeadline(probeSztz(ctx), 'sztz'),
      withDeadline(probeTyys(ctx), 'tyys'),
      withDeadline(probeNotice(ctx), 'notice'),
    ]);
    signal?.throwIfAborted?.();
    // `lab` 不在其中 —— 见 GET 里的说明。
    // `cnki` 不在此列 —— 用户明确不做知网数据源（见 coverage-gaps.md）。
    probeCache.values = { campus, classroom, zdbk, xuezai, sztz, tyys, notice };
    probeCache.at = Date.now();
    return { at: probeCache.at, values: probeCache.values };
  };

  const withDeadline = (promise, name, ms = 8000) => Promise.race([
    promise,
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        log(`探测超时：${name}（${ms}ms）`);
        resolve({ ok: false, code: 'PROBE_TIMEOUT', detail: '探测超时，稍后重试' });
      }, ms);
      // 让定时器不阻止进程退出（Node 里 unref 存在；浏览器没有，故用可选调用）。
      timer?.unref?.();
    }),
  ]);

  /** 保存一份凭据。`kind` 决定写哪一份记录。 */
  const saveOne = async (res, kind, body, label) => {
    const record = RECORDS[kind];
    const username = normalizeUsername(body.username);
    if (!username) {
      sendJson(res, 400, { error: '账号不能为空，也不能含空格' });
      return;
    }

    // 密码回传打码值 = 不改：用户只改账号时不必重新输密码
    let password;
    if (body.password === MASK) {
      const existing = await record.read(ctx);
      if (!existing) {
        sendJson(res, 400, { error: '还没有保存过密码，请填写一次' });
        return;
      }
      password = existing.password;
    } else {
      password = normalizePassword(body.password);
      if (!password) {
        sendJson(res, 400, { error: '密码不能为空' });
        return;
      }
    }

    const saved = await record.write(ctx, { username, password });
    if (!saved) {
      sendJson(res, 500, { error: '写入凭据失败：宿主的凭据服务不可用' });
      return;
    }
    log(`${label}已保存（${username}）`);
    sendJson(res, 200, { ok: true, [kind]: credentialView({ configured: true, username }) });
  };

  return async function handler(req, res) {
    const host = hostOf(req.headers.host);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      sendJson(res, 403, { error: '只接受回环访问' });
      return;
    }

    const action = String(req.url ?? '').split('?')[1] ?? '';

    if (req.method === 'GET') {
      const [card, webvpn, cc98, lab, mail] = await Promise.all([
        cardStatus(ctx), webvpnStatus(ctx), cc98Status(ctx), labStatus(ctx), mailStatus(ctx),
      ]);
      // 三个下游数据源各自「这份凭据能不能用」。**并行且各自兜底** ——
      // 一个源挂掉不能把整张状态卡变成错误，否则用户看不到另外两个的真实情况。
      //
      // `withDeadline`：教务与智云课堂的探测会**真的登录一次**（这是唯一诚实的
      // 判据），而登录要访问网络。不设上限的话，校外未配 WebVPN 时这一页会一直
      // 转圈 —— 用户打开设置只是想填个密码，不该等三个网络请求超时。
      /**
       * 各数据源的分项状态 —— **只读缓存**（C 方案）。
       *
       * 真探测要发网络请求、有几项还要真的登录 CAS。先前每次 GET 都现探，
       * 代价十几秒且「只是来填密码」也会触发一串登录。现在这页只回上次的结果，
       * 要更新得显式点「重新检测」（`POST probe`）。
       *
       * 没探过 → 每一项都是 `UNKNOWN`（「未检测」）。**不编状态**。
       */
      const sources = {};
      // `lab` **不在**这里：它有独立凭证与独立设置分区，用户在那块看它的状态。
      // 这一块只列「共用统一身份认证」的那些 —— 混进来会让同一件事显示两次。
      // `mail` **不在**这里：它有**自己的密码**（不是 CAS 一套），
      // 有自己的设置分区。列在这儿会让用户以为"配了一卡通就能收信"。
      for (const key of ['campus', 'classroom', 'zdbk', 'xuezai', 'sztz', 'tyys', 'notice']) {
        sources[key] = probeCache.values[key] ?? UNPROBED;
      }

      sendJson(res, 200, {
        card: credentialView(card),
        webvpn: credentialView(webvpn),
        cc98: credentialView(cc98),
        lab: credentialView(lab),
        mail: credentialView({ configured: mail.configured, username: mail.address }),
        sources,
        sourcesAt: probeCache.at,
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '只支持 GET / POST' });
      return;
    }

    if (String(req.headers[WRITE_HEADER] ?? '') !== '1') {
      sendJson(res, 403, { error: `缺少 ${WRITE_HEADER} 头` });
      return;
    }

    /**
     * 显式「重新检测」：真探一遍全部数据源并刷新缓存（C 方案）。
     *
     * 单独处理而不是并进 `ACTION_KIND`：那个表是「写哪一份凭据」的分派，
     * 而这里不写任何凭据，只是去连一遍。混进去会让「保存」与「探测」共享
     * 一条代码路径，将来改一个必踩另一个。
     */
    if (action === 'probe') {
      try {
        const { at, values } = await runProbes();
        sendJson(res, 200, { ok: true, sources: values, sourcesAt: at });
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) });
      }
      return;
    }

    const kind = ACTION_KIND[action];
    if (!kind) {
      sendJson(res, 400, { error: `未知动作 ${action || '(空)'}` });
      return;
    }

    if (action.endsWith('-clear') || action === 'clear') {
      const record = RECORDS[kind];
      await record.clear(ctx);
      log(`${record.label}已清除`);
      sendJson(res, 200, { ok: true, [kind]: credentialView({ configured: false, username: '' }) });
      return;
    }

    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体不是合法 JSON' });
      return;
    }

    await saveOne(res, kind, body, RECORDS[kind].label);
  };
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zw-card] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createHandler({ ctx, log });
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`设置路由：${ROUTE_PATH}`);
      return dispose;
    }, 'zw: card credential route');
  });

  /**
   * 共享的 CAS 会话（D18 的 B 方案）。
   *
   * # 它解决什么
   *
   * 所有走 CAS 的数据源（教务、智云课堂、学在浙大、二课、体育馆、通知……）
   * 用的是**同一份**「浙大一卡通」账号。先前各包各建一个会话文件、各自登一次
   * CAS —— 那不只浪费：**同一个学号连登两次会让先前的 ticket 失效**，
   * 于是先后打开两个页面时，先开的那个突然掉登录。
   *
   * 所以这里由 `login` 建**一份**会话，别的包向它要：
   *
   * ```js
   * const shared = ctx.get('zwCard');
   * const transport = await shared.casTransport({ entry, hosts });
   * // transport 的 jar 里已经有 CAS 票，直接拿它发业务请求
   * ```
   *
   * # 为什么按 `entry` 缓存
   *
   * 不同数据源的 `entry` 不同（教务 `/jwglxt/xtgl/index_initMenu.html`、
   * 智云课堂的 `oauth` 回调……），CAS 服务端的会话键也随之不同。一份
   * `Transport` 混用多个 `entry` 会让票在服务端对不上，所以按 `entry` 分开缓存。
   *
   * 但它们**共用同一个 `SessionStore`** —— 那才是「同一份账号、同一份登录」的
   * 载体：`iPlanetDirectoryPro` 这张票在 `zjuam.zju.edu.cn` 上是同一个 cookie，
   * 第一个 `entry` 登录成功后，其余的直接命中「已登录」，不再走表单。
   *
   * # 为什么放在 `login` 而不是各业务包
   *
   * 那正是 D18 的内容：CAS 流程抽进 tier 0，业务包只传自己的 `entry`。
   * 把会话也留在这里，业务包就**不需要知道** Transport / SessionStore / CAS
   * 表单长什么样。
   */
  const casSessions = new Map();
  /**
   * 正在进行的登录（同一 entry 只登一次）。
   *
   * 并发去重是必需的：九个数据源同时要会话时，不去重就会并发登九次 CAS，
   * 而 CAS 的票**后登的作废先登的** —— 那正是「每次总挂一两个」的成因。
   */
  const casPending = new Map();
  let casStore = null;

  /**
   * 取一份**已登录**的 CAS 传输层。
   *
   * @param options.entry - 该数据源的 CAS service 入口（绝对地址）。
   * @param options.hosts - 允许携带 cookie 的主机集合（该数据源自己的白名单）。
   * @param [options.signal] - 取消信号。
   * @returns `Promise<Transport>`，`jar` 里已有 CAS 票。
   * @throws {ClassroomError} 没配凭据；或登录失败（原样抛出）。
   */
  const casTransport = async ({ entry, hosts, upgradeHttpHosts, signal } = {}) => {
    if (!entry) throw new ClassroomError('AUTH_ENTRY_REQUIRED', 'casTransport 需要调用方给出 entry。');
    const key = String(entry);
    const cached = casSessions.get(key);
    // 命中缓存：会话还在就直接给。`Transport` 是无状态的（除 jar），复用它没问题。
    if (cached) return cached;

    // 并发去重：同一 entry 同时被要两次时只登录一次。
    // 不去重的话两个登录会互相挤掉对方的票 —— 那正是「几个平台总挂一两个」的成因。
    const pending = casPending.get(key);
    if (pending) return pending;

    const job = (async () => {
      const account = await readCard(ctx);
      if (!account) {
        throw new ClassroomError('CREDENTIALS', '请先在「设置 → 浙大一卡通」填入学号与密码');
      }

      // 一份 SessionStore 供所有 entry 共用 —— 见上面关于 `iPlanetDirectoryPro` 的说明。
      casStore ??= new SessionStore({
        file: path.join(ctx.profileContext.dir, 'data', 'zju-cas-session.json'),
      });
      const transport = new Transport({
        session: casStore,
        hosts: [...(hosts ?? [])],
        referer: new URL(entry).origin,
      });

      /**
       * 登录，**失败重试一次**。
       *
       * # 为什么必须重试（照上游 `zdbk/client.ts:113-123`）
       *
       * 上游的实测结论：「两台机器短时间内交替登录时，回跳偶尔仍落在登录页
       * （2026-10-03 实测，**连续多次登录后更常见**）；隔一会儿再走一次」。
       *
       * 这一页一次要问九个数据源，等于**短时间连登多次 CAS** —— 正是上游说
       * 最容易出现「回跳还是登录页」的形状。用户看到的就是「每次挂一两个」。
       *
       * 所以：失败先清掉目标域的 cookie（否则重试会带上那半张坏票），
       * 等 1.5 秒再走一次。只重试一次 —— 连续失败说明是密码/权限问题，
       * 再试只是拖时间。
       */
      await createCasRetry({
        run: async () => {
          // 清目标域：上一次的残票会让我们「以为已登录」，回跳仍是登录页。
          try { await casStore.jar.removeCookies(new URL(entry).origin); } catch { /* 清不掉就算了 */ }
          await casLogin(transport, {
            entry,
            hosts: [...(hosts ?? [])],
            // 有的站点会回 `http://…` 的跳转（正方偶尔这样），要允许它升到 https，
            // 否则跟走到一半被 URL 守卫挡下。
            ...(upgradeHttpHosts?.length ? { upgradeHttpHosts: [...upgradeHttpHosts] } : {}),
            credentials: async () => account,
            ...(signal ? { signal } : {}),
          });
        },
        onRetry: (error) => log(`${key} 登录未成功（${error?.code ?? '未知'}），1.5 秒后重试一次`),
      });

      casSessions.set(key, transport);
      return transport;
    })();

    casPending.set(key, job);
    try {
      return await job;
    } finally {
      casPending.delete(key);
    }
  };

  /**
   * 用共享 CAS 会话登录一次，返回**回跳后的落地结果**。
   *
   * # 与 `casTransport` 的分工
   *
   * - `casTransport({entry, hosts})` —— 给「拿到 transport 后自己发业务请求」的包
   *   （`sztz`、`notice` 这类）。
   * - `casLoginFor({entry, hosts})` —— 给「需要看回跳落地的那一页」的包。
   *   `tyys` 就是这种：场馆要从落地 URL 里取 `oauth_token`、
   *   体艺 App 要从落地正文里取 `jwtToken` —— 那两个值只在**这一跳**的响应里。
   *
   * 两者共用同一份 CAS 会话（`casStore`），所以先调哪个都不会多登一次。
   *
   * @param options.entry - 该数据源的 CAS service 入口（绝对地址）。
   * @param options.hosts - 允许携带 cookie 的主机集合。
   * @param [options.signal] - 取消信号。
   * @returns `Promise<{url: URL, html: string, passwordSubmitted: boolean}>`。
   */
  const casLoginFor = async ({ entry, hosts, upgradeHttpHosts, signal } = {}) => {
    if (!entry) throw new ClassroomError('AUTH_ENTRY_REQUIRED', 'casLoginFor 需要调用方给出 entry。');
    const account = await readCard(ctx);
    if (!account) {
      throw new ClassroomError('CREDENTIALS', '请先在「设置 → 浙大一卡通」填入学号与密码');
    }
    casStore ??= new SessionStore({
      file: path.join(ctx.profileContext.dir, 'data', 'zju-cas-session.json'),
    });
    const transport = new Transport({
      session: casStore,
      hosts: [...(hosts ?? [])],
      referer: new URL(entry).origin,
    });
    // 与 `casTransport` 同一套重试 —— 走同一个函数，避免两份实现漂移。
    return createCasRetry({
      run: async () => {
        try { await casStore.jar.removeCookies(new URL(entry).origin); } catch { /* 清不掉就算了 */ }
        return casLogin(transport, {
          entry,
          hosts: [...(hosts ?? [])],
          ...(upgradeHttpHosts?.length ? { upgradeHttpHosts: [...upgradeHttpHosts] } : {}),
          credentials: async () => account,
          ...(signal ? { signal } : {}),
        });
      },
      onRetry: (error) => log(`${entry} 登录未成功（${error?.code ?? '未知'}），1.5 秒后重试一次`),
    });
  };

  const removeService = ctx.provide('zwCard', {
    routePath: ROUTE_PATH,
    read: () => readCard(ctx),
    write: (account) => writeCard(ctx, account),
    // 「只补空缺」也放出来：别的包登录成功后要的是这个语义，不是 write
    fillIfEmpty: (account) => fillCardIfEmpty(ctx, account),
    clear: () => clearCard(ctx),
    status: () => cardStatus(ctx),
    /**
     * 共享 CAS 传输层（B 方案）：本包替所有数据源走一遍 CAS，返回已带票的
     * `Transport`。业务包只传 `entry` 与自己的主机白名单。
     */
    casTransport,
    /** 同上，但返回回跳落地结果（给要从落地页取 token 的包，如 tyys）。 */
    casLoginFor,
    /** 清掉缓存的 CAS 会话（换账号时用）。 */
    resetCas: () => { casSessions.clear(); casStore = null; },
    // 邮箱的客户端专用密码（16 位，`auth: "own"`，不走 CAS）
    readMail: () => readMail(ctx),
    writeMail: (account) => writeMail(ctx, account),
    clearMail: () => clearMail(ctx),
    mailStatus: () => mailStatus(ctx),
    // 实验课平台的账号（`auth: "own"`：与统一身份认证**不是**同一份）
    readLab: () => readLab(ctx),
    writeLab: (account) => writeLab(ctx, account),
    clearLab: () => clearLab(ctx),
    labStatus: () => labStatus(ctx),
    // WebVPN 上网账号（另一套系统的另一份凭据）
    readWebvpn: () => readWebvpn(ctx),
    writeWebvpn: (account) => writeWebvpn(ctx, account),
    clearWebvpn: () => clearWebvpn(ctx),
    webvpnStatus: () => webvpnStatus(ctx),
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
  };
}


/**
 * CAS 登录流程（D18：抽到本包，供所有走 CAS 的数据源共用）。
 *
 * 从前这套流程在 `source/zdbk` 里，别的 tier 1 包想用只能反向依赖它。抽到 tier 1 的
 * 凭证包之后，各数据源只需传自己的 `entry`。
 *
 * 子路径入口也可用：`import { casLogin } from '@lybx-leyw/dsh-zju-source-login/cas'`。
 */
export {
  authUrlGuard, casForm, hasCasForm, encryptCasPassword, casErrorMessage, describeAuthFailure, casLogin,
} from './cas.js';