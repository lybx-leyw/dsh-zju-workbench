import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJson } from '../lib/core/fsjson.ts'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zju-atomic-'))
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, { recursive: true }) })
  const file = path.join(dir, 'session.json')
  fs.writeFileSync(file, '{"previous":true}\n')
  return { dir, file }
}
test('Windows temporary sharing violations retry without deleting the existing target', { skip: process.platform !== 'win32' }, t => {
  const { dir, file } = fixture(t), rename = fs.renameSync
  let calls = 0
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++calls < 3) { assert.equal(JSON.parse(fs.readFileSync(file)).previous, true); throw Object.assign(new Error('busy'), { code: 'EPERM' }) }
    return rename(...args)
  })
  writeJson(file, { updated: true })
  assert.equal(calls, 3); assert.equal(JSON.parse(fs.readFileSync(file)).updated, true)
  assert.deepEqual(fs.readdirSync(dir), ['session.json'])
})
test('a failed fsync preserves the original and leaves no plaintext temporary session', t => {
  const { dir, file } = fixture(t)
  t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('disk failure'), { code: 'EIO' }) })
  assert.throws(() => writeJson(file, { token: 'fixture-sensitive-session' }), /disk failure/)
  assert.equal(JSON.parse(fs.readFileSync(file)).previous, true)
  assert.deepEqual(fs.readdirSync(dir), ['session.json'])
})
test('a permanent replacement failure preserves the original and removes the temporary file', t => {
  const { dir, file } = fixture(t)
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }) })
  assert.throws(() => writeJson(file, { token: 'fixture-sensitive-session' }), /read-only/)
  assert.equal(JSON.parse(fs.readFileSync(file)).previous, true)
  assert.deepEqual(fs.readdirSync(dir), ['session.json'])
})
