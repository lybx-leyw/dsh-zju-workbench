import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { credentialVault } from '../lib/core/credential-vault.mjs'
import { readAccountFile } from '../lib/core/account-file.mjs'

test('OS keyring persists across processes and Core can still read migrated accounts', { skip: process.env.CAMPUS_TEST_OS_KEYRING !== '1' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-native-vault-'))
  const file = path.join(root, 'accounts.json')
  let sealed
  t.after(() => { if (sealed) credentialVault.forget(sealed); fs.rmSync(root, { recursive: true, force: true }) })
  fs.writeFileSync(file, JSON.stringify({ zju_username: '3251234567', zju_password: 'native-vault-fixture' }))
  const result = readAccountFile(file)
  sealed = JSON.parse(result.raw).sealed
  const module = new URL('../lib/profile/profile.ts', import.meta.url).href
  const code = `import { credentials } from ${JSON.stringify(module)}; const value = credentials(); if (value.username !== '3251234567' || value.password !== 'native-vault-fixture') process.exit(2); console.log('decryption-ok')`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, CAMPUS_PROFILE_DIR: root }, encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout.trim(), 'decryption-ok')
  assert.ok(!fs.readFileSync(file, 'utf8').includes('native-vault-fixture'))
})
