/**
 * 校园事务页左栏下面的备忘录：用户自己记的一件件事，像手机上的备忘录。栏里只有列表和「新建」，
 * 点开一条是整页的单条和编辑（和设置里的记忆是同一套界面，见 Notes.tsx、notebook.tsx）。存在档案目录的 notes/ 里。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Alert } from './controls.tsx'
import { MEMO_WORDS, NoteList, type Note } from './Notes.tsx'
import { noteScreen, type NoteScreen, type Notebook, type Run } from './notebook.tsx'

interface Listed { notes: Note[], warnings: string[] }
/** 一条通知加进备忘录以后引擎说的（host/notice-memo.mjs）：备忘的标题，是不是本来就在，带没带总结，要总结却没成的原因。 */
interface Clipped { title: string, existed: boolean, summarized: boolean, reason: string }
/**
 * 右栏的通知要用的三样：titleOf 给出这条通知（按原文链接认）在备忘录里的那一条的标题，没加过是空的；
 * add 把一条通知加进去，summarize 为真时先让模型总结；open 打开一条备忘。
 */
export interface NoticeMemos { titleOf: (url: string) => string, add: (id: string, summarize: boolean) => Promise<void>, open: (title: string) => void }

/** 上一次读到的。再打开这一页时先照它画，不会先空着再跳出来。 */
let last: Listed | null = null

/**
 * 加进来的通知在正文里带着原文链接，写法和引擎侧 notice-memo.mjs 的 memoMark 一样：括号换掉了。
 * 没有网页链接的（聊天、邮件、CC98）带的是一行看不见的编号。
 */
const linkMark = (url: string) => /^https?:\/\//i.test(url) ? `](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : `<!-- notice:${url} -->`

/**
 * 校园事务页用的几样：list 是左栏里的那一块；opened 是点开一条或在编辑时的整页内容（还在列表上时是 null）；
 * toast 是操作成功后窗口顶上闪一下的提示。layer 在换了一层时变，页面拿它回到顶上。notices 给右栏的通知用。
 */
export function useMemos(): { list: ReactNode, opened: ReactNode, toast: ReactNode, layer: string, notices: NoticeMemos } {
  const [data, setData] = useState<Listed | null>(last)
  const [screen, setScreen] = useState<NoteScreen>({ name: 'list' })
  const [error, setError] = useState('')
  // open 是提示后面「查看」要打开的那一条；warn 是事情只办成了一半（要总结却没总结成）。
  const [toast, setToast] = useState<{ text: string, seq: number, open?: string, warn?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const next = await campusApi<Listed>('memo-list')
    // 后台还是旧版本时回来的不是备忘。不当成「没有备忘」，直接说要重新打开应用。
    if (!Array.isArray(next?.notes)) throw new Error('ZJU All-in-One Assistant 没有给出内容，请重新打开 dsh 再试。')
    last = next
    setData(next)
  }, [])
  useEffect(() => {
    // 助手按用户说的随时可能记一条，回到窗口时和每隔十秒各读一次。
    const refresh = () => { reload().catch((reason) => { setError(errorText(reason)) }) }
    refresh()
    window.addEventListener('focus', refresh)
    const interval = window.setInterval(refresh, 10000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(interval) }
  }, [reload])

  const notify = (text: string) => { setToast(old => ({ text, seq: (old?.seq ?? 0) + 1 })) }
  const run: Run = async (task) => {
    setBusy(true); setError('')
    try { await task() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const go = (next: NoteScreen) => { setScreen(next); setError('') }
  const notebook: Notebook = { words: MEMO_WORDS, prefix: 'memo-', busy, run, reload, notify }
  const problem = error ? <Alert>{error}</Alert> : null
  const opened = data ? noteScreen({ ...notebook, notes: data.notes, screen, go, problem }) : null

  const notices: NoticeMemos = {
    titleOf: (url) => { const mark = linkMark(url); return data?.notes.find(note => note.body.includes(mark))?.title ?? '' },
    open: (title) => { go({ name: 'note', title }) },
    add: async (id, summarize) => {
      const result = await campusApi<Clipped>('feed-memo', { id, summarize })
      await reload()
      const half = summarize && !result.existed && !result.summarized
      const text = result.existed ? '这条已经在备忘录里了' : half ? `没能总结（${result.reason}），先按原样加了` : summarize ? '已总结并加到备忘录' : '已加到备忘录'
      setToast(old => ({ text, seq: (old?.seq ?? 0) + 1, open: result.title, warn: half }))
    },
  }

  return {
    opened,
    notices,
    layer: opened ? `${screen.name}:${screen.name === 'list' ? '' : screen.title ?? ''}` : '',
    list: (
      <>
        {data && (
          <NoteList compact words={MEMO_WORDS} notes={data.notes} busy={busy}
            onOpen={(note) => { go({ name: 'note', title: note.title }) }} onNew={() => { go({ name: 'edit', title: null }) }} />
        )}
        {!opened && error && <p className="campus-note campus-task-note"><span>{error}</span></p>}
        {data && data.warnings.length > 0 && <p className="campus-note campus-task-note"><span>{data.warnings.join(' ')}</span></p>}
      </>
    ),
    toast: toast && (
      <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }}
        {...(toast.warn ? { icon: <IconWarningOutlineRegular size={16} /> } : { tone: 'success' as const })}
        // 后面带着「查看」的多留一会儿，够人看完再去点。
        holdMs={toast.open ? 6000 : Math.min(4000, 1200 + toast.text.length * 80)}
        {...(toast.open ? { actions: [{ prefix: '，', label: '查看', onClick: () => { go({ name: 'note', title: toast.open! }); setToast(null) } }] } : {})} />
    ),
  }
}
