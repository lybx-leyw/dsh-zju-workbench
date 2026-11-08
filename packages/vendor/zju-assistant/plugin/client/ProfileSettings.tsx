/**
 * 设置里的「个人档案」一页：上面是基础信息，下面是记忆（助手对用户的了解，用户能改）。填一次以后很少再看，所以放在设置里。
 * 先是列表，点开一条记忆看全文，再进编辑，都在这一页里切换。记忆的三个界面在 Notes.tsx，和校园事务页的备忘录共用。
 * 账号和密码不在这里，在插件页「ZJU All-in-One Assistant」各行的配置里填。没有桌面版的「对话后复盘」设置。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconEditOutlineRegular, IconRefreshOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { IDENTITY_FIELDS } from '../accounts.mjs'
import { errorText, campusApi } from './api.ts'
import { Alert, Choice, Field, Select, type SelectOption } from './controls.tsx'
import { MEMORY_WORDS, NoteList, type Note } from './Notes.tsx'
import { importNotes, noteScreen, type NoteScreen, type Notebook, type Run } from './notebook.tsx'

interface Identity { values: Record<string, string>, revision: string }
interface Snapshot { identity: Identity, memory: Note[], warnings: string[] }

const LEVELS = [{ value: '本科', label: '本科' }, { value: '硕士', label: '硕士' }, { value: '博士', label: '博士' }] as const
// 入学年份的选项：今年往前十年。
const YEARS = Array.from({ length: 10 }, (_, index) => String(new Date().getFullYear() - index))
/** 学院下拉里「手动填写」那一行的值，不会和真实的学院名撞。 */
const TYPE_COLLEGE = '\u0000type'

export function ProfileSettings() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [view, setView] = useState<NoteScreen>({ name: 'list' })
  const [error, setError] = useState('')
  // 操作成功后在窗口顶上闪一下的提示，用引擎自带的 Toast。seq 让同一句话连着出现两次也会重新播放。
  const [toast, setToast] = useState<{ text: string, seq: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const page = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    const next = await campusApi<Snapshot>('snapshot')
    // 回来的内容里没有记忆这一项，是后台出了问题，不当成「没有记忆」。
    if (!next.memory) throw new Error('ZJU All-in-One Assistant 没有给出内容，请重新打开 dsh 再试。')
    setData(next)
  }, [])
  useEffect(() => {
    // 助手随时可能往档案里写东西，回到窗口时和每隔十秒各读一次。
    const refresh = () => { reload().catch((err) => { setError(errorText(err)) }) }
    refresh()
    window.addEventListener('focus', refresh)
    const interval = window.setInterval(refresh, 10000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(interval) }
  }, [reload])
  // 滚动的是设置面板的内容栏，换了一层就回到这一页的开头。
  useEffect(() => { page.current?.scrollIntoView({ block: 'start' }) }, [view])

  const notify = (text: string) => { setToast(old => ({ text, seq: (old?.seq ?? 0) + 1 })) }
  const run: Run = async (task) => {
    setBusy(true); setError('')
    try { await task() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const go = (next: NoteScreen) => { setView(next); setError('') }
  const notebook: Notebook = { words: MEMORY_WORDS, prefix: '', busy, run, reload, notify }
  const problem = error ? <Alert>{error}</Alert> : null
  // 点开了一条记忆或者在编辑时，整页都是它；否则是基础信息加记忆的列表。
  const content = (data && noteScreen({ ...notebook, notes: data.memory, screen: view, go, problem })) ?? (
    <>
      {problem}
      {data && (
        <>
          {data.warnings.length > 0 && <Alert tone="warn"><span>{data.warnings.join(' ')}</span></Alert>}
          <IdentitySection identity={data.identity} busy={busy} run={run} reload={reload} notify={notify} setError={setError} />
          <NoteList words={MEMORY_WORDS} notes={data.memory} busy={busy} onImport={files => importNotes(notebook, files)}
            onOpen={(note) => { go({ name: 'note', title: note.title }) }} onNew={() => { go({ name: 'edit', title: null }) }} />
        </>
      )}
    </>
  )

  return (
    <div className="campus-settings" ref={page}>
      {content}
      {toast && <Toast key={toast.seq} tone="success" text={toast.text} holdMs={Math.min(4000, 1200 + toast.text.length * 80)} onDone={() => { setToast(null) }} />}
    </div>
  )
}

/** 学院、专业这些基础信息。平时只读，点「编辑」后原地变成输入框。 */
function IdentitySection({ identity, busy, run, reload, notify, setError }: {
  identity: Identity
  busy: boolean
  run: Run
  reload: () => Promise<void>
  notify: (text: string) => void
  setError: (text: string) => void
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  // 学院名录按学部分两级；读不到名录时退回手填。
  const [colleges, setColleges] = useState<SelectOption[]>([])
  const [typingCollege, setTypingCollege] = useState(false)
  useEffect(() => {
    campusApi<{ faculties: { name: string, colleges: string[] }[], others: string[] }>('colleges')
      .then(({ faculties, others }) => {
        const pick = (name: string) => ({ value: name, label: name })
        setColleges([
          ...faculties.map(faculty => ({ value: `学部：${faculty.name}`, label: faculty.name, children: faculty.colleges.map(pick) })),
          ...others.map(pick),
        ])
      })
      .catch(() => { setColleges([]) })
  }, [])
  // 去教务网读一次要几秒到几十秒，期间只有这个按钮在等，页面上别的照常能用。
  const [fetching, setFetching] = useState(false)
  const fetchFromSchool = async () => {
    setFetching(true); setError('')
    try {
      const { changed, note } = await campusApi<{ changed: string[], note?: string }>('identity-refresh')
      notify([changed.length ? `已填入${changed.join('、')}` : '和学校的记录一致', note].filter(Boolean).join('。'))
    } catch (err) { setError(errorText(err)) }
    // 读到一半出错时，学号能算出来的那几项可能已经填上了。
    await reload().catch(() => {})
    setFetching(false)
  }
  const values = identity.values
  const set = (key: string, value: string) => { setDraft(old => old && { ...old, [key]: value }) }

  const save = () => run(async () => {
    await campusApi('identity', { values: draft, revision: identity.revision })
    await reload()
    setDraft(null)
    notify('已保存')
  })

  return (
    <section className="campus-section" aria-label="基础信息">
      <div className="campus-section-head">
        <h2 className="campus-section-title">基础信息</h2>
        {!draft && (
          <div className="campus-actions">
            <Button size="sm" variant="outline" icon={<IconRefreshOutlineRegular size={14} />} disabled={fetching} onClick={() => { void fetchFromSchool() }}>{fetching ? '读取中…' : '从教务网读取'}</Button>
            <Button size="sm" variant="outline" icon={<IconEditOutlineRegular size={14} />} onClick={() => { setDraft({ ...values }); setTypingCollege(false) }}>编辑</Button>
          </div>
        )}
      </div>
      {draft
        ? (
          <form className="campus-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <div className="campus-form-grid">
              {IDENTITY_FIELDS.map(({ key, label, options }) => {
                const id = `campus-identity-${key}`, value = draft[key] ?? ''
                const typed = <input id={id} className="campus-input" type="text" maxLength={150} value={value} disabled={busy} onChange={(event) => { set(key, event.target.value) }} />
                if (key === 'student_level') {
                  return (
                    <Field key={key} label={label}>
                      <Choice label={label} value={value} options={LEVELS} allowEmpty disabled={busy} onChange={(next) => { set(key, next) }} />
                    </Field>
                  )
                }
                if (key === 'college' && colleges.length > 0) {
                  // 名录里没有的学院（比如大一的求是学院）照原样留着，用手填的框显示。
                  const listed = colleges.some(option => option.value === value || option.children?.some(child => child.value === value))
                  if (typingCollege || (value !== '' && !listed)) {
                    return (
                      <Field key={key} id={id} label={label}
                        aside={<button type="button" className="campus-textlink" disabled={busy} onClick={() => { setTypingCollege(false); set(key, '') }}>从名录里选</button>}>
                        {typed}
                      </Field>
                    )
                  }
                  return (
                    <Field key={key} id={id} label={label}>
                      <Select id={id} label={label} value={value} disabled={busy}
                        options={[...colleges, { value: TYPE_COLLEGE, label: '手动填写' }]}
                        onChange={(next) => { if (next === TYPE_COLLEGE) setTypingCollege(true); else set(key, next) }} />
                    </Field>
                  )
                }
                if (options || key === 'grade') {
                  return (
                    <Field key={key} id={id} label={label}>
                      <Select id={id} label={label} value={value} allowEmpty disabled={busy}
                        options={(options ?? YEARS).map(item => ({ value: item, label: item }))} onChange={(next) => { set(key, next) }} />
                    </Field>
                  )
                }
                return <Field key={key} id={id} label={label}>{typed}</Field>
              })}
            </div>
            <div className="campus-form-foot">
              <button type="submit" className="campus-save" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
              <button type="button" className="campus-cancel" disabled={busy} onClick={() => { setDraft(null) }}>取消</button>
            </div>
          </form>
        )
        : (
          <dl className="campus-facts" data-readonly>
            {IDENTITY_FIELDS.filter(({ key }) => key !== 'major_code').map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {values[key] || <span className="campus-unset">未填写</span>}
                  {key === 'major_name' && values.major_code ? <span className="campus-fact-aside">{values.major_code}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
    </section>
  )
}
