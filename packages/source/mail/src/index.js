/**
 * 浙大邮箱数据源的宿主入口（**真正的 Cordis 插件**：有 `apply`，配 `cordis.patch.yml`）。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、无写操作。上游 `mail.mjs` 的四个写方法
 * （`send` / `prepare` / `updateDraft` / `removeDraft`）归 `packages/tool/mail`
 * （本次不建；见 README 的「写操作去哪了」）。
 *
 * # 为什么这里必须能注入 IMAP / SMTP 工厂
 *
 * `imapflow` / `nodemailer` / `mailparser` 是第三方依赖，由产品安装 ——
 * 本仓 `node_modules` 里没有它们。若 `apply` 一上来就静态 import，任何加载
 * 这个包的测试都会 `ERR_MODULE_NOT_FOUND`，于是「整个包测不了」。
 * 所以工厂默认走 `mail.js` 里的**动态 import**，测试注入假的。
 *
 * # 凭据
 *
 * 不读 `ctx.credentials`、不落盘：调用方通过 `setCredentialProvider` 注入
 * `() => Promise<{ address, password }>`。这与 `source/yjsy` 的 `setTokenProvider`
 * 是同一条原则 —— **下层不知道凭据从哪来**。
 *
 * # 路由动作名与服务方法名**逐字相同**
 *
 * 路由的 `action` 就是 `methods` 里的那串（`mail.list` 等）。此前的包在这里错过：
 * `methods: ['mail.list']` 而路由只认 `'list'`，外部照着 `methods` 写字面量就 400。
 */
import path from 'node:path';

import { Mail, MailError, ZJU_MAIL, filename } from './mail.js';

export const name = 'zju-source-mail';

/**
 * 不需要宿主服务（`webServer` 用 `ctx.inject` 惰性取，`profileContext` 同样惰性读）。
 *
 * 写成空数组是**有意的**：硬依赖 `profileContext` 会让「宿主没挂数据目录」时
 * 整个插件不启动，而本包的只读能力在没有数据目录时也能用（只是没有草稿目录）。
 */
export const inject = [];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zhiyun-mail';

/**
 * 服务面暴露的只读方法名。
 *
 * 路由的 `action` 直接取这里的字符串，两边不会漂移。
 */
export const METHODS = Object.freeze([
  'mail.folders',
  'mail.list',
  'mail.inbox',
  'mail.read',
  'mail.download',
  'mail.drafts',
  'mail.test',
  'mail.snapshot',
]);

/**
 * 附件下载根目录。
 *
 * 上游 `downloads.mjs` 在 Windows 上问 Shell 要「下载」文件夹的真实位置，
 * 本包不 exec 外部进程：`CAMPUS_DOWNLOADS_DIR` 可整体覆盖（与上游同名环境变量
 * 语义一致，测试也靠它避免往真实的「下载」里写），否则 `~/Downloads/CampusAgent`。
 *
 * @returns 绝对路径。
 */
function downloadDirectory() {
  const override = process.env.CAMPUS_DOWNLOADS_DIR;
  if (override) return path.join(path.resolve(override), 'CampusAgent');
  return null; // 交给 Mail 的默认值（~/Downloads/CampusAgent）
}

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @param [config] - 装配参数：`{ draftDir, downloadRoot, timeouts, imap, smtp, parse }`。
 *   后三个是**工厂注入点**：上游 `mail.mjs:73` 就是这么设计的
 *   （`imap = options => new ImapFlow(options)`），测试传假的即可全链路离线。
 * @returns 卸载函数。
 */
export function apply(ctx, config = {}) {
  return ctx.effect(() => {
    /** 草稿目录：没有 `profileContext` 时退化成 null（`drafts()` 会明确报 CONFIG）。 */
    const profileDir = ctx.get?.('profileContext')?.dir ?? null;
    const draftDir = config.draftDir
      ?? (profileDir === null ? null : path.join(profileDir, 'data', 'zhiyun-mail', 'outbox'));
    const downloadRoot = config.downloadRoot ?? downloadDirectory();

    const mail = new Mail({
      draftDir,
      ...(downloadRoot === null ? {} : { downloadRoot }),
      timeouts: config.timeouts ?? {},
      ...(typeof config.imap === 'function' ? { imap: config.imap } : {}),
      ...(typeof config.smtp === 'function' ? { smtp: config.smtp } : {}),
      ...(typeof config.parse === 'function' ? { parse: config.parse } : {}),
    });

    const service = {
      routePath: ROUTE_PATH,
      platform: 'mail',
      label: '浙大邮箱',
      readOnly: true,
      methods: [...METHODS],
      servers: ZJU_MAIL,
      draftDir,
      /** 注入凭据提供者（`() => Promise<{ address, password }>`）。返回撤销函数。 */
      setCredentialProvider(handler) { return mail.setCredentialProvider(handler); },
      /** 是否已接入凭据（不联网）。 */
      ready() { return mail.ready(); },
      /** 清空配置（换账号时用）。 */
      reset() { mail.setCredentialProvider(null); },

      /* ── 只读接口（名字与 `methods` 里的后一段一致） ── */
      async folders() { return mail.folders(); },
      async list(input = {}) { return mail.list(input); },
      async inbox(input = {}) { return mail.inbox(input); },
      async read(input = {}) { return mail.read(input); },
      async download(input = {}) { return mail.download(input); },
      async drafts() { return mail.drafts(); },
      /** 真连一次（IMAP 只读打开收件箱 + SMTP `verify()`，**不发信**）。 */
      async test() { return mail.test(); },
      async snapshot() { return mail.snapshot(); },

      /**
       * 路由动作表：键是 `methods` 里的**全名**，值是调用。
       *
       * 暴露出来是为了让测试能断言「每个 methods 都有对应的动作」——
       * 之前那个错（声明 `mail.list`、路由只认 `list`）就是缺了这条约束。
       */
      actions: () => ({
        'mail.folders': () => service.folders(),
        'mail.list': (input) => service.list(input),
        'mail.inbox': (input) => service.inbox(input),
        'mail.read': (input) => service.read(input),
        'mail.download': (input) => service.download(input),
        'mail.drafts': () => service.drafts(),
        'mail.test': () => service.test(),
        'mail.snapshot': () => service.snapshot(),
      }),
    };

    const disposeService = ctx.provide('zhiyunMail', service);

    let removeRoute = null;
    ctx.inject?.(['webServer'], (scope) => {
      removeRoute = scope.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          try {
            const body = await new Promise((done, fail) => {
              const chunks = [];
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
              req.on('error', fail);
            });
            const input = body ? JSON.parse(body) : {};
            const action = input?.action;
            const handler = service.actions()[action];
            if (!handler) {
              throw new MailError('CONFIG', `不认识的操作：${action ?? '(空)'}。可用的动作有：${METHODS.join('、')}`);
            }
            res.end(JSON.stringify({ ok: true, value: await handler(input.input ?? {}) }));
          } catch (error) {
            res.end(JSON.stringify({
              ok: false,
              error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) },
            }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      disposeService?.();
    };
  }, 'zju: mail data source');
}

export { Mail, MailError, ZJU_MAIL, filename };
export { METHODS as MAIL_METHODS };
