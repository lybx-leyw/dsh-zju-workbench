import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChatWatch, messageText, batches, deadlineOf, parseMatters, summaryPrompt } from './chat-watch.mjs'

function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-chat-watch-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const world = {
    at: Date.parse('2026-10-16T10:00:00+08:00'),
    disabled: [],
    messages: [],
    calls: [],
    running: true,
    alerts: [],
    ...extra
  }
  const value = (args, key) => args[args.indexOf(key) + 1]
  const run = async (platform, args, options) => {
    world.calls.push(args)
    if (world.hold) await world.hold(options.signal, args)
    if (args[0] === 'status') return { ok: true, running: world.running }
    if (args[1] === 'info')
      return {
        ok: true,
        profile: 'account-a',
        chat: { id: 'group', name: '年级群', kind: 'group', ownerId: 'owner' }
      }
    if (args[1] === 'read') {
      if (world.fail) return { ok: false, status: 'database_busy', message: '数据库忙' }
      const since = Date.parse(value(args, '--since')),
        until = Date.parse(value(args, '--until')),
        offset = args.includes('--cursor') ? Number(value(args, '--cursor')) : 0
      const eligible = world.messages
        .filter((m) => Date.parse(m.sentAt) >= since && Date.parse(m.sentAt) < until)
        .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.id.localeCompare(b.id))
      const size = world.pageSize || 500,
        next = offset + size
      if (world.failOffset === offset) return { ok: false, status: 'database_busy', message: '第二页读取失败' }
      return {
        ok: true,
        ...(world.partial ? { partial: true, skippedShards: 1 } : {}),
        messages: eligible.slice(offset, next),
        hasMore: next < eligible.length,
        nextCursor: next < eligible.length ? String(next) : null
      }
    }
    if (args[1] === 'members')
      return { ok: true, members: world.members || [], hasMore: false, nextCursor: null }
    return { ok: true, chats: [] }
  }
  const service = new ChatWatch({
    platform: 'wechat',
    plugins: { disabled: () => world.disabled },
    settingsFile: path.join(root, 'settings.json'),
    cacheFile: path.join(root, 'cache.json'),
    run,
    now: () => world.at,
    ask: async (input) => {
      world.asked = input
      ;(world.asks ??= []).push(input)
      if (world.askError) throw Error('model unavailable')
      return typeof world.answer === 'function' ? world.answer(input) : world.answer ?? JSON.stringify({ 事项: [{ 事项: '提交材料', 要做什么: '把材料交给辅导员', 截止: '', 截止原文: '', 时间地点: '', 发送者: 'owner', 消息: [1, 2] }] })
    },
    ...extra.options,
    schedule: (fn) => {
      world.timer = fn
      return 5
    },
    cancel: (id) => {
      world.cancelled = id
    },
    onNew: (alert) => world.alerts.push(alert)
  })
  t.after(() => service.dispose())
  const message = (id, offset = 1000, sender = 'owner', text = '原文\n  保留空格') => ({
    id,
    chatId: 'group',
    sentAt: new Date(Date.parse('2026-10-16T10:00:00+08:00') + offset).toISOString(),
    sender: { id: sender, name: sender },
    type: 'text',
    text
  })
  const add = async () => {
    await service.add({ id: 'group' })
    return service.settings().tracks[0]
  }
  return { world, service, message, add, root }
}
test('only messages after selection, all pages, stable ids and restart deduplication', async (t) => {
  const { world, service, message, add } = fixture(t, { pageSize: 2 })
  await add()
  world.messages = [message('old', -1000), ...Array.from({ length: 7 }, (_, i) => message('m' + i, 1000 + i))]
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 7)
  assert.equal(world.alerts.length, 1)
  assert.equal(world.calls.filter((a) => a[1] === 'read').length, 4)
  assert.equal(service.notices()[0].body, '原文\n  保留空格')
  service.memory = null
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 7)
  assert.equal(world.alerts.length, 1)
  assert.ok(world.calls.filter((a) => a[1] === 'read').every((a) => a.includes('--until')))
})
test('a sync waits behind a chat lookup instead of being dropped, and only the sync counts as syncing', async (t) => {
  const { world, service, add } = fixture(t)
  await add()
  let release
  const gate = new Promise((resolve) => (release = resolve))
  world.hold = (signal, args) => (args[1] === 'list' ? gate : undefined)
  const finding = service.find({})
  assert.equal(service.snapshot().busy, true)
  assert.equal(service.snapshot().syncing, false, 'looking up chats is not a sync')
  const synced = service.refresh(),
    again = service.refresh()
  assert.equal(service.snapshot().syncing, true)
  release()
  await finding
  const [first, second] = await Promise.all([synced, again])
  assert.equal(world.calls.filter((a) => a[0] === 'status').length, 1, 'a second click joins the pending sync')
  assert.ok(world.calls.findIndex((a) => a[0] === 'status') > world.calls.findIndex((a) => a[1] === 'list'))
  assert.equal(first.syncing, false, 'the result of a sync already says it is over')
  assert.equal(second.syncing, false)
  assert.equal(service.snapshot().busy, false)
})
test('a chosen chat data folder is checked before it is saved, then every read goes there', async (t) => {
  const calls = []
  const run = async (platform, args, { dataDir }) => {
    calls.push({ op: args[0] === 'chat' ? args[1] : args[0], dataDir })
    if (args[0] === 'profiles') {
      if (dataDir === 'D:\\微信') return { ok: true, profiles: [{ id: 'wxid_a', path: 'D:\\微信\\xwechat_files\\wxid_a' }] }
      if (dataDir === 'D:\\两个') return { ok: true, profiles: [{ id: 'a', path: 'D:\\两个\\a' }, { id: 'b', path: 'D:\\两个\\b' }] }
      return dataDir
        ? { ok: false, status: 'wechat_folder_unrecognized', message: '这个文件夹里没有微信聊天数据。' }
        : { ok: false, status: 'wechat_database_missing', message: '未找到本机微信的聊天数据。' }
    }
    if (args[0] === 'status') return { ok: true, running: false }
    return { ok: true, chats: [], hasMore: false, nextCursor: null }
  }
  const { service } = fixture(t, { options: { run } })
  assert.deepEqual(await service.location(), { dataDir: '', folder: '', error: '未找到本机微信的聊天数据。' })

  service.save({ error: '未找到本机微信的聊天数据。' })
  await assert.rejects(service.relocate({ dataDir: 'D:\\空的' }), /没有微信聊天数据/)
  await assert.rejects(service.relocate({ dataDir: 'D:\\两个' }), /2 个微信账号/)
  await assert.rejects(service.relocate({ dataDir: '微信' }), /完整路径/)
  assert.equal(service.settings().dataDir, '', 'a folder that cannot be read is not saved')

  assert.deepEqual(await service.relocate({ dataDir: ' D:\\微信 ' }), { dataDir: 'D:\\微信', folder: 'D:\\微信\\xwechat_files\\wxid_a', error: null })
  assert.equal(service.settings().dataDir, 'D:\\微信')
  await service.find({})
  assert.equal(service.cache().error, null, 'the old not-found error is dropped')
  assert.ok(calls.some((c) => c.op === 'status' && c.dataDir === 'D:\\微信'), 'saving starts a sync from the new folder')
  assert.deepEqual(calls.at(-1), { op: 'list', dataDir: 'D:\\微信' })

  // 改回自动查找：自动也找不到时照样保存，只把原因交回去。
  assert.deepEqual(await service.relocate({ dataDir: '' }), { dataDir: '', folder: '', error: '未找到本机微信的聊天数据。' })
  assert.equal(service.settings().dataDir, '')
})
test('the DingTalk data location is the folder holding its accounts', async (t) => {
  const run = async (platform, args, { dataDir }) =>
    args[0] === 'profiles' ? { ok: true, root: dataDir || 'C:\\Users\\a\\AppData\\Roaming\\DingTalk', profiles: [{ id: 'a_v3', uid: '1' }] } : { ok: true, running: false }
  const { service } = fixture(t, { options: { run, platform: 'dingtalk' } })
  assert.deepEqual(await service.location(), { dataDir: '', folder: 'C:\\Users\\a\\AppData\\Roaming\\DingTalk', error: null })
  assert.deepEqual(await service.relocate({ dataDir: 'E:\\DingTalk' }), { dataDir: 'E:\\DingTalk', folder: 'E:\\DingTalk', error: null })
})
test('closed client skips reads; failed pagination retains progress and retries', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  world.messages = [message('one')]
  world.at += 60_000
  world.running = false
  await service.refresh()
  assert.equal(world.calls.filter((a) => a[1] === 'read').length, 0)
  assert.equal(service.cache().states[track.key], undefined)
  world.running = true
  world.fail = true
  await service.refresh()
  assert.equal(service.cache().states[track.key].checkedAt, undefined)
  assert.match(service.snapshot().tracks[0].error, /忙/)
  world.fail = false
  await service.refresh()
  assert.equal(service.notices().length, 1)
  assert.equal(service.snapshot().tracks[0].error, null)
})
test('member picker lists recent speakers first and fills nameless members from their messages', async (t) => {
  const { world, service, message } = fixture(t)
  // 本机名单里一半人只有一串数字；发过言的人的名字在消息里。
  world.members = [{ id: '1020322064', name: '1020322064' }, { id: 'owner', name: '王老师', isOwner: true }, { id: 'quiet', name: '不说话的人' }]
  world.messages = [
    message('a', -60_000, '1020322064'), message('b', -50_000, '1020322064'), message('c', -40_000, 'owner'),
    { ...message('d', -30_000, 'self'), isSelf: true }, message('e', -20_000, '987654')
  ].map((m) => (m.sender.id === '1020322064' ? { ...m, sender: { id: m.sender.id, name: '李助教' } } : m.sender.id === '987654' ? { ...m, sender: { id: '987654', name: '987654' } } : m))
  const page = await service.members({ id: 'group' })
  assert.deepEqual(page.recent.map((p) => [p.id, p.name, p.count]), [['1020322064', '李助教', 2], ['owner', 'owner', 1]])
  assert.equal(page.recent[1].isOwner, true)
  assert.deepEqual(page.members.map((p) => p.name), ['李助教', '王老师', '不说话的人'])
  // 搜索时最近发言的人也按名字参与匹配；翻页时不再重复列。
  assert.deepEqual((await service.members({ id: 'group', query: '助教' })).recent.map((p) => p.id), ['1020322064'])
  assert.deepEqual((await service.members({ id: 'group', cursor: '100' })).recent, [])
  // 读消息失败不耽误列成员。
  world.fail = true
  assert.equal((await service.members({ id: 'group' })).members.length, 3)
})
test('a partial read (an old WeChat shard could not be decrypted) keeps progress and retries later', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  world.messages = [message('one')]
  world.at += 60_000
  world.partial = true
  await service.refresh()
  assert.equal(service.notices().length, 0)
  assert.equal(service.cache().states[track.key].checkedAt, undefined)
  assert.match(service.snapshot().tracks[0].error, /没能解开/)
  world.partial = false
  await service.refresh()
  assert.equal(service.notices().length, 1)
  assert.equal(service.snapshot().tracks[0].error, null)
})
test('owner and manually selected administrators, plus specific-members-only mode', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, audience: 'managers', senders: [{ id: 'admin', name: '辅导员' }] })
  world.messages = [message('o', 1000, 'owner'), message('a', 1001, 'admin'), message('x', 1002, 'other')]
  world.at += 60_000
  await service.refresh()
  assert.deepEqual(
    service
      .notices()
      .flatMap((n) => n.originals.map((m) => m.id))
      .sort(),
    ['a', 'o']
  )
  await service.set({ key: track.key, audience: 'selected', senders: [] })
  world.at += 60_000
  await service.refresh()
  assert.match(service.snapshot().tracks[0].error, /选择/)
})
test('AI summary retains the originals of a matter; failures fall back without losing messages', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  world.messages = [message('one'), message('two', 2000)]
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 1)
  assert.equal(service.notices()[0].mode, 'summary')
  assert.equal(service.notices()[0].originals.length, 2)
  assert.match(world.asked.system, /不可信/)
  // 聊天内容只在要整理的那一段里，带编号、时间和发送者。
  const input = JSON.parse(world.asked.text)
  assert.deepEqual(input.消息.map((m) => [m.编号, m.发送者, m.时间]), [[1, 'owner', '2026-10-16 10:00 周五'], [2, 'owner', '2026-10-16 10:00 周五']])
  world.askError = true
  world.messages.push(message('three', 61000))
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 2)
  assert.equal(service.notices()[0].mode, 'original')
  assert.ok(service.notices()[0].summaryError)
})
test('opt-in off, cancellation and timer interval prevent unwanted reads', async (t) => {
  const { world, service, add } = fixture(t)
  await add()
  world.disabled = ['zju-wechat-chat']
  service.start()
  await service.tick()
  const count = world.calls.length
  await assert.rejects(service.find(), /打开/)
  assert.equal(world.calls.length, count)
  world.disabled = []
  await service.set({ intervalMinutes: 3 })
  await service.tick()
  const checked = world.calls.length
  world.at += 2 * 60_000
  await service.tick()
  assert.equal(world.calls.length, checked)
  world.at += 60_000
  await service.tick()
  assert.ok(world.calls.length > checked)
  await assert.rejects(service.set({ intervalMinutes: 0 }), /间隔/)
})
test('overlap catches newly synced older messages without replaying seen ids', async (t) => {
  const { world, service, message, add } = fixture(t)
  await add()
  world.messages = [message('one')]
  world.at += 60_000
  await service.refresh()
  world.messages.push(message('late', 2000))
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 2)
})
test('message formatting preserves text and expands quotes and forwarded records', () => {
  assert.equal(messageText({ type: 'text', text: '  原文\n原样  ' }), '  原文\n原样  ')
  assert.match(
    messageText({ type: 'quote', text: '回复', reference: { text: '引用原文', sender: { name: '同学' } } }),
    /引用原文/
  )
})

test('failure after the first page commits neither partial notices nor a new watermark', async t => {
  const { world, service, message, add } = fixture(t, { pageSize: 1, failOffset: 1 })
  const track = await add()
  world.messages = [message('one'), message('two', 2000)]
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 0)
  assert.equal(service.cache().states[track.key].checkedAt, undefined)
  world.failOffset = undefined
  await service.refresh()
  assert.equal(service.notices().length, 2)
})

test('turning the plugin off during a model request discards the pending result', async t => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  world.messages = [message('one')]
  world.at += 60_000
  let started, finish
  const waiting = new Promise(resolve => { started = resolve })
  service.ask = () => { started(); return new Promise(resolve => { finish = resolve }) }
  const sync = service.refresh()
  await waiting
  world.disabled = ['zju-wechat-chat']
  service.changed()
  world.disabled = []
  service.changed()
  finish('这份旧结果不应该进通知')
  await sync
  assert.equal(service.notices().length, 0)
  assert.equal(service.cache().states[track.key]?.checkedAt, undefined)
})

test('notices carry the chat kind of their track, so group and personal chats land in different notice tabs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-kind-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ tracks: [{ key: 'g', kind: 'group' }, { key: 'p', kind: 'personal' }] }))
  fs.writeFileSync(path.join(root, 'cache.json'), JSON.stringify({ notices: [{ id: 'a', trackKey: 'g' }, { id: 'b', trackKey: 'p' }, { id: 'c', trackKey: 'gone', chatKind: 'personal' }] }))
  const watch = new ChatWatch({ platform: 'wechat', plugins: { disabled: () => [] }, settingsFile: path.join(root, 'settings.json'), cacheFile: path.join(root, 'cache.json') })
  assert.deepEqual(watch.notices().map(n => [n.id, n.chatKind]), [['a', 'group'], ['b', 'personal'], ['c', 'personal']])
})

test('one notice per matter: titles carry the checked deadline and each notice keeps only its own originals', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  world.messages = [
    message('a', 1000, 'owner', '实验三报告 10月18日17:00前交到学在浙大'),
    message('b', 2000, 'other', '收到'),
    message('c', 3000, 'owner', '下周二下午的实验课改到东四 201'),
    message('d', 4000, 'other', '好的'),
  ]
  world.answer = JSON.stringify({ 事项: [
    { 事项: '实验三报告提交截止', 要做什么: '在学在浙大提交实验三报告', 截止: '2026-10-18T17:00:00+08:00', 截止原文: '10月18日17:00前', 时间地点: '', 发送者: 'owner', 消息: [1] },
    { 事项: '实验课换教室', 要做什么: '下周二的实验课去东四 201', 截止: '', 截止原文: '', 时间地点: '下周二下午 东四 201', 发送者: 'owner', 消息: [3] },
  ] })
  world.at += 60_000
  await service.refresh()
  const notices = service.notices()
  assert.equal(notices.length, 2)
  const report = notices.find((n) => n.matter.事项 === '实验三报告提交截止'), room = notices.find((n) => n.matter.事项 === '实验课换教室')
  assert.equal(report.title, '实验三报告提交 · 10月18日 17:00 截止')
  assert.equal(report.deadline, '2026-10-18T17:00:00+08:00')
  assert.deepEqual(report.originals.map((m) => m.id), ['a'])
  assert.match(report.body, /在学在浙大提交实验三报告\n截止：10月18日 17:00/)
  assert.equal(report.from, '年级群 · owner')
  assert.equal(room.title, '实验课换教室')
  assert.equal(room.deadline, null)
  assert.deepEqual(room.originals.map((m) => m.id), ['c'])
  assert.match(room.body, /时间地点：下周二下午 东四 201/)
  assert.notEqual(report.id, room.id)
  assert.equal(service.snapshot().tracks[0].skipped, 2)
  assert.equal(world.alerts.length, 1)
})

test('a batch with only chit-chat makes no notice and records how many were skipped', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  world.messages = [message('a', 1000, 'other', '收到'), message('b', 2000, 'other', '好的'), message('c', 3000, 'other', '[表情]')]
  world.answer = '{"事项": []}'
  world.at += 60_000
  await service.refresh()
  assert.equal(service.notices().length, 0)
  assert.equal(world.alerts.length, 0)
  assert.equal(service.snapshot().tracks[0].skipped, 3)
  // 没有新消息的那次同步留着上一次的数；换成原样收集就不算了。
  world.at += 60_000
  await service.refresh()
  assert.equal(service.snapshot().tracks[0].skipped, 3)
  await service.set({ key: track.key, mode: 'original' })
  assert.equal(service.snapshot().tracks[0].skipped, 0)
})

test('an answer that is not the expected JSON falls back to the originals', async (t) => {
  const answers = ['请在 10 月 18 日前提交材料。', '{"事项": "交材料"}', '{"事项": [{"事项": "交材料", "消息": [9]}]}', '{"事项": [{"要做什么": "交材料", "消息": [1]}]}']
  for (const answer of answers) {
    const { world, service, message, add } = fixture(t)
    const track = await add()
    await service.set({ key: track.key, mode: 'summary' })
    world.messages = [message('one'), message('two', 2000)]
    world.answer = answer
    world.at += 60_000
    await service.refresh()
    const notices = service.notices()
    assert.equal(notices.length, 2, answer)
    assert.ok(notices.every((n) => n.mode === 'original' && n.summaryError && !n.matter), answer)
    assert.equal(service.snapshot().tracks[0].skipped, 0)
  }
  assert.equal(parseMatters('```json\n{"事项": []}\n```', 3).length, 0)
  assert.deepEqual(parseMatters('{"事项": [{"事项": "交表", "消息": ["2", 2, 1, 7]}]}', 3)[0].消息, [1, 2])
})

test('batches split at a two-hour gap and at the character limit', async (t) => {
  const { world, service, message, add } = fixture(t)
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  const hour = 3_600_000
  world.messages = [message('a', 1000), message('b', 30 * 60_000), message('c', 30 * 60_000 + 2 * hour), message('d', 3 * hour)]
  world.answer = (input) => JSON.stringify({ 事项: [{ 事项: '一件事', 要做什么: '', 截止: '', 截止原文: '', 时间地点: '', 发送者: 'owner', 消息: JSON.parse(input.text).消息.map((m) => m.编号) }] })
  world.at += 4 * hour
  await service.refresh()
  assert.deepEqual(world.asks.map((input) => JSON.parse(input.text).消息.length), [2, 2])
  assert.deepEqual(service.notices().map((n) => n.originals.map((m) => m.id)).sort(), [['a', 'b'], ['c', 'd']])
  const item = (id, minutes, size) => ({ id, at: new Date(Date.parse('2026-10-16T10:00:00+08:00') + minutes * 60_000).toISOString(), body: 'x'.repeat(size) })
  assert.deepEqual(batches([item('a', 0, 7000), item('b', 1, 6000), item('c', 2, 100), item('d', 200, 100)]).map((group) => group.map((i) => i.id)), [['a'], ['b', 'c'], ['d']])
})

test('the prompt knows the college, grade and confirmed courses, but not the student number or name', async (t) => {
  const identity = { display_name: '王小明', college: '计算机科学与技术学院', major_name: '软件工程', grade: '2023', student_level: '本科生', student_id: '3230100000' }
  const courses = (track) => (track.id === 'group' ? [{ title: '计算机网络 · 2026-2027 秋冬', teachers: ['张老师'] }] : [])
  const { world, service, message, add } = fixture(t, { options: { identity: () => identity, courses } })
  const track = await add()
  await service.set({ key: track.key, mode: 'summary' })
  world.messages = [message('o', 1000, 'owner'), { ...message('s', 2000, 'self'), isSelf: true, sender: { id: 'self', name: '王小明' } }]
  world.at += 60_000
  await service.refresh()
  const { system, text } = world.asked
  for (const value of ['计算机科学与技术学院', '软件工程', '入学年份 2023', '本科生', '计算机网络 · 2026-2027 秋冬', '张老师', '「年级群」', '所有人']) assert.ok(system.includes(value), value)
  for (const value of ['王小明', '3230100000']) assert.ok(!system.includes(value) && !text.includes(value), value)
  assert.deepEqual(JSON.parse(text).消息.map((m) => m.发送者), ['owner', '本人'])
  const managers = summaryPrompt({ platform: 'dingtalk', track: { name: '课程群', kind: 'group', audience: 'managers', senders: [{ id: 'a', name: '李助教' }] } })
  assert.match(managers, /钉钉群「课程群」.*没有确认它对应哪门课/s)
  assert.match(managers, /只收群主和这几位管理员：李助教/)
  assert.match(managers, /基础信息没有填/)
  // 读个人资料或者档案出错时照样整理。
  const broken = fixture(t, { options: { identity: () => { throw Error('locked') }, courses: () => { throw Error('locked') } } })
  const other = await broken.add()
  await broken.service.set({ key: other.key, mode: 'summary' })
  broken.world.messages = [broken.message('one')]
  broken.world.at += 60_000
  broken.world.answer = '{"事项": [{"事项": "交材料", "消息": [1]}]}'
  await broken.service.refresh()
  assert.equal(broken.service.notices()[0].mode, 'summary')
})

test('a deadline is kept only when its original wording is in the messages and the date and time agree with it', () => {
  const sent = (text, at = '2026-10-21T09:00:00+08:00') => [{ id: 'm', sentAt: at, text }]
  const check = (截止, 截止原文, messages) => deadlineOf({ 截止, 截止原文 }, messages).deadline
  assert.equal(check('2026-10-23T17:00:00+08:00', '10月23日17:00前', sent('报告10月23日17:00前交')), '2026-10-23T17:00:00+08:00')
  assert.equal(check('2026-10-24T17:00:00+08:00', '10月23日17:00前', sent('报告10月23日17:00前交')), '')
  assert.equal(check('2026-10-23T18:00:00+08:00', '10月23日17:00前', sent('报告10月23日17:00前交')), '')
  // 原话不在消息里、没有时区、写的不是时间：都不要。
  assert.equal(check('2026-10-23T17:00:00+08:00', '10月23日17:00前', sent('报告尽快交')), '')
  assert.equal(check('2026-10-23T17:00:00', '10月23日17:00前', sent('报告10月23日17:00前交')), '')
  assert.equal(check('周五', '周五前', sent('周五前交')), '')
  // 明天、周五、下周二按消息发出的那天（10-21 周三）推算；原话没说几点的，只留日期。
  assert.equal(check('2026-10-22T12:00:00+08:00', '明天中午12点前', sent('明天中午12点前交')), '2026-10-22T12:00:00+08:00')
  assert.equal(check('2026-10-23T23:59:00+08:00', '周五前', sent('周五前交')), '2026-10-23')
  assert.equal(check('2026-10-23T17:00:00+08:00', '周五下午五点前', sent('周五下午五点前交')), '2026-10-23T17:00:00+08:00')
  assert.equal(check('2026-10-21T20:00:00+08:00', '今天二十点前', sent('今天二十点前交')), '2026-10-21T20:00:00+08:00')
  assert.equal(check('2026-10-21T10:00:00+08:00', '今天二十点前', sent('今天二十点前交')), '')
  assert.equal(check('2026-10-23', '下周五', sent('下周五交')), '')
  assert.equal(check('2026-10-30', '下周五', sent('下周五交')), '2026-10-30')
  assert.equal(check('2026-10-27', '下周二前', sent('下周二前交')), '2026-10-27')
  assert.equal(check('2026-10-31', '月底前', sent('月底前交')), '2026-10-31')
  assert.equal(check('2026-10-28', '尽快', sent('尽快交')), '')
  // 说这句话的那条消息是前一天发的：「明天」是 10-21。
  assert.equal(check('2026-10-21', '明天', [{ id: 'x', sentAt: '2026-10-20T20:00:00+08:00', text: '明天交' }, { id: 'y', sentAt: '2026-10-21T08:00:00+08:00', text: '好' }]), '2026-10-21')
})
