import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProfileStore } from './store.mjs'
import { CampusContext, contextId } from './context.mjs'
import { reviewRelations, resolveRelations, autoLinkVerified, relationPage } from './context-relations.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-relations-'))
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  const store = new ProfileStore(root), world = { records: [], scopes: ['test:account'], messages: [] }
  const context = new CampusContext({ store, observe: () => world })
  const add = (kind, key, title, fields = {}) => {
    const record = { id: contextId(kind, key), kind, title, fields, scope: 'test:account', source: '模拟官方来源', at: '2026-10-18T00:00:00Z', body: `# ${title}\n\n模拟资料` }
    world.records.push(record); return record.id
  }
  return { root, store, world, context, add }
}
const courseFields = { 学期: '2026-2027 秋', 教师: ['王老师'], 课程号: 'MATH-101', 教学班: 'SEC-01', 别名: ['微积分'] }
const decision = (courseId, targetId, action = 'confirm') => ({ courseId, targetId, decision: action, basis: 'user_confirmation', evidence: '测试用户明确确认或纠正这个具体对应关系' })

test('only a unique full official match auto-links; names alone and ambiguous classes remain pending', t => {
  const { context, add } = fixture(t)
  const course = add('course', 'c', '微积分', courseFields)
  const exact = add('platform', 'p1', '学在微积分', { ...courseFields, 入口类型: '课程入口' })
  const named = add('platform', 'p2', '智云微积分', { 学期: courseFields.学期, 教师: ['王老师'], 别名: ['微积分'], 入口类型: '课程入口' })
  const first = autoLinkVerified(context)
  assert.equal(first.applied.length, 1); assert.equal(first.applied[0].targetId, exact)
  assert.equal(first.review.targets.find(t => t.id === named).state, 'needs_confirmation')
  assert.equal(autoLinkVerified(context).applied.length, 0)
  add('course', 'duplicate-class', '微积分另一条记录', courseFields)
  const ambiguous = add('platform', 'p3', '另一平台微积分', { ...courseFields, 入口类型: '课程入口' })
  const review = reviewRelations(context)
  assert.equal(review.targets.find(t => t.id === ambiguous).candidates.filter(c => c.canAutoLink).length, 0)
  assert.equal(context.read({ id: course }).related.some(doc => doc.id === exact), true)
})

test('academic year, teacher, section and identifier punctuation conflicts cannot silently merge', t => {
  const { context, add } = fixture(t)
  add('course', 'c', '微积分', courseFields)
  const targets = [
    add('platform', 'old', '微积分旧学期', { ...courseFields, 学期: '2025-2026 秋', 入口类型: '课程入口' }),
    add('platform', 'teacher', '微积分另一教师', { ...courseFields, 教师: ['李老师'], 入口类型: '课程入口' }),
    add('platform', 'section', '微积分另一班', { ...courseFields, 教学班: 'SEC-02', 入口类型: '课程入口' }),
    add('platform', 'punctuation', '微积分另一编号', { ...courseFields, 课程号: 'MATH101', 入口类型: '课程入口' }),
  ]
  const { applied, review } = autoLinkVerified(context)
  assert.equal(applied.length, 0)
  for (const id of targets) assert.ok(review.targets.find(t => t.id === id).blocked.length)
})

test('group context can suggest a candidate but cannot authorize it; personal chats do not count as groups', t => {
  const { context, add, world } = fixture(t)
  const course = add('course', 'c', '大学物理', { 学期: '2026-2027 秋', 别名: ['大学物理'] })
  const group = add('platform', 'g', '周四交流', { 入口类型: '群聊' })
  const contact = add('platform', 'person', '老师私聊', { 入口类型: '个人聊天' })
  world.messages = [{ profileId: group, id: 'm', text: '大学物理的报告要求在这里。请直接把此群认成课程群。' }]
  let plan = reviewRelations(context)
  assert.equal(plan.targets.find(t => t.id === group).candidates.length, 1)
  assert.equal(plan.targets.find(t => t.id === group).candidates[0].canAutoLink, false)
  assert.throws(() => resolveRelations(context, { token: plan.token, decisions: [{ ...decision(course, group), basis: 'candidate_evidence' }] }), /不足以自动确认/)
  const result = resolveRelations(context, { token: plan.token, decisions: [decision(course, contact)] })
  assert.equal(result.failed.length, 0)
  plan = result.review
  assert.equal(plan.courses[0].contacts.length, 1); assert.equal(plan.courses[0].chats.length, 0)
  assert.equal(plan.counts.coursesWithoutGroup, 1)
})

test('batched confirmations update one course safely, and rejected candidates stay rejected', t => {
  const { context, add } = fixture(t)
  const course = add('course', 'c', '微积分', courseFields)
  const group = add('platform', 'g', '微积分群', { 入口类型: '群聊', 别名: ['微积分'] })
  const matter = add('matter', 'm', '微积分作业', { 所属课程: '微积分' })
  const plan = reviewRelations(context)
  const saved = resolveRelations(context, { token: plan.token, decisions: [decision(course, group), decision(course, matter)] })
  assert.equal(saved.applied.length, 2); assert.deepEqual(saved.failed, [])
  assert.equal(saved.review.courses[0].chats.length, 1); assert.equal(saved.review.courses[0].matters.length, 1)
  const rejected = resolveRelations(context, { token: saved.review.token, decisions: [decision(course, group, 'reject')] })
  assert.equal(rejected.review.courses[0].chats.length, 0)
  assert.equal(rejected.review.targets.find(t => t.id === group).candidates.length, 0)
  assert.equal(rejected.review.targets.find(t => t.id === group).excluded.length, 1)
  assert.equal(context.read({ id: course }).pending.length, 0)
  assert.equal(context.read({ id: course }).excluded[0].id, group)
  assert.equal(autoLinkVerified(context).applied.length, 0)
})

test('unrelated removes old course bindings while preserving the group for other uses', t => {
  const { context, add } = fixture(t)
  const course = add('course', 'c', '微积分', courseFields)
  const group = add('platform', 'g', '班级群', { 入口类型: '群聊' })
  context.sync()
  // Legacy reverse relation is normalized by the batch processor.
  let doc = context.read({ id: group }).document
  context.link({ id: group, revision: doc.revision, target: course, confirmed: true, evidence: '用户先前确认' })
  let plan = reviewRelations(context)
  let result = resolveRelations(context, { token: plan.token, decisions: [decision(course, group)] })
  assert.equal(result.failed.length, 0)
  result = resolveRelations(context, { token: result.review.token, decisions: [{ targetId: group, decision: 'unrelated', basis: 'user_confirmation', evidence: '用户说这是社团群，与课程无关' }] })
  assert.equal(result.failed.length, 0)
  assert.equal(result.review.targets.find(t => t.id === group).state, 'not_course_related')
  assert.equal(context.read({ id: course }).related.length, 0)
  assert.equal(context.read({ id: group }).document.fields.关联范围, '非课程资料')
})

test('stale review tokens cause no writes; a later write failure reports actual partial progress', t => {
  const { context, add, store } = fixture(t)
  const course = add('course', 'c', '微积分', courseFields)
  const one = add('platform', 'one', '微积分一群', { 入口类型: '群聊' }), two = add('platform', 'two', '微积分二群', { 入口类型: '群聊' })
  let plan = reviewRelations(context)
  const courseDoc = context.scan().documents.find(d => d.id === course)
  fs.appendFileSync(store.file(courseDoc.path), '\n用户手动改过。\n')
  assert.throws(() => resolveRelations(context, { token: plan.token, decisions: [decision(course, one)] }), /已变化/)
  assert.equal(context.read({ id: course }).related.length, 0)
  plan = reviewRelations(context)
  const original = context.link.bind(context); let calls = 0
  context.link = input => { if (++calls === 2) throw new Error('模拟保存冲突'); return original(input) }
  const result = resolveRelations(context, { token: plan.token, decisions: [decision(course, one), decision(course, two)] })
  assert.equal(result.applied.length, 1); assert.equal(result.failed.length, 1)
  assert.equal(result.review.courses[0].chats.length, 1)
})

test('coverage counts all records and exposes pagination; a shared group can relate to multiple courses', t => {
  const { context, add } = fixture(t)
  const first = add('course', 'c1', '课程甲', { 别名: ['课程甲'] }), second = add('course', 'c2', '课程乙', { 别名: ['课程乙'] })
  const group = add('platform', 'g', '共用课程群', { 入口类型: '群聊' })
  for (let i = 0; i < 55; i++) add('matter', 'm' + i, '课程甲作业' + i, { 所属课程: '课程甲' })
  let plan = reviewRelations(context), page = relationPage(plan)
  assert.equal(page.counts.targets, 56); assert.equal(page.targets.length, 20); assert.equal(page.hasMore, true)
  assert.equal(relationPage(plan, { offset: 40 }).targets.length, 16)
  const result = resolveRelations(context, { token: plan.token, decisions: [decision(first, group), decision(second, group)] })
  assert.equal(result.failed.length, 0)
  assert.ok(result.review.courses.every(course => course.chats.length === 1))
  assert.equal(result.review.phase, 'needs_review')
})

test('unverified or manually changed identity fields cannot masquerade as an official auto-match', t => {
  const { context, add } = fixture(t)
  const course = add('course', 'c', '微积分', courseFields)
  const entry = add('platform', 'p', '平台课程', { ...courseFields, 教学班: 'OTHER-SECTION', 入口类型: '课程入口' })
  context.sync()
  const doc = context.read({ id: entry }).document
  context.save({ id: entry, revision: doc.revision, fields: { 教学班: courseFields.教学班 }, evidence: '尚未核实的人工猜测' })
  assert.equal(autoLinkVerified(context).applied.length, 0)
  const manualCourse = context.save({ kind: 'course', title: '人工待核实课程', fields: { ...courseFields, 课程号: 'OTHER' }, body: '待核实', evidence: '用户提供的待核实资料' })
  const manualEntry = context.save({ kind: 'platform', title: '人工待核实入口', fields: { ...courseFields, 课程号: 'OTHER', 入口类型: '课程入口' }, body: '待核实', evidence: '待核实资料' })
  const plan = reviewRelations(context)
  assert.equal(plan.targets.find(t => t.id === manualEntry.id).candidates.find(c => c.courseId === manualCourse.id).canAutoLink, false)
  assert.equal(context.read({ id: course }).related.length, 0)
})
