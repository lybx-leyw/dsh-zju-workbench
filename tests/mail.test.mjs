/**
 * 浙大邮箱数据源的测试。
 *
 * # 全程不联网、不连 IMAP、不解析真实邮件
 *
 * `imapflow` / `nodemailer` / `mailparser` **不在本仓 `node_modules` 里**（它们是产品依赖），
 * 所以这里一律注入假工厂 —— 这既是硬要求，也是唯一能跑通的方式。
 *
 * # ⚠️ 夹具来源
 *
 * 本文件夹具按**上游 `mail.mjs` 的注释与代码**推断，**未经真实邮箱验证**：
 * 信封字段名、`uidValidity` 的存在形式、附件在 `simpleParser` 结果里的形状，
 * 都是照上游的用法写的。真实服务器返回的东西可能有别的边角（例如
 * `uidValidity` 是 bigint），那种差异这里测不出来。
 *
 * # 断言为什么都带着具体值
 *
 * 上一轮的真实事故：「`items.every(...)` 在空数组上永远通过」。所以凡是
 * `every` 的地方，同时断言 `length > 0`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  Mail, MailError, ZJU_MAIL, MAX_MESSAGE, DEFAULT_TIMEOUTS,
  text, integer, date, addresses, iso, filename, accountId, revision, publicDraft,
  isAuthError, translateConnectError, translateProtocolError, withTimeout,
} from '../packages/source/mail/src/mail.js';
import { apply, ROUTE_PATH, METHODS } from '../packages/source/mail/src/index.js';

/* ───────────────────────── 假 IMAP / SMTP / parser ───────────────────────── */

/**
 * 造一个假的 IMAP 客户端。
 *
 * 故意**复刻两处真实的难缠行为**，否则某些测试会变成真空真：
 *
 * 1. `search({ uid: 'N:*' })` 会把**最新一封**也带回来，即使它的 UID < N
 *    （真实 IMAP 的 `n:*` 语义）。上游 `mail.mjs:196` 为此写了 `.filter(uid => uid > after)`
 *    —— 这里复刻了它，删掉那行 filter 就会有多余的新信混进来。
 * 2. `fetch()` 返回的是**异步生成器**，不是数组。上游用 `for await`，形状必须对。
 *
 * @param boxes - `{ [mailbox]: { uidValidity, messages: [{uid, envelope, flags, size, source, internalDate}] } }`。
 * @param options.connectError - `connect()` 要抛的错误。
 * @returns `{ client, calls }`；`calls` 记录每一次打开/搜索/关闭，供断言。
 */
function fakeImap(boxes, { connectError = null, hangOn = null, connectHangs = false } = {}) {
  const calls = { opened: [], searched: [], fetched: [], closed: 0, loggedOut: 0, list: 0 };
  const client = {
    async connect() {
      if (connectHangs) return new Promise(() => {});
      if (connectError) throw connectError;
    },
    on() { /* EventEmitter 形状：宿主会注册 'error' 监听 */ },
    async list() {
      calls.list += 1;
      return [
        { path: 'INBOX', name: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
        { path: '已发送', name: '已发送', flags: new Set(), specialUse: '\\Sent' },
        { path: '坏目录', name: '坏目录', flags: new Set(['\\Noselect']), specialUse: '' },
      ];
    },
    async mailboxOpen(mailbox, options) {
      calls.opened.push({ mailbox, options });
      if (hangOn === `open:${mailbox}`) return new Promise(() => {});
      const box = boxes[mailbox];
      if (!box) {
        const error = new Error(`Mailbox doesn't exist: ${mailbox}`);
        error.responseText = 'NO [NONEXISTENT] Unknown Mailbox';
        throw error;
      }
      return { uidValidity: box.uidValidity, path: mailbox };
    },
    async search(query, options) {
      calls.searched.push({ query, options });
      const box = boxes.INBOX;
      const collection = box.messages.map(m => m.uid).sort((a, b) => a - b);
      if (query.all === true) return collection;
      if (typeof query.uid === 'string' && query.uid.endsWith(':*')) {
        const from = Number(query.uid.slice(0, -2));
        const maxUid = collection.length ? collection[collection.length - 1] : 0;
        // 真实语义：`N:*` 至少包含最新一封。
        return collection.filter(uid => uid >= from || uid === maxUid);
      }
      if (query.seen === false) {
        return box.messages.filter(m => !m.flags?.has('\\Seen')).map(m => m.uid).sort((a, b) => a - b);
      }
      return collection;
    },
    async *fetch(uids, fields) {
      const wanted = String(uids).split(',').map(Number);
      calls.fetched.push({ uids: wanted, fields });
      if (hangOn === 'fetch') { await new Promise(() => {}); }
      for (const message of boxes.INBOX.messages) {
        if (!wanted.includes(message.uid)) continue;
        yield {
          uid: message.uid,
          // 只给这次请求要的字段，没要的就不出现 —— 与真实 imapflow 一致。
          ...(fields.envelope ? { envelope: message.envelope } : {}),
          ...(fields.flags ? { flags: message.flags ?? new Set() } : {}),
          ...(fields.size ? { size: message.size } : {}),
          ...(fields.internalDate ? { internalDate: message.internalDate ?? null } : {}),
        };
      }
    },
    async fetchOne(uid, fields) {
      const message = boxes.INBOX.messages.find(m => m.uid === uid);
      if (!message) return false;
      if (fields.source) return { uid, source: message.source };
      return { uid, size: fields.size ? message.size : undefined };
    },
    async logout() { calls.loggedOut += 1; },
    close() { calls.closed += 1; },
  };
  return { client, calls };
}

/** 出厂就用假 IMAP 的 `Mail`，凭据固定。 */
function mailWith(boxes, options = {}) {
  const { client, calls } = fakeImap(boxes, options);
  const mail = new Mail({
    credentialProvider: options.credentialProvider ?? (async () => ({ address: '3200000000@zju.edu.cn', password: 'abcDEF1234567890' })),
    imap: () => client,
    ...(options.smtp ? { smtp: options.smtp } : {}),
    ...(options.parse ? { parse: options.parse } : {}),
    ...(options.draftDir ? { draftDir: options.draftDir } : {}),
    downloadRoot: options.downloadRoot ?? path.join(os.tmpdir(), 'zhiyun-mail-test-downloads'),
    ...(options.timeouts ? { timeouts: options.timeouts } : {}),
  });
  return { mail, calls, client };
}

/** 一封合成邮件的信封（**不是真实邮件**，字段名照上游用法）。 */
function envelope(subject, from = 'noreply@zju.edu.cn', when = '2026-11-09T08:00:00.000Z') {
  return {
    subject,
    from: [{ name: '教务', address: from }],
    to: [{ name: '', address: '3200000000@zju.edu.cn' }],
    date: new Date(when),
  };
}

/** 一个单目录、三封信的假邮箱。 */
function simpleBox() {
  return {
    INBOX: {
      uidValidity: 42,
      messages: [
        { uid: 3, envelope: envelope('第三封'), flags: new Set(['\\Seen']), size: 2000, internalDate: new Date('2026-11-09T09:00:00Z'), source: Buffer.from('third') },
        { uid: 2, envelope: envelope('第二封'), flags: new Set(), size: 1500, internalDate: new Date('2026-11-08T09:00:00Z'), source: Buffer.from('second') },
        { uid: 1, envelope: envelope('第一封'), flags: new Set(['\\Seen']), size: 1000, internalDate: new Date('2026-11-07T09:00:00Z'), source: Buffer.from('first') },
      ],
    },
  };
}

/* ───────────────────────────── 纯函数 ───────────────────────────── */

test('ZJU_MAIL 的四个事实：主机、端口、TLS', () => {
  assert.equal(ZJU_MAIL.imap.host, 'imap.zju.edu.cn');
  assert.equal(ZJU_MAIL.imap.port, 993);
  assert.equal(ZJU_MAIL.imap.secure, true);
  assert.equal(ZJU_MAIL.smtp.host, 'smtp.zju.edu.cn');
  assert.equal(ZJU_MAIL.smtp.port, 994);
  assert.equal(ZJU_MAIL.smtp.secure, true);
  assert.ok(Object.isFrozen(ZJU_MAIL));
  assert.ok(Object.isFrozen(ZJU_MAIL.imap));
  assert.equal(MAX_MESSAGE, 25 * 1024 * 1024);
});

test('text：修剪、限长、拒 NUL；optional 时空值放行', () => {
  assert.equal(text('  hi  '), 'hi');
  assert.equal(text(undefined), '');
  assert.equal(text(''), '');
  assert.throws(() => text(undefined, 10, false), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
  assert.throws(() => text('   '), /为空或过长/);
  assert.throws(() => text('a'.repeat(11), 10), /为空或过长/);
  assert.throws(() => text('a\0b'), /为空或过长/);
});

test('integer：缺省值、边界、越界与非法都抛 CONFIG', () => {
  assert.equal(integer(undefined, 7, 1, 10), 7);
  assert.equal(integer(1, 7, 1, 10), 1);
  assert.equal(integer(10, 7, 1, 10), 10);
  for (const bad of [0, 11, 1.5, 'x', Number.NaN]) {
    assert.throws(() => integer(bad, 7, 1, 10), (error) => {
      assert.equal(error.code, 'CONFIG');
      return true;
    });
  }
});

test('date：严格 YYYY-MM-DD，且不存在的日期也不放过', () => {
  assert.equal(date(undefined), undefined);
  assert.equal(date('2026-11-10').toISOString(), '2026-11-10T00:00:00.000Z');
  for (const bad of ['2026-1-1', '2026/11/10', '2026-02-30', '20261110']) {
    assert.throws(() => date(bad), (error) => {
      assert.equal(error.code, 'CONFIG');
      return true;
    }, `应当拒绝 ${bad}`);
  }
});

test('addresses / iso：缺失字段补空串，解析不了的时间返回空串', () => {
  assert.deepEqual(addresses(undefined), []);
  assert.deepEqual(addresses([{ name: 'a', address: 'a@b.c' }, { address: 'x@y.z' }]), [
    { name: 'a', address: 'a@b.c' },
    { name: '', address: 'x@y.z' },
  ]);
  assert.equal(iso('not a date'), '');
  assert.equal(iso(new Date('2026-11-09T08:00:00Z')), '2026-11-09T08:00:00.000Z');
});

test('filename：去目录、换非法字符、避开 Windows 保留名', () => {
  assert.equal(filename('../../etc/passwd'), 'passwd');
  assert.equal(filename('a<b>c:d.txt'), 'a_b_c_d.txt');
  assert.equal(filename('CON.txt'), 'attachment-CON.txt');
  assert.equal(filename(''), 'attachment');
  assert.equal(filename('normal.pdf'), 'normal.pdf');
  // 尾部点/空格被剥掉
  assert.equal(filename('x.txt. . '), 'x.txt');
  assert.equal('a'.repeat(200).length, 200);
  assert.equal(filename('a'.repeat(200)).length, 160);
});

test('accountId：小写归一 + sha256，与上游算法一致', () => {
  const expected = createHash('sha256').update('a@zju.edu.cn').digest('hex');
  assert.equal(accountId('A@ZJU.EDU.CN'), expected);
  assert.equal(accountId('  a@zju.edu.cn  '), expected);
  // 大小写不同的地址必须是同一个账号 —— 否则草稿会「看不见」。
  assert.equal(accountId('A@zju.edu.cn'), accountId('a@zju.edu.cn'));
});

test('publicDraft：剥掉附件正文、补上当前修订号', () => {
  const draft = {
    id: 'd1', accountId: 'aid', to: ['a@b.c'], subject: 's', text: 't', createdAt: '2026-11-10T00:00:00Z',
    attachments: [{ filename: 'a.pdf', size: 3, content: 'QUJD' }],
  };
  const shown = publicDraft(draft);
  assert.deepEqual(shown.attachments, [{ filename: 'a.pdf', size: 3 }]);
  assert.equal(shown.attachments[0].content, undefined);
  assert.equal(shown.revision, revision(draft));
  // 原文没被改动
  assert.equal(draft.attachments[0].content, 'QUJD');
});

test('isAuthError：三种真实形状都认得', () => {
  assert.equal(isAuthError({ authenticationFailed: true }), true);
  assert.equal(isAuthError({ code: 'EAUTH' }), true);
  assert.equal(isAuthError({ responseText: 'NO [AUTHENTICATIONFAILED] Invalid credentials' }), true);
  assert.equal(isAuthError({ code: 'ETIMEDOUT' }), false);
  assert.equal(isAuthError(null), false);
});

test('translateConnectError：网络问题与凭据问题必须是不同的码', () => {  const auth = translateConnectError({ authenticationFailed: true });
  assert.equal(auth.code, 'AUTH_EXPIRED');
  assert.match(auth.message, /客户端专用密码/);
  assert.match(auth.message, /不是网络问题/);

  const auth2 = translateConnectError({ code: 'EAUTH' }, { phase: 'smtp' });
  assert.equal(auth2.code, 'AUTH_EXPIRED');
  assert.equal(auth2.details.phase, 'smtp');

  assert.equal(translateConnectError({ code: 'ETIMEDOUT' }).code, 'TIMEOUT');
  assert.equal(translateConnectError({ code: 'ENOTFOUND' }).code, 'UNREACHABLE');
  assert.equal(translateConnectError({ code: 'ECONNREFUSED' }).code, 'UNREACHABLE');
  assert.equal(translateConnectError({ code: 'CERT_HAS_EXPIRED' }).code, 'UNREACHABLE');
  assert.match(translateConnectError({ code: 'CERT_HAS_EXPIRED' }).message, /中间人/);
  assert.equal(translateConnectError({}).code, 'UNREACHABLE');
  assert.equal(translateConnectError({ code: 'ERR_MODULE_NOT_FOUND' }).code, 'CONFIG');

  // 已经是本包的错误就原样返回，不重复包装。
  const own = new MailError('REJECTED', 'x');
  assert.equal(translateConnectError(own), own);
});

test('translateProtocolError：命令级失败翻成 REJECTED，而掉线仍按连接口径', () => {
  const missing = translateProtocolError({ responseText: "NO [NONEXISTENT] Mailbox doesn't exist: 归档" }, { action: '读取浙大邮箱' });
  assert.equal(missing.code, 'REJECTED');
  assert.match(missing.message, /不存在/);
  assert.match(missing.message, /刷新列表/);
  assert.equal(missing.details.response, "NO [NONEXISTENT] Mailbox doesn't exist: 归档");

  const denied = translateProtocolError({ responseText: 'NO [NOPERM] Permission denied' });
  assert.equal(denied.code, 'REJECTED');
  assert.match(denied.message, /拒绝访问/);

  // 命令阶段掉线 → 仍是网络的码，不是 REJECTED。
  assert.equal(translateProtocolError({ code: 'ECONNRESET' }).code, 'UNREACHABLE');
  assert.equal(translateProtocolError({ code: 'ETIMEDOUT' }).code, 'TIMEOUT');
  assert.equal(translateProtocolError({ code: 'EAUTH' }).code, 'AUTH_EXPIRED');

  // 兜底：说不清的就给 REJECTED，且带上原始回话的前 200 字符。
  const unknown = translateProtocolError({ responseText: 'NO 某个新错误' });
  assert.equal(unknown.code, 'REJECTED');
  assert.match(unknown.message, /被邮箱服务器拒绝/);

  // 已经是本包的错误原样返回。
  const own = new MailError('SHAPE', 'x');
  assert.equal(translateProtocolError(own), own);
});

test('目录不存在：命令级错误真的被包成 REJECTED（不是 FAILED 裸错）', async () => {
  const { mail } = mailWith(simpleBox());
  await assert.rejects(() => mail.list({ mailbox: '不存在的目录' }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.equal(error.name, 'MailError');
    assert.match(error.message, /不存在/);
    return true;
  });
});

test('withTimeout：超时抛 TIMEOUT，不超时原样返回，并且不会泄漏 unhandledRejection', async () => {  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, '测试'), 'ok');
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, '连接浙大邮箱'),
    (error) => {
      assert.equal(error.code, 'TIMEOUT');
      assert.match(error.message, /连接浙大邮箱超时/);
      assert.equal(error.details.timeoutMs, 10);
      return true;
    },
  );
  // ms <= 0 = 不设限
  assert.equal(await withTimeout(Promise.resolve(5), 0, 'x'), 5);
});

/* ───────────────────────── 凭据（不联网） ───────────────────────── */

test('没注入凭据提供者：取信抛 CONFIG，文案告诉用户下一步', async () => {
  const mail = new Mail({ imap: () => { throw new Error('不该被调用'); } });
  assert.equal(mail.ready(), false);
  await assert.rejects(() => mail.folders(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /客户端专用密码/);
    return true;
  });
});

test('凭据提供者返回 null / 缺字段：CONFIG，且不冒充网络错误', async () => {
  const missing = new Mail({ credentialProvider: async () => null });
  await assert.rejects(() => missing.folders(), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });

  const half = new Mail({ credentialProvider: async () => ({ address: 'a@zju.edu.cn' }) });
  await assert.rejects(() => half.folders(), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });

  const badAddress = new Mail({ credentialProvider: async () => ({ address: 'not-an-email', password: 'x'.repeat(16) }) });
  await assert.rejects(() => badAddress.folders(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /完整地址/);
    return true;
  });
});

test('凭据提供者自己抛认证错误：翻成 AUTH_EXPIRED（不是 CONFIG）', async () => {
  const mail = new Mail({
    credentialProvider: async () => { const e = new Error('nope'); e.code = 'EAUTH'; throw e; },
  });
  await assert.rejects(() => mail.folders(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    return true;
  });
});

test('setCredentialProvider：非函数立刻抛 CONFIG；撤销函数幂等', () => {
  const mail = new Mail();
  assert.throws(() => mail.setCredentialProvider('nope'), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
  const undo = mail.setCredentialProvider(async () => ({ address: 'a@zju.edu.cn', password: 'x'.repeat(16) }));
  assert.equal(mail.ready(), true);
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => undo());
  assert.equal(mail.ready(), false);
  assert.doesNotThrow(() => mail.setCredentialProvider(null));
});

/* ─────────────────────── 连接层：分流与清理 ─────────────────────── */

test('连接失败的三条分流：认证 / 超时 / 不可达', async () => {
  for (const [error, code] of [
    [{ authenticationFailed: true }, 'AUTH_EXPIRED'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
    [{ code: 'ECONNREFUSED' }, 'UNREACHABLE'],
  ]) {
    const { mail } = mailWith(simpleBox(), { connectError: error });
    await assert.rejects(() => mail.folders(), (thrown) => {
      assert.equal(thrown.code, code);
      return true;
    }, `${error.code ?? 'authenticationFailed'} 应当翻成 ${code}`);
  }
});

test('连接超时：卡死的 connect() 被 Promise.race 兜住（imapflow 自己的选项不管用）', async () => {
  const { mail } = mailWith(simpleBox(), { connectHangs: true, timeouts: { connectMs: 30 } });
  await assert.rejects(() => mail.folders(), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    // 不足 1 秒要说毫秒：写成「0 秒」读起来像「没等就放弃了」。
    assert.match(error.message, /30 毫秒没有响应/);
    return true;
  });
});

test('操作超时：connected 之后卡住也照样抛 TIMEOUT', async () => {
  // `folders()` 只调 `list()`，不打开目录 —— 卡点必须落在它真的会走的那一步。
  const { mail } = mailWith(simpleBox(), { hangOn: 'open:INBOX', timeouts: { operationMs: 30 } });
  await assert.rejects(() => mail.list({}), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    return true;
  });
});

test('注入的工厂没返回可连接的东西：CONFIG，不把它当网络错误', async () => {
  const mail = new Mail({
    credentialProvider: async () => ({ address: 'a@zju.edu.cn', password: 'x'.repeat(16) }),
    imap: () => ({}),
  });
  await assert.rejects(() => mail.folders(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /IMAP 客户端不可用/);
    return true;
  });
});

test('无论成功还是失败，连接都会被关掉（既不泄漏、也不吞掉业务错误）', async () => {
  const ok = mailWith(simpleBox());
  await ok.mail.folders();
  assert.equal(ok.calls.loggedOut, 1);
  assert.equal(ok.calls.closed, 1);

  const bad = mailWith(simpleBox());
  await assert.rejects(() => bad.mail.list({ since: '2026-11-01', until: '2026-11-01' }));
  assert.equal(bad.calls.loggedOut, 1, '业务错误也要走 finally 关闭连接');
  assert.equal(bad.calls.closed, 1);
});

/* ───────────────────────── 目录 / 列表 / 收件箱 ───────────────────────── */

test('folders：跳过 \\Noselect，保留 specialUse', async () => {
  const { mail, calls } = mailWith(simpleBox());
  const result = await mail.folders();
  assert.equal(result.folders.length, 2);
  assert.deepEqual(result.folders.map(f => f.path), ['INBOX', '已发送']);
  assert.equal(result.folders[0].specialUse, '\\Inbox');
  assert.equal(calls.list, 1);
});

test('list：只读打开、倒序、分页、hasMore 与 uidValidity 都是具体值', async () => {
  const { mail, calls } = mailWith(simpleBox());
  const page = await mail.list({ limit: 2, offset: 0 });
  assert.deepEqual(page.messages.map(m => m.uid), [3, 2]);
  assert.equal(page.total, 3);
  assert.equal(page.offset, 0);
  assert.equal(page.hasMore, true);
  assert.equal(page.mailbox, 'INBOX');
  assert.equal(page.uidValidity, '42');
  assert.equal(page.messages[0].subject, '第三封');
  assert.equal(page.messages[0].unread, false);
  assert.equal(page.messages[1].unread, true);
  assert.equal(page.messages[0].size, 2000);
  assert.deepEqual(page.messages[0].from, [{ name: '教务', address: 'noreply@zju.edu.cn' }]);
  // 只读：服务器上的已读标记绝不能被改。
  assert.equal(calls.opened.length > 0, true);
  assert.equal(calls.opened.every(item => item.options.readOnly === true), true);
  assert.equal(calls.opened[0].mailbox, 'INBOX');
});

test('list：offset 越过末尾 → 空数组 + hasMore=false（不是报错）', async () => {
  const { mail, calls } = mailWith(simpleBox());
  const page = await mail.list({ offset: 10, limit: 5 });
  assert.deepEqual(page.messages, []);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, false);
  // 空页不该触发 fetch
  assert.equal(calls.fetched.length, 0);
});

test('list：过滤条件真的变成 IMAP 查询，且 since >= until 被拒', async () => {
  const { mail, calls } = mailWith(simpleBox());
  await mail.list({ unread: true, from: 'jwc', query: '选课', since: '2026-11-01', until: '2026-11-10' });
  const query = calls.searched[0].query;
  assert.equal(query.seen, false);
  assert.equal(query.from, 'jwc');
  assert.equal(query.subject, '选课');
  assert.equal(query.since.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(query.before.toISOString(), '2026-11-10T00:00:00.000Z');
  assert.equal(calls.searched[0].options.uid, true);

  await assert.rejects(() => mail.list({ since: '2026-11-10', until: '2026-11-10' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /结束日期须晚于开始日期/);
    return true;
  });
});

test('list：没有 UIDVALIDITY 时抛 SHAPE（不拿空串去定位邮件）', async () => {
  const boxes = { INBOX: { uidValidity: 0, messages: [] } };
  const { mail } = mailWith(boxes);
  await assert.rejects(() => mail.list({}), (error) => {
    assert.equal(error.code, 'SHAPE');
    return true;
  });
});

test('inbox 首次运行：取最近 baseline 条、标 baseline、last 取最大 UID', async () => {
  const { mail } = mailWith(simpleBox());
  const first = await mail.inbox({ baseline: 2 });
  assert.equal(first.baseline, true);
  assert.deepEqual(first.messages.map(m => m.uid), [2, 3]);
  assert.equal(first.last, 3);
  assert.equal(first.more, false);
  assert.equal(first.mailbox, 'INBOX');
  assert.equal(first.uidValidity, '42');
  assert.equal(first.accountId, createHash('sha256').update('3200000000@zju.edu.cn').digest('hex'));
  assert.equal(first.messages[0].receivedAt, '2026-11-08T09:00:00.000Z');
});

test('inbox 增量：只回 UID 更大的那些，且 `n:*` 带回的最新一封被 filter 挡掉', async () => {
  const { mail, calls } = mailWith(simpleBox());
  // after=1、uidValidity 对上 → resume。真实 IMAP 的 `2:*` 会把 uid=3 带回来，
  // 同时也可能带回比 2 小的（这里由假客户端复刻：至少包含最新一封）。
  const result = await mail.inbox({ after: 1, uidValidity: '42', max: 10 });
  assert.equal(result.baseline, false);
  assert.deepEqual(result.messages.map(m => m.uid), [2, 3]);
  assert.equal(result.last, 3);
  assert.equal(result.more, false);
  assert.equal(calls.searched[0].query.uid, '2:*');

  // 再往前推进：after=3 → 没有新信，last 保持 3（不是 0、也不倒退）
  const none = await mail.inbox({ after: 3, uidValidity: '42', max: 10 });
  assert.deepEqual(none.messages, []);
  assert.equal(none.baseline, false);
  assert.equal(none.last, 3);
});

test('inbox：UIDVALIDITY 变了就重新建基线（不拿旧编号去开新信）', async () => {
  const { mail, calls } = mailWith(simpleBox());
  const result = await mail.inbox({ after: 1, uidValidity: '41', baseline: 3 });
  assert.equal(result.baseline, true, 'UIDVALIDITY 对不上必须重来');
  assert.equal(calls.searched[0].query.all, true, '不能再用 uid 搜索');
  assert.deepEqual(result.messages.map(m => m.uid), [1, 2, 3]);
});

test('inbox：一次取不完时 more=true，且 last 只推进到真的返回了的那一封', async () => {
  const { mail } = mailWith(simpleBox());
  const result = await mail.inbox({ after: 0, uidValidity: '42', max: 1 });
  assert.deepEqual(result.messages.map(m => m.uid), [1]);
  assert.equal(result.last, 1);
  assert.equal(result.more, true);
});

/* ───────────────────────── 正文 / 附件 ───────────────────────── */

/** 造一个假的 simpleParser 结果。 */
function fakeParsed({
  subject = '选课通知', text = '正文内容', attachments = [], from = [{ name: '教务', address: 'noreply@zju.edu.cn' }],
} = {}) {
  return {
    subject,
    text,
    from: { value: from },
    to: { value: [{ name: '', address: '3200000000@zju.edu.cn' }] },
    cc: undefined,
    replyTo: undefined,
    messageId: '<abc@zju.edu.cn>',
    date: new Date('2026-11-09T08:00:00Z'),
    attachments,
  };
}

test('read：正文、信头、附件清单（不含 content）都是具体值', async () => {
  const { mail } = mailWith(simpleBox(), {
    parse: async () => fakeParsed({ attachments: [{ filename: 'a.pdf', size: 3, contentType: 'application/pdf', content: Buffer.from('abc') }] }),
  });
  const result = await mail.read({ uid: 3, uidValidity: '42' });
  assert.equal(result.mailbox, 'INBOX');
  assert.equal(result.uid, 3);
  assert.equal(result.uidValidity, '42');
  assert.equal(result.subject, '选课通知');
  assert.equal(result.text, '正文内容');
  assert.equal(result.truncated, false);
  assert.equal(result.messageId, '<abc@zju.edu.cn>');
  assert.equal(result.date, '2026-11-09T08:00:00.000Z');
  assert.deepEqual(result.from, [{ name: '教务', address: 'noreply@zju.edu.cn' }]);
  assert.deepEqual(result.cc, []);
  assert.deepEqual(result.attachments, [{ index: 0, filename: 'a.pdf', size: 3, contentType: 'application/pdf' }]);
  assert.equal(result.attachments[0].content, undefined, '清单里不许带附件正文');
});

test('read：超长正文被截断时 truncated=true（明说，不静默）', async () => {
  const long = 'x'.repeat(60_001);
  const { mail } = mailWith(simpleBox(), { parse: async () => fakeParsed({ text: long }) });
  const result = await mail.read({ uid: 3, uidValidity: '42' });
  assert.equal(result.text.length, 60_000);
  assert.equal(result.truncated, true);
});

test('read：没有正文时给可操作的一句话，而不是空串', async () => {
  const { mail } = mailWith(simpleBox(), { parse: async () => fakeParsed({ text: '' }) });
  const result = await mail.read({ uid: 3, uidValidity: '42' });
  assert.match(result.text, /网页版/);
  assert.equal(result.truncated, false);
});

test('read：UIDVALIDITY 对不上 → REJECTED（不打开错的邮件）', async () => {
  const { mail, calls } = mailWith(simpleBox(), { parse: async () => fakeParsed() });
  await assert.rejects(() => mail.read({ uid: 3, uidValidity: '41' }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /目录已发生变化/);
    return true;
  });
  assert.equal(calls.fetched.length, 0, '对不上一封都不该抓');
});

test('read：邮件不存在 / 超 25 MB / 解析失败 三种各有明确的码与文案', async () => {
  const missing = mailWith(simpleBox(), { parse: async () => fakeParsed() });
  await assert.rejects(() => missing.mail.read({ uid: 99, uidValidity: '42' }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /移动或删除/);
    return true;
  });

  const boxes = simpleBox();
  boxes.INBOX.messages[0].size = MAX_MESSAGE + 1;
  const huge = mailWith(boxes, { parse: async () => fakeParsed() });
  await assert.rejects(() => huge.mail.read({ uid: 3, uidValidity: '42' }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /25 MB/);
    return true;
  });

  const broken = mailWith(simpleBox(), { parse: async () => { throw new Error('bad mime'); } });
  await assert.rejects(() => broken.mail.read({ uid: 3, uidValidity: '42' }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /网页版/);
    return true;
  });

  const noAttachments = mailWith(simpleBox(), { parse: async () => ({ subject: 'x', text: 'y' }) });
  await assert.rejects(() => noAttachments.mail.read({ uid: 3, uidValidity: '42' }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /没有附件列表/);
    return true;
  });
});

test('download：真的落盘、文件名消毒、大小是字节数', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-mail-dl-'));
  const { mail } = mailWith(simpleBox(), {
    downloadRoot: root,
    parse: async () => fakeParsed({
      attachments: [
        { filename: '正常.pdf', size: 3, contentType: 'application/pdf', content: Buffer.from('abc') },
        { filename: '../../evil.sh', size: 5, contentType: 'text/plain', content: Buffer.from('hello') },
      ],
    }),
  });
  try {
    const first = await mail.download({ uid: 3, uidValidity: '42', index: 0 });
    assert.equal(first.filename, '正常.pdf');
    assert.equal(first.size, 3);
    assert.equal(fs.readFileSync(first.file, 'utf8'), 'abc');
    assert.equal(path.dirname(path.dirname(first.file)), path.join(root, 'mail'));
    assert.equal(fs.existsSync(first.file), true);

    // 路径穿越被挡住：落到某个 uuid 目录下，名字只剩 basename。
    const second = await mail.download({ uid: 3, uidValidity: '42', index: 1 });
    assert.equal(second.filename, 'evil.sh');
    assert.equal(path.basename(second.file), 'evil.sh');
    assert.equal(second.file.includes('..'), false);
    assert.notEqual(path.dirname(first.file), path.dirname(second.file), '每次下载独立目录，不覆盖已有文件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('download：下标越界 → REJECTED；没配下载根目录 → CONFIG', async () => {
  const { mail } = mailWith(simpleBox(), { parse: async () => fakeParsed({ attachments: [] }) });
  await assert.rejects(() => mail.download({ uid: 3, uidValidity: '42', index: 0 }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /没有找到这个附件/);
    return true;
  });

  const noRoot = new Mail({
    credentialProvider: async () => ({ address: 'a@zju.edu.cn', password: 'x'.repeat(16) }),
    imap: () => fakeImap(simpleBox()).client,
    downloadRoot: () => null,
    parse: async () => fakeParsed({ attachments: [{ filename: 'a', size: 1, content: Buffer.from('a') }] }),
  });
  await assert.rejects(() => noRoot.download({ uid: 3, uidValidity: '42', index: 0 }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /下载目录/);
    return true;
  });
});

/* ───────────────────────── 草稿（只读） ───────────────────────── */

/** 造一个合成的草稿文件（**不含真实邮件内容**）。 */
function writeDraft(dir, draft) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${draft.id}.json`), JSON.stringify(draft), 'utf8');
}

test('drafts：只给当前账号的，按 createdAt 倒序，附件不含正文', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-mail-drafts-'));
  const mine = createHash('sha256').update('a@zju.edu.cn').digest('hex');
  const other = createHash('sha256').update('b@zju.edu.cn').digest('hex');
  try {
    writeDraft(dir, { id: '11111111-1111-1111-1111-111111111111', accountId: mine, subject: '早', createdAt: '2026-11-01T00:00:00Z', attachments: [{ filename: 'x', size: 1, content: 'QQ==' }] });
    writeDraft(dir, { id: '22222222-2222-2222-2222-222222222222', accountId: mine, subject: '晚', createdAt: '2026-11-09T00:00:00Z', attachments: [] });
    writeDraft(dir, { id: '33333333-3333-3333-3333-333333333333', accountId: other, subject: '别人的', createdAt: '2026-11-10T00:00:00Z', attachments: [] });

    const { mail } = mailWith(simpleBox(), {
      draftDir: dir,
      credentialProvider: async () => ({ address: 'A@ZJU.EDU.CN', password: 'x'.repeat(16) }),
    });
    const result = await mail.drafts();
    assert.equal(result.drafts.length, 2, '别人的草稿不许出现');
    assert.deepEqual(result.drafts.map(d => d.subject), ['晚', '早']);
    assert.equal(result.drafts[1].attachments[0].content, undefined);
    assert.equal(typeof result.drafts[0].revision, 'string');
    assert.equal(result.drafts[0].revision.length, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('drafts：没有目录 → 空列表；没配 draftDir → CONFIG；坏文件 → SHAPE（不静默跳过）', async () => {
  const empty = mailWith(simpleBox(), { draftDir: path.join(os.tmpdir(), 'zhiyun-mail-not-here-xyz') });
  assert.deepEqual((await empty.mail.drafts()).drafts, []);

  const none = mailWith(simpleBox());
  await assert.rejects(() => none.mail.drafts(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /草稿目录/);
    return true;
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-mail-bad-'));
  try {
    fs.writeFileSync(path.join(dir, '44444444-4444-4444-4444-444444444444.json'), '{not json', 'utf8');
    const broken = mailWith(simpleBox(), { draftDir: dir });
    await assert.rejects(() => broken.mail.drafts(), (error) => {
      assert.equal(error.code, 'SHAPE');
      assert.match(error.message, /草稿文件损坏/);
      return true;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────────────────── test() / snapshot() ───────────────────────── */

test('test()：IMAP 只读开收件箱 + SMTP verify，从不发信', async () => {
  const verified = [];
  const { mail, calls } = mailWith(simpleBox(), {
    smtp: () => ({
      async verify() { verified.push('verify'); return true; },
      close() { verified.push('close'); },
    }),
  });
  const result = await mail.test();
  assert.deepEqual(result, { imap: true, smtp: true, address: '3200000000@zju.edu.cn' });
  assert.deepEqual(verified, ['verify', 'close'], 'verify 之后必须关掉 transport');
  assert.equal(calls.opened[0].options.readOnly, true);
  assert.equal(calls.loggedOut, 1);
  // 只读面的证据：SMTP 只调 verify，不调 sendMail。
  assert.equal(Object.keys(mail.smtpOptions({ address: 'a@b.c', password: 'p' })).includes('secure'), true);
});

test('test()：SMTP 认证失败仍然是 AUTH_EXPIRED（不是 UNREACHABLE）', async () => {
  const { mail } = mailWith(simpleBox(), {
    smtp: () => ({ async verify() { const e = new Error('bad'); e.code = 'EAUTH'; throw e; }, close() {} }),
  });
  await assert.rejects(() => mail.test(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.equal(error.details.phase, 'smtp');
    return true;
  });
});

test('snapshot()：不联网，反映 ready / address / servers', async () => {
  const off = new Mail();
  const offState = await off.snapshot();
  assert.equal(offState.ready, false);
  assert.equal(offState.connected, false);
  assert.equal(offState.address, '');
  assert.equal(offState.busy, false);
  assert.equal(offState.servers, ZJU_MAIL);

  const on = new Mail({ credentialProvider: async () => ({ address: 'a@zju.edu.cn', password: 'x'.repeat(16) }) });
  const onState = await on.snapshot();
  assert.equal(onState.ready, true);
  assert.equal(onState.connected, true);
  assert.equal(onState.address, 'a@zju.edu.cn');
  assert.equal(onState.error, null);
});

test('snapshot()：凭据暂时取不到时整体不失败，但把原因带出去', async () => {
  const mail = new Mail({ credentialProvider: async () => { throw new Error('keychain locked'); } });
  const state = await mail.snapshot();
  assert.equal(state.ready, true);
  assert.equal(state.connected, false);
  assert.equal(state.error.code, 'CONFIG');
  // message 是给用户看的可操作文案……
  assert.match(state.error.message, /客户端专用密码/);
  // ……reason 是原始原因，排查时不能丢。
  assert.match(state.error.reason, /keychain locked/);
});

/* ───────────────────────── 集成层：apply() ───────────────────────── */

/**
 * 造一个最小的 cordis 风格 ctx，**有 `effect` / `provide` / `inject` / `get`**。
 *
 * @returns `{ ctx, services, routes, disposed }`。
 */
function fakeCtx(profileDir = null) {
  const services = new Map();
  const routes = [];
  const disposed = [];
  const ctx = {
    effect(fn) { const dispose = fn() ?? (() => {}); return () => { disposed.push(1); dispose(); }; },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    get(name) { return name === 'profileContext' && profileDir !== null ? { dir: profileDir } : undefined; },
    inject(names, callback) {
      const scope = { webServer: { register(entry) { routes.push(entry); return () => { routes.length = 0; }; } } };
      callback(scope);
    },
  };
  return { ctx, services, routes, disposed };
}

/** 装配一次，返回服务面。 */
function mount(config = {}, profileDir = null) {
  const { ctx, services, routes, disposed } = fakeCtx(profileDir);
  const dispose = apply(ctx, config);
  return { mail: services.get('zhiyunMail'), routes, services, disposed, dispose };
}

test('apply()：provide zhiyunMail + 注册 /api/zhiyun-mail', () => {
  const { mail, routes } = mount();
  assert.ok(mail, '必须 provide zhiyunMail');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/api/zhiyun-mail');
  assert.equal(ROUTE_PATH, '/api/zhiyun-mail');
  assert.equal(mail.readOnly, true);
  assert.equal(mail.platform, 'mail');
  assert.equal(mail.routePath, ROUTE_PATH);
});

test('apply()：methods 里每一条都有对应的路由动作（这是此前真错的形状）', () => {
  const { mail } = mount();
  const actions = mail.actions();
  assert.equal(METHODS.length, 8);
  for (const method of METHODS) {
    assert.equal(typeof actions[method], 'function', `methods 里的 ${method} 在路由动作表里不存在`);
  }
  assert.deepEqual(Object.keys(actions).sort(), [...METHODS].sort());
  // 方法与 service 上的短名逐一对得上：`mail.list` → `service.list`
  for (const method of METHODS) {
    const short = method.slice('mail.'.length);
    assert.equal(typeof mail[short], 'function', `service.${short} 不存在`);
  }
});

test('apply()：服务面的只读方法都在，写方法一个都没有', () => {
  const { mail } = mount();
  for (const readonly of ['folders', 'list', 'inbox', 'read', 'download', 'drafts', 'test', 'snapshot']) {
    assert.equal(typeof mail[readonly], 'function', `缺少只读方法 ${readonly}`);
  }
  for (const write of ['send', 'prepare', 'updateDraft', 'removeDraft', 'connect', 'disconnect']) {
    assert.equal(mail[write], undefined, `${write} 属于写操作，不该出现在本包`);
  }
});

test('路由：未知 action 返回 ok:false + CONFIG，文案里列出可用动作', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /不认识的操作/);
      assert.match(parsed.error.message, /mail\.list/);
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'mail.send' })), res);
});

test('路由：空 action 也报「不认识的操作」而不是崩', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /\(空\)/);
    },
  };
  await routes[0].handler(makeReq(''), res);
});

test('路由：mail.snapshot 在没接凭据时也成功（不联网）', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.value.ready, false);
      assert.equal(parsed.value.servers.imap.port, 993);
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'mail.snapshot' })), res);
});

test('路由：mail.list 没接凭据时返回 ok:false + CONFIG（不是 500，也不是白屏）', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'mail.list', input: {} })), res);
});

test('路由：非法 JSON 体返回 ok:false 而不是抛到宿主', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(typeof parsed.error.message, 'string');
    },
  };
  await routes[0].handler(makeReq('{oops'), res);
});

test('apply() 注入假 IMAP 后，整条链路离线走得通（路由 → list → 具体值）', async () => {
  const { client, calls } = fakeImap(simpleBox());
  const { mail, routes } = mount({ imap: () => client });
  mail.setCredentialProvider(async () => ({ address: '3200000000@zju.edu.cn', password: 'abcDEF1234567890' }));

  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, true);
      assert.deepEqual(parsed.value.messages.map(m => m.uid), [3, 2, 1]);
      assert.equal(parsed.value.total, 3);
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'mail.list', input: { limit: 5 } })), res);
  assert.equal(calls.opened[0].options.readOnly, true);
  assert.equal(calls.loggedOut, 1);
});

test('apply()：profileContext 决定草稿目录；没有它时 drafts 明确报 CONFIG', async () => {
  const profileDir = path.join(os.tmpdir(), 'zhiyun-mail-profile-xyz');
  const withProfile = mount({}, profileDir);
  assert.equal(withProfile.mail.draftDir, path.join(profileDir, 'data', 'zhiyun-mail', 'outbox'));

  const withoutProfile = mount();
  assert.equal(withoutProfile.mail.draftDir, null);
  await assert.rejects(() => withoutProfile.mail.drafts(), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('apply()：卸载会收回服务与路由', () => {
  const { dispose, services, routes } = mount();
  assert.equal(services.has('zhiyunMail'), true);
  assert.equal(routes.length, 1);
  dispose();
  assert.equal(services.has('zhiyunMail'), false);
  assert.equal(routes.length, 0);
});

/* ───────────────────────── 夹具 ───────────────────────── */

/**
 * 造一个最小的请求对象：两个事件都注册好之后再触发。
 *
 * @param body - 请求体。
 * @returns 事件发射器形状的对象。
 */
function makeReq(body) {
  const handlers = new Map();
  const req = {
    on(event, fn) {
      handlers.set(event, fn);
      if (handlers.has('data') && handlers.has('end') && !req.scheduled) {
        req.scheduled = true;
        setImmediate(() => {
          handlers.get('data')?.(Buffer.from(body, 'utf8'));
          handlers.get('end')?.();
        });
      }
      return req;
    },
  };
  return req;
}

test('默认超时是具体数字，不是 undefined（IMAP 必须有超时）', () => {
  assert.equal(DEFAULT_TIMEOUTS.connectMs, 15_000);
  assert.equal(DEFAULT_TIMEOUTS.operationMs, 60_000);
  const mail = new Mail({ timeouts: { connectMs: 1234 } });
  assert.equal(mail.imapOptions({ address: 'a@zju.edu.cn', password: 'p' }).connectionTimeout, 1234);
  // greetingTimeout 不超过 connectMs
  assert.equal(mail.imapOptions({ address: 'a@zju.edu.cn', password: 'p' }).greetingTimeout, 1234);
});
