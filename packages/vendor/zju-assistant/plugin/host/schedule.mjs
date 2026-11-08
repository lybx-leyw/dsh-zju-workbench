/**
 * 日程表的后台：教务网的课表和考试、研究生教务网的课表（缓存），档案目录里的校历和自己加的日程，
 * 加上校园事务页已经读到的作业截止和备忘录里写了时间的事，交给日程表页和助手。每一天怎么排在 calendar.mjs。
 * 课表和考试照校园事务页作业的办法（affairs.mjs）：先给缓存，再去教务网读；没读到时上一次的原样留着，只记下原因。
 * 教务网默认给的是现在这个小学期的课表；校历排到别的学期（比如冬学期）时，页面再按学年学期要那一个学期的。
 * 本科教务网里没有研究生课：研究生和选了研究生课的本科生，研究生课从研究生教务网（yjsy）读（2026-11-02 同学反馈），
 * 和本科课表里同一时间的那节只留本科课表的（calendar.mjs 的 planDay）。研究生教务网按大学期（秋冬、春夏）读，页面看到哪个读哪个。
 * 校历分三层（holidays.mjs）：浙大的校历和国家的放假安排是定好的，应用自己带着、或者自己去取；
 * 用户自己填的（或者助手照学校的通知填的）存在档案目录的 calendar.json，排在最前，能盖过前两样。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ACCOUNTS, accountReady } from '../accounts.mjs'
import { runCore } from './core.mjs'
import { accountPlugin, fingerprint } from './affairs.mjs'
import { fromStudentId } from './identity-fill.mjs'
import { Holidays, ZJU_CALENDARS } from './holidays.mjs'
import {
  TERM_NAMES, WEEKDAY_NAMES, addDays, beijing, dayNumber, isDate, layerCalendars, memoEvents, normalizeCalendar, normalizeEvent, ownEvents,
  planDays, semesterKey, termAt, termKey, weekdayOf,
} from '../calendar.mjs'

/** 读成功以后，这么久之内再进页面不重新读（教务网的课表 core 自己还缓存 6 小时）；页面上点刷新不受限制。 */
const FRESH_MS = 10 * 60_000
/** 读失败以后隔得久一些再自动重试，免得密码错了时一进页面就登录一次。 */
const RETRY_MS = 5 * 60_000
/** 助手一次最多查这么多天。 */
const SPAN_MAX = 42

/** 课表和考试都在教务网上，用的是浙大统一身份认证的账号，归「课程与学习」管；智云也是。 */
const ZDBK = { name: '教务网', plugin: 'zju-courses', account: 'zju' }
const YJSY = { name: '研究生教务网', plugin: 'zju-courses', account: 'zju' }
const PARTS = { timetable: { ...ZDBK, label: '课表' }, exams: { ...ZDBK, label: '考试安排' }, graduate: { ...YJSY, label: '研究生课表' }, holidays: { label: '放假安排' }, tasks: { label: '作业' } }
const EMPTY = { terms: [], days: [] }
/** 自己加的日程最多存这么多条（每周重复的算一条）。 */
const OWN_MAX = 500

const text = value => typeof value === 'string' ? value.trim() : ''
const message = error => error instanceof Error ? error.message : String(error)

/** `zdbk timetable` 的结果：这个小学期每门课的上课安排，只留排日程用得到的。 */
export function fromTimetable(data) {
  if (!Array.isArray(data?.courses) || !Array.isArray(data?.periodTimes)) throw new Error('教务网给的课表格式不对。')
  const year = text(data.term?.year), term = text(data.term?.term).split('|').pop()
  if (!/^\d{4}-\d{4}$/.test(year) || !TERM_NAMES.includes(term)) throw new Error('教务网给的课表没有说是哪个学期。')
  return {
    year, term, periodTimes: data.periodTimes,
    courses: data.courses.map(course => ({
      name: text(course.name), teacher: text(course.teacher), term: text(course.term),
      meetings: (Array.isArray(course.meetings) ? course.meetings : []).map(meeting => ({
        weekday: meeting.weekday, periods: meeting.periods, startTime: meeting.startTime, endTime: meeting.endTime,
        location: text(meeting.location), weeks: text(meeting.weeks), weekPattern: text(meeting.weekPattern),
      })),
    })),
  }
}

/** `yjsy timetable` 的结果：一个大学期里每次研究生课，按日期变成日程上的课；选课还没处理完的标上。 */
export function fromGraduate(data) {
  if (!Array.isArray(data?.courses)) throw new Error('研究生教务网给的课表格式不对。')
  const lessons = []
  for (const course of data.courses) {
    for (const meeting of Array.isArray(course?.meetings) ? course.meetings : []) {
      if (!/^\d{2}:\d{2}$/.test(meeting?.startTime) || !/^\d{2}:\d{2}$/.test(meeting?.endTime)) continue
      const sub = [course.pending ? '选课待处理' : '', text(meeting.location)].filter(Boolean).join(' · ')
      for (const date of Array.isArray(meeting.dates) ? meeting.dates.filter(isDate) : []) {
        lessons.push({ kind: 'class', from: 'yjsy', date, time: meeting.startTime, end: meeting.endTime, title: text(course.name), sub, teacher: text(course.teacher),
          periods: Array.isArray(meeting.periods) ? meeting.periods : [], weeks: text(meeting.weeks) })
      }
    }
  }
  return lessons
}

/** `zdbk exams` 的结果：公布了日期的期中、期末考试，一场一条。 */
export function fromExams(data) {
  if (!Array.isArray(data?.courses)) throw new Error('教务网给的考试安排格式不对。')
  const items = []
  for (const course of data.courses) {
    for (const [field, label] of [['midterm', '期中考试'], ['final', '期末考试']]) {
      const exam = course?.[field]
      if (exam?.status !== '已公布' || !isDate(exam.date)) continue
      items.push({
        kind: 'exam', from: 'zdbk', date: exam.date, ...(exam.startTime ? { time: exam.startTime } : {}), ...(exam.endTime ? { end: exam.endTime } : {}),
        title: `${text(course.name)} ${label}`, sub: [text(exam.location), text(exam.seat) && `座位 ${text(exam.seat)}`].filter(Boolean).join(' · ') || '考场还没出',
      })
    }
  }
  return items
}

export class Schedule {
  /**
   * file 是缓存文件；calendarFile 是档案目录里的校历，eventsFile 是自己加的日程（默认在校历旁边的 events.json）；
   * account、plugins 是账号和插件开关；
   * tasks() 给出校园事务页缓存里的作业，交过的带 done（affairs.tasks），refreshTasks() 让它去各系统重读一次；
   * memos() 给出备忘录（store.memos.list 的 notes）；
   * run 跑一条 ZJU Core 命令并返回结果里的 data；holidays 是国家的放假安排（默认缓存在 file 旁边的 holidays.json）。
   */
  constructor({ file, calendarFile, eventsFile, account, plugins, tasks = () => [], refreshTasks = async () => {}, memos = () => [], run = runCore, now = () => Date.now(), holidays }) {
    this.refreshTasks = refreshTasks
    this.holidays = holidays ?? new Holidays({ file: path.join(path.dirname(file), 'holidays.json'), now })
    this.file = file
    this.calendarFile = calendarFile
    this.eventsFile = eventsFile ?? path.join(path.dirname(calendarFile), 'events.json')
    this.account = account
    this.plugins = plugins
    this.tasks = tasks
    this.memos = memos
    this.run = run
    this.now = now
    this.running = new Map()
    this.cache = undefined
  }

  // ── 校历 ──────────────────────────────────────────────

  /** 用户自己填的校历。文件坏了的不当作空的悄悄覆盖：problem 里说明，页面上照样能改好再存。 */
  custom() {
    let raw
    try { raw = fs.readFileSync(this.calendarFile, 'utf8') } catch { return { ...EMPTY } }
    try { return normalizeCalendar(JSON.parse(raw)) } catch (error) { return { ...EMPTY, problem: `校历文件读不了（${message(error)}），重新填一遍再保存。` } }
  }

  /** 要排放假的年份：去年、今年、明年（一学年跨两年，往前往后各看一年）。 */
  years() {
    const year = +beijing(this.now()).date.slice(0, 4)
    return [year - 1, year, year + 1]
  }

  /** 应用自己知道的：浙大的校历，和这几年国家的放假安排。 */
  builtin() {
    const school = { terms: ZJU_CALENDARS.flatMap(item => item.terms), days: ZJU_CALENDARS.flatMap(item => item.days.map(day => ({ ...day, source: 'school' }))) }
    return layerCalendars(school, { terms: [], days: this.holidays.days(this.years()) })
  }

  /** 排日程用的校历：用户填的在最前，然后是学校的校历，最后是国家的放假安排。 */
  calendar() {
    const custom = this.custom()
    const merged = layerCalendars({ terms: custom.terms, days: custom.days.map(day => ({ ...day, source: 'custom' })) }, this.builtin())
    return custom.problem ? { ...merged, problem: custom.problem } : merged
  }

  writeCalendar(calendar) {
    const value = normalizeCalendar(calendar)
    writeFile(this.calendarFile, JSON.stringify(value, null, 2) + '\n')
    return value
  }

  /** 页面上保存整份校历。 */
  saveCalendar(input) {
    this.writeCalendar({ terms: input?.terms, days: input?.days })
    return this.snapshot()
  }

  /**
   * 助手写校历：给到的学期按学年和学期名、给到的日子按日期换掉原来那一条，没给到的不动；
   * 带 clear 的是删掉那一条。只改用户填的那一层，学校的校历和国家的放假安排不动。返回写完的这一层。
   */
  updateCalendar({ terms = [], days = [] } = {}) {
    if (!Array.isArray(terms) || !Array.isArray(days)) throw new Error('terms 和 days 要写成列表')
    const current = this.custom()
    const next = { terms: [...current.terms], days: [...current.days] }
    for (const item of terms) {
      next.terms = next.terms.filter(term => !(term.year === text(item?.year) && term.term === text(item?.term)))
      if (!item?.clear) next.terms.push(item)
    }
    for (const item of days) {
      next.days = next.days.filter(day => day.date !== text(item?.date))
      if (!item?.clear) next.days.push(item)
    }
    return this.writeCalendar(next)
  }

  // ── 自己加的日程 ──────────────────────────────────────

  /** 日程表里自己加的几条。文件坏了的不当作空的悄悄覆盖：problem 里说明，再存一条之前要先删掉或改好那个文件。 */
  own() {
    let raw
    try { raw = fs.readFileSync(this.eventsFile, 'utf8') } catch { return { items: [] } }
    try {
      const saved = JSON.parse(raw)
      if (!Array.isArray(saved?.events)) throw new Error('里面没有 events 列表')
      return { items: saved.events.map(item => normalizeEvent(item)) }
    } catch (error) { return { items: [], problem: `自己加的日程读不了（${message(error)}），文件在 ${this.eventsFile}。` } }
  }

  writeOwn(items) {
    if (items.length > OWN_MAX) throw new Error(`自己加的日程最多存 ${OWN_MAX} 条`)
    writeFile(this.eventsFile, JSON.stringify({ events: items }, null, 2) + '\n')
  }

  /**
   * 加、改、删自己的日程：带 id 的改那一条（找不到时报错），不带的是新加一条，带 remove 的删掉那一条。
   * 文件读不了时不写，免得把原来的盖掉。返回写完的全部，新加的带上分到的 id。
   */
  changeOwn(changes) {
    if (!Array.isArray(changes)) throw new Error('items 要写成列表')
    const current = this.own()
    if (current.problem) throw new Error(current.problem)
    const items = [...current.items]
    for (const change of changes) {
      const id = text(change?.id), at = id ? items.findIndex(item => item.id === id) : -1
      if (id && at < 0) throw new Error(`没有 id 为 ${id} 的日程`)
      if (change?.remove) { if (!id) throw new Error('删日程要给 id'); items.splice(at, 1); continue }
      const item = { ...normalizeEvent({ ...change, id: undefined }), id: id || randomUUID() }
      if (at >= 0) items[at] = item
      else items.push(item)
    }
    this.writeOwn(items)
    return items
  }

  /** 页面上存一条（新加或改）、删一条，返回最新的全部内容。 */
  saveEvent(input) { this.changeOwn([input]); return this.snapshot() }
  removeEvent(input) { this.changeOwn([{ id: input?.id, remove: true }]); return this.snapshot() }

  // ── 缓存 ──────────────────────────────────────────────

  /**
   * 缓存：timetables 是每个小学期读到的课表，current 是教务网默认那个学期是哪一个，exams 是考试安排，
   * graduate 是研究生教务网每个大学期的课（键是 2026-2027|秋冬 这样）。
   */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    const part = value => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
    this.cache = { timetables: part(saved?.timetables) ?? {}, current: part(saved?.current), exams: part(saved?.exams), graduate: part(saved?.graduate) ?? {} }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    writeFile(this.file, JSON.stringify(cache, null, 2) + '\n')
  }

  /**
   * 教务网现在能不能读：off 是插件关了，account 是账号还没填，graduate 是研究生（学号 1、2 开头）；能读时带上账号的指纹。
   * 本科教务网里没有研究生的课表和考试，去读只会拿到一页没有学年学期的页面（2026-11-02 研究生同学反馈），所以不读。
   */
  status(accounts = this.account.read().data) {
    if (this.plugins.disabled().includes(ZDBK.plugin)) return { state: 'off', plugin: ZDBK.plugin }
    if (!accountReady(accounts, ZDBK.account)) return { state: 'account', plugin: accountPlugin(ZDBK.account) }
    const username = accounts[ACCOUNTS[ZDBK.account].user.key]
    if (['硕士', '博士'].includes(fromStudentId(username).student_level)) return { state: 'graduate', plugin: ZDBK.plugin }
    return { state: 'ready', plugin: ZDBK.plugin, owner: fingerprint(username) }
  }

  /**
   * 研究生教务网现在能不能读：和教务网一样看插件开关和账号。本科生也读：选了研究生课的本科生，研究生课只在那边；
   * 没选的读到的是空课表。
   */
  graduateStatus(accounts = this.account.read().data) {
    if (this.plugins.disabled().includes(YJSY.plugin)) return { state: 'off', plugin: YJSY.plugin }
    if (!accountReady(accounts, YJSY.account)) return { state: 'account', plugin: accountPlugin(YJSY.account) }
    return { state: 'ready', plugin: YJSY.plugin, owner: fingerprint(accounts[ACCOUNTS[YJSY.account].user.key]) }
  }

  /** 这个账号存下的那份；换过账号或者没读过时没有。 */
  mine(entry, status) { return status.state === 'ready' && entry?.owner === status.owner ? entry : undefined }

  /** 这个账号存下的研究生课表，键是大学期。 */
  graduateTerms(status = this.graduateStatus()) {
    const terms = {}
    for (const [key, entry] of Object.entries(this.load().graduate)) if (this.mine(entry, status)) terms[key] = entry
    return terms
  }

  recent(entry, force) {
    return !force && !!entry && this.now() - Date.parse(entry.triedAt) < (entry.error ? RETRY_MS : FRESH_MS)
  }

  /**
   * 页面要的全部内容，只看缓存和档案，不联网：
   * today 是北京时间的今天；calendar 是排日程用的校历（三层叠好的）；custom 是用户填的那一层，builtin 是应用自己知道的那两层；
   * unpublished 是还没有国家放假安排的年份；current 是教务网默认那个学期的键（学年|学期）；
   * timetables 是读到过的每个学期的课表（这次没读到、用的是上次的带着 error）；failed 是一次都没读到的学期和原因；
   * events 是考试、作业截止、备忘录里有时间的事、自己加的日程（每周重复的已经展开）和研究生教务网的课；
   * own 是自己加的日程原样的几条（页面上点了改的时候用），ownProblem 是那个文件读不了的原因；
   * sources 是课表和考试两样各自的情况：state、最近一次读成功的时间、最近一次没读到的原因；
   * graduate 是研究生教务网的情况：state，和读过的每个大学期什么时候读的、没读到的原因。
   */
  snapshot() {
    const status = this.status(), cache = this.load(), graduateStatus = this.graduateStatus()
    const current = this.mine(cache.current, status), exams = this.mine(cache.exams, status)
    const timetables = {}, failed = {}
    for (const [key, entry] of Object.entries(cache.timetables)) {
      if (!this.mine(entry, status)) continue
      if (entry.data) timetables[key] = { ...entry.data, fetchedAt: entry.fetchedAt, error: entry.error }
      else if (entry.error) failed[key] = entry.error
    }
    const tasks = this.dueTasks(), memos = this.memoItems(), own = this.own()
    const graduateTerms = this.graduateTerms(graduateStatus)
    const timetable = current?.key ? cache.timetables[current.key] : undefined
    return {
      today: beijing(this.now()).date,
      calendar: this.calendar(),
      custom: this.custom(),
      builtin: this.builtin(),
      unpublished: this.holidays.missing(this.years()),
      current: current?.key ?? null,
      timetables,
      failed,
      events: [...(exams?.items ?? []), ...tasks, ...memos, ...ownEvents(own.items), ...Object.values(graduateTerms).flatMap(entry => entry.lessons ?? [])],
      own: own.items,
      ...(own.problem ? { ownProblem: own.problem } : {}),
      sources: [
        { id: 'timetable', name: PARTS.timetable.label, state: status.state, plugin: status.plugin, fetchedAt: timetable?.fetchedAt ?? current?.fetchedAt ?? null, error: current?.error ?? null },
        { id: 'exams', name: PARTS.exams.label, state: status.state, plugin: status.plugin, fetchedAt: exams?.fetchedAt ?? null, error: exams?.error ?? null },
      ],
      graduate: {
        state: graduateStatus.state, plugin: graduateStatus.plugin,
        terms: Object.fromEntries(Object.entries(graduateTerms).map(([key, entry]) => [key, { fetchedAt: entry.fetchedAt ?? null, error: entry.error ?? null }])),
      },
    }
  }

  /** 校园事务页缓存里没做完的作业，有截止时间的排进截止那天。 */
  dueTasks() {
    let items = []
    try { items = this.tasks() } catch { /* 作业那边读不了不影响日程 */ }
    return items.filter(item => item.deadline).map((item) => {
      const at = beijing(Date.parse(item.deadline))
      return { kind: 'due', from: item.source, ref: item.id, date: at.date, time: at.time, title: item.title, sub: item.course || '', ...(item.done ? { done: true } : {}) }
    })
  }

  memoItems() {
    try { return memoEvents(this.memos()) } catch { return [] }
  }

  /**
   * 去教务网重新读，读完返回最新的全部内容。source 是 timetable、exams 或 graduate（研究生教务网）；
   * 课表不给 term 时读教务网默认的那个学期，给了（「2026-2027|冬」）就读那一个；graduate 要给大学期（「2026-2027|秋冬」）。
   * 刚读过就不再读（force 为真时照读）；同一样东西同一时间只读一次，后来的请求等的是同一次。
   */
  async refresh({ source = 'timetable', term, force = false } = {}) {
    if (!PARTS[source]) throw new Error('没有这一项')
    // 国家的放假安排不用账号，去公开的镜像取。
    if (source === 'holidays') { await this.holidays.refresh(this.years()); return this.snapshot() }
    // 作业是校园事务页在读，让它去各系统读一次（刚读过的它自己跳过）；读不到的原因在校园事务页上看。
    if (source === 'tasks') { try { await this.refreshTasks({ force }) } catch { /* 作业读不到不影响日程 */ } return this.snapshot() }
    if (source === 'graduate') return this.refreshGraduate(term, force)
    if (term !== undefined && (source !== 'timetable' || !/^\d{4}-\d{4}\|.$/.test(term) || !TERM_NAMES.includes(term.slice(-1)))) throw new Error('学期要写成 2026-2027|秋 这样')
    const status = this.status()
    if (status.state !== 'ready') return this.snapshot()
    const key = term ? `timetable:${term}` : source
    let run = this.running.get(key)
    if (!run) {
      const cache = this.load()
      const entry = source === 'exams' ? cache.exams : term ? cache.timetables[term] : cache.current
      if (this.recent(this.mine(entry, status), force)) return this.snapshot()
      run = (source === 'exams' ? this.fetchExams(status.owner) : this.fetchTimetable(status.owner, term)).finally(() => { this.running.delete(key) })
      this.running.set(key, run)
    }
    await run
    return this.snapshot()
  }

  async fetchTimetable(owner, term) {
    const triedAt = new Date(this.now()).toISOString()
    const args = term ? ['zdbk', 'timetable', '--year', term.slice(0, 9), '--term', term.slice(-1)] : ['zdbk', 'timetable']
    let data, error = null
    try { data = fromTimetable(await this.run(args, { system: ZDBK.name, timeoutMs: 120_000 })) } catch (reason) { error = message(reason) }
    const cache = this.load(), timetables = { ...cache.timetables }
    // 要的是哪个学期就记在哪个学期下面，页面下次照这个键找。
    const key = term ?? (data ? termKey(data.year, data.term) : undefined)
    if (key) {
      const before = timetables[key], same = before?.owner === owner
      timetables[key] = data
        ? { owner, data, fetchedAt: triedAt, triedAt, error: null }
        : { owner, data: same ? before.data : undefined, fetchedAt: same ? before.fetchedAt : null, triedAt, error }
    }
    const before = cache.current, same = before?.owner === owner
    const current = term ? cache.current
      : data ? { owner, key, fetchedAt: triedAt, triedAt, error: null }
      : { owner, key: same ? before.key : undefined, fetchedAt: same ? before.fetchedAt : null, triedAt, error }
    this.write({ ...cache, timetables, current })
  }

  async refreshGraduate(term, force) {
    if (!SEMESTER_KEY.test(term ?? '')) throw new Error('大学期要写成 2026-2027|秋冬 这样')
    const status = this.graduateStatus()
    if (status.state !== 'ready') return this.snapshot()
    const key = `graduate:${term}`
    let run = this.running.get(key)
    if (!run) {
      if (this.recent(this.mine(this.load().graduate[term], status), force)) return this.snapshot()
      run = this.fetchGraduate(status.owner, term).finally(() => { this.running.delete(key) })
      this.running.set(key, run)
    }
    await run
    return this.snapshot()
  }

  async fetchGraduate(owner, term) {
    const triedAt = new Date(this.now()).toISOString()
    let lessons, error = null
    try { lessons = fromGraduate(await this.run(['yjsy', 'timetable', '--year', term.slice(0, 9), '--term', term.slice(10)], { system: YJSY.name, timeoutMs: 120_000 })) } catch (reason) { error = message(reason) }
    const cache = this.load(), before = cache.graduate[term], same = before?.owner === owner
    const entry = lessons
      ? { owner, lessons, fetchedAt: triedAt, triedAt, error: null }
      : { owner, lessons: same ? before.lessons : [], fetchedAt: same ? before.fetchedAt : null, triedAt, error }
    this.write({ ...cache, graduate: { ...cache.graduate, [term]: entry } })
  }

  async fetchExams(owner) {
    const triedAt = new Date(this.now()).toISOString(), cache = this.load()
    let exams
    try { exams = { owner, items: fromExams(await this.run(['zdbk', 'exams'], { system: ZDBK.name, timeoutMs: 120_000 })), fetchedAt: triedAt, triedAt, error: null } } catch (error) {
      const same = cache.exams?.owner === owner
      exams = { owner, items: same ? cache.exams.items : [], fetchedAt: same ? cache.exams.fetchedAt : null, triedAt, error: message(error) }
    }
    this.write({ ...cache, exams })
  }

  // ── 给助手的 ──────────────────────────────────────────

  /**
   * 助手查日程：from 到 to 每一天的课和事。缓存里没有要用的课表时先去教务网读一次；
   * 读不到的、校历里缺的写在 notes 里，助手照着告诉用户，不自己补。
   */
  async days({ from, to } = {}) {
    const today = beijing(this.now()).date
    const start = from ? text(from) : today
    if (!isDate(start)) throw new Error('日期要写成 2026-10-21 这样')
    const end = to ? text(to) : addDays(start, 6)
    if (!isDate(end)) throw new Error('日期要写成 2026-10-21 这样')
    if (end < start) throw new Error('to 不能早于 from')
    if (dayNumber(end) - dayNumber(start) >= SPAN_MAX) throw new Error(`一次最多查 ${SPAN_MAX} 天`)
    await this.holidays.refresh(this.years())
    // 作业交没交现查一次（刚查过的会跳过），免得把交过的说成没交。
    try { await this.refreshTasks({ force: false }) } catch { /* 读不到就用上一次的 */ }
    let data = this.snapshot()
    if (data.sources[0].state === 'ready') {
      if (!data.current) data = await this.refresh({ source: 'timetable' })
      for (const key of new Set(planDays(data, start, end).map(day => day.missing).filter(Boolean))) data = await this.refresh({ source: 'timetable', term: key })
      if (!data.sources[1].fetchedAt) data = await this.refresh({ source: 'exams' })
    }
    // 研究生课：这几天落在哪几个大学期，就读哪几个（刚读过的跳过）。
    const semesters = [...new Set(planDays(data, start, end).map(day => day.term && semesterKey(day.term)).filter(Boolean))]
    if (data.graduate.state === 'ready') for (const key of semesters) data = await this.refresh({ source: 'graduate', term: key })
    const days = planDays(data, start, end)
    const notes = []
    const source = data.sources[0]
    if (source.state === 'off') notes.push('「课程与学习」在插件页「ZJU All-in-One Assistant」里关着，课表和考试没查。')
    else if (source.state === 'account') notes.push('浙大统一身份认证的账号还没填，课表和考试没查；请用户去插件页「ZJU All-in-One Assistant → 校园账号」的配置里填。')
    else if (source.state === 'graduate') notes.push('用户是研究生，本科教务网里没有他的课表和考试，不要用 zdbk 去查；课是从研究生教务网读的，考试安排还读不到。')
    for (const item of data.sources) if (item.error) notes.push(`${item.name}这次没从教务网读到（${item.error}）${item.fetchedAt ? `，用的是 ${item.fetchedAt.slice(0, 10)} 读到的` : ''}。`)
    for (const key of semesters) {
      const entry = data.graduate.terms[key]
      if (entry?.error) notes.push(`${key.replace('|', ' ')}学期的研究生课表这次没从研究生教务网读到（${entry.error}）${entry.fetchedAt ? `，用的是 ${entry.fetchedAt.slice(0, 10)} 读到的` : '，研究生课没排上'}。`)
    }
    if (source.state !== 'graduate') for (const key of new Set(days.map(day => day.missing).filter(Boolean))) notes.push(`${key.replace('|', ' ')}学期的课表没读到，这几天的课没排上${data.failed[key] ? `：${data.failed[key]}` : ''}。`)
    if (days.some(day => day.loose)) notes.push(`校历里还没有 ${data.current?.replace('|', ' ')}学期，这些天的课是照课表每周都排上的，没算单双周、放假和调休。可以请用户在「日程表」里填校历，或者照学校的校历和放假通知用 campus_calendar_write 填。`)
    if (data.calendar.problem) notes.push(data.calendar.problem)
    const unpublished = data.unpublished.filter(year => start <= `${year}-12-31` && `${year}-01-01` <= end)
    if (unpublished.length) notes.push(`${unpublished.join('、')} 年的放假安排国务院还没公布（或者这次没取到），这几天的放假和调休还没排上。`)
    return {
      today,
      days: days.map(day => ({
        date: day.date, weekday: WEEKDAY_NAMES[day.weekday - 1],
        ...(day.term ? { week: `${day.term.year} ${day.term.term}学期第 ${day.term.week} 周` } : {}),
        ...(day.off ? { off: `${day.off.note || '放假'}${day.off.moved ? `，这天的课挪到 ${day.off.moved} 上` : '，停课'}` } : {}),
        ...(day.swap ? { swap: `${day.swap.note || '调休'}，上 ${day.swap.as}（${WEEKDAY_NAMES[day.swap.weekday - 1]}）的课` } : {}),
        items: day.items.map(item => ({
          kind: KIND_NAMES[item.kind] ?? item.kind, ...(item.time ? { time: item.end ? `${item.time}-${item.end}` : item.time } : {}), title: item.title,
          ...(item.sub ? { where: item.sub } : {}), ...(item.done ? { done: '已交' } : {}),
          ...(item.from === 'yjsy' ? { from: '研究生教务网' } : {}), ...(item.from === 'mine' ? { from: '用户自己加的', id: item.ref } : {}),
        })),
      })),
      ...(notes.length ? { notes } : {}),
    }
  }

  /** 对话开头告诉助手今天是哪个学期第几周、最近的放假和调休，用户问「第几周」「下周一上不上课」时不用猜。 */
  promptText() {
    const calendar = this.calendar()
    if (!calendar.terms.length) return ''
    const today = beijing(this.now()).date, at = termAt(calendar, today)
    const lines = [`日程表的校历：今天 ${today}（${WEEKDAY_NAMES[weekdayOf(today) - 1]}）${at ? `是 ${at.year} ${at.term}学期第 ${at.week} 周` : '不在校历里的任何一个学期'}。`]
    // 接下来一个月里的放假和调休；连着放的几天并成一段。同一天有好几条时只算优先的那一条。
    const first = new Map(), soon = []
    for (const day of calendar.days) {
      if ((day.until ?? day.date) >= today && day.date <= addDays(today, 30) && !first.has(day.date)) first.set(day.date, day)
    }
    for (const day of [...first.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      const last = soon.at(-1)
      if (day.off && !day.until && last?.off && last.note === day.note && addDays(last.until ?? last.date, 1) === day.date) last.until = day.date
      else soon.push({ ...day })
    }
    if (soon.length) lines.push(`接下来一个月：${soon.map(day => day.as ? `${day.date} ${day.note || '调休'}，上 ${day.as}（${WEEKDAY_NAMES[weekdayOf(day.as) - 1]}）的课` : `${day.date}${day.until ? ` 到 ${day.until}` : ''} ${day.note || '放假'}停课`).join('；')}。`)
    lines.push('哪天上什么课用 campus_schedule_read 查，它已经按校历算好了周次、单双周、放假和调休。')
    return lines.join('\n')
  }
}

const KIND_NAMES = { class: '课', exam: '考试', due: '截止', event: '日程' }
/** 研究生教务网的大学期：2026-2027|秋冬。 */
const SEMESTER_KEY = /^\d{4}-\d{4}\|(秋冬|春夏)$/

function writeFile(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, value, { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
