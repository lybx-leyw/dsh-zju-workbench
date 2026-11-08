/**
 * 记忆和备忘共用的「点开一条、编辑一条」。个人档案页和备忘录页各自管列表，点进去以后的两层在这里。
 * prefix 是档案服务里这一处的操作名前缀：记忆的没有前缀，备忘录的是 memo-。
 */
import type { ReactNode } from 'react'
import { campusApi } from './api.ts'
import { NoteEditor, NoteView, type Note, type NoteWords } from './Notes.tsx'

/** 现在在哪一层。edit 的 title 为空是新建；suggested 是点了一个还没有的 [[标题]] 带过来的标题。 */
export type NoteScreen = { name: 'list' } | { name: 'note', title: string } | { name: 'edit', title: string | null, suggested?: string }
/** 跑一个会改档案的操作：期间禁用按钮，出错时显示原因。 */
export type Run = (task: () => Promise<void>) => Promise<void>

export interface Notebook {
  words: NoteWords
  prefix: '' | 'memo-'
  busy: boolean
  run: Run
  reload: () => Promise<void>
  /** 操作成功后在窗口顶上闪一下的话。 */
  notify: (text: string) => void
}

/** 导入几个 Markdown 文件，一个文件一条。 */
export function importNotes({ words, prefix, run, reload, notify }: Notebook, files: File[]): Promise<void> {
  return run(async () => {
    let imported = 0
    try {
      for (const file of files) {
        if (!/\.md$/i.test(file.name) || file.size > 300000) throw new Error(`${file.name} 没有导入：只能导入 300 KB 以内的 Markdown 文件。`)
        await campusApi(`${prefix}import`, { content: await file.text(), filename: file.name })
        imported++
      }
    } finally {
      await reload()
      if (imported) notify(`导入了 ${imported} 条${words.name}`)
    }
  })
}

/** 点开的单条或编辑界面。还在列表上、或者点开的那一条已经不在了，返回 null，页面自己画列表。 */
export function noteScreen({ words, prefix, busy, run, reload, notify, notes, screen, go, problem }: Notebook & {
  notes: readonly Note[]
  screen: NoteScreen
  go: (next: NoteScreen) => void
  problem: ReactNode
}): ReactNode {
  const opened = screen.name === 'list' || screen.title === null ? undefined : notes.find(note => note.title === screen.title)
  if (screen.name === 'note' && opened) {
    // 归档、取消归档、删除之后这一条就不在原来那一栏了，直接回列表。
    const leaveAfter = async (text: string) => { await reload(); go({ name: 'list' }); notify(text) }
    return (
      <NoteView words={words} note={opened} busy={busy} problem={problem}
        onBack={() => { go({ name: 'list' }) }} onEdit={() => { go({ name: 'edit', title: opened.title }) }}
        // 点正文里的 [[标题]]：有这一条就打开，没有就按这个标题新建。
        onOpenLink={(title) => {
          const target = notes.find(note => note.title.toLowerCase() === title.toLowerCase())
          go(target ? { name: 'note', title: target.title } : { name: 'edit', title: null, suggested: title })
        }}
        onArchive={() => run(async () => {
          await campusApi(`${prefix}archive`, { title: opened.title, revision: opened.revision, archived: !opened.archived })
          await leaveAfter(opened.archived ? '已取消归档' : '已归档')
        })}
        onDelete={() => run(async () => {
          await campusApi(`${prefix}delete`, { title: opened.title, revision: opened.revision })
          await leaveAfter('已删除')
        })}
        onExport={() => run(async () => {
          const { markdown } = await campusApi<{ markdown: string }>(`${prefix}export`, { title: opened.title })
          const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `${opened.title}.md`
          anchor.click()
          window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
        })} />
    )
  }
  if (screen.name === 'edit' && (screen.title === null || opened)) {
    return (
      <NoteEditor key={screen.title ?? `new:${screen.suggested ?? ''}`} words={words} note={opened} suggestedTitle={screen.suggested} busy={busy} problem={problem}
        knownTags={[...new Set(notes.flatMap(note => note.tags))]}
        onLeave={() => { go(opened ? { name: 'note', title: opened.title } : { name: 'list' }) }}
        onSave={input => run(async () => {
          const saved = await campusApi<Note>(`${prefix}save`, input)
          await reload()
          go({ name: 'note', title: saved.title })
          notify('已保存')
        })} />
    )
  }
  return null
}
