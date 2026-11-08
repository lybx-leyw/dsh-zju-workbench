/**
 * 日程表：侧栏上自己的一项（client/index.tsx 登记），不盖住官方的「自动化任务」。
 * 一周的课表格子：本科教务网和研究生教务网的课、考试、备忘录里写了时间的事、自己加的日程、作业的截止都按时间放进格子。
 * 右上角的「+」加一条自己的日程；加过的在格子里点一下就能改、能删。
 * 格子是固定的：一天 13 节，每节一样高，事情多了也不会把页面撑长，和手机上的课表一个样子；
 * 每节多高按窗口的高度算，默认大小的窗口不用上下滚就能看到第 13 节。
 * 课怎么排进具体日期（校历、周次、单双周、放假和调休）在 calendar.mjs，校历和放假安排在 host/holidays.mjs，
 * 课表和考试的缓存在 host/schedule.mjs。
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconTrashOutlineRegular, Modal, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  TERM_NAMES, TERM_WEEKS, WEEKDAY_NAMES, ZJU_PERIODS, addDays, beijing, mondayOf, planDays, semesterKey, weekdayOf,
  type Calendar, type CalendarDay, type DaySource, type OwnEvent, type OwnKind, type PlanData, type PlanDay, type PlanItem,
} from '../calendar.mjs'
import { errorText, campusApi } from './api.ts'
import { Alert, Crumb, Field } from './controls.tsx'
import { handToAssistant } from './handoff.tsx'
import { openRow } from './campus.ts'
import { agoText, useNow } from './when.ts'
import { place, rowAt, type Period, type Pinned, type Placed } from './grid.ts'

interface Source { id: 'timetable' | 'exams', name: string, state: 'ready' | 'account' | 'off' | 'graduate', plugin: string, fetchedAt: string | null, error: string | null }
/** 引擎侧 schedule.mjs 的 snapshot。 */
interface Snapshot extends PlanData {
  today: string
  calendar: Calendar & { problem?: string }
  /** 用户自己填的那一层，和应用自己知道的那两层（浙大的校历、国家的放假安排）。 */
  custom: Calendar & { problem?: string }
  builtin: Calendar
  /** 还没有国家放假安排的年份。 */
  unpublished: number[]
  failed: Record<string, string>
  sources: Source[]
  /** 自己加的日程（每周重复的是一条），和那个文件读不了时的原因。 */
  own: (OwnEvent & { id: string })[]
  ownProblem?: string
  /** 研究生教务网：state，和读过的每个大学期（2026-2027|秋冬）什么时候读的、没读到的原因。 */
  graduate: { state: 'ready' | 'account' | 'off', plugin: string, terms: Record<string, { fetchedAt: string | null, error: string | null }> }
}
interface State { snapshot: Snapshot | null, busy: readonly string[], error: string }

// ── 页面外面的状态：离开这一页再回来，照上一次的画，正在进行的读取也不会断 ──

let state: State = { snapshot: null, busy: [], error: '' }
/** 现在看的是哪一周（那一周的周一）。 */
let shown: string | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const emit = () => { for (const listener of [...listeners]) listener() }
const update = (patch: Partial<State>) => { state = { ...state, ...patch }; emit() }
const setShown = (next: string) => { shown = next; emit() }
/** 这一次进页面已经去要过的学期课表、研究生课表，同一个不再要（读失败时后台自己隔一阵才重试）。 */
const asked = new Set<string>()

/** 这一周落在研究生教务网的哪几个大学期（2026-2027|秋冬）。 */
const semestersOf = (days: PlanDay[]) => [...new Set(days.map(day => day.term && semesterKey(day.term)).filter((key): key is string => !!key))]

/** 去研究生教务网读这一周要用的大学期；读过的跳过，force 时照读。 */
function loadGraduate(snapshot: Snapshot, monday: string, force = false): Promise<void>[] {
  if (snapshot.graduate?.state !== 'ready') return []
  return semestersOf(planDays(snapshot, monday, addDays(monday, 6))).filter(key => force || !asked.has(`graduate:${key}`)).map((key) => {
    asked.add(`graduate:${key}`)
    return load(`graduate:${key}`, { source: 'graduate', term: key, force })
  })
}

/** 读一样东西：同一样同时只读一次，读完换上新的内容。 */
async function load(key: string, input: object): Promise<void> {
  if (state.busy.includes(key)) return
  update({ busy: [...state.busy, key] })
  try { update({ snapshot: await campusApi<Snapshot>('schedule-refresh', input) }) }
  catch (error) { update({ error: errorText(error) }) }
  finally { update({ busy: state.busy.filter(item => item !== key) }) }
}

/**
 * 进页面、回到窗口、点刷新时调用。先拿缓存，再让后台去教务网读课表和考试，缺哪年的国家放假安排也去取；
 * 刚读过的后台自己会跳过，force 时照读。
 */
async function visit(force = false): Promise<void> {
  let snapshot: Snapshot
  try { snapshot = await campusApi<Snapshot>('schedule-read') } catch (error) { update({ error: errorText(error) }); return }
  asked.clear()
  update({ snapshot, error: '' })
  // 作业交没交，让校园事务页去各系统读一次，交过的这里标成已完成。
  const reads = [load('tasks', { source: 'tasks', force }), ...(snapshot.unpublished.length ? [load('holidays', { source: 'holidays' })] : [])]
  if (snapshot.sources[0]?.state === 'ready') reads.push(load('timetable', { source: 'timetable', force }), load('exams', { source: 'exams', force }))
  // 研究生课：本科生选了的、研究生自己的，都在研究生教务网。
  reads.push(...loadGraduate(snapshot, shown ?? mondayOf(beijing(Date.now()).date), force))
  await Promise.all(reads)
}

// ── 课表格子 ──────────────────────────────────────────

const monthDay = (date: string) => `${+date.slice(5, 7)}月${+date.slice(8, 10)}日`
const shortDate = (date: string) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`
const termName = (key: string) => `${key.slice(0, 9)} ${key.slice(10)}学期`

const KIND_LABEL: Record<PlanItem['kind'], string> = { class: '', exam: '考试', due: '截止', event: '' }
const FROM_NAME: Record<string, string> = { memo: '备忘录', xuezai: '学在浙大', pta: 'PTA', chaoxing: '学习通', zdbk: '教务网', yjsy: '研究生教务网' }
/** 提示里最后一行：从哪来的；自己加的写「自己加的」。 */
const fromLine = (item: PlanItem) => item.from === 'mine' ? '自己加的' : item.from && FROM_NAME[item.from] ? `来自${FROM_NAME[item.from]}` : ''

/** 鼠标放上去看到的：时间、老师、节次、周次、地点，或者是哪门课、从哪来的。 */
function hint(item: PlanItem): string {
  const time = item.time ? (item.end && item.kind !== 'due' ? `${item.time}–${item.end}` : item.time) : ''
  if (item.kind === 'class') {
    const weeks = [item.weeks, item.weekPattern === '每周' ? '' : item.weekPattern].filter(Boolean).join(' ')
    return [item.title, [time, item.periods?.length ? `第 ${item.periods.join('、')} 节` : ''].filter(Boolean).join(' · '), item.teacher, weeks, item.sub,
      item.from !== 'zdbk' && fromLine(item)].filter(Boolean).join('\n')
  }
  const when = item.kind === 'due' ? `${item.date ? `${monthDay(item.date)} ` : ''}${item.time ?? ''} 截止${item.done ? '，已交' : ''}` : time
  return [`${KIND_LABEL[item.kind] ? `${KIND_LABEL[item.kind]}：` : ''}${item.title}`, when, item.sub, fromLine(item)].filter(Boolean).join('\n')
}

/** 自己加的日程在格子里是按钮，点了改它；别的只是看。 */
type OnEdit = (id: string) => void
function Cell({ item, className, style, onEdit, children, ...data }: { item: PlanItem, className: string, style: CSSProperties, onEdit: OnEdit, children: ReactNode, [key: `data-${string}`]: string | undefined }) {
  const ref = item.from === 'mine' ? item.ref : undefined
  if (!ref) return <div className={className} style={style} title={hint(item)} {...data}>{children}</div>
  return <button type="button" className={className} style={style} title={hint(item)} onClick={() => { onEdit(ref) }} {...data}>{children}</button>
}

/** 格子里的一块。课只写名字和地点（时间看左边的节次）；考试和备忘写上时间。正在上的那一节加一道外框。 */
function Block({ placed, live, loose, onEdit }: { placed: Placed, live: boolean, loose: boolean, onEdit: OnEdit }) {
  const { item, top, bottom, lane, lanes } = placed
  const style = {
    '--campus-block-top': top, '--campus-block-span': bottom - top, '--campus-block-lane': lane, '--campus-block-lanes': lanes,
  } as CSSProperties
  const odd = loose && item.kind === 'class' && item.weekPattern && item.weekPattern !== '每周' ? item.weekPattern : ''
  return (
    <Cell item={item} className="campus-block" style={style} onEdit={onEdit} data-kind={item.kind} data-live={live ? '' : undefined}>
      {item.kind !== 'class' && <span className="campus-block-time">{item.time}{KIND_LABEL[item.kind] && ` ${KIND_LABEL[item.kind]}`}</span>}
      <span className="campus-block-title">{item.title}</span>
      {item.sub && <span className="campus-block-sub">{item.sub}</span>}
      {odd && <span className="campus-block-sub">{odd}</span>}
    </Cell>
  )
}

/**
 * 钉在格子里的一张卡片：上面一行是「23:59 截止」或者「全天」，下面是名字（最多两行）。是哪门课，鼠标放上去看。
 * 交过的作业还在原来的位置，卡片变淡，上面一行换成绿色的「已完成」。
 */
function Pin({ pinned, onEdit }: { pinned: Pinned, onEdit: OnEdit }) {
  const { item, top } = pinned
  const when = item.done ? '✓ 已完成' : item.kind === 'due' ? `${item.time ?? ''} 截止`.trim() : item.time ? `${item.time}${KIND_LABEL[item.kind] && ` ${KIND_LABEL[item.kind]}`}` : '全天'
  return (
    <Cell item={item} className="campus-pin" style={{ '--campus-block-top': top } as CSSProperties} onEdit={onEdit} data-kind={item.kind} data-done={item.done ? '' : undefined}>
      <span className="campus-pin-when">{when}</span>
      <span className="campus-pin-title">{item.title}</span>
    </Cell>
  )
}

/** 表头里这一天的标记：放假、调休、补课。 */
function DayMark({ day }: { day: PlanDay }) {
  if (day.off) {
    const why = day.off.note || '放假'
    return <span className="campus-mark" data-kind="off" title={day.off.moved ? `${why}，这天的课挪到 ${monthDay(day.off.moved)} 上` : `${why}，停课`}>{why}</span>
  }
  if (day.swap) {
    const text = `上${WEEKDAY_NAMES[day.swap.weekday - 1]}的课`
    return <span className="campus-mark" data-kind="swap" title={`${day.swap.note || '调休'}：这天上 ${monthDay(day.swap.as)}（${WEEKDAY_NAMES[day.swap.weekday - 1]}）的课`}>{text}</span>
  }
  return null
}

/** expectTimetable：本科教务网的课表这时候该有（研究生、没填账号时没有，不说「还没读到」）。 */
function WeekGrid({ days, periods, today, clock, expectTimetable, onEdit }: { days: PlanDay[], periods: readonly Period[], today: string, clock: string, expectTimetable: boolean, onEdit: OnEdit }) {
  const placedDays = days.map(day => ({ day, ...place(day.items, periods) }))
  const nowRow = rowAt(clock, periods)
  const showNow = clock >= periods[0]!.startTime && clock <= periods.at(-1)!.endTime
  return (
    <div className="campus-grid" style={{ '--campus-periods': periods.length } as CSSProperties}>
      <div className="campus-grid-corner" />
      {days.map(day => (
        <div key={day.date} className="campus-grid-head" data-today={day.date === today ? '' : undefined} data-past={day.date < today ? '' : undefined}>
          <span className="campus-grid-dayline">
            <span className="campus-grid-weekday">{WEEKDAY_NAMES[day.weekday - 1]!.slice(1)}</span>
            <span className="campus-grid-date">{day.date === today ? '今天' : shortDate(day.date)}</span>
          </span>
          <DayMark day={day} />
        </div>
      ))}
      <div className="campus-grid-axis">
        {periods.map(period => (
          <div key={period.period} className="campus-grid-period">
            <span>{period.startTime}</span>
            <b>{period.period}</b>
          </div>
        ))}
      </div>
      {placedDays.map(({ day, grid, pins }) => {
        const isToday = day.date === today
        return (
          <div key={day.date} className="campus-grid-day" data-today={isToday ? '' : undefined} data-off={day.off ? '' : undefined} aria-label={`${monthDay(day.date)} ${WEEKDAY_NAMES[day.weekday - 1]}`}>
            {day.off && (
              <span className="campus-grid-offnote">
                {day.off.note || '放假'}<br />{day.off.moved ? `课挪到 ${shortDate(day.off.moved)}` : '停课'}
              </span>
            )}
            {grid.map((placed, index) => (
              <Block key={`${placed.item.kind}:${placed.item.title}:${placed.item.time ?? ''}:${index}`} placed={placed} loose={!!day.loose} onEdit={onEdit}
                live={isToday && !!placed.item.time && !!placed.item.end && placed.item.time <= clock && clock < placed.item.end} />
            ))}
            {pins.map((pinned, index) => <Pin key={`${pinned.item.kind}:${pinned.item.title}:${index}`} pinned={pinned} onEdit={onEdit} />)}
            {isToday && showNow && <span className="campus-grid-now" style={{ '--campus-block-top': nowRow } as CSSProperties} />}
            {expectTimetable && day.missing && grid.every(placed => placed.item.kind !== 'class') && <span className="campus-grid-missing">课表还没读到</span>}
          </div>
        )
      })}
    </div>
  )
}

/** 这一周在校历里是哪个学期第几周：看周一到周日里第一个在学期里的那天。 */
function weekLabel(days: PlanDay[]): string {
  const at = days.find(day => day.term)?.term
  return at ? `${at.term}学期第 ${at.week} 周` : ''
}

function handCalendar(snapshot: Snapshot | null): Promise<void> {
  const year = snapshot?.current?.slice(0, 9) ?? '这'
  return handToAssistant(`帮我把校历填进日程表：加载 zju-campus 技能，查本科生院公布的 ${year} 学年校历，和这学期的放假、调课通知，找出每个小学期第 1 周的周一、哪几天停课、哪天补课上哪天的课。先把要写的几条和原文链接列给我看，我确认了再用 campus_calendar_write 写进去。`)
}

/** 「日程」页签：顶上一行是哪一周、刷新、校历和「+」，下面是课表格子。onEdit 给的是自己加的日程的 id，新加一条时是 null。 */
function PlanView({ title, onCalendar, onEdit }: { title: ReactNode, onCalendar: () => void, onEdit: (id: string | null, date: string) => void }) {
  const { snapshot, busy, error } = useSyncExternalStore(subscribe, () => state)
  const now = useNow()
  const here = beijing(now)
  // 日期一律按北京时间算，和课表、截止时间用的是同一个钟。
  const today = here.date
  const monday = useSyncExternalStore(subscribe, () => shown) ?? mondayOf(today)
  const [handError, setHandError] = useState('')

  useEffect(() => {
    void visit()
    const refresh = () => { void visit() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [])

  const data: PlanData = snapshot ?? { calendar: { terms: [], days: [] }, timetables: {}, current: null, events: [] }
  const days = planDays(data, monday, addDays(monday, 6))
  // 这一周落在别的学期（比如冬学期）、那个学期的课表还没读过时，去教务网要那一个。
  const missing = [...new Set(days.map(day => day.missing).filter((key): key is string => !!key))]
  useEffect(() => {
    if (snapshot?.sources[0]?.state !== 'ready') return
    for (const key of missing) {
      if (asked.has(key)) continue
      asked.add(key)
      void load(`term:${key}`, { source: 'timetable', term: key })
    }
  }, [missing.join(','), snapshot?.sources[0]?.state])
  // 翻到别的大学期（比如春夏）时，去研究生教务网读那一个。
  useEffect(() => {
    if (snapshot) void Promise.all(loadGraduate(snapshot, monday))
  }, [semestersOf(days).join(','), snapshot?.graduate?.state])

  const reading = busy.length > 0
  const thisWeek = mondayOf(today)
  const source = snapshot?.sources[0]
  const known = !!snapshot?.current && snapshot.calendar.terms.some(term => `${term.year}|${term.term}` === snapshot.current)
  const label = weekLabel(days)
  const outside = known && !reading && days.every(day => !day.term) && !days.some(day => day.loose)
  const table = snapshot?.current ? snapshot.timetables[snapshot.current] : undefined
  const periods: readonly Period[] = table?.periodTimes?.length ? table.periodTimes : ZJU_PERIODS
  const unpublished = (snapshot?.unpublished ?? []).filter(year => days.some(day => day.date.startsWith(String(year))))

  const notices: ReactNode[] = []
  if (error) notices.push(<Alert key="error">{error}</Alert>)
  if (handError) notices.push(<Alert key="hand">{handError}</Alert>)
  // 「课程与学习」关着时不提：插件页上关着的行都不再说「关着」。研究生：本科教务网里没有他的课表和考试，引擎侧不去读（host/schedule.mjs 的 status）。
  if (source?.state === 'graduate') notices.push(<Alert key="account" tone="warn">研究生的考试安排在研究生院的系统里，现在还读不到。</Alert>)
  else if (source?.state === 'account') {
    notices.push(
      <Alert key="account" tone="warn">
        浙大统一身份认证的账号还没填，课表和考试读不到。
        <Button size="sm" variant="outline" onClick={() => { openRow(source.plugin) }}>去填账号</Button>
      </Alert>,
    )
  }
  for (const item of snapshot?.sources ?? []) {
    if (item.state === 'ready' && item.error) {
      notices.push(<Alert key={`source:${item.id}`} tone="warn">{item.name}这次没从教务网读到（{item.error}）{item.fetchedAt ? `，下面是${agoText(Date.parse(item.fetchedAt), now)}读到的。` : '。'}</Alert>)
    }
  }
  for (const key of semestersOf(days)) {
    const entry = snapshot?.graduate?.terms[key]
    if (snapshot?.graduate?.state === 'ready' && entry?.error && !busy.includes(`graduate:${key}`)) {
      notices.push(<Alert key={`graduate:${key}`} tone="warn">研究生课表这次没从研究生教务网读到（{entry.error}）{entry.fetchedAt ? `，下面是${agoText(Date.parse(entry.fetchedAt), now)}读到的。` : '。'}</Alert>)
    }
  }
  if (snapshot?.calendar.problem) notices.push(<Alert key="problem">{snapshot.calendar.problem}</Alert>)
  if (snapshot?.ownProblem) notices.push(<Alert key="own">{snapshot.ownProblem}</Alert>)
  if (snapshot?.current && !known) {
    notices.push(
      <div key="calendar" className="campus-plan-notice">
        <p>应用里还没有 {termName(snapshot.current)}的校历，课先照课表每周排上，没算单双周、放假和调休。填上第 1 周是哪天，课就按日期排。</p>
        <div className="campus-actions">
          <Button size="sm" variant="outline" onClick={onCalendar}>填校历</Button>
          <Button size="sm" variant="outline" onClick={() => { setHandError(''); handCalendar(snapshot).catch((reason: unknown) => { setHandError(errorText(reason)) }) }}>让助手查</Button>
        </div>
      </div>,
    )
  }
  for (const key of missing) {
    if (snapshot?.failed[key] && !busy.includes(`term:${key}`)) notices.push(<Alert key={`missing:${key}`} tone="warn">{termName(key)}的课表没读到：{snapshot.failed[key]}</Alert>)
  }

  return (
    <div className="campus-page campus-plan">
      <div className="campus-plan-head">
        {title}
        <div className="campus-plan-nav">
          <Button size="sm" variant="ghost" aria-label="上一周" icon={<IconChevronLeftOutlineRegular size={14} />} onClick={() => { setShown(addDays(monday, -7)) }} />
          <Button size="sm" variant="outline" disabled={monday === thisWeek} onClick={() => { setShown(thisWeek) }}>本周</Button>
          <Button size="sm" variant="ghost" aria-label="下一周" icon={<IconChevronRightOutlineRegular size={14} />} onClick={() => { setShown(addDays(monday, 7)) }} />
          <h2 className="campus-plan-range">
            {monthDay(monday)} – {monday.slice(5, 7) === addDays(monday, 6).slice(5, 7) ? `${+addDays(monday, 6).slice(8, 10)}日` : monthDay(addDays(monday, 6))}
            <span className="campus-plan-week">{label || (outside ? '不在教学周' : '')}</span>
          </h2>
        </div>
        <div className="campus-actions">
          <Button size="sm" variant="ghost" aria-label="刷新" className="campus-plan-refresh" data-busy={reading ? '' : undefined} disabled={reading}
            icon={<IconRefreshOutlineRegular size={14} />} onClick={() => { void visit(true) }} />
          <Button size="sm" variant="outline" onClick={onCalendar}>校历</Button>
          <Button size="sm" variant="ghost" aria-label="添加日程" icon={<IconPlusOutlineRegular size={14} />} disabled={!snapshot || !!snapshot.ownProblem}
            onClick={() => { onEdit(null, monday === thisWeek ? today : monday) }} />
        </div>
      </div>
      {notices.length > 0 && <div className="campus-plan-notices">{notices}</div>}
      <WeekGrid days={days} periods={periods} today={today} clock={here.time} expectTimetable={source?.state === 'ready'} onEdit={(id) => { onEdit(id, monday) }} />
      {unpublished.length > 0 && <p className="campus-note">{unpublished.join('、')} 年的放假安排还没公布。</p>}
    </div>
  )
}

// ── 校历 ──────────────────────────────────────────────

interface TermDraft { year: string, term: string, start: string, weeks: string }
interface DayDraft { date: string, kind: 'off' | 'swap', other: string, note: string }

const SOURCE_NAME: Record<DaySource, string> = { custom: '自己填的', school: '学校校历', national: '国家安排' }

function draftOf(calendar: Calendar): { terms: TermDraft[], days: DayDraft[] } {
  return {
    terms: calendar.terms.map(term => ({ year: term.year, term: term.term, start: term.start, weeks: String(term.weeks) })),
    days: calendar.days.map(day => ({ date: day.date, kind: day.as ? 'swap' as const : 'off' as const, other: day.as ?? day.until ?? '', note: day.note ?? '' })),
  }
}

/** 一个特殊的日子说成一句话：哪天、怎么上课。 */
function dayText(day: CalendarDay): string {
  const when = `${monthDay(day.date)}${day.until ? ` 到 ${monthDay(day.until)}` : `（${WEEKDAY_NAMES[weekdayOf(day.date) - 1]}）`}`
  if (day.as) return `${when} ${day.note || '调休'}，上 ${monthDay(day.as)}（${WEEKDAY_NAMES[weekdayOf(day.as) - 1]}）的课`
  return `${when} ${day.note || '放假'}，${day.moved ? `这天的课挪到 ${monthDay(day.moved)} 上` : '停课'}`
}

/**
 * 应用排进去的放假、调休和补课，从一个月前到一年后。同一天有好几条时只列算数的那一条；
 * 连着放假、同一个原因、课都不挪的几天并成一行。
 */
function knownDays(calendar: Calendar, today: string): CalendarDay[] {
  const first = new Map<string, CalendarDay>()
  for (const day of calendar.days) {
    if ((day.until ?? day.date) < addDays(today, -31) || day.date > addDays(today, 366) || first.has(day.date)) continue
    first.set(day.date, day)
  }
  const merged: CalendarDay[] = []
  for (const day of [...first.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = merged.at(-1)
    if (day.off && !day.moved && !day.until && last?.off && !last.moved && last.note === day.note && last.source === day.source && addDays(last.until ?? last.date, 1) === day.date) last.until = day.date
    else merged.push({ ...day })
  }
  return merged
}

function CalendarEditor({ snapshot, today, onBack, onSaved }: { snapshot: Snapshot | null, today: string, onBack: () => void, onSaved: () => void }) {
  const [initial] = useState(() => draftOf(snapshot?.custom ?? { terms: [], days: [] }))
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const leave = () => { if (JSON.stringify(draft) !== JSON.stringify(initial)) setLeaving(true); else onBack() }
  const setTerm = (index: number, patch: Partial<TermDraft>) => { setDraft(old => ({ ...old, terms: old.terms.map((item, i) => i === index ? { ...item, ...patch } : item) })) }
  const setDay = (index: number, patch: Partial<DayDraft>) => { setDraft(old => ({ ...old, days: old.days.map((item, i) => i === index ? { ...item, ...patch } : item) })) }
  const calendar = snapshot?.calendar ?? { terms: [], days: [] }
  const custom = snapshot?.custom ?? { terms: [], days: [] }
  const mine = (year: string, term: string) => custom.terms.some(item => item.year === year && item.term === term)
  const lastYear = draft.terms.at(-1)?.year ?? snapshot?.current?.slice(0, 9) ?? ''

  async function save() {
    setBusy(true); setError('')
    try {
      // 第 1 周还没填日期的那几行、没填日期的特殊日子不存。
      const terms = draft.terms.filter(item => item.start).map(item => ({ year: item.year.trim(), term: item.term, start: item.start, weeks: Number(item.weeks) || TERM_WEEKS }))
      const days = draft.days.filter(item => item.date).map(item => item.kind === 'swap'
        ? { date: item.date, as: item.other, note: item.note.trim() }
        : { date: item.date, off: true, ...(item.other ? { until: item.other } : {}), note: item.note.trim() })
      update({ snapshot: await campusApi<Snapshot>('calendar-save', { terms, days }) })
      onSaved()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }

  return (
    <div className="campus-page">
      <div className="campus-detail campus-calendar">
        <Crumb text="日程" onBack={leave} />
        <div className="campus-detail-main">
          <h1 className="campus-page-title">校历</h1>
        </div>
        {error && <Alert>{error}</Alert>}
        <section className="campus-section" aria-label="学期">
          <h2 className="campus-section-title">学期</h2>
          <ul className="campus-rows">
            {calendar.terms.map(term => (
              <li key={`${term.year}|${term.term}`} className="campus-row campus-calendar-known">
                <span className="campus-row-title">{term.year} {term.term}学期</span>
                <span>{monthDay(term.start)}（周一）起，{term.weeks} 周</span>
                <span className="campus-calendar-source">{mine(term.year, term.term) ? '自己填的' : '学校校历'}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="campus-section" aria-label="放假和调休">
          <h2 className="campus-section-title">放假、调休和补课</h2>
          <ul className="campus-rows">
            {knownDays(calendar, today).map(day => (
              <li key={`${day.date}:${day.source ?? ''}`} className="campus-row campus-calendar-known" data-past={(day.until ?? day.date) < today ? '' : undefined}>
                <span>{dayText(day)}</span>
                <span className="campus-calendar-source">{SOURCE_NAME[day.source ?? 'custom']}</span>
              </li>
            ))}
          </ul>
          {snapshot && snapshot.unpublished.length > 0 && <p className="campus-note">{snapshot.unpublished.join('、')} 年的放假安排还没公布。</p>}
        </section>
        <section className="campus-section" aria-label="自己补充">
          <div className="campus-section-head">
            <h2 className="campus-section-title">自己补充</h2>
            <div className="campus-actions">
              <Button size="sm" variant="ghost" icon={<IconPlusOutlineRegular size={14} />} disabled={busy}
                onClick={() => { setDraft(old => ({ ...old, days: [...old.days, { date: '', kind: 'off', other: '', note: '' }] })) }}>加一天</Button>
              <Button size="sm" variant="ghost" icon={<IconPlusOutlineRegular size={14} />} disabled={busy}
                onClick={() => { setDraft(old => ({ ...old, terms: [...old.terms, { year: lastYear, term: '', start: '', weeks: String(TERM_WEEKS) }] })) }}>加学期</Button>
            </div>
          </div>
          {draft.terms.length === 0 && draft.days.length === 0 && <p className="campus-note">没有。</p>}
          {draft.days.length > 0 && (
            <div className="campus-calendar-rows" data-kind="days">
              <span className="campus-calendar-label">日期</span><span className="campus-calendar-label">怎么安排</span>
              <span className="campus-calendar-label">停到哪天 / 上哪天的课</span><span className="campus-calendar-label">说明</span><span />
              {draft.days.map((item, index) => (
                <div key={index} className="campus-calendar-row">
                  <input className="campus-input" type="date" aria-label="日期" value={item.date} disabled={busy} onChange={(event) => { setDay(index, { date: event.target.value }) }} />
                  <select className="campus-input" aria-label="怎么安排" value={item.kind} disabled={busy} onChange={(event) => { setDay(index, { kind: event.target.value as DayDraft['kind'], other: '' }) }}>
                    <option value="off">停课</option>
                    <option value="swap">上另一天的课</option>
                  </select>
                  <input className="campus-input" type="date" aria-label={item.kind === 'swap' ? '上哪天的课' : '停到哪天（只停一天可以不填）'} value={item.other} disabled={busy}
                    onChange={(event) => { setDay(index, { other: event.target.value }) }} />
                  <input className="campus-input" aria-label="说明" placeholder={item.kind === 'swap' ? '如 运动会补课' : '如 校运动会'} maxLength={40} value={item.note} disabled={busy} onChange={(event) => { setDay(index, { note: event.target.value }) }} />
                  <Button size="sm" variant="ghost" aria-label="删除这一天" icon={<IconTrashOutlineRegular size={14} />} disabled={busy}
                    onClick={() => { setDraft(old => ({ ...old, days: old.days.filter((_, i) => i !== index) })) }} />
                </div>
              ))}
            </div>
          )}
          {draft.terms.length > 0 && (
            <div className="campus-calendar-rows" data-kind="terms">
              <span className="campus-calendar-label">学年</span><span className="campus-calendar-label">学期</span>
              <span className="campus-calendar-label">第 1 周的周一</span><span className="campus-calendar-label">周数</span><span />
              {draft.terms.map((item, index) => (
                <div key={index} className="campus-calendar-row">
                  <input className="campus-input" aria-label="学年" placeholder="2027-2028" value={item.year} disabled={busy} onChange={(event) => { setTerm(index, { year: event.target.value }) }} />
                  <select className="campus-input" aria-label="学期" value={item.term} disabled={busy} onChange={(event) => { setTerm(index, { term: event.target.value }) }}>
                    <option value="" disabled>选择</option>
                    {TERM_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <input className="campus-input" type="date" aria-label="第 1 周的周一" value={item.start} disabled={busy} onChange={(event) => { setTerm(index, { start: event.target.value }) }} />
                  <input className="campus-input" type="number" min={1} max={30} aria-label="周数" value={item.weeks} disabled={busy} onChange={(event) => { setTerm(index, { weeks: event.target.value }) }} />
                  <Button size="sm" variant="ghost" aria-label="删除这个学期" icon={<IconTrashOutlineRegular size={14} />} disabled={busy}
                    onClick={() => { setDraft(old => ({ ...old, terms: old.terms.filter((_, i) => i !== index) })) }} />
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="campus-form-foot">
          <button type="button" className="campus-save" disabled={busy} onClick={() => { void save() }}>保存</button>
          <button type="button" className="campus-cancel" disabled={busy} onClick={leave}>取消</button>
          <span className="campus-plan-foot-gap" />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { handCalendar(snapshot).catch((reason: unknown) => { setError(errorText(reason)) }) }}>让助手查学校通知</Button>
        </div>
      </div>
      <Modal open={leaving} title="放弃这次修改？" description="还没有保存的内容会丢掉。" closeLabel="关闭" onClose={() => { setLeaving(false) }}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setLeaving(false) }}>继续编辑</Button>
            <Button className="campus-danger" onClick={onBack}>放弃修改</Button>
          </>
        )} />
    </div>
  )
}

// ── 自己加的日程 ──────────────────────────────────────

interface EventDraft { id?: string, title: string, date: string, time: string, end: string, place: string, kind: OwnKind, until: string }

const KIND_OPTIONS: readonly { value: OwnKind, label: string }[] = [{ value: 'event', label: '日程' }, { value: 'class', label: '课' }]

/** 新加或修改一条自己的日程：名字、哪天几点到几点、在哪、是日程还是课、每周重复到哪天。改的时候能删。 */
function EventEditor({ item, date, onClose, onDone }: { item: OwnEvent & { id: string } | null, date: string, onClose: () => void, onDone: (text: string) => void }) {
  const [draft, setDraft] = useState<EventDraft>(() => item
    ? { id: item.id, title: item.title, date: item.date, time: item.time ?? '', end: item.end ?? '', place: item.place ?? '', kind: item.kind, until: item.until ?? '' }
    : { title: '', date, time: '', end: '', place: '', kind: 'event', until: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<EventDraft>) => { setDraft(old => ({ ...old, ...patch })) }

  async function run(work: () => Promise<Snapshot>, text: string) {
    setBusy(true); setError('')
    try { update({ snapshot: await work() }); onDone(text) } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const save = () => run(() => campusApi<Snapshot>('schedule-event-save', draft), item ? '日程已修改' : '日程已添加')
  const remove = () => run(() => campusApi<Snapshot>('schedule-event-remove', { id: item!.id }), '日程已删除')

  return (
    <Modal open title={item ? '修改日程' : '添加日程'} closeLabel="关闭" onClose={() => { if (!busy) onClose() }}
      footer={
        <div className="campus-event-foot">
          {item && <Button variant="ghost" icon={<IconTrashOutlineRegular size={14} />} disabled={busy} onClick={() => { void remove() }}>删除</Button>}
          <span className="campus-plan-foot-gap" />
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy || !draft.title.trim() || !draft.date} onClick={() => { void save() }}>保存</Button>
        </div>
      }>
      <form className="campus-event-form" onSubmit={(event) => { event.preventDefault(); if (draft.title.trim() && draft.date) void save() }}>
        {error && <Alert>{error}</Alert>}
        <div className="campus-event-wide">
          <Field id="campus-event-title" label="名称">
            <input id="campus-event-title" className="campus-input" data-modal-autofocus placeholder="如 组会" maxLength={60} value={draft.title} disabled={busy}
              onChange={(event) => { set({ title: event.target.value }) }} />
          </Field>
        </div>
        <Field id="campus-event-date" label="日期">
          <input id="campus-event-date" className="campus-input" type="date" value={draft.date} disabled={busy} onChange={(event) => { set({ date: event.target.value }) }} />
        </Field>
        <Field id="campus-event-until" label="每周重复到">
          <input id="campus-event-until" className="campus-input" type="date" min={draft.date || undefined} value={draft.until} disabled={busy}
            onChange={(event) => { set({ until: event.target.value }) }} />
        </Field>
        <Field id="campus-event-time" label="开始">
          <input id="campus-event-time" className="campus-input" type="time" value={draft.time} disabled={busy} onChange={(event) => { set({ time: event.target.value }) }} />
        </Field>
        <Field id="campus-event-end" label="结束">
          <input id="campus-event-end" className="campus-input" type="time" value={draft.end} disabled={busy || !draft.time} onChange={(event) => { set({ end: event.target.value }) }} />
        </Field>
        <Field id="campus-event-place" label="地点">
          <input id="campus-event-place" className="campus-input" maxLength={40} value={draft.place} disabled={busy} onChange={(event) => { set({ place: event.target.value }) }} />
        </Field>
        <Field id="campus-event-kind" label="种类">
          <select id="campus-event-kind" className="campus-input" value={draft.kind} disabled={busy} onChange={(event) => { set({ kind: event.target.value as OwnKind }) }}>
            {KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ── 整页 ──────────────────────────────────────────────

/** 日程表这一页：一周的课表格子，校历另开一屏改，自己的日程在弹框里加和改。官方的「自动化任务」在侧栏另有一项，这里不放。 */
export function SchedulePage() {
  const [screen, setScreen] = useState<'week' | 'calendar'>('week')
  const [toast, setToast] = useState<{ text: string, seq: number } | null>(null)
  /** 正在加或改的那条：id 为 null 是新加，date 是新加时默认的日期。 */
  const [editing, setEditing] = useState<{ id: string | null, date: string } | null>(null)
  const snapshot = useSyncExternalStore(subscribe, () => state.snapshot)
  const say = (text: string) => { setToast(old => ({ text, seq: (old?.seq ?? 0) + 1 })) }

  const editingItem = editing?.id ? snapshot?.own.find(item => item.id === editing.id) ?? null : null

  if (screen === 'calendar') {
    return (
      <div className="campus-schedule">
        <CalendarEditor snapshot={snapshot} today={beijing(Date.now()).date} onBack={() => { setScreen('week') }}
          onSaved={() => { setScreen('week'); say('校历已保存') }} />
      </div>
    )
  }
  return (
    <div className="campus-schedule">
      <PlanView title={<h1 className="campus-page-title">日程表</h1>} onCalendar={() => { setScreen('calendar') }} onEdit={(id, date) => { setEditing({ id, date }) }} />
      {editing && (editing.id === null || editingItem) && (
        <EventEditor key={editing.id ?? 'new'} item={editingItem} date={editing.date} onClose={() => { setEditing(null) }}
          onDone={(text) => { setEditing(null); say(text) }} />
      )}
      {toast && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    </div>
  )
}

export function CalendarIcon({ size }: { size: number, active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3.5v3M16 3.5v3M4 10h16M8 13.5h2M14 13.5h2M8 16.5h2" />
    </svg>
  )
}
