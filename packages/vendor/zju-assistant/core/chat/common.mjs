import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

export class SkillError extends Error {
  constructor(status, message, details = {}) {
    super(message)
    this.status = status
    this.details = details
  }
  result() {
    return { ok: false, status: this.status, message: this.message, ...this.details }
  }
}
export const fail = (status, message, details) => {
  throw new SkillError(status, message, details)
}
export const contains = (query = '', ...values) =>
  values.some((value) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  )
export const iso = (value) =>
  Number(value) > 0 && Number.isFinite(Number(value)) ? new Date(Number(value)).toISOString() : null
export const publicValue = (value) =>
  typeof value === 'bigint'
    ? String(value)
    : Array.isArray(value)
      ? value.map(publicValue)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([k]) => !k.startsWith('_'))
              .map(([k, v]) => [k, publicValue(v)])
          )
        : value
export function rows(db, sql, ...params) {
  const statement = db.prepare(sql)
  statement.setReadBigInts(true)
  return statement
    .all(...params)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === 'bigint' &&
          v <= BigInt(Number.MAX_SAFE_INTEGER) &&
          v >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(v)
            : v
        ])
      )
    )
}
export function memoryDatabase(image) {
  const db = new DatabaseSync(':memory:')
  try {
    db.deserialize(image)
    db.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
export function resolve(selector, items, fields = ['name', 'nickname', 'remark', 'alias', 'groupNickname']) {
  const exactId = items.filter((item) => item.id === selector)
  const exactName = items.filter((item) =>
    fields.some((field) => String(item[field] ?? '').toLowerCase() === selector.toLowerCase())
  )
  const found = exactId.length
    ? exactId
    : exactName.length
      ? exactName
      : items.filter((item) => contains(selector, ...fields.map((field) => item[field])))
  if (!found.length) fail('chat_not_found', '没有找到匹配记录，请查询聊天或成员列表，使用准确 ID。')
  if (found.length !== 1)
    fail('chat_ambiguous', '名称匹配到多条记录，请使用准确 ID。', {
      candidates: found.slice(0, 50).map(({ id, name, kind }) => ({ id, name, kind })),
      totalCandidates: found.length
    })
  return found[0]
}
export const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return 0
}
function scope(query) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(query)
            .filter(([k]) => !['cursor', 'limit'].includes(k))
            .sort(([a], [b]) => a.localeCompare(b))
        )
      )
    )
    .digest('hex')
}
export function after(query) {
  if (!query.cursor) return null
  try {
    const data = JSON.parse(Buffer.from(query.cursor, 'base64url'))
    if (
      data.scope !== scope(query) ||
      !Array.isArray(data.after) ||
      !data.after.every((v) => typeof v === 'string' || Number.isFinite(v))
    )
      throw Error()
    return data.after
  } catch {
    fail('invalid_cursor', '分页游标无效或不属于当前账号和查询，请保持筛选条件不变。')
  }
}
export function page(query, items, key, field) {
  const cursor = after(query),
    limit = query.limit ?? 50
  const selected = []
  for (const item of items) {
    const k = key(item)
    if (cursor && (cursor.length !== k.length || k.some((v, i) => typeof v !== typeof cursor[i])))
      fail('invalid_cursor', '分页游标格式无效。')
    if (cursor && compare(k, cursor) <= 0) continue
    let low = 0,
      high = selected.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (compare(key(selected[middle]), k) <= 0) low = middle + 1
      else high = middle
    }
    if (low > limit) continue
    selected.splice(low, 0, item)
    if (selected.length > limit + 1) selected.pop()
  }
  const hasMore = selected.length > limit
  selected.length = Math.min(limit, selected.length)
  return {
    ok: true,
    [field]: publicValue(selected),
    hasMore,
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({ scope: scope(query), after: key(selected.at(-1)) })).toString(
          'base64url'
        )
      : null,
    coverage: 'local_synced'
  }
}
export function time(value) {
  const input = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00+08:00' : value
  const ms = Date.parse(input),
    day = input.slice(0, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input) ||
    !Number.isFinite(ms) ||
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day
  )
    fail('invalid_input', '时间请写有效日期（YYYY-MM-DD，UTC+8 零点）或带时区的 ISO 时间。')
  return ms
}
export function argumentsFor(argv, { media = false } = {}) {
  const options = Object.fromEntries(
    [
      'chat',
      'query',
      'kind',
      'sender',
      'type',
      'since',
      'until',
      'limit',
      'cursor',
      'profile',
      'data-dir',
      ...(media ? ['message', 'out'] : [])
    ].map((k) => [k, { type: 'string' }])
  )
  Object.assign(options, { offline: { type: 'boolean' }, help: { type: 'boolean' } })
  let parsed
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch {
    fail('invalid_input', '参数不支持，请使用 --help 查看命令。')
  }
  const { positionals, values } = parsed
  if (values.help) return { help: true }
  if (['status', 'profiles'].includes(positionals[0]) && positionals.length === 1)
    return { ...values, op: positionals[0] }
  if (
    positionals[0] !== 'chat' ||
    positionals.length !== 2 ||
    !['list', 'contacts', 'info', 'members', 'read', 'search', ...(media ? ['download'] : [])].includes(
      positionals[1]
    )
  )
    fail('invalid_input', '使用 chat list / contacts / info / members / read / search。')
  const query = { ...values, op: positionals[1], limit: Number(values.limit ?? 50) }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500)
    fail('invalid_input', 'limit 应为 1～500 的整数。')
  for (const k of ['chat', 'query', 'sender'])
    if (query[k] !== undefined) {
      query[k] = query[k].trim()
      if (!query[k] || query[k].length > 1000) fail('invalid_input', `${k} 不能为空或超过 1000 字符。`)
    }
  if (['info', 'members', 'read'].includes(query.op) && !query.chat)
    fail('invalid_input', '请用 --chat 指定聊天。')
  if (query.op === 'search' && !['chat', 'query', 'sender', 'type', 'since', 'until'].some((k) => query[k]))
    fail('invalid_input', 'search 至少需要一个查询条件。')
  if (query.kind && !['personal', 'group'].includes(query.kind))
    fail('invalid_input', 'kind 只能是 personal 或 group。')
  for (const k of ['since', 'until']) if (query[k]) query[k] = time(query[k])
  if (query.since !== undefined && query.until !== undefined && query.since >= query.until)
    fail('invalid_input', 'since 必须早于 until。')
  return query
}
export async function main(run) {
  try {
    const result = await run()
    process.stdout.write(JSON.stringify(publicValue(result)) + '\n')
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        error instanceof SkillError
          ? error.result()
          : {
              ok: false,
              status: 'local_reader_failed',
              message: '本地数据库结构或读取过程不兼容，本次没有返回不完整结果。'
            }
      ) + '\n'
    )
    process.exitCode = 1
  }
}
