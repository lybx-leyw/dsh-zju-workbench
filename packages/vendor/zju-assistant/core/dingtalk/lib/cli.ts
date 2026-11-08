/** Argument parsing, validation and the single read-only query run; everything it prints is JSON. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ChatReader, dateMs, type Query } from './chat.ts'
import { MESSAGE_TYPES } from './content.ts'
import { dataRoot, discover, selectProfile, snapshot } from './database.ts'
import { SkillError } from './errors.ts'
import { codePoints, stringify, strip } from './values.ts'

const OPS = ['list', 'contacts', 'info', 'members', 'read', 'search']
const KINDS = ['personal', 'group']

export interface Args {
  command: 'profiles' | 'chat'
  op?: string
  dataDir?: string
  profile?: string
  limit?: number
  cursor?: string
  query?: string
  kind?: string
  chat?: string
  sender?: string
  type?: string
  since?: string
  until?: string
}

const fail = (message: string): never => { throw new SkillError('invalid_input', message) }

/** Which options each command accepts, so an unknown flag is reported rather than ignored. */
function allowed(command: string, op?: string): Set<string> {
  if (command === 'profiles') return new Set(['data-dir'])
  const options = new Set(['profile', 'data-dir'])
  if (op && op !== 'info') { options.add('limit'); options.add('cursor'); options.add('query') }
  if (op && ['info', 'members', 'read', 'search'].includes(op)) options.add('chat')
  if (op && ['list', 'read', 'search'].includes(op)) options.add('kind')
  if (op && ['read', 'search'].includes(op)) { options.add('sender'); options.add('type'); options.add('since'); options.add('until') }
  return options
}

/** A hand-rolled parser that mirrors the former argparse: every option takes a value, errors are invalid_input. */
export function parseArgs(argv: string[]): Args {
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (let at = 0; at < argv.length; at++) {
    const token = argv[at]!
    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = equals >= 0 ? token.slice(2, equals) : token.slice(2)
      const value = equals >= 0 ? token.slice(equals + 1) : argv[++at]
      if (value === undefined) fail(`选项 --${name} 需要一个值。`)
      flags.set(name, value!)
    } else {
      positionals.push(token)
    }
  }
  const command = positionals[0]
  if (command !== 'profiles' && command !== 'chat') fail('请使用 profiles 或 chat 子命令。')
  const op = command === 'chat' ? positionals[1] : undefined
  if (command === 'chat' && (!op || !OPS.includes(op))) fail(`chat 需要子命令：${OPS.join('、')}。`)
  if (positionals.length > (command === 'chat' ? 2 : 1)) fail('多余的参数。')

  const permitted = allowed(command!, op)
  for (const name of flags.keys()) if (!permitted.has(name)) fail(`未知选项 --${name}。`)

  const args: Args = { command: command as 'profiles' | 'chat' }
  if (op) args.op = op
  const take = (name: keyof Args, flag: string) => { if (flags.has(flag)) args[name] = flags.get(flag) as never }
  take('dataDir', 'data-dir')
  take('profile', 'profile')
  take('cursor', 'cursor')
  take('query', 'query')
  take('chat', 'chat')
  take('sender', 'sender')
  take('since', 'since')
  take('until', 'until')
  if (flags.has('kind')) { if (!KINDS.includes(flags.get('kind')!)) fail(`--kind 只能是 ${KINDS.join(' 或 ')}。`); args.kind = flags.get('kind')! }
  if (flags.has('type')) { if (!MESSAGE_TYPES.includes(flags.get('type')!)) fail(`--type 只能是：${MESSAGE_TYPES.join('、')}。`); args.type = flags.get('type')! }
  if (command === 'chat' && op !== 'info') {
    if (flags.has('limit')) {
      const value = Number(flags.get('limit'))
      if (!Number.isInteger(value)) fail('limit 应为整数。')
      args.limit = value
    } else {
      args.limit = 50
    }
  }
  if (['info', 'members', 'read'].includes(op ?? '') && args.chat === undefined) fail(`${op} 需要 --chat 指定会话名称或 ID。`)
  return args
}

/** Normalise and bound the filters into the query the reader runs. */
export function validate(args: Args): Query {
  const query: Query = { op: args.op ?? args.command }
  for (const key of ['limit', 'cursor', 'query', 'kind', 'chat', 'sender'] as const) {
    if (args[key] !== undefined) (query as unknown as Record<string, unknown>)[key] = args[key]
  }
  if (args.type !== undefined) query.type = args.type
  if (!(query.limit === undefined || (Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 500))) fail('limit 应为 1～500 的整数。')
  for (const field of ['chat', 'query', 'sender'] as const) {
    if (query[field] !== undefined) {
      const text = strip(query[field]!)
      if (!text || codePoints(text) > 1000) fail(`${field} 不能为空或超过 1000 字符。`)
      query[field] = text
    }
  }
  if (args.since !== undefined) query.since = dateMs(args.since)
  if (args.until !== undefined) query.until = dateMs(args.until)
  if (query.since !== undefined && query.until !== undefined && query.since >= query.until) fail('since 必须早于 until；时间范围含起点、不含终点。')
  if (query.op === 'search' && !['chat', 'query', 'sender', 'type', 'since', 'until'].some(key => key in query)) {
    fail('search 至少需要关键词、会话、发送者、类型或时间条件。')
  }
  return query
}

/** Parse, validate and run one command; returns the result object the caller prints. */
export function run(argv: string[]): object {
  const args = parseArgs(argv)
  const query = validate(args)
  const profiles = discover(args.dataDir)
  if (args.command === 'profiles') return { ok: true, root: dataRoot(args.dataDir), profiles: profiles.map(profile => ({ id: profile.id, uid: profile.uid })) }
  const profile = selectProfile(profiles, args.profile)
  const open = snapshot(path.join(profile.path, 'DBFiles', 'dingtalk.db'), profile.key)
  const closers = [() => open.db.close()]
  try {
    let members = null
    const op = args.op!
    if (op === 'members' || (['read', 'search'].includes(op) && query.chat)) {
      const membersPath = path.join(profile.path, 'DBFiles', 'members.db')
      if (existsSync(membersPath) || op === 'members') {
        const opened = snapshot(membersPath, profile.key)
        members = opened.db
        closers.push(() => opened.db.close())
      }
    }
    return new ChatReader(open.db, profile.uid, profile.id, members).query(query)
  } finally {
    for (const close of closers) close()
  }
}

const SQLITE_MESSAGE = '数据库结构不兼容或内存快照读取失败；没有返回不完整结果。'

/** Run the command line and print one compact JSON object; the exit code is 0 only on success. */
export function main(argv: string[]): number {
  let result: { ok: boolean } & Record<string, unknown>
  try {
    if (process.env.DINGTALK_CHAT_DISABLED === '1') throw new SkillError('plugin_disabled', '钉钉聊天插件已关闭，请先在插件页打开。')
    result = run(argv) as { ok: boolean } & Record<string, unknown>
  } catch (error) {
    if (error instanceof SkillError) result = error.result()
    else if ((error as NodeJS.ErrnoException)?.code === 'ERR_SQLITE_ERROR' || (error as Error)?.name === 'SqliteError') {
      result = { ok: false, status: 'schema_unsupported', message: SQLITE_MESSAGE }
    } else if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException)?.code ?? '')) {
      result = { ok: false, status: 'database_unreadable', message: '当前系统用户无法只读访问钉钉数据文件。' }
    } else if ((error as NodeJS.ErrnoException)?.code?.startsWith('E') && (error as NodeJS.ErrnoException)?.syscall) {
      result = { ok: false, status: 'local_reader_failed', message: '读取本机钉钉数据失败，请稍后重试。' }
    } else {
      // Never stringify an exception from a personal-data parser or include a raw payload.
      result = { ok: false, status: 'local_reader_failed', message: '当前数据格式未能解析，查询未完成。' }
    }
  }
  process.stdout.write(stringify(result) + '\n')
  return result.ok ? 0 : 1
}
