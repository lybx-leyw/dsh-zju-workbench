/**
 * 会进出的列表。新来的一项从左边滑进来，没了的一项向右滑出去，上下的项让出或补上位置；
 * limit 以外的项折起来，露出和折起时只有高度在变。第一次画出来的内容不带动画。
 * 动画本身在 style.css 的 .campus-flow-* 里，这里只管每一项现在处在哪个阶段。
 */
import { useEffect, useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react'

type Phase = 'still' | 'enter' | 'leave'
/** order 是同时进来的几项里的第几个，用来把它们一个接一个错开。 */
interface Entry<T> { key: string, item: T, phase: Phase, order: number }

/** 最多错开这么多个，再多的和最后一个一起进。 */
const STAGGER = 6
/** 动画放完的通知万一没来（样式还没加载好），过这么久也收尾。 */
const SETTLE_MS = 1500

/** 把新的一批内容合进现在画着的：还在的留着，新来的标成进入，没了的留在原位标成离开。 */
function merge<T>(old: readonly Entry<T>[], items: readonly T[], keyOf: (item: T) => string, limit: number): Entry<T>[] {
  const next = new Set(items.map(keyOf))
  const before = new Map(old.map(entry => [entry.key, entry]))
  // 离开的项跟在它前面最近的、还在的那一项后面。折起来看不见的不用放动画，直接去掉。
  const leaving = new Map<string, Entry<T>[]>()
  let anchor = '', shown = 0
  for (const entry of old) {
    const visible = entry.phase === 'leave' || shown++ < limit
    if (next.has(entry.key)) anchor = entry.key
    else if (visible) leaving.set(anchor, [...leaving.get(anchor) ?? [], entry.phase === 'leave' ? entry : { ...entry, phase: 'leave', order: 0 }])
  }
  const out = [...leaving.get('') ?? []]
  let entering = 0
  items.forEach((item, index) => {
    const key = keyOf(item), was = before.get(key)
    if (was) out.push({ ...was, item, phase: was.phase === 'leave' ? 'still' : was.phase })
    // 落在折起来那一段里的新项不用动画。
    else if (index < limit) out.push({ key, item, phase: 'enter', order: Math.min(entering++, STAGGER) })
    else out.push({ key, item, phase: 'still', order: 0 })
    out.push(...leaving.get(key) ?? [])
  })
  return out
}

export function Flow<T>({ items, keyOf, limit = Infinity, label, children }: {
  /** 内容没变时要传同一个数组，变了才换新的。 */
  items: readonly T[]
  keyOf: (item: T) => string
  /** 最多露出几项，其余的折起来。 */
  limit?: number
  label: string
  children: (item: T) => ReactNode
}) {
  const [seen, setSeen] = useState(items)
  const [entries, setEntries] = useState<Entry<T>[]>(() => items.map(item => ({ key: keyOf(item), item, phase: 'still', order: 0 })))
  if (seen !== items) {
    setSeen(items)
    setEntries(merge(entries, items, keyOf, limit))
  }

  /** 一项（不给 key 就是所有项）的动画放完了：离开的拿掉，进入的变成普通的一项。 */
  const settle = (key?: string) => {
    setEntries(list => list
      .filter(entry => entry.phase !== 'leave' || (key !== undefined && entry.key !== key))
      .map(entry => entry.phase === 'enter' && (key === undefined || entry.key === key) ? { ...entry, phase: 'still', order: 0 } : entry))
  }
  const moving = entries.some(entry => entry.phase !== 'still')
  useEffect(() => {
    if (!moving) return
    const timer = window.setTimeout(() => { settle() }, SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [entries, moving])

  let shown = 0
  return (
    <ul className="campus-flow" aria-label={label}>
      {entries.map((entry) => {
        const folded = entry.phase !== 'leave' && shown++ >= limit
        const done = (event: AnimationEvent<HTMLLIElement>) => { if (event.target === event.currentTarget) settle(entry.key) }
        return (
          <li key={entry.key} className="campus-flow-item" data-motion={entry.phase === 'still' || folded ? undefined : entry.phase} data-folded={folded ? '' : undefined}
            aria-hidden={entry.phase === 'leave' || folded ? true : undefined}
            style={entry.order ? { '--campus-flow-order': entry.order } as CSSProperties : undefined} onAnimationEnd={done}>
            <div className="campus-flow-clip"><div className="campus-flow-body">{children(entry.item)}</div></div>
          </li>
        )
      })}
    </ul>
  )
}
