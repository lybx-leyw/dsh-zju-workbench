/**
 * 「校园事务」通知栏的「个人消息」里浙大邮箱的那一份：收件箱新到的邮件，只有主题、发件人和时间；正文和附件等用户点开时再读（mail.mjs 的 read）。
 * 新来信按 UID 认：记着上次读到的最大 UID 和那时收件箱的 UIDVALIDITY，下次只取比它大的。UIDVALIDITY 变了（目录重建）就重新建基线，
 * 旧的条目不再给页面，免得拿旧编号打开错信。一次取不完的接着取，进度只推进到真取到的那一封。
 * 第一次连上只取最近的一页当基线，出现时间记成邮件自己的时间，不当成刚收到的。
 * 收件箱只读打开，不碰服务器上的已读；页面上「看过」是另一回事。换了邮箱账号、断开或者关掉插件，旧账号的邮件都不再给页面。
 * 不开着页面时由 feed.mjs 的后台定时来叫 check()；基线以后新到的信交给 onNew（托盘的提醒），基线里的不算。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const MAIL_PLUGIN = 'zju-mail'
/** 读成功以后，这么久之内再进页面不重读；点刷新不受限制。读失败以后隔一阵再自动重试。 */
const FRESH_MS = 5 * 60_000, RETRY_MS = 5 * 60_000
/** 后台定时的那一次隔多久读一次；读失败以后隔得更久，专用密码失效时不反复去登录。 */
export const CHECK_MS = 15 * 60_000, CHECK_RETRY_MS = 30 * 60_000
/** 一次最多取几封、一趟最多取几次；留多少封。 */
const BATCH = 200, ROUNDS = 5, KEEP = 300
const text = value => typeof value === 'string' ? value.trim() : ''

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

/** 收件箱里的一封变成页面的一行。编号带着账号、目录、UIDVALIDITY 和 UID，打开时照它们去读，对不上就不读。 */
export function fromMail(message, { accountId, mailbox, uidValidity }, foundAt) {
  if (!Number.isSafeInteger(message?.uid) || message.uid < 1) return undefined
  const sender = message.from?.[0] ?? {}, at = message.receivedAt || message.date || foundAt
  return {
    id: `mail:${accountId.slice(0, 16)}:${mailbox}:${uidValidity}:${message.uid}`, kind: 'mail', title: text(message.subject) || '（无主题）',
    from: text(sender.name) || text(sender.address) || '未知发件人', address: text(sender.address), at, dated: true, url: '', foundAt,
    accountId, mailbox, uid: message.uid, uidValidity,
  }
}

export class MailFeed {
  /** mail 是浙大邮箱插件（mail.mjs）；file 是缓存文件；onNew 收到这一趟新到的信（从新到旧）。 */
  constructor({ mail, file, now = () => Date.now(), onNew = () => {} }) {
    Object.assign(this, { mail, file, now, onNew })
    this.cache = undefined
    this.running = undefined
  }

  load() {
    if (this.cache) return this.cache
    const saved = readJson(this.file)
    this.cache = saved && typeof saved === 'object' ? saved : {}
    return this.cache
  }

  save(cache) { this.cache = cache; writeJson(this.file, cache) }

  /** off：插件关着；account：还没连接邮箱。 */
  status() {
    if (!this.mail.enabled()) return { state: 'off' }
    return this.mail.account() ? { state: 'ready' } : { state: 'account' }
  }

  /** 缓存里属于现在这个账号的才给。 */
  current() {
    const cache = this.load(), id = this.mail.account()?.id
    return id && cache.accountId === id ? cache : undefined
  }

  snapshot() {
    const status = this.status(), cache = status.state === 'ready' ? this.current() : undefined
    return {
      items: cache?.items ?? [],
      source: { id: 'mail', kind: 'mail', name: '邮箱', plugin: MAIL_PLUGIN, state: status.state, fetchedAt: cache?.fetchedAt ?? null, error: cache?.error ?? null },
    }
  }

  async refresh({ force = false } = {}) {
    if (this.status().state !== 'ready') return this.snapshot()
    const cache = this.current()
    const due = force || !cache?.triedAt || this.now() - Date.parse(cache.triedAt) >= (cache.error ? RETRY_MS : FRESH_MS)
    if (due) {
      this.running ??= this.read().finally(() => { this.running = undefined })
      await this.running
    }
    return this.snapshot()
  }

  /** 后台定时的那一次：上次读过（成没成都算）够久了才读。 */
  async check() {
    if (this.status().state !== 'ready') return
    const cache = this.current()
    if (cache?.triedAt && this.now() - Date.parse(cache.triedAt) < (cache.error ? CHECK_RETRY_MS : CHECK_MS)) return
    await this.refresh({ force: true })
  }

  async read() {
    const account = this.mail.account()
    if (!account) return
    // 助手正在用邮箱（查信、发信）时等它做完，不和它抢。
    await this.mail.idle()
    const triedAt = new Date(this.now()).toISOString()
    let state = this.current() ?? { accountId: account.id, items: [], fetchedAt: null }
    let error = null
    const added = []
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const result = await this.mail.inbox({ after: state.uidValidity ? state.last : undefined, uidValidity: state.uidValidity, max: BATCH })
        if (result.accountId !== account.id) throw new Error('邮箱账号已经换了。')
        // 基线里的是以前就有的，出现时间记成邮件自己的时间；目录重建以后旧编号作废，旧条目丢掉。
        const fresh = result.messages.flatMap(message => fromMail(message, result, result.baseline ? message.receivedAt || message.date || triedAt : triedAt) ?? [])
        const items = new Map((result.baseline ? [] : state.items).map(item => [item.id, item]))
        if (result.baseline) added.length = 0
        for (const item of fresh) {
          if (items.has(item.id)) continue
          items.set(item.id, item)
          if (!result.baseline) added.push(item)
        }
        state = { ...state, uidValidity: result.uidValidity, last: result.last, items: [...items.values()].sort((a, b) => b.uid - a.uid).slice(0, KEEP) }
        if (!result.more) break
        if (round === ROUNDS - 1) error = '新邮件太多，这次没取完，下次接着取'
      }
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    // 读的时候断开、换了账号或者关了插件：这一趟的结果不要，也不记错。
    if (!this.mail.enabled() || this.mail.account()?.id !== account.id) return
    this.save({ ...state, fetchedAt: error ? state.fetchedAt : triedAt, triedAt, error })
    // 中途出错时已经取到、记下了的那几封也算，下一趟不会再取到它们。
    if (added.length) { try { this.onNew(added.sort((a, b) => b.uid - a.uid)) } catch { /* 提醒发不出去不影响收信 */ } }
  }
}
