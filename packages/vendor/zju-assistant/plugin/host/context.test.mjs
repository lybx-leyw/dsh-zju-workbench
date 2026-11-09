import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProfileStore, IDENTITY_DOCUMENT, parseNote } from './store.mjs'
import { CampusContext } from './context.mjs'
import { ContextSources, chatContextId } from './context-sources.mjs'
import { installTools } from './tools.mjs'
import { currentTerm } from './learning.mjs'

const secret = 'test-secret-never-copy-to-md'
function fixture(t, user = 'test-user-a') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-context-'))
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  const store = new ProfileStore(path.join(root, 'profile'))
  const world = { values: { zju_username: user, zju_password: secret, pta_username: user + '@example.test', pta_password: secret }, disabled: [], calls: [], version: 1, failure: '', user }
  const term = currentTerm(Date.now()), semester = term.years + term.seasons
  const watch = {
    enabled: () => !world.disabled.includes('zju-dingtalk'),
    settings: () => ({ tracks: [{ key: user + '-group', id: 'group-1', profile: user, name: '测试课程群' }] }),
    cache: () => ({ states: { [user + '-group']: { checkedAt: '2026-10-18T00:00:00Z' } } }),
    notices: () => [{ id: 'message-1', trackKey: user + '-group', at: '2026-10-18T00:00:00Z', from: '测试老师', body: '本周报告延后提交，请看平台通知。', mode: 'original' }],
  }
  const sources = new ContextSources({ store, account: { read: () => ({ data: world.values }) }, plugins: { disabled: () => world.disabled }, chatWatches: { dingtalk: watch },
    mail: { snapshot: () => ({ enabled: false, connected: false }) },
    fill: { refresh: async () => { const before = store.identity(); if (!before.values.display_name) store.saveIdentity({ revision: before.revision, values: { display_name: user } }, 'human', '测试教务'); return { changed: ['称呼'] } } },
    run: async args => {
      world.calls.push(args.join(' '))
      if (world.failure && args[0] === 'zdbk') throw new Error(world.failure)
      if (args[0] === 'zdbk') return { term: semester, courses: [{ name: `测试课程-${user}`, teacher: '测试老师', meetings: [] }], token: secret }
      if (args[0] === 'zhiyun') return { courses: [{ courseId: 'course-1', title: `测试课程-${user}`, teacher: '测试老师', term: semester }] }
      if (args[0] === 'xuezai' && args[1] === 'course') return { courses: [{ name: `测试课程-${user}`, teachers: ['测试老师'], link: 'https://courses.example.test/course/1?token=' + secret }] }
      if (args[0] === 'xuezai') return { todos: [{ title: '测试报告', course: `测试课程-${user}`, type: '作业', deadline: world.version === 1 ? '2026-10-21 23:59' : '2026-10-23 23:59' }] }
      if (args[0] === 'pta') return { homeworks: [{ name: 'HW1', state: '未开始', url: 'https://pintia.cn/problem-sets/1/exam', deadline: '2026-10-22 23:59' }] }
      throw new Error('unexpected source')
    },
  })
  const context = new CampusContext({ store, observe: () => sources.observe() }), tools = new Map()
  installTools({ tools: { register: tool => tools.set(tool.name, tool) } }, { store, context, contextSources: sources, schedule: {}, alerts: {} })
  // 桌面版的 campus_context_* 合成了一个 campus_context，用 action 分开。
  return { root, store, world, sources, context, call: (name, input = {}) => tools.get('campus_context').execute({ action: name.slice('campus_context_'.length), ...input }, {}) }
}

test('initialization is explicit, repeatable and creates linked editable files from each user’s own sources', async t => {
  const a = fixture(t), b = fixture(t, 'test-user-b')
  assert.equal(a.context.initialized(), false)
  assert.match(a.context.prompt(), /尚未初始化/)
  assert.equal(a.world.calls.length, 0)
  const result = await a.call('campus_context_initialize')
  assert.equal(a.context.initialized(), true)
  assert.ok(result.created > 0)
  assert.equal(result.courses.length, 1)
  assert.equal(result.sources.find(item => item.source === '超星学习通').status, 'account_required')
  assert.ok(result.platforms.some(doc => doc.title.includes('测试课程群')))
  for (const file of [IDENTITY_DOCUMENT, '01-课程.md', '02-平台入口.md', '03-事项.md']) assert.ok(fs.existsSync(a.store.file(file)))
  const before = a.context.scan().documents.map(doc => [doc.id, doc.revision])
  assert.equal((await a.call('campus_context_initialize')).created, 0)
  assert.deepEqual(a.context.scan().documents.map(doc => [doc.id, doc.revision]), before)
  await b.call('campus_context_initialize')
  assert.equal(b.context.read({ query: 'test-user-a' }).total, 0)
  assert.notEqual(a.context.read({ kind: 'course' }).documents[0].id, b.context.read({ kind: 'course' }).documents[0].id)
  for (const doc of a.context.scan().documents) assert.doesNotMatch(doc.raw, /test-secret-never-copy-to-md/)
  assert.doesNotMatch(fs.readFileSync(a.store.file(IDENTITY_DOCUMENT), 'utf8'), /password|test-secret/)
})

test('confirmed course-group links provide group context; pending and disabled sources do not', async t => {
  const { call, context, world } = fixture(t); await call('campus_context_initialize')
  let course = context.read({ kind: 'course' }).documents[0]
  const group = context.read({ kind: 'platform', query: '测试课程群' }).documents[0]
  await call('campus_context_link', { id: course.id, revision: course.revision, target: group.id, evidence: '群名相似，尚未确认' })
  let result = await call('campus_context_read', { id: course.id })
  assert.equal(result.pending.length, 1); assert.equal(result.messages.length, 0)
  // 聊天监控整理时只认已确认的课程。
  assert.equal(group.id, chatContextId('dingtalk', 'test-user-a-group'))
  assert.deepEqual(context.confirmedCourses(group.id), [])
  await call('campus_context_link', { id: course.id, revision: result.document.revision, target: group.id, evidence: '用户明确确认这是本教学班的课程群', confirmed: true })
  result = context.read({ id: course.id })
  assert.equal(result.related[0].id, group.id); assert.equal(result.messages[0].id, 'message-1')
  assert.deepEqual(context.confirmedCourses(group.id), [{ id: course.id, title: course.title, teachers: ['测试老师'] }])
  assert.deepEqual(context.confirmedCourses('platform-00000000000000000000'), [])
  world.disabled.push('zju-dingtalk')
  result = context.read({ id: course.id })
  assert.equal(result.messages.length, 0); assert.equal(result.related.length, 0)
  assert.deepEqual(context.confirmedCourses(group.id), [])
  assert.throws(() => context.read({ id: group.id }), /当前可访问/)
  world.values.zju_username = 'another-user'
  assert.throws(() => context.read({ id: course.id }), /当前可访问/)
})

test('manual Markdown edits remain authoritative; source changes and stale edits are explicit', async t => {
  const { call, context, world, store } = fixture(t); await call('campus_context_initialize')
  const matter = context.read({ kind: 'matter', query: '测试报告' }).documents[0]
  const file = store.file(matter.path), original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, original + '\n这是用户自己补充的安排。\n')
  assert.match(context.read({ id: matter.id }).document.body, /自己补充/)
  await assert.rejects(call('campus_context_save', { id: matter.id, revision: matter.revision, body: 'stale', evidence: '测试旧版本' }), /其他位置更新/)
  world.version = 2
  await call('campus_context_initialize')
  const changed = context.read({ id: matter.id })
  assert.match(changed.document.body, /自己补充/)
  assert.equal(changed.latestObservation.fields.截止时间, '2026-10-23 23:59')
  assert.equal(changed.document.fields.截止时间, '2026-10-21 23:59')
  const merged = await call('campus_context_save', { id: matter.id, revision: changed.document.revision, body: changed.document.body + '\n已核实延期。', fields: { 截止时间: changed.latestObservation.fields.截止时间 }, sourceRevision: changed.latestObservation.revision, evidence: '已核实平台的新截止时间' })
  assert.match(merged.body, /自己补充/)
  assert.equal(context.read({ id: matter.id }).latestObservation, undefined)
  assert.ok(fs.readdirSync(store.file('.history/context')).length)
})

test('source failures preserve prior facts and stop repeated authentication attempts', async t => {
  const { call, context, world } = fixture(t); await call('campus_context_initialize')
  const course = context.read({ kind: 'course' }).documents[0]
  world.calls = []; world.failure = '登录认证失败，请更新密码'
  const result = await call('campus_context_initialize')
  assert.equal(result.sources.find(item => item.source === '教务课表').status, 'error')
  assert.equal(result.sources.find(item => item.source === '学在浙大').status, 'authentication_blocked')
  assert.deepEqual(world.calls, ['zdbk timetable', 'pta homework list'])
  assert.equal(context.read({ id: course.id }).document.title, course.title)
  assert.ok(context.read().warnings.some(text => text.includes('认证失败')))
})

test('personal Markdown migrates existing identity and supports edits from files and existing settings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-context-identity-'))
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  fs.writeFileSync(path.join(root, 'identity.json'), JSON.stringify({ values: { college: '原学院' }, source: '原资料' }))
  const store = new ProfileStore(root), file = store.file(IDENTITY_DOCUMENT)
  assert.equal(store.identity().values.college, '原学院')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('原学院', '手动修改的学院') + '\n我的补充。\n')
  const edited = store.identity()
  assert.equal(edited.values.college, '手动修改的学院')
  assert.equal(JSON.parse(fs.readFileSync(store.file('identity.json'), 'utf8')).values.college, '手动修改的学院')
  store.saveIdentity({ revision: edited.revision, values: { major_name: '新专业' } })
  assert.match(fs.readFileSync(file, 'utf8'), /我的补充/)
  assert.equal(parseNote(fs.readFileSync(file, 'utf8')).meta.专业, '新专业')
})

test('malformed documents are reported without replacement and input cannot escape the profile', async t => {
  const { call, context, store } = fixture(t); await call('campus_context_initialize')
  const course = context.read({ kind: 'course' }).documents[0], file = store.file(course.path)
  fs.writeFileSync(file, '---\n编号: [broken\n---\n原文请保留')
  assert.ok(context.read().warnings.some(text => text.includes('格式')))
  assert.match(fs.readFileSync(file, 'utf8'), /原文请保留/)
  await assert.rejects(call('campus_context_save', { kind: 'course', title: '../outside', body: 'x', evidence: '测试' }), /标题/)
  await assert.rejects(call('campus_context_save', { kind: 'course', title: '测试', body: 'x', fields: { password: secret }, evidence: '测试' }), /属性/)
})

test('academic year separates repeated courses; a room change does not invent a new course', t => {
  const { sources } = fixture(t)
  const source = { id: 'zdbk', name: '教务课表', url: 'https://zdbk.example.test' }
  const course = { name: '微积分', teacher: '测试老师', term: '秋', meetings: [{ weekday: 1, location: '教室甲' }] }
  const records = (year, courses) => sources.records(source, { term: { year, term: '1|秋' }, courses }, 'zdbk:test', '2026-10-18T00:00:00Z').filter(row => row.kind === 'course')
  const first = records('2026-2027', [course])[0]
  assert.equal(first.fields.学期, '2026-2027 秋')
  assert.notEqual(first.id, records('2027-2028', [course])[0].id)
  assert.equal(first.id, records('2026-2027', [{ ...course, meetings: [{ weekday: 1, location: '教室乙' }] }])[0].id)
  const two = records('2026-2027', [course, { ...course, meetings: [{ weekday: 2, location: '教室乙' }] }])
  assert.notEqual(two[0].id, two[1].id)
})

test('a record missing from a later source list is flagged, not silently marked complete', async t => {
  const { call, context, sources } = fixture(t); await call('campus_context_initialize')
  const matter = context.read({ kind: 'matter', query: '测试报告' }).documents[0]
  const before = sources.run
  sources.run = async args => args.join(' ') === 'xuezai todos' ? { todos: [] } : before(args)
  await call('campus_context_initialize')
  const result = context.read({ id: matter.id })
  assert.equal(result.document.sourceMissing, true)
  assert.equal(result.document.fields.状态, '待处理')
  assert.match(result.note, /不能据此认定事项已完成/)
})

test('manually created Markdown produces lossless JSON through native tool output', async t => {
  const { call, store } = fixture(t)
  const created = await call('campus_context_save', { kind: 'course', title: '用户补充的课程', body: '课程来源待补充。', evidence: '用户明确提供' })
  for (const result of [created, await call('campus_context_read', { id: created.id }), await call('campus_context_review')]) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  }
  const opened = await call('campus_context_read', { id: created.id }), review = await call('campus_context_review')
  assert.equal(opened.root, store.root)
  assert.equal(opened.document.file, store.file(opened.document.path))
  assert.ok(fs.existsSync(review.indexes.courses))
})
