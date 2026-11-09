import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Schedule, fromExams, fromGraduate, fromTimetable } from './schedule.mjs'
import { Holidays } from './holidays.mjs'

const meeting = (weekday, startTime, endTime, extra = {}) => ({ weekday, periods: [3, 4], startTime, endTime, location: '东1A-101', weeks: '第1-8周', weekPattern: '每周', ...extra })
/** `zdbk timetable` 的结果，只留排日程用得到的几项。 */
const timetable = (term, courses, year = '2026-2027') => ({
  term: { year, term }, timezone: 'Asia/Shanghai', periodTimes: [{ period: 1, startTime: '08:00', endTime: '08:45' }],
  courses, currentTime: '2026-10-18T10:00:00+08:00', cache: { hit: true },
})
const AUTUMN = timetable('秋', [{ name: '数据结构基础', teacher: '张老师', term: '秋冬', confirmed: true, exam: '', meetings: [meeting(1, '10:00', '11:35'), meeting(3, '13:25', '15:50', { weekPattern: '单周' })] }])
const WINTER = timetable('冬', [{ name: '操作系统', teacher: '陈老师', term: '冬', confirmed: true, exam: '', meetings: [meeting(2, '08:00', '09:35')] }])
const EXAMS = { term: { year: '2026-2027', term: '秋冬' }, count: 2, courses: [
  { name: '数据结构基础', term: '秋冬', credits: '2.5', midterm: { status: '未公布' }, final: { status: '已公布', date: '2026-10-21', startTime: '10:30', endTime: '12:30', location: '紫金港西1-101', seat: '23' } },
  { name: '大学物理', term: '秋冬', credits: '4', midterm: { status: '已公布', time: '另行通知' }, final: { status: '未公布' } },
] }

/** `yjsy timetable` 的结果：研究生教务网一个大学期的课，每次课的日期已经算好。 */
const graduate = (courses = []) => ({ term: { year: '2026-2027', term: '秋冬', start: '2026-09-14', end: '2027-01-15', weeks: 16 }, entry: '本科生入口', periodTimes: [], count: courses.length, courses })
const ALGORITHMS = { name: '高级算法', class: '01', teacher: '刘老师', term: '秋', undergraduate: false, pending: false, meetings: [
  { weekday: 1, periods: [6, 7, 8], startTime: '13:25', endTime: '15:50', location: '玉泉曹光彪301', weeks: '第6-7周', dates: ['2026-10-19', '2026-10-26'] },
] }
const SHARED = { name: '数据结构基础', class: '02', teacher: '张老师', term: '秋', undergraduate: true, pending: true, meetings: [
  { weekday: 1, periods: [3, 4], startTime: '10:00', endTime: '11:35', location: '东1A-101', weeks: '第6周', dates: ['2026-10-19'] },
] }

/** 一套假的账号、开关、作业、备忘和 core，记下 core 被叫了几次。results 的键是 core 的命令（参数用空格连起来）。 */
function setup(t, { accounts = { zju_username: '3240100001', zju_password: 'x' } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-schedule-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = {
    accounts, disabled: [], calls: [], now: Date.parse('2026-10-18T02:00:00Z'), tasks: [], memos: [],
    results: { 'zdbk timetable': AUTUMN, 'zdbk exams': EXAMS, 'zdbk timetable --year 2026-2027 --term 冬': WINTER, 'yjsy timetable --year 2026-2027 --term 秋冬': graduate() },
    file: path.join(root, 'cache', 'schedule.json'), calendarFile: path.join(root, 'profile', 'calendar.json'),
  }
  world.create = () => new Schedule({
    file: world.file, calendarFile: world.calendarFile,
    // 国家的放假安排只用应用带着的 2025、2026 年，测试里不联网。
    holidays: new Holidays({ file: path.join(root, 'cache', 'holidays.json'), now: () => world.now, fetch: async () => { throw new Error('offline') } }),
    account: { read: () => ({ data: world.accounts }) },
    plugins: { disabled: () => world.disabled },
    tasks: () => world.tasks, memos: () => world.memos,
    now: () => world.now,
    run: async (args) => {
      const line = args.join(' ')
      world.calls.push(line)
      const result = world.results[line]
      if (result instanceof Error) throw result
      if (!result) throw new Error(`没有这条命令：${line}`)
      return result
    },
  })
  return world
}

test('core results keep only what the schedule needs', () => {
  const table = fromTimetable(AUTUMN)
  assert.equal(table.year, '2026-2027')
  assert.equal(table.term, '秋')
  assert.deepEqual(table.courses[0].meetings[1], { weekday: 3, periods: [3, 4], startTime: '13:25', endTime: '15:50', location: '东1A-101', weeks: '第1-8周', weekPattern: '单周' })
  assert.equal(fromTimetable({ ...AUTUMN, term: { year: '2026-2027', term: '1|秋' } }).term, '秋')
  assert.throws(() => fromTimetable({ courses: [] }), /格式不对/)
  // 只排公布了日期的考试；考场没出的说明一下。
  assert.deepEqual(fromExams(EXAMS), [{ kind: 'exam', from: 'zdbk', date: '2026-10-21', time: '10:30', end: '12:30', title: '数据结构基础 期末考试', sub: '紫金港西1-101 · 座位 23' }])
})

test('the page first gets the cache, then the timetable and exams from zdbk', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  const empty = schedule.snapshot()
  assert.equal(empty.today, '2026-10-18')
  assert.equal(empty.current, null)
  assert.deepEqual(empty.custom, { terms: [], days: [] })
  assert.equal(empty.calendar.terms[0].start, '2026-09-14')
  assert.equal(empty.sources[0].state, 'ready')

  let snapshot = await schedule.refresh({ source: 'timetable' })
  snapshot = await schedule.refresh({ source: 'exams' })
  assert.deepEqual(world.calls, ['zdbk timetable', 'zdbk exams'])
  assert.equal(snapshot.current, '2026-2027|秋')
  assert.equal(snapshot.timetables['2026-2027|秋'].courses[0].name, '数据结构基础')
  assert.deepEqual(snapshot.events.map(event => event.title), ['数据结构基础 期末考试'])

  // 刚读过的不再读；force 照读；换一个进程读的是磁盘上的缓存。
  await schedule.refresh({ source: 'timetable' })
  assert.equal(world.calls.length, 2)
  await schedule.refresh({ source: 'timetable', force: true })
  assert.equal(world.calls.length, 3)
  assert.equal(world.create().snapshot().current, '2026-2027|秋')
})

test('another term is read by year and term, and kept under the key that was asked for', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  const snapshot = await schedule.refresh({ source: 'timetable', term: '2026-2027|冬' })
  assert.deepEqual(world.calls, ['zdbk timetable --year 2026-2027 --term 冬'])
  assert.equal(snapshot.timetables['2026-2027|冬'].courses[0].name, '操作系统')
  // 读这个学期不改「教务网默认是哪个学期」。
  assert.equal(snapshot.current, null)
  await assert.rejects(schedule.refresh({ source: 'timetable', term: '2026|冬' }), /学期要写成/)
})

test('a failed read keeps the last good one and says why; a term never read is listed as failed', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  await schedule.refresh({ source: 'timetable' })
  world.results['zdbk timetable'] = new Error('统一身份认证登录失败')
  world.results['zdbk timetable --year 2026-2027 --term 冬'] = new Error('该学年学期课表未开放')
  let snapshot = await schedule.refresh({ source: 'timetable', force: true })
  assert.equal(snapshot.current, '2026-2027|秋')
  assert.equal(snapshot.sources[0].error, '统一身份认证登录失败')
  assert.equal(snapshot.timetables['2026-2027|秋'].courses.length, 1)
  snapshot = await schedule.refresh({ source: 'timetable', term: '2026-2027|冬' })
  assert.equal(snapshot.timetables['2026-2027|冬'], undefined)
  assert.equal(snapshot.failed['2026-2027|冬'], '该学年学期课表未开放')
  // 刚失败过的隔一阵再试。
  await schedule.refresh({ source: 'timetable', term: '2026-2027|冬' })
  assert.equal(world.calls.filter(call => call.includes('冬')).length, 1)
})

test('nothing is read without an account or with the plugin off, and a changed account hides the old cache', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  await schedule.refresh({ source: 'timetable' })
  world.accounts = { zju_username: '3240100002', zju_password: 'x' }
  assert.equal(schedule.snapshot().current, null)
  assert.deepEqual(schedule.snapshot().timetables, {})
  world.disabled = ['zju-courses']
  const off = await schedule.refresh({ source: 'timetable' })
  assert.equal(off.sources[0].state, 'off')
  world.disabled = []
  world.accounts = {}
  const missing = await schedule.refresh({ source: 'exams' })
  assert.equal(missing.sources[0].state, 'account')
  assert.equal(missing.sources[0].plugin, 'zju-account')
  assert.deepEqual(world.calls, ['zdbk timetable'])
})

test('a graduate student is not sent to the undergraduate system; the classes come from the graduate system', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  // 学号 2 开头是硕士、1 开头是博士：本科教务网里没有他们的课表和考试。
  for (const zju_username of ['22451001', '12351002']) {
    world.accounts = { zju_username, zju_password: 'x' }
    const snapshot = await schedule.refresh({ source: 'timetable', force: true })
    assert.deepEqual(snapshot.sources.map(source => source.state), ['graduate', 'graduate'])
    assert.equal(snapshot.graduate.state, 'ready')
    await schedule.refresh({ source: 'exams', force: true })
  }
  assert.deepEqual(world.calls, [])
  world.results['yjsy timetable --year 2026-2027 --term 秋冬'] = graduate([ALGORITHMS])
  const { days, notes } = await schedule.days({ from: '2026-10-19', to: '2026-10-25' })
  assert.deepEqual(world.calls, ['yjsy timetable --year 2026-2027 --term 秋冬'])
  assert.deepEqual(days[0].items, [{ kind: '课', time: '13:25-15:50', title: '高级算法', where: '玉泉曹光彪301', from: '研究生教务网' }])
  // 说清考试读不到，不说「课表没读到」。
  assert.match(notes.join(' '), /研究生.*考试安排还读不到/)
  assert.doesNotMatch(notes.join(' '), /课表没读到/)
})

test('an undergraduate taking graduate classes gets both systems, without the same class twice', async (t) => {
  const world = setup(t)
  world.results['yjsy timetable --year 2026-2027 --term 秋冬'] = graduate([ALGORITHMS, SHARED])
  const schedule = world.create()
  const result = await schedule.days({ from: '2026-10-19', to: '2026-10-19' })
  assert.deepEqual(world.calls, ['zdbk timetable', 'zdbk exams', 'yjsy timetable --year 2026-2027 --term 秋冬'])
  assert.deepEqual(result.days[0].items.map(item => [item.title, item.time, item.from]), [['数据结构基础', '10:00-11:35', undefined], ['高级算法', '13:25-15:50', '研究生教务网']])
  // 选课没处理完的标在地点前面。
  assert.equal(fromGraduate(graduate([SHARED]))[0].sub, '选课待处理 · 东1A-101')
  assert.throws(() => fromGraduate({}), /格式不对/)

  // 研究生教务网读不到时用上一次的，告诉助手；刚读过的不再读。
  world.results['yjsy timetable --year 2026-2027 --term 秋冬'] = new Error('研究生教务网：系统维护')
  let snapshot = await schedule.refresh({ source: 'graduate', term: '2026-2027|秋冬', force: true })
  assert.match(snapshot.graduate.terms['2026-2027|秋冬'].error, /系统维护/)
  assert.ok(snapshot.events.some(event => event.title === '高级算法'))
  const calls = world.calls.length
  snapshot = await schedule.refresh({ source: 'graduate', term: '2026-2027|秋冬' })
  assert.equal(world.calls.length, calls)
  const { notes } = await schedule.days({ from: '2026-10-19', to: '2026-10-19' })
  assert.match(notes.join(' '), /研究生课表这次没从研究生教务网读到（研究生教务网：系统维护）/)
  await assert.rejects(schedule.refresh({ source: 'graduate', term: '2026-2027|秋' }), /2026-2027\|秋冬/)
})

test('own entries are added, changed and removed; weekly ones show on every week and the assistant gets their id', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  let snapshot = schedule.saveEvent({ title: '组会', date: '2026-10-19', time: '19:00', end: '20:30', place: '曹光彪 301', until: '2026-11-02' })
  const [item] = snapshot.own
  assert.match(item.id, /^[\w-]+$/)
  assert.deepEqual(snapshot.events.filter(event => event.from === 'mine').map(event => event.date), ['2026-10-19', '2026-10-26', '2026-11-02'])
  // 改的时候整条换掉，id 不变；页面传来的空字段不存。
  snapshot = schedule.saveEvent({ id: item.id, title: '组会', date: '2026-10-20', time: '', end: '', place: '', kind: 'event', until: '' })
  assert.deepEqual(snapshot.own, [{ id: item.id, title: '组会', date: '2026-10-20', kind: 'event' }])
  const days = await schedule.days({ from: '2026-10-20', to: '2026-10-20' })
  assert.deepEqual(days.days[0].items, [{ kind: '日程', title: '组会', from: '用户自己加的', id: item.id }])
  // 助手一次写几条；不认识的 id 报错，什么也不写。
  assert.throws(() => schedule.changeOwn([{ title: '新的', date: '2026-10-21' }, { id: 'nope', remove: true }]), /没有 id 为 nope/)
  assert.equal(schedule.own().items.length, 1)
  schedule.changeOwn([{ title: '研讨课', date: '2026-10-21', time: '13:25', end: '15:50', kind: 'class' }])
  assert.equal(schedule.own().items.length, 2)
  snapshot = schedule.removeEvent({ id: item.id })
  assert.deepEqual(snapshot.own.map(own => own.title), ['研讨课'])
  assert.throws(() => schedule.saveEvent({ title: '', date: '2026-10-21' }), /要写上是什么事/)
  // 文件坏了不当作空的，也不让再存。
  fs.writeFileSync(schedule.eventsFile, '{"events": 1}')
  assert.match(world.create().snapshot().ownProblem, /自己加的日程读不了/)
  assert.throws(() => world.create().saveEvent({ title: '组会', date: '2026-10-21' }), /自己加的日程读不了/)
})

test('homework deadlines and memo times join the events in Beijing time', (t) => {
  const world = setup(t)
  world.tasks = [{ id: 'xuezai:作业|数据结构基础|实验三', source: 'xuezai', title: '实验三', course: '数据结构基础', kind: '作业', deadline: '2026-10-19T15:59:00.000Z' }, { id: 'pta:x', source: 'pta', title: '没有截止', course: '', kind: '作业', deadline: null }, { id: 'xuezai:作业|数据结构基础|实验二', source: 'xuezai', title: '实验二', course: '数据结构基础', kind: '作业', deadline: '2026-10-12T15:59:00.000Z', done: true }]
  world.memos = [{ title: '体测', updatedAt: '2026-10-08T00:00:00Z', properties: [{ key: '时间', value: '2026-10-24 08:30' }] }]
  const { events } = world.create().snapshot()
  assert.deepEqual(events, [
    { kind: 'due', from: 'xuezai', ref: 'xuezai:作业|数据结构基础|实验三', date: '2026-10-19', time: '23:59', title: '实验三', sub: '数据结构基础' },
    { kind: 'due', from: 'xuezai', ref: 'xuezai:作业|数据结构基础|实验二', date: '2026-10-12', time: '23:59', title: '实验二', sub: '数据结构基础', done: true },
    { kind: 'event', from: 'memo', ref: '体测', date: '2026-10-24', time: '08:30', title: '体测', sub: '' },
  ])
})

test('the page saves the whole calendar; the assistant changes only the entries it names', (t) => {
  const world = setup(t)
  const schedule = world.create()
  const saved = schedule.saveCalendar({ terms: [{ year: '2026-2027', term: '秋', start: '2026-09-14', weeks: 8 }], days: [{ date: '2026-10-01', until: '2026-10-07', off: true, note: '国庆节' }] })
  assert.deepEqual(saved.custom.terms, [{ year: '2026-2027', term: '秋', start: '2026-09-14', weeks: 8 }])
  assert.throws(() => schedule.saveCalendar({ terms: [{ year: '2026-2027', term: '秋', start: '2026-09-15' }] }), /周一/)
  // 存坏了的没有写进去。
  assert.equal(schedule.custom().terms[0].start, '2026-09-14')

  const next = schedule.updateCalendar({ terms: [{ year: '2026-2027', term: '冬', start: '2026-11-09' }], days: [{ date: '2026-10-10', as: '2026-10-01', note: '国庆调休' }] })
  assert.deepEqual(next.terms.map(term => term.term), ['秋', '冬'])
  assert.deepEqual(next.days.map(day => day.date), ['2026-10-01', '2026-10-10'])
  const cleared = schedule.updateCalendar({ days: [{ date: '2026-10-10', clear: true }], terms: [{ year: '2026-2027', term: '秋', start: '2026-09-07' }] })
  assert.deepEqual(cleared.days.map(day => day.date), ['2026-10-01'])
  assert.equal(cleared.terms[0].start, '2026-09-07')
})

test('a broken calendar file is reported, not silently emptied', (t) => {
  const world = setup(t)
  fs.mkdirSync(path.dirname(world.calendarFile), { recursive: true })
  fs.writeFileSync(world.calendarFile, '{"terms": [{"year": "2026-2027", "term": "秋", "start": "2026-09-15"}]}')
  const schedule = world.create()
  assert.deepEqual(schedule.custom().terms, [])
  assert.match(schedule.custom().problem, /校历文件读不了.*周一/)
  // 学校的校历照样排，问题带到页面上。
  assert.match(schedule.calendar().problem, /校历文件读不了/)
  assert.ok(schedule.calendar().terms.length >= 4)
})

test('the assistant reads laid-out days, and the schedule fetches what it needs first', async (t) => {
  const world = setup(t)
  const schedule = world.create()
  schedule.saveCalendar({ terms: [{ year: '2026-2027', term: '秋', start: '2026-09-14' }, { year: '2026-2027', term: '冬', start: '2026-11-09' }], days: [{ date: '2026-10-21', off: true, note: '运动会' }] })
  const result = await schedule.days({ from: '2026-10-19', to: '2026-10-21' })
  assert.deepEqual(world.calls, ['zdbk timetable', 'zdbk exams', 'yjsy timetable --year 2026-2027 --term 秋冬'])
  assert.equal(result.today, '2026-10-18')
  assert.deepEqual(result.days, [
    { date: '2026-10-19', weekday: '周一', week: '2026-2027 秋学期第 6 周', items: [{ kind: '课', time: '10:00-11:35', title: '数据结构基础', where: '东1A-101' }] },
    { date: '2026-10-20', weekday: '周二', week: '2026-2027 秋学期第 6 周', items: [] },
    { date: '2026-10-21', weekday: '周三', week: '2026-2027 秋学期第 6 周', off: '运动会，停课', items: [{ kind: '考试', time: '10:30-12:30', title: '数据结构基础 期末考试', where: '紫金港西1-101 · 座位 23' }] },
  ])
  assert.equal(result.notes, undefined)

  // 排到冬学期时先去读冬学期的课表。
  const winter = await schedule.days({ from: '2026-11-10', to: '2026-11-10' })
  assert.equal(world.calls.at(-1), 'zdbk timetable --year 2026-2027 --term 冬')
  assert.deepEqual(winter.days[0].items.map(item => item.title), ['操作系统'])

  await assert.rejects(schedule.days({ from: '2026-10-01', to: '2026-12-01' }), /最多查 42 天/)
  await assert.rejects(schedule.days({ from: '10-01' }), /日期要写成/)
})

test('without the term in the calendar the assistant is told the classes are not checked against weeks', async (t) => {
  const world = setup(t)
  // 应用带着的校历只到 2026—2027 学年，再下一年的还没有。
  world.results['zdbk timetable'] = timetable('秋', AUTUMN.courses, '2027-2028')
  const result = await world.create().days({ from: '2027-09-22', to: '2027-09-22' })
  assert.deepEqual(result.days[0].items.map(item => item.title), ['数据结构基础'])
  assert.match(result.notes.join(' '), /校历里还没有 2027-2028 秋学期.*campus_calendar_write/)
  assert.match(result.notes.join(' '), /2027 年的放假安排国务院还没公布/)
})

test('the school calendar and national holidays are there without anything filled in, and what the user fills in comes first', (t) => {
  const world = setup(t)
  const schedule = world.create()
  const calendar = schedule.calendar()
  assert.deepEqual(calendar.terms.map(term => `${term.term} ${term.start}`), ['秋 2026-09-14', '冬 2026-11-09', '春 2027-02-22', '夏 2027-04-19'])
  const first = date => calendar.days.find(day => day.date === date)
  assert.deepEqual(first('2026-10-10'), { date: '2026-10-10', as: '2026-10-07', note: '国庆节调休', source: 'national' })
  assert.deepEqual(first('2026-10-17'), { date: '2026-10-17', as: '2026-10-02', note: '国庆节补课', source: 'school' })
  schedule.saveCalendar({ days: [{ date: '2026-10-10', off: true, note: '校运动会' }] })
  assert.deepEqual(schedule.calendar().days.find(day => day.date === '2026-10-10'), { date: '2026-10-10', off: true, note: '校运动会', source: 'custom' })
  assert.deepEqual(schedule.snapshot().unpublished, [2027])
})

test('the prompt line gives this week of term and the holidays and make-up days of the coming month', (t) => {
  const world = setup(t)
  const schedule = world.create()
  // 学校的校历带在应用里，不填也知道今天是第几周；这一个月里没有放假和调休。
  assert.match(schedule.promptText(), /今天 2026-10-18（周日）是 2026-2027 秋学期第 5 周/)
  assert.doesNotMatch(schedule.promptText(), /接下来一个月/)
  schedule.saveCalendar({ days: [{ date: '2026-10-01', until: '2026-10-07', off: true }, { date: '2026-10-31', as: '2026-10-30', note: '运动会补课' }, { date: '2026-11-02', until: '2026-11-03', off: true, note: '校庆' }, { date: '2026-12-31', off: true }] })
  const text = schedule.promptText()
  assert.match(text, /2026-10-31 运动会补课，上 2026-10-30（周五）的课/)
  assert.match(text, /2026-11-02 到 2026-11-03 校庆停课/)
  assert.doesNotMatch(text, /2026-10-01|2026-12-31/)
})

test('opening the schedule asks the affairs page to re-read homework, and a failure there does not break the schedule', async (t) => {
  const world = setup(t)
  const asked = []
  const schedule = new Schedule({
    file: world.file, calendarFile: world.calendarFile, account: { read: () => ({ data: world.accounts }) }, plugins: { disabled: () => [] },
    holidays: new Holidays({ file: path.join(path.dirname(world.file), 'holidays.json'), now: () => world.now, fetch: async () => { throw new Error('offline') } }),
    now: () => world.now, run: async () => { throw new Error('不该读教务网') },
    refreshTasks: async (options) => { asked.push(options); if (asked.length > 1) throw new Error('学在浙大打不开') },
  })
  await schedule.refresh({ source: 'tasks' })
  await schedule.refresh({ source: 'tasks', force: true })
  assert.deepEqual(asked, [{ force: false }, { force: true }])
})
