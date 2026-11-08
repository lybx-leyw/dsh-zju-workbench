/** 学习页两边（智云的 LearningPage.tsx 和 LearningXuezai.tsx、超星的 LearningChaoxing.tsx）共用的几样小东西。 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Button, IconChevronRightOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { campusApi } from './api.ts'
import { rowTitle, useRow } from './campus.ts'
import { agoText, dateText, mixed } from './when.ts'

export const pluginTitle = rowTitle

/** 插件页上的某一行现在开着没有（rows.mjs 的 key）。 */
export const usePluginOn = (key: string): boolean | null => useRow(key)

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 「2026-10-08」这样的北京时间日期：写成几月几日加星期。 */
export function dayText(date: string | null, now: number): string {
  if (!date) return '时间待定'
  const at = new Date(`${date}T00:00:00`).getTime()
  return `${dateText(at, now)} ${WEEKDAYS[new Date(at).getDay()]}`
}

/**
 * 换内容时带上动效，不硬切。用的是浏览器的视图过渡：先记下换之前的样子，change 换完以后，它自己把两边接起来。
 * 两栏里的几样东西各有名字（style.css 最后一段的 .campus-learn-a/b/c/x），同名的在换之前和之后位置不一样就滑过去
 * （智云那一边点进一次课时，右栏的课次列表滑到左边当目录），只有一边有的淡入或者淡出。
 * kind：in 是往下点一级，out 是退回来，swap 是同一栏里换内容（换一门课、换一边、换一次课、换一节、换平台），新的从下面升上来一点。
 * 系统设置了「减少动态效果」、或者浏览器不支持时直接换。
 */
export type Move = 'in' | 'out' | 'swap'
/** 一次过渡最长也就四百毫秒；超过这么久还没走完的不再等。 */
const MOVE_LIMIT_MS = 700
let moves = 0
export function move(kind: Move, change: () => void): void {
  const start = (document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>, ready: Promise<void>, skipTransition: () => void } }).startViewTransition
  if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { change(); return }
  const root = document.documentElement, mine = ++moves
  root.dataset.campusMove = kind
  let guard = 0
  // 连着点时前一次过渡会被后一次打断：只有最后一次收尾时才把标记拿掉。
  const done = () => { window.clearTimeout(guard); if (mine === moves) delete root.dataset.campusMove }
  try {
    const transition = start.call(document, () => { flushSync(change) })
    // 过渡是跟着画面一帧一帧走的：窗口不出画面时（被挡住、藏着）它走不完，页面会一直停在换之前的样子。过了这么久还没完就直接跳到结果。
    guard = window.setTimeout(() => { transition.skipTransition() }, MOVE_LIMIT_MS)
    // 过渡被跳过或者被下一次打断时，浏览器会让 ready 这个承诺落空；内容照样换了，接住它，免得在控制台里报成没人管的错误。
    transition.ready.catch(() => {})
    transition.finished.then(done, done)
  } catch { done(); change() }
}

/** 右栏最上面：点中的是什么，下面一行小字；aside 是这一行右边的切换。下面一根细线隔开内容。 */
export function PaneHead({ title, note, aside }: { title: string, note: string, aside?: ReactNode }) {
  return (
    <div className="campus-learn-head">
      <div className="campus-learn-picked">
        <h2 className="campus-learn-picked-title">{title}</h2>
        {note && <span className="campus-note">{note}</span>}
      </div>
      {aside}
    </div>
  )
}

export function Arrow() {
  return <span className="campus-learn-arrow" aria-hidden="true"><IconChevronRightOutlineRegular size={14} /></span>
}

/**
 * 一行右边的小按钮：只画一个图标，鼠标放上去或键盘聚焦时显示它是做什么的（和「交给助手」的图标按钮一个样子）。
 * 文件的那一行用它来下载、打开文件夹：带字的按钮占地方，文件名就放不全。
 */
export function IconAction({ label, icon, disabled = false, onClick }: { label: string, icon: ReactNode, disabled?: boolean, onClick: () => void }) {
  return (
    <Tooltip label={label} side="top" portal>
      <Button className="campus-hand" size="sm" variant="outline" aria-label={label} icon={icon} disabled={disabled} onClick={onClick} />
    </Tooltip>
  )
}

/** 列表下面的小字说明，可以带一个去处理的入口。 */
export function Note({ text, action, onAction }: { text: string, action?: string, onAction?: () => void }) {
  return (
    <p className="campus-note campus-task-note">
      <span>{text}</span>
      {action && <button type="button" className="campus-textlink" onClick={onAction}>{action}</button>}
    </p>
  )
}

/** 没读到时的那句话。冒号后面的原因是系统给的原话，不动它。 */
export const failure = (what: string, fetchedAt: string | null, error: string, now: number) =>
  `${mixed(fetchedAt ? `${what}这次没读到，上面的还是${agoText(Date.parse(fetchedAt), now)}读到的：` : `${what}没读到：`)}${error.replace(/[。.]$/, '')}。`

// ── 下载进度 ───────────────────────────────────────────────

/** 后台给的一项下载下到哪了：已经收到的字节数和总字节数（总量还估不出来时是 0）。 */
interface Progress { bytes: number, total: number }
/** 多久问一次后台。 */
const ASK_MS = 500

/**
 * 正在下的那几项各下到百分之几。active 为真（页面上有一行在下）时每隔半秒问后台一次，action 和 input 是问哪一个接口、问谁的；
 * 回来的结果里少了一项，就是那一项下完了或者没下成，叫 onDone 让页面重读（离开页面再回来时，下载是后台在做，靠这个知道它完了）。
 * 给出的百分数在 0–99 之间，总量还不知道时是 null；只升不降：分片的回放总量是估出来的，会来回晃。没下完之前不写 100。
 */
export function useDownloading(action: string, input: object, active: boolean, onDone: () => void): Readonly<Record<string, number | null>> {
  const [percents, setPercents] = useState<Record<string, number | null>>({})
  const done = useRef(onDone)
  done.current = onDone
  const key = JSON.stringify(input)
  useEffect(() => {
    if (!active) { setPercents({}); return }
    let live = true, asking = false, before: string[] = []
    const high: Record<string, number | null> = {}
    const ask = async () => {
      if (asking) return
      asking = true
      try {
        const states = await campusApi<Record<string, Progress>>(action, JSON.parse(key))
        if (!live) return
        const next: Record<string, number | null> = {}
        for (const [id, state] of Object.entries(states)) {
          const now = state.total > 0 ? Math.min(99, Math.floor(state.bytes / state.total * 100)) : null
          next[id] = high[id] = now === null ? high[id] ?? null : Math.max(now, high[id] ?? 0)
        }
        if (before.some(id => !(id in states))) done.current()
        before = Object.keys(states)
        setPercents(next)
      } catch { /* 这一次没问到，下一次再问 */ } finally { asking = false }
    }
    void ask()
    const timer = window.setInterval(() => { void ask() }, ASK_MS)
    return () => { live = false; window.clearInterval(timer) }
  }, [action, key, active])
  return percents
}

/** 一行底边上的进度线：压在行与行之间那根细线的位置，不占高度，出现和消失时别的行不会跟着跳。还不知道下到多少时不画。 */
export function ProgressLine({ percent }: { percent: number | null | undefined }) {
  if (percent == null) return null
  return (
    <span className="campus-learn-progress" role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      style={{ '--campus-progress': `${percent}%` } as CSSProperties} />
  )
}
