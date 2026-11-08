import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AccountSettings } from './account.mjs'
import { IdentityFill, fromStudentId } from './identity-fill.mjs'
import { ProfileStore } from './store.mjs'
import { testVault } from '../../core/zju/tests/fixtures/vault.mjs'

function fixture(t, accounts, student = { name: '张三', college: '计算机科学与技术学院', major: '计算机科学与技术' }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-fill-'))
  t.after(() => { assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(base, { recursive: true, force: true }) })
  const store = new ProfileStore(path.join(base, 'profile'))
  fs.writeFileSync(store.file('accounts.json'), JSON.stringify(accounts))
  let calls = 0
  const fill = new IdentityFill(store, new AccountSettings(store, { vault: testVault }), async () => { calls++; if (student instanceof Error) throw student; return student })
  return { fill, store, calls: () => calls }
}
const edit = (store, values) => store.saveIdentity({ values, revision: store.identity().revision })

test('学号首位是培养层次，第 2、3 位是入学年份', () => {
  assert.deepEqual(fromStudentId('3250100000'), { grade: '2025', student_level: '本科' })
  assert.deepEqual(fromStudentId('22351001'), { grade: '2023', student_level: '硕士' })
  assert.deepEqual(fromStudentId(' 12121001 '), { grade: '2021', student_level: '博士' })
  assert.deepEqual(fromStudentId('0012345678'), {})
  assert.deepEqual(fromStudentId(''), {})
})

test('自动填只补空着的项，手动读取时学校给的几项以学校为准，称呼不覆盖', async t => {
  const { fill, store } = fixture(t, { zju_username: '3250100000', zju_password: 'secret' })
  edit(store, { college: '我自己写的学院', display_name: '小张' })

  const auto = await fill.refresh()
  assert.deepEqual(auto.changed, ['入学年份', '培养层次', '专业'])
  assert.deepEqual(store.identity().values, { display_name: '小张', college: '我自己写的学院', major_name: '计算机科学与技术', major_code: '', grade: '2025', student_level: '本科', campus: '' })
  assert.equal(JSON.parse(fs.readFileSync(store.file('identity.json'), 'utf8')).source, '教务网和学号')

  const manual = await fill.refresh({ overwrite: true })
  assert.deepEqual(manual.changed, ['学院'])
  assert.equal(manual.identity.values.college, '计算机科学与技术学院')
  assert.equal(manual.identity.values.display_name, '小张')
  assert.deepEqual((await fill.refresh({ overwrite: true })).changed, [])
})

test('研究生只按学号填，不去教务网', async t => {
  const { fill, store, calls } = fixture(t, { zju_username: '22351001', zju_password: 'secret' })
  const result = await fill.refresh({ overwrite: true })
  assert.deepEqual(result.changed, ['入学年份', '培养层次'])
  assert.match(result.note, /研究生/)
  assert.equal(store.identity().values.student_level, '硕士')
  assert.equal(calls(), 0)
})

test('教务网读不到时，学号能算出来的两项照样填上，并把原因报出来', async t => {
  const { fill, store } = fixture(t, { zju_username: '3250100000', zju_password: 'secret' }, new Error('统一身份认证登录失败'))
  await assert.rejects(fill.refresh({ overwrite: true }), /登录失败/)
  assert.equal(store.identity().values.grade, '2025')
  assert.equal(store.identity().values.college, '')
})

test('没有学号或密码时说清楚去哪里填，不发请求', async t => {
  const none = fixture(t, {})
  await assert.rejects(none.fill.refresh(), /校园账号/)
  const noPassword = fixture(t, { zju_username: '3250100000' })
  await assert.rejects(noPassword.fill.refresh(), /密码/)
  assert.equal(noPassword.calls(), 0)
  assert.equal(noPassword.store.identity().values.student_level, '本科')
})
