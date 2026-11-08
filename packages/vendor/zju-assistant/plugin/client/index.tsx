/**
 * 浏览器那一半，挂在包根「校园账号」这一行上（官方只把页面代码挂在名字恰好是包名的那一行）。在这里登记：
 *   侧栏三页：日程表、校园事务、学习（「课程与学习」开着时才有）。都是自己的入口，不盖住官方的页面。
 *   设置里的「个人档案」。
 *   插件页上各子插件的「配置」：要填账号的几行是账号表单，校园通知、浙大邮箱、两个聊天、课程讲解、微信公众号各有自己的一页。
 *   组合包第一次启用时的引导，和侧栏「校园事务」上的提醒角标。
 * 一行关着时，它的页面、配置都撤下来（campus.ts 隔几秒问一次哪些行开着）。
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PluginActivationOwnerProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, IconUserOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { BUNDLE, ROWS, rowConfigKey } from '../rows.mjs'
import { AccountForm } from './AccountForm.tsx'
import { AffairsPage } from './AffairsPage.tsx'
import { LearningPage } from './LearningPage.tsx'
import { SchedulePage, CalendarIcon } from './SchedulePage.tsx'
import { ProfileSettings } from './ProfileSettings.tsx'
import { NoticeFilterSettings } from './NoticeFilterSettings.tsx'
import { MailSettings } from './MailSettings.tsx'
import { ChatSettings } from './ChatSettings.tsx'
import { CourseSettings } from './CourseSettings.tsx'
import { LearnSettings } from './LearnSettings.tsx'
import { WechatSettings } from './WechatSettings.tsx'
import { showFeedTab } from './Feed.tsx'
import { PANELS, bind, handToAssistant, rowOn, subscribeStatus, useStatus, useUnread, watchServices } from './campus.ts'
import { installBack } from './back.ts'
import css from './style.css'

export const inject = ['slots']

interface IconProps { size: number, active: boolean }

function icon(path: ReactNode, badge?: () => number) {
  return function PanelIcon({ size }: IconProps) {
    const count = badge?.() ?? 0
    return (
      <span className="campus-panel-icon">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {path}
        </svg>
        {count > 0 && <span className="campus-panel-badge" aria-label={`${count} 条新提醒`} />}
      </span>
    )
  }
}

/**
 * 侧栏从上到下：官方的插件（0）、自动化任务（10），然后是这三项，日程表在最前，和桌面版的顺序一样（桌面版里日程表顶替了自动化任务那一格）。
 * 排序号不能和别的项相同，相同时谁先加载谁在前。
 */
const AffairsIcon = icon(<><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3.5v3M16 3.5v3M4 10h16M8.5 14.5l2 2 4-4" /></>, () => useUnread())
const LearningIcon = icon(<><path d="M4 6.5c2.8-1 5.4-.8 8 .9v12c-2.6-1.7-5.2-1.9-8-.9v-12ZM20 6.5c-2.8-1-5.4-.8-8 .9v12c2.6-1.7 5.2-1.9 8-.9v-12Z" /></>)
const PANEL_LIST: readonly { id: string, row: string, order: number, label: string, Icon: (props: IconProps) => ReactNode, Page: () => ReactNode }[] = [
  { id: PANELS.schedule, row: '', order: 30, label: '日程表', Icon: CalendarIcon, Page: SchedulePage },
  { id: PANELS.affairs, row: '', order: 31, label: '校园事务', Icon: AffairsIcon, Page: AffairsPage },
  { id: PANELS.learning, row: 'courses', order: 32, label: '学习', Icon: LearningIcon, Page: LearningPage },
]

const PROFILE_SECTION = 'zju-campus-profile'

function ProfileIcon({ size }: { size: number }) {
  return <IconUserOutlineMedium size={size} />
}

/** 两个聊天只能在 Windows 和 macOS 上用：读的是本机客户端的数据。 */
function ChatConfig({ platform }: { platform: 'wechat' | 'dingtalk' }) {
  const { platform: system } = useStatus()
  if (system && system !== 'win32' && system !== 'darwin') return <p className="campus-note">只能在 Windows 和 macOS 上用。</p>
  return <ChatSettings key={platform} platform={platform} />
}

/** 各行配置页的内容（rows.mjs 的 key）；要填账号的几行，账号表单排在最上面，这里的接在它下面。 */
const CONFIG: Record<string, () => ReactNode> = {
  courses: () => <CourseSettings />,
  notices: () => <NoticeFilterSettings />,
  mail: () => <MailSettings onStatus={() => {}} />,
  'wechat-chat': () => <ChatConfig platform="wechat" />,
  dingtalk: () => <ChatConfig platform="dingtalk" />,
  learn: () => <LearnSettings />,
  wechat: () => <WechatSettings />,
}

/** 组合包第一次启用时：先填校园账号，再让助手初始化校园档案。 */
function Activation({ onDismiss, onOpenDetails }: PluginActivationOwnerProps) {
  return (
    <div className="campus-activation">
      <p className="campus-activation-title">ZJU All-in-One Assistant 已启用</p>
      <p>先在「校园账号」里填统一身份认证，再让助手初始化校园档案。</p>
      <div className="campus-actions">
        <Button size="sm" variant="primary" onClick={onOpenDetails}>去填账号</Button>
        <Button size="sm" variant="outline" onClick={() => { onDismiss(); void handToAssistant('加载 zju-campus 技能，照其中的初始化说明帮我建立校园档案。').catch(() => {}) }}>让助手初始化</Button>
      </div>
    </div>
  )
}

/**
 * 一行开着时登记、关掉时撤下。register 返回撤下用的函数；row 是空串时就是根行，一直在。
 * 放在 slots.inject 里：插槽还没声明时先不登记，等它来了再来。
 */
function whileOn(ctx: Context, slot: string, row: string, register: () => () => void): void {
  ctx.slots.inject(slot as never, () => {
    let dispose: (() => void) | undefined
    const sync = () => {
      const on = rowOn(row)
      if (on && !dispose) dispose = register()
      else if (!on && dispose) { dispose(); dispose = undefined }
    }
    sync()
    const off = subscribeStatus(sync)
    return () => { off(); dispose?.(); dispose = undefined }
  })
}

/**
 * 设置导航里文字是 label 的那一项，按钮加上 data-campus-nav=key。只加一个属性，不增删引擎画的节点；
 * 设置窗口每次打开都重画导航，所以一直看着页面，有变化时下一帧再找一遍。返回停下的函数，标记一起撤掉。
 */
function markSettingsNav(label: string, key: string): () => void {
  let frame = 0
  const mark = () => {
    frame = 0
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[class*="navCell"]')) {
      if (button.dataset.campusNav !== key && button.textContent?.trim() === label) button.dataset.campusNav = key
    }
  }
  const observer = new MutationObserver(() => { frame ||= requestAnimationFrame(mark) })
  observer.observe(document.body, { childList: true, subtree: true })
  mark()
  return () => {
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    for (const button of document.querySelectorAll<HTMLElement>(`[data-campus-nav="${key}"]`)) delete button.dataset.campusNav
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-zju-campus'
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'zju-campus: stylesheet')
  // 哪些行开着、页面上的提醒：交给 campus.ts，页面组件从那里取。
  watchServices(ctx)
  ctx.effect(() => bind(showFeedTab), 'zju-campus: row status and alerts')
  // 详情页的返回也认鼠标侧键、Alt+← 和后退键；插件停用时跟着撤掉。
  ctx.effect(() => installBack(), 'zju-campus: back inputs')

  const register = (ctx.slots.register as (options: object, component: unknown) => () => void).bind(ctx.slots)
  for (const panel of PANEL_LIST) {
    whileOn(ctx, 'main', panel.row, () => register({ name: 'main', key: panel.id }, panel.Page))
    whileOn(ctx, 'sidebar.panellist', panel.row, () => register({ name: 'sidebar.panellist', id: panel.id, order: panel.order, label: panel.label }, panel.Icon))
  }

  // 设置里的「个人档案」：基础信息和记忆，排在通用设置后面。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: PROFILE_SECTION, order: 5, label: '个人档案' }, ProfileSettings))
  // DSH 0.2.2 起插件可以给自己的分区配导航图标，id 和分区相同；0.2.1 没有这个插槽，这里等不到，不会登记。
  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', id: PROFILE_SECTION, label: '个人档案' }, ProfileIcon))
  // 0.2.1 的导航按分区 id 选图标，插件的分区一律是齿轮，和「通用设置」撞了，又传不了自己的图标（2026-11-04）。
  // 给「个人档案」那一项的按钮加个标记，style.css 只在 0.2.1 的结构上照它换图标。npm 的 latest 还是 0.2.1，先留着。
  ctx.effect(() => markSettingsNav('个人档案', 'profile'), 'zju-campus: profile icon in settings nav')

  for (const row of ROWS) {
    const accounts = row.accounts, page = CONFIG[row.key]
    if (!accounts && !page) continue
    const body = () => <>{accounts && <AccountForm accounts={accounts} />}{page?.()}</>
    whileOn(ctx, 'plugins.row.config', row.key, () => register({ name: 'plugins.row.config', key: rowConfigKey(row) },
      ({ view }: { view: 'summary' | 'page' }) => view === 'summary' ? <>{row.settings}</> : <div className="campus-config">{body()}</div>))
  }

  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register({ name: 'plugins.bundle.activation', key: BUNDLE }, Activation))
}
