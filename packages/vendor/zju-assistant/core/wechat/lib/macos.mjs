/**
 * 微信聊天在 macOS 上的读取：查询和 Windows 是同一套（query.mjs），换掉的只是取密钥和解密这两步。
 * 照 weread-skill 的 macOS 后端（f629ca9，spdc-elm）改写成 Node，不要 Python：
 *   取密钥  scripts/local/macos-memory.c。第一次用时拿系统的 clang 编译、带调试权限临时签名，按源码版本放在缓存目录；
 *           它用 Mach 只读接口扫本用户的 WeChat.app 进程，候选密钥经目标库首页的 HMAC 认证过才从管道交回。
 *   解密    SQLCipher 4 逐页认证、解密，合并 WAL 里已提交的帧，整份只在内存里（decryptDatabase）。
 *   图片    V1/V2 缓存格式；V2 的密钥同样由读取程序认证后交回（macImage）。
 * 系统完整性保护（SIP）开着时，系统多半不让读官方微信的进程，报 wechat_memory_denied；这里不改微信、它的签名或系统设置。
 * 密钥、明文都不落盘，也不像 Windows 那样缓存密钥，所以每次都要微信开着、登录着。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDecipheriv, createHash, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { memoryDatabase, SkillError } from '../../chat/common.mjs'
import { Query } from './query.mjs'

const PAGE = 4096
const FRAME = PAGE + 24
const MAX_PAGES = 131072 // 单库明文 512 MiB，和 Windows 一样
const HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const LOCAL = fileURLToPath(new URL('../scripts/local/', import.meta.url))

/** 微信 4.x for Mac 放账号数据的地方，一个账号一个文件夹，里面是 db_storage。 */
export const MAC_ROOT = path.join(os.homedir(), 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files')

/** 读取程序认得的失败；别的一律当读取失败，免得把路径之类的私人信息带出来。 */
const NATIVE_ERRORS = ['wechat_not_running', 'wechat_memory_denied', 'wechat_key_unavailable', 'image_key_unavailable']

class MacError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
class SnapshotError extends Error {}

const isAccount = (dir) => fs.existsSync(path.join(dir, 'db_storage', 'contact', 'contact.db'))
const inside = (child, parent) => {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** 一个文件夹里的账号：账号文件夹本身、它的 db_storage、放账号的 xwechat_files，或者 xwechat_files 的上一层。 */
export function accountsIn(folder) {
  let full
  try {
    full = fs.realpathSync(folder)
    if (!fs.statSync(full).isDirectory()) return []
  } catch {
    return []
  }
  if (isAccount(full)) return [full]
  if (path.basename(full) === 'db_storage' && isAccount(path.dirname(full))) return [path.dirname(full)]
  for (const base of [full, path.join(full, 'xwechat_files')]) {
    let names = []
    try {
      names = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    } catch {}
    const found = names.map((name) => path.join(base, name)).filter(isAccount)
    if (found.length) return found
  }
  return []
}

/** 正在运行的微信的进程号；没开是 0。开了几个时不知道该读哪个，报错。 */
export function wechatPid() {
  const result = spawnSync('/usr/bin/pgrep', ['-x', 'WeChat'], { encoding: 'utf8', timeout: 5000 })
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new MacError('local_reader_failed')
  const pids = result.stdout.split(/\s+/).filter(Boolean)
  if (pids.length > 1 || (pids[0] && !/^\d+$/.test(pids[0]))) throw new MacError('multiple_wechat_processes')
  return Number(pids[0] ?? 0)
}

/** 编好的读取程序放哪：按源码、权限清单和芯片算一个名字，源码变了才重新编。 */
export const nativeDir = () =>
  process.env.WECHAT_NATIVE_DIR || path.join(os.homedir(), 'Library', 'Caches', 'weread-skill', 'native')

function run(command, args, { input, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [],
      err = []
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? Buffer.alloc(0))
  })
}

async function reader() {
  const source = path.join(LOCAL, 'macos-memory.c'),
    entitlements = path.join(LOCAL, 'macos-debugger.plist')
  const identity = createHash('sha256')
    .update(fs.readFileSync(source))
    .update(fs.readFileSync(entitlements))
    .update(os.arch())
    .digest('hex')
    .slice(0, 20)
  const dir = nativeDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const binary = path.join(dir, `macos-memory-${identity}`)
  if (fs.existsSync(binary)) return binary
  // 编好、签好再改名放上去，同时跑的两条命令不会用到编了一半的程序。只有这个程序带调试权限。
  const temp = fs.mkdtempSync(path.join(dir, 'build-'))
  try {
    const output = path.join(temp, 'macos-memory')
    for (const [command, args] of [
      ['/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', source, '-o', output]],
      ['/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlements, output]]
    ]) {
      const result = await run(command, args, { timeout: 60_000 }).catch(() => null)
      if (!result || result.code !== 0) throw new MacError('macos_build_failed')
    }
    fs.chmodSync(output, 0o700)
    fs.renameSync(output, binary)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  return binary
}

async function native(payload, pid) {
  const result = await run(await reader(), [String(pid)], { input: payload, timeout: 100_000 }).catch(() => null)
  payload.fill(0)
  if (!result) throw new MacError('local_reader_failed')
  if (result.signal) throw new MacError('wechat_key_unavailable')
  if (result.code !== 0) {
    let code
    try {
      code = JSON.parse(result.stderr).error
    } catch {}
    throw new MacError(NATIVE_ERRORS.includes(code) ? code : 'local_reader_failed')
  }
  return result.stdout
}

const u32 = (...values) => {
  const buffer = Buffer.alloc(values.length * 4)
  values.forEach((value, i) => buffer.writeUInt32LE(value, i * 4))
  return buffer
}

/** 每个库首页的密文交给读取程序，换回各自通过认证的 32 字节密钥，顺序和给的一样。 */
async function keysFor(files, pid) {
  if (files.length < 1 || files.length > 128) throw new MacError('wechat_database_missing')
  const pages = files.map((file) => {
    const page = Buffer.alloc(PAGE)
    const fd = fs.openSync(file, 'r')
    try {
      if (fs.readSync(fd, page, 0, PAGE, 0) !== PAGE) throw new MacError('snapshot_failed')
    } finally {
      fs.closeSync(fd)
    }
    return page
  })
  const head = Buffer.concat([Buffer.from('WRK1'), u32(files.length)])
  const data = await native(Buffer.concat([head, ...pages]), pid)
  pages.forEach((page) => page.fill(0))
  if (data.length !== 8 + files.length * 32 || !data.subarray(0, 8).equals(head)) throw new MacError('local_reader_failed')
  const keys = files.map((_, i) => Buffer.from(data.subarray(8 + i * 32, 40 + i * 32)))
  data.fill(0)
  return keys
}

/** SQLite WAL 的累加校验和，每 8 字节一组；magic 决定按小端还是大端读。 */
export function checksum(data, first = 0, second = 0, little = true) {
  if (data.length % 8) throw new SnapshotError('Unaligned checksum input')
  for (let at = 0; at < data.length; at += 8) {
    const a = little ? data.readUInt32LE(at) : data.readUInt32BE(at)
    const b = little ? data.readUInt32LE(at + 4) : data.readUInt32BE(at + 4)
    first = (first + a + second) >>> 0
    second = (second + b + first) >>> 0
  }
  return [first, second]
}

/** WAL 里每一页最后一次提交的版本在哪，和提交后的总页数；没提交的帧、上一代 WAL 留下的尾巴不算。 */
export function committedWal(wal, maxPages = MAX_PAGES) {
  if (!wal.length) return { latest: new Map(), pageCount: 0 }
  if (wal.length < 32) throw new SnapshotError('Incomplete WAL header')
  const magic = wal.readUInt32BE(0)
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== PAGE)
    throw new SnapshotError('Unsupported WAL header')
  const little = magic === 0x377f0682
  let state = checksum(wal.subarray(0, 24), 0, 0, little)
  if (state[0] !== wal.readUInt32BE(24) || state[1] !== wal.readUInt32BE(28)) throw new SnapshotError('WAL header checksum failed')
  const pending = new Map(),
    latest = new Map()
  let pageCount = 0
  for (let at = 32; at + FRAME <= wal.length; at += FRAME) {
    if (!wal.subarray(at + 8, at + 16).equals(wal.subarray(16, 24))) break
    state = checksum(wal.subarray(at, at + 8), ...state, little)
    state = checksum(wal.subarray(at + 24, at + FRAME), ...state, little)
    if (state[0] !== wal.readUInt32BE(at + 16) || state[1] !== wal.readUInt32BE(at + 20)) throw new SnapshotError('WAL frame checksum failed')
    const number = wal.readUInt32BE(at),
      commit = wal.readUInt32BE(at + 4)
    if (number < 1 || number > maxPages || commit > maxPages) throw new SnapshotError('Invalid WAL page number')
    pending.set(number, at + 24)
    if (commit) {
      for (const [page, offset] of pending) latest.set(page, offset)
      pending.clear()
      pageCount = commit
    }
  }
  return { latest, pageCount }
}

function decryptPage(page, number, key, macKey) {
  if (page.length !== PAGE) throw new SnapshotError('Incomplete page')
  const skip = number === 1 ? 16 : 0
  const digest = createHmac('sha512', macKey).update(page.subarray(skip, 4032)).update(u32(number)).digest()
  if (!timingSafeEqual(digest, page.subarray(4032))) throw new SnapshotError('Page authentication failed')
  const result = Buffer.alloc(PAGE)
  if (skip) HEADER.copy(result)
  const decipher = createDecipheriv('aes-256-cbc', key, page.subarray(4016, 4032))
  decipher.setAutoPadding(false)
  Buffer.concat([decipher.update(page.subarray(skip, 4016)), decipher.final()]).copy(result, skip)
  return result
}

function readBounded(file, limit, optional = false) {
  try {
    if (fs.statSync(file).size > limit) throw new SnapshotError('Snapshot exceeds bounded size')
    const data = fs.readFileSync(file)
    if (data.length > limit) throw new SnapshotError('Snapshot exceeds bounded size')
    return data
  } catch (error) {
    if (optional && error.code === 'ENOENT') return Buffer.alloc(0)
    throw error
  }
}

/** 一个库连同已提交的 WAL 解成一份内存里的 SQLite 镜像；读的过程中库变了就重读，三次都在变就报错。 */
export function decryptDatabase(file, key, maxPages = MAX_PAGES) {
  let database, wal
  for (let attempt = 0; ; attempt++) {
    if (attempt === 3) throw new SnapshotError('Database changed during snapshot')
    database = readBounded(file, maxPages * PAGE)
    wal = readBounded(file + '-wal', maxPages * FRAME + 32, true)
    if (database.equals(readBounded(file, maxPages * PAGE)) && wal.equals(readBounded(file + '-wal', maxPages * FRAME + 32, true))) break
  }
  if (database.length < PAGE || database.length % PAGE) throw new SnapshotError('Unexpected database size')
  const macKey = pbkdf2Sync(key, database.subarray(0, 16).map((b) => b ^ 0x3a), 2, 32, 'sha512')
  const first = decryptPage(database.subarray(0, PAGE), 1, key, macKey)
  const { latest, pageCount: committed } = committedWal(wal, maxPages)
  const pageCount = committed || first.readUInt32BE(28)
  first.fill(0)
  if (pageCount < 1 || pageCount > maxPages) throw new SnapshotError('Invalid final page count')
  const plain = Buffer.alloc(pageCount * PAGE)
  try {
    for (let number = 1; number <= pageCount; number++) {
      const offset = latest.get(number)
      const page = offset !== undefined ? wal.subarray(offset, offset + PAGE) : database.subarray((number - 1) * PAGE, number * PAGE)
      const decoded = decryptPage(page, number, key, macKey)
      decoded.copy(plain, (number - 1) * PAGE)
      decoded.fill(0)
    }
    // 已提交的 WAL 已经并进来了；deserialize 要的是回滚日志模式的文件头版本号。原文件不动。
    plain[18] = plain[19] = 1
    return plain
  } catch (error) {
    plain.fill(0)
    throw error
  } finally {
    macKey.fill(0)
  }
}

/** 这次查询要读的库，和 Windows 的 read-chat.ps1 选法一样。 */
function databases(account, query) {
  const storage = path.join(account, 'db_storage')
  const files = [path.join(storage, 'contact', 'contact.db')]
  if (['list', 'info', 'read', 'search', 'download'].includes(query.op)) files.push(path.join(storage, 'session', 'session.db'))
  const shardsOf = (pattern) => {
    try {
      return fs.readdirSync(path.join(storage, 'message')).filter((name) => pattern.test(name)).sort().map((name) => path.join(storage, 'message', name))
    } catch {
      return []
    }
  }
  if (['read', 'search', 'download'].includes(query.op)) {
    let shards = shardsOf(/^message_\d+\.db$/)
    if (!shards.length) throw new MacError('wechat_database_missing')
    // 每个分库各有密钥，微信内存里只有最近打开过的那几个的；读取程序要全部找到才交回。所以给了起始时间时，
    // 最后写入比它早两天以上的分库里不会有要的消息，不去读，免得一个久没动的旧库让最近的查询（包括监控）全都失败。
    if (query.op !== 'download' && query.since != null) {
      const from = Number(query.since) - 2 * 24 * 3600 * 1000
      const recent = shards.filter((file) => fs.statSync(file).mtimeMs >= from)
      shards = recent.length ? recent : [shards.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]]
    }
    files.push(...shards)
  }
  if (query.op === 'download') {
    files.push(...shardsOf(/^media_\d+\.db$/))
    const hardlink = path.join(storage, 'hardlink', 'hardlink.db')
    if (fs.existsSync(hardlink)) files.push(hardlink)
  }
  if (files.some((file) => !fs.existsSync(file))) throw new MacError('wechat_database_missing')
  return files
}

/**
 * Mac 上的 profiles 和 chat 子命令，返回和 Windows 读取器一样的东西：查询结果，或者 { error }（由 wechat.mjs 换成说明）。
 * query 是 argumentsFor 解析好的；data-dir 是选定的聊天数据位置。
 */
export async function readMac(query, root = MAC_ROOT) {
  const keys = []
  try {
    if (query.offline) return { ok: false, status: 'invalid_input', message: 'Mac 上每次都要从开着的微信取密钥，不支持 --offline。' }
    const chosen = query['data-dir']
    query = { ...query }
    delete query['data-dir']
    delete query.offline
    const profiles = accountsIn(chosen || root)
    if (!profiles.length) return { error: chosen ? 'wechat_folder_unrecognized' : 'wechat_database_missing' }
    if (query.op === 'profiles') return { ok: true, profiles: profiles.map((p) => ({ id: path.basename(p), path: p })) }
    if (profiles.length !== 1) return { error: 'multiple_wechat_profiles' }
    const account = profiles[0],
      pid = wechatPid()
    if (!pid) return { error: 'wechat_not_running' }
    query.profile = path.basename(account)
    if (query.op === 'download') query.profilePath = account
    const files = databases(account, query)
    keys.push(...(await keysFor(files, pid)))
    const reading = new Query(query)
    for (const [i, file] of files.entries()) {
      const plain = decryptDatabase(file, keys[i])
      let db
      try {
        db = memoryDatabase(plain)
        reading.read(path.basename(file), db)
      } finally {
        db?.close()
        plain.fill(0)
      }
    }
    return reading.result()
  } catch (error) {
    if (error instanceof MacError) return { error: error.code }
    if (error instanceof SnapshotError) return { error: 'snapshot_failed' }
    if (error instanceof SkillError) return error.result()
    return { ok: false, status: 'chat_schema_unsupported', message: '当前微信数据库结构或消息编码无法解析。' }
  } finally {
    keys.forEach((key) => key.fill(0))
  }
}

/** 图片缓存认得的格式；不认得是 null。 */
export function imageFormat(data) {
  if (data.length < 12) return null
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png'
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif'
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (data.subarray(0, 4).toString('latin1') === 'wxgf') return 'wxgf'
  return null
}

class ImageError extends Error {
  constructor(code) {
    super(code)
    this.status = code
  }
}

/** V1/V2 缓存开头那段 AES-128-ECB（PKCS7）的明文，和它占的密文长度。 */
function prefix(data, key) {
  if (data.length < 31) throw new ImageError('image_decode_failed')
  const size = data.readUInt32LE(6),
    encrypted = (Math.floor(size / 16) + 1) * 16
  if (size < 16 || size > 1024 * 1024 || 15 + encrypted > data.length) throw new ImageError('image_decode_failed')
  let plain
  try {
    const decipher = createDecipheriv('aes-128-ecb', key, null)
    plain = Buffer.concat([decipher.update(data.subarray(15, 15 + encrypted)), decipher.final()])
  } catch {
    throw new ImageError('image_decode_failed')
  }
  if (plain.length !== size || !imageFormat(plain)) throw new ImageError('image_decode_failed')
  return { plain, encrypted }
}

/** 尾部按一个字节异或；jpg、png 有固定结尾，能直接推出那个字节。 */
function tailKey(data, kind) {
  const ending = { jpg: Buffer.from('ffd9', 'hex'), png: Buffer.from('0000000049454e44ae426082', 'hex') }[kind]
  if (!ending || data.readUInt32LE(10) < ending.length || data.length < ending.length) return null
  const key = data[data.length - ending.length] ^ ending[0]
  return ending.every((b, i) => (data[data.length - ending.length + i] ^ key) === b) ? key : null
}

function* thumbnails(folder, limit = 2000) {
  const stack = [folder]
  let seen = 0
  while (stack.length && seen < limit) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {}
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('_t.dat') && seen++ < limit) yield full
    }
  }
}

/** 解一张缓存图片。findKey(密文开头, 明文长度) 去读取程序要 V2 的密钥。 */
export async function decodeImage(source, account, findKey) {
  const data = readBounded(source, 256 * 1024 * 1024)
  const plainKind = imageFormat(data)
  if (plainKind) return { data, kind: plainKind }
  const mark = data.subarray(0, 6).toString('latin1')
  if (mark !== '\x07\x08V1\x08\x07' && mark !== '\x07\x08V2\x08\x07') {
    if (!data.length) throw new ImageError('unsupported_image')
    for (const first of [255, 137, 71, 82]) {
      const key = data[0] ^ first,
        kind = imageFormat(data.subarray(0, 16).map((b) => b ^ key))
      if (kind) return { data: data.map((b) => b ^ key), kind }
    }
    throw new ImageError('unsupported_image')
  }
  if (data.length < 31) throw new ImageError('image_decode_failed')
  const size = data.readUInt32LE(6),
    xorSize = data.readUInt32LE(10),
    encrypted = (Math.floor(size / 16) + 1) * 16
  if (size < 16 || size > 1024 * 1024 || 15 + encrypted + xorSize > data.length) throw new ImageError('image_decode_failed')
  const key = data[3] === 49 ? Buffer.from('cfcd208495d565ef', 'latin1') : await findKey(Buffer.from(data.subarray(15, 15 + encrypted)), size)
  try {
    const { plain, encrypted: used } = prefix(data, key)
    const kind = imageFormat(plain)
    let xor = tailKey(data, kind)
    if (xorSize && xor === null) {
      // 只用同一个 AES 密钥解得开的缩略图推尾部的异或值；WXGF、GIF、WebP 没有固定结尾时靠它。
      for (const candidate of thumbnails(path.join(account, 'msg', 'attach'))) {
        try {
          const thumbnail = readBounded(candidate, 4 * 1024 * 1024)
          if (thumbnail.subarray(0, 6).toString('latin1') !== '\x07\x08V2\x08\x07') continue
          xor = tailKey(thumbnail, imageFormat(prefix(thumbnail, key).plain))
          if (xor !== null) break
        } catch {}
      }
      if (xor === null) throw new ImageError('image_xor_unavailable')
    }
    const middleEnd = data.length - xorSize
    const parts = [plain, data.subarray(15 + used, middleEnd)]
    if (xorSize) parts.push(data.subarray(middleEnd).map((b) => b ^ xor))
    return { data: Buffer.concat(parts), kind }
  } finally {
    key.fill(0)
  }
}

/** Mac 上导出一张聊天图片：解出来写到 destination 加扩展名，返回 { file, format }；失败时抛带 status 的错。 */
export async function macImage(source, profile, destination) {
  const account = fs.realpathSync(profile),
    from = fs.realpathSync(source),
    to = path.resolve(destination)
  if (!inside(from, path.join(account, 'msg')) || inside(to, account) || to === account) throw new ImageError('invalid_input')
  const name = Buffer.from(path.basename(account).match(/^wxid_[^_]+/)?.[0] ?? '', 'ascii')
  const findKey = async (head, size) => {
    let pid
    try {
      pid = wechatPid()
    } catch {
      throw new ImageError('image_key_unavailable')
    }
    if (!pid) throw new ImageError('wechat_not_running')
    let data
    try {
      data = await native(Buffer.concat([Buffer.from('WRI1'), u32(size, head.length, name.length), head, name]), pid)
    } catch (error) {
      throw new ImageError(error instanceof MacError ? error.code : 'image_key_unavailable')
    }
    if (data.length !== 20 || data.subarray(0, 4).toString('latin1') !== 'WRI1') throw new ImageError('image_key_unavailable')
    const key = Buffer.from(data.subarray(4))
    data.fill(0)
    return key
  }
  let decoded
  try {
    decoded = await decodeImage(from, account, findKey)
  } catch (error) {
    throw error instanceof ImageError ? error : new ImageError('image_decode_failed')
  }
  const file = `${to}.${decoded.kind}`
  try {
    fs.writeFileSync(file, decoded.data, { flag: 'wx', mode: 0o600 })
  } finally {
    decoded.data.fill(0)
  }
  return { file, format: decoded.kind }
}
