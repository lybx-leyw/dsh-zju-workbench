/**
 * 各页共用的几样：哪些行开着（页面、页签、配置据此显示或藏起来）、去插件页、用默认浏览器看网页、交给助手、页面上的提醒。
 * 引擎的服务在 index.tsx 的 apply 里交进来（bind），页面组件不直接拿 ctx。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLE, ROWS } from '../rows.mjs'
import { campusApi } from './api.ts'

interface Status { rows: string[], browser: boolean, platform: string }
interface Alert { id: number, at: string, title: string, text: string, sessionId?: string, panel?: string }

/** 侧栏三页在主区域里的 id。 */
export const PANELS = { affairs: 'zju-campus.affairs', learning: 'zju-campus.learning', schedule: 'zju-campus.schedule' } as const

let status: Status = { rows: [''], browser: false, platform: '' }
let known = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const emit = () => { for (const listener of [...listeners]) listener() }
/** 开着的行或提醒有变化时叫 listener（index.tsx 据此登记或撤下各行的页面）。 */
export const subscribeStatus = subscribe

/** 再问一次根行哪些行开着。插件页上开关一行以后，根行的服务会马上知道，页面隔一会儿来问。 */
export async function refreshStatus(): Promise<void> {
  try {
    const next = await campusApi<Status>('status')
    if (JSON.stringify(next) !== JSON.stringify(status) || !known) { status = next; known = true; emit() }
  } catch { /* 根行没响应时照上一次的画 */ }
}

/** 现在的状态；rows 是开着的行的 key，根行（空串）总在。 */
export const useStatus = () => useSyncExternalStore(subscribe, () => status)
/** 这一行开没开（rows.mjs 的 key）。 */
export const useRow = (key: string) => useSyncExternalStore(subscribe, () => status.rows.includes(key))
export const rowOn = (key: string) => status.rows.includes(key)

/** 一行的中文标题；给的是 id（zju-courses）或 key（courses）都行。 */
export const rowTitle = (idOrKey: string) => ROWS.find(row => row.id === idOrKey || row.key === idOrKey)?.title ?? 'ZJU All-in-One Assistant'

/**
 * 引擎在页面上的几个服务。插件只声明要 slots，这几个用到时才有：bind 里各自 inject，就绪了记在这里，撤下时清掉。
 * ctx.get 拿不到没在 inject 里声明的服务，所以不能用的时候再去取。
 */
const OPTIONAL = ['pluginNavigation', 'uiWorkspace', 'layout'] as const
const services = new Map<string, unknown>()
const get = <T>(name: (typeof OPTIONAL)[number]) => services.get(name) as T | undefined

/**
 * 去插件页「ZJU All-in-One Assistant」：页面上「去打开」「去填写」都走这里。官方插件页只能打开组合包的页面，到不了某一行的配置，
 * 用户在那一页上点那一行。row 是要用户去看的那一行的 id，现在只用来将来跳得更准。
 */
export function openRow(_row?: string): void {
  get<{ openBundle: (name: string) => void }>('pluginNavigation')?.openBundle(BUNDLE)
}

/** 去插件页的列表（要用户装别的插件时）。 */
export function openPlugins(): void {
  get<{ openList: () => void }>('pluginNavigation')?.openList()
}

/** 只在校网里能上的网站：学校的，加上 CC98（和 host/campus-page.mjs 的 isIntranetHost 一样）。 */
const isIntranetHost = (host: string) => host === 'zju.edu.cn' || host.endsWith('.zju.edu.cn') || host === 'cc98.org' || host.endsWith('.cc98.org')

/**
 * 看一个网页。校内的（学校的网站和 CC98）交给根服务，在插件自己的浏览器窗口里打开：先续上 Core 的登录、带上它的会话，
 * 在校外时后台经 WebVPN 走，链接还是原来的地址，不用再登一遍（host/campus-page.mjs）。
 * 别的网站，或者这台电脑上没有能用的浏览器时，用系统的默认浏览器打开原来的地址（桌面版里 window.open 交给系统浏览器，dsh web 里是新标签页）。
 * 右侧栏的浏览器重开 dsh 就丢了登录（它的 cookie 只在内存里），不用它。
 */
export async function openPage(url: string): Promise<void> {
  let target: URL
  try { target = new URL(url) } catch { return }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return
  if (isIntranetHost(target.hostname)) {
    try { await campusApi('page-open', { url: target.href }); return } catch { /* 用默认浏览器开原来的地址 */ }
  }
  window.open(target.href, '_blank', 'noopener,noreferrer')
}

/** 页面上的链接都经 openPage 打开，不让浏览器自己开。 */
export const linkProps = (url: string) => ({
  href: url, rel: 'noreferrer',
  onClick: (event: { preventDefault: () => void }) => { event.preventDefault(); void openPage(url) },
})

/**
 * 把一件事交给助手：开一个新的对话，把写好的一段话放进输入框，用户看过、想补就补，再自己发出去。
 * 新对话开在用户现在（或最近）用的那个工作区里。
 */
export async function handToAssistant(text: string): Promise<void> {
  const ui = get<{ startSession: (workspaceId?: string, options?: object) => void }>('uiWorkspace')
  if (!ui) throw new Error('对话还没准备好，稍等一下再试。')
  ui.startSession(undefined, { prompt: text, whenDraftExists: 'replace' })
}

/**
 * 弹系统的选择文件夹窗口，和 dsh 给工作区选文件夹用的是同一个：桌面版由它的窗口弹，网页版由 dsh 在这台电脑上弹。取消时给 null。
 */
export async function pickFolder(): Promise<string | null> {
  const desktop = (globalThis as { __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
  if (desktop) return desktop.pick()
  const ui = get<{ pickDirectory: () => Promise<string | null> }>('uiWorkspace')
  if (!ui) throw new Error('dsh 还没准备好，稍等一下再试。')
  return ui.pickDirectory()
}

// ── 提醒：侧栏「校园事务」的角标和浏览器通知 ──

let unread = 0
let latest = 0
const setUnread = (next: number) => { if (next !== unread) { unread = next; emit() } }
export const useUnread = () => useSyncExternalStore(subscribe, () => unread)
export const clearUnread = () => { setUnread(0) }

/** 浏览器通知现在能不能弹；default 是还没问过用户。 */
export const notifyPermission = () => typeof Notification === 'undefined' ? 'denied' : Notification.permission

/** 打开一条提醒说的地方：一个对话，或者侧栏上的一页（affairs 后面可以跟 :personal、:campus）。 */
export function openAlert(alert: Pick<Alert, 'sessionId' | 'panel'>, showTab: (tab: 'campus' | 'personal') => void): void {
  try {
    if (alert.sessionId) { get<{ openSession: (id: string) => void }>('uiWorkspace')?.openSession(alert.sessionId); return }
    const [panel, tab] = (alert.panel ?? 'affairs').split(':')
    if (panel === 'affairs' && (tab === 'personal' || tab === 'campus')) showTab(tab)
    get<{ selectPanel: (id: string) => void }>('layout')?.selectPanel(PANELS.affairs)
  } catch { /* 对话可能已经删了，留在原来的页面 */ }
}

/** 隔一阵取新的提醒；第一次只记下现在到哪了，不把 dsh 开着时攒下的一股脑弹出来。 */
async function pollAlerts(showTab: (tab: 'campus' | 'personal') => void, first: boolean): Promise<void> {
  let result: { alerts: Alert[], latest: number }
  try { result = await campusApi('alerts-read', { after: latest }) } catch { return }
  latest = Math.max(latest, result.latest)
  if (first || !result.alerts.length) return
  const onAffairs = get<{ panelInfo: { getSnapshot: () => { activePanelId?: string | null } } }>('layout')?.panelInfo.getSnapshot().activePanelId === PANELS.affairs
  if (!onAffairs || document.hidden) setUnread(unread + result.alerts.length)
  if (notifyPermission() !== 'granted' || (onAffairs && !document.hidden)) return
  for (const alert of result.alerts) {
    try {
      const shown = new Notification(alert.title, { body: alert.text, tag: `zju-campus-${alert.id}` })
      shown.onclick = () => { window.focus(); openAlert(alert, showTab); shown.close() }
    } catch { /* 有的环境里不让 new Notification */ }
  }
}

/** 由 index.tsx 在 apply 里调（先在 ctx.effect 外面调 inject，再在 effect 里起定时）；返回停下来用的函数。 */
export function watchServices(ctx: Context): void {
  for (const name of OPTIONAL) {
    ctx.inject([name], (inner) => {
      services.set(name, (inner as unknown as Record<string, unknown>)[name])
      return () => { services.delete(name) }
    })
  }
}

export function bind(showTab: (tab: 'campus' | 'personal') => void): () => void {
  void refreshStatus()
  void pollAlerts(showTab, true)
  const timers = [
    window.setInterval(() => { void refreshStatus() }, 5_000),
    window.setInterval(() => { void pollAlerts(showTab, false) }, 20_000),
  ]
  return () => { for (const timer of timers) window.clearInterval(timer) }
}
