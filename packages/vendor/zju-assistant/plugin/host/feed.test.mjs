import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Feed, fromActivity, fromNotice } from './feed.mjs'

const READY = { zju_username: '3250100000', zju_password: 'x', webvpn_username: 'a', webvpn_password: 'b' }

/**
 * run 答学校通知的那条命令，activities 答二课活动的那条；两条各记各的次数（calls、sztzCalls）。
 * 不给 run 的话学校通知那边是空的。
 */
function fixture(t, { accounts = READY, disabled = [], articles = async () => ({ articles: [], attention: '' }), refreshArticles, filter, run = () => ({ notices: [] }), activities = () => ({ activities: [] }) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-feed-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const state = { accounts, disabled, at: Date.parse('2026-10-09T12:00:00+08:00'), calls: [], sztzCalls: [] }
  const feed = new Feed({
    file: path.join(root, 'cache', 'feed.json'), account: { read: () => ({ data: state.accounts }) }, plugins: { disabled: () => state.disabled },
    articles, refreshArticles, filter, now: () => state.at,
    run: async (args, options) => {
      if (args[0] === 'sztz') { state.sztzCalls.push({ args, options }); return activities(state) }
      state.calls.push({ args, options })
      return run(state)
    },
  })
  return { feed, state, file: path.join(root, 'cache', 'feed.json') }
}
const notice = (title, date, source = '教务网·本科生院通知公告') => ({ title, date, source, url: `https://example.test/${encodeURIComponent(title)}` })
/** `sztz activity new` 里的一个活动；opens、closes 是报名起止的北京时间。 */
const activity = (id, name, opens, closes, organizer = '校学生会') => ({ id, name, organizer, status: '报名中', signupOpens: opens, signupCloses: closes, url: `https://sztz.zju.edu.cn/dekt/#/index/hdzx?xmId=${id}` })

test('学校通知一条条攒进缓存，和公众号文章按时间排在一起', async (t) => {
  const { feed, state, file } = fixture(t, {
    run: s => ({ notices: s.calls.length === 1 ? [notice('第三轮选课通知', '2026-10-08'), notice('国庆后班车调整', '2026-10-06', '综合服务网·重点提示')] : [notice('四六级报名', '2026-10-09')] }),
    articles: async () => ({ attention: 'verification_required', articles: [
      { id: 'a1', from: '浙大体育与艺术', title: '全明星校园行', url: 'https://mp.weixin.qq.com/s/x', publishedAt: '2026-10-09T09:00:00.000Z', foundAt: '2026-10-09T09:05:00.000Z' },
      { id: 'a2', from: '浙大体育与艺术', title: '没有时间的不要', url: 'https://mp.weixin.qq.com/s/y', publishedAt: null, foundAt: null },
    ] }),
  })
  // 只看缓存时不联网；第一次读之前学校通知是空的，公众号的已经在。
  const cached = await feed.snapshot()
  assert.deepEqual(cached.items.map(item => [item.title, item.foundAt]), [['全明星校园行', '2026-10-09T09:05:00.000Z']])
  // 公众号有的号要用户去处理时，这一栏带上一句说明。
  assert.match(cached.sources[1].error, /要先验证一次/)
  assert.equal(state.calls.length, 0)
  const first = await feed.refresh()
  assert.deepEqual(first.items.map(item => [item.title, item.from, item.kind]), [
    ['全明星校园行', '浙大体育与艺术', 'wechat'], ['第三轮选课通知', '教务网', 'school'], ['国庆后班车调整', '综合服务网', 'school'],
  ])
  // 应用用自己的那份已读记录，不动助手的。
  assert.deepEqual(state.calls[0].args, ['notice', 'new'])
  assert.deepEqual(state.calls[0].options.env, { ZJU_NOTICE_READER: 'app' })
  assert.equal(first.sources[0].fetchedAt, new Date(state.at).toISOString())
  // 刚读过不重读；过了十分钟再读，新的加进来，原来的还在。
  await feed.refresh()
  assert.equal(state.calls.length, 1)
  state.at += 11 * 60_000
  const second = await feed.refresh()
  assert.deepEqual(second.items.filter(item => item.kind === 'school').map(item => item.title), ['四六级报名', '第三轮选课通知', '国庆后班车调整'])
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).items.length, 3)
  // 太久以前的通知不再留。
  state.at += 43 * 86_400_000
  await feed.refresh({ force: true })
  assert.deepEqual((await feed.snapshot()).items.filter(item => item.kind === 'school').map(item => item.title), ['四六级报名', '第三轮选课通知'])
})

test('一次没读完接着读；这次没读到时原来的留着并说明原因', async (t) => {
  let fail = false
  const { feed, state } = fixture(t, { run: (s) => {
    if (fail) throw new Error('校园通知一直没有回应，稍后再试。')
    return s.calls.length === 1 ? { notices: [notice('甲', '2026-10-09')], remaining: 5 } : { notices: [notice('乙', '2026-10-08')] }
  } })
  assert.deepEqual((await feed.refresh()).items.map(item => item.title), ['甲', '乙'])
  assert.equal(state.calls.length, 2)
  fail = true
  const failed = await feed.refresh({ force: true })
  assert.deepEqual(failed.items.map(item => item.title), ['甲', '乙'])
  assert.match(failed.sources[0].error, /没有回应/)
  assert.ok(failed.sources[0].fetchedAt)
  // 失败后五分钟内不自动重试，点刷新才读。
  state.at += 60_000
  await feed.refresh()
  assert.equal(state.calls.length, 3)
})

test('关系不大的标出来给页面收起；读到新的先问一遍模型再给页面', async (t) => {
  const judged = []
  // 假的筛选：标题里有「劳务派遣」的算屏蔽词；模型说「班车」那条关系不大，但要等问过以后才知道。
  const verdicts = new Map()
  const filter = {
    hidden: items => new Map(items.flatMap(item => item.title.includes('劳务派遣') ? [[item.id, 'blocked']] : verdicts.has(item.id) ? [[item.id, verdicts.get(item.id)]] : [])),
    judge: async (items) => { judged.push(items.map(item => item.title)); for (const item of items) if (item.title.includes('班车')) verdicts.set(item.id, 'irrelevant') },
  }
  const { feed } = fixture(t, { filter, run: () => ({ notices: [notice('劳务派遣人员招聘', '2026-10-09'), notice('四六级报名', '2026-10-09'), notice('华家池班车调整', '2026-10-08')] }) })
  assert.deepEqual((await feed.refresh()).items.map(item => [item.title, item.hidden]), [['劳务派遣人员招聘', 'blocked'], ['四六级报名', null], ['华家池班车调整', 'irrelevant']])
  assert.deepEqual(judged, [['劳务派遣人员招聘', '四六级报名', '华家池班车调整']])
  // 没有筛选的时候每条都不收起。
  const plain = fixture(t, { run: () => ({ notices: [notice('劳务派遣人员招聘', '2026-10-09')] }) })
  assert.deepEqual((await plain.feed.refresh()).items.map(item => item.hidden), [null])
})

test('平时进页面不催公众号，点刷新才让它马上再看一遍；学校通知读不了、公众号那边出错都不耽误', async (t) => {
  let asked = 0
  const { feed, state } = fixture(t, { run: () => ({ notices: [] }), refreshArticles: async () => { asked++; if (asked === 2) throw new Error('微信没有运行') } })
  await feed.refresh()
  assert.equal(asked, 0)
  await feed.refresh({ force: true })
  assert.equal(asked, 1)
  state.accounts = {}
  assert.equal((await feed.refresh({ force: true })).sources[0].state, 'account')
  assert.equal(asked, 2)
  state.disabled = ['zju-wechat']
  await feed.refresh({ force: true })
  assert.equal(asked, 2, '公众号插件关着时不去催')
})

test('插件关着或账号没填时不去读，也不拿缓存给人看', async (t) => {
  const { feed, state } = fixture(t, { run: () => ({ notices: [notice('甲', '2026-10-09')] }) })
  await feed.refresh()
  state.disabled = ['zju-notices', 'zju-wechat', 'zju-activities']
  const off = await feed.refresh({ force: true })
  assert.deepEqual(off.items, [])
  assert.deepEqual(off.sources.map(source => [source.id, source.state]), [['school', 'off'], ['wechat', 'off'], ['sztz', 'off']])
  state.disabled = ['zju-wechat']
  state.accounts = { zju_username: '3250100000' }
  const account = await feed.refresh({ force: true })
  assert.deepEqual([account.sources[0].state, account.sources[0].plugin], ['account', 'zju-account'])
  assert.equal(state.calls.length, 1)
  // 校园网直连时不用 WebVPN 账号。
  state.accounts = { zju_username: '3250100000', zju_password: 'x', transport: 'direct' }
  assert.equal((await feed.snapshot()).sources[0].state, 'ready')
})

test('二课新出的活动攒进缓存，和另外两种排在一起；开始报名时重新排到前面，报名截止就不再给', async (t) => {
  const { feed, state, file } = fixture(t, {
    run: () => ({ notices: [notice('第三轮选课通知', '2026-10-09')] }),
    activities: s => ({ activities: s.sztzCalls.length > 1 ? [] : [
      activity(1, '新生杯辩论赛', '2026-10-01 00:00', '2026-10-12 00:00'),
      activity(2, '十佳歌手大赛', '2026-10-11 08:00', '2026-10-20 00:00', '竺可桢学院'),
      { id: 3, name: '没有报名时间的不要', url: 'https://sztz.zju.edu.cn/dekt/' },
    ] }),
  })
  // 第一次读到的算现在出现的，排在今天（零点）的通知前面。
  const first = await feed.refresh(), found = new Date(state.at).toISOString()
  assert.deepEqual(first.items.map(item => item.kind), ['sztz', 'sztz', 'school'])
  const singer = first.items.find(item => item.title === '十佳歌手大赛')
  assert.deepEqual([singer.id, singer.from, singer.at, singer.foundAt, singer.opens, singer.closes, singer.dated],
    ['sztz:2', '竺可桢学院', found, found, '2026-10-11T00:00:00.000Z', '2026-10-19T16:00:00.000Z', true])
  // 应用用自己的那份已读记录，不动助手的。
  assert.deepEqual([state.sztzCalls[0].args, state.sztzCalls[0].options.env], [['sztz', 'activity', 'new'], { ZJU_NOTICE_READER: 'app' }])
  assert.deepEqual([first.sources[2].id, first.sources[2].state, first.sources[2].fetchedAt], ['sztz', 'ready', found])
  // 学校通知过十分钟就再读，二课要过半小时。
  state.at += 11 * 60_000
  await feed.refresh()
  assert.deepEqual([state.calls.length, state.sztzCalls.length], [2, 1])
  state.at += 20 * 60_000
  await feed.refresh()
  assert.equal(state.sztzCalls.length, 2)
  // 还没开始报名的，到开始报名以后从那时起算：重新排到最前面，页面的小圆点也跟着。
  state.at = Date.parse('2026-10-11T09:00:00+08:00')
  const opened = (await feed.snapshot()).items
  assert.deepEqual(opened.map(item => item.title), ['十佳歌手大赛', '新生杯辩论赛', '第三轮选课通知'])
  assert.deepEqual([opened[0].at, opened[0].foundAt, opened[1].at], ['2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z', found])
  // 报名截止的不再给页面；下一次读的时候从缓存里清掉。
  state.at = Date.parse('2026-10-12T00:00:01+08:00')
  assert.deepEqual((await feed.snapshot()).items.filter(item => item.kind === 'sztz').map(item => item.title), ['十佳歌手大赛'])
  await feed.refresh({ force: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).activities.items.map(item => item.id), ['sztz:2'])
})

test('二课这次没读到时原来的留着并说明原因；「活动与场馆」关着时不读也不给', async (t) => {
  let fail = false
  const { feed, state } = fixture(t, { activities: () => {
    if (fail) throw new Error('素质拓展平台一直没有回应，稍后再试。')
    return { activities: [activity(1, '新生杯辩论赛', '2026-10-01 00:00', '2026-10-20 00:00')] }
  } })
  await feed.refresh()
  fail = true
  const failed = await feed.refresh({ force: true })
  assert.deepEqual(failed.items.map(item => item.title), ['新生杯辩论赛'])
  assert.match(failed.sources[2].error, /没有回应/)
  assert.ok(failed.sources[2].fetchedAt)
  // 失败后五分钟内不自动重试，点刷新才读。
  state.at += 60_000
  await feed.refresh()
  assert.equal(state.sztzCalls.length, 2)
  state.disabled = ['zju-activities']
  const off = await feed.refresh({ force: true })
  assert.deepEqual([off.items, off.sources[2].state, state.sztzCalls.length], [[], 'off', 2])
})

test('加二课以前存下的缓存照样能用', async (t) => {
  const { feed, state, file } = fixture(t, { activities: () => ({ activities: [activity(1, '新生杯辩论赛', '2026-10-01 00:00', '2026-10-20 00:00')] }) })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tried = new Date(state.at - 60_000).toISOString()
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'school:https://x', kind: 'school', title: '旧的通知', from: '教务网', at: '2026-10-08T00:00:00+08:00', dated: false, url: 'https://x', foundAt: tried }], fetchedAt: tried, triedAt: tried, error: null }))
  assert.deepEqual((await feed.refresh()).items.map(item => item.title), ['新生杯辩论赛', '旧的通知'])
  // 学校通知一分钟前刚读过，这一趟只读了二课；写回去以后两样都在。
  assert.deepEqual([state.calls.length, state.sztzCalls.length], [0, 1])
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items.map(item => item.title), ['旧的通知'])
})

test('格式不对的条目不要', () => {
  assert.equal(fromNotice({ title: '', date: '2026-10-09', url: 'x' }, ''), undefined)
  assert.equal(fromNotice({ title: '甲', date: '十月', url: 'x' }, ''), undefined)
  assert.equal(fromNotice({ title: '甲', date: '2026-10-09 08:00', source: '计算机科学与技术学院·本科生教育', url: 'https://x' }, 'now').from, '计算机科学与技术学院')
  assert.equal(fromActivity({ id: 1, name: '甲', signupCloses: '下周', url: 'https://x' }, 'now'), undefined)
  assert.equal(fromActivity({ id: '1', name: '甲', signupCloses: '2026-10-20 00:00', url: 'https://x' }, 'now'), undefined)
  assert.equal(fromActivity({ id: 1, name: '甲', signupCloses: '2026-10-20 00:00' }, 'now'), undefined)
  // 没写举办单位的写平台的名字；没有开始报名的时间也收。
  assert.deepEqual(fromActivity({ id: 1, name: ' 甲 ', signupCloses: '2026-10-20 00:00', url: 'https://x' }, 'now'),
    { id: 'sztz:1', kind: 'sztz', title: '甲', from: '素质拓展平台', dated: true, url: 'https://x', foundAt: 'now', opens: null, closes: '2026-10-19T16:00:00.000Z' })
})

test('指定聊天进入通知，原样模式不交给通知相关性模型，刷新同时检查聊天',async t=>{
 const {feed}=fixture(t);let refreshed=0;const item={id:'chat:one',kind:'chat',title:'班级通知',from:'年级群',at:'2026-10-09T11:00:00+08:00',body:'原文',url:''};
 feed.watches=()=>[{platform:'wechat',notices:()=>[item],enabled:()=>true,refresh:async()=>{refreshed++},snapshot:()=>({enabled:true,checkedAt:null,error:null,tracks:[]})}]
 feed.filter={hidden:items=>{assert.ok(items.every(i=>i.kind!=='chat'));return new Map()},judge:async items=>{assert.ok(items.every(i=>i.kind!=='chat'))}}
 const result=await feed.refresh({force:true});assert.equal(result.items[0].body,'原文');assert.equal(refreshed,1);assert.ok(result.sources.some(s=>s.id==='wechat-chat'&&s.kind==='chat'))
})

test('两个页签按来源和聊天类型分：群聊、学校通知、公众号、二课在校园通知；私聊、邮箱、CC98 在个人消息，个人消息不过「关系不大」的筛', async (t) => {
  const asked = []
  const { feed } = fixture(t, {
    run: () => ({ notices: [notice('第三轮选课通知', '2026-10-08')] }),
    filter: { hidden: (items) => { asked.push(...items.map(item => item.kind)); return new Map(items.map(item => [item.id, 'irrelevant'])) }, judge: async (items) => { asked.push(...items.map(item => item.kind)) } },
  })
  const chat = (id, chatKind) => ({ id: `chat:wechat:${id}`, kind: 'chat', platform: 'wechat', chatKind, title: id, from: id, at: '2026-10-09T10:00:00+08:00', url: '', body: id })
  feed.watches = () => [{ platform: 'wechat', notices: () => [chat('年级群', 'group'), chat('辅导员', 'personal'), chat('说不清', null)], enabled: () => true, refresh: async () => {}, snapshot: () => ({ enabled: true, checkedAt: null, error: null, tracks: [] }) }]
  const personal = (id, kind) => ({ items: [{ id, kind, title: id, from: '老师', at: '2026-10-09T09:00:00+08:00', url: '' }], source: { id: kind, kind, name: kind, plugin: 'x', state: 'ready', fetchedAt: null, error: null } })
  let mailRefreshed = 0, cc98Refreshed = 0
  feed.mail = { snapshot: () => personal('mail:1', 'mail'), refresh: async () => { mailRefreshed++ } }
  feed.cc98 = { snapshot: () => personal('cc98:alice:reply:1', 'cc98'), refresh: async () => { cc98Refreshed++ } }
  const result = await feed.refresh()
  const view = Object.fromEntries(result.items.map(item => [item.title, [item.view, item.hidden]]))
  assert.deepEqual(view['年级群'], ['campus', null])
  assert.deepEqual(view['说不清'], ['campus', null])
  assert.deepEqual(view['辅导员'], ['personal', null])
  assert.deepEqual(view['mail:1'], ['personal', null])
  assert.deepEqual(view['cc98:alice:reply:1'], ['personal', null])
  // 只有学校通知交给了筛；被判成关系不大的照样收起。
  assert.deepEqual(view['第三轮选课通知'], ['campus', 'irrelevant'])
  assert.ok(asked.every(kind => kind === 'school'))
  assert.deepEqual([mailRefreshed, cc98Refreshed], [1, 1])
  assert.deepEqual(result.sources.filter(source => source.views?.includes('personal')).map(source => source.id).sort(), ['cc98', 'mail', 'wechat-chat'])
})

test('一个来源出错不抹掉别的：CC98 读不了、邮箱抛错，学校通知照样读、照样给', async (t) => {
  const { feed, state } = fixture(t, { run: () => ({ notices: [notice('四六级报名', '2026-10-09')] }) })
  feed.mail = { snapshot: () => ({ items: [], source: { id: 'mail', kind: 'mail', name: '邮箱', plugin: 'zju-mail', state: 'ready', fetchedAt: null, error: '连接浙大邮箱超时' } }), refresh: async () => { throw new Error('boom') } }
  feed.cc98 = { snapshot: () => ({ items: [], source: { id: 'cc98', kind: 'cc98', name: 'CC98', plugin: 'zju-community', state: 'ready', fetchedAt: null, error: null } }), refresh: async () => { throw new Error('boom') } }
  const result = await feed.refresh()
  assert.deepEqual(result.items.map(item => item.title), ['四六级报名'])
  assert.equal(state.calls.length, 1)
  assert.equal(result.sources.find(source => source.id === 'mail').error, '连接浙大邮箱超时')
})

test('后台每分钟看一眼邮箱和 CC98：CC98 排在页面那一趟 WebVPN 的后面，不和学校通知同时读；邮箱出错不耽误 CC98', async (t) => {
  const order = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { feed } = fixture(t, { run: async () => { order.push('notice new 开始'); await gate; order.push('notice new 结束'); return { notices: [] } } })
  const source = (id, plugin) => ({ items: [], source: { id, kind: id, name: id, plugin, state: 'ready', fetchedAt: null, error: null } })
  feed.mail = { snapshot: () => source('mail', 'zju-mail'), refresh: async () => {}, check: async () => { order.push('邮箱'); throw new Error('连接浙大邮箱超时') } }
  feed.cc98 = { snapshot: () => source('cc98', 'zju-community'), refresh: async () => { order.push('CC98 页面那一趟') }, check: async () => { order.push('CC98 后台') } }
  const page = feed.refresh()
  await new Promise(resolve => setImmediate(resolve))
  const background = feed.tick()
  // 正在看的那一次没完，再叫一次不重复去读。
  await feed.tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['notice new 开始', '邮箱'])
  release()
  await Promise.all([page, background])
  assert.deepEqual(order, ['notice new 开始', '邮箱', 'notice new 结束', 'CC98 页面那一趟', 'CC98 后台'])
  // start 定一个每分钟的钟，交回来的函数把它停掉。
  const timers = []
  feed.schedule = (fn, ms) => { timers.push(ms); return { ms, unref() {} } }
  feed.cancel = timer => { timers.push(`停 ${timer.ms}`) }
  const stop = feed.start()
  await new Promise(resolve => setImmediate(resolve))
  stop()
  assert.deepEqual(timers, [60_000, '停 60000'])
})
