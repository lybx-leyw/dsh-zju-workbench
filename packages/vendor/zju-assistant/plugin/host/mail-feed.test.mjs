import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Mail } from './mail.mjs'
import { MailFeed, CHECK_MS, CHECK_RETRY_MS } from './mail-feed.mjs'

const PASSWORD = 'testPassword1234'
const MIME = Buffer.from('From: Teacher <teacher@example.com>\r\nTo: student@zju.edu.cn\r\nSubject: Week 6\r\nDate: Sat, 17 Oct 2026 09:00:00 +0800\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease revise the plan.\r\n')

/**
 * 一个假的收件箱：box.uids 是现在有的邮件，uidValidity 是目录标识。每次打开都检查是只读的，记下每次的搜索条件和取了哪些。
 * 合成的邮件，不连真实邮箱。
 */
function fixture(t, { uids = [1, 2, 3] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-mail-feed-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const box = { uids: [...uids], uidValidity: 9n, searches: [], fetched: [], flagChanges: 0, sources: 0 }
  const state = { disabled: [], at: Date.parse('2026-10-18T10:00:00+08:00') }
  const mail = new Mail({
    file: path.join(root, 'profile', 'mail.json'), plugins: { disabled: () => state.disabled },
    vault: { seal: async () => 'sealed', open: async () => PASSWORD }, downloads: { root: async () => path.join(root, 'downloads') },
    smtp: () => ({ close() {}, async verify() {} }),
    imap: () => ({
      on() {}, close() {}, async connect() {},
      async mailboxOpen(name, options) { assert.equal(name, 'INBOX'); assert.equal(options.readOnly, true); return { uidValidity: box.uidValidity } },
      async search(query, options) {
        assert.equal(options.uid, true); box.searches.push(query)
        if (query.all) return [...box.uids]
        // 和真的 IMAP 一样：n:* 总会带上最新的一封，哪怕它比 n 小。
        const from = Number(query.uid.split(':')[0]), found = box.uids.filter(uid => uid >= from)
        return found.length ? found : box.uids.slice(-1)
      },
      async *fetch(range, query, options) {
        assert.equal(options.uid, true); assert.equal(query.source, undefined); assert.equal(query.flags, undefined)
        const list = range.split(',').map(Number); box.fetched.push(list)
        for (const uid of list) yield { uid, envelope: { subject: `Mail ${uid}`, from: [{ name: `Sender ${uid}`, address: `s${uid}@example.com` }], date: new Date(Date.UTC(2026, 9, 1) + uid * 60_000) }, internalDate: new Date(Date.UTC(2026, 9, 2) + uid * 60_000) }
      },
      async fetchOne(_uid, query) { if (query.source) { box.sources++; return { source: MIME } } return { size: MIME.length } },
      async messageFlagsAdd() { box.flagChanges++ }, async messageFlagsSet() { box.flagChanges++ },
    }),
  })
  // onNew 收到的每一批（托盘的提醒）记在 alerts 里。
  const alerts = []
  const feed = new MailFeed({ mail, file: path.join(root, 'cache', 'mail-feed.json'), now: () => state.at, onNew: items => { alerts.push(items.map(item => item.uid)) } })
  return { mail, feed, box, state, alerts }
}

test('第一次连上只取最近一页当基线，不当成刚收到的；之后按 UID 只取新来的，n:* 带回的旧邮件不重复', async t => {
  const { mail, feed, box, state } = fixture(t, { uids: Array.from({ length: 30 }, (_, i) => i + 1) })
  assert.equal(feed.snapshot().source.state, 'account')
  await mail.connect({ address: 'student@zju.edu.cn', password: PASSWORD })
  const first = await feed.refresh()
  assert.equal(first.items.length, 20)
  assert.equal(first.items[0].uid, 30)
  // 基线里的出现时间是邮件自己收到的时间，不是现在。
  assert.ok(first.items.every(item => item.foundAt === item.at && Date.parse(item.at) < state.at))
  assert.match(first.items[0].id, /^mail:[0-9a-f]{16}:INBOX:9:30$/)
  // 没有新邮件时，n:* 返回最后那一封，不能当成新的再加一次。
  state.at += 6 * 60_000
  const same = await feed.refresh()
  assert.equal(same.items.length, 20)
  assert.deepEqual(box.searches.at(-1), { uid: '31:*' })
  box.uids.push(31, 32)
  state.at += 6 * 60_000
  const next = await feed.refresh()
  assert.deepEqual(next.items.slice(0, 2).map(item => [item.uid, item.foundAt]), [[32, new Date(state.at).toISOString()], [31, new Date(state.at).toISOString()]])
  // 自始至终只读打开、不碰标记，也不读正文。
  assert.equal(box.flagChanges, 0)
  assert.equal(box.sources, 0)
})

test('一次来了好几页新邮件：分批取完，一封不漏；刚读过的五分钟内不重读，点刷新照读', async t => {
  const { mail, feed, box } = fixture(t, { uids: [1, 2] })
  await mail.connect({ address: 'student@zju.edu.cn', password: PASSWORD })
  await feed.refresh()
  for (let uid = 3; uid <= 452; uid++) box.uids.push(uid)
  await feed.refresh()
  assert.equal(feed.snapshot().items.length, 2, '刚读过，不重读')
  const after = await feed.refresh({ force: true })
  assert.equal(after.items.length, 300, '只留最近的 300 封')
  assert.equal(after.items[0].uid, 452)
  assert.equal(feed.load().last, 452)
  // 每次最多取 200 封，分了三批。
  assert.deepEqual(box.fetched.slice(-3).map(list => [list[0], list.at(-1)]), [[3, 202], [203, 402], [403, 452]])
  assert.equal(after.source.error, null)
})

test('目录标识变了就重新建基线，旧编号的条目不再给，也不会拿旧编号打开错信', async t => {
  const { mail, feed, box, state } = fixture(t, { uids: [5, 6] })
  await mail.connect({ address: 'student@zju.edu.cn', password: PASSWORD })
  const before = await feed.refresh()
  const old = before.items[0]
  box.uidValidity = 10n
  box.uids = [1, 2, 3]
  state.at += 6 * 60_000
  const after = await feed.refresh()
  assert.deepEqual(after.items.map(item => item.uid), [3, 2, 1])
  assert.ok(after.items.every(item => item.uidValidity === '10'))
  // 旧的那一条拿去读，mail.read 自己会拒绝。
  await assert.rejects(mail.read({ mailbox: old.mailbox, uid: old.uid, uidValidity: old.uidValidity }), /重新查询/)
})

test('关掉插件、断开、换账号：旧账号的邮件都不给页面；认证失败时留着原来的并说明原因', async t => {
  const { mail, feed, state } = fixture(t, { uids: [1] })
  await mail.connect({ address: 'student@zju.edu.cn', password: PASSWORD })
  await feed.refresh()
  assert.equal(feed.snapshot().items.length, 1)
  state.disabled = ['zju-mail']
  assert.deepEqual([feed.snapshot().items.length, feed.snapshot().source.state], [0, 'off'])
  state.disabled = []
  assert.equal(feed.snapshot().items.length, 1)
  // 读的时候连不上：原来的留着，说明原因。
  mail.imap = () => ({ on() {}, close() {}, async connect() { throw { authenticationFailed: true } } })
  state.at += 6 * 60_000
  const failed = await feed.refresh()
  assert.equal(failed.items.length, 1)
  assert.match(failed.source.error, /认证失败/)
  mail.disconnect()
  assert.deepEqual([feed.snapshot().items.length, feed.snapshot().source.state], [0, 'account'])
  // 换了一个邮箱：上一个账号的缓存不给。
  mail.imap = () => ({ on() {}, close() {}, async connect() {}, async mailboxOpen() { return { uidValidity: 1n } }, async search() { return [] }, async *fetch() {} })
  await mail.connect({ address: 'other@zju.edu.cn', password: PASSWORD })
  assert.equal(feed.snapshot().items.length, 0)
})

test('后台定时：基线不提醒，之后新到的信一趟合成一次提醒；十五分钟读一次，认证失败以后隔半小时，插件关着不读', async t => {
  const { mail, feed, box, state, alerts } = fixture(t, { uids: [1, 2] })
  await mail.connect({ address: 'student@zju.edu.cn', password: PASSWORD })
  await feed.check()
  assert.equal(feed.snapshot().items.length, 2)
  assert.deepEqual(alerts, [], '第一次连上的基线不当成刚收到的')
  box.uids.push(3, 4)
  state.at += CHECK_MS - 60_000
  await feed.check()
  assert.equal(feed.snapshot().items.length, 2, '没到点不读')
  state.at += 60_000
  await feed.check()
  assert.deepEqual(alerts, [[4, 3]], '两封合成一次，从新到旧')
  // 再读一趟没有新的：不再提醒。
  state.at += CHECK_MS
  await feed.check()
  assert.equal(alerts.length, 1)
  // 目录重建也是基线，不提醒。
  box.uidValidity = 10n
  box.uids = [7, 8]
  state.at += CHECK_MS
  await feed.check()
  assert.deepEqual([feed.snapshot().items.map(item => item.uid), alerts.length], [[8, 7], 1])
  // 专用密码失效：半小时内不再去登录。
  let attempts = 0
  mail.imap = () => ({ on() {}, close() {}, async connect() { attempts++; throw { authenticationFailed: true } } })
  state.at += CHECK_MS
  await feed.check()
  state.at += CHECK_RETRY_MS - 60_000
  await feed.check()
  assert.equal(attempts, 1)
  state.at += 60_000
  await feed.check()
  assert.equal(attempts, 2)
  state.disabled = ['zju-mail']
  state.at += CHECK_RETRY_MS
  await feed.check()
  assert.equal(attempts, 2)
  assert.equal(alerts.length, 1)
})
