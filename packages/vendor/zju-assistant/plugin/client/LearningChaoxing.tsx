/**
 * 学习页切到「超星」时的两栏。学习通上基本只有一门课（大物实验），所以不先列课程，直接是这门课的内容：
 * 左栏是章节目录，一个大章（力学实验、电磁学实验……）一块，标题条点一下展开或收起，下面是它的各节，「资料」栏的文件夹排在最后；
 * 最上面多一块「我的实验」，是本人实验课表上的实验，按上课的先后排（没有课表、对不上时没有这一块）。
 * 点一节，右栏就是它：课件一块、视频一块，一个文件一行，行尾一个小图标下载，下过的变成打开文件夹；视频可以选清晰度。
 * 块的样子和智云那一边学在浙大的章是同一种（style.css 的 .campus-learn-chapter），两边看着是一套东西。
 * 这一边没有总结和讲解。和智云那一边一样先照上一次读到的画，后台再去读。数据和缓存在引擎侧的 host/chaoxing.mjs。
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  FileTypeIcon, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconFolderOpenOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Choice, Select } from './controls.tsx'
import { IconAction, Note, PaneHead, ProgressLine, dayText, failure, move, pluginTitle, useDownloading } from './learnParts.tsx'
import { openRow } from './campus.ts'

interface Course { id: string, title: string, teacher: string, className: string }
/** state：ready 能读，account 学习通的账号还没填，off 插件关着。plugin 是去插件页的哪一项处理。 */
interface Snapshot { state: 'ready' | 'account' | 'off', plugin: string, courses: Course[], fetchedAt: string | null, error: string | null }
/** 视频有两种：original 是老师上传的原文件，playback 是平台的播放版；课件只有 original。 */
type Quality = 'original' | 'playback'
/** 一个文件的一种：id 是它的编号（对下载进度用），saved 是已经在本机，busy 是后台正在下。 */
interface Copy { id: string, saved: boolean, busy: boolean }
/** downloadable 为假是老师没有开放下载。 */
interface CourseFile { name: string, size: string, downloadable: boolean, copies: Partial<Record<Quality, Copy>> }
/** 一节：group 是它归在哪个大章（或「资料」）下面，title 是它自己的名字；location 是整条位置，也是它的编号。 */
interface Section { location: string, group: string, title: string, materials: CourseFile[], videos: CourseFile[] }
/** mine 是本人实验课表上的实验对到的那几节，按上课的先后。 */
interface CoursePage {
  course: Course, sections: Section[], mine: { location: string, date: string | null, time: string }[]
  notOpen: number, warning: string | null, fetchedAt: string | null, error: string | null
}
/** course 是正在看的那门课，page 是它的内容；opened 是目录里点开着的几组，picked 是点中的那一节（都只管正在看的这门课）。 */
interface State { snapshot: Snapshot | null, busy: boolean, error: string, course: string, page: CoursePage | null, opened: readonly string[], picked: string }

/** 和智云那一边一样，状态放在组件外面：离开再回来直接照上一次的画，正在进行的读取也不会断。 */
let state: State = { snapshot: null, busy: false, error: '', course: '', page: null, opened: [], picked: '' }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const update = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener() }

export const useChaoxing = () => useSyncExternalStore(subscribe, () => state)

/** 「我的实验」那一组在 opened 里的名字；章节的名字里不会有这个字符。 */
const MINE = '\u0000mine'
/** 课程不止一门时看哪一门，记在浏览器里。 */
const COURSE_KEY = 'campus.learnChaoxingCourse'
/** 视频下哪一种，记在浏览器里。 */
const QUALITY_KEY = 'campus.learnVideoQuality'
const QUALITIES: readonly { value: Quality, label: string }[] = [{ value: 'original', label: '原画' }, { value: 'playback', label: '流畅' }]

/** 今天的日期，写成「2026-10-10」（本机时间）。 */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 把读到的一门课放上页面。点中的那一节还在就不动；第一次画、或者它不在了，就替用户点一节：
 * 有实验课表时是接下来要上的那个实验（都上完了就是最后一个），没有课表时是第一节；它所在的那一组跟着打开。
 */
function show(page: CoursePage): void {
  if (page.course.id !== state.course) return
  if (page.sections.some(section => section.location === state.picked)) { update({ page }); return }
  const next = page.mine.find(item => (item.date ?? '9999') >= today()) ?? page.mine.at(-1)
  const picked = next?.location ?? page.sections[0]?.location ?? ''
  const group = next ? MINE : page.sections[0]?.group
  update({ page, picked, opened: group === undefined || state.opened.includes(group) ? state.opened : [...state.opened, group] })
}

/** 读正在看的这门课：先照缓存画，refresh 为真时再让后台去学习通读（force 是点了刷新，整门课重读）。 */
async function read(refresh: boolean, force = false): Promise<void> {
  const id = state.course
  if (!id) return
  show(await campusApi<CoursePage>('chaoxing-files', { id }))
  if (refresh) show(await campusApi<CoursePage>('chaoxing-files-refresh', { id, force }))
}

/** 课程表里现在该看哪一门：上次看的那门还在就是它，不然是第一门。换了一门时，那门课的目录从头来。 */
function settle(snapshot: Snapshot): void {
  const wanted = state.course || localStorage.getItem(COURSE_KEY) || ''
  const course = (snapshot.courses.find(item => item.id === wanted) ?? snapshot.courses[0])?.id ?? ''
  update(course === state.course ? { snapshot } : { snapshot, course, page: null, opened: [], picked: '' })
}

/** 切到超星、回到窗口、点刷新时调用。先拿缓存，再让后台去学习通读；刚读过的后台自己会跳过，force 时照读。 */
export async function visitChaoxing(force = false): Promise<void> {
  try {
    settle(await campusApi<Snapshot>('chaoxing-read'))
    update({ error: '' })
    await read(false)
  } catch (error) { update({ error: errorText(error) }); return }
  if (state.busy || state.snapshot?.state !== 'ready') return
  update({ busy: true })
  try {
    settle(await campusApi<Snapshot>('chaoxing-refresh', { force }))
    await read(true, force)
  } catch (error) { update({ error: errorText(error) }) } finally { update({ busy: false }) }
}

/** 换一门课看（课程不止一门时目录上面有个下拉）。 */
function pickCourse(id: string): void {
  localStorage.setItem(COURSE_KEY, id)
  update({ course: id, page: null, opened: [], picked: '' })
  void visitChaoxing()
}

const toggle = (group: string) => { update({ opened: state.opened.includes(group) ? state.opened.filter(item => item !== group) : [...state.opened, group] }) }
/** 这一节有几个课件、几个视频；没有的那种不写。 */
const countText = (section: Section) => [section.materials.length > 0 ? `课件 ${section.materials.length}` : '', section.videos.length > 0 ? `视频 ${section.videos.length}` : ''].filter(Boolean).join(' · ')

/** 目录里的一块：一个大章（或「我的实验」），标题条点一下展开或收起，下面是它的各节。 */
function Chapter({ id, title, count, open, children }: { id: string, title: string, count: number, open: boolean, children: ReactNode }) {
  return (
    <li className="campus-learn-chapter">
      <button type="button" className="campus-learn-chapter-head" aria-expanded={open} onClick={() => { toggle(id) }}>
        {open ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
        <span className="campus-learn-chapter-name">{title}</span>
        <span className="campus-count">{count}</span>
      </button>
      {open && <ul className="campus-learn-chapter-files">{children}</ul>}
    </li>
  )
}

/** 块里的一节：点了右栏就是它的文件（换的时候带动效）。side 是行右边的小字（有几个文件，或者哪天上）。 */
function Leaf({ section, side, current }: { section: Section, side: string, current: boolean }) {
  return (
    <li>
      <button type="button" className="campus-learn-leaf" aria-current={current ? 'true' : undefined} onClick={() => { if (!current) move('swap', () => { update({ picked: section.location }) }) }}>
        <span className="campus-learn-file-name">{section.title}</span>
        {side && <span className="campus-learn-side">{side}</span>}
      </button>
    </li>
  )
}

/** 对一份文件做的事：下载，或者在文件夹里找到它。which 是这个文件的哪一种。 */
type Act = (action: 'chaoxing-download' | 'chaoxing-reveal', file: CourseFile, which: Quality) => void

/**
 * 右栏的一块文件（课件，或者视频）：上面一条标题，下面一个文件一行，前面是文件类型的图标，行尾一个小图标下载。
 * quality 是下哪一种；percents 是正在下的各下到百分之几。这一种文件没有时块里写一句话。
 */
function Files({ label, files, quality, percents, fetching, failed, onAct }: {
  label: string, files: CourseFile[], quality: Quality
  percents: Readonly<Record<string, number | null>>, fetching: readonly string[], failed: Readonly<Record<string, string>>, onAct: Act
}) {
  return (
    <li className="campus-learn-chapter" aria-label={label}>
      <div className="campus-learn-chapter-head" data-static="">
        <span className="campus-learn-chapter-name">{label}</span>
        {files.length > 0 && <span className="campus-count">{files.length}</span>}
      </div>
      <ul className="campus-learn-chapter-files">
        {files.length === 0 && <li className="campus-learn-file" data-empty="">这一节没有{label}。</li>}
        {files.map((file, index) => {
          const which: Quality = file.copies[quality] ? quality : 'original', copy = file.copies[which]!
          const down = copy.busy || fetching.includes(copy.id), percent = down ? percents[copy.id] : null
          // 行右边的小字：下的时候是百分之几，平时是多大。播放版事先不知道多大，不写。
          const side = [percent != null ? `${percent}%` : '', which === 'original' ? file.size : ''].filter(Boolean).join(' · ')
          return (
            <li className="campus-learn-file" key={`${copy.id}\n${index}`}>
              <FileTypeIcon path={file.name} size={18} />
              <span className="campus-learn-file-name">
                {file.name}
                {!copy.saved && !file.downloadable && <span className="campus-note">老师没有开放下载</span>}
                {failed[copy.id] && <span className="campus-form-error">{failed[copy.id]}</span>}
              </span>
              {side && <span className="campus-learn-side">{side}</span>}
              {copy.saved
                ? <IconAction label="打开文件夹" icon={<IconFolderOpenOutlineRegular size={14} />} onClick={() => { onAct('chaoxing-reveal', file, which) }} />
                : file.downloadable && <IconAction label={down ? '下载中' : '下载'} icon={<IconDownloadOutlineRegular size={14} />} disabled={down} onClick={() => { onAct('chaoxing-download', file, which) }} />}
              <ProgressLine percent={percent} />
            </li>
          )
        })}
      </ul>
    </li>
  )
}

/** 超星那一边的两栏：左边目录，右边点中那一节的课件和视频。 */
export function ChaoxingColumns({ now }: { now: number }) {
  const { snapshot, busy, course, page, picked, opened } = useChaoxing()
  const [quality, setQuality] = useState<Quality>(() => localStorage.getItem(QUALITY_KEY) === 'playback' ? 'playback' : 'original')
  /** 这个页面上点了下载、还没回来的那几份，和没下成的各自的原因；按那一份文件的编号记。 */
  const [fetching, setFetching] = useState<readonly string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})

  const sections = page?.sections ?? [], section = sections.find(item => item.location === picked)
  const copies = sections.flatMap(item => [...item.materials, ...item.videos]).flatMap(file => Object.values(file.copies))
  const reread = () => { read(false).catch(() => {}) }
  const percents = useDownloading('chaoxing-downloading', { course }, fetching.length > 0 || copies.some(copy => copy.busy), reread)

  /** group 是课件还是视频（下载走 core 的哪一组命令）。 */
  const act = (group: 'material' | 'video'): Act => (action, file, which) => {
    const id = file.copies[which]!.id
    if (action === 'chaoxing-download') setFetching(old => [...old, id])
    setFailed(({ [id]: _gone, ...rest }) => rest)
    campusApi<CoursePage>(action, { course, location: picked, group, name: file.name, copy: which }).then(show, (reason: unknown) => {
      setFailed(old => ({ ...old, [id]: errorText(reason) }))
      // 打开文件夹没成，多半是文件被挪走了：重读一次，这一行就变回「下载」。
      if (action === 'chaoxing-reveal') reread()
    }).finally(() => { setFetching(old => old.filter(item => item !== id)) })
  }

  // 目录：大章照课程里的顺序各成一块，「我的实验」在最前面。自己就是最上面一层的一节（这门课没有分大章）不套同名的大章，
  // 挨着的几节合成一块，没有标题条。
  const blocks: ({ group: string, items: Section[] } | { loose: Section[] })[] = []
  for (const group of new Set(sections.map(item => item.group))) {
    const items = sections.filter(item => item.group === group), only = items[0]!, last = blocks.at(-1)
    if (items.length > 1 || only.title !== group) blocks.push({ group, items })
    else if (last && 'loose' in last) last.loose.push(only)
    else blocks.push({ loose: [only] })
  }
  const mine = (page?.mine ?? []).flatMap((item) => { const found = sections.find(one => one.location === item.location); return found ? [{ section: found, date: item.date }] : [] })
  const courses = snapshot?.courses ?? [], title = courses.find(item => item.id === course)?.title ?? page?.course.title ?? '章节'
  // 右栏名字下面的小字：它在哪个大章里；是自己要上的实验时带上哪天上。
  const lab = page?.mine.find(item => item.location === picked)
  const where = section ? [section.group !== section.title ? section.group : '', lab?.date ? `${dayText(lab.date, now)}${lab.time ? ` ${lab.time}` : ''} 上课` : ''].filter(Boolean).join(' · ') : ''
  // 目录空着的时候说清楚是哪一种空。
  const empty = !snapshot || snapshot.state !== 'ready' || sections.length > 0 ? ''
    : !course ? (snapshot.fetchedAt ? '超星里没有你的课程。' : busy ? '第一次读取，要等一会儿。' : '')
      : page?.fetchedAt ? '这门课在超星上没有能下载的课件和视频。' : busy ? '第一次读这门课，要一节一节地读，等一会儿。' : ''
  return (
    <div className="campus-affairs-columns">
      <section className="campus-section campus-learn-x" aria-label="章节">
        <div className="campus-section-head">
          {courses.length > 1
            ? <div className="campus-learn-course"><Select label="看哪门课" value={course} options={courses.map(item => ({ value: item.id, label: item.title }))} onChange={pickCourse} /></div>
            : (
              <div className="campus-titleline">
                <h2 className="campus-section-title">{title}</h2>
                {sections.length > 0 && <span className="campus-count">{sections.length}</span>}
              </div>
            )}
        </div>
        {sections.length > 0 && (
          <div className="campus-notice-scroll campus-tree-scroll">
            <ul className="campus-learn-chapters">
              {mine.length > 0 && (
                <Chapter id={MINE} title="我的实验" count={mine.length} open={opened.includes(MINE)}>
                  {mine.map(item => <Leaf key={item.section.location} section={item.section} side={dayText(item.date, now)} current={item.section.location === picked} />)}
                </Chapter>
              )}
              {blocks.map(block => 'loose' in block ? (
                <li className="campus-learn-chapter" data-flat="" key={block.loose[0]!.location}>
                  <ul className="campus-learn-chapter-files">
                    {block.loose.map(item => <Leaf key={item.location} section={item} side={countText(item)} current={item.location === picked} />)}
                  </ul>
                </li>
              ) : (
                <Chapter key={block.group} id={block.group} title={block.group} count={block.items.length} open={opened.includes(block.group)}>
                  {block.items.map(item => <Leaf key={item.location} section={item} side={countText(item)} current={item.location === picked} />)}
                </Chapter>
              ))}
            </ul>
          </div>
        )}
        {empty && <p className="campus-task-empty">{empty}</p>}
        {page && page.notOpen > 0 && <p className="campus-note">还没开放的有 {page.notOpen} 节。</p>}
        {page?.warning && !busy && <Note text={`${page.warning.replace(/[。.]$/, '')}。`} />}
        {snapshot?.state === 'off' && <Note text={`「${pluginTitle(snapshot.plugin)}」在插件页关着，这里不读超星的课程。`} action="去打开" onAction={() => { openRow(snapshot.plugin) }} />}
        {snapshot?.state === 'account' && <Note text={`「${pluginTitle(snapshot.plugin)}」里超星学习通的账号还没填，读不到超星的课程。`} action="去填写" onAction={() => { openRow(snapshot.plugin) }} />}
        {snapshot?.state === 'ready' && snapshot.error && !busy && <Note text={failure('超星', snapshot.fetchedAt, snapshot.error, now)} action="再试一次" onAction={() => { void visitChaoxing(true) }} />}
        {snapshot?.state === 'ready' && !snapshot.error && page?.error && !busy && <Note text={failure('这门课的文件', page.fetchedAt, page.error, now)} action="再试一次" onAction={() => { void visitChaoxing(true) }} />}
      </section>
      {section && (
        <section className="campus-section campus-learn-c" aria-label={section.title}>
          {/* 这一节有视频时，最上面那一行的右边选清晰度（和智云那一边「智云 / 学在浙大」的切换是同一个位置）。 */}
          <PaneHead title={section.title} note={where}
            aside={section.videos.length > 0 ? <Choice label="视频清晰度" value={quality} options={QUALITIES} onChange={(next) => { if (next) { setQuality(next); localStorage.setItem(QUALITY_KEY, next) } }} /> : undefined} />
          <div className="campus-learn-pane">
            <ul className="campus-learn-chapters">
              <Files label="课件" files={section.materials} quality="original" percents={percents} fetching={fetching} failed={failed} onAct={act('material')} />
              <Files label="视频" files={section.videos} quality={quality} percents={percents} fetching={fetching} failed={failed} onAct={act('video')} />
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
