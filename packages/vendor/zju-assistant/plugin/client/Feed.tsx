/**
 * 校园事务页右边的通知，一块区域两个页签：
 *   校园通知  学校各部门和本人学院的通知、跟踪的公众号的新文章、二课平台上新出的活动，和监控的微信、钉钉群里的消息。
 *   个人消息  监控的微信、钉钉个人聊天，浙大邮箱的新来信，CC98 上本人收到的回复、@、系统消息和未读私信的摘要。
 * 一条在哪个页签由引擎按来源和聊天类型定（host/feed.mjs 的 viewOf），这里只照着分。按时间从新到旧，默认只看一周内的，先露出几条，其余的展开看。
 * 页签同一行的右边是「筛选」：点开的小面板贴着按钮下沿、靠右弹出，盖在列表上面，不挤动列表；里面选来源和时间。
 * 来源只列当前页签里接上了的那几种，换页签时选着的来源清掉。点外面、按 Esc 或「完成」收起，Esc 收起后焦点回到按钮；
 * 点外面收起不会吞掉那一下点击，点别的通知、换页签照常生效。
 * 和这位学生关系不大的校园通知（标题里有屏蔽词，或者模型照个人档案判断的）默认收起，列表下面一行说有几条，点开还在；个人消息不收。
 * 和左边的作业一样，打开时先照上一次读到的画，后台再去读新的；上次来过之后新出现、还没点开看过的，标题前带一个点。
 * 点一条在这一栏原位看详情（NoticeContent.tsx），右边的图标加到左栏备忘录（直接添加或 AI 总结后添加）。
 * 页签、筛选和点开的那一条放在组件外面：打开备忘录再回来，还在原来的页签和那一条上。
 * 数据和缓存在引擎侧的 host/feed.mjs，加到备忘录在 host/notice-memo.mjs。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconListPenOutlineRegular, IconLoadingOutlineRegular,
  IconPlusOutlineRegular, IconSparkleRegular, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Flow } from './Flow.tsx'
import { NoticeDetail } from './NoticeContent.tsx'
import type { Message } from './ChatSettings.tsx'
import type { NoticeMemos } from './Memos.tsx'
import { openRow, rowTitle } from './campus.ts'
import { DAY, agoText, clock, dateText, midnight, mixed } from './when.ts'

type Tab = 'campus' | 'personal'
/** dated 为假的只有日期（学校通知），at 是那天零点。foundAt 是应用第一次读到它的时间。view 是它在哪个页签。 */
interface Item {
  id: string, kind: 'school' | 'wechat' | 'sztz' | 'chat' | 'mail' | 'cc98', view: Tab, title: string, from: string, at: string, dated: boolean, url: string, foundAt: string | null
  /** 只有二课活动有：报名的起止。at 是它出现的时间（第一次读到，或者后来开始报名的时候）。 */
  opens?: string | null, closes?: string
  platform?: 'wechat' | 'dingtalk', chatKind?: 'personal' | 'group' | null, mode?: 'original' | 'summary', body?: string, originals?: Message[], summaryError?: string
  /** 聊天 AI 整理出来的一个事项（已经拆好了几项，加到备忘录时直接用），和它核对过的截止：带时区的时刻，或只有日期。 */
  matter?: Record<string, string>, deadline?: string | null
  /** CC98 消息是哪一类。 */
  cc98Kind?: 'reply' | 'at' | 'system' | 'message'
  /** 该不该收起：blocked 标题里有屏蔽词，irrelevant 模型判断关系不大，null 不收起。 */
  hidden: 'blocked' | 'irrelevant' | null
}
/** state：ready 能读，account 账号还没填（邮箱是还没连接），off 插件关着。plugin 是去插件页的哪一项处理。views 是它的消息在哪几个页签。 */
interface Source {
  id: string, kind?: string, name: string, state: 'ready' | 'account' | 'off', plugin: string, fetchedAt: string | null, error: string | null, views?: Tab[]
}
interface Snapshot { items: Item[], sources: Source[] }
/** 右栏怎么看：哪个页签、多久以内、哪个来源（all 是全部）、展开了没有、收起的那些展开了没有、点开的是哪一条。 */
interface View { tab: Tab, range: Range, source: string, expanded: boolean, unfolded: boolean, detail: string }
/** adding 是正在加进备忘录的那几条的编号（要总结的要等一阵）。 */
interface State { snapshot: Snapshot | null, busy: boolean, error: string, adding: readonly string[], view: View }

/** 默认只看这么久以内发的。 */
const RECENT_MS = 7 * DAY
const RANGES = [{ value: 'recent', label: '一周内' }, { value: 'all', label: '全部时间' }] as const
type Range = typeof RANGES[number]['value']
const TABS = [{ value: 'campus', label: '校园通知', noun: '校园通知' }, { value: 'personal', label: '个人消息', noun: '个人消息' }] as const
/** 先露出这么多条，其余的点「展开」。只是一屏画多少，不是后台留多少。 */
const LIMIT = 8
/** 筛选里每个来源在两个页签里各叫什么：同一个微信聊天插件，群里的在校园通知叫「微信群」，私聊在个人消息叫「微信」。 */
const SOURCE_LABELS: Record<Tab, Record<string, string>> = {
  campus: { school: '学校通知', wechat: '公众号', sztz: '二课', 'wechat-chat': '微信群', 'dingtalk-chat': '钉钉群' },
  personal: { mail: '邮箱', cc98: 'CC98', 'wechat-chat': '微信', 'dingtalk-chat': '钉钉' },
}
/** 一行里来源那一格前面的小标签。学校通知不带。 */
const BADGES: Record<string, string> = { wechat: '公众号', sztz: '二课', 'wechat-chat': '微信', 'dingtalk-chat': '钉钉', mail: '邮箱', cc98: 'CC98' }
/** 上一次看这一栏是什么时候，记在本机；比它晚出现的算新的。点开看过的另记一份，也不再算新的。 */
const SEEN_KEY = 'campus.feedSeenAt', OPENED_KEY = 'campus.feedOpened', OPENED_MAX = 500

/** 状态放在组件外面：离开这一页再回来直接照上一次的画，正在进行的读取也不会断，页签和点开的那一条也还在。 */
let state: State = { snapshot: null, busy: false, error: '', adding: [], view: { tab: 'campus', range: 'recent', source: 'all', expanded: false, unfolded: false, detail: '' } }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const update = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener() }
const look = (patch: Partial<View>) => { update({ view: { ...state.view, ...patch } }) }

/** 进页面、回到窗口、点刷新时调用。先拿缓存，再让后台去读新的；刚读过的后台自己会跳过，force 时照读。 */
export async function visitFeed(force = false): Promise<void> {
  let snapshot: Snapshot
  try { snapshot = await campusApi<Snapshot>('feed-read') } catch (error) { update({ error: errorText(error) }); return }
  update({ snapshot, error: '' })
  // 后台这一趟：各来源到点了就读新的，点刷新时连公众号和聊天一起催，再把没筛过的筛一遍。一个来源都读不了就不用去。
  if (state.busy || !snapshot.sources.some(source => source.state === 'ready')) return
  update({ busy: true })
  try { update({ snapshot: await campusApi<Snapshot>('feed-refresh', { force }) }) }
  catch (error) { update({ error: errorText(error) }) }
  finally { update({ busy: false }) }
}

/** 托盘上点了邮箱、CC98 的新消息（alerts.ts）：右栏切到那个页签的列表，来源回到全部。 */
export function showFeedTab(tab: Tab): void {
  look({ tab, source: 'all', expanded: false, unfolded: false, detail: '' })
}

/** 通知那一栏现在是不是在读，给页面右上角的刷新按钮用。 */
export function useFeedBusy(): boolean {
  return useSyncExternalStore(subscribe, () => state.busy)
}

const itemKey = (item: Item) => item.id
const sourceOf = (item: Item) => item.kind === 'chat' ? `${item.platform}-chat` : item.kind
/** 一条通知在备忘录里靠什么认，和引擎侧 notice-memo.mjs 的 memoKey 一样。 */
const memoKey = (item: Item) => item.kind === 'cc98' || !item.url ? item.id : item.url
const pluginTitle = rowTitle

function readOpened(): string[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]'); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}

/**
 * 时间那一格。通知和文章写哪天发的：今天、昨天，再早写日期；带时刻的当天写上几点。
 * 二课活动写的是报名的事（at 是那个时刻）：还没开始报名的写哪天开始，开始了的写报名到哪天。
 * 平台上截止时间写成某天零点的，是前一天结束。
 */
function when(item: Item, now: number): { text: string, at: string } {
  if (item.kind === 'sztz' && item.closes) {
    const opens = Date.parse(item.opens ?? ''), closes = Date.parse(item.closes)
    if (opens > now) return { text: `${dateText(opens, now)} 开始报名`, at: item.opens! }
    const end = new Date(closes), wholeDay = end.getHours() === 0 && end.getMinutes() === 0, day = wholeDay ? closes - 1 : closes
    if (midnight(day) !== midnight(now)) return { text: `报名到 ${dateText(day, now)}`, at: item.closes }
    return { text: wholeDay ? '今天截止' : `今天 ${clock(end)} 截止`, at: item.closes }
  }
  const at = Date.parse(item.at), days = Math.round((midnight(now) - midnight(at)) / DAY)
  if (days === 0) return { text: item.dated ? `今天 ${clock(new Date(at))}` : '今天', at: item.at }
  return { text: days === 1 ? '昨天' : dateText(at, now), at: item.at }
}

/** 来源那一格：学校通知只写哪个部门，别的前面一枚小标签（公众号、二课、微信……），后面是号名、群名或发件人。 */
function Origin({ item }: { item: Item }) {
  if (item.kind === 'school') return <span>{item.from}</span>
  const source = sourceOf(item)
  return <span className="campus-notice-account" data-kind={item.kind}><span>{BADGES[source] ?? '消息'}</span>{item.from}</span>
}

/**
 * 一行右边的「加到备忘录」：点开两个选项，直接添加，或者先让模型总结。AI 整理过的聊天事项（direct）已经整理好了，点了直接加。
 * 已经加过的（memo 是那条备忘的标题）换成一个勾，点它打开那条备忘；正在加的转圈，点不了。
 */
function MemoButton({ memo, busy, direct, onAdd, onOpen }: { memo: string, busy: boolean, direct: boolean, onAdd: (summarize: boolean) => void, onOpen: () => void }) {
  const [choosing, setChoosing] = useState(false)
  const label = busy ? '正在加到备忘录' : memo ? '已在备忘录里，点开看' : '加到备忘录'
  return (
    <Menu
      open={choosing && !memo && !busy}
      onClose={() => { setChoosing(false) }}
      items={[
        { id: 'plain', label: '直接添加', icon: <IconPlusOutlineRegular size={14} /> },
        { id: 'summary', label: 'AI 总结后添加', icon: <IconSparkleRegular size={14} /> },
      ]}
      onSelect={(id) => { setChoosing(false); onAdd(id === 'summary') }}
      align="end"
      portal
      anchor={(
        <Tooltip label={label} side="top" portal>
          <Button className="campus-hand" size="sm" variant="outline" aria-label={label} aria-busy={busy} disabled={busy} data-added={memo ? '' : undefined}
            {...(memo || direct ? {} : { 'aria-haspopup': 'menu' as const, 'aria-expanded': choosing })}
            icon={busy ? <IconLoadingOutlineRegular size={14} /> : memo ? <IconCheckOutlineRegular size={14} /> : <IconListPenOutlineRegular size={14} />}
            onClick={() => { if (memo) onOpen(); else if (direct) onAdd(false); else setChoosing(old => !old) }} />
        </Tooltip>
      )}
    />
  )
}

/** 一条通知。整行点开详情，右边「加到备忘录」的图标保留自己的点击；fresh 的标题前带一个点。 */
function NoticeRow({ item, now, fresh, memo, adding, onMemo, onOpenMemo, onOpen }: {
  item: Item, now: number, fresh: boolean, memo: string, adding: boolean, onMemo: (summarize: boolean) => void, onOpenMemo: () => void, onOpen: () => void
}) {
  const time = when(item, now)
  return (
    <article className="campus-notice" data-new={fresh ? '' : undefined} data-folded={item.hidden ? '' : undefined}>
      <div className="campus-notice-main">
        <button type="button" className="campus-notice-open campus-chat-open" onClick={onOpen}>
          {fresh && <span className="campus-sr">未读，</span>}{item.title}
        </button>
        <span className="campus-notice-meta">
          <Origin item={item} />
          <time dateTime={time.at}>{time.text}</time>
          {item.mode === 'summary' && <span>AI 整理</span>}
        </span>
      </div>
      <MemoButton memo={memo} busy={adding} direct={Boolean(item.matter)} onAdd={onMemo} onOpen={onOpenMemo} />
    </article>
  )
}

/**
 * 「筛选」和它的小面板。面板锚在按钮上（position: absolute，靠右），盖在列表上面。
 * 收起：点外面（不拦那一下点击）、焦点移到外面、Esc（焦点回到按钮）、「完成」（焦点回到按钮）。
 */
function FeedFilter({ tab, range, source, sources, onRange, onSource }: {
  tab: Tab, range: Range, source: string, sources: readonly { value: string, label: string }[]
  onRange: (next: Range) => void, onSource: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const close = (focus: boolean) => { setOpen(false); if (focus) button.current?.focus({ preventScroll: true }) }
  // 换页签时面板收起。
  useEffect(() => { setOpen(false) }, [tab])
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    const outside = (target: EventTarget | null) => target instanceof Node && !anchor.current?.contains(target)
    // 用捕获阶段收起，但不拦下这一下：点的是别的通知、别的页签，照常生效。
    const down = (event: PointerEvent) => { if (outside(event.target)) setOpen(false) }
    const focus = (event: FocusEvent) => { if (outside(event.target)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('focusin', focus)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])
  const picked = [source !== 'all' ? sources.find(option => option.value === source)?.label : '', range !== 'recent' ? RANGES.find(option => option.value === range)!.label : ''].filter(Boolean)
  /** 一组单选：上下左右键在组里挪，和系统的单选按钮一样。 */
  const group = (label: string, value: string, options: readonly { value: string, label: string }[], pick: (next: string) => void) => (
    <div className="campus-feed-filter-group" role="radiogroup" aria-label={label}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const at = options.findIndex(option => option.value === value), next = options[(at + step + options.length) % options.length]!
        pick(next.value)
        requestAnimationFrame(() => { panel.current?.querySelector<HTMLElement>(`[data-option="${CSS.escape(`${label}:${next.value}`)}"]`)?.focus() })
      }}>
      <span className="campus-feed-filter-label">{label}</span>
      <div className="campus-feed-filter-options">
        {options.map(option => (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1}
            data-option={`${label}:${option.value}`} onClick={() => { pick(option.value) }}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="campus-feed-filter-anchor" ref={anchor}>
      <button ref={button} type="button" className="campus-feed-filter" aria-haspopup="dialog" aria-expanded={open} aria-controls="campus-feed-filter-panel"
        data-active={picked.length ? '' : undefined} onClick={() => { setOpen(old => !old) }}>
        <span>{picked.length ? picked.join(' · ') : '筛选'}</span>
        <IconChevronDownOutlineRegular size={14} />
      </button>
      {open && (
        <div className="campus-feed-filter-panel" id="campus-feed-filter-panel" role="dialog" aria-label="筛选通知" ref={panel}>
          {sources.length > 1 && group('来源', source, [{ value: 'all', label: '全部来源' }, ...sources], onSource)}
          {group('时间', range, RANGES, next => { onRange(next as Range) })}
          <div className="campus-feed-filter-foot">
            <Button size="sm" variant="outline" onClick={() => { close(true) }}>完成</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function FeedColumn({ now, memos }: { now: number, memos: NoticeMemos }) {
  const { snapshot, busy, error, adding, view } = useSyncExternalStore(subscribe, () => state)
  const { tab, range, source, expanded, unfolded, detail } = view
  // 进这一栏之前上一次是什么时候看的；这一次看完（离开页面）再记成现在。第一次来没有记录，都不算新的。
  const [seenAt] = useState(() => Date.parse(localStorage.getItem(SEEN_KEY) ?? ''))
  useEffect(() => () => { localStorage.setItem(SEEN_KEY, new Date().toISOString()) }, [])
  const [opened, setOpened] = useState<readonly string[]>(readOpened)
  const markOpened = (id: string) => {
    if (opened.includes(id)) return
    const next = [...opened, id].slice(-OPENED_MAX)
    setOpened(next)
    try { localStorage.setItem(OPENED_KEY, JSON.stringify(next)) } catch { /* 记不下就算了，只是少了一个点 */ }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { campusApi<Snapshot>('feed-read').then(snapshot => update({ snapshot }), () => {}) }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  const sources = snapshot?.sources ?? []
  const inTab = (entry: Source, which: Tab) => (entry.views ?? ['campus']).includes(which)
  // 插件页上关着的行，它的来源不算；一个页签里的来源都关着时不显示这个页签，两个都关着时整栏不显示。
  const tabs = snapshot ? TABS.filter(option => sources.some(entry => inTab(entry, option.value) && entry.state !== 'off')) : TABS
  useEffect(() => { if (tabs.length && !tabs.some(option => option.value === tab)) look({ tab: tabs[0]!.value, source: 'all', expanded: false, unfolded: false, detail: '' }) }, [tabs, tab])
  const items = snapshot?.items
  // 时间范围以内、没有收起的：页签上的数字就是这个，两个页签一个算法。
  const within = useMemo(() => (items ?? []).filter(item => range === 'all' || now - Date.parse(item.at) <= RECENT_MS), [items, range, now])
  const counts = useMemo(() => Object.fromEntries(TABS.map(option => [option.value, within.filter(item => item.view === option.value && !item.hidden).length])) as Record<Tab, number>, [within])
  // 来源只列这个页签里接上了的；选着的后来被关掉了，就当作选的是全部。
  const options = Object.entries(SOURCE_LABELS[tab]).filter(([id]) => sources.some(entry => entry.id === id && entry.state === 'ready' && inTab(entry, tab))).map(([value, label]) => ({ value, label }))
  const picked = options.some(option => option.value === source) ? source : 'all'
  const ofTab = useMemo(() => (items ?? []).filter(item => item.view === tab && (picked === 'all' || sourceOf(item) === picked)), [items, tab, picked])
  const inRange = useMemo(() => ofTab.filter(item => range === 'all' || now - Date.parse(item.at) <= RECENT_MS), [ofTab, range, now])
  const folded = inRange.filter(item => item.hidden).length
  const shown = unfolded ? inRange : inRange.filter(item => !item.hidden)
  const hidden = shown.length - LIMIT
  const fresh = (item: Item) => Number.isFinite(seenAt) && Date.parse(item.foundAt ?? item.at) > seenAt && !opened.includes(item.id)
  // 加到备忘录：做完（成了、退回直接添加了、本来就在）由备忘录那边在窗口顶上提示；这里只管转不转圈，和请求本身没发成时的那句话。
  const addMemo = (item: Item, summarize: boolean) => {
    update({ adding: [...state.adding, item.id], error: '' })
    memos.add(item.id, summarize)
      .catch((reason: unknown) => { update({ error: errorText(reason) }) })
      .finally(() => { update({ adding: state.adding.filter(id => id !== item.id) }) })
  }
  const open = (item: Item) => { markOpened(item.id); look({ detail: item.id }) }
  const tabLabel = TABS.find(option => option.value === tab)!.label

  // 点开的那一条后来不在列表里了（插件关了、账号换了）：回到列表。
  const current = detail ? items?.find(item => item.id === detail) : undefined
  useEffect(() => { if (detail && items && !current) look({ detail: '' }) }, [detail, items, current])

  // 这个页签里的来源各自的情况：没填账号、这次没读到。只说用户能做点什么的那几样。插件页上关着的行不提，它的来源整个不出现。
  const notes: { key: string, text: string, action: string, onClick: () => void }[] = []
  for (const entry of sources.filter(item => inTab(item, tab))) {
    // 聊天和公众号的问题要到插件页里处理；别的来源是这次没读到，可以再试一次。
    const settle = entry.kind === 'chat' || entry.id === 'wechat'
    if (entry.state === 'account') notes.push({ key: entry.id, text: entry.id === 'mail' ? '浙大邮箱还没连接，读不到新来信。' : mixed(`「${pluginTitle(entry.plugin)}」还没填好，读不到${entry.name}的消息。`), action: entry.id === 'mail' ? '去连接' : '去填写', onClick: () => { openRow(entry.plugin) } })
    else if (entry.state === 'ready' && entry.error && (settle || !busy)) {
      // 冒号后面的原因是系统给的原话，不动它。
      const lead = entry.id === 'wechat' ? '' : entry.kind === 'chat' ? `${entry.name}：` : entry.fetchedAt ? `${entry.name}这次没读到，上面的还是${agoText(Date.parse(entry.fetchedAt), now)}读到的：` : `${entry.name}没读到：`
      notes.push({ key: entry.id, text: mixed(lead) + `${entry.error.replace(/[。.]$/, '')}。`, action: settle ? '去处理' : '再试一次', onClick: () => { if (settle) openRow(entry.plugin); else void visitFeed(true) } })
    }
  }

  // 列表空着的时候说清楚是哪一种空：真的没有、还在第一次读、还是根本没法读（下面另有说明）。
  const readable = sources.some(entry => entry.state === 'ready' && inTab(entry, tab))
  let empty = ''
  if (snapshot && shown.length === 0) {
    const noun = picked === 'all' ? TABS.find(option => option.value === tab)!.noun : `来自${SOURCE_LABELS[tab][picked]}的消息`
    const earlier = ofTab.filter(item => unfolded || !item.hidden).length - shown.length
    // 要去系统里读的来源（不算聊天和公众号，它们有自己的定时）一个都还没读过：是第一次读。
    const fetching = sources.filter(entry => entry.state === 'ready' && inTab(entry, tab) && entry.kind !== 'chat' && entry.id !== 'wechat')
    const first = fetching.length > 0 && fetching.every(entry => !entry.fetchedAt && !entry.error)
    if (!readable) empty = tab === 'personal' ? '个人消息的来源都没有接上。' : '校园通知的来源都没有接上。'
    else if (busy && first) empty = '第一次读取，要等一会儿。'
    else empty = range === 'all' ? `没有${noun}。` : earlier > 0 ? `一周内没有${noun}，更早的还有 ${earlier} 条。` : `一周内没有${noun}。`
  }

  const memoOf = (item: Item) => memos.titleOf(memoKey(item))
  if (!tabs.length) return null
  return (
    <section className="campus-section campus-feed" aria-label="通知">
      <div className="campus-section-head">
        <h2 className="campus-section-title">通知</h2>
      </div>
      {current ? (
        <NoticeDetail key={current.id} id={current.id} title={current.title} back={tabLabel}
          meta={<><Origin item={current} /><time dateTime={when(current, now).at}>{when(current, now).text}</time></>}
          memo={memoOf(current)} adding={adding.includes(current.id)} direct={Boolean(current.matter)}
          onBack={() => { look({ detail: '' }) }} onMemo={(summarize) => { addMemo(current, summarize) }} onOpenMemo={() => { memos.open(memoOf(current)) }} />
      ) : (
        <>
          <div className="campus-feed-toolbar">
            <div className="campus-feed-tabs" role="tablist" aria-label="通知类别">
              {tabs.map(option => (
                <button key={option.value} type="button" role="tab" id={`campus-feed-tab-${option.value}`} aria-selected={tab === option.value} aria-controls="campus-feed-panel"
                  tabIndex={tab === option.value ? 0 : -1}
                  onClick={() => { if (tab !== option.value) look({ tab: option.value, source: 'all', expanded: false, unfolded: false }) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    const next = tabs.find(other => other.value !== option.value)?.value
                    if (!next) return
                    look({ tab: next, source: 'all', expanded: false, unfolded: false })
                    requestAnimationFrame(() => { document.getElementById(`campus-feed-tab-${next}`)?.focus() })
                  }}>
                  {option.label}
                  {snapshot && <span className="campus-count" title={`${RANGES.find(entry => entry.value === range)!.label}的条目数`}>{counts[option.value]}</span>}
                </button>
              ))}
            </div>
            <FeedFilter tab={tab} range={range} source={picked} sources={options}
              onRange={(next) => { look({ range: next, expanded: false }) }} onSource={(next) => { look({ source: next, expanded: false }) }} />
          </div>
          <div id="campus-feed-panel" role="tabpanel" aria-labelledby={`campus-feed-tab-${tab}`} className="campus-feed-panel">
            {error && <p className="campus-note campus-task-note"><span>{error}</span></p>}
            {picked !== 'all' && shown.length > 0 && (
              <p className="campus-note campus-task-note">
                <span>只看{SOURCE_LABELS[tab][picked]}：{shown.length} 条。</span>
                <button type="button" className="campus-textlink" onClick={() => { look({ source: 'all', expanded: false }) }}>看全部来源</button>
              </p>
            )}
            {snapshot && (
              // 条数多了跟着整页滚动，不另开滚动框。换页签、换时间、换来源都是换了一份列表，整个重画，不放进出的动画。
              <div className="campus-notice-list" key={`${tab}:${range}:${picked}`}>
                <Flow items={shown} keyOf={itemKey} limit={expanded ? Infinity : LIMIT} label="通知">
                  {(item) => {
                    const memo = memoOf(item)
                    return (
                      <NoticeRow item={item} now={now} fresh={fresh(item)} memo={memo} adding={adding.includes(item.id)}
                        onMemo={(summarize) => { addMemo(item, summarize) }} onOpenMemo={() => { memos.open(memo) }} onOpen={() => { open(item) }} />
                    )
                  }}
                </Flow>
              </div>
            )}
            {hidden > 0 && (
              <Button className="campus-more" variant="ghost" size="sm" aria-expanded={expanded}
                icon={expanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />} onClick={() => { look({ expanded: !expanded }) }}>
                {expanded ? '收起' : `展开其余 ${hidden} 条`}
              </Button>
            )}
            {empty && <p className="campus-task-empty">{empty}</p>}
            {folded > 0 && (
              <p className="campus-note campus-task-note">
                <span>{unfolded ? `其中 ${folded} 条和你关系不大。` : `另有 ${folded} 条和你关系不大，已收起。`}</span>
                <button type="button" className="campus-textlink" aria-expanded={unfolded} onClick={() => { look({ unfolded: !unfolded }) }}>{unfolded ? '收起' : '展开'}</button>
              </p>
            )}
            {notes.map(note => <Note key={note.key} text={note.text} action={note.action} onClick={note.onClick} />)}
          </div>
        </>
      )}
    </section>
  )
}

function Note({ text, action, onClick }: { text: ReactNode, action: string, onClick: () => void }) {
  return (
    <p className="campus-note campus-task-note">
      <span>{text}</span>
      <button type="button" className="campus-textlink" onClick={onClick}>{action}</button>
    </p>
  )
}
