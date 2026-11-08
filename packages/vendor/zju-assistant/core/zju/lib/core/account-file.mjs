import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { credentialVault, isSealed } from './credential-vault.mjs'
import { atomicRename } from './atomic-rename.mjs'

const FORMAT = 'campus-accounts-v1'
const PURPOSE = 'campus-accounts'
const readRaw = file => {
  try { return fs.readFileSync(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('账号文件无法读取。') }
}
function object(raw) {
  try {
    const data = raw.trim() ? JSON.parse(raw) : {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch { throw new Error('账号文件 accounts.json 的格式不正确。') }
}
function decode(raw, vault) {
  const stored = object(raw)
  if ('format' in stored || 'sealed' in stored) {
    if (stored.format !== FORMAT || !isSealed(stored.sealed)) throw new Error('账号密文格式不正确。')
    const data = object(vault.open(stored.sealed, PURPOSE))
    if ((data.transport || 'webvpn') !== stored.transport) throw new Error('账号文件的访问方式与密文不一致。')
    return { data, sealed: stored.sealed }
  }
  return { data: stored }
}

function locked(file, work) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lock = `${file}.lock`
  let fd
  try { fd = fs.openSync(lock, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = readRaw(lock)
    const pid = Number(owner)
    let abandoned = false
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0) } catch (probe) { abandoned = probe.code === 'ESRCH' }
    } else abandoned = Date.now() - fs.statSync(lock).mtimeMs > 30000
    if (!abandoned) throw new Error('账号正在被另一处保存，请稍后重试。')
    if (readRaw(lock) !== owner) throw new Error('账号正在被另一处保存，请稍后重试。')
    fs.unlinkSync(lock)
    fd = fs.openSync(lock, 'wx', 0o600)
  }
  try { fs.writeFileSync(fd, String(process.pid)); return work() }
  finally { fs.closeSync(fd); fs.unlinkSync(lock) }
}

/** Atomic migration/save: only verified ciphertext is written, never a plaintext backup. */
export function writeAccountFile(file, data, { expectedRaw, vault = credentialVault } = {}) {
  return locked(file, () => {
    const before = readRaw(file)
    if (expectedRaw !== undefined && before !== expectedRaw) throw new Error('账号已在别处改过，请重新读取后再保存。')
    const previous = decode(before, vault).sealed
    const sealed = vault.seal(JSON.stringify(data), PURPOSE, previous)
    const raw = JSON.stringify({ format: FORMAT, transport: data.transport || 'webvpn', sealed }, null, 2) + '\n'
    const temp = `${file}.${randomUUID()}.tmp`
    let written = false
    try {
      fs.writeFileSync(temp, raw, { flag: 'wx', mode: 0o600, flush: true })
      atomicRename(temp, file)
      written = true
      return { raw, data }
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
      if (!written && !previous) { try { vault.forget(sealed) } catch {} }
    }
  })
}

export function readAccountFile(file, { vault = credentialVault } = {}) {
  const raw = readRaw(file)
  const { data, sealed } = decode(raw, vault)
  if (sealed || !Object.keys(data).some(key => key !== 'transport')) return { raw, data }
  return writeAccountFile(file, data, { expectedRaw: raw, vault })
}
