/**
 * Open the local DingTalk v2/v3 store read-only: decrypt the file and its committed WAL frames in memory, verify
 * the SQLite header and page B-trees, and hand back an in-memory connection. Nothing on disk is touched, and the
 * decrypted image is wiped once SQLite has copied it. Until 2026-10-16 this step was a Python script; the behaviour
 * is kept. Format notes: DingTalk v3 key analysis (bbs.kanxue.com/thread-287455.htm), an older public analysis
 * (github.com/RedTeamExp/dingding), and the SQLite WAL format (sqlite.org/fileformat2.html#walformat).
 */
import { createDecipheriv, pbkdf2Sync, createHash } from 'node:crypto'
import { openSync, readSync, fstatSync, closeSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { SkillError } from './errors.ts'

const HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const MAX_BYTES = 512 * 1024 * 1024

export interface Profile { id: string; uid: string; path: string; key: Buffer }

/** AES-128-ECB with no padding; the plaintext length is always a multiple of 16. */
function decrypt(data: Buffer, key: Buffer): Buffer {
  if (data.length % 16) throw new SkillError('snapshot_failed', '数据库加密块长度无效。')
  const cipher = createDecipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/**
 * The x64 CPUID leaf-0 vendor registers (EAX, then EBX, EDX, ECX) decimal-joined and cut to 16 bytes. The CPU is
 * not queried here; instead the stored key is confirmed against the global header, which rules the value in without
 * a native call. On non-x64 or an unknown vendor this stays undefined and the caller reports the data is not ours.
 */
const VENDORS = ['GenuineIntel', 'AuthenticAMD', 'HygonGenuine', '  Shanghai  ', 'CentaurHauls', 'VIA VIA VIA ', 'AMDisbetter!', 'GenuineIotel']
function cpuKey(header: Buffer): Buffer {
  if (process.platform === 'darwin') return macGlobalKey(header)
  if (process.platform !== 'win32') throw new SkillError('unsupported_platform', '本地数据库读取目前只支持 Windows 和 macOS 钉钉的数据目录。')
  const register = (vendor: string, at: number) => Buffer.from(vendor.slice(at, at + 4), 'latin1').readInt32LE(0)
  // Leaf 0 returns the highest leaf in EAX; it is small, so a short scan finds it without reading the CPU.
  for (let eax = 0; eax <= 64; eax++) {
    for (const vendor of VENDORS) {
      const key = Buffer.from((String(eax) + register(vendor, 0) + register(vendor, 8) + register(vendor, 4)).slice(0, 16), 'latin1')
      if (key.length === 16 && decrypt(header, key).equals(HEADER)) return key
    }
  }
  throw new SkillError('database_key_unavailable', '全局数据库密钥未通过校验；可能不属于当前电脑或版本尚不兼容。')
}

/**
 * DingTalk for Mac does not read the CPU: its global-key helper returns this fixed CPUID string, Apple chip or not,
 * and the key is its first 16 ASCII bytes. Found in the 9.0.2 arm64 binary and confirmed on a real global store by
 * dingtalk-skill's macOS support (2026-11-01); still checked against the header, so another version is reported
 * instead of read as garbage.
 */
const MAC_GLOBAL_KEY = Buffer.from('7197016915918185882701231384169'.slice(0, 16), 'latin1')
export function macGlobalKey(header: Buffer): Buffer {
  if (header.length === 16 && decrypt(header, MAC_GLOBAL_KEY).equals(HEADER)) return Buffer.from(MAC_GLOBAL_KEY)
  throw new SkillError('database_key_unavailable', '全局数据库密钥未通过校验；这一版 Mac 钉钉可能还不兼容（实测过的是 9.0.2）。')
}

/** The per-account database key: PBKDF2-HMAC-SHA1(uid+salt, "666DingT"), then the first 16 hex chars of its MD5. */
export function userKey(uid: string, salt: string): Buffer {
  const derived = pbkdf2Sync(Buffer.from(uid + salt, 'utf8'), Buffer.from('666DingT', 'latin1'), 1000, 32, 'sha1')
  return Buffer.from(createHash('md5').update(derived).digest('hex').slice(0, 16), 'latin1')
}

/** The v2 per-account database key: the first 16 ASCII characters of MD5(uid)'s hexadecimal digest. */
export function v2UserKey(uid: string): Buffer {
  return Buffer.from(createHash('md5').update(uid, 'utf8').digest('hex').slice(0, 16), 'latin1')
}

/** SQLite's WAL running checksum over 8-byte words, big- or little-endian. */
export function checksum(data: Buffer, big: boolean, state: [number, number] = [0, 0]): [number, number] {
  if (data.length % 8) throw new SkillError('snapshot_failed', 'WAL 校验区长度无效。')
  let [s0, s1] = state
  for (let at = 0; at < data.length; at += 8) {
    const x = big ? data.readUInt32BE(at) : data.readUInt32LE(at)
    const y = big ? data.readUInt32BE(at + 4) : data.readUInt32LE(at + 4)
    s0 = (s0 + x + s1) >>> 0
    s1 = (s1 + y + s0) >>> 0
  }
  return [s0, s1]
}

const equalState = (state: [number, number], buffer: Buffer, at: number) =>
  state[0] === buffer.readUInt32BE(at) && state[1] === buffer.readUInt32BE(at + 4)

function pageSizeOf(plain: Buffer): number {
  const raw = plain.readUInt16BE(16)
  return raw === 1 ? 65536 : raw
}

/** Apply the committed, checksum-verified frames of the WAL onto the decrypted main image. */
export function mergeWal(plain: Buffer, wal: Buffer, key: Buffer): { plain: Buffer; commits: number } {
  if (!wal.length) return { plain, commits: 0 }
  if (wal.length < 32) throw new SkillError('snapshot_failed', 'WAL 文件头不完整，请稍后重试。')
  const magic = wal.readUInt32BE(0), version = wal.readUInt32BE(4), pageSize = wal.readUInt32BE(8)
  if ((magic !== 0x377f0682 && magic !== 0x377f0683) || version !== 3007000) throw new SkillError('snapshot_failed', '不支持的 WAL 格式。')
  if (pageSize !== pageSizeOf(plain)) throw new SkillError('snapshot_failed', 'WAL 与数据库页大小不一致。')
  const big = magic === 0x377f0683
  let state = checksum(wal.subarray(0, 24), big)
  if (!equalState(state, wal, 24)) throw new SkillError('snapshot_failed', 'WAL 文件头校验失败。')
  const salt = wal.subarray(16, 24)
  const pending = new Map<number, Buffer>()
  const committed = new Map<number, Buffer>()
  let dbSize = 0, commits = 0
  // SQLite checksums cover the bytes stored in the WAL, which here are ciphertext.
  for (let offset = 32; offset <= wal.length - pageSize - 24; offset += pageSize + 24) {
    const frame = wal.subarray(offset, offset + 24)
    if (!frame.subarray(8, 16).equals(salt)) break // Allocated space from a previous checkpoint generation.
    const pageNo = frame.readUInt32BE(0), commitSize = frame.readUInt32BE(4)
    if (!pageNo || pageNo * pageSize > MAX_BYTES || commitSize * pageSize > MAX_BYTES) throw new SkillError('snapshot_failed', 'WAL 页号或数据库大小超出支持范围。')
    const payload = wal.subarray(offset + 24, offset + 24 + pageSize)
    state = checksum(payload, big, checksum(frame.subarray(0, 8), big, state))
    if (!equalState(state, frame, 16)) throw new SkillError('snapshot_failed', 'WAL 帧校验失败，请稍后重试。')
    pending.set(pageNo, payload)
    if (commitSize) {
      for (const [page, data] of pending) committed.set(page, data)
      pending.clear()
      dbSize = commitSize
      commits += 1
    }
  }
  if (dbSize) {
    // A fresh buffer: the decrypted main image is left untouched, as the former implementation did.
    const target = dbSize * pageSize
    const out = Buffer.alloc(target)
    plain.subarray(0, Math.min(plain.length, target)).copy(out)
    for (const [pageNo, payload] of committed) {
      if (pageNo <= dbSize) decrypt(payload, key).copy(out, (pageNo - 1) * pageSize)
    }
    plain = out
  }
  return { plain, commits }
}

function readBytesFromDisk(file: string, optional = false): Buffer {
  let fd: number
  try { fd = openSync(file, 'r') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (optional) return Buffer.alloc(0)
      throw new SkillError('database_missing', '未找到查询需要的钉钉数据库。')
    }
    throw error
  }
  try {
    const size = fstatSync(fd).size
    if (size > MAX_BYTES) throw new SkillError('database_too_large', '单个数据库或 WAL 超过 512 MiB，当前不支持。')
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const n = readSync(fd, buffer, read, size - read, read)
      if (n <= 0) break
      read += n
    }
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/** The file reader, swappable only so tests can drive a concurrent-write sequence. */
let readBytes = readBytesFromDisk
export function setReader(reader: typeof readBytesFromDisk = readBytesFromDisk) { readBytes = reader }

/** Read the file and its WAL twice; a change between the reads means DingTalk is writing, so no stale copy is returned. */
function stableRead(file: string): { raw: Buffer; wal: Buffer } {
  const walPath = file + '-wal'
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = readBytes(file), wal = readBytes(walPath, true)
    if (raw.equals(readBytes(file)) && wal.equals(readBytes(walPath, true))) return { raw, wal }
    const until = Date.now() + 50 * (attempt + 1)
    while (Date.now() < until) { /* brief settle without locking the file */ }
  }
  throw new SkillError('database_busy', '钉钉正在更新本地数据库，请稍后重试。')
}

export interface Meta { database: string; walCommits: number }

/** Decrypt the store to an in-memory, query-only SQLite connection, verifying the header and every ordinary table. */
export function snapshot(file: string, key: Buffer): { db: DatabaseSync; meta: Meta } {
  const { raw, wal } = stableRead(file)
  if (!raw.length || !decrypt(raw.subarray(0, 16), key).equals(HEADER)) {
    throw new SkillError('database_key_unavailable', '数据库密钥未通过校验；可能不属于当前电脑或版本尚不兼容。')
  }
  const merged = mergeWal(decrypt(raw, key), wal, key)
  const plain = merged.plain
  const pageSize = pageSizeOf(plain)
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) || plain.length % pageSize) {
    throw new SkillError('snapshot_failed', '数据库页结构校验失败。')
  }
  plain[18] = plain[19] = 1 // An in-memory database must not look for a WAL file on disk.
  const db = new DatabaseSync(':memory:')
  try {
    db.deserialize(plain) // SQLite copies the bytes; the plaintext buffer is wiped below.
    db.exec('PRAGMA query_only=ON')
    db.exec('PRAGMA temp_store=MEMORY')
    // DingTalk registers its own FTS tokenizer. Inspect ordinary B-trees only; do not instantiate its virtual tables.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%'").all() as { name: string }[]
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"'
      const check = db.prepare(`PRAGMA quick_check(${quoted})`).all() as { quick_check: string }[]
      if (check.length !== 1 || check[0]!.quick_check !== 'ok') throw new SkillError('snapshot_failed', '数据库完整性检查失败。')
    }
    return { db, meta: { database: path.basename(file), walCommits: merged.commits } }
  } catch (error) {
    db.close()
    throw error
  } finally {
    plain.fill(0)
  }
}

/** Decode base64 strictly, rejecting any byte outside the alphabet or a wrong-length tail, as Python's validate=True does. */
function strictBase64(data: Buffer): Buffer {
  const text = data.toString('latin1').trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) throw new SkillError('invalid_input', 'bad base64')
  return Buffer.from(text, 'base64')
}

/** The global-store key derivation, swappable only so tests can supply a synthetic key without CPU access. */
let globalKey = cpuKey
export function setGlobalKeyProvider(provider: typeof cpuKey = cpuKey) { globalKey = provider }

function globalUids(root: string, header: Buffer): string[] {
  const { db } = snapshot(path.join(root, 'globalStorage', 'storage.db'), globalKey(header))
  try {
    // Never read token-bearing DTLastUserData or DTRecentUsersData values; take account-id keys only.
    const uids = (db.prepare("SELECT key FROM GlobalStorage WHERE key NOT GLOB '*[^0-9]*' AND length(key) BETWEEN 5 AND 24").all() as { key: string }[]).map(row => row.key)
    const last = db.prepare("SELECT value FROM GlobalStorage WHERE key='last_login_user_uid'").get() as { value: unknown } | undefined
    if (last && typeof last.value === 'string' && /^\d{5,24}$/.test(last.value) && !uids.includes(last.value)) uids.push(last.value)
    return uids
  } finally {
    db.close()
  }
}

const GLOBAL_MISSING = '未找到钉钉全局数据库（globalStorage），请把聊天数据位置设成包含 globalStorage 的 DingTalk 文件夹（命令行用 --data-dir）。'
const FOLDER_EMPTY = '这个文件夹里没有钉钉账号数据，请选里面有 globalStorage 和 …_v3 账号文件夹的 DingTalk 文件夹。'

const isAccountName = (name: string) => name.endsWith('_v2') || name.endsWith('_v3')

/** A DingTalk data root holds globalStorage or at least one <id>_v2/_v3 account folder. */
function looksLikeRoot(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(entry => entry.isDirectory() && (entry.name === 'globalStorage' || isAccountName(entry.name)))
  } catch {
    return false
  }
}

/**
 * DingTalk for Mac's data folder: the direct-download app's, then the two App Store sandboxes'. Only folders that hold
 * DingTalk data count; with none the first is given (so the error names the usual place), with several the user picks.
 */
export function macRoot(home = os.homedir()): string {
  const library = path.join(home, 'Library')
  const candidates = [path.join(library, 'Application Support', 'DingTalkMac'),
    ...['5ZSL2CJU2T.com.dingtalk.mac', 'com.alibaba.DingTalkMac'].map(bundle => path.join(library, 'Containers', bundle, 'Data', 'Library', 'Application Support', 'DingTalkMac'))]
  const found = candidates.filter(looksLikeRoot)
  if (found.length > 1) throw new SkillError('data_dir_ambiguous', '找到了几个钉钉数据目录，请把聊天数据位置设成正在用的那一个（命令行用 --data-dir）。', { candidates: found })
  return found[0] ?? candidates[0]!
}

/**
 * The DingTalk folder to read: the given one, else DINGTALK_DATA_DIR, else %APPDATA%/DingTalk (on a Mac, macRoot). A
 * picked folder may be one level off, so an account folder (…_v3, or its DBFiles) steps up to the root and a folder
 * holding DingTalk steps down into it.
 */
export function dataRoot(root?: string): string {
  const given = root || process.env.DINGTALK_DATA_DIR
  if (!given && process.platform === 'darwin') return macRoot()
  // The desktop host supplies Windows' appData path. Standalone/headless launches can omit
  // APPDATA; never resolve that case relative to the command's working directory.
  if (!given) return path.resolve(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'DingTalk')
  let at = path.resolve(given)
  if (path.basename(at).toLowerCase() === 'dbfiles') at = path.dirname(at)
  if (isAccountName(path.basename(at)) && existsSync(path.join(at, 'DBFiles'))) return path.dirname(at)
  if (!looksLikeRoot(at) && looksLikeRoot(path.join(at, 'DingTalk'))) return path.join(at, 'DingTalk')
  return at
}

/**
 * Account uids from the v3 global store, or why it could not be read. A missing store keeps the database_missing
 * status; a failed key or snapshot keeps its own error, so the caller can report the real reason.
 */
function readGlobalUids(base: string): { uids: string[] } | { error: unknown } {
  let header: Buffer
  try { header = readBytes(path.join(base, 'globalStorage', 'storage.db')).subarray(0, 16) } catch (error) {
    return { error: error instanceof SkillError && error.status === 'database_missing' ? new SkillError('database_missing', GLOBAL_MISSING) : error }
  }
  if (header.length < 16) return { error: new SkillError('database_missing', GLOBAL_MISSING) }
  try { return { uids: globalUids(base, header) } } catch (error) { return { error } }
}

/**
 * Every v2/v3 account directory whose dingtalk.db header is verified by its version-specific key. When one uid verifies
 * in both formats only the v3 directory is kept (references/local.md): the client writes new data there, and two
 * identical entries would make the account picker and --profile <uid> ambiguous.
 */
export function discover(root?: string): Profile[] {
  const chosen = Boolean(root || process.env.DINGTALK_DATA_DIR)
  const base = dataRoot(root)
  let entries: string[]
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isAccountName(entry.name))
      .map(entry => entry.name).sort(compareNames)
  } catch {
    throw new SkillError('database_missing', chosen ? FOLDER_EMPTY : '未找到钉钉数据目录。数据不在默认位置的，请把聊天数据位置设成里面有 globalStorage 的 DingTalk 文件夹（命令行用 --data-dir）。')
  }
  if (!entries.length) throw new SkillError('database_missing', chosen ? FOLDER_EMPTY : '钉钉数据目录中没有账号数据库；请先在这台电脑登录钉钉。')
  const profiles: Profile[] = []
  // The global store is decrypted at most once; a failure is kept and reported only if no account verifies.
  let global: ReturnType<typeof readGlobalUids> | undefined
  for (const name of entries) {
    const directory = path.join(base, name)
    const dbFile = path.join(directory, 'DBFiles', 'dingtalk.db')
    if (name.endsWith('_v2')) {
      const uid = name.slice(0, -3)
      if (!/^\d{5,24}$/.test(uid)) continue
      try {
        const key = v2UserKey(uid)
        const header = readBytes(dbFile).subarray(0, 16)
        if (header.length === 16 && decrypt(header, key).equals(HEADER)) profiles.push({ id: name, uid, path: directory, key })
      } catch { /* Another account may be incomplete or belong to a different client format. */ }
      continue
    }
    global ??= readGlobalUids(base)
    if ('error' in global) continue
    try {
      const config = parseConfig(path.join(directory, 'user_config'))
      const salt = config.salt
      if (typeof salt !== 'string' || salt.length < 1 || salt.length > 256) continue
      const header = readBytes(dbFile).subarray(0, 16)
      if (header.length < 16) continue
      for (const uid of global.uids) {
        const key = userKey(uid, salt)
        if (decrypt(header, key).equals(HEADER)) { profiles.push({ id: name, uid, path: directory, key }); break }
      }
    } catch { continue }
  }
  const upgraded = new Set(profiles.filter(profile => profile.id.endsWith('_v3')).map(profile => profile.uid))
  const kept = profiles.filter(profile => !(profile.id.endsWith('_v2') && upgraded.has(profile.uid)))
  if (kept.length) return kept
  if (global && 'error' in global) throw global.error
  throw new SkillError('database_key_unavailable', '未找到可校验的钉钉 v2/v3 账号数据库；请确认已在这台电脑登录受支持的钉钉版本。')
}

function parseConfig(file: string): { salt?: unknown } {
  const decoded = strictBase64(readFileSync(file))
  const parsed = JSON.parse(decoded.toString('utf8'))
  return parsed && typeof parsed === 'object' ? parsed : {}
}

// localeCompare would reorder digits and mixed scripts; account ids sort by UTF-16 code unit, which is enough here.
const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function selectProfile(profiles: Profile[], selector?: string): Profile {
  if (selector) {
    const found = profiles.filter(profile => selector === profile.id || selector === profile.uid)
    if (found.length === 1) return found[0]!
    throw new SkillError('profile_not_found', '账号未找到，请运行 profiles 查看可用账号。')
  }
  if (profiles.length !== 1) {
    throw new SkillError('profile_ambiguous', '本机有多个账号，请用 --profile 指定账号目录 ID。',
      { candidates: profiles.map(profile => ({ id: profile.id, uid: profile.uid })) })
  }
  return profiles[0]!
}
