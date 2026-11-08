/**
 * 「校园事务」通知栏的「个人消息」里 CC98 的那一份：本人收到的回复、@、系统消息，和未读私信的摘要。
 * 用 ZJU Core 的 `cc98 account notifications` 读，每个已填的 CC98 账号各读各的，按账号分开存；
 * 删掉或换掉的账号，它的消息不再给页面。论坛十大、全站帖子、关注的版面都不在这里。
 *
 * 私信只取摘要：`account notifications` 只在有未读私信时带上各会话最新的一条，读的是最近联系人列表，不会把私信标成已读；
 * 不用 `private-message list/view`，那两条读会话时 CC98 会把对方的私信标成已读。所以私信每个会话只有最新一条，不是完整的对话。
 *
 * 去重靠平台给的编号：回复、@、系统消息用消息编号，私信用对方的编号加最新一条的精确时间。
 * 第一次读一个账号只记下最近的一页当作基线，不当成刚收到的；之后某一类一页全是没见过的，再往后翻页，最多翻几页，
 * 翻不完的不推进，下次接着补，不会悄悄跳过。缓存放在缓存目录，随时可以重读。
 * 不开着页面时由 feed.mjs 的后台定时来叫 check()（排在经 WebVPN 的那条队里）；基线以后新来的交给 onNew（托盘的提醒），基线里的不算。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { accountIndexes, accountReady, numberedKeys, TRANSPORT } from '../accounts.mjs'
import { runCore } from './core.mjs'

export const CC98_PLUGIN = 'zju-community'
/** 读成功以后，这么久之内再进页面不重读；点刷新不受限制。读失败以后隔一阵再自动重试，免得密码填错时反复登录。 */
const FRESH_MS = 10 * 60_000, RETRY_MS = 5 * 60_000
/** 后台定时的那一次隔多久读一个账号；读失败以后隔得更久，密码填错时不反复去登录。 */
export const CHECK_MS = 15 * 60_000, CHECK_RETRY_MS = 30 * 60_000
/** 一页取多少条（服务端单次最多 20），一类最多往后再翻几页。 */
const PAGE = 20, MORE_PAGES = 3
/** 每个账号最多留多少条、记住多少个见过的编号。 */
const KEEP = 200, SEEN = 2000
const KINDS = ['reply', 'at', 'system']
const text = value => typeof value === 'string' ? value.trim() : ''
const iso = value => { const at = Date.parse(text(value)); return Number.isFinite(at) ? new Date(at).toISOString() : '' }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

/**
 * `account notifications` 结果里的一条变成页面的一行；缺编号或时间的不要（那样去不了重）。
 * kind 是 reply、at、system 或 message；account 是哪个 CC98 账号收到的。
 */
export function fromCc98(entry, kind, account, foundAt) {
  const at = iso(entry?.at), from = text(entry?.from), content = typeof entry?.content === 'string' ? entry.content.trim() : ''
  if (!at) return undefined
  let key, title
  if (kind === 'message') {
    if (!Number.isInteger(entry.userId)) return undefined
    key = `${entry.userId}:${at}`
    title = `${from || '有人'}发来私信`
  } else {
    if (!Number.isInteger(entry.id)) return undefined
    key = String(entry.id)
    const topic = text(entry.topic)
    title = kind === 'system' ? text(entry.title) || '系统消息'
      : kind === 'reply' ? `${from || '有人'}回复了${topic ? `「${topic}」` : '你'}`
      : `${from || '有人'}在${topic ? `「${topic}」里` : '帖子里'} @ 了你`
  }
  const url = URL.parse(text(entry.url))
  return {
    id: `cc98:${account}:${kind}:${key}`, kind: 'cc98', cc98Kind: kind, account, title, from: from || 'CC98', at, dated: true,
    // 只认 CC98 自己的链接；私信没有网页链接，不编一个。
    url: url && /(^|\.)cc98\.org$/.test(url.hostname) && url.protocol === 'https:' ? url.href : '',
    foundAt, body: content, ...(text(entry.note) ? { note: text(entry.note) } : {}),
  }
}

export class Cc98Feed {
  /** file 是缓存文件；account 读账号表；plugins 是插件开关；run 跑一条 ZJU Core 命令并返回 data；onNew 收到这一趟各账号新来的（从新到旧）。 */
  constructor({ file, account, plugins, run = runCore, now = () => Date.now(), onNew = () => {} }) {
    Object.assign(this, { file, account, plugins, run, now, onNew })
    this.cache = undefined
    this.running = undefined
  }

  load() {
    if (this.cache) return this.cache
    const saved = readJson(this.file)
    this.cache = { accounts: saved?.accounts && typeof saved.accounts === 'object' ? saved.accounts : {}, triedAt: saved?.triedAt ?? null }
    return this.cache
  }

  save(cache) { this.cache = cache; writeJson(this.file, cache) }

  /** 账号表里填好的 CC98 账号的用户名，按填的次序。 */
  usernames() {
    const values = this.account.read().data
    return accountIndexes(values, 'cc98').flatMap((index) => {
      const keys = numberedKeys('cc98', index), username = text(values[keys.user])
      return username && values[keys.secret] ? [username] : []
    })
  }

  /** off：「校园社区」关着；account：CC98 账号没填，或者要经 WebVPN 而 WebVPN 账号没填。 */
  status() {
    if (this.plugins.disabled().includes(CC98_PLUGIN)) return { state: 'off', plugin: CC98_PLUGIN }
    const values = this.account.read().data
    if (!this.usernames().length) return { state: 'account', plugin: CC98_PLUGIN }
    if (values[TRANSPORT.key] !== 'direct' && !accountReady(values, 'webvpn')) return { state: 'account', plugin: 'zju-account' }
    return { state: 'ready', plugin: CC98_PLUGIN }
  }

  /** 只看缓存：现在还填着的账号收到的消息，和这一来源的情况。 */
  snapshot() {
    const status = this.status(), cache = this.load(), names = status.state === 'ready' ? this.usernames() : []
    const records = names.map(name => cache.accounts[name]).filter(Boolean)
    const items = records.flatMap(record => record.items ?? [])
    const fetched = records.map(record => record.fetchedAt).filter(Boolean).sort()
    const errors = names.flatMap(name => cache.accounts[name]?.error ? [names.length > 1 ? `${name}：${cache.accounts[name].error}` : cache.accounts[name].error] : [])
    return {
      items,
      source: { id: 'cc98', kind: 'cc98', name: 'CC98', state: status.state, plugin: status.plugin, fetchedAt: fetched[0] ?? null, error: errors.join('；') || null },
    }
  }

  /** 到点了（或 force）就把每个账号读一遍；同一时间只读一趟。 */
  async refresh({ force = false } = {}) {
    if (this.status().state !== 'ready') return this.snapshot()
    this.running ??= this.read({ force }).finally(() => { this.running = undefined })
    await this.running
    return this.snapshot()
  }

  /** 后台定时的那一次：和 refresh 一样，只是隔得久一些。 */
  async check() {
    if (this.status().state !== 'ready') return
    this.running ??= this.read({ freshMs: CHECK_MS, retryMs: CHECK_RETRY_MS }).finally(() => { this.running = undefined })
    await this.running
  }

  /** 每个账号上次读过（成没成都算）到现在够久了就读（force 时照读）。 */
  async read({ force = false, freshMs = FRESH_MS, retryMs = RETRY_MS } = {}) {
    const names = this.usernames()
    // 删掉的账号连缓存一起丢掉，不留着别人的消息。
    const kept = Object.fromEntries(Object.entries(this.load().accounts).filter(([name]) => names.includes(name)))
    this.save({ ...this.load(), accounts: kept })
    // 一个一个读：都经 WebVPN，会话文件是共用的。
    const added = []
    for (const name of names) {
      const record = this.load().accounts[name]
      const due = force || !record?.triedAt || this.now() - Date.parse(record.triedAt) >= (record.error ? retryMs : freshMs)
      if (due) added.push(...await this.fetch(name))
    }
    // 几个账号的合成一条提醒，免得一趟读下来托盘上冒好几条。
    // 读的时候插件被关了就不提醒了。
    if (added.length && !this.plugins.disabled().includes(CC98_PLUGIN)) { try { this.onNew(added.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) } catch { /* 提醒发不出去不影响读消息 */ } }
  }

  /** 读一个账号，返回这一趟才见到的（基线里的不算）。 */
  async fetch(name) {
    const triedAt = new Date(this.now()).toISOString(), before = this.load().accounts[name]
    const baseline = !before?.fetchedAt
    const seen = new Set(before?.seen ?? []), found = new Map()
    let error = null, overflow = []
    const call = args => this.run(['cc98', 'account', 'notifications', '--account', name, ...args], { system: 'CC98', timeoutMs: 180_000 })
    const take = (entries, kind) => {
      const rows = (Array.isArray(entries) ? entries : []).flatMap(entry => fromCc98(entry, kind, name, triedAt) ?? [])
      for (const row of rows) if (!found.has(row.id)) found.set(row.id, row)
      return rows
    }
    try {
      const data = await call(['--size', String(PAGE)])
      if (!Array.isArray(data?.groups)) throw new Error('CC98 给的格式不对。')
      for (const group of data.groups) {
        const kind = text(group?.kind)
        if (kind !== 'message' && !KINDS.includes(kind)) continue
        let rows = take(group.items, kind), page = 0
        // 这一页满了而且全是没见过的，更早的可能还有新的，往后翻；第一次读是基线，不翻。私信摘要只有一页。
        while (kind !== 'message' && !baseline && rows.length === PAGE && rows.every(row => !seen.has(row.id))) {
          if (++page > MORE_PAGES) { overflow.push(kind); break }
          rows = take((await call(['--kind', kind, '--from', String(page * PAGE), '--size', String(PAGE)]))?.items, kind)
        }
      }
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    // 账号在读的时候被删了或者插件被关了：读到的不要，也不记错。
    if (!this.usernames().includes(name) || this.plugins.disabled().includes(CC98_PLUGIN)) return []
    const cache = this.load(), merged = new Map((before?.items ?? []).map(item => [item.id, item])), added = []
    // 中途出错的那一趟不记进去：已经读到的前几页先记成见过，下一趟翻到见过的就停，会漏掉没翻到的那几页。
    // 翻到上限还没翻完的照样记下，但要明说更早的没有读，不悄悄当作读全了。
    if (overflow.length) error = `新消息超过 ${(MORE_PAGES + 1) * PAGE} 条，更早的这里没有读，请到 CC98 查看`
    if (!error || overflow.length) {
      for (const item of found.values()) {
        if (merged.has(item.id) || seen.has(item.id)) continue
        // 基线里的是以前就有的：出现时间记成它自己的时间，页面不把它们当成新来的。
        merged.set(item.id, baseline ? { ...item, foundAt: item.at } : item)
        seen.add(item.id)
        if (!baseline) added.push(item)
      }
    }
    const items = [...merged.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, KEEP)
    const failed = error && !overflow.length
    const record = { items, seen: [...seen].slice(-SEEN), fetchedAt: failed ? before?.fetchedAt ?? null : triedAt, triedAt, error }
    this.save({ ...cache, accounts: { ...cache.accounts, [name]: record } })
    return added
  }
}
