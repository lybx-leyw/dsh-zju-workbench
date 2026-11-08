/**
 * 学习页右栏切到「学在浙大」时的内容：点中的那门课在学在浙大上的课件，照学在浙大网页上章节的样子，一章一块。
 * 一块是一个带细边的圆角框，最上面一条很淡的灰色标题条（章名加粗；章里分了节的一节一块），点一下展开或收起；
 * 下面是这一章的文件，一个一行：文件类型的图标、文件名（写全，放不下就换行）、右边一个小图标下载，下过的变成打开文件夹。
 * 不写文件多大，也不写它挂在哪个活动上。
 * 课程是智云的，学在浙大上是哪一门由引擎侧按名字和教师去对；对不上的照实说。
 * 和别处一样先照上一次读到的画，后台再去读。数据和缓存在引擎侧的 host/xuezai.mjs。
 */
import { useEffect, useRef, useState } from 'react'
import {
  FileTypeIcon, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconFolderOpenOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { IconAction, Note, ProgressLine, failure, pluginTitle, useDownloading } from './learnParts.tsx'
import { openRow } from './campus.ts'

/** id 是这个文件的编号（下载、对进度用）；saved 是已经在本机，busy 是后台正在下。 */
interface CourseFile { id: string, name: string, video: boolean, saved: boolean, busy: boolean }
/**
 * state：ready 能读，account 账号还没填，off 插件关着；plugin 是去插件页的哪一项处理。
 * matched：学在浙大上对到这门课没有，课程表还没读到过时是 null；name 是它在学在浙大上的名字。
 * groups 一个文件夹一组，照课程里的顺序；title 是章（或「章 / 节」），没有归到章里的那一组是空的。
 */
interface Page {
  state: 'ready' | 'account' | 'off', plugin: string, matched: boolean | null, name: string
  groups: { title: string, files: CourseFile[] }[], count: number, fetchedAt: string | null, error: string | null
}

/** 看过的课上一次读到的内容，和它开着哪几章；再点回来时照原样画。 */
const pages = new Map<string, Page>(), opened = new Map<string, readonly string[]>()
/** 文件不多于这么多个时，各章一开始全开着；再多就只开最后一章（老师多半是一章一章往后传，最后一章是最新的）。 */
const OPEN_ALL = 12
/** 没有归到章里的那几个文件的那一块叫什么（只有别的文件都在章里时才用得上；全都没分章时那一块没有标题）。 */
const LOOSE = '未分章节'

/** course 是这门课在智云的编号，title 是它的名字。换一门课时整个重来（用的地方按课程给 key）。 */
export function XuezaiFiles({ course, title, now }: { course: string, title: string, now: number }) {
  const [data, setData] = useState<Page | null>(() => pages.get(course) ?? null)
  const [open, setOpen] = useState<readonly string[] | null>(() => opened.get(course) ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 这个页面上点了下载、还没回来的那几个，和没下成的各自的原因；按文件的编号记。 */
  const [fetching, setFetching] = useState<readonly string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})
  const live = useRef(true)
  const apply = (next: Page) => { pages.set(course, next); if (live.current) setData(next) }
  const reread = () => { campusApi<Page>('xuezai-files', { course }).then(apply, () => {}) }
  /** 让后台去学在浙大读；force 是点了「再试一次」，刚读过也照读。 */
  const refresh = async (force = false) => {
    if (live.current) { setBusy(true); setError('') }
    try { apply(await campusApi<Page>('xuezai-files-refresh', { course, force })) }
    catch (reason) { if (live.current) setError(errorText(reason)) } finally { if (live.current) setBusy(false) }
  }
  useEffect(() => {
    live.current = true
    void (async () => {
      try { apply(await campusApi<Page>('xuezai-files', { course })) } catch (reason) { if (live.current) setError(errorText(reason)); return }
      await refresh()
    })()
    // 回到窗口时照后台记着的重画一次：文件被挪走了的，这一行变回下载。
    window.addEventListener('focus', reread)
    return () => { live.current = false; window.removeEventListener('focus', reread) }
  }, [course])

  const groups = data?.groups ?? [], files = groups.flatMap(group => group.files)
  // 用户还没动过时，哪几章开着按上面的规矩定；动过以后照他的。
  const shown = open ?? (files.length <= OPEN_ALL ? groups.map(group => group.title) : groups.slice(-1).map(group => group.title))
  const toggle = (folder: string) => {
    const next = shown.includes(folder) ? shown.filter(item => item !== folder) : [...shown, folder]
    opened.set(course, next)
    setOpen(next)
  }
  const down = (file: CourseFile) => file.busy || fetching.includes(file.id)
  const percents = useDownloading('xuezai-downloading', { course }, files.some(down), reread)
  const act = (action: 'xuezai-download' | 'xuezai-reveal', file: CourseFile) => {
    if (action === 'xuezai-download') setFetching(old => [...old, file.id])
    setFailed(({ [file.id]: _gone, ...rest }) => rest)
    campusApi<Page>(action, { course, file: file.id }).then(apply, (reason: unknown) => {
      if (live.current) setFailed(old => ({ ...old, [file.id]: errorText(reason) }))
      // 打开文件夹没成，多半是文件被挪走了：重读一次，这一行就变回下载。
      if (action === 'xuezai-reveal') reread()
    }).finally(() => { if (live.current) setFetching(old => old.filter(item => item !== file.id)) })
  }
  /** 一章里的一个文件。前面的图标是引擎按文件名认出来的类型（PDF、PPT、Word、视频……），所以不另标「视频」。 */
  const row = (file: CourseFile, index: number) => {
    const percent = down(file) ? percents[file.id] : null
    return (
      <li className="campus-learn-file" key={`${file.id}\n${index}`}>
        <FileTypeIcon path={file.name} size={18} />
        <span className="campus-learn-file-name">
          {file.name}
          {failed[file.id] && <span className="campus-form-error">{failed[file.id]}</span>}
        </span>
        {percent != null && <span className="campus-learn-side">{percent}%</span>}
        {file.saved
          ? <IconAction label="打开文件夹" icon={<IconFolderOpenOutlineRegular size={14} />} onClick={() => { act('xuezai-reveal', file) }} />
          : <IconAction label={down(file) ? '下载中' : '下载'} icon={<IconDownloadOutlineRegular size={14} />} disabled={down(file)} onClick={() => { act('xuezai-download', file) }} />}
        <ProgressLine percent={percent} />
      </li>
    )
  }

  const ready = data?.state === 'ready'
  // 空着的时候说清楚是哪一种空：还在第一次读、没对上这门课、还是这门课真的没有课件。
  const empty = !data || !ready || files.length > 0 ? ''
    : data.matched === false ? `学在浙大本学期的课程里没有对上「${title}」。`
      : data.matched && data.fetchedAt ? '这门课在学在浙大上没有课件。'
        : busy ? '第一次读这门课，要等一会儿。' : ''
  // 这门课的文件都没有分章：只有一块，没有标题条。
  const flat = groups.length === 1 && !groups[0]!.title
  return (
    <div className="campus-learn-pane">
      {error && <p className="campus-form-error">{error}</p>}
      {/* 两边的名字不一样时（学在浙大的名字后面常带着班级）写明对到的是哪一门，免得下错。 */}
      {ready && data.matched && data.name && data.name !== title && <p className="campus-note">学在浙大上叫「{data.name}」。</p>}
      {files.length > 0 && (
        <ul className="campus-learn-chapters">
          {groups.map((group) => {
            const chapter = group.title, on = flat || shown.includes(chapter)
            return (
              <li className="campus-learn-chapter" key={chapter} data-flat={flat ? '' : undefined}>
                {!flat && (
                  <button type="button" className="campus-learn-chapter-head" aria-expanded={on} onClick={() => { toggle(chapter) }}>
                    {on ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
                    <span className="campus-learn-chapter-name">{chapter || LOOSE}</span>
                    <span className="campus-count">{group.files.length}</span>
                  </button>
                )}
                {on && <ul className="campus-learn-chapter-files">{group.files.map(row)}</ul>}
              </li>
            )
          })}
        </ul>
      )}
      {empty && <p className="campus-task-empty">{empty}</p>}
      {data?.state === 'off' && <Note text={`「${pluginTitle(data.plugin)}」在插件页关着，这里不读学在浙大的课件。`} action="去打开" onAction={() => { openRow(data.plugin) }} />}
      {data?.state === 'account' && <Note text={`「${pluginTitle(data.plugin)}」还没填好，读不到学在浙大的课件。`} action="去填写" onAction={() => { openRow(data.plugin) }} />}
      {ready && data.error && !busy && <Note text={failure('学在浙大的课件', data.fetchedAt, data.error, now)} action="再试一次" onAction={() => { void refresh(true) }} />}
    </div>
  )
}
