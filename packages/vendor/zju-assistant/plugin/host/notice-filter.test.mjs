import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_BLOCKED, NoticeFilter, parseVerdict } from './notice-filter.mjs'

const notice = (id, title, from = '综合服务网', extra = {}) => ({ id, kind: 'school', title, from, at: '2026-10-10T00:00:00+08:00', ...extra })
const ITEMS = [
  notice('n1', '劳务派遣人员招聘（派遣至浙江大学化学系）'),
  notice('n2', '科研院转发关于发布专项项目申报指南的通知'),
  notice('n3', '关于做好2026年国家助学金评选工作的通知', '学工部'),
  notice('w1', '临湖歌会第十期（观众报名）', '浙大体育与艺术', { kind: 'wechat' }),
]

/** 一个假的模型：answers 里按顺序放它每一次的回答（字符串，或者抛出去的错）；asked 记下每次问了什么。 */
function fixture(t, { identity = { student_level: '本科', college: '计算机科学与技术学院', grade: '2025', campus: '紫金港校区', display_name: '不该给模型的称呼' }, answers = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-notice-filter-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const state = { identity, answers, asked: [], at: Date.parse('2026-10-12T09:00:00+08:00') }
  const filter = new NoticeFilter({
    settingsFile: path.join(root, 'profile', 'notices.json'), cacheFile: path.join(root, 'cache', 'relevance.json'),
    identity: () => state.identity, now: () => state.at,
    ask: async (input) => { state.asked.push(input); const answer = state.answers.shift(); if (answer instanceof Error) throw answer; return answer ?? '{"无关": []}' },
  })
  return { filter, state, root }
}
const hidden = (filter, items = ITEMS) => Object.fromEntries(filter.hidden(items))

test('屏蔽词直接收起，不用问模型；可以改，改完马上照新的来', async (t) => {
  const { filter, state } = fixture(t)
  assert.deepEqual(filter.settings(), { blocked: DEFAULT_BLOCKED, byProfile: true })
  assert.deepEqual(hidden(filter), { n1: 'blocked' }, '没问过模型的不收起')
  await filter.judge(ITEMS)
  assert.equal(state.asked.length, 1)
  assert.doesNotMatch(state.asked[0].text, /劳务派遣/, '有屏蔽词的不拿去问')

  assert.deepEqual(filter.save({ blocked: [' 项目申报 ', '项目申报', '', 'x'.repeat(30)] }).blocked, ['项目申报'], '去掉空的、重复的和太长的')
  assert.deepEqual(hidden(filter), { n2: 'blocked' })
  assert.throws(() => filter.save({ blocked: '劳务派遣' }), /格式不对/)
  assert.deepEqual(filter.save({ blocked: [] }).blocked, [], '清空了就是一个都不要，不回到默认的')
})

test('模型照基础信息判断：只给它看要用的几项，一条只问一次，基础信息变了全部重问', async (t) => {
  const { filter, state } = fixture(t, { answers: ['好的，结果如下：\n```json\n{"无关": [1]}\n```'] })
  await filter.judge(ITEMS)
  const { system, text } = state.asked[0]
  assert.match(system, /拿不准的算有关/)
  assert.match(text, /基础信息：\{"培养层次":"本科","学院":"计算机科学与技术学院","入学年份":"2025","校区":"紫金港校区"\}/)
  assert.doesNotMatch(text, /称呼/)
  assert.match(text, /今天：2026-10-12/)
  // 新的在前；公众号的文章写明是公众号。
  assert.deepEqual(text.split('\n').slice(3), ['1. [综合服务网] 科研院转发关于发布专项项目申报指南的通知', '2. [学工部] 关于做好2026年国家助学金评选工作的通知', '3. [公众号·浙大体育与艺术] 临湖歌会第十期（观众报名）'])
  assert.deepEqual(hidden(filter), { n1: 'blocked', n2: 'irrelevant' })

  // 再来一遍不重复问；多了两条只问新的那两条。二课的活动写明是二课，后面是举办单位。
  await filter.judge(ITEMS)
  assert.equal(state.asked.length, 1)
  state.answers.push('{"无关": [1]}')
  await filter.judge([...ITEMS, notice('n4', '关于举办教职工发展对象培训班的通知'), notice('s1', '新生杯辩论赛', '校学生会', { kind: 'sztz' })])
  assert.deepEqual([state.asked.length, state.asked[1].text.split('\n').slice(3)], [2, ['1. [综合服务网] 关于举办教职工发展对象培训班的通知', '2. [二课·校学生会] 新生杯辩论赛']])
  assert.match(state.asked[1].system, /来源以「二课」开头的是素质拓展平台上可以报名的学生活动/)

  // 关掉以后只剩屏蔽词；再打开，以前的判断还在。
  filter.save({ byProfile: false })
  assert.deepEqual(hidden(filter), { n1: 'blocked' })
  await filter.judge([...ITEMS, notice('n5', '还没问过的一条')])
  assert.equal(state.asked.length, 2, '关着时不问')
  filter.save({ byProfile: true })
  assert.equal(hidden(filter).n2, 'irrelevant')

  // 转成了研究生：以前的判断都不算数，重新问。
  state.identity = { ...state.identity, student_level: '硕士' }
  assert.deepEqual(hidden(filter), { n1: 'blocked' })
  await filter.judge(ITEMS)
  assert.equal(state.asked.length, 3)
})

test('问不成不收起也不抛错，过十分钟再问；一次问不完分几批，问完一批存一批', async (t) => {
  const { filter, state } = fixture(t, { answers: [new Error('模型现在用不了。')] })
  await filter.judge(ITEMS)
  assert.deepEqual(hidden(filter), { n1: 'blocked' })
  await filter.judge(ITEMS)
  assert.equal(state.asked.length, 1, '刚失败过，先不问')
  state.at += 11 * 60_000
  state.answers.push('看不懂的回答')
  await filter.judge(ITEMS)
  assert.deepEqual([state.asked.length, hidden(filter)], [2, { n1: 'blocked' }])

  // 一百条：一批四十条，一轮最多三批；第二批没问成，第一批的判断留着。
  const many = Array.from({ length: 100 }, (_, index) => notice(`m${index}`, `通知 ${index}`, '学工部', { at: new Date(Date.parse('2026-10-01T00:00:00+08:00') + index * 60_000).toISOString() }))
  state.at += 11 * 60_000
  state.answers.push('{"无关": [1, 40, 41, "x"]}', new Error('断了'))
  await filter.judge(many)
  assert.equal(state.asked.length, 4)
  assert.deepEqual(hidden(filter, many), { m99: 'irrelevant', m60: 'irrelevant' }, '超出这一批编号的和不是数字的不算')
  state.at += 11 * 60_000
  await filter.judge(many)
  assert.equal(state.asked.length, 6, '剩下的六十条再问两批')
  assert.equal(state.asked[4].text.split('\n').length - 3, 40)
  assert.equal(state.asked[5].text.split('\n').length - 3, 20)
})

test('模型的回答取第一个花括号到最后一个；格式不对就算没答', () => {
  assert.deepEqual([...parseVerdict('{"无关": [2, 3]}', 3)], [2, 3])
  assert.deepEqual([...parseVerdict('{"irrelevant": []}', 3)], [])
  assert.throws(() => parseVerdict('都有关', 3), /格式/)
  assert.throws(() => parseVerdict('{"无关": "2"}', 3), /格式/)
})
