import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cc98Feed, fromCc98, CHECK_MS, CHECK_RETRY_MS } from './cc98-feed.mjs'

const ACCOUNTS = { zju_username: '3250100000', zju_password: 'x', webvpn_username: 'a', webvpn_password: 'b', cc98_username: 'alice', cc98_password: 'p1' }
const reply = (id, minute = id) => ({ id, time: '2026-10-18 09:00', at: new Date(Date.UTC(2026, 9, 18, 1, 0) + minute * 60_000).toISOString(), from: `user${id}`, topic: '选课咨询', floor: 3, content: `回复 ${id}`, url: `https://www.cc98.org/topic/100#${id}`, read: false })

/**
 * 假的 `cc98 account notifications`：server 里放着每个账号各类消息（新的在前），按 --kind、--from、--size 分页；记下每次调的参数。
 * 合成的消息，不连论坛。
 */
function fixture(t, { accounts = ACCOUNTS, server = { alice: { reply: [], at: [], system: [], message: [] } } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-cc98-feed-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const state = { accounts, disabled: [], at: Date.parse('2026-10-18T10:00:00+08:00'), calls: [], fail: null, alerts: [] }
  const feed = new Cc98Feed({
    file: path.join(root, 'cache', 'cc98.json'), account: { read: () => ({ data: state.accounts }) }, plugins: { disabled: () => state.disabled }, now: () => state.at,
    // onNew 收到的每一批（托盘的提醒）只记标题。
    onNew: items => { state.alerts.push(items.map(item => item.title)) },
    run: async (args) => {
      state.calls.push(args)
      assert.deepEqual(args.slice(0, 3), ['cc98', 'account', 'notifications'])
      // 后台只用这一条，不碰会把私信标成已读的 private-message。
      assert.ok(!args.includes('private-message'))
      if (state.fail) throw new Error(state.fail)
      const flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
      const box = server[flag('--account')], size = Number(flag('--size') ?? 10), from = Number(flag('--from') ?? 0), kind = flag('--kind')
      if (kind) return { kind, items: box[kind].slice(from, from + size) }
      const groups = ['reply', 'at', 'system'].map(type => ({ kind: type, items: box[type].slice(0, size) }))
      if (box.message.length) groups.push({ kind: 'message', items: box.message })
      return { unread: {}, groups }
    },
  })
  return { feed, state, server }
}

test('回复、@、系统消息和私信摘要各自成一行；编号缺了的不要，私信不编网页链接', () => {
  const foundAt = '2026-10-18T02:00:00.000Z'
  assert.equal(fromCc98(reply(1), 'reply', 'alice', foundAt).title, 'user1回复了「选课咨询」')
  assert.equal(fromCc98({ ...reply(2), from: 'bob' }, 'at', 'alice', foundAt).title, 'bob在「选课咨询」里 @ 了你')
  assert.equal(fromCc98({ id: 3, at: foundAt, title: '账号安全提醒', content: '…' }, 'system', 'alice', foundAt).title, '账号安全提醒')
  const message = fromCc98({ userId: 42, at: foundAt, from: 'carol', content: '周六打球吗' }, 'message', 'alice', foundAt)
  assert.deepEqual([message.id, message.title, message.url, message.body], ['cc98:alice:message:42:2026-10-18T02:00:00.000Z', 'carol发来私信', '', '周六打球吗'])
  assert.equal(fromCc98({ time: '2026-10-18 10:00', content: '没有编号' }, 'reply', 'alice', foundAt), undefined)
  assert.equal(fromCc98({ ...reply(4), url: 'https://evil.example/x' }, 'reply', 'alice', foundAt).url, '')
})

test('第一次只记最近一页当基线；之后一页全是新的就往后翻，一条不漏，重复刷新不重复', async t => {
  const box = { reply: Array.from({ length: 25 }, (_, i) => reply(100 - i)), at: [], system: [], message: [] }
  const { feed, state } = fixture(t, { server: { alice: box } })
  const first = await feed.refresh()
  assert.equal(first.items.length, 20)
  // 基线里的出现时间是消息自己的时间，页面不把它们当成新来的。
  assert.ok(first.items.every(item => item.foundAt === item.at))
  assert.equal(state.calls.length, 1)
  // 来了 45 条新回复：第一页全是新的，往后翻两页才碰到见过的。
  box.reply.unshift(...Array.from({ length: 45 }, (_, i) => reply(200 - i, 200 - i)))
  state.at += 11 * 60_000
  const second = await feed.refresh()
  const ids = new Set(second.items.map(item => item.id))
  for (let id = 156; id <= 200; id++) assert.ok(ids.has(`cc98:alice:reply:${id}`), `回复 ${id} 不能漏`)
  assert.deepEqual(state.calls.slice(1).map(args => args.slice(3)), [
    ['--account', 'alice', '--size', '20'],
    ['--account', 'alice', '--kind', 'reply', '--from', '20', '--size', '20'],
    ['--account', 'alice', '--kind', 'reply', '--from', '40', '--size', '20'],
  ])
  assert.ok(second.items.filter(item => Number(item.id.split(':').at(-1)) > 155).every(item => item.foundAt === new Date(state.at).toISOString()))
  state.at += 11 * 60_000
  const third = await feed.refresh()
  assert.equal(third.items.length, second.items.length)
  assert.equal(new Set(third.items.map(item => item.id)).size, third.items.length)
})

test('一次多到翻不完时照实说没读全；中途出错不推进，下一趟从头补上', async t => {
  const box = { reply: [reply(1)], at: [], system: [], message: [] }
  const { feed, state } = fixture(t, { server: { alice: box } })
  await feed.refresh()
  box.reply.unshift(...Array.from({ length: 100 }, (_, i) => reply(500 - i, 500 - i)))
  state.at += 11 * 60_000
  const overflow = await feed.refresh()
  assert.match(overflow.source.error, /超过 80 条/)
  // 中途出错：这一趟一条都不记，下一趟照样从第一页翻到见过的为止。
  box.reply.unshift(...Array.from({ length: 30 }, (_, i) => reply(900 - i, 900 - i)))
  state.fail = 'CC98 一直没有回应'
  state.at += 11 * 60_000
  const failed = await feed.refresh()
  assert.match(failed.source.error, /没有回应/)
  assert.ok(!failed.items.some(item => item.id === 'cc98:alice:reply:900'))
  state.fail = null
  state.at += 6 * 60_000
  const healed = await feed.refresh()
  for (let id = 871; id <= 900; id++) assert.ok(healed.items.some(item => item.id === `cc98:alice:reply:${id}`))
  assert.equal(healed.source.error, null)
})

test('两个账号各读各的；删掉的账号连缓存一起不给；插件关着或账号没填不读', async t => {
  const server = {
    alice: { reply: [reply(1)], at: [], system: [], message: [{ userId: 7, at: '2026-10-18T01:30:00.000Z', time: '2026-10-18 09:30', from: 'dave', content: '在吗', read: false }] },
    bob: { reply: [], at: [], system: [{ id: 9, at: '2026-10-18T01:00:00.000Z', time: '2026-10-18 09:00', title: '欢迎', content: 'hi', read: true }], message: [] },
  }
  const { feed, state } = fixture(t, { server, accounts: { ...ACCOUNTS, cc98_username_2: 'bob', cc98_password_2: 'p2' } })
  const both = await feed.refresh()
  assert.deepEqual(both.items.map(item => item.account).sort(), ['alice', 'alice', 'bob'])
  assert.ok(both.items.some(item => item.cc98Kind === 'message' && item.title === 'dave发来私信'))
  state.accounts = { ...ACCOUNTS }
  assert.deepEqual(feed.snapshot().items.map(item => item.account), ['alice', 'alice'])
  await feed.refresh({ force: true })
  assert.deepEqual(Object.keys(feed.load().accounts), ['alice'])
  state.disabled = ['zju-community']
  const calls = state.calls.length
  assert.deepEqual([(await feed.refresh({ force: true })).items.length, feed.snapshot().source.state], [0, 'off'])
  state.disabled = []
  state.accounts = { ...ACCOUNTS, cc98_password: '' }
  assert.equal((await feed.refresh({ force: true })).source.state, 'account')
  assert.equal(state.calls.length, calls)
})

test('后台定时：基线不提醒；两个账号这一趟新来的合成一次提醒；十五分钟读一次，出错以后隔半小时，插件关着不读', async t => {
  const server = { alice: { reply: [reply(1)], at: [], system: [], message: [] }, bob: { reply: [], at: [], system: [], message: [] } }
  const { feed, state } = fixture(t, { server, accounts: { ...ACCOUNTS, cc98_username_2: 'bob', cc98_password_2: 'p2' } })
  await feed.check()
  assert.deepEqual([state.alerts, state.calls.length], [[], 2], '第一次读的基线不提醒')
  server.alice.reply.unshift(reply(2, 30))
  server.bob.message.push({ userId: 7, at: '2026-10-18T01:40:00.000Z', time: '2026-10-18 09:40', from: 'dave', content: '在吗', read: false })
  state.at += CHECK_MS - 60_000
  await feed.check()
  assert.equal(state.calls.length, 2, '没到点不读')
  state.at += 60_000
  await feed.check()
  // 两个账号的合成一次，从新到旧；私信只说谁发来的。
  assert.deepEqual(state.alerts, [['dave发来私信', 'user2回复了「选课咨询」']])
  state.at += CHECK_MS
  await feed.check()
  assert.equal(state.alerts.length, 1, '没有新的不再提醒')
  // 读不了：半小时内不再去登录。
  state.fail = 'CC98 一直没有回应'
  state.at += CHECK_MS
  await feed.check()
  const calls = state.calls.length
  state.at += CHECK_RETRY_MS - 60_000
  await feed.check()
  assert.equal(state.calls.length, calls)
  state.at += 60_000
  await feed.check()
  assert.equal(state.calls.length, calls + 2)
  state.disabled = ['zju-community']
  state.at += CHECK_RETRY_MS
  await feed.check()
  assert.deepEqual([state.calls.length, state.alerts.length], [calls + 2, 1])
})
