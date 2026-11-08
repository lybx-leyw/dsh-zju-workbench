import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailVault } from './mail-vault.mjs'
import { memoryVault } from '../../core/zju/tests/fixtures/vault.mjs'
import { createCredentialVault } from '../../core/zju/lib/core/credential-vault.mjs'

function fixture(vault = memoryVault().vault) {
  const records = new Map()
  const service = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, mutate) => { const next = await mutate(records.get(key)); records.set(key, next); return next },
    deleteRecord: async key => records.delete(key),
  }
  return { records, mailbox: mailVault(() => service, vault) }
}
test('legacy mailbox grant is encrypted before its password is returned', async () => {
  const { records, mailbox } = fixture()
  records.set('dsh-zju-campus/mail', { kind: 'grant', payload: { password: 'legacy-mail-fixture' } })
  assert.equal(await mailbox.open('credentials:dsh-zju-campus/mail'), 'legacy-mail-fixture')
  assert.ok(!JSON.stringify([...records.values()]).includes('legacy-mail-fixture'))
  assert.equal(await mailbox.open('credentials:dsh-zju-campus/mail'), 'legacy-mail-fixture')
})
test('keyring failure leaves a legacy grant intact and rejects creating a new one', async () => {
  const vault = createCredentialVault({ entry: () => { throw new Error('locked') } })
  const { records, mailbox } = fixture(vault)
  await assert.rejects(mailbox.seal('new-fixture'), /系统凭据库/)
  assert.equal(records.size, 0)
  const old = { kind: 'grant', payload: { password: 'legacy-fixture' } }
  records.set('dsh-zju-campus/mail', old)
  await assert.rejects(mailbox.open('credentials:dsh-zju-campus/mail'), /系统凭据库/)
  assert.deepEqual(records.get('dsh-zju-campus/mail'), old)
})
