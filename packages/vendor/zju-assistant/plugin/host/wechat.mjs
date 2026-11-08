/** 微信公众号插件：只用微信读书查找文章，半小时同步一次。 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { CORE_ROOT, nodeEnv } from './core.mjs'

export const WECHAT_PLUGIN = 'zju-wechat'
const OFF = '「微信公众号」在插件页「ZJU All-in-One Assistant」里关着，请先打开它。'
const MINUTE = 60_000
/** 多久把跟踪的号看一遍。 */
export const CHECK_MS = 30 * MINUTE
/** 微信读书说访问太频繁以后，隔多久再去问它。 */
const LIMITED_MS = 120 * MINUTE
/** 这两种要用户本人处理，后台不自己再试。 */
const NEEDS_USER = ['verification_required', 'login_required']
/** 只说明某一个号读不到的结果；别的失败说明整个来源这次用不了。 */
const ACCOUNT_ONLY = ['account_not_found', 'remote_rejected', 'invalid_response']
/** 一个号一次读最近几篇，缓存里最多留几篇。 */
const RECENT = 20, KEEP = 50

const text = value => typeof value === 'string' ? value.trim() : ''
const byTime = (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
/** 包括旧缓存里的错误短链：用已有的文章编号恢复微信读书正文地址，无需重新同步。 */
const articleUrl = article => /^MP_WXS_\d+_[\w~-]+$/.test(article.id)
  ? `https://weread.qq.com/web/mp/content?reviewId=${encodeURIComponent(article.id)}` : article.url

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

/**
 * 跑一条 weread 技能的命令，返回它输出的 JSON：成功是 { ok: true, … }，失败是 { ok: false, status, message }。
 * interactive 为假表示没有人在场，技能要扫码、要用户自己验证时不开窗口，直接返回 login_required、verification_required。
 * env 是只给这一次的环境变量：插件经它告诉技能浏览器的管道在哪（WEREAD_BROWSER_ENDPOINT，weread-bridge.mjs）、数据放哪（WEREAD_DATA_DIR）。
 */
export function runWeread(args, { interactive = false, timeoutMs = 130_000, signal, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('已停止')); return }
    const child = spawn(process.execPath, [path.join(CORE_ROOT, 'weread', 'scripts', 'weread.ts'), ...args], {
      env: nodeEnv({ ...env, WEREAD_INTERACTIVE: interactive ? '1' : '0' }), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    const stop = () => { child.kill(); reject(new Error('已停止')) }
    const timer = setTimeout(() => { child.kill(); reject(new Error('公众号这一步一直没有做完，稍后再试。')) }, timeoutMs)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
    child.once('error', (error) => { done(); reject(error) })
    child.once('close', () => {
      done()
      try {
        const result = JSON.parse(output)
        if (typeof result?.ok !== 'boolean') throw new Error('not a result')
        resolve(result)
      } catch { reject(new Error('公众号功能没有给出结果，重新打开应用后再试。')) }
    })
  })
}

export class Wechat {
  /**
   * plugins 是插件开关；settingsFile、cacheFile 是上面说的两个文件；run 跑一条技能命令。
   */
  constructor({ plugins, settingsFile, cacheFile, run = runWeread, now = () => Date.now(), env = process.env, schedule = setInterval, cancel = clearInterval, onNew = () => {} }) {
    // onNew：一次检查读到了新出现的文章时叫它（给托盘的提醒用），参数是这些文章，从新到旧，各带号名 from。
    Object.assign(this, { plugins, settingsFile, cacheFile, run, now, env, schedule, cancel, onNew })
    this.queue = Promise.resolve()
    this.pending = 0
    this.controllers = new Set()
    this.activity = ''
    this.problem = ''
    this.disposed = false
  }

  enabled() { return !this.disposed && !this.plugins.disabled().includes(WECHAT_PLUGIN) }
  requireEnabled() { if (!this.enabled()) throw new Error(OFF) }

  settings() {
    const saved = readJson(this.settingsFile) ?? {}
    return { autoVerify: saved.autoVerify !== false }
  }

  cache() {
    if (this.memory) return this.memory
    const saved = readJson(this.cacheFile) ?? {}
    this.memory = {
      accounts: Array.isArray(saved.accounts) ? saved.accounts.map(account => ({ ...account,
        articles: account.articles.map(article => ({ ...article, url: articleUrl(article) })),
      })) : [],
      // 微信读书上一次读的情况：{ ok, status, message, at }，还没读过是 null。
      sources: { web: saved.sources?.web ?? null },
      loggedIn: saved.loggedIn === true,
      // 上一次检查是什么时候（做没做成都算）。
      checkedAt: typeof saved.checkedAt === 'string' ? saved.checkedAt : null,
    }
    return this.memory
  }

  write(patch) {
    this.memory = { ...this.cache(), ...patch }
    writeJson(this.cacheFile, this.memory)
  }

  /** 页面要的全部内容，只看已经存下的。activity 是现在正在做的事，problem 是用户上一次操作没成的原因。 */
  snapshot() {
    const cache = this.cache(), settings = this.settings()
    return {
      enabled: this.enabled(), busy: this.pending > 0, activity: this.activity, problem: this.problem, settings, checkedAt: cache.checkedAt,
      weread: { loggedIn: cache.loggedIn, state: cache.sources.web },
      accounts: cache.accounts.map(({ biz, name, source, articles, error }) => ({ biz, name, source, count: articles.length, latest: articles[0] ?? null, error })),
    }
  }

  /** 给「校园事务」的通知：跟踪的号已经存下的文章，从新到旧。attention 不为空时有的号要用户去插件页处理一下才能接着读。 */
  articles({ limit = 100 } = {}) {
    this.requireEnabled()
    const { accounts } = this.cache()
    const waiting = accounts.find(account => NEEDS_USER.includes(account.error?.status))
    return {
      articles: accounts.flatMap(account => account.articles.map(article => ({ ...article, from: account.name }))).sort(byTime).slice(0, limit),
      attention: waiting ? waiting.error.status : '',
    }
  }

  /**
   * 读一篇文章的全文（通知加到备忘录时总结用，见 notice-memo.mjs），返回技能给的那篇：{ title, markdown, … }。
   * 没有人在场：要扫码、要用户自己验证的时候不开窗口，照技能的话说读不了。和别的检查排着队做。
   */
  article(url) {
    return this.serial(async () => {
      const result = await this.call(['read', '--url', url])
      if (!result.ok) throw new Error(result.message)
      return result.article
    }, '正在读文章')
  }

  async call(args, { interactive = false } = {}) {
    const controller = new AbortController()
    this.controllers.add(controller)
    // 要人操作的（扫码、验证）技能自己最多等五分钟。
    try { return await this.run(args, { interactive, signal: controller.signal, timeoutMs: interactive ? 320_000 : 130_000 }) }
    finally { this.controllers.delete(controller) }
  }

  /** 一次只做一件：使用浏览器都不能两件事叠着来。activity 是做这件事时页面上显示的状态。 */
  serial(operation, activity = '') {
    this.pending++
    const work = this.queue.then(async () => {
      this.requireEnabled()
      this.activity = activity
      try { return await operation() } finally { this.activity = '' }
    })
    this.queue = work.catch(() => {})
    return work.finally(() => { this.pending-- })
  }

  /** 用户点的、要等一阵的事放到后台做，页面靠 snapshot 的 busy 和 problem 知道做完没有、成没成。 */
  background(operation, activity) {
    this.problem = ''
    this.serial(async () => {
      try { await operation() } catch (error) { if (this.enabled()) this.problem = error.message }
    }, activity).catch(() => {})
    return this.snapshot()
  }

  /** 一个来源这次读成了，或者整个用不了（只是某个号没找到的不算）。 */
  noteSource(source, result) {
    if (!result.ok && ACCOUNT_ONLY.includes(result.status)) return
    const at = new Date(this.now()).toISOString(), { sources } = this.cache()
    this.write({ sources: { ...sources, [source]: result.ok ? { ok: true, at } : { ok: false, status: result.status, message: result.message, at } } })
  }

  /** 跟踪名单以技能那一份为准（助手也可能加了、去掉了号）：照它增减缓存里的号。tracked 是技能刚给的名单，不给就现问。 */
  async reconcile(tracked) {
    if (!tracked) {
      const result = await this.call(['track'])
      if (!result.ok) throw new Error(result.message)
      tracked = result.tracked
    }
    const old = new Map(this.cache().accounts.map(account => [account.biz, account]))
    this.write({ accounts: tracked.map(({ biz, name }) => ({ biz, source: null, articles: [], error: null, ...old.get(biz), name })) })
  }

  /** 微信读书有没有登录记录。只看浏览器里存着的，不联网；过没过期要到读的时候才知道。 */
  async checkLogin() {
    const result = await this.call(['login', '--check'])
    if (result.ok) this.write({ loggedIn: result.loggedIn === true })
  }

  /** 微信读书现在不该自己去问：要用户处理的等到用户来，被限频的等过了那一阵。用户在场（interactive）时不等。 */
  webWaiting(interactive) {
    const state = this.cache().sources.web
    if (interactive || !state || state.ok) return false
    if (NEEDS_USER.includes(state.status)) return true
    return state.status.endsWith('rate_limited') && this.now() - Date.parse(state.at) < LIMITED_MS
  }

  /**
   * 读一遍跟踪的号最近的文章，记进缓存。
   */
  async read({ interactive }) {
    const cache = this.cache()
    if (!cache.accounts.length) return
    if (!cache.loggedIn || this.webWaiting(interactive)) {
      if (!cache.loggedIn) this.write({ accounts: cache.accounts.map(account => ({ ...account, error: { status: 'login_required', message: '请先登录微信读书。' } })) })
      return
    }
    const result = await this.call(['list', '--limit', String(RECENT)], { interactive })
    if (!result.ok) throw new Error(result.message)
    const at = new Date(this.now()).toISOString(), found = new Map(result.accounts.map(account => [account.biz, account]))
    const accounts = this.cache().accounts.map((old) => {
      const entry = found.get(old.biz)
      if (!entry) return old
      if (entry.error) return { ...old, error: entry.error }
      // 第一次读到的文章建立基线，之后才记录新出现的文章。
      const same = old.source === 'web', known = new Map((same ? old.articles : []).map(article => [article.id, article]))
      const fresh = entry.articles.map(article => ({
        id: article.id, title: article.title, url: articleUrl(article), publishedAt: article.publishedAt ?? null,
        foundAt: known.has(article.id) ? known.get(article.id).foundAt : same ? at : null,
      }))
      const listed = new Set(fresh.map(article => article.id))
      return { ...old, source: 'web', error: null, articles: [...fresh, ...(same ? old.articles.filter(article => !listed.has(article.id)) : [])].sort(byTime).slice(0, KEEP) }
    })
    const sources = { ...this.cache().sources }
    if (result.state) sources.web = { ...result.state, at }
    this.write({ accounts, sources })
    // 这一次才出现的文章（发现时间就是这一次）：告诉外面一声。一个号第一次读到的不算，它们的发现时间是空的。
    const fresh = accounts.flatMap(account => account.articles.filter(article => article.foundAt === at).map(article => ({ ...article, from: account.name }))).sort(byTime)
    if (fresh.length) { try { this.onNew(fresh) } catch { /* 提醒发不出去不影响读文章 */ } }
  }

  /** 一次完整的检查：对一遍跟踪名单，看一眼微信读书的登录状态，再读一遍文章。 */
  async check({ interactive }) {
    const at = new Date(this.now()).toISOString()
    try {
      await this.reconcile()
      await this.checkLogin()
      await this.read({ interactive })
    } finally { this.write({ checkedAt: at }) }
  }

  /** 详情页打开时：对一遍名单和登录状态（都不联网、不读微信），页面先照缓存画。文章等定时的那一次。 */
  visit() {
    if (!this.enabled() || this.pending) return this.snapshot()
    this.serial(async () => { await this.reconcile(); await this.checkLogin() }).catch(() => {})
    return this.snapshot()
  }

  /** 详情页上用户点的「去验证」「再试一次」：马上检查一遍，要用户自己验证就开窗口。 */
  retry() {
    this.requireEnabled()
    return this.background(() => this.check({ interactive: true }), 'checking')
  }

  /** 「校园事务」页的刷新：马上检查一遍，等它做完；不开窗口。正在检查就等那一次。 */
  async refresh() {
    this.requireEnabled()
    if (this.pending) { await this.queue; return }
    await this.serial(() => this.check({ interactive: false }), 'checking')
  }

  /** 从微信读书书架找能跟踪的公众号。 */
  async find(input) {
    const source = 'web'
    return this.serial(async () => {
      const result = await this.call(['accounts'], { interactive: true })
      this.noteSource(source, result)
      if (result.ok) return { ok: true, source, accounts: result.accounts }
      return result.status === 'account_not_found' ? { ok: true, source, accounts: [] } : { ok: false, source, status: result.status, message: result.message }
    }, 'finding')
  }

  /** 开始跟踪一个号。它现有的文章随后在后台读，页面先看到它已经在名单里。 */
  async track(input) {
    const name = text(input?.name)
    if (!name) throw new Error('请选择一个公众号')
    const snapshot = await this.serial(async () => {
      const result = await this.call(['track', '--account', name], { interactive: true })
      if (!result.ok) throw new Error(result.message)
      await this.reconcile(result.tracked)
      return this.snapshot()
    }, 'tracking')
    this.serial(() => this.read({ interactive: true }), 'checking').catch(() => {})
    return { ...snapshot, busy: true }
  }

  async untrack(input) {
    const biz = text(input?.biz)
    return this.serial(async () => {
      const account = this.cache().accounts.find(item => item.biz === biz)
      if (!account) throw new Error('这个公众号不在跟踪名单里')
      const result = await this.call(['track', '--account', account.name, '--cancel'])
      if (!result.ok) throw new Error(result.message)
      await this.reconcile(result.tracked)
      return this.snapshot()
    }, 'tracking')
  }

  /** 打开扫码窗口登录微信读书。要等用户扫码，所以放到后台；登录好以后把要靠它读的号读一遍。 */
  login() {
    this.requireEnabled()
    return this.background(async () => {
      const result = await this.call(['login'], { interactive: true })
      // 用户自己把窗口关了不算出错。
      if (!result.ok) { if (result.status === 'login_cancelled') return; throw new Error(result.message) }
      this.write({ loggedIn: true, sources: { ...this.cache().sources, web: null } })
      await this.check({ interactive: true })
    }, 'login')
  }

  async logout() {
    return this.serial(async () => {
      const result = await this.call(['logout'])
      if (!result.ok) throw new Error(result.message)
      this.write({ loggedIn: false, sources: { ...this.cache().sources, web: null } })
      return this.snapshot()
    }, 'logout')
  }

  /** 自动验证设置变更后重新检查。 */
  set(input) {
    const next = this.settings()
    for (const key of ['autoVerify']) if (typeof input?.[key] === 'boolean') next[key] = input[key]
    writeJson(this.settingsFile, next)
    const { sources } = this.cache()
    if (input?.autoVerify === true && sources.web?.status === 'verification_required') this.write({ sources: { ...sources, web: null } })
    if (this.enabled() && input?.autoVerify === true) this.serial(() => this.check({ interactive: false }), 'checking').catch(() => {})
    return this.snapshot()
  }

  /** 到点了就检查一次；正忙着就等下一轮。 */
  async tick() {
    if (!this.enabled() || this.pending) return
    const { checkedAt } = this.cache()
    if (checkedAt && this.now() - Date.parse(checkedAt) < CHECK_MS) return
    await this.serial(() => this.check({ interactive: false }), 'checking').catch(() => {})
  }

  /** 插件的开关变了：关掉时停下正在跑的命令，打开时马上检查一次。 */
  changed() {
    if (this.enabled()) void this.tick()
    else { for (const controller of this.controllers) controller.abort(); this.problem = '' }
  }

  start() {
    this.timer = this.schedule(() => { void this.tick() }, MINUTE)
    this.timer?.unref?.()
    void this.tick()
    return () => this.dispose()
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) this.cancel(this.timer)
    for (const controller of this.controllers) controller.abort()
  }
}
