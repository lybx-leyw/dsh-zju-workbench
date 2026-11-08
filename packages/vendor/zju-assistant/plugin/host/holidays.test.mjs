import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Holidays, ZJU_CALENDARS, fromHolidayCn, nationalDays } from './holidays.mjs'
import { layerCalendars, normalizeCalendar, planDay } from '../calendar.mjs'

function setup(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-holidays-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = { now: Date.parse('2026-10-18T02:00:00Z'), urls: [], file: path.join(root, 'cache', 'holidays.json') }
  world.create = () => new Holidays({
    file: world.file, now: () => world.now,
    fetch: async (url) => { world.urls.push(url); return respond(url) },
  })
  return world
}
const json = (status, body) => ({ ok: status === 200, status, json: async () => body })
const pairs = days => days.filter(day => day.as).map(day => `${day.date}<-${day.as}`)

test('make-up workdays take the last holiday weekdays in order, the way ZJU announced it in 2025 and 2026', (t) => {
  const holidays = setup(t, () => json(404, null)).create()
  // 本科生院 2025：10 月 7 日、8 日的课与 9 月 28 日、10 月 11 日对调；1—3 日和 6 日停课。
  const autumn2025 = nationalDays(holidays.year(2025)).filter(day => day.date >= '2025-09-01')
  assert.deepEqual(pairs(autumn2025), ['2025-09-28<-2025-10-07', '2025-10-11<-2025-10-08'])
  assert.deepEqual(autumn2025.filter(day => day.off && !day.moved && day.date.startsWith('2025-10')).map(day => day.date),
    ['2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06'])
  // 本科生院 2026：10 月 6 日、7 日的课分别与 9 月 20 日、10 月 10 日对调；10 月 1—3 日、5 日停课；中秋 9 月 25 日停课。
  const autumn2026 = nationalDays(holidays.year(2026)).filter(day => day.date >= '2026-09-01')
  assert.deepEqual(pairs(autumn2026), ['2026-09-20<-2026-10-06', '2026-10-10<-2026-10-07'])
  assert.deepEqual(autumn2026.find(day => day.date === '2026-10-06'), { date: '2026-10-06', off: true, note: '国庆节', source: 'national', moved: '2026-09-20' })
  assert.deepEqual(autumn2026.find(day => day.date === '2026-09-25'), { date: '2026-09-25', off: true, note: '中秋节', source: 'national' })
  assert.deepEqual(autumn2026.find(day => day.date === '2026-10-10'), { date: '2026-10-10', as: '2026-10-07', note: '国庆节调休', source: 'national' })
})

test('the school calendar shipped with the app is valid and lays out the 2026 autumn the way the notice says', () => {
  for (const year of ZJU_CALENDARS) normalizeCalendar({ terms: year.terms, days: year.days })
  const calendar = layerCalendars(
    { terms: ZJU_CALENDARS[0].terms, days: ZJU_CALENDARS[0].days.map(day => ({ ...day, source: 'school' })) },
    { terms: [], days: nationalDays([
      ['2026-09-20', 0, '国庆节'], ['2026-10-01', 1, '国庆节'], ['2026-10-02', 1, '国庆节'], ['2026-10-03', 1, '国庆节'], ['2026-10-04', 1, '国庆节'],
      ['2026-10-05', 1, '国庆节'], ['2026-10-06', 1, '国庆节'], ['2026-10-07', 1, '国庆节'], ['2026-10-10', 0, '国庆节'],
    ]) },
  )
  const meeting = weekday => ({ weekday, periods: [3, 4], startTime: '10:00', endTime: '11:35', location: '东1A-101', weeks: '第1-8周', weekPattern: '每周' })
  const table = { year: '2026-2027', term: '秋', periodTimes: [], courses: [{ name: '周二的课', teacher: '', term: '秋', meetings: [meeting(2)] }, { name: '周五的课', teacher: '', term: '秋', meetings: [meeting(5)] }, { name: '周日的课', teacher: '', term: '秋', meetings: [meeting(7)] }] }
  const data = { calendar, timetables: { '2026-2027|秋': table }, current: '2026-2027|秋', events: [] }
  const titles = date => planDay(data, date).items.map(item => item.title)
  assert.deepEqual(planDay(data, '2026-09-14').term, { year: '2026-2027', term: '秋', week: 1 })
  // 9 月 20 日（周日）上 10 月 6 日（周二）的课，周日本来的课照上。
  assert.deepEqual(titles('2026-09-20'), ['周二的课', '周日的课'])
  assert.deepEqual(planDay(data, '2026-10-06').off, { note: '国庆节', moved: '2026-09-20', source: 'national' })
  assert.deepEqual(titles('2026-10-06'), [])
  // 10 月 17 日（周六）补 10 月 2 日（周五）的课，是学校自己的安排。
  assert.deepEqual(planDay(data, '2026-10-17').swap, { as: '2026-10-02', weekday: 5, note: '国庆节补课', source: 'school' })
  assert.deepEqual(titles('2026-10-17'), ['周五的课'])
  assert.deepEqual(planDay(data, '2026-11-09').term, { year: '2026-2027', term: '冬', week: 1 })
  assert.equal(planDay(data, '2026-12-31').off.note, '学生节')
  assert.deepEqual(planDay(data, '2027-01-04').term, { year: '2026-2027', term: '冬', week: 8 })
})

test('holiday-cn files are checked before they are used', () => {
  assert.deepEqual(fromHolidayCn({ year: 2027, days: [{ name: '元旦', date: '2027-01-01', isOffDay: true }] }, 2027), [['2027-01-01', 1, '元旦']])
  assert.throws(() => fromHolidayCn({ year: 2026, days: [] }, 2027), /格式不对/)
  assert.throws(() => fromHolidayCn({ year: 2027, days: [{ name: '元旦', date: '1/1', isOffDay: true }] }, 2027), /格式不对/)
})

test('a year not shipped with the app is fetched once, kept, and an unpublished year is tried again a day later', async (t) => {
  const world = setup(t, url => url.endsWith('/2027.json') ? json(200, { year: 2027, papers: [], days: [] }) : json(200, { year: 2028, days: [{ name: '元旦', date: '2028-01-01', isOffDay: true }] }))
  const holidays = world.create()
  assert.deepEqual(holidays.missing([2026, 2027, 2028]), [2027, 2028])
  await holidays.refresh([2026, 2027, 2028])
  assert.deepEqual(world.urls, ['https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2027.json', 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2028.json'])
  assert.deepEqual(holidays.missing([2026, 2027, 2028]), [2027])
  assert.deepEqual(world.create().year(2028), [['2028-01-01', 1, '元旦']])
  // 2027 年还没公布：今天不再去取，过一天再取。
  await world.create().refresh([2027])
  assert.equal(world.urls.length, 2)
  world.now += 25 * 3_600_000
  await world.create().refresh([2027])
  assert.equal(world.urls.length, 3)
})

test('a network failure leaves the schedule without that year instead of failing', async (t) => {
  const world = setup(t, () => { throw new Error('offline') })
  const holidays = world.create()
  await holidays.refresh([2027])
  assert.equal(holidays.year(2027), null)
  assert.deepEqual(holidays.days([2027]), [])
})
