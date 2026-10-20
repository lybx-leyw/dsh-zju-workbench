/**
 * **浙大一卡通**账号密码：智云课堂与学在浙大**共用**的唯一凭证来源。
 *
 * # 为什么单独一层
 *
 * 原来凭据散在两处：`dsh-zhiyun-source-classroom` 登录时写进宿主凭据
 * （`zhiyun-classroom/account`），`dsh-zhiyun-source-omni` / `dsh-zhiyun-source-campus` 各读各的。
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
 * 值不回显给任何界面）。记录 id 保持 `zhiyun-classroom/account` ——
 * **不是**为了"还叫课堂"，而是因为已经登录过的用户数据就在那里；
 * 换 id 会让所有现有用户凭空丢掉凭据、被迫重登一次。
 * 语义上它现在表示"浙大一卡通账号"，别名见 `CARD_RECORD_KEY`。
 */

// 设置路由 / 写头 / 打码值三条常量定义在 `shared.js` —— 客户端半边也要 import 它们，
// 但它**不能** import 本文件（那会把宿主半边的 `apply` 打进浏览器产物），所以常量
// 挪到那个纯数据文件里。这里 import + 重新导出，导出名保持不变：
//   · 写了第二份字面量的话，漂移的表现是"点了保存没反应"（路由打错或写头差一个字母
//     被 403 拒掉，两种都不报错）。
import { MASK, ROUTE_PATH, WRITE_HEADER } from './shared.js';

/** 记录键。沿用旧 id 以免既有用户丢凭据（语义已是"一卡通"）。 */
export const CARD_RECORD_KEY = 'zhiyun-classroom/account';

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
export const WEBVPN_RECORD_KEY = 'zhiyun-campus/webvpn';

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

/** 造 WebVPN 记录。形状与 `cardRecord` 一致（`grant` 只允许 kind + payload）。 */
function webvpnRecord({ username, password }) {
  return {
    kind: 'grant',
    payload: { username: username.trim(), password, label: WEBVPN_LABEL },
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

/* ══════════════════════════════════════════════════════════ 宿主半边 */

export const name = 'zhiyun-card';

/** 只硬依赖 `profileContext`：凭据走 `ctx.credentials` 惰性取。 */
export const inject = ['profileContext'];

export { MASK, ROUTE_PATH, WRITE_HEADER };

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
 * 两种凭据的**同一套**读写口径。
 *
 * 一卡通与 WebVPN 上网账号的记录形状、校验规则、打码语义完全相同 —— 差别只有
 * 记录键与"它是哪套系统"的说明。把差别收进这张表，而不是把 handler 复制成两份：
 * 复制出来的第二份迟早会漏掉"密码传打码值表示不改"这类规则。
 */
const RECORDS = {
  card: { key: CARD_RECORD_KEY, label: CARD_LABEL, read: readCard, write: writeCard, clear: clearCard, status: cardStatus },
  webvpn: { key: WEBVPN_RECORD_KEY, label: WEBVPN_LABEL, read: readWebvpn, write: writeWebvpn, clear: clearWebvpn, status: webvpnStatus },
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
 *   GET  ?                读两份凭据的状态（账号名回显、密码打码）
 *   POST ?save            存一卡通账号密码（密码传打码值表示不改）
 *   POST ?clear           清除一卡通
 *   POST ?webvpn-save     存 WebVPN 上网账号
 *   POST ?webvpn-clear    清除 WebVPN 上网账号
 *
 * 两条凭据**互不影响**：清一卡通不会动 WebVPN，反之亦然。
 *
 * @param options - `{ ctx, log }`。
 */
export function createHandler({ ctx, log = () => {} }) {
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
      const [card, webvpn] = await Promise.all([cardStatus(ctx), webvpnStatus(ctx)]);
      sendJson(res, 200, { card: credentialView(card), webvpn: credentialView(webvpn) });
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

    if (action === 'clear' || action === 'webvpn-clear') {
      const kind = action === 'clear' ? 'card' : 'webvpn';
      const record = RECORDS[kind];
      await record.clear(ctx);
      log(`${record.label}已清除`);
      sendJson(res, 200, { ok: true, [kind]: credentialView({ configured: false, username: '' }) });
      return;
    }

    const saveKind = action === 'save' ? 'card' : action === 'webvpn-save' ? 'webvpn' : null;
    if (!saveKind) {
      sendJson(res, 400, { error: `未知动作 ${action || '(空)'}` });
      return;
    }

    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体不是合法 JSON' });
      return;
    }

    await saveOne(res, saveKind, body, RECORDS[saveKind].label);
  };
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-card] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createHandler({ ctx, log });
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`设置路由：${ROUTE_PATH}`);
      return dispose;
    }, 'zhiyun: card credential route');
  });

  const removeService = ctx.provide('zhiyunCard', {
    routePath: ROUTE_PATH,
    read: () => readCard(ctx),
    write: (account) => writeCard(ctx, account),
    // 「只补空缺」也放出来：别的包登录成功后要的是这个语义，不是 write
    fillIfEmpty: (account) => fillCardIfEmpty(ctx, account),
    clear: () => clearCard(ctx),
    status: () => cardStatus(ctx),
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
