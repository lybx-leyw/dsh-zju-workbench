/**
 * 校园事务页右边的通知：学校各部门和本人学院新发的通知、已添加公众号的新文章、二课平台上新出的活动，合成一条按时间排的列表。
 * 学校通知用 ZJU Core 的 `notice new` 读（只给上次之后新出现的），读到的攒在这里的缓存里；
 * 页面打开时先拿缓存，再让这里去读新的，这次没读到时原来的留着，只记下原因。
 * 公众号文章由公众号插件自己半小时检查一遍（wechat.mjs），这里只取它已经存下的；用户点刷新时催它马上再看一遍。
 * 二课活动用 `sztz activity new` 读，也是只给新出现的、攒在缓存里；只留还能报名或还没开始报名的，报名一截止就不再给页面。
 * 条数多了以后，和这位学生关系不大的由 notice-filter.mjs 标出来（屏蔽词，加上模型照个人档案的判断），页面默认收起。
 *
 * 页面右栏分两个页签（2026-10-18）：每一条的 view 说它在哪一个。
 *   campus    校园通知：学校和学院的通知、公众号文章、二课活动，和监控的微信、钉钉群里的消息（群里多是活动、讲座、报名和公告）。
 *   personal  个人消息：监控的微信、钉钉个人聊天，邮箱的新来信（mail-feed.mjs），CC98 上本人收到的消息（cc98-feed.mjs）。
 * 只按来源和聊天类型分，不让模型再判断一遍；个人消息不过上面那道「关系不大」的筛，老师来信和论坛回复不会被收起。
 *
 * 不开着页面时（start）每分钟看一眼个人消息的两个来源：邮箱和 CC98 各自隔一阵读一次，读到新的由它们去提醒页面（index.mjs 接的 onNew）。
 * 学校通知、二课不在后台读，还是进页面、点刷新时才读。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { accountReady } from '../accounts.mjs'
import { accountRow } from '../rows.mjs'
import { runCore } from './core.mjs'

/** 读成功以后，这么久之内再进页面不重新读；页面上点刷新不受限制。 */
const FRESH_MS = 10 * 60_000
/** 读失败以后隔一阵再自动重试：密码填错时每进一次页面就登录一次，账号可能被锁。 */
const RETRY_MS = 5 * 60_000
const DAY_MS = 86_400_000
/** 学校通知留多久、最多留多少条。 */
const KEEP_DAYS = 45, KEEP = 300
/** `notice new` 一次最多给 100 条，还有剩的接着读，最多读这么多次。 */
const ROUNDS = 4
/** 公众号文章取最近这么多篇。 */
const ARTICLES = 100
/** 二课的活动变得慢，读一次又要过 WebVPN：读成功以后这么久之内再进页面不重新读。 */
const ACTIVITY_FRESH_MS = 30 * 60_000
/** 二课活动最多留多少个。报名截止的自己会出去，这只是个上限。 */
const KEEP_ACTIVITIES = 200
/**
 * 应用自己记一份「看到哪了」，和助手在对话里用 `notice new`、`sztz activity new` 的那份分开：
 * 这里读走的，助手再问「有没有新通知」「有没有新活动」时还能读到。
 */
const READER = { ZJU_NOTICE_READER: 'app' }
/** 后台多久看一眼；真去读要等各来源自己说到点了（mail-feed.mjs、cc98-feed.mjs 的 CHECK_MS）。 */
const TICK_MS = 60_000

const NOTICES = { id: 'school', name: '学校通知', plugin: 'zju-notices' }
const ARTICLE_SOURCE = { id: 'wechat', name: '公众号', plugin: 'zju-wechat' }
const ACTIVITIES = { id: 'sztz', name: '二课活动', plugin: 'zju-activities' }
/** 公众号有的号要用户去插件页处理一下才能接着读时，这一栏下面怎么说。 */
const ATTENTION = { verification_required: '微信读书要先验证一次，有的公众号这次没读到', login_required: '微信读书的登录过期了，有的公众号这次没读到' }
const text = value => typeof value === 'string' ? value.trim() : ''
/** 账号在插件页的哪一项里填。 */
const accountPlugin = accountRow
/** 学校通知只有日期；按北京时间那天的零点算，和带时刻的公众号文章排在一起。 */
const dayStart = date => `${date}T00:00:00+08:00`
const byTime = (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.title.localeCompare(b.title, 'zh')
/** 只有这几种公共通知交给「关系不大」的筛。 */
const FILTERED = new Set(['school', 'wechat', 'sztz'])
const filterable = item => FILTERED.has(item.kind)

/** 一条通知在右栏的哪个页签：邮箱、CC98 和个人聊天在「个人消息」，别的（连同群聊和说不清是什么的聊天）在「校园通知」。 */
export function viewOf(item) {
  if (item.kind === 'mail' || item.kind === 'cc98') return 'personal'
  if (item.kind === 'chat' && item.chatKind === 'personal') return 'personal'
  return 'campus'
}

/** `notice new` 的结果里的一条。source 是「来源·栏目」，页面上只写来源。 */
export function fromNotice(entry, foundAt) {
  const title = text(entry?.title), url = text(entry?.url), date = /^\d{4}-\d{2}-\d{2}/.exec(text(entry?.date))?.[0]
  if (!title || !url || !date) return undefined
  return { id: `school:${url}`, kind: 'school', title, from: text(entry.source).split('·')[0] || '学校', at: dayStart(date), dated: false, url, foundAt }
}

/** core 给的北京时间（2026-10-17 19:00）换成带时区的写法；不是这个样子的返回 undefined。 */
function beijing(value) {
  const found = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(text(value))
  return found ? new Date(`${found[1]}T${found[2]}:00+08:00`).toISOString() : undefined
}

/** `sztz activity new` 的结果里的一个活动。opens、closes 是报名的起止；排在哪个时间等给页面的时候再算（surfacedAt）。 */
export function fromActivity(entry, foundAt) {
  const title = text(entry?.name), url = text(entry?.url), closes = beijing(entry?.signupCloses)
  if (!title || !url || !closes || !Number.isInteger(entry.id)) return undefined
  return { id: `sztz:${entry.id}`, kind: 'sztz', title, from: text(entry.organizer) || '素质拓展平台', dated: true, url, foundAt, opens: beijing(entry.signupOpens) ?? null, closes }
}

/**
 * 一个二课活动现在算什么时候出现的：应用第一次读到它的时候；报名是在那之后才开始的，从开始报名起算。
 * 所以还没开始报名的活动，到开始报名那天会重新排到前面。
 */
function surfacedAt(item, now) {
  const found = Date.parse(item.foundAt), opens = Date.parse(item.opens ?? '')
  return new Date(opens > found && opens <= now ? opens : found).toISOString()
}

export class Feed {
  /**
   * file 是缓存文件；account 和 plugins 是账号和插件开关；articles 取公众号插件已经存下的文章
   * （返回 { articles, attention }，每篇带着是哪个号发的 from；关着时抛错）；refreshArticles 让它马上再检查一遍，做完才返回；
   * filter 标出哪些该收起（hidden）、把没问过的交给模型（judge），不给就不筛；run 跑一条 ZJU Core 命令并返回结果里的 data。
   * mail、cc98 是个人消息的两个来源（mail-feed.mjs、cc98-feed.mjs），不给就没有。
   */
  constructor({ file, account, plugins, articles, refreshArticles, chatWatches = [], mail, cc98, filter, run = runCore, now = () => Date.now(), schedule = setInterval, cancel = clearInterval }) {
    this.file = file
    this.account = account
    this.plugins = plugins
    this.articles = articles
    this.refreshArticles = refreshArticles
    // 监控着的聊天由各自那一行在开着时登记，每次现取。
    this.watches = typeof chatWatches === 'function' ? chatWatches : () => chatWatches
    this.mail = mail
    this.cc98 = cc98
    this.filter = filter
    this.run = run
    this.now = now
    this.schedule = schedule
    this.cancel = cancel
    this.running = undefined
    this.cache = undefined
    /** 经 WebVPN 的读排成一条队（webvpn），后台那一次正在看就不再叫一次（ticking）。 */
    this.lane = Promise.resolve()
    this.ticking = false
  }

  /** 经 WebVPN 的读一个接一个：几条命令的会话文件是共用的。页面的那一趟和后台的那一次都排在这里。 */
  webvpn(work) {
    const run = this.lane.then(work)
    this.lane = run.catch(() => {})
    return run
  }

  /** 缓存：学校通知攒下的条目和最近一次读的情况；activities 是二课活动的同样几项。 */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    const record = from => ({ items: Array.isArray(from?.items) ? from.items : [], fetchedAt: from?.fetchedAt ?? null, triedAt: from?.triedAt ?? null, error: from?.error ?? null })
    // 加二课以前存下的缓存里没有 activities，当作还没读过。
    this.cache = { ...record(saved), activities: record(saved?.activities) }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    try { fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  /** 学校通知（或者二课活动）现在能不能读：off 是插件关了，account 是统一身份认证或校内网站的访问方式还没填好。 */
  status(source = NOTICES) {
    if (this.plugins.disabled().includes(source.plugin)) return { state: 'off', plugin: source.plugin }
    const accounts = this.account.read().data
    for (const id of ['zju', 'webvpn']) if (!accountReady(accounts, id)) return { state: 'account', plugin: accountPlugin(id) }
    return { state: 'ready', plugin: source.plugin }
  }

  /** 公众号插件已经存下的文章；插件关着或还读不了时是空的。error 是有的号要用户去插件页处理时的那句话。 */
  async wechat() {
    if (this.plugins.disabled().includes(ARTICLE_SOURCE.plugin)) return { state: 'off', items: [], error: null }
    try {
      const { articles = [], attention = '' } = await this.articles({ limit: ARTICLES })
      const items = articles.flatMap((article) => {
        const title = text(article.title), url = text(article.url), at = text(article.publishedAt)
        if (!title || !url || !Number.isFinite(Date.parse(at))) return []
        return [{ id: `wechat:${article.id}`, kind: 'wechat', title, from: text(article.from) || '公众号', at: new Date(at).toISOString(), dated: true, url, foundAt: text(article.foundAt) || null }]
      })
      return { state: 'ready', items, error: ATTENTION[attention] ?? null }
    } catch { return { state: 'ready', items: [], error: null } }
  }

  /**
   * 页面要的全部内容，只看已经存下的，不联网：items 按时间从新到旧，每条的 hidden 说它该不该收起
   * （'blocked' 标题里有屏蔽词，'irrelevant' 模型判断和这位学生关系不大，null 不收起）；
   * 二课活动另带 opens、closes（报名的起止），只给报名还没截止的；它的 at 和 foundAt 都是 surfacedAt 算出来的那个时间。
   * sources 是各个来源各自的情况：state、最近一次读成功的时间 fetchedAt、最近一次没读到的原因 error，views 是它的消息在哪几个页签。
   * 每一条另带 view（viewOf）。
   */
  async snapshot() {
    const status = this.status(), sztz = this.status(ACTIVITIES), cache = this.load(), wechat = await this.wechat(), now = this.now()
    const school = status.state === 'ready' ? cache.items : []
    const activities = sztz.state !== 'ready' ? [] : cache.activities.items.filter(item => Date.parse(item.closes) > now).map((item) => {
      const at = surfacedAt(item, now)
      return { ...item, at, foundAt: at }
    })
    const chats = this.watches().flatMap(watch => watch.notices())
    const mail = this.mail?.snapshot(), cc98 = this.cc98?.snapshot()
    const items = [...school, ...wechat.items, ...activities, ...chats, ...(mail?.items ?? []), ...(cc98?.items ?? [])].sort(byTime)
    const hidden = this.filter?.hidden(items.filter(filterable))
    return {
      items: items.map(item => ({ ...item, view: viewOf(item), hidden: filterable(item) ? hidden?.get(item.id) ?? null : null })),
      sources: [
        ...this.watches().map(watch => { const state = watch.snapshot(); return { id: watch.platform + '-chat', kind: 'chat', name: watch.platform === 'wechat' ? '微信聊天' : '钉钉聊天', plugin: watch.platform === 'wechat' ? 'zju-wechat-chat' : 'zju-dingtalk', views: ['campus', 'personal'], state: state.enabled ? 'ready' : 'off', fetchedAt: state.checkedAt, error: state.error || state.tracks.find(t => t.error)?.error || null } }),
        { ...NOTICES, views: ['campus'], state: status.state, plugin: status.plugin, fetchedAt: status.state === 'ready' ? cache.fetchedAt : null, error: status.state === 'ready' ? cache.error : null },
        { ...ARTICLE_SOURCE, views: ['campus'], state: wechat.state, fetchedAt: null, error: wechat.error },
        { ...ACTIVITIES, views: ['campus'], state: sztz.state, plugin: sztz.plugin, fetchedAt: sztz.state === 'ready' ? cache.activities.fetchedAt : null, error: sztz.state === 'ready' ? cache.activities.error : null },
        ...(mail ? [{ ...mail.source, views: ['personal'] }] : []),
        ...(cc98 ? [{ ...cc98.source, views: ['personal'] }] : []),
      ],
    }
  }

  /**
   * 去读学校新发的通知和二课新出的活动，读完返回最新的全部内容。刚读过就不再读（force 为真时照读）；同一时间只读一趟。
   * 公众号平时不在这里催，它有自己的定时；用户点的刷新（force）连它一起再看一遍，学校通知读不了时也照样看。
   */
  async refresh({ force = false } = {}) {
    const articles = force && this.refreshArticles && !this.plugins.disabled().includes(ARTICLE_SOURCE.plugin) ? this.refreshArticles().catch(() => {}) : undefined
    // 邮箱直接连邮件服务器，不经 WebVPN，和下面那一趟同时读；它自己记着多久读一次。
    const mail = this.mail?.refresh({ force }).catch(() => {})
    this.running ??= this.read(force).finally(() => { this.running = undefined })
    await this.running
    await articles
    await mail
    if (force) await Promise.all(this.watches().filter(watch => watch.enabled()).map(watch => watch.refresh().catch(() => {})))
    // 还没问过模型的（刚读到的、公众号定时检查攒下的）问一遍，问完再给页面；问不成就照原样给。
    if (this.filter) await this.filter.judge((await this.snapshot()).items.filter(filterable))
    return this.snapshot()
  }

  /**
   * 一趟：先学校通知，再二课活动，最后 CC98 的本人消息，各自到点了才读。一个读完再读下一个：几条命令都经 WebVPN，会话文件是共用的。
   * 一个来源出错不耽误后面的。
   */
  async read(force) {
    const due = ({ triedAt, error }, freshMs) => force || !triedAt || this.now() - Date.parse(triedAt) >= (error ? RETRY_MS : freshMs)
    await this.webvpn(async () => {
      if (this.status().state === 'ready' && due(this.load(), FRESH_MS)) await this.fetch()
      if (this.status(ACTIVITIES).state === 'ready' && due(this.load().activities, ACTIVITY_FRESH_MS)) await this.fetchActivities()
      if (this.cc98) await this.cc98.refresh({ force }).catch(() => {})
    })
  }

  /** 后台的那一次：邮箱直接连邮件服务器，和 CC98 同时读；CC98 排在 WebVPN 那条队里。哪个出错都不耽误另一个。 */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      await Promise.all([
        this.mail?.check().catch(() => {}),
        this.cc98 && this.webvpn(() => this.cc98.check()).catch(() => {}),
      ])
    } finally { this.ticking = false }
  }

  start() {
    this.timer = this.schedule(() => { void this.tick() }, TICK_MS)
    this.timer?.unref?.()
    void this.tick()
    return () => { if (this.timer !== undefined) this.cancel(this.timer) }
  }

  async fetch() {
    const triedAt = new Date(this.now()).toISOString(), found = []
    let error = null
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const data = await this.run(['notice', 'new'], { system: '校园通知', timeoutMs: 180_000, env: READER })
        if (!Array.isArray(data?.notices)) throw new Error('校园通知给的格式不对。')
        found.push(...data.notices.flatMap(entry => fromNotice(entry, triedAt) ?? []))
        if (!data.remaining) break
      }
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    // 读到一半出错时，已经读到的照样留下：core 那边已经把它们记成看过了，丢掉就再也读不回来。
    const cache = this.load(), horizon = this.now() - KEEP_DAYS * DAY_MS, merged = new Map(cache.items.map(item => [item.id, item]))
    for (const item of found) if (!merged.has(item.id)) merged.set(item.id, item)
    const items = [...merged.values()].filter(item => Date.parse(item.at) >= horizon).sort(byTime).slice(0, KEEP)
    this.write({ ...cache, items, fetchedAt: error ? cache.fetchedAt : triedAt, triedAt, error })
  }

  async fetchActivities() {
    const triedAt = new Date(this.now()).toISOString()
    let found = [], error = null
    try {
      const data = await this.run(['sztz', 'activity', 'new'], { system: '素质拓展平台', timeoutMs: 120_000, env: READER })
      if (!Array.isArray(data?.activities)) throw new Error('素质拓展平台给的格式不对。')
      found = data.activities.flatMap(entry => fromActivity(entry, triedAt) ?? [])
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    const cache = this.load(), now = this.now(), merged = new Map(cache.activities.items.map(item => [item.id, item]))
    for (const item of found) if (!merged.has(item.id)) merged.set(item.id, item)
    // 报名截止的不用再留：页面不给，core 那边也不会再报它是新的。
    const items = [...merged.values()].filter(item => Date.parse(item.closes) > now).slice(-KEEP_ACTIVITIES)
    this.write({ ...cache, activities: { items, fetchedAt: error ? cache.activities.fetchedAt : triedAt, triedAt, error } })
  }
}
