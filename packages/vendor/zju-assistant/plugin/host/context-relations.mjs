import { createHash } from 'node:crypto'
import { contextId } from './context.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const identifier = value => typeof value === 'string' || typeof value === 'number' ? String(value).normalize('NFKC').trim() : ''
const list = value => (Array.isArray(value) ? value : String(value ?? '').split(/[、,，;；]/)).map(String).filter(Boolean)
const aliases = doc => [...new Set([doc.meta.所属课程, ...list(doc.meta.别名), doc.title.split('·')[0]].map(norm).filter(value => value.length >= 2))]
const relationOf = role => ({ course_entry: '课程入口', chat: '课程群', contact: '课程沟通', matter: '课程事项' })[role]
function roleOf(doc) {
  if (doc.kind === 'matter') return 'matter'
  if (doc.kind !== 'platform') return null
  if (doc.meta.入口类型 === '个人聊天') return 'contact'
  if (doc.meta.入口类型 === '群聊' || /^(wechat|dingtalk):/.test(doc.meta.范围 || '')) return 'chat'
  if (doc.meta.入口类型 === '课程入口') return 'course_entry'
  // Existing files from the first version retain their fields; use source namespace only to classify them.
  if (/^(xuezai|zhiyun|chaoxing):/.test(doc.meta.范围 || '') && doc.id !== contextId('platform', doc.meta.范围)) return 'course_entry'
  return null
}
function termOf(value) {
  const text = String(value || '').normalize('NFKC').replace(/[–—至~]/g, '-')
  return { year: text.match(/\d{4}(?:-\d{4})?/)?.[0] || '', seasons: [...new Set(text.match(/[春夏秋冬]/g) || [])] }
}
function terms(a, b) {
  const left = termOf(a), right = termOf(b)
  const conflict = !!left.year && !!right.year && left.year !== right.year || left.seasons.length > 0 && right.seasons.length > 0 && !left.seasons.some(s => right.seasons.includes(s))
  const compatible = !conflict && !!left.year && left.year === right.year && left.seasons.length > 0 && right.seasons.length > 0
  return { conflict, compatible }
}
function proposal(course, target, messages) {
  const reasons = [], conflicts = [], missing = []
  const a = aliases(course), b = aliases(target)
  const exactName = a.some(name => b.includes(name))
  const containsName = !exactName && a.some(name => b.some(other => Math.min(name.length, other.length) >= 3 && (other.includes(name) || name.includes(other))))
  const sameCode = !!identifier(course.meta.课程号) && identifier(course.meta.课程号) === identifier(target.meta.课程号)
  const sameSection = !!identifier(course.meta.教学班) && identifier(course.meta.教学班) === identifier(target.meta.教学班)
  const chatMentions = ['chat', 'contact'].includes(roleOf(target)) && messages.some(item => item.profileId === target.id && a.some(name => name.length >= 4 && norm(item.text).includes(name)))
  if (!sameCode && !exactName && !containsName && !chatMentions) return null
  if (sameCode) reasons.push('来源提供的课程号一致')
  if (sameSection) reasons.push('来源提供的教学班标识一致')
  if (exactName) reasons.push('课程名或已记录别名完全一致')
  if (containsName) reasons.push('名称存在包含关系，尚不能证明同一门课')
  if (chatMentions) reasons.push('近期群消息提到课程名称，消息内容尚需核实')
  const semester = terms(course.meta.学期, target.meta.学期 || (['chat', 'contact'].includes(roleOf(target)) ? target.title : ''))
  if (semester.conflict) conflicts.push('来源标出的学年或学期不一致')
  else if (semester.compatible) reasons.push('学年一致且学期相容')
  else missing.push('学年或学期尚未核实')
  const teachersA = list(course.meta.教师).map(norm), teachersB = list(target.meta.教师).map(norm)
  const sameTeacher = teachersA.some(person => teachersB.includes(person))
  if (sameTeacher) reasons.push('任课教师有明确重合')
  else if (teachersA.length && teachersB.length) conflicts.push('两边提供的任课教师不同')
  else missing.push('教师身份尚未由双方来源核实')
  if (course.meta.课程号 && target.meta.课程号 && !sameCode) conflicts.push('课程号不同')
  if (course.meta.教学班 && target.meta.教学班 && !sameSection) conflicts.push('教学班标识不同')
  if (!sameSection) missing.push('教学班未对齐')
  const automaticallyVerifiable = sameCode && sameSection && semester.compatible && conflicts.length === 0
  return { courseId: course.id, courseTitle: course.title, reasons, conflicts, missing, automaticallyVerifiable,
    rank: (sameCode ? 100 : 0) + (sameSection ? 50 : 0) + (exactName ? 30 : containsName ? 10 : 0) + (sameTeacher ? 10 : 0) + (semester.compatible ? 5 : 0) }
}
function edgeBetween(course, target) {
  const forward = (Array.isArray(course.meta.关联) ? course.meta.关联 : []).filter(edge => edge?.目标 === target.id).map(edge => ({ ...edge, ownerId: course.id }))
  const reverse = (Array.isArray(target.meta.关联) ? target.meta.关联 : []).filter(edge => edge?.目标 === course.id).map(edge => ({ ...edge, ownerId: target.id }))
  return [...forward, ...reverse]
}

/** A deterministic inventory + candidate plan. Similarity is evidence for review, never a probability or permission. */
export function reviewRelations(context) {
  context.sync()
  const observation = context.observed(), scanned = context.scan()
  const docs = scanned.documents.filter(doc => context.visible(doc, observation) && doc.meta.状态 !== '已归档')
  const courses = docs.filter(doc => doc.kind === 'course')
  const summaries = new Map(docs.map(doc => [doc.id, context.summary(doc, observation)]))
  const usable = doc => { const state = summaries.get(doc.id); return !state.sourceMissing && !state.sourceChanged }
  const verifiedIdentity = doc => {
    if (doc.meta.核实 === '已确认') return true
    const original = observation.records.find(record => record.id === doc.id)
    return doc.meta.核实 === '来源记录' && !!original && ['课程号', '教学班', '学期', '教师'].every(key => JSON.stringify(doc.meta[key] ?? '') === JSON.stringify(original.fields?.[key] ?? ''))
  }
  const issues = [...observation.warnings, ...scanned.warnings]
  for (const doc of docs) {
    const state = summaries.get(doc.id)
    if (state.sourceMissing) issues.push(`${doc.title}：当前来源不再提供该记录，需核实`)
    else if (state.sourceChanged) issues.push(`${doc.title}：来源与 MD 有差异，需先核实合并`)
  }
  const targets = docs.filter(doc => roleOf(doc)).map(target => {
    const candidates = [], confirmed = [], excluded = [], blocked = []
    for (const course of courses) {
      const edges = edgeBetween(course, target), states = new Set(edges.map(edge => edge.状态))
      if (states.has('已确认') && states.has('已排除')) issues.push(`${course.title} 与 ${target.title} 同时存在确认和排除记录，请纠正`)
      if (states.has('已确认')) confirmed.push({ courseId: course.id, courseTitle: course.title, evidence: edges.filter(edge => edge.状态 === '已确认').map(edge => edge.依据 || '') })
      if (states.has('已排除')) { excluded.push({ courseId: course.id, courseTitle: course.title }); continue }
      const candidate = proposal(course, target, observation.messages)
      if (!candidate) continue
      if (!usable(course) || !usable(target)) { candidate.automaticallyVerifiable = false; candidate.missing.push('来源记录需先核实') }
      if (!verifiedIdentity(course) || !verifiedIdentity(target)) { candidate.automaticallyVerifiable = false; candidate.missing.push('用于自动匹配的身份字段尚未核实或已被人工改动') }
      if (candidate.conflicts.length) {
        blocked.push(candidate)
        if (states.has('已确认')) issues.push(`${course.title} 与 ${target.title} 已关联，但来源存在冲突：${candidate.conflicts.join('；')}`)
      } else candidates.push(candidate)
    }
    candidates.sort((a, b) => b.rank - a.rank || a.courseTitle.localeCompare(b.courseTitle, 'zh'))
    const automatic = candidates.filter(item => item.automaticallyVerifiable)
    // Group text / names never establish an official identifier; no automatic chat association.
    const safe = !['chat', 'contact'].includes(roleOf(target)) && automatic.length === 1 && !confirmed.length && target.meta.关联范围 !== '非课程资料'
    return { id: target.id, title: target.title, revision: target.revision, role: roleOf(target),
      state: target.meta.关联范围 === '非课程资料' ? 'not_course_related' : confirmed.length ? 'confirmed' : candidates.length ? 'needs_confirmation' : 'unmatched',
      confirmed, candidates: candidates.map(candidate => { const { rank: _rank, ...details } = candidate; return { ...details, canAutoLink: safe && candidate === automatic[0] } }), blocked: blocked.map(({ rank: _rank, ...candidate }) => candidate), excluded }
  })
  const courseCoverage = courses.map(course => ({ id: course.id, title: course.title, revision: course.revision,
    entries: targets.filter(target => target.role === 'course_entry' && target.confirmed.some(edge => edge.courseId === course.id)).map(target => ({ id: target.id, title: target.title })),
    chats: targets.filter(target => target.role === 'chat' && target.confirmed.some(edge => edge.courseId === course.id)).map(target => ({ id: target.id, title: target.title })),
    contacts: targets.filter(target => target.role === 'contact' && target.confirmed.some(edge => edge.courseId === course.id)).map(target => ({ id: target.id, title: target.title })),
    matters: targets.filter(target => target.role === 'matter' && target.confirmed.some(edge => edge.courseId === course.id)).map(target => ({ id: target.id, title: target.title })),
  }))
  const counts = { courses: courses.length, targets: targets.length, confirmed: targets.filter(t => t.state === 'confirmed').length, pending: targets.filter(t => t.state === 'needs_confirmation').length, unmatched: targets.filter(t => t.state === 'unmatched').length, excludedFromCourses: targets.filter(t => t.state === 'not_course_related').length, coursesWithoutEntry: courseCoverage.filter(c => !c.entries.length).length, coursesWithoutGroup: courseCoverage.filter(c => !c.chats.length).length }
  const token = hash(docs.map(doc => [doc.id, doc.revision, summaries.get(doc.id).sourceMissing, summaries.get(doc.id).sourceChanged, observation.records.find(row => row.id === doc.id) || null]).sort((a, b) => a[0].localeCompare(b[0])))
  const phase = !courses.length ? 'needs_courses' : counts.pending || counts.unmatched || issues.length ? 'needs_review' : counts.coursesWithoutEntry || counts.coursesWithoutGroup ? 'usable_with_gaps' : 'linked'
  return { root: context.root, indexes: { person: context.store.file('00-个人资料.md'), courses: context.store.file('01-课程.md'), platforms: context.store.file('02-平台入口.md'), matters: context.store.file('03-事项.md') }, token, phase, counts, courses: courseCoverage, targets, issues, note: '覆盖度只针对已启用来源和已选择的聊天；没有课程群关联的课程不能声称已覆盖群通知。候选不是已建立关系。' }
}

/** Keep tool output bounded without hiding the complete coverage counts or unfinished pages. */
export function relationPage(plan, input = {}) {
  const offset = input.offset ?? 0, limit = input.limit ?? 20
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('关系清单分页参数无效。')
  const rows = input.targetId ? plan.targets.filter(row => row.id === input.targetId) : plan.targets
  if (input.targetId && !rows.length) throw new Error('没有找到这个关联目标。')
  const targets = rows.slice(offset, offset + limit).map(row => ({ ...row,
    candidates: input.targetId ? row.candidates : row.candidates.slice(0, 5), candidateCount: row.candidates.length,
    blocked: input.targetId ? row.blocked : row.blocked.slice(0, 5), blockedCount: row.blocked.length,
  }))
  return { ...plan, courses: input.courseId ? plan.courses.filter(row => row.id === input.courseId) : plan.courses.slice(0, 50), courseCount: plan.courses.length,
    targets, targetCount: rows.length, offset, hasMore: offset + targets.length < rows.length, nextOffset: offset + targets.length < rows.length ? offset + targets.length : null }
}

/** Validate the complete reviewed decision batch before writing; preserve partial results if a file changes mid-write. */
export function resolveRelations(context, input) {
  const plan = reviewRelations(context)
  if (input.token !== plan.token) throw new Error('档案或来源已变化，请重新核对关系清单，再合并仍然有效的用户决定。')
  if (!Array.isArray(input.decisions) || !input.decisions.length || input.decisions.length > 100) throw new Error('每次处理 1–100 条明确决定。')
  const seen = new Set(), targetDecisions = new Map()
  for (const item of input.decisions) {
    const target = plan.targets.find(target => target.id === item.targetId), course = plan.courses.find(course => course.id === item.courseId)
    if (!target || !['confirm', 'pending', 'reject', 'unrelated'].includes(item.decision) || (item.decision !== 'unrelated' && !course)) throw new Error('决定指向的课程或目标不存在，请使用关系清单中的编号。')
    const key = `${item.courseId || ''}:${item.targetId}`
    if (seen.has(key)) throw new Error('同一对关系不能在一批决定中重复处理。')
    seen.add(key)
    const prior = targetDecisions.get(item.targetId) || []
    if (prior.length && (item.decision === 'unrelated' || prior.includes('unrelated'))) throw new Error('同一目标不能同时排除出课程范围又关联课程。')
    targetDecisions.set(item.targetId, [...prior, item.decision])
    if (typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 2000) throw new Error('每个决定都要有具体依据。')
    if (item.decision === 'unrelated' && item.basis !== 'user_confirmation') throw new Error('把资料排除出课程范围需要用户明确说明。')
    if (item.decision === 'reject' && item.basis !== 'user_confirmation') throw new Error('永久排除一个候选配对需要用户明确否定。')
    if (item.decision === 'confirm' && item.basis !== 'user_confirmation') {
      if (item.basis !== 'official_identifiers' || !target.candidates.some(candidate => candidate.courseId === item.courseId && candidate.canAutoLink)) throw new Error('这些证据不足以自动确认，请先取得用户确认。')
    }
    if (!['user_confirmation', 'official_identifiers', 'candidate_evidence'].includes(item.basis)) throw new Error('请说明依据来自用户确认、官方标识或候选线索。')
  }
  const applied = [], failed = [], expected = new Map([...plan.courses, ...plan.targets].map(doc => [doc.id, doc.revision]))
  const fresh = id => context.scan().documents.find(doc => doc.id === id)
  const removeEdge = (ownerId, targetId, evidence) => {
    const owner = fresh(ownerId), other = fresh(targetId)
    if (!owner || !other || owner.revision !== expected.get(ownerId) || other.revision !== expected.get(targetId)) throw new Error('关联档案已变化，请重新核对。')
    if (!(Array.isArray(owner.meta.关联) ? owner.meta.关联 : []).some(edge => edge?.目标 === targetId)) return
    const result = context.link({ id: ownerId, revision: owner.revision, target: targetId, targetRevision: other.revision, remove: true, evidence })
    expected.set(ownerId, result.revision)
  }
  for (const item of input.decisions) {
    try {
      const docs = context.scan().documents, target = docs.find(doc => doc.id === item.targetId)
      const reviewedTarget = plan.targets.find(target => target.id === item.targetId)
      if (!target || target.revision !== expected.get(item.targetId)) throw new Error('目标档案已变化，请重新核对。')
      if (item.decision === 'unrelated') {
        for (const course of plan.courses) {
          removeEdge(course.id, target.id, item.evidence)
          removeEdge(target.id, course.id, item.evidence)
        }
        const saved = context.save({ id: target.id, revision: expected.get(target.id), fields: { 关联范围: '非课程资料' }, evidence: item.evidence })
        expected.set(target.id, saved.revision)
      } else {
        const course = docs.find(doc => doc.id === item.courseId)
        if (!course || course.revision !== expected.get(item.courseId)) throw new Error('课程档案已变化，请重新核对。')
        // Normalize legacy reverse edges to one canonical course-side relation.
        removeEdge(target.id, course.id, item.evidence)
        const saved = context.link({ id: course.id, revision: expected.get(course.id), target: target.id, targetRevision: expected.get(target.id), evidence: item.evidence, basis: item.basis,
          relation: relationOf(reviewedTarget.role), confirmed: item.decision === 'confirm', reject: item.decision === 'reject' })
        expected.set(course.id, saved.revision)
      }
      applied.push({ ...item })
    } catch (error) { failed.push({ ...item, error: error.message }); break }
  }
  return { applied, failed, skipped: input.decisions.slice(applied.length + failed.length), review: reviewRelations(context) }
}

export function autoLinkVerified(context) {
  const review = reviewRelations(context), decisions = []
  for (const target of review.targets) for (const candidate of target.candidates) if (candidate.canAutoLink) decisions.push({ targetId: target.id, courseId: candidate.courseId, decision: 'confirm', basis: 'official_identifiers', evidence: candidate.reasons.join('；') })
  if (!decisions.length) return { applied: [], review }
  return resolveRelations(context, { token: review.token, decisions: decisions.slice(0, 100) })
}
