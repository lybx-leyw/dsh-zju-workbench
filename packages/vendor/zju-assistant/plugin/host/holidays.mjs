/**
 * 放假和调休：国家每年的放假安排（国务院办公厅的通知），加上浙大自己的校历（各学期哪天开始上课、学校单独的停课和补课）。
 * 这两样每年都是定好的，日程表照它们自己排，不用用户一条条填；用户自己填的（calendar.json）排在最前，能盖过这里的。
 *
 * 国家的放假安排用 holiday-cn 的格式（github.com/NateScarlet/holiday-cn，照国务院的通知整理）：一天一条，哪天、放不放假、哪个节。
 * 2025、2026 年的带在应用里；别的年份去它的镜像取，取到的存在缓存里。国务院一般在头一年 11 月公布下一年的安排，
 * 没公布时那一年的文件是空的，隔一天再去看。
 *
 * 一个节里的课怎么上，照浙大本科生院每年的节假日教学安排：
 *   法定节假日和它的补休停课，不补；
 *   补班的那几天（周末上班）上这个节里最后几个放假的工作日的课，按日期先后一一对上。
 *   2025 年国庆：9 月 28 日上 10 月 7 日的课，10 月 11 日上 10 月 8 日的课；
 *   2026 年国庆：9 月 20 日上 10 月 6 日的课，10 月 10 日上 10 月 7 日的课。两年的通知都是这样对的。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDate, weekdayOf } from '../calendar.mjs'

/** 国家的放假安排：[日期, 1 放假 / 0 补班, 哪个节]。 */
const NATIONAL = {
  2025: [
    ['2025-01-01', 1, '元旦'], ['2025-01-26', 0, '春节'], ['2025-01-28', 1, '春节'], ['2025-01-29', 1, '春节'], ['2025-01-30', 1, '春节'], ['2025-01-31', 1, '春节'],
    ['2025-02-01', 1, '春节'], ['2025-02-02', 1, '春节'], ['2025-02-03', 1, '春节'], ['2025-02-04', 1, '春节'], ['2025-02-08', 0, '春节'],
    ['2025-04-04', 1, '清明节'], ['2025-04-05', 1, '清明节'], ['2025-04-06', 1, '清明节'],
    ['2025-04-27', 0, '劳动节'], ['2025-05-01', 1, '劳动节'], ['2025-05-02', 1, '劳动节'], ['2025-05-03', 1, '劳动节'], ['2025-05-04', 1, '劳动节'], ['2025-05-05', 1, '劳动节'],
    ['2025-05-31', 1, '端午节'], ['2025-06-01', 1, '端午节'], ['2025-06-02', 1, '端午节'],
    ['2025-09-28', 0, '国庆节、中秋节'], ['2025-10-01', 1, '国庆节、中秋节'], ['2025-10-02', 1, '国庆节、中秋节'], ['2025-10-03', 1, '国庆节、中秋节'], ['2025-10-04', 1, '国庆节、中秋节'],
    ['2025-10-05', 1, '国庆节、中秋节'], ['2025-10-06', 1, '国庆节、中秋节'], ['2025-10-07', 1, '国庆节、中秋节'], ['2025-10-08', 1, '国庆节、中秋节'], ['2025-10-11', 0, '国庆节、中秋节'],
  ],
  2026: [
    ['2026-01-01', 1, '元旦'], ['2026-01-02', 1, '元旦'], ['2026-01-03', 1, '元旦'], ['2026-01-04', 0, '元旦'],
    ['2026-02-14', 0, '春节'], ['2026-02-15', 1, '春节'], ['2026-02-16', 1, '春节'], ['2026-02-17', 1, '春节'], ['2026-02-18', 1, '春节'], ['2026-02-19', 1, '春节'],
    ['2026-02-20', 1, '春节'], ['2026-02-21', 1, '春节'], ['2026-02-22', 1, '春节'], ['2026-02-23', 1, '春节'], ['2026-02-28', 0, '春节'],
    ['2026-04-04', 1, '清明节'], ['2026-04-05', 1, '清明节'], ['2026-04-06', 1, '清明节'],
    ['2026-05-01', 1, '劳动节'], ['2026-05-02', 1, '劳动节'], ['2026-05-03', 1, '劳动节'], ['2026-05-04', 1, '劳动节'], ['2026-05-05', 1, '劳动节'], ['2026-05-09', 0, '劳动节'],
    ['2026-06-19', 1, '端午节'], ['2026-06-20', 1, '端午节'], ['2026-06-21', 1, '端午节'],
    ['2026-09-20', 0, '国庆节'], ['2026-09-25', 1, '中秋节'], ['2026-09-26', 1, '中秋节'], ['2026-09-27', 1, '中秋节'],
    ['2026-10-01', 1, '国庆节'], ['2026-10-02', 1, '国庆节'], ['2026-10-03', 1, '国庆节'], ['2026-10-04', 1, '国庆节'], ['2026-10-05', 1, '国庆节'],
    ['2026-10-06', 1, '国庆节'], ['2026-10-07', 1, '国庆节'], ['2026-10-10', 0, '国庆节'],
  ],
}

/**
 * 浙大的校历：本科生院每年 7 月前后公布下一学年的。学期开始上课的日期，和国家安排以外学校单独的停课、补课。
 * 2026—2027 学年：https://ugrs.zju.edu.cn/2026/0710/c28218a3187939/page.htm（校历 PDF），
 * 停课补课另见本科生院 2026-09-07《关于 2026 年下半年部分节假日及学校活动期间教学安排的温馨提醒》。
 */
export const ZJU_CALENDARS = [
  {
    year: '2026-2027',
    terms: [
      { year: '2026-2027', term: '秋', start: '2026-09-14', weeks: 8 },
      { year: '2026-2027', term: '冬', start: '2026-11-09', weeks: 8 },
      { year: '2026-2027', term: '春', start: '2027-02-22', weeks: 8 },
      { year: '2026-2027', term: '夏', start: '2027-04-19', weeks: 8 },
    ],
    days: [
      { date: '2026-10-17', as: '2026-10-02', note: '国庆节补课' },
      { date: '2026-12-31', off: true, note: '学生节' },
      { date: '2027-01-04', as: '2026-12-31', note: '学生节补课' },
    ],
  },
]

/**
 * 一年的国家放假安排变成日程上的日子：放假的（note 是哪个节；课挪到补班那天上的带着 moved），
 * 和补班的那天上哪天的课（as）。source 都是 national。
 */
export function nationalDays(entries) {
  const groups = new Map()
  for (const [date, off, name] of entries) {
    if (!isDate(date) || typeof name !== 'string') continue
    const group = groups.get(name) ?? { off: [], work: [] }
    group[off ? 'off' : 'work'].push(date)
    groups.set(name, group)
  }
  const days = []
  for (const [name, group] of groups) {
    const off = group.off.sort(), work = group.work.sort()
    const weekdays = off.filter(date => weekdayOf(date) <= 5)
    const swapped = weekdays.slice(Math.max(0, weekdays.length - work.length))
    for (const date of off) {
      const index = swapped.indexOf(date)
      days.push({ date, off: true, note: name, source: 'national', ...(index >= 0 && work[index] ? { moved: work[index] } : {}) })
    }
    work.forEach((date, index) => { if (swapped[index]) days.push({ date, as: swapped[index], note: `${name}调休`, source: 'national' }) })
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

/** holiday-cn 一年的文件（{ year, days: [{ name, date, isOffDay }] }）变成 NATIONAL 那样的一条条；格式不对时抛出。 */
export function fromHolidayCn(data, year) {
  if (data?.year !== year || !Array.isArray(data?.days)) throw new Error('放假安排的格式不对')
  return data.days.map((day) => {
    if (!isDate(day?.date) || typeof day?.name !== 'string' || typeof day?.isOffDay !== 'boolean') throw new Error('放假安排的格式不对')
    return [day.date, day.isOffDay ? 1 : 0, day.name]
  })
}

const MIRROR = year => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`
/** 一年没取到（还没公布、网络不通）以后，隔这么久再去取。 */
const RETRY_MS = 24 * 3_600_000

/** 应用没带着的年份去镜像取，取到的存在 file 里。 */
export class Holidays {
  constructor({ file, fetch = globalThis.fetch, now = () => Date.now() }) {
    this.file = file
    this.fetch = fetch
    this.now = now
    this.cache = undefined
    this.running = new Map()
  }

  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存 */ }
    this.cache = { years: saved?.years && typeof saved.years === 'object' ? saved.years : {}, tried: saved?.tried && typeof saved.tried === 'object' ? saved.tried : {} }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    try { fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n'); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  /** 这一年的放假安排，没有（还没公布或者还没取到）时是 null。 */
  year(year) {
    return NATIONAL[year] ?? this.load().years[year] ?? null
  }

  /** 这几年的放假和调休，排成日程上的日子。 */
  days(years) {
    return years.flatMap(year => nationalDays(this.year(year) ?? []))
  }

  /** 这几年里还没有的。 */
  missing(years) {
    return years.filter(year => !this.year(year))
  }

  /** 把还没有的那几年去取一次；刚取过没取到的隔一天再取。取不到不报错，日程照常排，只是那一年没有放假。 */
  async refresh(years) {
    await Promise.all(this.missing(years).map((year) => {
      const tried = this.load().tried[year]
      if (tried && this.now() - Date.parse(tried) < RETRY_MS) return undefined
      let run = this.running.get(year)
      if (!run) {
        run = this.get(year).finally(() => { this.running.delete(year) })
        this.running.set(year, run)
      }
      return run
    }))
  }

  async get(year) {
    let days = []
    try {
      const response = await this.fetch(MIRROR(year), { signal: AbortSignal.timeout(15_000) })
      if (response.ok) days = fromHolidayCn(await response.json(), year)
    } catch { /* 没取到，隔一天再试 */ }
    const cache = this.load()
    this.write({
      years: days.length ? { ...cache.years, [year]: days } : cache.years,
      tried: { ...cache.tried, [year]: new Date(this.now()).toISOString() },
    })
  }
}
