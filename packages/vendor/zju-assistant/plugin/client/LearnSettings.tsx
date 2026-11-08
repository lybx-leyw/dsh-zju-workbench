/**
 * 「课程讲解」的配置页：可选依赖，一行一样，左边是名字，中间是它是什么，右边是装没装和安装的按钮。
 * 没有它们讲解也做得出来，有了效果更好（公式排得准、助手能自己检查画面）。检测和安装在引擎侧的 host/learn.mjs。不做配音。
 * 装的时候每秒问一次装到哪了；离开这一页再回来，安装照旧在后台走，进度接着显示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { useStatus } from './campus.ts'

interface Part { id: 'tex' | 'browser' | 'libs', state: 'ready' | 'missing' | 'installing', where: 'app' | 'system' | null, installable: boolean, step: string, percent: number | null, error: string }
interface Snapshot { enabled: boolean, parts: Part[] }

/** 每一样叫什么、是什么。macOS 上两样都要自己装（自动安装只做了 Windows 的），说清楚装哪个。 */
const names = (mac: boolean): Record<Part['id'], { title: string, what: string }> => ({
  tex: { title: '公式排版', what: mac ? 'TeX Live。macOS 上自己装 MacTeX，或者小一些的 BasicTeX 再用 tlmgr 装上 dvisvgm，装好重新打开 dsh' : 'TeX Live，约 300 MB' },
  browser: { title: '版面检查', what: mac ? '本机的 Chrome 或 Edge，装在「应用程序」文件夹里' : '本机的 Edge 或 Chrome' },
  libs: { title: '动画库', what: 'GSAP 和 three.js，打开这一行时自动下载，约 6 MB' },
})
/** 装的时候多久问一次。 */
const ASK_MS = 1000

export function LearnSettings() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const NAMES = names(useStatus().platform === 'darwin')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const apply = (next: Snapshot) => { if (alive.current) { setData(next); setError('') } }
  const load = useCallback(() => { campusApi<Snapshot>('learn-read').then(apply, (reason: unknown) => { if (alive.current) setError(errorText(reason)) }) }, [])
  useEffect(() => {
    load()
    // 在别处装了 TeX、或者装完以后回到窗口，这里跟着变。
    window.addEventListener('focus', load)
    return () => { window.removeEventListener('focus', load) }
  }, [load])
  const installing = data?.parts.some(part => part.state === 'installing') ?? false
  useEffect(() => {
    if (!installing) return
    const timer = window.setInterval(load, ASK_MS)
    return () => { window.clearInterval(timer) }
  }, [installing, load])

  const act = (action: 'learn-install' | 'learn-remove', id: Part['id']) => {
    campusApi<Snapshot>(action, { id }).then(apply, (reason: unknown) => { if (alive.current) setError(errorText(reason)) })
  }
  if (!data) return error ? <p className="campus-form-error">{error}</p> : null
  return (
    <section className="campus-section" aria-label="可选依赖">
      <h2 className="campus-section-title">可选依赖</h2>
      <dl className="campus-systems campus-parts">
        {data.parts.map((part) => {
          const name = NAMES[part.id]
          return (
            <div key={part.id} data-part={part.id}>
              <dt>{name.title}</dt>
              <dd>
                {name.what}
                {part.state !== 'installing' && part.error && <span className="campus-form-error">没装成：{part.error}</span>}
              </dd>
              <span className="campus-parts-end">
                {part.state === 'installing' && <span className="campus-note" role="status">{part.step}{part.percent === null ? '' : ` ${part.percent}%`}</span>}
                {part.state === 'ready' && <Tag>{part.where === 'system' ? '本机已有' : '已安装'}</Tag>}
                {part.state === 'ready' && part.where === 'app' && <Button size="sm" variant="outline" onClick={() => { act('learn-remove', part.id) }}>卸载</Button>}
                {part.state === 'missing' && (part.installable
                  ? <Button size="sm" variant="outline" onClick={() => { act('learn-install', part.id) }}>安装</Button>
                  : <Tag tone="warning">没找到</Tag>)}
              </span>
            </div>
          )
        })}
      </dl>
      {error && <p className="campus-form-error">{error}</p>}
    </section>
  )
}
