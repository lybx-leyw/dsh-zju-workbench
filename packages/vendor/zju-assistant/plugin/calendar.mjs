/**
 * 日程表怎么排：校历（每个小学期第 1 周的周一、哪天放假、哪天调休上哪天的课）加上教务网的课表，
 * 算出某一天上哪些课；考试、作业截止和备忘录里写了时间的几条排进同一天。
 * 日程表页（ui/client/SchedulePage.tsx）和助手查日程的工具（schedule.mjs）用的是这同一份。
 * 日期一律写成北京时间的「2026-10-18」，换算只按日历数天数，不经过本机的时区。
 */

const DAY = 86_400_000
export const TERM_NAMES = ['秋', '冬', '春', '夏', '短', '暑']
/** 一个小学期默认几周（浙大的秋、冬、春、夏各 8 周）。 */
export const TERM_WEEKS = 8
export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
/** 浙大一天的 13 节课（校历上印的上课时间）。教务网的课表里带着节次时刻时用课表的。 */
export const ZJU_PERIODS = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['10:00', '10:45'], ['10:50', '11:35'], ['11:40', '12:25'],
  ['13:25', '14:10'], ['14:15', '15:00'], ['15:05', '15:50'], ['16:15', '17:00'], ['17:05', '17:50'],
  ['18:50', '19:35'], ['19:40', '20:25'], ['20:30', '21:15'],
].map(([startTime, endTime], index) => ({ period: index + 1, startTime, endTime }))

const pad = value => String(value).padStart(2, '0')
const text = value => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

/** 「2026-10-18」是从 1970-01-01 起的第几天。 */
export const dayNumber = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY
export const dateOf = number => new Date(number * DAY).toISOString().slice(0, 10)
export const addDays = (date, days) => dateOf(dayNumber(date) + days)
/** 星期几，周一是 1，周日是 7。 */
export const weekdayOf = date => (dayNumber(date) % 7 + 10) % 7 + 1
/** 这一天所在那一周的周一。 */
export const mondayOf = date => addDays(date, 1 - weekdayOf(date))
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateOf(dayNumber(value)) === value
/** 一个时刻在北京是哪一天、几点。 */
export function beijing(at) {
  const iso = new Date(at + 8 * 3_600_000).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}
export const termKey = (year, term) => `${year}|${term}`

/**
 * 校历：terms 是每个小学期第 1 周的周一（start）和一共几周（weeks）；days 是特殊的日子：
 * off 为真是放假不上课（until 是连着放到哪天），as 是调休、这天上 as 那天的课；note 是原因（国庆节、运动会）。
 * 存的时候和读的时候都过一遍这里，格式不对的说清楚是哪一项。
 */
export function normalizeCalendar(input) {
  const terms = [], days = []
  for (const item of Array.isArray(input?.terms) ? input.terms : []) {
    const year = text(item?.year), term = text(item?.term), start = text(item?.start)
    const weeks = item?.weeks === undefined || item?.weeks === null || item?.weeks === '' ? TERM_WEEKS : Number(item.weeks)
    if (!/^\d{4}-\d{4}$/.test(year) || +year.slice(5) !== +year.slice(0, 4) + 1) throw new Error(`学年「${year}」要写成 2026-2027 这样`)
    if (!TERM_NAMES.includes(term)) throw new Error(`学期「${term}」只能是${TERM_NAMES.join('、')}中的一个`)
    const name = `${year} ${term}学期`
    if (!isDate(start)) throw new Error(`${name}第 1 周的日期「${start}」要写成 2026-09-14 这样`)
    if (weekdayOf(start) !== 1) throw new Error(`${name}第 1 周要从周一算起，${start} 是${WEEKDAY_NAMES[weekdayOf(start) - 1]}`)
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 30) throw new Error(`${name}的周数要在 1 到 30 之间`)
    if (terms.some(other => other.year === year && other.term === term)) throw new Error(`${name}写了两次`)
    terms.push({ year, term, start, weeks })
  }
  terms.sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < terms.length; i++) {
    const before = terms[i - 1], after = terms[i]
    if (dayNumber(after.start) < dayNumber(before.start) + before.weeks * 7) throw new Error(`${before.year} ${before.term}学期和 ${after.year} ${after.term}学期的周次重叠了`)
  }
  for (const item of Array.isArray(input?.days) ? input.days : []) {
    const date = text(item?.date), note = text(item?.note).slice(0, 40), as = text(item?.as), until = text(item?.until)
    if (!isDate(date)) throw new Error(`日期「${date}」要写成 2026-10-01 这样`)
    const extra = note ? { note } : {}
    if (as) {
      if (!isDate(as)) throw new Error(`${date} 调休上哪天的课「${as}」要写成 2026-10-08 这样`)
      if (as === date) throw new Error(`${date} 调休上的不能是同一天的课`)
      days.push({ date, as, ...extra })
    } else if (item?.off === true) {
      if (until && !isDate(until)) throw new Error(`${date} 放假到哪天「${until}」要写成 2026-10-07 这样`)
      if (until && until < date) throw new Error(`${date} 放假到的那天 ${until} 在它前面`)
      if (until && dayNumber(until) - dayNumber(date) > 60) throw new Error(`${date} 起的放假超过两个月了，假期不用写进校历`)
      days.push({ date, off: true, ...(until && until !== date ? { until } : {}), ...extra })
    } else throw new Error(`${date} 要么是放假（off），要么是调休（as 写上哪天的课）`)
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < days.length; i++) {
    if (days[i].date <= (days[i - 1].until ?? days[i - 1].date)) throw new Error(`${days[i].date} 写了两次`)
  }
  return { terms, days }
}

/**
 * 几层校历叠成一份：排在前面的优先（用户自己填的、学校的校历、国家的放假安排）。
 * 学期按学年和学期名认，前面有了的后面不要，和前面的周次重叠的也不要；
 * 特殊的日子不去重，按优先的顺序排着，specialDay 找到的第一条就是算数的那一条。
 */
export function layerCalendars(...layers) {
  const terms = [], days = []
  for (const layer of layers) {
    for (const term of layer?.terms ?? []) {
      const from = dayNumber(term.start), to = from + term.weeks * 7
      const taken = terms.some(other => (other.year === term.year && other.term === term.term)
        || (from < dayNumber(other.start) + other.weeks * 7 && dayNumber(other.start) < to))
      if (!taken) terms.push(term)
    }
    days.push(...(layer?.days ?? []))
  }
  return { terms: terms.sort((a, b) => a.start.localeCompare(b.start)), days }
}

/** 这一天在哪个小学期的第几周；不在校历里的任何一个学期时是 null。 */
export function termAt(calendar, date) {
  const number = dayNumber(date)
  for (const term of calendar.terms) {
    const offset = number - dayNumber(term.start)
    if (offset >= 0 && offset < term.weeks * 7) return { year: term.year, term: term.term, week: Math.floor(offset / 7) + 1 }
  }
  return null
}

/** 研究生教务网按大学期排课：秋、冬学期是 2026-2027|秋冬，春、夏学期是 2026-2027|春夏；短学期、暑期没有。 */
export function semesterKey(at) {
  const half = ['秋', '冬'].includes(at?.term) ? '秋冬' : ['春', '夏'].includes(at?.term) ? '春夏' : ''
  return half ? `${at.year}|${half}` : null
}

/** 这一天是不是放假或调休的日子。 */
export const specialDay = (calendar, date) => calendar.days.find(day => day.date === date || (day.until !== undefined && day.date <= date && date <= day.until))

/** 课表里的周次「第1-8周」「第1-4,6-8周」「第2周」：哪几周有课。认不出来时是 null，当作每周都有。 */
export function parseWeeks(value) {
  const body = text(value).replace(/[第周\s]/g, '')
  if (!body) return null
  const weeks = new Set()
  for (const part of body.split(/[,，、]/)) {
    const match = /^(\d+)(?:[-－~～](\d+))?$/.exec(part)
    if (!match) return null
    const from = +match[1], to = match[2] ? +match[2] : from
    if (to < from || to - from > 60) return null
    for (let week = from; week <= to; week++) weeks.add(week)
  }
  return weeks
}

/** 一次上课安排（课表里的 meeting）在第几周有没有。 */
export function meetsIn(meeting, week) {
  const weeks = parseWeeks(meeting.weeks)
  if (weeks && !weeks.has(week)) return false
  return meeting.weekPattern === '单周' ? week % 2 === 1 : meeting.weekPattern === '双周' ? week % 2 === 0 : true
}

/** 只写了月和日的，取离 ref 那天最近的一年。 */
function nearestYear(month, day, ref) {
  const year = isDate(ref) ? +ref.slice(0, 4) : new Date().getFullYear()
  const candidates = [year - 1, year, year + 1].map(y => `${y}-${pad(month)}-${pad(day)}`).filter(isDate)
  if (!isDate(ref)) return candidates.find(date => date.startsWith(String(year)))
  return candidates.sort((a, b) => Math.abs(dayNumber(a) - dayNumber(ref)) - Math.abs(dayNumber(b) - dayNumber(ref)))[0]
}

/** 「17:00」「17：00」「下午3点」「晚上7点半」：一天里的几点几分。 */
export function clockIn(value) {
  const exact = /(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[-—–~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/.exec(value)
  if (exact && +exact[1] < 24 && +exact[2] < 60) {
    return { time: `${pad(+exact[1])}:${exact[2]}`, ...(exact[3] && +exact[3] < 24 && +exact[4] < 60 ? { end: `${pad(+exact[3])}:${exact[4]}` } : {}) }
  }
  const spoken = /(上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*[点時时](半|(\d{1,2})\s*分)?/.exec(value)
  if (!spoken || +spoken[2] > 23) return {}
  let hour = +spoken[2]
  if (spoken[1] && spoken[1] !== '上午' && hour < 12) hour += 12
  const minute = spoken[3] === '半' ? 30 : spoken[4] ? +spoken[4] : 0
  return minute < 60 ? { time: `${pad(hour)}:${pad(minute)}` } : {}
}

/**
 * 备忘录属性里写的时间：「2026-10-21」「2026-10-21 17:00」「10月21日17:00前」「2026年10月21日（周三）14:00-16:00」。
 * 几个时间用分号隔开时一个一个认；没写年份的，取离 ref（这条备忘最后改动的那天）最近的一年。
 * 返回 [{ date, time?, end?, text }]，text 是这一段的原话；认不出日期的段落不要。
 */
export function datesIn(value, ref) {
  const found = []
  for (const part of text(value).split(/[；;]/)) {
    const said = part.trim()
    const full = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(said)
    const short = full ? null : /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(said)
    const match = full ?? short
    if (!match) continue
    const date = full ? `${full[1]}-${pad(+full[2])}-${pad(+full[3])}` : nearestYear(+short[1], +short[2], ref)
    if (!isDate(date)) continue
    found.push({ date, ...clockIn(said.slice(match.index + match[0].length)), text: said })
  }
  return found
}

/** 备忘录里排进日程的属性：事情发生的时间，和截止。 */
export const MEMO_WHEN = ['时间', '活动时间', '开始']
export const MEMO_DUE = ['截止', '报名截止']

/**
 * 备忘录里写了时间的几条变成日程上的事：属性「时间」是那天要去做的事（event），「截止」是那天之前要办完（due）。
 * 归档了的不排。notes 是档案里备忘录的列表（store.mjs 的 list）。
 */
export function memoEvents(notes) {
  const events = []
  for (const note of notes) {
    if (note.archived) continue
    const ref = text(note.updatedAt).slice(0, 10)
    for (const { key, value } of note.properties ?? []) {
      const kind = MEMO_WHEN.includes(key) ? 'event' : MEMO_DUE.includes(key) ? 'due' : null
      if (!kind) continue
      for (const at of datesIn(value, ref)) {
        events.push({ kind, from: 'memo', ref: note.title, date: at.date, ...(at.time ? { time: at.time } : {}), ...(at.end ? { end: at.end } : {}), title: note.title, sub: key === '截止' || key === '时间' ? '' : key })
      }
    }
  }
  return events
}

/** 自己加的日程分两种：event 是一件事；class 是一门课（比如教务网里没有的研究生课），放假那天不排。 */
export const OWN_KINDS = ['event', 'class']
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 日程表里自己加的一条（日程表页的「+」和助手都写这个）。id 是认它用的；time、end 是几点到几点；place 是地点；
 * until 是每周这一天重复、一直到哪天（算上这天）。存的时候过一遍这里，格式不对的说清楚是哪一项。
 */
export function normalizeEvent(input) {
  const id = text(input?.id), title = text(input?.title).slice(0, 60), date = text(input?.date), time = text(input?.time), end = text(input?.end)
  const place = text(input?.place).slice(0, 40), kind = text(input?.kind) || 'event', until = text(input?.until)
  if (id && !/^[\w-]{1,64}$/.test(id)) throw new Error('日程的 id 不对')
  if (!title) throw new Error('日程要写上是什么事')
  if (!isDate(date)) throw new Error(`「${title}」的日期「${date}」要写成 2026-11-05 这样`)
  if (time && !CLOCK.test(time)) throw new Error(`「${title}」的开始时间「${time}」要写成 14:00 这样`)
  if (end && !CLOCK.test(end)) throw new Error(`「${title}」的结束时间「${end}」要写成 15:35 这样`)
  if (end && !time) throw new Error(`「${title}」写了几点结束，也要写几点开始`)
  if (end && end <= time) throw new Error(`「${title}」结束的时间要晚于开始`)
  if (!OWN_KINDS.includes(kind)) throw new Error(`「${title}」的种类只能是 ${OWN_KINDS.join('、')}`)
  if (until && !isDate(until)) throw new Error(`「${title}」每周重复到哪天「${until}」要写成 2027-01-10 这样`)
  if (until && until < date) throw new Error(`「${title}」重复到的那天 ${until} 在开始那天前面`)
  if (until && dayNumber(until) - dayNumber(date) > 366) throw new Error(`「${title}」每周重复最多排一年`)
  return { ...(id ? { id } : {}), title, date, ...(time ? { time } : {}), ...(end ? { end } : {}), ...(place ? { place } : {}), kind, ...(until && until !== date ? { until } : {}) }
}

/** 自己加的日程变成日程上的事：每周重复的按周展开，每一次都带着它的 id（ref）。 */
export function ownEvents(items) {
  const events = []
  for (const item of items) {
    for (let number = dayNumber(item.date); number <= dayNumber(item.until ?? item.date); number += 7) {
      events.push({
        kind: item.kind, from: 'mine', ref: item.id, date: dateOf(number), ...(item.time ? { time: item.time } : {}), ...(item.end ? { end: item.end } : {}),
        title: item.title, sub: item.place ?? '',
      })
    }
  }
  return events
}

/** 两件事的时间有没有重叠（都要有开始和结束）。 */
const overlaps = (a, b) => !!(a.time && a.end && b.time && b.end && a.time < b.end && b.time < a.end)

/**
 * 一天的日程。data 是 { calendar, timetables: { [学年|学期]: { periodTimes, courses } }, current（教务网默认那个学期的键）, events }：
 * events 是考试、截止、备忘、自己加的日程、研究生教务网的课这些已经有了日期的事。
 * 研究生教务网的课（from 为 yjsy）和本科课表里同一时间的是同一节课（本研共修的课两边都有），只留本科课表的。
 * 是课的事（研究生教务网的、自己加的）放假那天不排，和课表一样。
 * 返回 { date, weekday, term, off?, swap?, missing?, loose?, items }：
 *   term   这天按校历是哪个学期第几周（调休的日子算上的那天的），不在任何学期里是 null；
 *   off    放假，{ note, moved?（这天的课挪到哪天上）, source? }；swap 调休或补课，{ as, weekday, note, source? }；
 *          source 是这一条从哪来：custom 用户填的，school 学校的校历，national 国家的放假安排；
 *   missing 这个学期的课表还没读到，页面去读；
 *   loose  校历里还没有现在这个学期，课是照课表每周都排上的，没算周次和调休；
 *   items  这天的课和事，没有时间的在前，其余按开始时间。
 */
export function planDay(data, date) {
  const calendar = data.calendar ?? { terms: [], days: [] }
  const special = specialDay(calendar, date)
  const day = { date, weekday: weekdayOf(date), term: null, items: [] }
  const classes = []
  const from = special?.source ? { source: special.source } : {}
  if (special?.off) day.off = { note: special.note ?? '', ...(special.moved ? { moved: special.moved } : {}), ...from }
  if (special?.as) day.swap = { as: special.as, weekday: weekdayOf(special.as), note: special.note ?? '', ...from }
  day.term = termAt(calendar, special?.as ?? date)
  const known = data.current && calendar.terms.some(term => termKey(term.year, term.term) === data.current)
  // 调休、补课的那天上的是另一天的课；落在周末的，本来周末的课照上（浙大的教学安排这么说）。
  const sources = special?.as ? [special.as, ...(weekdayOf(date) >= 6 ? [date] : [])] : [date]
  if (!day.off) {
    for (const source of sources) {
      const at = termAt(calendar, source)
      if (at) {
        const key = termKey(at.year, at.term), table = data.timetables?.[key]
        if (!table) day.missing = key
        else classes.push(...classesOn(table, weekdayOf(source), meeting => meetsIn(meeting, at.week)))
      } else if (!known && data.current && data.timetables?.[data.current]) {
        day.loose = true
        classes.push(...classesOn(data.timetables[data.current], weekdayOf(source), () => true))
      }
    }
  }
  const events = (data.events ?? []).filter(event => event.date === date && !(event.kind === 'class' && day.off)
    && !(event.from === 'yjsy' && classes.some(item => overlaps(item, event))))
  day.items = [...classes, ...events].sort((a, b) => (a.time ? 1 : 0) - (b.time ? 1 : 0) || (a.time ?? '').localeCompare(b.time ?? '') || (a.kind === 'class' ? 0 : 1) - (b.kind === 'class' ? 0 : 1))
  return day
}

function classesOn(table, weekday, keep) {
  const items = []
  for (const course of table.courses ?? []) {
    for (const meeting of course.meetings ?? []) {
      if (meeting.weekday !== weekday || !keep(meeting)) continue
      items.push({
        kind: 'class', title: course.name, time: meeting.startTime, end: meeting.endTime, sub: meeting.location ?? '',
        teacher: course.teacher ?? '', periods: meeting.periods ?? [], weeks: meeting.weeks ?? '', weekPattern: meeting.weekPattern ?? '',
      })
    }
  }
  return items
}

/** 从 from 到 to（都算上）每一天的日程。 */
export function planDays(data, from, to) {
  const days = []
  for (let number = dayNumber(from); number <= dayNumber(to); number++) days.push(planDay(data, dateOf(number)))
  return days
}
