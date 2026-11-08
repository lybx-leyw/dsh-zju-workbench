import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, beijing, datesIn, meetsIn, memoEvents, mondayOf, normalizeCalendar, normalizeEvent, ownEvents, parseWeeks, planDay, planDays, semesterKey, termAt, weekdayOf } from './calendar.mjs'

/** 2026-2027 秋学期：9 月 14 日（周一）是第 1 周；国庆放 10-01 到 10-07，10-10（周六）补 10-01（周四）的课。日子是编的，只用来测算法。 */
const CALENDAR = normalizeCalendar({
  terms: [{ year: '2026-2027', term: '秋', start: '2026-09-14' }, { year: '2026-2027', term: '冬', start: '2026-11-09', weeks: 8 }],
  days: [{ date: '2026-10-01', until: '2026-10-07', off: true, note: '国庆节' }, { date: '2026-10-10', as: '2026-10-01', note: '国庆调休' }],
})
const meeting = (weekday, startTime, endTime, extra = {}) => ({ weekday, periods: [1, 2], startTime, endTime, location: '东1A-101', weeks: '第1-8周', weekPattern: '每周', ...extra })
const AUTUMN = {
  year: '2026-2027', term: '秋', periodTimes: [],
  courses: [
    { name: '数据结构基础', teacher: '张老师', term: '秋冬', meetings: [meeting(1, '08:00', '09:35'), meeting(4, '10:00', '11:35')] },
    { name: '大学物理实验', teacher: '李老师', term: '秋', meetings: [meeting(3, '13:25', '15:50', { weekPattern: '单周' })] },
    { name: '形势与政策', teacher: '王老师', term: '秋', meetings: [meeting(2, '18:50', '20:25', { weeks: '第2-3,6周' })] },
  ],
}
const data = (patch = {}) => ({ calendar: CALENDAR, timetables: { '2026-2027|秋': AUTUMN }, current: '2026-2027|秋', events: [], ...patch })
const titles = day => day.items.map(item => item.title)

test('dates are counted as calendar days, Monday is 1', () => {
  assert.equal(weekdayOf('2026-10-18'), 7)
  assert.equal(weekdayOf('2026-10-19'), 1)
  assert.equal(weekdayOf('1969-12-31'), 3)
  assert.equal(mondayOf('2026-10-18'), '2026-10-12')
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.deepEqual(beijing(Date.parse('2026-10-18T17:30:00Z')), { date: '2026-10-19', time: '01:30' })
})

test('a date falls in a term week; outside every term is null', () => {
  assert.deepEqual(termAt(CALENDAR, '2026-09-14'), { year: '2026-2027', term: '秋', week: 1 })
  assert.deepEqual(termAt(CALENDAR, '2026-10-18'), { year: '2026-2027', term: '秋', week: 5 })
  assert.deepEqual(termAt(CALENDAR, '2026-11-08'), { year: '2026-2027', term: '秋', week: 8 })
  assert.deepEqual(termAt(CALENDAR, '2026-11-09'), { year: '2026-2027', term: '冬', week: 1 })
  assert.equal(termAt(CALENDAR, '2026-09-13'), null)
})

test('week lists and odd/even weeks decide which weeks a class meets', () => {
  assert.deepEqual([...parseWeeks('第1-4,6-8周')], [1, 2, 3, 4, 6, 7, 8])
  assert.deepEqual([...parseWeeks('第2周')], [2])
  assert.equal(parseWeeks('第1-8周(单)'), null)
  assert.equal(meetsIn(meeting(1, '', '', { weekPattern: '单周' }), 3), true)
  assert.equal(meetsIn(meeting(1, '', '', { weekPattern: '单周' }), 4), false)
  assert.equal(meetsIn(meeting(1, '', '', { weekPattern: '双周' }), 4), true)
  assert.equal(meetsIn(meeting(1, '', '', { weeks: '第2-3,6周' }), 5), false)
  // 认不出来的周次当作每周都有，单双周照样算。
  assert.equal(meetsIn(meeting(1, '', '', { weeks: '见通知', weekPattern: '双周' }), 6), true)
})

test('a normal day gets its weekday classes for that week', () => {
  const monday = planDay(data(), '2026-09-21')
  assert.deepEqual(monday.term, { year: '2026-2027', term: '秋', week: 2 })
  assert.deepEqual(titles(monday), ['数据结构基础'])
  assert.equal(monday.items[0].time, '08:00')
  assert.equal(monday.items[0].end, '09:35')
  // 单周的课：第 1 周有，第 2 周没有。
  assert.deepEqual(titles(planDay(data(), '2026-09-16')), ['大学物理实验'])
  assert.deepEqual(titles(planDay(data(), '2026-09-23')), [])
  // 第2-3,6周的课：第 4 周没有。
  assert.deepEqual(titles(planDay(data(), '2026-09-22')), ['形势与政策'])
  assert.deepEqual(titles(planDay(data(), '2026-10-06')), [])
})

test('holidays have no classes and a make-up day takes the classes of the day it stands for', () => {
  const holiday = planDay(data(), '2026-10-05')
  assert.deepEqual(holiday.off, { note: '国庆节' })
  assert.deepEqual(holiday.items, [])
  assert.deepEqual(planDay(data(), '2026-10-01').items, [])
  assert.deepEqual(titles(planDay(data(), '2026-10-08')), ['数据结构基础'])
  const swapped = planDay(data(), '2026-10-10')
  assert.deepEqual(swapped.swap, { as: '2026-10-01', weekday: 4, note: '国庆调休' })
  assert.deepEqual(swapped.term, { year: '2026-2027', term: '秋', week: 3 })
  assert.deepEqual(titles(swapped), ['数据结构基础'])
})

test('a week in a term whose timetable was never read says which one is missing', () => {
  const day = planDay(data(), '2026-11-09')
  assert.equal(day.missing, '2026-2027|冬')
  assert.deepEqual(day.items, [])
})

test('without the current term in the calendar, classes are laid out every week and marked loose', () => {
  const loose = planDay(data({ calendar: normalizeCalendar({}) }), '2026-09-23')
  assert.equal(loose.loose, true)
  assert.deepEqual(titles(loose), ['大学物理实验'])
  assert.equal(loose.term, null)
})

test('events land on their day: untimed first, then by time with classes before others at the same time', () => {
  const events = [
    { kind: 'due', date: '2026-09-21', time: '08:00', title: '实验三' },
    { kind: 'event', date: '2026-09-21', title: '交体检表' },
    { kind: 'exam', date: '2026-09-22', time: '08:00', title: '别的那天' },
  ]
  const day = planDay(data({ events }), '2026-09-21')
  assert.deepEqual(day.items.map(item => `${item.kind}:${item.title}`), ['event:交体检表', 'class:数据结构基础', 'due:实验三'])
  assert.equal(planDays(data({ events }), '2026-09-21', '2026-09-27').length, 7)
})

test('the calendar refuses what it cannot lay out, and says where', () => {
  assert.throws(() => normalizeCalendar({ terms: [{ year: '2026-2027', term: '秋', start: '2026-09-15' }] }), /周一/)
  assert.throws(() => normalizeCalendar({ terms: [{ year: '2026', term: '秋', start: '2026-09-14' }] }), /学年/)
  assert.throws(() => normalizeCalendar({ terms: [{ year: '2026-2027', term: '秋季', start: '2026-09-14' }] }), /学期/)
  assert.throws(() => normalizeCalendar({ terms: [{ year: '2026-2027', term: '秋', start: '2026-09-14' }, { year: '2026-2027', term: '冬', start: '2026-10-26' }] }), /重叠/)
  assert.throws(() => normalizeCalendar({ days: [{ date: '2026-10-10' }] }), /放假.*调休/)
  assert.throws(() => normalizeCalendar({ days: [{ date: '2026-10-10', as: '2026-10-10' }] }), /同一天/)
  assert.throws(() => normalizeCalendar({ days: [{ date: '2026-10-01', until: '2026-10-07', off: true }, { date: '2026-10-05', off: true }] }), /写了两次/)
  assert.throws(() => normalizeCalendar({ days: [{ date: '2026-02-30', off: true }] }), /日期/)
})

test('memo times are read the way people and the notice summary write them', () => {
  assert.deepEqual(datesIn('2026-10-21', '2026-10-01'), [{ date: '2026-10-21', text: '2026-10-21' }])
  assert.deepEqual(datesIn('2026-10-25 14:00', '2026-10-01'), [{ date: '2026-10-25', time: '14:00', text: '2026-10-25 14:00' }])
  assert.deepEqual(datesIn('10月21日17:00前（提交材料）；10月25日前报名', '2026-10-08').map(({ date, time }) => ({ date, time })), [
    { date: '2026-10-21', time: '17:00' }, { date: '2026-10-25', time: undefined },
  ])
  assert.deepEqual(datesIn('2026年11月3日（周二）14:00-16:00', '2026-10-08')[0], { date: '2026-11-03', time: '14:00', end: '16:00', text: '2026年11月3日（周二）14:00-16:00' })
  assert.equal(datesIn('11月3日下午3点半', '2026-10-08')[0].time, '15:30')
  // 年底记的、没写年份的一月的事，算下一年的。
  assert.equal(datesIn('1月5日', '2026-12-20')[0].date, '2027-01-05')
  assert.deepEqual(datesIn('尽快', '2026-10-08'), [])
})

test('memos with a time or a deadline become events; archived ones and other properties do not', () => {
  const events = memoEvents([
    { title: '校园 AI 创新应用大赛', updatedAt: '2026-10-08T02:41:00Z', properties: [{ key: '状态', value: '进行中' }, { key: '截止', value: '2026-10-21' }, { key: '日期', value: '2026-10-01' }] },
    { title: '体测', updatedAt: '2026-10-08T00:00:00Z', properties: [{ key: '时间', value: '10月24日 8:30' }, { key: '地点', value: '紫金港田径场' }] },
    { title: '旧的', archived: true, updatedAt: '2026-10-08T00:00:00Z', properties: [{ key: '截止', value: '2026-10-09' }] },
  ])
  assert.deepEqual(events, [
    { kind: 'due', from: 'memo', ref: '校园 AI 创新应用大赛', date: '2026-10-21', title: '校园 AI 创新应用大赛', sub: '' },
    { kind: 'event', from: 'memo', ref: '体测', date: '2026-10-24', time: '08:30', title: '体测', sub: '' },
  ])
})

test('a graduate-system class that overlaps the undergraduate timetable is the same class; graduate and own classes skip holidays', () => {
  // 10-19 周一 08:00 有数据结构基础：研究生教务网里同一时间的那节只留本科课表的；别的时间的研究生课照排。
  const graduate = [
    { kind: 'class', from: 'yjsy', date: '2026-10-19', time: '08:00', end: '09:35', title: '数据结构基础', sub: '' },
    { kind: 'class', from: 'yjsy', date: '2026-10-19', time: '13:25', end: '15:50', title: '高级算法', sub: '玉泉曹光彪 301' },
    { kind: 'class', from: 'yjsy', date: '2026-10-02', time: '13:25', end: '15:50', title: '高级算法', sub: '' },
    { kind: 'class', from: 'mine', date: '2026-10-02', time: '18:50', end: '20:25', title: '自己加的课', sub: '' },
    { kind: 'event', from: 'mine', date: '2026-10-02', time: '19:00', title: '看电影', sub: '' },
  ]
  assert.deepEqual(titles(planDay(data({ events: graduate }), '2026-10-19')), ['数据结构基础', '高级算法'])
  // 国庆放假那天课都不排，自己加的日程照排。
  assert.deepEqual(titles(planDay(data({ events: graduate }), '2026-10-02')), ['看电影'])
})

test('own entries are checked when saved, and a weekly one is laid out on every week until its last day', () => {
  assert.deepEqual(normalizeEvent({ title: ' 组会 ', date: '2026-11-05', time: '14:00', end: '15:30', place: '曹光彪 301', until: '2026-11-19' }),
    { title: '组会', date: '2026-11-05', time: '14:00', end: '15:30', place: '曹光彪 301', kind: 'event', until: '2026-11-19' })
  // 只发生一次的不带 until；重复到同一天的也算一次。
  assert.deepEqual(normalizeEvent({ id: 'a1', title: '体测', date: '2026-11-05', until: '2026-11-05', kind: 'class' }), { id: 'a1', title: '体测', date: '2026-11-05', kind: 'class' })
  assert.throws(() => normalizeEvent({ date: '2026-11-05' }), /要写上是什么事/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '11-05' }), /日期/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', time: '25:00' }), /开始时间/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', end: '15:00' }), /几点开始/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', time: '15:00', end: '14:00' }), /晚于开始/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', kind: 'exam' }), /种类/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', until: '2026-11-01' }), /前面/)
  assert.throws(() => normalizeEvent({ title: '组会', date: '2026-11-05', until: '2028-01-01' }), /最多排一年/)
  assert.deepEqual(ownEvents([{ id: 'a1', title: '组会', date: '2026-11-05', time: '14:00', place: '曹光彪 301', kind: 'event', until: '2026-11-20' }]).map(event => [event.date, event.ref, event.sub]),
    [['2026-11-05', 'a1', '曹光彪 301'], ['2026-11-12', 'a1', '曹光彪 301'], ['2026-11-19', 'a1', '曹光彪 301']])
})

test('the graduate system keeps classes by the half-year: autumn and winter, spring and summer', () => {
  assert.equal(semesterKey({ year: '2026-2027', term: '冬', week: 2 }), '2026-2027|秋冬')
  assert.equal(semesterKey({ year: '2026-2027', term: '春', week: 1 }), '2026-2027|春夏')
  assert.equal(semesterKey({ year: '2026-2027', term: '短', week: 1 }), null)
  assert.equal(semesterKey(null), null)
})
