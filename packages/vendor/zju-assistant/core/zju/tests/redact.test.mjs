import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactText } from '../lib/core/redact.mjs'
import { errorEnvelope, log, debug } from '../lib/core/output.ts'
import { ZjuError } from '../lib/core/errors.ts'

test('nested values, cookies and arrays under secret keys are redacted', () => {
  const safe = redact({ cookies: [{ name: 'session', value: 'cookie-fixture' }], password: 12345, nested: { api_key: 'key-fixture' }, status: 401 })
  assert.deepEqual(safe, { cookies: '<redacted>', password: '<redacted>', nested: { api_key: '<redacted>' }, status: 401 })
})
test('URL authentication, query secrets, JSON, bearer tokens and complete cookie headers are redacted', () => {
  for (const text of ['https://user-fixture:pass-fixture@example.test/?access_token=secret-fixture&course=math', 'password="secret-fixture with spaces"', '{"refresh_token":"secret-fixture"}', 'Authorization: Bearer secret-fixture', 'Cookie: a=secret-fixture; b=other-fixture', 'api_key=secret-fixture']) {
    const safe = redactText(text)
    assert.ok(!safe.includes('secret-fixture'), safe)
    assert.ok(!safe.includes('pass-fixture'), safe)
    assert.ok(!safe.includes('other-fixture'), safe)
  }
  assert.ok(redactText('https://example.test/?course=math&token=fixture').includes('course=math'))
})
test('error messages, hints, arbitrary errors and stderr share the redaction boundary', t => {
  const payload = errorEnvelope('test', 'request', new ZjuError('TRANSPORT', 'password=secret-fixture', { hint: 'Bearer bearer-fixture', detail: { url: 'https://example.test/?token=token-fixture' } }))
  assert.ok(!JSON.stringify(payload).includes('secret-fixture'))
  assert.ok(!JSON.stringify(payload).includes('bearer-fixture'))
  assert.ok(!JSON.stringify(payload).includes('token-fixture'))
  assert.ok(!errorEnvelope('test', 'request', new Error('api_key=secret-fixture')).error.message.includes('secret-fixture'))
  const writes = []
  t.mock.method(process.stderr, 'write', chunk => { writes.push(chunk); return true })
  const before = process.env.ZJU_DEBUG
  process.env.ZJU_DEBUG = '1'
  try { log('password=secret-fixture'); debug('Bearer bearer-fixture') }
  finally { if (before === undefined) delete process.env.ZJU_DEBUG; else process.env.ZJU_DEBUG = before }
  assert.equal(writes.length, 2)
  assert.ok(!writes.join('').includes('secret-fixture'))
  assert.ok(!writes.join('').includes('bearer-fixture'))
})
