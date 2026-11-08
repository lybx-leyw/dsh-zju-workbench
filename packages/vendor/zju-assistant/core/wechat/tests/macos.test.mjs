import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createCipheriv, createHmac, pbkdf2Sync } from 'node:crypto'
import { accountsIn, checksum, decodeImage, decryptDatabase, macImage, readMac } from '../lib/macos.mjs'

// 都是合成数据：照 SQLCipher 4 的页格式加密两页，和 weread-skill 的 macos-runtime.py 用的是同一种构造。
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1))
const SALT = Buffer.from(Array.from({ length: 16 }, (_, i) => i))
const IV = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 16))
const MAC = pbkdf2Sync(KEY, SALT.map((b) => b ^ 0x3a), 2, 32, 'sha512')

const room = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mac-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function encryptPage(plain, number, key = KEY) {
  const skip = number === 1 ? 16 : 0
  const cipher = createCipheriv('aes-256-cbc', key, IV)
  cipher.setAutoPadding(false)
  const body = Buffer.concat([cipher.update(plain.subarray(skip, 4016)), cipher.final()])
  const no = Buffer.alloc(4)
  no.writeUInt32LE(number)
  const digest = createHmac('sha512', MAC).update(body).update(IV).update(no).digest()
  return Buffer.concat([skip ? SALT : Buffer.alloc(0), body, IV, digest])
}

function pages(count = 2) {
  const first = Buffer.alloc(4096)
  first.write('SQLite format 3\0', 'latin1')
  Buffer.from('1000010150402020', 'hex').copy(first, 16)
  first.writeUInt32BE(count, 28)
  const second = Buffer.concat([Buffer.alloc(4016, 'A'), Buffer.alloc(80)])
  return { first, second }
}

function wal(records, { little = true, salt = [1234, 5678] } = {}) {
  const header = Buffer.alloc(24)
  header.writeUInt32BE(little ? 0x377f0682 : 0x377f0683, 0)
  header.writeUInt32BE(3007000, 4)
  header.writeUInt32BE(4096, 8)
  header.writeUInt32BE(salt[0], 16)
  header.writeUInt32BE(salt[1], 20)
  let state = checksum(header, 0, 0, little)
  const parts = [header, Buffer.from(state.flatMap((v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]))]
  for (const { number, commit, page, frameSalt = salt } of records) {
    const frame = Buffer.alloc(24)
    frame.writeUInt32BE(number, 0)
    frame.writeUInt32BE(commit, 4)
    frame.writeUInt32BE(frameSalt[0], 8)
    frame.writeUInt32BE(frameSalt[1], 12)
    state = checksum(frame.subarray(0, 8), ...state, little)
    state = checksum(page, ...state, little)
    frame.writeUInt32BE(state[0], 16)
    frame.writeUInt32BE(state[1], 20)
    parts.push(frame, page)
  }
  return Buffer.concat(parts)
}

test('a SQLCipher 4 database decrypts page by page in memory and the file is left as it was', (t) => {
  const dir = room(t),
    file = path.join(dir, 'contact.db')
  const { first, second } = pages()
  const encrypted = Buffer.concat([encryptPage(first, 1), encryptPage(second, 2)])
  fs.writeFileSync(file, encrypted)
  assert.deepEqual(decryptDatabase(file, KEY), Buffer.concat([first, second]))
  assert.deepEqual(fs.readFileSync(file), encrypted)
  assert.deepEqual(fs.readdirSync(dir), ['contact.db'], 'no plaintext copy is written')
  assert.throws(() => decryptDatabase(file, Buffer.alloc(32)), /authentication/)
  const damaged = Buffer.from(encrypted)
  damaged[5000] ^= 1
  fs.writeFileSync(file, damaged)
  assert.throws(() => decryptDatabase(file, KEY), /authentication/)
})

test('committed WAL pages replace the database page under both byte orders; uncommitted frames and stale tails do not', (t) => {
  const dir = room(t),
    file = path.join(dir, 'message_0.db')
  const { first, second } = pages()
  fs.writeFileSync(file, Buffer.concat([encryptPage(first, 1), encryptPage(second, 2)]))
  const newer = Buffer.concat([Buffer.alloc(4016, 'B'), Buffer.alloc(80)]),
    pending = Buffer.concat([Buffer.alloc(4016, 'C'), Buffer.alloc(80)])
  for (const little of [true, false]) {
    fs.writeFileSync(file + '-wal', wal([{ number: 2, commit: 2, page: encryptPage(newer, 2) }, { number: 2, commit: 0, page: encryptPage(pending, 2) }], { little }))
    assert.deepEqual(decryptDatabase(file, KEY).subarray(4096), newer)
  }
  fs.writeFileSync(file + '-wal', wal([{ number: 2, commit: 2, page: encryptPage(newer, 2) }, { number: 2, commit: 2, page: encryptPage(pending, 2), frameSalt: [1, 2] }]))
  assert.deepEqual(decryptDatabase(file, KEY).subarray(4096), newer, 'a frame from an older WAL generation ends the log')
  const broken = wal([{ number: 2, commit: 2, page: encryptPage(newer, 2) }])
  broken[broken.length - 1] ^= 1
  fs.writeFileSync(file + '-wal', broken)
  assert.throws(() => decryptDatabase(file, KEY), /checksum/)
})

test('a chosen folder is accepted at any level, and several accounts are all listed', (t) => {
  const dir = room(t)
  const account = (name) => {
    const folder = path.join(dir, 'Documents', 'xwechat_files', name)
    fs.mkdirSync(path.join(folder, 'db_storage', 'contact'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'db_storage', 'contact', 'contact.db'), 'x')
    return fs.realpathSync(folder)
  }
  const one = account('wxid_one_1a2b')
  assert.deepEqual(accountsIn(one), [one])
  assert.deepEqual(accountsIn(path.join(one, 'db_storage')), [one])
  assert.deepEqual(accountsIn(path.join(dir, 'Documents', 'xwechat_files')), [one])
  assert.deepEqual(accountsIn(path.join(dir, 'Documents')), [one])
  const two = account('another')
  assert.deepEqual(accountsIn(path.join(dir, 'Documents')), [two, one].sort())
  assert.deepEqual(accountsIn(path.join(dir, 'nowhere')), [])
})

test('the Mac reader lists accounts, says when there is none or several, and refuses --offline', async (t) => {
  const dir = room(t),
    root = path.join(dir, 'xwechat_files')
  assert.deepEqual(await readMac({ op: 'list' }, root), { error: 'wechat_database_missing' })
  assert.deepEqual(await readMac({ op: 'list', 'data-dir': path.join(dir, 'elsewhere') }, root), { error: 'wechat_folder_unrecognized' })
  for (const name of ['wxid_a_1', 'wxid_b_2']) {
    fs.mkdirSync(path.join(root, name, 'db_storage', 'contact'), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'db_storage', 'contact', 'contact.db'), 'x')
  }
  const listed = await readMac({ op: 'profiles' }, root)
  assert.deepEqual(listed.profiles.map((p) => p.id), ['wxid_a_1', 'wxid_b_2'])
  assert.deepEqual(await readMac({ op: 'contacts' }, root), { error: 'multiple_wechat_profiles' })
  assert.equal((await readMac({ op: 'contacts', offline: true }, root)).status, 'invalid_input')
})

const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), Buffer.alloc(300, 7), Buffer.from('ffd9', 'hex')])

function cached(version, image, key, xorSize, xor) {
  const size = 64
  const cipher = createCipheriv('aes-128-ecb', key, null)
  const head = Buffer.concat([cipher.update(image.subarray(0, size)), cipher.final()])
  const header = Buffer.alloc(15)
  Buffer.from(`\x07\x08V${version}\x08\x07`, 'latin1').copy(header)
  header.writeUInt32LE(size, 6)
  header.writeUInt32LE(xorSize, 10)
  const middle = image.subarray(size, image.length - xorSize),
    tail = image.subarray(image.length - xorSize).map((b) => b ^ xor)
  return Buffer.concat([header, head, middle, tail])
}

test('cached chat images decode: V1 with its fixed key, V2 with the key the reader returns, and XOR-only files', async (t) => {
  const dir = room(t),
    account = path.join(dir, 'wxid_abc_1234'),
    attach = path.join(account, 'msg', 'attach', 'x')
  fs.mkdirSync(attach, { recursive: true })
  const v1 = path.join(attach, 'v1.dat')
  fs.writeFileSync(v1, cached(1, JPEG, Buffer.from('cfcd208495d565ef', 'latin1'), 20, 0x33))
  const noKey = async () => assert.fail('a V1 image needs no key from WeChat')
  assert.deepEqual(await decodeImage(v1, account, noKey), { data: JPEG, kind: 'jpg' })

  const key = Buffer.from('0123456789abcdef', 'latin1'),
    asked = []
  const v2 = path.join(attach, 'v2.dat')
  fs.writeFileSync(v2, cached(2, JPEG, key, 10, 0x5a))
  const decoded = await decodeImage(v2, account, async (head, size) => (asked.push([head.length, size]), Buffer.from(key)))
  assert.deepEqual(decoded, { data: JPEG, kind: 'jpg' })
  assert.deepEqual(asked, [[80, 64]])
  await assert.rejects(decodeImage(v2, account, async () => Buffer.from('fedcba9876543210', 'latin1')), { status: 'image_decode_failed' })

  const xorOnly = path.join(attach, 'plain.dat')
  fs.writeFileSync(xorOnly, JPEG.map((b) => b ^ 0x21))
  assert.deepEqual(await decodeImage(xorOnly, account, noKey), { data: JPEG, kind: 'jpg' })

  // 导出只往微信数据目录之外写，文件名加上认出来的格式。
  const out = path.join(dir, 'out')
  fs.mkdirSync(out)
  const saved = await macImage(v1, account, path.join(out, '001'))
  assert.deepEqual(saved, { file: path.join(out, '001.jpg'), format: 'jpg' })
  assert.deepEqual(fs.readFileSync(saved.file), JPEG)
  await assert.rejects(macImage(v1, account, path.join(account, 'inside')), { status: 'invalid_input' })
})

test('the Mac memory reader compiles with the flags it is built with', { skip: process.platform !== 'darwin' && '只在 macOS 上编得了' }, (t) => {
  const dir = room(t),
    source = new URL('../scripts/local/macos-memory.c', import.meta.url)
  const result = spawnSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', source.pathname, '-o', path.join(dir, 'reader')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
