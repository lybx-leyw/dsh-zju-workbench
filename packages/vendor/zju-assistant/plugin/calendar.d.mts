/** calendar.mjs 的类型：日程表页（ui/client/SchedulePage.tsx）用。 */

export const TERM_NAMES: readonly string[]
export const TERM_WEEKS: number
export const WEEKDAY_NAMES: readonly string[]
export const MEMO_WHEN: readonly string[]
export const MEMO_DUE: readonly string[]
export const ZJU_PERIODS: readonly { period: number, startTime: string, endTime: string }[]

export function dayNumber(date: string): number
export function dateOf(number: number): string
export function addDays(date: string, days: number): string
/** 周一是 1，周日是 7。 */
export function weekdayOf(date: string): number
export function mondayOf(date: string): string
export function isDate(value: unknown): value is string
export function beijing(at: number): { date: string, time: string }
export function termKey(year: string, term: string): string

export interface CalendarTerm { year: string, term: string, start: string, weeks: number }
/** 从哪来：custom 用户填的，school 学校的校历，national 国家的放假安排。 */
export type DaySource = 'custom' | 'school' | 'national'
/** off 是放假（until 是放到哪天，moved 是这天的课挪到哪天上），as 是调休或补课、这天上 as 那天的课。 */
export interface CalendarDay { date: string, off?: true, until?: string, moved?: string, as?: string, note?: string, source?: DaySource }
export interface Calendar { terms: CalendarTerm[], days: CalendarDay[] }
export interface TermWeek { year: string, term: string, week: number }

export function normalizeCalendar(input: unknown): Calendar
export function layerCalendars(...layers: (Calendar | undefined)[]): Calendar
export function termAt(calendar: Calendar, date: string): TermWeek | null
/** 研究生教务网的大学期：2026-2027|秋冬、2026-2027|春夏；短学期、暑期是 null。 */
export function semesterKey(at: { year: string, term: string } | null | undefined): string | null
export function specialDay(calendar: Calendar, date: string): CalendarDay | undefined
export function parseWeeks(value: unknown): Set<number> | null

export interface Meeting { weekday: number, periods: number[], startTime: string, endTime: string, location: string, weeks: string, weekPattern: string }
export function meetsIn(meeting: Meeting, week: number): boolean
export function datesIn(value: unknown, ref?: string): { date: string, time?: string, end?: string, text: string }[]

export interface Timetable {
  year: string
  term: string
  periodTimes: { period: number, startTime: string, endTime: string }[]
  courses: { name: string, teacher: string, term: string, meetings: Meeting[] }[]
  fetchedAt?: string | null
  error?: string | null
}

/** class 课，exam 考试，due 截止，event 备忘录里那天要去做的事。 */
export type PlanKind = 'class' | 'exam' | 'due' | 'event'
export interface PlanItem {
  kind: PlanKind
  title: string
  time?: string
  end?: string
  /** 地点、课程名、考场这类跟在标题后面的一句。 */
  sub?: string
  /** 从哪来：zdbk、xuezai、pta、memo、yjsy（研究生教务网的课）、mine（自己加的）。 */
  from?: string
  /** 在来处认它用的：备忘的标题、作业的编号、自己加的日程的 id。 */
  ref?: string
  teacher?: string
  periods?: number[]
  weeks?: string
  weekPattern?: string
  /** 截止那天，事情（考试、截止、备忘）才有。 */
  date?: string
  /** 作业已经交了（学在浙大、PTA）。 */
  done?: boolean
}
export interface PlanEvent extends PlanItem { date: string }

/** 自己加的日程：event 一件事，class 一门课（放假那天不排）。 */
export type OwnKind = 'event' | 'class'
export const OWN_KINDS: readonly OwnKind[]
/** 日程表里自己加的一条；until 是每周重复到哪天。 */
export interface OwnEvent { id?: string, title: string, date: string, time?: string, end?: string, place?: string, kind: OwnKind, until?: string }
export function normalizeEvent(input: unknown): OwnEvent
export function ownEvents(items: readonly OwnEvent[]): PlanEvent[]

export function memoEvents(notes: readonly { title: string, archived?: boolean, updatedAt?: string, properties?: readonly { key: string, value: string }[] }[]): PlanEvent[]

export interface PlanData {
  calendar: Calendar
  timetables: Record<string, Timetable>
  current: string | null
  events: readonly PlanEvent[]
}
export interface PlanDay {
  date: string
  weekday: number
  term: TermWeek | null
  off?: { note: string, moved?: string, source?: DaySource }
  swap?: { as: string, weekday: number, note: string, source?: DaySource }
  missing?: string
  loose?: true
  items: PlanItem[]
}
export function planDay(data: PlanData, date: string): PlanDay
export function planDays(data: PlanData, from: string, to: string): PlanDay[]
