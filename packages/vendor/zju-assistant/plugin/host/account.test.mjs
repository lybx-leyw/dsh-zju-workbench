import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AccountSettings } from './account.mjs'
import { ProfileStore } from './store.mjs'
import { testVault } from '../../core/zju/tests/fixtures/vault.mjs'
import { readAccountFile } from '../../core/zju/lib/core/account-file.mjs'

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-account-'))
  t.after(() => { assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(base, { recursive: true, force: true }) })
  const store = new ProfileStore(path.join(base, 'profile'))
  fs.writeFileSync(store.file('accounts.json'), JSON.stringify({ zju_username: '32200000', zju_password: 'old-secret', webvpn_password: 'vpn-secret', cc98_username_2: 'keep-other-account', transport: 'webvpn' }))
  return { settings: new AccountSettings(store, { vault: testVault }), store, file: store.file('accounts.json') }
}
const saved = file => readAccountFile(file, { vault: testVault }).data

test('账号页拿到密码原文；保存只动给出的项，页面上没有的键原样留着', t => {
  const { settings, file, store } = fixture(t)
  const before = settings.snapshot()
  assert.equal(before.values.zju_password, 'old-secret')
  assert.ok(!fs.readFileSync(file, 'utf8').includes('old-secret'))
  assert.equal(before.values.pta_username, '')
  // 账号只走账号页这一条路，不混进个人档案。
  assert.ok(!JSON.stringify(store.snapshot()).includes('old-secret'))
  assert.ok(!JSON.stringify(store.query()).includes('old-secret'))
  const after = settings.save({ revision: before.revision, values: { transport: 'direct', pta_username: ' me@example.com ', pta_password: ' keep spaces ' } })
  assert.equal(after.values.pta_password, ' keep spaces ')
  assert.deepEqual(saved(file), { zju_username: '32200000', zju_password: 'old-secret', webvpn_password: 'vpn-secret', cc98_username_2: 'keep-other-account', transport: 'direct', pta_username: 'me@example.com', pta_password: ' keep spaces ' })
  // 场馆同伴在「活动与场馆」里填，和别的账号走同一条路。
  const buddy = settings.save({ revision: after.revision, values: { tyys_buddy_username: '32200009', tyys_buddy_password: 'buddy-secret' } })
  assert.equal(buddy.values.tyys_buddy_password, 'buddy-secret')
  assert.equal(saved(file).tyys_buddy_username, '32200009')
})

test('CC98 可以填好几个账号：再添加的键名带 _2、_3，清空就是移除', t => {
  const { settings, file } = fixture(t)
  const before = settings.snapshot()
  // 已经存着的第二个账号页面读得到；没有的不凭空给出来。
  assert.equal(before.values.cc98_username_2, 'keep-other-account')
  assert.equal('cc98_username_3' in before.values, false)
  const added = settings.save({ revision: before.revision, values: { cc98_password_2: ' second ', cc98_username_3: 'third', cc98_password_3: 'p3' } })
  assert.equal(added.values.cc98_password_2, ' second ')
  assert.deepEqual([saved(file).cc98_username_3, saved(file).cc98_password_3], ['third', 'p3'])
  const removed = settings.save({ revision: added.revision, values: { cc98_username_2: '', cc98_password_2: '' } })
  assert.equal('cc98_username_2' in saved(file), false)
  assert.equal('cc98_password_2' in removed.values, false)
  assert.equal(removed.values.cc98_username_3, 'third')
  // 只有 CC98 能这样加；别的账号、超出范围的序号都不收。
  for (const key of ['zju_username_2', 'tyys_buddy_username_2', 'cc98_username_1', 'cc98_username_10', 'cc98_username_x']) {
    assert.throws(() => settings.save({ revision: removed.revision, values: { [key]: 'x' } }), /格式/)
  }
})

test('清空一项就是删掉它；过期版本和非法字段都不能写进去', t => {
  const { settings, file } = fixture(t)
  const before = settings.snapshot()
  const cleared = settings.save({ revision: before.revision, values: { webvpn_password: '' } })
  assert.equal('webvpn_password' in saved(file), false)
  assert.throws(() => settings.save({ revision: before.revision, values: { zju_password: 'new' } }), /别处改过/)
  assert.throws(() => settings.save({ revision: cleared.revision, values: { extra: 'x' } }), /格式/)
  assert.throws(() => settings.save({ revision: cleared.revision, values: { zju_password: 'bad\nline' } }), /格式/)
  assert.throws(() => settings.save({ revision: cleared.revision, values: { zju_username: 'abc' } }), /8–12 位/)
  assert.throws(() => settings.save({ revision: cleared.revision, values: { transport: 'proxy' } }), /访问方式/)
  assert.equal(settings.snapshot().revision, cleared.revision)
})

test('还没有账号文件时给空表单，第一次保存才建文件', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-account-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(base, 'profile')), settings = new AccountSettings(store, { vault: testVault })
  const empty = settings.snapshot()
  assert.equal(empty.values.zju_username, '')
  assert.equal(empty.values.transport, 'webvpn')
  assert.equal(fs.existsSync(store.file('accounts.json')), false)
  settings.save({ revision: empty.revision, values: { zju_username: '32200001', zju_password: 'first' } })
  assert.deepEqual(saved(store.file('accounts.json')), { zju_username: '32200001', zju_password: 'first' })
})
