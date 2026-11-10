/**
 * 浙大邮箱的纯逻辑层（**不 import cordis**，所有外部能力都由调用方注入）。
 *
 * # 分层（D17）
 *
 * 本包**只读**：`folders` / `list` / `inbox` / `read` / `download` / `drafts` / `test` / `snapshot`。
 * 上游 `mail.mjs` 的四个写方法（`send` / `prepare` / `updateDraft` / `removeDraft`）
 * **不在这里**（见 README 的「写操作去哪了」）。
 *
 * 「下载附件到本地」留在本包：判据是「有没有改别人的状态」—— 落盘只动自己这台机器，
 * 服务器上的邮件与已读标记一概不动（IMAP 一律 `readOnly: true`）。
 *
 * # 平台事实（取自上游 `mail.mjs` 的 `ZJU_MAIL`，未改动）
 *
 * - IMAP `imap.zju.edu.cn:993`，`secure: true`（隐式 TLS）；
 * - SMTP `smtp.zju.edu.cn:994`，`secure: true`；
 * - 认证用**16 位客户端专用密码**，不是统一身份认证密码。
 *
 * # 三个第三方依赖都走「默认工厂 + 动态 import」
 *
 * `imapflow` / `nodemailer` / `mailparser` 不在本仓 `node_modules` 里（它们由产品安装，
 * 不是本仓 devDependency）。静态 import 会让本文件的任何测试都直接
 * `ERR_MODULE_NOT_FOUND` —— 所以默认工厂用动态 `import()`，只在真的要连邮箱时才解析。
 * 测试一律注入假工厂，一行网络代码都不执行。
 *
 * # 凭据不落本包
 *
 * 上游把专用密码加密存在 `ctx.credentials`（`mail-vault.mjs`），`mail.json` 只留标记。
 * 本包改为**由调用方通过 `setCredentialProvider` 注入**一个返回
 * `{ address, password }` 的函数；本包不读凭据服务、不写任何凭据文件。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** 浙大邮箱的服务器事实。上游 `mail.mjs:9` 逐字相同。 */
export const ZJU_MAIL = Object.freeze({
  imap: Object.freeze({ host: 'imap.zju.edu.cn', port: 993, secure: true }),
  smtp: Object.freeze({ host: 'smtp.zju.edu.cn', port: 994, secure: true }),
});

/** 单封邮件上限（上游 `MAX_MESSAGE`）：源文件超过它就拒绝下载，提示去网页版。 */
export const MAX_MESSAGE = 25 * 1024 * 1024;
/** 单封邮件的附件总量上限（上游 `MAX_ATTACHMENTS`）。本包只读，故仅用于文档与后续写包对齐。 */
export const MAX_ATTACHMENTS = 10 * 1024 * 1024;

/**
 * 默认超时预算。
 *
 * IMAP 不是 HTTP，`sharedFetch` 那套不适用 —— 超时只能由 `imapflow` 自己的选项兜住，
 * 再叠一层 `Promise.race`：注入的假客户端（或卡死的 socket）不会理会 imapflow 的选项，
 * 而真机上 `connect()` 有时会在 greeting 之后静默挂住。
 */
export const DEFAULT_TIMEOUTS = Object.freeze({
  /** 建连 + 登录。上游 `connectionTimeout: 15_000`。 */
  connectMs: 15_000,
  /** 单次操作（打开目录、搜索、抓取、解析）。上游 `socketTimeout: 30_000`，这里放宽到 60 秒。 */
  operationMs: 60_000,
});

/**
 * 本包的统一错误形状。
 *
 * 码表刻意与上游的裸 `Error` 分开：调用方要能按码分流动作。
 *
 * | code | 用户该做什么 |
 * | --- | --- |
 * | `AUTH_EXPIRED` | 改密码 —— **重试没用** |
 * | `TIMEOUT` | 重试 |
 * | `UNREACHABLE` | 查网络/代理后重试 |
 * | `CONFIG` | 去补配置或修调用参数 |
 * | `REJECTED` | 服务器明确拒绝（邮件没了、超限、目录重建） |
 * | `SHAPE` | 服务器给了没法理解的东西，多半是版本兼容问题 |
 *
 * 「网络问题」与「凭据问题」**必须是不同的码**：前者重试，后者改密码 ——
 * 混成一个码会让用户反复重试一个永远不会好的操作。
 */
export class MailError extends Error {
  /**
   * @param code - 稳定错误码（见上表）。
   * @param message - 给人看的一句话，必须包含下一步动作。
   * @param details - 附加信息（只放安全元信息：错误码、名字、路径，不放密码与邮件正文）。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MailError';
    this.code = code;
    this.details = details;
  }

  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}

/* ────────────────────────── 纯校验函数 ────────────────────────── */

/**
 * 文本校验：去空白、限长、拒绝 NUL。
 *
 * @param value - 输入值。
 * @param max - 最大长度。
 * @param optional - 允许 `undefined` / 空串（返回空串）。
 * @returns 修剪后的文本。
 * @throws {MailError} `CONFIG` 输入为空、过长或含 NUL。
 */
export function text(value, max = 500, optional = true) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new MailError('CONFIG', '输入内容为空或过长，请检查后重试。');
  }
  return value.trim();
}

/**
 * 整数校验（含范围）。
 *
 * @param value - 输入值；`undefined` 取 `fallback`。
 * @param fallback - 缺省值。
 * @param min - 下界（含）。
 * @param max - 上界（含）。
 * @returns 整数。
 * @throws {MailError} `CONFIG` 不是安全整数或越界。
 */
export function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new MailError('CONFIG', '无效的页码或邮件编号：请刷新列表后重新选择。');
  }
  return n;
}

/**
 * `YYYY-MM-DD` 日期校验（UTC 零点）。
 *
 * @param value - 输入值；空返回 `undefined`。
 * @returns `Date` 或 `undefined`。
 * @throws {MailError} `CONFIG` 格式不对，或日期不存在（`2026-02-30`）。
 */
export function date(value) {
  if (!value) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new MailError('CONFIG', '日期请使用 YYYY-MM-DD 格式（例如 2026-11-10）。');
  }
  return new Date(`${value}T00:00:00Z`);
}

/**
 * 把 `mailparser` / IMAP envelope 的地址数组投影成 `{ name, address }`。
 *
 * @param values - 地址数组（可能为 `undefined`）。
 * @returns 投影后的数组；缺失字段用空串，不用 `undefined`（调用方要直接上屏）。
 */
export function addresses(values) {
  return (values ?? []).map(item => ({ name: item?.name ?? '', address: item?.address ?? '' }));
}

/**
 * 任意时间值 → ISO 字符串；解析不了返回空串（**不猜时间**）。
 *
 * @param value - 日期对象、时间戳或字符串。
 * @returns ISO 字符串或 `''`。
 */
export function iso(value) {
  return value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : '';
}

/**
 * 附件/文件名消毒：去目录、换非法字符、截断、避开 Windows 保留名。
 *
 * 上游 `filename()` 逐字照搬 —— 这不是写操作，读附件时给用户看的名字也要安全，
 * 而 `download()` 会用它落盘，所以它是本包的安全边界。
 *
 * @param value - 原始文件名。
 * @returns 安全的文件名。
 */
export function filename(value) {
  let name = String(value || 'attachment')
    .split(/[\\/]/)
    .pop()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `attachment-${name || 'file'}`;
  return name;
}

/**
 * 邮箱地址的稳定账号 id（sha256 十六进制）。
 *
 * 上游把 `createHash('sha256').update(user).digest('hex')` 存进 `mail.json` 当 `id`；
 * 本包不落盘，但 `inbox()` / `drafts()` 仍需要一个「同一个账号」的稳定标识，
 * 所以按同一算法从地址现算 —— 换了算法会让已有的草稿目录对不上号。
 *
 * ⚠️ 必须**先转小写**：上游 `connect()` 在存 `id` 之前做了
 * `address(input?.address).toLowerCase()`。少了这一步，同一账号写成
 * `A@zju.edu.cn` 与 `a@zju.edu.cn` 会算成两个账号，草稿就「看不见」了。
 *
 * @param address - 邮箱地址。
 * @returns sha256 hex。
 */
export function accountId(address) {
  return createHash('sha256').update(String(address ?? '').trim().toLowerCase()).digest('hex');
}

/**
 * 草稿内容的修订号（sha256 of JSON）。
 *
 * 上游 `revision()` 逐字照搬：写包拿它对「用户授权的那一版」做比对，
 * 本包在 `drafts()` 里用它给出只读投影。
 *
 * @param draft - 草稿对象。
 * @returns sha256 hex。
 */
export function revision(draft) {
  return createHash('sha256').update(JSON.stringify(draft)).digest('hex');
}

/**
 * 草稿的只读投影：剥掉附件正文（base64），补上当前修订号。
 *
 * @param draft - 草稿对象。
 * @returns `{ ...draft, revision, attachments: [{ index?, filename, size, contentType? }] }`。
 */
export function publicDraft(draft) {
  return {
    ...draft,
    revision: revision(draft),
    attachments: (draft?.attachments ?? []).map(({ content: _content, ...item }) => item),
  };
}

/**
 * 从 `mailboxOpen` 的返回值里取 UIDVALIDITY，取不到就抛 `SHAPE`。
 *
 * UIDVALIDITY 是本包定位邮件的**唯一锚点**：`list()` 把它交给调用方，
 * `read()` / `download()` 拿它比对，`inbox()` 拿它判断目录有没有被重建。
 * 拿不到时不能退化成 `''` 继续跑 —— 那样「目录重建」会被误判成「没有新信」。
 *
 * ⚠️ 必须按**数字位数**校验，不能用真值判断：`imapflow` 新版本给的是 BigInt，
 * 而 `0` / `null` / `undefined` 经 `String()` 后分别是 `'0'` / `'null'` / `'undefined'`，
 * 三个都是真值（truthy）—— 早先的 `if (!uidValidity)` 因此永远不成立。
 *
 * @param box - `mailboxOpen` 的返回值。
 * @param mailbox - 目录名（只用于文案与 details）。
 * @returns UIDVALIDITY 的字符串形式。
 * @throws {MailError} `SHAPE`。
 */
function uidValidityOf(box, mailbox) {
  const raw = box?.uidValidity;
  const value = raw === undefined || raw === null ? '' : String(raw);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new MailError(
      'SHAPE',
      `邮箱没有返回目录「${mailbox}」的 UIDVALIDITY：无法安全地定位邮件，请稍后重试。`,
      { mailbox },
    );
  }
  return value;
}

/* ────────────────────────── 错误翻译 ────────────────────────── */

/**
 * 判断一个底层错误是不是「凭据不对」。
 *
 * `imapflow` 用 `authenticationFailed` 布尔；`nodemailer` 用 `code: 'EAUTH'`；
 * 别的手搓实现（以及注入的假客户端）可能只在 response 里留一行 SASL 文本。
 * 三处都认，否则「密码错了」会被翻成「网络不通」，用户会一直重试。
 *
 * @param error - 底层错误。
 * @returns 是否属于认证失败。
 */
export function isAuthError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.authenticationFailed === true) return true;
  if (error.code === 'EAUTH' || error.code === 'AUTHENTICATIONFAILED') return true;
  const text = `${error.responseText ?? ''} ${error.response ?? ''} ${error.message ?? ''}`;
  return /authenticationfailed|authentication failed|invalid credentials|login failed|bad credentials/i.test(text);
}

/**
 * 把底层连接错误翻译成本包的口径。
 *
 * **这是「网络问题 vs 凭据问题」的唯一分流点。** 两类的用户动作完全不同：
 * 认证失败要改密码（重试无用），超时/不可达要重试。
 *
 * @param error - 底层错误（可能已经是 `MailError`）。
 * @param options.phase - 出错阶段：`'imap'` 或 `'smtp'`（只用于文案）。
 * @returns `MailError`。
 */
export function translateConnectError(error, { phase = 'imap' } = {}) {
  if (error instanceof MailError) return error;
  const server = phase === 'smtp' ? 'SMTP 994' : 'IMAP 993';
  const cause = error?.code ?? error?.name ?? null;

  if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
    return new MailError(
      'CONFIG',
      `邮箱组件没有装上（缺 ${phase === 'smtp' ? 'nodemailer' : 'imapflow'}）：本工作台的依赖不完整，重新安装产品后再试。`,
      { phase, cause },
    );
  }
  if (isAuthError(error)) {
    return new MailError(
      'AUTH_EXPIRED',
      '浙大邮箱认证失败：请确认填写的是完整邮箱地址，并在浙大邮箱网页版重新生成 16 位「客户端专用密码」后更新配置。'
      + '（这不是网络问题，反复重试不会好转。）',
      { phase, cause },
    );
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ETIMEOUT'
    || /timed?\s*out|timeout/i.test(`${error?.message ?? ''}`)) {
    return new MailError(
      'TIMEOUT',
      `连接浙大邮箱超时（${server}）：检查网络或代理后重试。`,
      { phase, cause },
    );
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error?.code)) {
    return new MailError(
      'UNREACHABLE',
      `连不上浙大邮箱（${server}）：检查网络或代理后重试。`,
      { phase, cause },
    );
  }
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER'].includes(error?.code)) {
    return new MailError(
      'UNREACHABLE',
      `和浙大邮箱（${server}）的 TLS 连接被中断：可能被网络中间人代理改写了加密流量，关掉代理或换网络后重试。`,
      { phase, cause },
    );
  }
  return new MailError(
    'UNREACHABLE',
    `未能连接浙大邮箱（${server}）：检查网络后重试；服务器使用 IMAP 993、SMTP 994 加密连接。`,
    { phase, cause },
  );
}

/**
 * 给一个 Promise 套时间上限。
 *
 * @param promise - 待等待的 Promise。
 * @param ms - 毫秒上限；非正数表示不设限。
 * @param label - 超时文案里的动作名（如「连接浙大邮箱」）。
 * @returns 原 Promise 的结果。
 * @throws {MailError} `TIMEOUT`。
 */
export function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  // ⚠️ 先挂一个空 catch：超时获胜后原 Promise 再拒绝时，没人 await 它，
  // Node 会报 unhandledRejection（长进程里会直接杀掉宿主）。
  promise.catch(() => {});
  let timer;
  const timeout = new Promise((_done, fail) => {
    timer = setTimeout(() => {
      // 不足 1 秒时不能四舍五入成「0 秒」—— 那读起来像「没等就放弃了」。
      const shown = ms >= 1000 ? `${Math.round(ms / 1000)} 秒` : `${ms} 毫秒`;
      fail(new MailError('TIMEOUT', `${label}超时（${shown}没有响应）：检查网络后重试。`, { timeoutMs: ms }));
    }, ms);
    // 不让这个定时器单独吊住进程退出。
    if (typeof timer?.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 把 IMAP/SMTP **命令级**错误（已经连上之后才发生的那种）翻成本包的口径。
 *
 * 与 {@link translateConnectError} 分开是有理由的：建连失败几乎只有网络与凭据两类，
 * 而命令失败的绝大多数原因是「这个目录不存在」「这封信没了」「权限不够」——
 * 那些是 `REJECTED`（用户该换一个目标重新操作），**不是**网络问题。
 *
 * 上游把这些原样抛成裸 `Error`，于是路由只能写 `code: 'FAILED'`，
 * 调用方没法按码分流。这里补上码，同时保住原始那段服务器回话。
 *
 * @param error - 命令阶段抛出的错误。
 * @param options.action - 正在做的动作（文案用）。
 * @returns `MailError`。
 */
export function translateProtocolError(error, { action = '读取邮箱' } = {}) {
  if (error instanceof MailError) return error;
  const response = String(error?.responseText ?? error?.response ?? '');
  const cause = error?.code ?? error?.name ?? null;

  // 命令阶段也可能掉线（socketTimeout 到点、服务器先断）。那三类仍按连接口径报。
  if (['ETIMEDOUT', 'ETIMEOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error?.code)
    || /timed?\s*out|timeout/i.test(`${error?.message ?? ''}`)) {
    return translateConnectError(error, { phase: 'imap' });
  }
  if (isAuthError(error)) return translateConnectError(error, { phase: 'imap' });

  if (/NONEXISTENT|doesn'?t exist|no such mailbox|unknown mailbox|not found/i.test(`${response} ${error?.message ?? ''}`)) {
    return new MailError(
      'REJECTED',
      `${action}失败：这个目录或邮件在服务器上不存在（可能已被改名或删除），请刷新列表后重新选择。`,
      { cause, response: response.slice(0, 200) },
    );
  }
  if (/NOPERM|permission denied|not authorized|access denied/i.test(`${response} ${error?.message ?? ''}`)) {
    return new MailError(
      'REJECTED',
      `${action}失败：邮箱服务器拒绝访问这个目录，请在浙大邮箱网页版确认这个目录可以打开。`,
      { cause, response: response.slice(0, 200) },
    );
  }
  return new MailError(
    'REJECTED',
    `${action}被邮箱服务器拒绝：请刷新后重试；反复出现时请在浙大邮箱网页版确认邮箱状态。`,
    { cause, response: response.slice(0, 200) },
  );
}

/* ────────────────────────── 默认工厂（惰性解析依赖） ────────────────────────── */

/**
 * 默认 IMAP 工厂。
 *
 * 动态 `import()` 是**故意的**：本仓不安装 `imapflow`，静态 import 会让所有
 * 纯逻辑测试在加载阶段就失败（见文件头）。
 *
 * @param options - `ImapFlow` 选项。
 * @returns `ImapFlow` 实例。
 */
async function defaultImap(options) {
  const { ImapFlow } = await import('imapflow');
  return new ImapFlow(options);
}

/**
 * 默认 SMTP 工厂（只在 `test()` 里用：`verify()` 不发送任何邮件）。
 *
 * @param options - `nodemailer.createTransport` 选项。
 * @returns transport 实例。
 */
async function defaultSmtp(options) {
  const { default: nodemailer } = await import('nodemailer');
  return nodemailer.createTransport(options);
}

/**
 * 默认 MIME 解析工厂。
 *
 * @param source - 原始邮件字节。
 * @param options - `simpleParser` 选项。
 * @returns 解析结果。
 */
async function defaultParse(source, options) {
  const { simpleParser } = await import('mailparser');
  return simpleParser(source, options);
}

/**
 * 默认下载根目录。
 *
 * 上游 `downloads.mjs` 在 Windows 上问 Shell 要「下载」文件夹的位置（可能被挪到别的盘），
 * 本包不 exec 任何外部进程，退化成 `~/Downloads/CampusAgent`。
 * ⚠️ 这一处与上游**不等价**，见 README 的「已知限制」。
 *
 * @returns 绝对路径。
 */
function defaultDownloadRoot() {
  return path.join(os.homedir(), 'Downloads', 'CampusAgent');
}

/* ────────────────────────── 主体 ────────────────────────── */

/**
 * 邮箱客户端（只读半边）。
 *
 * 生命周期：**每次调用开一条连接、用完即关**。上游靠一个 `clients` 集合 + `generation`
 * 计数器来作废「插件被关掉 / 账号被换掉」时还开着的连接；本包没有插件开关、
 * 也不保存账号，所以那套代际机制没有存在意义（`changed()` / `check()` / `exclusive()`
 * / `idle()` 一并去掉，见 README 的上游对账）。
 */
export class Mail {
  /**
   * @param options.credentialProvider - `() => Promise<{address, password}>`；或返回 `null` 表示没配置。
   * @param options.imap - IMAP 工厂 `(options) => ImapFlow`（可返回 Promise）。测试注入假的。
   * @param options.smtp - SMTP 工厂 `(options) => transport`（可返回 Promise）。测试注入假的。
   * @param options.parse - MIME 解析 `(source, options) => Promise<parsed>`。测试注入假的。
   * @param options.draftDir - 草稿目录（只读打开）。缺省 `null` → `drafts()` 抛 `CONFIG`。
   * @param options.downloadRoot - 附件落盘根目录；缺省 `~/Downloads/CampusAgent`。
   * @param options.now - 时钟（测试用）。
   * @param options.timeouts - 覆盖 {@link DEFAULT_TIMEOUTS} 的某一项。
   */
  constructor({
    credentialProvider = null,
    imap = defaultImap,
    smtp = defaultSmtp,
    parse = defaultParse,
    draftDir = null,
    downloadRoot = defaultDownloadRoot,
    now = () => new Date().toISOString(),
    timeouts = {},
  } = {}) {
    this.credentialProvider = credentialProvider;
    this.imap = imap;
    this.smtp = smtp;
    this.parse = parse;
    this.draftDir = draftDir;
    this.resolveDownloadRoot = typeof downloadRoot === 'function' ? downloadRoot : () => downloadRoot;
    this.now = now;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  /**
   * 注入凭据提供者。
   *
   * 传非函数且非 `null` 立刻抛错 —— 静默置空会让调用方以为注入成功，
   * 直到下一次真正取信才报「没有密码」，那时已经很难定位是谁没接通。
   *
   * @param handler - `() => Promise<{address, password}>` 或 `null`。
   * @returns 撤销函数（幂等）。
   * @throws {MailError} `CONFIG` 参数类型不对。
   */
  setCredentialProvider(handler) {
    if (handler !== null && handler !== undefined && typeof handler !== 'function') {
      throw new MailError('CONFIG', 'setCredentialProvider 需要一个返回 { address, password } 的函数（或 null 取消注册）。');
    }
    this.credentialProvider = typeof handler === 'function' ? handler : null;
    return () => { if (this.credentialProvider === handler) this.credentialProvider = null; };
  }

  /** 是否已接入凭据（不联网、不读凭据本身）。 */
  ready() { return this.credentialProvider !== null; }

  /**
   * 取凭据。凭据的**来源**完全由调用方决定，本包不读凭据服务、不落盘。
   *
   * @returns `{ address, password }`。
   * @throws {MailError} `CONFIG` 没接入 / 凭据不完整；`AUTH_EXPIRED` 提供者自己抛了认证类错误。
   */
  async credentials() {
    if (!this.credentialProvider) {
      throw new MailError(
        'CONFIG',
        '浙大邮箱还没有可用的客户端专用密码：请先在浙大邮箱网页版生成 16 位「客户端专用密码」并接入本工作台，然后重试。'
        + '（若你是插件作者：调用 setCredentialProvider 注入。）',
      );
    }
    let value;
    try {
      value = await this.credentialProvider();
    } catch (error) {
      // 提供者抛的两类错误必须分开走：认证类原样保留 AUTH_EXPIRED，其它包成 CONFIG。
      if (isAuthError(error)) throw translateConnectError(error, { phase: 'imap' });
      // ⚠️ 不能只写 `error?.code`：普通 `Error` 没有 code，会变成一句没有信息量的
      // 「读取邮箱凭据失败：Error」。原因（code 或 name）进 details，原始 message 也带上，
      // 否则用户与排查的人都会卡在「不知道是钥匙串锁了还是没配」。
      const cause = error?.code ?? error?.name ?? '未知原因';
      throw new MailError(
        'CONFIG',
        `读取邮箱凭据失败（${cause}）：请在凭据管理里重新填写浙大邮箱的 16 位客户端专用密码后重试。`,
        { cause, reason: String(error?.message ?? '') },
      );
    }
    if (value === null || value === undefined) {
      throw new MailError('CONFIG', '浙大邮箱还没有配置客户端专用密码：请先接入后再试。');
    }
    const address = text(value.address, 254, false);
    const password = text(value.password, 128, false);
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) {
      throw new MailError('CONFIG', '邮箱凭据里的邮箱地址不完整：请填写完整地址（例如 1234567890@zju.edu.cn）。');
    }
    return { address, password };
  }

  /** IMAP 连接选项（上游 `mail.mjs:110` 逐项相同）。 */
  imapOptions(credentials) {
    return {
      ...ZJU_MAIL.imap,
      auth: { user: credentials.address, pass: credentials.password },
      logger: false,
      emitLogs: false,
      connectionTimeout: this.timeouts.connectMs,
      greetingTimeout: Math.min(10_000, this.timeouts.connectMs),
      socketTimeout: this.timeouts.operationMs,
      maxLiteralSize: MAX_MESSAGE,
      maxResponseSize: MAX_MESSAGE + 1024 * 1024,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      disableAutoIdle: true,
    };
  }

  /** SMTP transport 选项（上游 `mail.mjs:119` 逐项相同；本包只用于 `verify()`）。 */
  smtpOptions(credentials) {
    return {
      ...ZJU_MAIL.smtp,
      auth: { user: credentials.address, pass: credentials.password },
      logger: false,
      debug: false,
      connectionTimeout: this.timeouts.connectMs,
      greetingTimeout: Math.min(10_000, this.timeouts.connectMs),
      socketTimeout: this.timeouts.operationMs,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }

  /**
   * 建一条 IMAP 连接，跑完 `work` 一律关掉。
   *
   * @param work - `(client, credentials) => Promise<T>`。**一次取凭据**：凭据提供者
   *   只被调用一次，`work` 里再要地址（`inbox()` 的 `accountId`）就不用重复问，
   *   也避免「连接用了一份凭据、算账号用了另一份」这种自相矛盾的情况。
   * @returns `work` 的返回值。
   * @throws {MailError} 建连失败翻成 `AUTH_EXPIRED` / `TIMEOUT` / `UNREACHABLE`；
   *   `work` 自己抛的原样上抛（**不吞错**）。
   */
  async withImap(work) {
    const credentials = await this.credentials();
    const options = this.imapOptions(credentials);

    let client;
    try {
      client = await this.imap(options);
    } catch (error) {
      throw translateConnectError(error, { phase: 'imap' });
    }
    if (!client || typeof client.connect !== 'function') {
      throw new MailError('CONFIG', 'IMAP 客户端不可用：注入的工厂没有返回一个可连接的客户端。', { phase: 'imap' });
    }
    // ⚠️ 不能写成 `client.on('error', () => {})` —— 那等于把连接期错误全吞掉。
    // 这里记下来，`work` 失败时作为 details 带出去；EventEmitter 也必须有人听，
    // 否则 'error' 事件会直接掀翻进程。
    let linkError = null;
    client.on?.('error', (error) => { linkError ??= error; });

    try {
      try {
        await withTimeout(client.connect(), this.timeouts.connectMs, '连接浙大邮箱');
      } catch (error) {
        throw translateConnectError(error, { phase: 'imap' });
      }
      try {
        return await withTimeout(work(client, credentials), this.timeouts.operationMs, '读取浙大邮箱');
      } catch (error) {
        // 业务代码自己抛的 `MailError` 语义最准（`REJECTED` / `SHAPE` / `CONFIG`），原样上抛。
        if (error instanceof MailError) throw error;
        // 剩下的都是 IMAP **命令级**失败（目录不存在、权限、连接中途断掉）。
        // 不包一层的话路由只能写 `code: 'FAILED'`，调用方就没法按码分流了。
        const translated = translateProtocolError(error, { action: '读取浙大邮箱' });
        // 连接期记下的那句话挂到 details 上，免得丢失线索。
        if (linkError) translated.details.linkError = linkError.code ?? linkError.name ?? null;
        throw translated;
      }
    } finally {
      // 关闭是清理，不是业务：失败不影响已经拿到的结果，也不该盖掉真正的错误。
      try { await client.logout?.(); } catch { /* 连接可能已经断了 */ }
      try { client.close?.(); } catch { /* 同上 */ }
    }
  }

  /**
   * 建一条 SMTP transport（只给 `test()` 的 `verify()` 用：**不发信**）。
   *
   * @param credentials - `{ address, password }`。
   * @returns transport。
   * @throws {MailError} 建不起来时按 `CONFIG` 报。
   */
  async transporter(credentials) {
    try {
      const transport = await this.smtp(this.smtpOptions(credentials));
      if (!transport || typeof transport.verify !== 'function') {
        throw new MailError('CONFIG', 'SMTP 客户端不可用：注入的工厂没有返回可验证的 transport。', { phase: 'smtp' });
      }
      return transport;
    } catch (error) {
      throw translateConnectError(error, { phase: 'smtp' });
    }
  }

  /**
   * 真连一次：IMAP 只读打开收件箱 + SMTP `verify()`。
   *
   * `verify()` 只做一次握手与认证，**不发送任何邮件**——所以它属于只读面。
   * 方法名与上游 `Mail.test()` 逐字相同。
   *
   * @returns `{ imap: true, smtp: true, address }`。
   * @throws {MailError} 认证失败 / 超时 / 不可达。
   */
  async test() {
    const credentials = await this.credentials();
    await this.withImap(async (client) => {
      await client.mailboxOpen('INBOX', { readOnly: true });
    });
    const transport = await this.transporter(credentials);
    try {
      await withTimeout(transport.verify(), this.timeouts.connectMs, '验证浙大邮箱 SMTP');
    } catch (error) {
      throw translateConnectError(error, { phase: 'smtp' });
    } finally {
      try { transport.close?.(); } catch { /* 已经断了 */ }
    }
    return { imap: true, smtp: true, address: credentials.address };
  }

  /**
   * 目录清单（跳过 `\Noselect`）。
   *
   * @returns `{ folders: [{ path, name, specialUse }] }`。
   * @throws {MailError} `SHAPE` 服务器没给数组。
   */
  folders() {
    return this.withImap(async (client) => {
      const found = await client.list();
      if (!Array.isArray(found)) {
        throw new MailError('SHAPE', '邮箱返回的目录列表无法识别：请稍后重试，或到网页版确认邮箱可正常打开。');
      }
      return {
        folders: found
          .filter(item => !item?.flags?.has?.('\\Noselect'))
          .map(item => ({ path: item.path, name: item.name, specialUse: item.specialUse ?? '' })),
      };
    });
  }

  /**
   * 某目录的信头分页（只读打开，**不动服务器上的已读标记**）。
   *
   * @param input.mailbox - 目录名，默认 `INBOX`。
   * @param input.limit - 每页条数 1..50，默认 20。
   * @param input.offset - 跳过条数 0..1000000，默认 0。
   * @param input.since - `YYYY-MM-DD`（含当天）。
   * @param input.until - `YYYY-MM-DD`（**不含当天**，与 IMAP `BEFORE` 一致）。
   * @param input.unread - `true` 只看未读。
   * @param input.from - 发件人包含。
   * @param input.query - 主题包含。
   * @returns `{ messages, total, offset, hasMore, mailbox, uidValidity }`。
   * @throws {MailError} `CONFIG` 参数问题（含 `since >= until`）、`SHAPE` 目录信封缺字段。
   */
  list(input = {}) {
    return this.withImap(async (client) => {
      const mailbox = text(input?.mailbox) || 'INBOX';
      const limit = integer(input?.limit, 20, 1, 50);
      const offset = integer(input?.offset, 0, 0, 1_000_000);
      const query = {};
      const since = date(input?.since);
      const until = date(input?.until);
      if (since) query.since = since;
      if (until) query.before = until;
      if (since && until && since >= until) {
        throw new MailError('CONFIG', '结束日期须晚于开始日期（结束日期当天不计入）。');
      }
      if (input?.unread === true) query.seen = false;
      if (input?.from) query.from = text(input.from);
      if (input?.query) query.subject = text(input.query);

      const box = await client.mailboxOpen(mailbox, { readOnly: true });
      const uidValidity = uidValidityOf(box, mailbox);
      const found = (await client.search(Object.keys(query).length ? query : { all: true }, { uid: true })) || [];
      const uids = [...found].sort((a, b) => b - a);
      const page = uids.slice(offset, offset + limit);
      const messages = [];
      if (page.length) {
        for await (const item of client.fetch(page.join(','), { uid: true, envelope: true, flags: true, size: true }, { uid: true })) {
          const envelope = item?.envelope ?? {};
          messages.push({
            uid: item.uid,
            uidValidity,
            mailbox,
            subject: envelope.subject || '（无主题）',
            from: addresses(envelope.from),
            to: addresses(envelope.to),
            date: iso(envelope.date),
            unread: !item.flags?.has?.('\\Seen'),
            size: item.size,
          });
        }
      }
      return {
        messages: messages.sort((a, b) => b.uid - a.uid),
        total: uids.length,
        offset,
        hasMore: offset + page.length < uids.length,
        mailbox,
        uidValidity,
      };
    });
  }

  /**
   * 收件箱增量（按 UID + UIDVALIDITY 认新信，**不看已读标记**）。
   *
   * 上游注释把这套语义写得很清楚，本包逐条保留：
   * - 没有匹配的状态（首次运行、或目录重建）时，只回最近 `baseline` 条并标 `baseline: true`；
   * - 每次最多 `max` 条，`more` 说还有剩下的，`last` 只推进到真的返回了的那一封；
   * - `n:*` 这种搜索总会带上最新一封（即使它小于 n），所以必须再按 `uid > after` 过一遍。
   *
   * @param input.after - 上次读到的最大 UID。
   * @param input.uidValidity - 上次读到时的 UIDVALIDITY。
   * @param input.baseline - 基线条数 1..50，默认 20。
   * @param input.max - 单次上限 1..500，默认 200。
   * @returns `{ accountId, mailbox, uidValidity, baseline, last, more, messages }`。
   */
  inbox(input = {}) {
    return this.withImap(async (client, credentials) => {
      const baseline = integer(input?.baseline, 20, 1, 50);
      const max = integer(input?.max, 200, 1, 500);
      const box = await client.mailboxOpen('INBOX', { readOnly: true });
      const uidValidity = uidValidityOf(box, 'INBOX');
      const after = Number.isSafeInteger(input?.after) && input.after >= 0 ? input.after : -1;
      const resume = after >= 0 && input?.uidValidity === uidValidity;
      const found = ((await client.search(resume ? { uid: `${after + 1}:*` } : { all: true }, { uid: true })) || [])
        .filter(uid => !resume || uid > after)
        .sort((a, b) => a - b);
      const page = resume ? found.slice(0, max) : found.slice(-baseline);
      const messages = [];
      if (page.length) {
        for await (const item of client.fetch(page.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          const envelope = item?.envelope ?? {};
          messages.push({
            uid: item.uid,
            subject: envelope.subject || '（无主题）',
            from: addresses(envelope.from),
            date: iso(envelope.date),
            receivedAt: iso(item.internalDate),
          });
        }
      }
      const last = resume ? (page.at(-1) ?? after) : (found.at(-1) ?? 0);
      return {
        accountId: accountId(credentials.address),
        mailbox: 'INBOX',
        uidValidity,
        baseline: !resume,
        last,
        more: resume && found.length > page.length,
        messages: messages.sort((a, b) => a.uid - b.uid),
      };
    });
  }

  /**
   * 取一封邮件的原始字节并解析（内部步骤，`read()` / `download()` 共用）。
   *
   * @param client - 已连接的 IMAP 客户端。
   * @param input.mailbox - 目录，默认 `INBOX`。
   * @param input.uid - 邮件 UID（1..2^32-1）。
   * @param input.uidValidity - 调用方看到的 UIDVALIDITY；对不上就拒绝，避免打开错信。
   * @returns `{ parsed, mailbox, uid, uidValidity }`。
   * @throws {MailError} `REJECTED` 目录变了 / 邮件没了 / 超 25 MB；`SHAPE` 解析失败。
   */
  async message(client, input) {
    const mailbox = text(input?.mailbox) || 'INBOX';
    const uid = integer(input?.uid, 0, 1, 4_294_967_295);
    const validity = text(input?.uidValidity, 30, false);
    const box = await client.mailboxOpen(mailbox, { readOnly: true });
    if (String(box?.uidValidity ?? '') !== validity) {
      throw new MailError('REJECTED', '邮箱目录已发生变化，请重新查询列表后再打开邮件。', { mailbox });
    }
    const meta = await client.fetchOne(uid, { size: true }, { uid: true });
    if (!meta) {
      throw new MailError('REJECTED', '邮件已被移动或删除，请刷新列表。', { mailbox, uid });
    }
    if (!Number.isFinite(meta.size) || meta.size > MAX_MESSAGE) {
      throw new MailError('REJECTED', '这封邮件超过 25 MB，请在浙大邮箱网页版查看。', { mailbox, uid, size: meta.size ?? null });
    }
    const item = await client.fetchOne(uid, { source: true }, { uid: true });
    if (!item?.source) {
      throw new MailError('REJECTED', '邮件已被移动或删除，请刷新列表。', { mailbox, uid });
    }
    if (item.source.length > MAX_MESSAGE) {
      throw new MailError('REJECTED', '这封邮件超过 25 MB，请在浙大邮箱网页版查看。', { mailbox, uid, size: item.source.length });
    }
    let parsed;
    try {
      parsed = await this.parse(item.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: MAX_MESSAGE });
    } catch (error) {
      throw new MailError('SHAPE', '这封邮件的格式无法解析：请在浙大邮箱网页版查看。', { mailbox, uid, cause: error?.code ?? error?.name ?? null });
    }
    if (!parsed || !Array.isArray(parsed.attachments)) {
      throw new MailError('SHAPE', '邮件解析结果不完整（没有附件列表）：请在网页版确认这封邮件，或稍后重试。', { mailbox, uid });
    }
    return { parsed, mailbox, uid, uidValidity: validity };
  }

  /**
   * 读一封邮件的正文与附件清单。
   *
   * 正文最多 60000 字符，`truncated` 明说有没有截断（**不静默截断**）。
   *
   * @param input - 同 {@link message}。
   * @returns 信头 + 正文 + 附件清单（不含附件内容）。
   */
  read(input) {
    return this.withImap(async (client) => {
      const { parsed, ...reference } = await this.message(client, input);
      const body = parsed.text || '这封邮件没有可显示的文字，请在浙大邮箱网页版查看。';
      return {
        ...reference,
        subject: parsed.subject || '（无主题）',
        from: addresses(parsed.from?.value),
        to: addresses(parsed.to?.value),
        cc: addresses(parsed.cc?.value),
        replyTo: addresses(parsed.replyTo?.value),
        messageId: parsed.messageId ?? '',
        date: iso(parsed.date),
        text: body.slice(0, 60_000),
        truncated: body.length > 60_000,
        attachments: parsed.attachments.map((item, index) => ({
          index,
          filename: filename(item?.filename),
          size: item?.size,
          contentType: item?.contentType,
        })),
      };
    });
  }

  /**
   * 下载一个附件到本地（**不是写操作**：只动本机文件，不碰服务器状态）。
   *
   * 落盘路径：`<downloadRoot>/mail/<uuid>/<安全文件名>`，用 `flag: 'wx'` 建新文件 ——
   * 目标目录是新 uuid，理论不会撞名；万一撞了宁可报错也不覆盖。
   *
   * @param input - 同 {@link message}，外加 `index`（附件下标）。
   * @returns `{ file, filename, size }`。
   * @throws {MailError} `CONFIG` 没配下载目录 / 下标越界格式不对；`REJECTED` 没有这个附件。
   */
  download(input) {
    return this.withImap(async (client) => {
      const root = await this.resolveDownloadRoot();
      if (!root) {
        throw new MailError('CONFIG', '没有配置附件下载目录：请在装配时给出 downloadRoot 后重试。');
      }
      const { parsed } = await this.message(client, input);
      const index = integer(input?.index, -1, 0, 1000);
      const attachment = parsed.attachments[index];
      if (!attachment) {
        throw new MailError('REJECTED', '没有找到这个附件，请重新打开邮件。', { index });
      }
      const directory = path.join(root, 'mail', randomUUID());
      const name = filename(attachment.filename);
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, name);
      fs.writeFileSync(file, attachment.content, { flag: 'wx' });
      return { file, filename: name, size: attachment.content.length };
    });
  }

  /**
   * 读草稿目录（**只读**：本包不写、不删、不改任何草稿）。
   *
   * 草稿由写包（将来的 `packages/tool/mail`）落盘；本包按上游 `drafts()` 的口径
   * 展示「属于当前账号」的那些，附件只给元信息、不给 base64 正文。
   *
   * @returns `{ drafts }`，按 `createdAt` 倒序。
   * @throws {MailError} `CONFIG` 没接入凭据 / 没配草稿目录。
   */
  async drafts() {
    if (!this.draftDir) {
      throw new MailError('CONFIG', '没有配置草稿目录：本工作台的邮箱草稿还没有接入，请先在装配处给出 draftDir。');
    }
    const credentials = await this.credentials();
    const id = accountId(credentials.address);
    if (!fs.existsSync(this.draftDir)) return { drafts: [] };
    const drafts = [];
    for (const name of fs.readdirSync(this.draftDir).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      let item;
      try {
        item = JSON.parse(fs.readFileSync(path.join(this.draftDir, name), 'utf8'));
      } catch (error) {
        // 坏文件不能静默跳过：跳过等于「用户的草稿凭空消失」。
        throw new MailError('SHAPE', `草稿文件损坏（${name}）：请把它移走后重试。`, { cause: error?.code ?? null, name });
      }
      if (item?.accountId === id) drafts.push(publicDraft(item));
    }
    return {
      drafts: drafts.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    };
  }

  /**
   * 邮箱状态快照（**不联网**；只回答「有没有接入、接入的是谁」）。
   *
   * @returns `{ ready, connected, address, connectedAt, busy, servers }`。
   *   `connectedAt` 恒为空串：本包不保存账号记录，所以没有「连接时刻」这一说；
   *   保留字段是为了与上游快照形状对齐，调用方按空串处理。
   */
  async snapshot() {
    let address = '';
    let error = null;
    if (this.credentialProvider) {
      try {
        address = (await this.credentials()).address;
      } catch (reason) {
        // 快照不该因为「凭据暂时不可用」就整体失败：地址拿不到就给空串，
        // 但必须把原因带出去，否则界面只能显示「未连接」，用户不知道是没配还是配错了。
        // `reason` 是凭据提供者给的那句原话（**不含密码**：提供者只会说为什么取不到）。
        error = {
          code: reason?.code ?? 'CONFIG',
          message: String(reason?.message ?? reason),
          reason: String(reason?.details?.reason ?? ''),
        };
      }
    }
    return {
      ready: this.credentialProvider !== null,
      connected: address !== '',
      address,
      connectedAt: '',
      busy: false,
      error,
      servers: ZJU_MAIL,
    };
  }
}
