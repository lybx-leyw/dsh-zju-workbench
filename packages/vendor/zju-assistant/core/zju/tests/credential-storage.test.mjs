import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readAccountFile, writeAccountFile } from '../lib/core/account-file.mjs'
import { createCredentialVault } from '../lib/core/credential-vault.mjs'
import { memoryVault } from './fixtures/vault.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-credentials-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { file: path.join(root, 'accounts.json'), ...memoryVault() }
}

test('legacy accounts migrate atomically; usernames/passwords do not remain on disk', t => {
  const { file, vault, keys } = fixture(t)
  const data = { zju_username: '3251234567', zju_password: 'fictional campus password', cc98_password_2: ' second account ', transport: 'direct' }
  fs.writeFileSync(file, JSON.stringify(data))
  const migrated = readAccountFile(file, { vault })
  assert.deepEqual(migrated.data, data)
  assert.deepEqual(readAccountFile(file, { vault }), migrated)
  const contents = fs.readdirSync(path.dirname(file)).map(name => fs.readFileSync(path.join(path.dirname(file), name), 'utf8')).join('')
  for (const secret of Object.values(data).filter(value => value !== 'direct')) assert.ok(!contents.includes(secret))
  assert.equal(keys.size, 1)
  assert.equal(JSON.parse(migrated.raw).transport, 'direct')
  assert.ok(!migrated.raw.includes([...keys.values()][0]))
})

test('unavailable OS keyring leaves the legacy file intact and refuses a new plaintext save', t => {
  const { file } = fixture(t)
  const vault = createCredentialVault({ entry: () => { throw new Error('backend details must not escape') } })
  const before = JSON.stringify({ zju_password: 'do not lose this fixture' })
  fs.writeFileSync(file, before)
  assert.throws(() => readAccountFile(file, { vault }), /系统凭据库/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  const empty = path.join(path.dirname(file), 'new.json')
  assert.throws(() => writeAccountFile(empty, { password: 'fixture' }, { vault }), /系统凭据库/)
  assert.equal(fs.existsSync(empty), false)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['accounts.json'])
})

test('tampering, missing keys and cross-purpose reuse fail closed', () => {
  const { vault, keys } = memoryVault()
  const sealed = vault.seal('private fixture', 'campus-accounts')
  assert.throws(() => vault.open(sealed, 'campus-mail'), /系统凭据库/)
  const corrupt = { ...sealed, tag: Buffer.alloc(16).toString('base64') }
  assert.throws(() => vault.open(corrupt, 'campus-accounts'), /系统凭据库/)
  keys.clear()
  assert.throws(() => vault.open(sealed, 'campus-accounts'), /系统凭据库/)
})

test('saving reuses the wrapping key, refreshes the nonce, preserves fields, and rejects stale writes', t => {
  const { file, vault, keys } = fixture(t)
  const first = writeAccountFile(file, { zju_password: 'first', cc98_username_3: 'third-user' }, { vault, expectedRaw: '' })
  const second = writeAccountFile(file, { ...first.data, zju_password: 'second' }, { vault, expectedRaw: first.raw })
  assert.equal(keys.size, 1)
  assert.notEqual(JSON.parse(first.raw).sealed.iv, JSON.parse(second.raw).sealed.iv)
  assert.deepEqual(readAccountFile(file, { vault }).data, { zju_password: 'second', cc98_username_3: 'third-user' })
  assert.throws(() => writeAccountFile(file, first.data, { vault, expectedRaw: first.raw }), /别处改过/)
  assert.equal(fs.readFileSync(file, 'utf8'), second.raw)
})

test('public transport metadata cannot be changed without matching authenticated content', t => {
  const { file, vault } = fixture(t)
  writeAccountFile(file, { zju_password: 'fixture', transport: 'webvpn' }, { vault })
  const record = JSON.parse(fs.readFileSync(file, 'utf8')); record.transport = 'direct'
  fs.writeFileSync(file, JSON.stringify(record))
  assert.throws(() => readAccountFile(file, { vault }), /访问方式与密文不一致/)
})
