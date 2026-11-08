/**
 * 记忆和备忘共用的三个界面：列表、单条和编辑。一条是档案目录里一个以标题命名的 Markdown 文件，
 * 单条的样子照 Obsidian：标题下面是属性（标签和「名称 / 值」），再下面是正文；正文里的 [[标题]] 链到同一处的另一条。
 * 设置里的个人档案放的是记忆，校园事务页放的是备忘，页面上的叫法由 words 给。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular, IconPlusOutlineRegular,
  IconSearchOutlineRegular, IconTrashOutlineRegular, Input, MarkdownDelegateProvider, MarkdownText, Modal, Pill, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, Choice, Crumb, Field, TagPicker } from './controls.tsx'

export interface Property { key: string, value: string }
export interface Note {
  title: string, body: string, tags: string[], properties: Property[]
  archived: boolean, updatedAt: string, revision: string
  /** 属性区的格式有问题时的说明；这时 body 是整篇原文。 */
  problem?: string
}
/** 页面交给档案服务保存的一条。from 是改之前的标题，新建时没有。 */
export interface NoteInput { title: string, from?: string, revision?: string, tags: string[], properties: Property[], body: string }

/** 这一处在页面上叫什么：name 是一条的叫法，list 是列表的标题，home 是它所在的那一页（点开以后顶上返回的去处）。 */
export interface NoteWords { name: string, list: string, home: string, titleHint: string }
export const MEMORY_WORDS: NoteWords = { name: '记忆', list: '记忆', home: '个人档案', titleHint: '记的是什么，如 数据结构基础、讲解偏好' }
export const MEMO_WORDS: NoteWords = { name: '备忘', list: '备忘录', home: '校园事务', titleHint: '是什么事，如 周五找辅导员签字' }
/** 窄栏里的列表先露出这么多条，其余的收起来。 */
const COMPACT_LIMIT = 5

const BODY_VIEWS = [{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }] as const
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }

export const day = (value: string) => {
  const date = new Date(value)
  return date.toLocaleDateString('zh-CN', date.getFullYear() === new Date().getFullYear() ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * 把正文里的 [[标题]]、[[标题|显示的字]] 换成引擎认的文件链接（指向「标题.md」），代码里的不动。
 * 引擎把这种链接画成一个带文件图标的按钮，点了交给 openFile。
 * HTML 注释不画出来：从通知加进来的备忘，最后一行 <!-- notice:编号 --> 是认重复用的记号（notice-memo.mjs），不是给人看的。
 */
function withLinks(body: string): string {
  return body.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/).map((part, index) => index % 2 ? part
    : part.replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/g, (_all, target: string, label?: string) =>
      `[${(label ?? target).trim()}](${encodeURIComponent(target.trim()).replace(/\(/g, '%28').replace(/\)/g, '%29')}.md)`)).join('')
}

/** 排好版的正文。点 [[标题]] 时把标题交给 onOpenLink。 */
function NoteBody({ body, onOpenLink }: { body: string, onOpenLink?: (title: string) => void }) {
  const openFile = (path: string) => {
    const title = /^([^\\/]+)\.md$/i.exec(path)?.[1]
    if (title) onOpenLink?.(title)
  }
  return (
    <MarkdownDelegateProvider openFile={openFile}>
      <MarkdownText text={withLinks(body)} labels={MARKDOWN_LABELS} />
    </MarkdownDelegateProvider>
  )
}

/** 标题下面的属性：标签一行，别的属性一项一行。没有属性时不画。 */
function NoteProperties({ tags, properties }: { tags: readonly string[], properties: readonly Property[] }) {
  if (!tags.length && !properties.length) return null
  return (
    <dl className="campus-props">
      {tags.length > 0 && <div><dt>标签</dt><dd>{tags.map(item => <Tag key={item} tone="neutral">{item}</Tag>)}</dd></div>}
      {properties.map(item => <div key={item.key}><dt>{item.key}</dt><dd>{item.value}</dd></div>)}
    </dl>
  )
}

/**
 * 列表。新建和导入在标题这一行；下面是搜索，有归档的时多一个切换；再下面按标签筛。
 * compact 是放在窄栏里的样子（校园事务页的备忘录）：只有新建和列表，多了收起来，没有搜索、标签筛选和导入。
 */
export function NoteList({ words, compact = false, notes, busy, onImport, onOpen, onNew }: {
  words: NoteWords
  compact?: boolean
  notes: readonly Note[]
  busy: boolean
  onImport?: (files: File[]) => Promise<void>
  onOpen: (note: Note) => void
  onNew: () => void
}) {
  const [shelf, setShelf] = useState<'current' | 'archived'>('current')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [expanded, setExpanded] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  const hasArchived = notes.some(note => note.archived)
  const archived = shelf === 'archived' && hasArchived
  const scoped = notes.filter(note => note.archived === archived)
  // 标签只列当前这一栏里有的；换了一栏之后原来选的标签不在了就不再筛。
  const tags = [...new Set(scoped.flatMap(note => note.tags))]
  const picked = tags.includes(tag) ? tag : ''
  const needle = query.trim().toLowerCase()
  const shown = scoped.filter(note => (!picked || note.tags.includes(picked))
    && `${note.title}\n${note.tags.join(' ')}\n${note.properties.map(item => item.value).join(' ')}\n${note.body}`.toLowerCase().includes(needle))

  const shelves = [{ value: 'current', label: words.name }, { value: 'archived', label: '已归档' }] as const
  const listed = compact && !expanded ? shown.slice(0, COMPACT_LIMIT) : shown
  const hidden = compact ? shown.length - COMPACT_LIMIT : 0

  return (
    <section className="campus-section" aria-label={words.list}>
      <div className="campus-section-head">
        <div className="campus-group-head"><h2 className="campus-section-title">{words.list}</h2><span className="campus-count">{notes.filter(note => !note.archived).length}</span></div>
        <div className="campus-actions">
          {onImport && !compact && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { importInput.current?.click() }}>导入 Markdown</Button>
              <input ref={importInput} type="file" accept=".md,text/markdown" multiple hidden aria-label="导入 Markdown 文件"
                onChange={(event) => {
                  const input = event.currentTarget, files = Array.from(input.files ?? [])
                  if (files.length) void onImport(files).finally(() => { input.value = '' })
                }} />
            </>
          )}
          <Button size="sm" variant={compact ? 'outline' : 'primary'} icon={<IconPlusOutlineRegular size={14} />} onClick={onNew}>新建{compact ? '' : words.name}</Button>
        </div>
      </div>
      {(!compact || hasArchived) && (
        <div className="campus-toolbar">
          {hasArchived && <Choice label="看哪一栏" value={archived ? 'archived' : 'current'} options={shelves} onChange={(value) => { if (value) { setShelf(value); setExpanded(false) } }} />}
          {!compact && (
            <Input className="campus-search" icon={<IconSearchOutlineRegular size={14} />} aria-label={`搜索${words.name}`} placeholder="搜索标题、标签或正文"
              value={query} onChange={(event) => { setQuery(event.target.value) }} />
          )}
        </div>
      )}
      {!compact && tags.length > 0 && (
        <div className="campus-taglist" role="group" aria-label="按标签筛选">
          <span className="campus-taglist-label">标签</span>
          {/* 前面一个「全部」，一眼看得出这一排是用来挑着看的。 */}
          <Pill active={picked === ''} aria-pressed={picked === ''} onClick={() => { setTag('') }}>全部</Pill>
          {tags.map(item => <Pill key={item} active={picked === item} aria-pressed={picked === item} onClick={() => { setTag(picked === item ? '' : item) }}>{item}</Pill>)}
        </div>
      )}
      {shown.length === 0
        ? compact
          // 窄栏里和上面的作业一样，空着时占一张虚线卡片的位置。
          ? <p className="campus-task-empty">{archived ? `还没有归档的${words.name}` : `还没有${words.name}`}</p>
          : (
            <div className="campus-empty">
              <IconArchiveOutlineRegular size={20} />
              <p>{needle !== '' || picked !== '' ? `没有找到符合的${words.name}` : archived ? `还没有归档的${words.name}` : `还没有${words.name}`}</p>
            </div>
          )
        : (
          <ul className="campus-note-list">
            {listed.map(note => (
              <li className="campus-note-row" key={note.title}>
                <button type="button" className="campus-note-open" onClick={() => { onOpen(note) }}>{note.title}</button>
                <time dateTime={note.updatedAt}>{day(note.updatedAt)}</time>
              </li>
            ))}
          </ul>
        )}
      {hidden > 0 && (
        <Button className="campus-more" variant="ghost" size="sm" aria-expanded={expanded}
          icon={expanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />} onClick={() => { setExpanded(old => !old) }}>
          {expanded ? '收起' : `展开其余 ${hidden} 条`}
        </Button>
      )}
    </section>
  )
}

/** 单条。归档、取消归档和删除之后回到列表。 */
export function NoteView({ words, note, busy, problem, onBack, onEdit, onArchive, onDelete, onExport, onOpenLink }: {
  words: NoteWords
  note: Note
  busy: boolean
  problem: ReactNode
  onBack: () => void
  onEdit: () => void
  onArchive: () => Promise<void>
  onDelete: () => Promise<void>
  onExport: () => Promise<void>
  onOpenLink: (title: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="campus-detail">
      <Crumb text={words.home} onBack={onBack} />
      <div className="campus-detail-head" data-wrap>
        <div className="campus-detail-main">
          <div className="campus-titleline">
            <h1 className="campus-page-title">{note.title}</h1>
            {note.archived && <Tag tone="outline">已归档</Tag>}
          </div>
        </div>
        <div className="campus-actions">
          <Button size="sm" variant="outline" disabled={busy} icon={<IconDownloadOutlineRegular size={14} />} onClick={() => { void onExport() }}>导出</Button>
          <Button size="sm" variant="outline" disabled={busy} icon={<IconArchiveOutlineRegular size={14} />} onClick={() => { void onArchive() }}>{note.archived ? '取消归档' : '归档'}</Button>
          <Button size="sm" variant="outline" disabled={busy} icon={<IconTrashOutlineRegular size={14} />} onClick={() => { setDeleting(true) }}>删除</Button>
          <Button size="sm" variant="primary" icon={<IconEditOutlineRegular size={14} />} onClick={onEdit}>编辑</Button>
        </div>
      </div>
      <div className="campus-detail-notices">
        {problem}
        {note.problem && <Alert tone="warn">{note.problem}</Alert>}
      </div>
      <NoteProperties tags={note.tags} properties={note.properties} />
      <div className="campus-markdown campus-note-body">
        {note.body.trim() ? <NoteBody body={note.body} onOpenLink={onOpenLink} /> : <p className="campus-unset">还没有正文</p>}
      </div>
      <Modal open={deleting} title={`删除这条${words.name}？`} description="删除后找不回。" closeLabel="关闭" onClose={() => { setDeleting(false) }}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleting(false) }}>取消</Button>
            <Button className="campus-danger" disabled={busy} onClick={() => { setDeleting(false); void onDelete() }}>删除</Button>
          </>
        )} />
    </div>
  )
}

/** 新建或修改一条。note 为空是新建，这时 suggestedTitle 是点了一个还没有的 [[标题]] 带过来的。 */
export function NoteEditor({ words, note, suggestedTitle = '', busy, problem, knownTags, onLeave, onSave }: {
  words: NoteWords
  note: Note | undefined
  suggestedTitle?: string
  busy: boolean
  problem: ReactNode
  /** 别的几条已经用过的标签，编辑时可以直接选。 */
  knownTags: readonly string[]
  onLeave: () => void
  onSave: (input: NoteInput) => Promise<void>
}) {
  // 进入编辑时的版本。后台刷新带来新版本时拿它来比，发现别处改过。
  const [base] = useState(note)
  const [initial] = useState(() => ({ title: base?.title ?? suggestedTitle, tags: base?.tags ?? [], properties: base?.properties.map(item => ({ ...item })) ?? [], body: base?.body ?? '' }))
  const [draft, setDraft] = useState(initial)
  const [preview, setPreview] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const stale = !!base && !!note && note.revision !== base.revision
  const set = (patch: Partial<typeof draft>) => { setDraft(old => ({ ...old, ...patch })) }
  const setProperty = (index: number, patch: Partial<Property>) => { set({ properties: draft.properties.map((item, at) => at === index ? { ...item, ...patch } : item) }) }

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [dirty])

  const leave = () => { if (dirty) setLeaving(true); else onLeave() }

  return (
    <div className="campus-detail">
      <Crumb text={base ? base.title : words.home} onBack={leave} />
      <div className="campus-detail-main">
        <h1 className="campus-page-title">{base ? '编辑' : '新建'}{words.name}</h1>
      </div>
      <form className="campus-form campus-editor" onSubmit={(event) => {
        event.preventDefault()
        void onSave({ ...(base ? { from: base.title, revision: base.revision } : {}), title: draft.title, tags: draft.tags, properties: draft.properties, body: draft.body })
      }}>
        {stale && <Alert tone="warn">这条{words.name}刚在别处被改过。把你要保留的内容先复制出来，放弃这次修改后重新打开，再改最新的版本。</Alert>}
        {base?.problem && <Alert tone="warn">{base.problem}下面是整篇原文，改好开头那一段再保存。</Alert>}
        <Field id="campus-note-title" label="标题">
          <input id="campus-note-title" className="campus-input" type="text" required maxLength={80} autoFocus={!base} placeholder={words.titleHint}
            value={draft.title} disabled={busy} onChange={(event) => { set({ title: event.target.value }) }} />
        </Field>
        {!base?.problem && (
          <section className="campus-form-group" aria-labelledby="campus-note-props">
            <h3 className="campus-form-heading" id="campus-note-props">属性</h3>
            <div className="campus-proplist">
              <div className="campus-proprow">
                <label className="campus-propname" htmlFor="campus-note-tags">标签</label>
                <TagPicker id="campus-note-tags" label="标签" value={draft.tags} known={knownTags} disabled={busy} onChange={(tags) => { set({ tags }) }} />
              </div>
              {draft.properties.map((item, index) => (
                <div className="campus-proprow" key={index}>
                  <input className="campus-input" type="text" aria-label="属性的名称" placeholder="名称，如 学期" maxLength={40}
                    value={item.key} disabled={busy} onChange={(event) => { setProperty(index, { key: event.target.value }) }} />
                  <input className="campus-input" type="text" aria-label={`${item.key || '这一项属性'}的内容`} placeholder="内容" maxLength={500}
                    value={item.value} disabled={busy} onChange={(event) => { setProperty(index, { value: event.target.value }) }} />
                  <button type="button" className="campus-textlink" data-danger disabled={busy} onClick={() => { set({ properties: draft.properties.filter((_item, at) => at !== index) }) }}>移除</button>
                </div>
              ))}
              <div>
                <Button type="button" size="sm" variant="outline" icon={<IconPlusOutlineRegular size={14} />} disabled={busy || draft.properties.length >= 20}
                  onClick={() => { set({ properties: [...draft.properties, { key: '', value: '' }] }) }}>添加属性</Button>
              </div>
            </div>
          </section>
        )}
        <Field id="campus-note-body" label="正文"
          aside={<Choice label="正文显示方式" value={preview ? 'preview' : 'edit'} options={BODY_VIEWS} onChange={(value) => { setPreview(value === 'preview') }} />}>
          {preview
            ? <div className="campus-markdown campus-preview">{draft.body.trim() ? <NoteBody body={draft.body} /> : <p className="campus-unset">还没有正文</p>}</div>
            : <textarea id="campus-note-body" className="campus-input campus-textarea" placeholder={`用 Markdown 写。提到另一条${words.name}时写 [[那条的标题]]。`} value={draft.body} disabled={busy} onChange={(event) => { set({ body: event.target.value }) }} />}
        </Field>
        {problem}
        <div className="campus-form-foot">
          <button type="submit" className="campus-save" disabled={busy || !draft.title.trim()}>{busy ? '保存中…' : '保存'}</button>
          <button type="button" className="campus-cancel" disabled={busy} onClick={leave}>取消</button>
        </div>
      </form>
      <Modal open={leaving} title="放弃这次修改？" description="还没有保存的内容会丢掉。" closeLabel="关闭" onClose={() => { setLeaving(false) }}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setLeaving(false) }}>继续编辑</Button>
            <Button className="campus-danger" onClick={onLeave}>放弃修改</Button>
          </>
        )} />
    </div>
  )
}
