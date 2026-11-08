/**
 * 点开的一条通知，在校园事务页右栏原位显示（2026-10-18 起，原来是弹出的对话框），左栏的作业和备忘录照旧看得见；
 * 顶上「返回」回到原来那个页签的列表。内容由引擎侧 host/notice-content.mjs 按来源读：
 * 学校通知读正文和附件、公众号读全文、二课在平台上找这一条、邮件只读地读正文（不改邮箱里的已读），聊天和 CC98 用列表里已有的原文。
 * 读不全时照实说读到了哪些；有原文的给原文入口，没有网页链接的不编一个。下面是加到备忘录，加过的换成「查看备忘录」。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconCheckOutlineRegular, IconDownloadOutlineRegular, IconListPenOutlineRegular, IconLoadingOutlineRegular, IconPlusOutlineRegular, IconSparkleRegular,
  MarkdownText, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { linkProps } from './campus.ts'
import { ChatMessage, type Message } from './ChatSettings.tsx'
import { Crumb } from './controls.tsx'

/** 引擎给的阅读内容；markdown 和 text 一般只有一样。 */
export interface Content {
  title: string, from: string, markdown?: string, text?: string, facts: [string, string][], originalUrl: string | null
  attachments?: { name: string, url?: string, index?: number }[], note?: string, messages?: Message[], summary?: string
}
const LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }

/** 详情里的「加到备忘录」：两种加法收在一个菜单里；AI 整理过的聊天事项（direct）点了直接加；加过的直接是「查看备忘录」。 */
function MemoAction({ memo, busy, direct, onAdd, onOpen }: { memo: string, busy: boolean, direct: boolean, onAdd: (summarize: boolean) => void, onOpen: () => void }) {
  const [choosing, setChoosing] = useState(false)
  if (memo) return <Button size="sm" variant="outline" icon={<IconCheckOutlineRegular size={14} />} onClick={onOpen}>查看备忘录</Button>
  if (direct) {
    return (
      <Button size="sm" variant="primary" disabled={busy} icon={busy ? <IconLoadingOutlineRegular size={14} /> : <IconListPenOutlineRegular size={14} />} onClick={() => { onAdd(false) }}>
        {busy ? '正在加到备忘录' : '加到备忘录'}
      </Button>
    )
  }
  return (
    <Menu
      open={choosing && !busy}
      onClose={() => { setChoosing(false) }}
      items={[
        { id: 'plain', label: '直接添加', icon: <IconPlusOutlineRegular size={14} /> },
        { id: 'summary', label: 'AI 总结后添加', icon: <IconSparkleRegular size={14} /> },
      ]}
      onSelect={(id) => { setChoosing(false); onAdd(id === 'summary') }}
      portal
      anchor={(
        <Button size="sm" variant="primary" disabled={busy} aria-haspopup="menu" aria-expanded={choosing}
          icon={busy ? <IconLoadingOutlineRegular size={14} /> : <IconListPenOutlineRegular size={14} />} onClick={() => { setChoosing(old => !old) }}>
          {busy ? '正在加到备忘录' : '加到备忘录'}
        </Button>
      )}
    />
  )
}

export function NoticeDetail({ id, title, meta, back, memo, adding, direct = false, onBack, onMemo, onOpenMemo }: {
  id: string, title: string
  /** 列表那一行里的来源和时间，内容还没读到时先照它画。 */
  meta: ReactNode
  /** 返回到哪个页签，写在返回按钮上。 */
  back: string
  memo: string, adding: boolean
  /** AI 整理过的聊天事项：不用选加法，直接加。 */
  direct?: boolean
  onBack: () => void, onMemo: (summarize: boolean) => void, onOpenMemo: () => void
}) {
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  /** 邮件附件：正在下载的、下好的和没下成的。 */
  const [files, setFiles] = useState<Record<number, { busy?: boolean, done?: boolean, error?: string }>>({})
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    setContent(null); setError('')
    campusApi<Content>('feed-content', { id }).then(value => { if (live.current) setContent(value) }, reason => { if (live.current) setError(errorText(reason)) })
    return () => { live.current = false }
  }, [id, attempt])
  const download = async (index: number) => {
    setFiles(old => ({ ...old, [index]: { busy: true } }))
    try { await campusApi('feed-attachment', { id, index }); if (live.current) setFiles(old => ({ ...old, [index]: { done: true } })) }
    catch (reason) { if (live.current) setFiles(old => ({ ...old, [index]: { error: errorText(reason) } })) }
  }

  return (
    <article className="campus-notice-detail" aria-label={title}>
      <Crumb text={back} onBack={onBack} />
      <h3 className="campus-notice-detail-title">{content?.title || title}</h3>
      <p className="campus-notice-detail-meta">{meta}</p>
      {!content && !error && <p className="campus-note" role="status">正在读取完整内容…</p>}
      {error && (
        <div className="campus-notice-detail-error" role="alert">
          <p className="campus-note">{error}</p>
          <Button size="sm" variant="outline" onClick={() => { setAttempt(value => value + 1) }}>重试</Button>
        </div>
      )}
      {content && (
        <>
          {content.facts.length > 0 && <dl className="campus-notice-facts">{content.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
          {content.summary && <div className="campus-notice-summary"><span className="campus-note">AI 整理</span><p className="campus-task-body">{content.summary}</p></div>}
          {content.markdown && <div className="campus-markdown"><MarkdownText text={content.markdown} labels={LABELS} /></div>}
          {content.text && <p className="campus-task-body">{content.text}</p>}
          {content.messages && content.messages.length > 0 && (
            <div className="campus-notice-messages">
              {content.summary && <span className="campus-note">原文 {content.messages.length} 条</span>}
              {content.messages.map(message => <ChatMessage key={message.id} message={message} />)}
            </div>
          )}
          {content.note && <p className="campus-note">{content.note}</p>}
          {content.attachments && content.attachments.length > 0 && (
            <section className="campus-section" aria-label="附件">
              <div className="campus-titleline"><h4 className="campus-section-title">附件</h4><span className="campus-count">{content.attachments.length}</span></div>
              <ul className="campus-rows">
                {content.attachments.map((file, at) => {
                  const state = file.index === undefined ? undefined : files[file.index]
                  return (
                    <li className="campus-row" key={`${at}:${file.name}`}>
                      <span className="campus-task-file">
                        {file.url ? <a className="campus-textlink" {...linkProps(file.url)}>{file.name}</a> : file.name}
                        {state?.error && <span className="campus-form-error">{state.error}</span>}
                      </span>
                      {file.index !== undefined && (
                        <Button size="sm" variant="outline" icon={<IconDownloadOutlineRegular size={14} />} disabled={state?.busy}
                          onClick={() => { void download(file.index!) }}>
                          {state?.busy ? '下载中' : state?.done ? '再下载一次' : '下载'}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
      <div className="campus-notice-detail-actions">
        <MemoAction memo={memo} busy={adding} direct={direct} onAdd={onMemo} onOpen={onOpenMemo} />
        {content?.originalUrl && <a className="campus-textlink" {...linkProps(content.originalUrl)}>打开原文</a>}
      </div>
    </article>
  )
}
