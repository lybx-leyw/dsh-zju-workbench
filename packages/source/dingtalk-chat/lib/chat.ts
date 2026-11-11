/** Resolve names, read conversations, contacts, members and messages, and page results, all read-only. */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { parseContent, type Content } from './content.ts'
import { SkillError } from './errors.ts'
import {
  casefold, codePoints, compareKeys, contains, int, or, pythonJson, str, strip, toBig, truthy,
  type Key, type Row, type Value,
} from './values.ts'

const TZ_MS = 8 * 3600 * 1000
/** A small integer column (a count, status or role) as a plain number, matching the former integer output. */
const small = (value: Value | undefined): number | null => value === null || value === undefined ? null : Number(value)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/

const daysInMonth = (year: number, month: number) => [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!

/** Milliseconds for a YYYY-MM-DD at UTC+8 midnight, or a timezone-bearing ISO time. Invalid input is rejected. */
export function dateMs(value: string): number {
  const bad = () => new SkillError('invalid_input', '时间请写有效 YYYY-MM-DD（UTC+8 零点）或带时区的 ISO 时间。')
  if (DATE.test(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw bad()
    return Date.UTC(year, month - 1, day) - TZ_MS
  }
  const match = DATETIME.exec(value)
  if (!match) throw bad()
  const [, y, mo, d, h, mi, s, frac, zone] = match
  const year = +y!, month = +mo!, day = +d!, hour = +h!, minute = +mi!, second = s ? +s : 0
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) throw bad()
  const ms = frac ? +frac.padEnd(3, '0') : 0
  const offset = zone === 'Z' ? 0 : (zone![0] === '-' ? -1 : 1) * (+zone!.slice(1, 3) * 60 + +zone!.slice(4, 6))
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60000
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
/** A millisecond timestamp as a UTC+8 ISO string with milliseconds, or null when it is missing or out of range. */
export function iso(value: Value | undefined): string | null {
  if (!truthy(value)) return null
  const ms = Number(value)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms + TZ_MS)
  if (Number.isNaN(date.getTime())) return null
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}+08:00`
}

export type Record = { [key: string]: unknown }

/** By exact id, then exact name on any field, then a unique partial match; ambiguity returns candidates. */
export function resolve(selector: string, rows: Record[], status: string, fields = ['name']): Record {
  const byId = rows.filter(row => row.id === selector)
  if (byId.length === 1) return byId[0]!
  const folded = casefold(selector)
  const exact = rows.filter(row => fields.some(field => casefold(truthy(row[field]) ? str(row[field]) : '') === folded))
  const found = exact.length ? exact : rows.filter(row => contains(selector, ...fields.map(field => row[field])))
  if (!found.length) throw new SkillError(status + '_not_found', '没有找到匹配记录，请先查询 list、contacts 或 members，使用准确 ID。')
  if (found.length !== 1) {
    throw new SkillError(status + '_ambiguous', '名称匹配到多条记录，请使用 candidates 中的准确 ID。', {
      candidates: found.slice(0, 50).map(row => Object.fromEntries((['id', 'name'] as const).filter(key => key in row).map(key => [key, row[key]]))),
      totalCandidates: found.length,
    })
  }
  return found[0]!
}

/** The limit+1 smallest items by key, ascending, kept bounded as the source is consumed. */
function smallest<T>(limit: number, items: Iterable<T>, keyOf: (item: T) => Key): { item: T; key: Key }[] {
  const kept: { item: T; key: Key }[] = []
  for (const item of items) {
    const entry = { item, key: keyOf(item) }
    let lo = 0, hi = kept.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (compareKeys(kept[mid]!.key, entry.key) <= 0) lo = mid + 1; else hi = mid }
    kept.splice(lo, 0, entry)
    if (kept.length > limit + 1) kept.pop()
  }
  return kept
}

export interface Query {
  op: string
  limit?: number
  cursor?: string
  chat?: string
  query?: string
  sender?: string
  kind?: string
  type?: string
  since?: number
  until?: number
}
export interface Paging { hasMore: boolean; nextCursor: string | null }

const CURSOR = /^[A-Za-z0-9_-]{1,4096}$/

/** Keyset pagination bound to the account and every filter; a cursor from another query is rejected. */
class Pager {
  private readonly limit: number
  private readonly scope: string
  private readonly keyTypes: ('number' | 'string')[]
  private after: Key | null = null
  constructor(query: Query, profile: string, keyTypes: ('number' | 'string')[]) {
    this.keyTypes = keyTypes
    this.limit = query.limit ?? 50
    const scope: Record = {}
    for (const [key, value] of Object.entries(query)) if (key !== 'limit' && key !== 'cursor' && value !== undefined) scope[key] = value
    this.scope = createHash('sha256').update(pythonJson([profile, scope])).digest('hex')
    const cursor = query.cursor
    if (cursor) {
      try {
        if (!CURSOR.test(cursor)) throw new Error()
        const data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        const after: unknown = data?.after
        if (data?.scope !== this.scope || !Array.isArray(after) || after.length !== keyTypes.length) throw new Error()
        if (after.some((value, at) => typeof value !== keyTypes[at])) throw new Error()
        this.after = after as Key
      } catch {
        throw new SkillError('invalid_cursor', '游标无效或不属于当前账号/查询，请保持筛选条件不变或重新查询。')
      }
    }
  }
  page<T>(rows: Iterable<T>, keyOf: (item: T) => Key): { rows: T[]; paging: Paging } {
    const after = this.after
    const filtered = (function* () { for (const row of rows) if (after === null || compareKeys(keyOf(row), after) > 0) yield row })()
    const selected = smallest(this.limit, filtered, keyOf)
    const more = selected.length > this.limit
    const page = selected.slice(0, this.limit)
    let cursor: string | null = null
    if (more) {
      const payload = { scope: this.scope, after: page[page.length - 1]!.key }
      cursor = Buffer.from(JSON.stringify(payload)).toString('base64url')
    }
    return { rows: page.map(entry => entry.item), paging: { hasMore: more, nextCursor: cursor } }
  }
}

const REQUIRED = ['tbconversation', 'tbuser_profile_v2', 'tbuser_group_nick', 'tbuser_alias_name', 'tblastmsg', 'msg_clear_info']
const nickKey = (cid: string, uid: string) => cid + '\u0000' + uid

export class ChatReader {
  readonly uid: string
  private readonly db: DatabaseSync
  private readonly profile: string
  private readonly membersDb: DatabaseSync | null
  private readonly tables: Set<string>
  private readonly contacts = new Map<string, Record>()
  private readonly groupNicks = new Map<string, string>()
  private readonly chats = new Map<string, Record>()
  private readonly memberTables: string[] = []

  constructor(db: DatabaseSync, uid: string | number, profile: string, membersDb: DatabaseSync | null = null) {
    this.db = db
    this.profile = profile
    this.membersDb = membersDb
    this.uid = str(uid)
    this.tables = new Set((rows(db, "SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name as string))
    if (!REQUIRED.every(name => this.tables.has(name))) throw new SkillError('schema_unsupported', '当前钉钉数据库结构尚不支持。')

    const aliases = new Map<string, Value | undefined>()
    for (const row of rows(db, 'SELECT uid,alias FROM tbuser_alias_name')) aliases.set(str(row.uid), row.alias)
    for (const row of rows(db, 'SELECT uid,nick,alias,dingtaklId FROM tbuser_profile_v2')) {
      const uidText = str(row.uid)
      const remark = or(aliases.get(uidText), row.alias, '')
      this.contacts.set(uidText, {
        id: uidText, name: or(remark, row.nick, uidText), nickname: or(row.nick, ''), remark,
        dingtalkId: or(row.dingtaklId, ''), kind: 'personal',
      })
    }
    for (const row of rows(db, 'SELECT cid,uid,groupNick FROM tbuser_group_nick')) this.groupNicks.set(nickKey(row.cid as string, str(row.uid)), row.groupNick as string)
    if (membersDb) {
      this.memberTables = rows(membersDb, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name as string).filter(name => /^tbmember_\d+$/.test(name)).sort()
      if (!this.memberTables.length) throw new SkillError('schema_unsupported', '当前钉钉群成员库结构尚不支持。')
    }
    const lastTimes = new Map<string, Value | undefined>()
    for (const row of rows(db, 'SELECT cid,MAX(createdAt) AS createdAt FROM tblastmsg GROUP BY cid')) lastTimes.set(row.cid as string, row.createdAt)
    for (const row of rows(db, 'SELECT cid,type,title,alias,originTitle,memberCount,ownerId,createAt,lastModify,unreadCount,status FROM tbconversation')) {
      const cid = row.cid as string
      const typeNum = row.type === null || row.type === undefined ? null : int(row.type)
      const kind = typeNum === 1 ? 'personal' : typeNum === 2 ? 'group' : 'other'
      let peer: string | null = null
      if (kind === 'personal') {
        const ids = cid.split(':').filter(part => part !== this.uid)
        if (ids.length === 1) peer = ids[0]!
      }
      const name = or(row.alias, row.title, peer !== null ? this.contacts.get(peer)?.name : undefined, cid)
      this.chats.set(cid, {
        id: cid, name, kind, rawType: str(row.type), peerId: peer,
        memberCount: small(row.memberCount), ownerId: truthy(row.ownerId) ? str(row.ownerId) : null,
        createdAt: iso(row.createAt), lastMessageAt: iso(lastTimes.get(cid) ?? null),
        updatedAt: iso(row.lastModify), unreadCount: small(row.unreadCount), localStatus: small(row.status),
        _sort: int(or(lastTimes.get(cid), row.lastModify, 0)), _title: row.title, _alias: row.alias, _origin: row.originTitle,
      })
    }
  }

  private chat(selector: string): Record {
    return resolve(selector, [...this.chats.values()], 'chat', ['name', '_title', '_alias', '_origin'])
  }

  private memberRows(chat: Record): Record[] {
    if (chat.kind !== 'group') throw new SkillError('chat_not_group', 'members 需要群聊名称或 ID。')
    if (!this.membersDb) throw new SkillError('database_missing', '未加载本地群成员数据库。')
    const cid = chat.id as string
    const result = new Map<string, Record>()
    for (const table of this.memberTables) {
      for (const row of rows(this.membersDb, `SELECT uid,group_nick,display_name,alias,nick,member_role FROM "${table}" WHERE cid=?`, cid)) {
        const uid = str(row.uid)
        const nick = or(row.group_nick, this.groupNicks.get(nickKey(cid, uid)), '')
        const name = or(nick, row.display_name, row.alias, row.nick, this.contacts.get(uid)?.name, uid)
        result.set(uid, { id: uid, name, groupNickname: nick, nickname: row.nick, remark: row.alias, rawRole: small(row.member_role), isOwner: uid === chat.ownerId })
      }
    }
    return [...result.values()]
  }

  private static publicFields(record: Record): Record {
    return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')))
  }

  query(query: Query): object {
    const op = query.op
    const base: Record = { ok: true, coverage: 'local_synced', profile: this.profile }
    if (op === 'info') return { ...base, chat: ChatReader.publicFields(this.chat(query.chat!)) }
    if (op === 'list' || op === 'contacts' || op === 'members') {
      let list: Record[], keyOf: (row: Record) => Key, keyTypes: ('number' | 'string')[], field: string
      if (op === 'list') {
        list = [...this.chats.values()]
        keyOf = row => [-(row._sort as number), row.id as string]
        keyTypes = ['number', 'string']
        field = 'chats'
      } else if (op === 'contacts') {
        list = [...this.contacts.values()]
        keyOf = row => [casefold(row.name as string), row.id as string]
        keyTypes = ['string', 'string']
        field = 'contacts'
      } else {
        const chat = this.chat(query.chat!)
        list = this.memberRows(chat)
        Object.assign(base, { chat: ChatReader.publicFields(chat), cachedMemberCount: list.length, membershipCoverage: 'local_cached' })
        keyOf = row => [casefold(row.name as string), row.id as string]
        keyTypes = ['string', 'string']
        field = 'members'
      }
      if (query.kind) list = list.filter(row => row.kind === query.kind)
      if (query.query) list = list.filter(row => contains(query.query!, row.id, row.name, row.nickname, row.remark, row.dingtalkId))
      const { rows: page, paging } = new Pager(query, this.profile, keyTypes).page(list, keyOf)
      return { ...base, [field]: page.map(ChatReader.publicFields), ...paging }
    }
    const { rows: page, paging } = new Pager(query, this.profile, ['number', 'string']).page(this.messages(query), row => [-(row._time as number), row.id as string])
    return { ...base, messages: page.map(ChatReader.publicFields), searchScope: 'local_visible_text_and_summaries', ...paging }
  }

  private *messages(query: Query): Generator<Record> {
    const chat = query.chat ? this.chat(query.chat) : null
    let sender: string | null = null
    if (query.sender) {
      if (/^\d+$/.test(query.sender)) {
        sender = query.sender
      } else {
        const people = new Map(this.contacts)
        if (chat && chat.kind === 'group' && this.membersDb) for (const person of this.memberRows(chat)) people.set(person.id as string, person)
        sender = resolve(query.sender, [...people.values()], 'sender', ['name', 'nickname', 'remark', 'groupNickname']).id as string
      }
    }
    const messageTables = [...this.tables].filter(name => /^tbmsg_\d+$/.test(name)).sort()
    if (!messageTables.length) throw new SkillError('schema_unsupported', '没有找到本地消息分表。')
    messageTables.push('tblastmsg')
    const fields = 'primaryKey,cid,localId,mid,senderId,type,createdAt,lastModify,contentType,content,extension,recallStatus,isDecrypt,shieldStatus,version,contentVersion'
    const params: Value[] = []
    const union = messageTables.map(table => {
      let part = `SELECT '${table}' AS source,${fields} FROM "${table}"`
      if (chat) { part += ' WHERE cid=?'; params.push(chat.id as string) }
      return part
    })
    // Fold the history tables and the last-message cache into one row per message, newest edit first, so a stale
    // cache cannot resurrect a recalled or edited message.
    let sql = 'WITH all_msgs AS (' + union.join(' UNION ALL ') + `), ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY cid, CASE WHEN mid>0 THEN 'm:'||mid WHEN localId IS NOT NULL AND localId<>'' THEN 'l:'||localId ELSE source||':'||primaryKey END
        ORDER BY COALESCE(lastModify,0) DESC, COALESCE(version,0) DESC, COALESCE(contentVersion,0) DESC, COALESCE(recallStatus,0) DESC, source ASC
      ) AS rank FROM all_msgs
    ) SELECT * FROM ranked WHERE rank=1`
    if (sender !== null) { sql += ' AND CAST(senderId AS TEXT)=?'; params.push(sender) }
    if (query.since !== undefined) { sql += ' AND createdAt>=?'; params.push(query.since) }
    if (query.until !== undefined) { sql += ' AND createdAt<?'; params.push(query.until) }
    const clears = new Map<string, bigint>()
    for (const row of rows(this.db, 'SELECT cid,clear_timestamp FROM msg_clear_info')) clears.set(row.cid as string, toBig(row.clear_timestamp))
    const members = new Map<string, Record>()
    if (chat && chat.kind === 'group' && this.membersDb) for (const person of this.memberRows(chat)) members.set(person.id as string, person)
    for (const row of rows(this.db, sql, ...params)) {
      const cid = row.cid as string
      const time = int(or(row.createdAt, 0))
      if (clears.has(cid) && BigInt(time) <= clears.get(cid)!) continue
      const conversation = this.chats.get(cid)
      if (query.kind && conversation?.kind !== query.kind) continue
      const content: Content = parseContent(row)
      if (query.type && content.type !== query.type) continue
      if (query.query && !contains(query.query, content.text)) continue
      const uid = row.senderId === null || row.senderId === undefined ? null : str(row.senderId)
      const person = (uid !== null ? members.get(uid) ?? this.contacts.get(uid) : undefined) ?? {}
      const groupNick = or(uid !== null ? this.groupNicks.get(nickKey(cid, uid)) : undefined, person.groupNickname, '')
      const mid = toBig(row.mid)
      const identity = mid > 0n ? mid.toString() : 'local:' + (truthy(row.localId) ? (row.localId as string) : `${row.source}:${row.primaryKey}`)
      yield {
        id: cid + '/' + identity, chatId: cid, chatName: or(conversation?.name, cid), kind: or(conversation?.kind, 'unknown'),
        sender: { id: uid, name: or(groupNick, person.name, uid), groupNickname: groupNick },
        isSelf: uid !== null ? uid === this.uid : null, sentAt: iso(time), timestampMs: time,
        serverId: mid.toString(), localId: row.localId, database: 'dingtalk.db', table: row.source,
        ...content, _time: time,
      }
    }
  }
}

/** Every column as a value SQLite gives us, with 64-bit integers kept whole as bigint. */
function rows(db: DatabaseSync, sql: string, ...params: Value[]): Row[] {
  const statement = db.prepare(sql)
  statement.setReadBigInts(true)
  return statement.all(...(params as never[])) as Row[]
}
