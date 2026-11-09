/**
 * 学习：标题后面的「智云 / 超星」选看哪个平台，两边各是两栏，左栏是目录，右栏是点中那一项的内容。不另开页面，一级一级往下点。
 * 智云：左栏是本人本学期的课程，按最近一次上课的时间排，进来时替用户点好最上面那门；右栏是点中的那门课，
 * 顶上切「智云 / 学在浙大」：智云是它上过的课次，学在浙大是它在学在浙大上的课件（LearningXuezai.tsx）。
 * 再点一次课，左栏换成这门课的课次，右栏是这次课的资料、总结和讲解；在左栏点别的课次直接换，左栏顶上的返回回到课程。
 * 总结和讲解跟着课次走（课次那一行上有标记），不单占一栏；课程列表下面另有一行「总结与讲解」，点了右栏列出做过的全部，
 * 用自己的资料做的讲解、以前学期的课留下的也在里面，一样都没做过时没有这一行。资料可以下到本机，总结和讲解交给助手去做（handoff.tsx）：
 * 都是把写好的话放进新对话的输入框，用户自己发出去。讲解归「课程讲解」这一行，它关着时没有讲解那一块。
 * 换内容时带动效（learnParts.tsx 的 move）：往下点一级，左栏的课程向左淡出，右栏的列表滑到左边当目录，新的内容从右边进来；退回来反着走。
 * 超星：左栏是大物实验这门课的章节目录，右栏是点中那一节的课件和视频下载，没有总结和讲解（LearningChaoxing.tsx）。
 * 做出来的东西落在「文档」里固定的文件夹，页面只是把那里有的画出来，所以助手做完以后回到窗口就能看到。
 * 和校园事务页一样，先照上一次读到的画，后台再去读新的。数据和缓存在引擎侧的 host/learning.mjs。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button, IconDownloadOutlineRegular, IconFolderOpenOutlineRegular, IconNewChatOutlineRegular,
  IconPlayOutlineRegular, IconRefreshOutlineRegular, MarkdownText, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Alert, Choice, Crumb } from './controls.tsx'
import { Flow } from './Flow.tsx'
import { handToAssistant } from './handoff.tsx'
import { ChaoxingColumns, useChaoxing, visitChaoxing } from './LearningChaoxing.tsx'
import { Arrow, IconAction, Note, PaneHead, ProgressLine, dayText, failure, move, pluginTitle, useDownloading, usePluginOn } from './learnParts.tsx'
import { XuezaiFiles } from './LearningXuezai.tsx'
import { openRow } from './campus.ts'
import { agoText, dateText, useNow } from './when.ts'

interface Course { id: string, title: string, teacher: string, term: string }
/** count 是已经上过几次，last 是最近上过的那一次。 */
interface CourseItem extends Course { count: number, last: { lesson: number, date: string | null } | null }
/** 做出来的一样东西。总结的 id 是「课程编号:第几次」，讲解的 id 是成品的文件名；课次来的才有 courseId 和 lesson。 */
interface Product { kind: 'summary' | 'film', state: 'done' | 'making', id: string, title: string, at: string | null, courseId?: string, lesson?: number, course?: string }
/** state：ready 能读，account 账号还没填，off 插件关着。plugin 是去插件页的哪一项处理。 */
interface Snapshot { state: 'ready' | 'account' | 'off', plugin: string, courses: CourseItem[], products: Product[], fetchedAt: string | null, error: string | null }
/** saved 是本机已经下了哪几种资料；film 是这次课的讲解做到哪了，做好了的 filmId 是成品的文件名。 */
interface Lesson { lesson: number, date: string | null, time: string | null, saved: string[], summary: boolean, film: 'done' | 'making' | null, filmId?: string }
interface CoursePage { course: Course, lessons: Lesson[], upcoming: number, fetchedAt: string | null, error: string | null }
interface Resource { kind: string, label: string, text: string, saved: boolean, busy: boolean }
/** partial：只知道有哪几种资料，完整的清单还没读过。topic 是这次课的讲解该用的主题目录名。 */
interface LessonPage {
  course: Course, lesson: { lesson: number, date: string | null, time: string | null }, resources: Resource[], partial: boolean
  summary: { text: string, at: string } | null, film: { state: 'done' | 'making', id: string, title: string } | null
  topic: string, fetchedAt: string | null, error: string | null
}
interface State { snapshot: Snapshot | null, busy: boolean, error: string }

/** 页面的状态放在组件外面：离开这一页再回来直接照上一次的画，正在进行的读取也不会断。 */
let state: State = { snapshot: null, busy: false, error: '' }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const update = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener() }
/** 点开过的课程和课次上一次读到的内容，再点开时先照它画。 */
const courses = new Map<string, CoursePage>(), lessons = new Map<string, LessonPage>()

/** 进页面、回到窗口、点刷新时调用。先拿缓存，再让后台去智云读；刚读过的后台自己会跳过，force 时照读。 */
async function visit(force = false): Promise<void> {
  let snapshot: Snapshot
  try { snapshot = await campusApi<Snapshot>('learning-read') } catch (error) { update({ error: errorText(error) }); return }
  update({ snapshot, error: '' })
  if (state.busy || snapshot.state !== 'ready') return
  update({ busy: true })
  try { update({ snapshot: await campusApi<Snapshot>('learning-refresh', { force }) }) }
  catch (error) { update({ error: errorText(error) }) }
  finally { update({ busy: false }) }
}

/** 看哪个平台。选了哪个记在浏览器里，下次打开还是它。 */
type Source = 'zhiyun' | 'chaoxing'
const SOURCES: readonly { value: Source, label: string }[] = [{ value: 'zhiyun', label: '智云' }, { value: 'chaoxing', label: '超星' }]
const SOURCE_KEY = 'campus.learnSource'
function useSource(): [Source, (next: Source) => void] {
  const [source, setSource] = useState<Source>(() => localStorage.getItem(SOURCE_KEY) === 'chaoxing' ? 'chaoxing' : 'zhiyun')
  return [source, (next) => { setSource(next); localStorage.setItem(SOURCE_KEY, next) }]
}

/** 左栏点中的是哪一项：一门课的编号，或者下面这个「总结与讲解」（课程的编号是数字，不会和它相同）。记在浏览器里，下次进来还是它。 */
const MADE = 'made', MADE_LABEL = '总结与讲解'
const PICK_KEY = 'campus.learnCourse'
/** 右栏看这门课的哪一边：智云的课次，还是学在浙大的课件。换一门课不变，也记在浏览器里。 */
type Side = 'zhiyun' | 'xuezai'
const SIDES: readonly { value: Side, label: string }[] = [{ value: 'zhiyun', label: '智云' }, { value: 'xuezai', label: '学在浙大' }]
const SIDE_KEY = 'campus.learnCourseSide'

const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }

/** 讲解归「课程讲解」这一行，它默认关着；关着时这次课的「讲解」一块不显示，做好的照常能放。 */
const FILM_PLUGIN = 'learn'

/** 讲解在新标签页里放：根行按文件名到讲解目录里找成品，页面带着沙箱（host/film.mjs）。 */
const play = (id: string) => { window.open(`/api/zju-campus/film?name=${encodeURIComponent(id)}`, '_blank', 'noopener') }

/** 总结是按 Markdown 阅读器写的；页面里显示不了的（注释、本机图片、提示块的标记、开头和页面重复的大标题）去掉，文字都留着。 */
const readable = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<table>[\s\S]*?<\/table>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/^> \[![A-Za-z]+\][^\n]*\n/gm, '').replace(/^\s*# [^\n]*\n/, '').trim()

/**
 * 一门课的课次，右栏（点中这门课时）和左栏（点进一次课以后）都用它。先照上一次读到的画，再去智云读；
 * 助手下了资料、写了总结以后回到窗口，标记跟着出现。
 */
function useCourse(id: string): { data: CoursePage | null, busy: boolean, error: string } {
  const [data, setData] = useState<CoursePage | null>(() => courses.get(id) ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(courses.get(id) ?? null)
    setError('')
    const apply = (next: CoursePage) => { courses.set(id, next); if (live) setData(next) }
    void (async () => {
      try {
        apply(await campusApi<CoursePage>('learning-course', { id }))
        if (live) setBusy(true)
        apply(await campusApi<CoursePage>('learning-course-refresh', { id }))
      } catch (reason) { if (live) setError(errorText(reason)) } finally { if (live) setBusy(false) }
    })()
    const again = () => { campusApi<CoursePage>('learning-course', { id }).then(apply, () => {}) }
    window.addEventListener('focus', again)
    return () => { live = false; window.removeEventListener('focus', again) }
  }, [id])
  return { data, busy, error }
}

/** 左栏课程列表里的一行：课程名，下面是老师；右边是最近上过的那一次。点了右栏就是这门课。 */
function CourseRow({ course, now, current, onPick }: { course: CourseItem, now: number, current: boolean, onPick: () => void }) {
  return (
    <article className="campus-notice" aria-current={current ? 'true' : undefined}>
      <div className="campus-notice-main">
        <button type="button" className="campus-notice-open" onClick={onPick}>{course.title}</button>
        {course.teacher && <span className="campus-notice-meta"><span>{course.teacher}</span></span>}
      </div>
      <span className="campus-learn-side">{course.last ? `第 ${course.last.lesson} 次 · ${dayText(course.last.date, now)}` : '还没上过'}</span>
    </article>
  )
}

/**
 * 一行课次：第几次，下面是哪天；右边标出本机已经有的东西，讲解做好了的可以直接放。
 * 在右栏时带箭头，点了往下一级；在左栏当目录时 current 是点中的那一次，不带箭头。
 */
function LessonRow({ lesson, now, current, menu = false, onOpen }: { lesson: Lesson, now: number, current?: boolean, menu?: boolean, onOpen: () => void }) {
  return (
    <article className="campus-notice" aria-current={current ? 'true' : undefined}>
      <div className="campus-notice-main">
        <button type="button" className="campus-notice-open" onClick={onOpen}>第 {lesson.lesson} 次</button>
        <span className="campus-notice-meta"><span>{dayText(lesson.date, now)}{lesson.time ? ` ${lesson.time}` : ''}</span></span>
      </div>
      <span className="campus-learn-tags">
        {lesson.saved.length > 0 && <Tag>已下载</Tag>}
        {lesson.summary && <Tag>总结</Tag>}
        {lesson.film && <Tag>{lesson.film === 'done' ? '讲解' : '讲解在做'}</Tag>}
      </span>
      {!menu && lesson.filmId && <IconAction label="播放讲解" icon={<IconPlayOutlineRegular size={14} />} onClick={() => { play(lesson.filmId!) }} />}
      {!menu && <Arrow />}
    </article>
  )
}

/** 「总结与讲解」里的一行。总结点进那一次课；做好的讲解点了就放；还在做的点不开。 */
function ProductRow({ item, now, onOpen }: { item: Product, now: number, onOpen: () => void }) {
  const from = item.courseId && item.lesson ? `${item.course || '课程'} 第 ${item.lesson} 次` : '自己的资料'
  const title = item.kind === 'summary' ? `${item.title} 第 ${item.lesson} 次` : item.title
  const making = item.state === 'making'
  return (
    <article className="campus-notice" data-idle={making ? '' : undefined}>
      <div className="campus-notice-main">
        {making ? <span className="campus-notice-open">{item.courseId ? from : item.title}</span> : <button type="button" className="campus-notice-open" onClick={onOpen}>{title}</button>}
        <span className="campus-notice-meta">
          <Tag>{item.kind === 'summary' ? '总结' : '讲解'}</Tag>
          {item.kind === 'film' && !making && <span>{from}</span>}
          {making ? <span>正在做</span> : item.at && <time dateTime={item.at}>{agoText(Date.parse(item.at), now)}</time>}
        </span>
      </div>
      {!making && (item.kind === 'film'
        ? <Button className="campus-hand" size="sm" variant="outline" aria-label="播放" tabIndex={-1} icon={<IconPlayOutlineRegular size={14} />} onClick={onOpen} />
        : <Arrow />)}
    </article>
  )
}

/** 右栏：点中的那门课。顶上切看哪一边，智云是它上过的课次（新的在上），学在浙大是它的课件。 */
function CoursePane({ course, side, now, onSide, onOpen }: { course: Course, side: Side, now: number, onSide: (next: Side) => void, onOpen: (lesson: number) => void }) {
  const { data, busy, error } = useCourse(course.id)
  const empty = !data || side !== 'zhiyun' || data.lessons.length > 0 ? '' : busy && !data.fetchedAt ? '第一次读这门课，要等一会儿。' : data.fetchedAt ? '这门课还没有上过的课次。' : ''
  return (
    <section className="campus-section campus-learn-b" aria-label={course.title}>
      <PaneHead title={course.title} note={[course.teacher, course.term].filter(Boolean).join(' · ')}
        aside={<Choice label="看这门课的哪一边" value={side} options={SIDES} onChange={(next) => { if (next) onSide(next) }} />} />
      {side === 'xuezai' ? <XuezaiFiles key={course.id} course={course.id} title={course.title} now={now} /> : (
        <>
          {error && <p className="campus-form-error">{error}</p>}
          {data && (
            <div className="campus-notice-scroll campus-learn-pane">
              <Flow items={data.lessons} keyOf={lesson => String(lesson.lesson)} label="课次">
                {lesson => <LessonRow lesson={lesson} now={now} onOpen={() => { onOpen(lesson.lesson) }} />}
              </Flow>
            </div>
          )}
          {empty && <p className="campus-task-empty">{empty}</p>}
          {data && data.upcoming > 0 && <p className="campus-note">还没上的有 {data.upcoming} 次。</p>}
          {data?.error && !busy && <Note text={failure('这门课的课次', data.fetchedAt, data.error, now)} />}
        </>
      )}
    </section>
  )
}

/** 右栏：点中「总结与讲解」时，做过的全部总结和讲解，新的在上；还在做的讲解也列着。 */
function MadePane({ items, now, onOpen }: { items: readonly Product[], now: number, onOpen: (item: Product) => void }) {
  return (
    <section className="campus-section campus-learn-b" aria-label={MADE_LABEL}>
      <PaneHead title={MADE_LABEL} note="" />
      <div className="campus-notice-scroll campus-learn-pane">
        <Flow items={items} keyOf={item => `${item.kind}:${item.state}:${item.id || item.title}`} label={MADE_LABEL}>
          {item => <ProductRow item={item} now={now} onOpen={() => { onOpen(item) }} />}
        </Flow>
      </div>
    </section>
  )
}

/** 左栏：点进一次课以后，课程列表换成这门课的课次，点哪一次右栏就是哪一次；顶上的返回回到上一级。 */
function LessonMenu({ id, title, number, back, now, onBack, onPick }: { id: string, title: string, number: number, back: string, now: number, onBack: () => void, onPick: (lesson: number) => void }) {
  const { data, busy, error } = useCourse(id)
  return (
    <section className="campus-section campus-learn-menu campus-learn-b" aria-label="课次">
      {/* 返回和这门课的名字排在原来「课程」那一行的位置：往下点一级、再退回来，下面的列表不上下挪。 */}
      <div className="campus-section-head">
        <div className="campus-titleline">
          <Crumb text={back} onBack={onBack} />
          <h2 className="campus-section-title">{data?.course.title ?? title}</h2>
          {data && data.lessons.length > 0 && <span className="campus-count">{data.lessons.length}</span>}
        </div>
      </div>
      {error && <p className="campus-form-error">{error}</p>}
      {data && (
        <div className="campus-notice-scroll campus-learn-pane">
          <Flow items={data.lessons} keyOf={lesson => String(lesson.lesson)} label="课次">
            {lesson => <LessonRow lesson={lesson} now={now} menu current={lesson.lesson === number} onOpen={() => { onPick(lesson.lesson) }} />}
          </Flow>
        </div>
      )}
      {data?.error && !busy && <Note text={failure('这门课的课次', data.fetchedAt, data.error, now)} />}
    </section>
  )
}

/** 右栏：点中的一次课，资料、总结、讲解。先照上一次读到的画，再去智云读完整的资料清单。换一次课时整个重来（用的地方按课次给 key）。 */
function LessonPane({ id, number, now }: { id: string, number: number, now: number }) {
  const key = `${id}:${number}`, input = { course: id, lesson: number }
  const [data, setData] = useState<LessonPage | null>(() => lessons.get(key) ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 正在下载的那几种，和没下成的各自的原因。 */
  const [fetching, setFetching] = useState<readonly string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})
  const live = useRef(true)
  const apply = (next: LessonPage) => { lessons.set(key, next); if (live.current) setData(next) }
  useEffect(() => {
    live.current = true
    void (async () => {
      try {
        apply(await campusApi<LessonPage>('learning-lesson', input))
        if (live.current) setBusy(true)
        apply(await campusApi<LessonPage>('learning-lesson-refresh', input))
      } catch (reason) { if (live.current) setError(errorText(reason)) } finally { if (live.current) setBusy(false) }
    })()
    // 助手做完总结或讲解以后回到窗口，这里跟着出现。
    const again = () => { campusApi<LessonPage>('learning-lesson', input).then(apply, () => {}) }
    window.addEventListener('focus', again)
    return () => { live.current = false; window.removeEventListener('focus', again) }
  }, [key])

  const download = async (kind: string) => {
    setFetching(old => [...old, kind]); setFailed(({ [kind]: _gone, ...rest }) => rest)
    try { apply(await campusApi<LessonPage>('learning-download', { ...input, kind })) }
    catch (reason) { if (live.current) setFailed(old => ({ ...old, [kind]: errorText(reason) })) }
    finally { if (live.current) setFetching(old => old.filter(item => item !== kind)) }
  }
  const reveal = async (kind: string) => {
    try { apply(await campusApi<LessonPage>('learning-reveal', { ...input, kind })) } catch (reason) {
      if (live.current) setFailed(old => ({ ...old, [kind]: errorText(reason) }))
      // 多半是文件被挪走了：重读一次，这一行就变回下载。
      campusApi<LessonPage>('learning-lesson', input).then(apply, () => {})
    }
  }
  const hand = (text: string, send = false) => { handToAssistant(text, { send }).catch((reason: unknown) => { if (live.current) setError(errorText(reason)) }) }
  const filmOn = usePluginOn(FILM_PLUGIN)

  const course = data?.course, lesson = data?.lesson
  // 交给助手时替用户写好的话。课程名、第几次照原样写，助手要拿它们去智云找；日期写具体的，过几天再看也不会错。
  const which = course && lesson ? `智云上《${course.title}》第 ${lesson.lesson} 次课（${[lesson.date ? dateText(new Date(`${lesson.date}T00:00:00`).getTime(), now) : '', course.teacher ? `${course.teacher}老师` : ''].filter(Boolean).join('，')}）` : ''
  const askSummary = () => { hand(`帮我总结${which}。先把这次课的课件和字幕下载到本机，没有字幕就下回放转写；通读以后按笔记模板写，存成这次课文件夹里的「总结.md」。写完告诉我有没有作业和要注意的事。`) }
  // 讲解的这段话是定好的，点了就发：用哪个技能、讲哪次课、资料从哪来、主题目录叫什么（页面靠这个名字把成品对回这一次课）。
  const askFilm = () => { hand(`加载 zju-campus 技能，照其中课程讲解的做法，把${which}讲给我听。资料是这次课的课件、课堂截图和字幕：这次课的文件夹里还没有的先下载，没有字幕就下回放转写。讲解的主题目录叫 ${data?.topic ?? ''}，建在讲解目录的 lessons 里。`, true) }

  const down = (item: Resource) => item.busy || fetching.includes(item.kind)
  // 有一种在下的时候隔一会儿问后台下到哪了；后台说它下完了（离开这一页再回来时是这样知道的）就重读这次课。
  const percents = useDownloading('learning-downloading', input, (data?.resources ?? []).some(down), () => { campusApi<LessonPage>('learning-lesson', input).then(apply, () => {}) })
  const film = data?.film ?? null
  const when = lesson ? `${dayText(lesson.date, now)}${lesson.time ? ` ${lesson.time}` : ''}` : ''
  return (
    <section className="campus-section campus-learn-c" aria-label={`第 ${number} 次`}>
      <PaneHead title={`第 ${number} 次`} note={[when, course?.teacher].filter(Boolean).join(' · ')} />
      {error && <p className="campus-form-error">{error}</p>}
      {data && (
        <div className="campus-learn-pane campus-learn-lesson">
          <section className="campus-section" aria-label="资料">
            <div className="campus-titleline">
              <h3 className="campus-section-title">资料</h3>
              {data.resources.length > 0 && <span className="campus-count">{data.resources.length}</span>}
            </div>
            {data.resources.length > 0 ? (
              <ul className="campus-rows">
                {data.resources.map((item) => {
                  const percent = down(item) ? percents[item.kind] : null
                  return (
                    <li className="campus-row" key={item.kind}>
                      <span className="campus-learn-kind">{item.label}</span>
                      <span className="campus-task-file">
                        {item.text}
                        {failed[item.kind] && <span className="campus-form-error">{failed[item.kind]}</span>}
                      </span>
                      {percent != null && <span className="campus-learn-side">{percent}%</span>}
                      {item.saved
                        ? <IconAction label="打开文件夹" icon={<IconFolderOpenOutlineRegular size={14} />} onClick={() => { void reveal(item.kind) }} />
                        : <IconAction label={down(item) ? '下载中' : '下载'} icon={<IconDownloadOutlineRegular size={14} />} disabled={down(item)} onClick={() => { void download(item.kind) }} />}
                      <ProgressLine percent={percent} />
                    </li>
                  )
                })}
              </ul>
            ) : <p className="campus-unset">{busy ? '第一次读这次课，要等一会儿。' : '这次课在智云上没有能下载的资料。'}</p>}
            {data.error && !busy && <Note text={failure('这次课的资料', data.fetchedAt, data.error, now)} />}
          </section>
          <section className="campus-section" aria-label="总结">
            <div className="campus-section-head">
              <h3 className="campus-section-title">总结</h3>
              {data.summary
                ? <IconAction label="打开文件夹" icon={<IconFolderOpenOutlineRegular size={14} />} onClick={() => { void reveal('summary') }} />
                : <Button size="sm" variant="outline" icon={<IconNewChatOutlineRegular size={14} />} onClick={askSummary}>让助手总结这次课</Button>}
            </div>
            {failed['summary'] && <p className="campus-form-error">{failed['summary']}</p>}
            {data.summary
              ? <div className="campus-markdown"><MarkdownText text={readable(data.summary.text)} labels={MARKDOWN_LABELS} /></div>
              : <p className="campus-unset">这次课还没有总结。</p>}
          </section>
          {(filmOn || film) && <section className="campus-section" aria-label="讲解">
            <div className="campus-section-head">
              <h3 className="campus-section-title">讲解</h3>
              {film?.state === 'done' && <Button size="sm" variant="outline" icon={<IconPlayOutlineRegular size={14} />} onClick={() => { play(film.id) }}>播放</Button>}
              {!film && filmOn === true && <Button size="sm" variant="outline" icon={<IconNewChatOutlineRegular size={14} />} onClick={askFilm}>让助手讲这次课</Button>}
            </div>
            {film?.state === 'done' ? <p className="campus-learn-film">{film.title}</p> : <p className="campus-unset">{film ? '讲解正在做。' : '这次课还没有讲解。'}</p>}
          </section>}
        </div>
      )}
    </section>
  )
}

export function LearningPage() {
  const { snapshot, busy, error } = useSyncExternalStore(subscribe, () => state)
  const chaoxing = useChaoxing()
  const now = useNow()
  const [source, setSource] = useSource()
  /** 左栏点中的那一项（一门课或「总结与讲解」）；记着的那一项不在了时用下面算出来的 current。 */
  const [picked, setPicked] = useState(() => localStorage.getItem(PICK_KEY) ?? '')
  const [side, setSide] = useState<Side>(() => localStorage.getItem(SIDE_KEY) === 'xuezai' ? 'xuezai' : 'zhiyun')
  /** 点进去的那一次课；空着时左栏是课程。 */
  const [opened, setOpened] = useState<{ course: string, lesson: number } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 只去读选中的那个平台。
    const refresh = () => { void (source === 'zhiyun' ? visit() : visitChaoxing()) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [source])
  useEffect(() => { page.current?.scrollTo({ top: 0 }) }, [opened?.course, opened?.lesson])

  const list = snapshot?.courses ?? [], made = snapshot?.products ?? []
  // 现在点中的：记着的那一项还在就是它，不然是最上面那门课（最近上过的）；一门课也没有时是「总结与讲解」。
  const current = (picked === MADE ? made.length > 0 : list.some(course => course.id === picked)) ? picked : list[0]?.id ?? (made.length > 0 ? MADE : '')
  const course = list.find(item => item.id === current)
  const pick = (id: string) => { if (id !== current) move('swap', () => { setPicked(id); localStorage.setItem(PICK_KEY, id) }) }
  const titleOf = (id: string) => list.find(item => item.id === id)?.title ?? courses.get(id)?.course.title ?? ''
  /** 点进一次课（往下一级）；已经在这一级时是换一次课。 */
  const enter = (id: string, lesson: number) => { move(opened ? 'swap' : 'in', () => { setOpened({ course: id, lesson }) }) }
  const open = (item: Product) => {
    if (item.kind === 'film') play(item.id)
    else if (item.courseId && item.lesson) enter(item.courseId, item.lesson)
  }

  // 列表空着的时候说清楚是哪一种空：真的没有、还在第一次读、还是根本没法读（下面另有说明）。
  const empty = !snapshot || list.length > 0 || snapshot.state !== 'ready' ? ''
    : snapshot.fetchedAt ? '智云里没有你本学期的课程。' : busy ? '第一次读取，要等一会儿。' : ''
  // 标题右边的「几分钟前更新」和刷新，说的是选中的那个平台；超星那一边是正在看的那门课的文件什么时候读的。
  const shown = source === 'zhiyun' ? { fetchedAt: snapshot?.fetchedAt, busy, error } : { fetchedAt: chaoxing.page?.fetchedAt ?? chaoxing.snapshot?.fetchedAt, busy: chaoxing.busy, error: chaoxing.error }
  const reload = () => { void (source === 'zhiyun' ? visit(true) : visitChaoxing(true)) }
  return (
    <div className="campus-page campus-learn" ref={page}>
      <header className="campus-page-head">
        {/* 切换跟着标题放在左边：右边「几分钟前更新」那几个字时有时无、长短会变，和它排在一头会被挤着左右挪。 */}
        <div className="campus-learn-title">
          <h1 className="campus-page-title">学习</h1>
          <Choice label="看哪个平台" value={source} options={SOURCES} onChange={(next) => { if (next) move('swap', () => { setSource(next) }) }} />
        </div>
        <div className="campus-actions">
          {shown.fetchedAt && <span className="campus-note">{agoText(Date.parse(shown.fetchedAt), now)}更新</span>}
          <button type="button" className="campus-refresh" aria-label="刷新" title="刷新" aria-busy={shown.busy} onClick={reload}>
            <IconRefreshOutlineRegular size={16} />
          </button>
        </div>
      </header>
      {shown.error && <Alert>{shown.error}</Alert>}
      {source === 'chaoxing' ? <ChaoxingColumns now={now} /> : opened ? (
        <div className="campus-affairs-columns">
          <LessonMenu id={opened.course} title={titleOf(opened.course)} number={opened.lesson} back={current === MADE ? MADE_LABEL : '课程'} now={now}
            onBack={() => { move('out', () => { setOpened(null) }); void visit() }} onPick={(lesson) => { if (lesson !== opened.lesson) enter(opened.course, lesson) }} />
          <LessonPane key={`${opened.course}:${opened.lesson}`} id={opened.course} number={opened.lesson} now={now} />
        </div>
      ) : (
        <div className="campus-affairs-columns">
          <section className="campus-section campus-learn-a" aria-label="课程">
            <div className="campus-section-head">
              <div className="campus-titleline">
                <h2 className="campus-section-title">课程</h2>
                {list.length > 0 && <span className="campus-count">{list.length}</span>}
              </div>
            </div>
            {snapshot && (
              <div className="campus-notice-scroll">
                <Flow items={list} keyOf={item => item.id} label="课程">
                  {item => <CourseRow course={item} now={now} current={item.id === current} onPick={() => { pick(item.id) }} />}
                </Flow>
              </div>
            )}
            {empty && <p className="campus-task-empty">{empty}</p>}
            {made.length > 0 && (
              <article className="campus-notice campus-learn-made" aria-current={current === MADE ? 'true' : undefined}>
                <div className="campus-notice-main"><button type="button" className="campus-notice-open" onClick={() => { pick(MADE) }}>{MADE_LABEL}</button></div>
                <span className="campus-learn-side">{made.length}</span>
              </article>
            )}
            {snapshot?.state === 'off' && <Note text={`「${pluginTitle(snapshot.plugin)}」在插件页关着，这里不读智云的课程。`} action="去打开" onAction={() => { openRow(snapshot.plugin) }} />}
            {snapshot?.state === 'account' && <Note text={`「${pluginTitle(snapshot.plugin)}」还没填好，读不到智云的课程。`} action="去填写" onAction={() => { openRow(snapshot.plugin) }} />}
            {snapshot?.state === 'ready' && snapshot.error && !busy && <Note text={failure('智云', snapshot.fetchedAt, snapshot.error, now)} action="再试一次" onAction={() => { void visit(true) }} />}
          </section>
          {course && <CoursePane key={course.id} course={course} side={side} now={now} onSide={(next) => { move('swap', () => { setSide(next); localStorage.setItem(SIDE_KEY, next) }) }} onOpen={(lesson) => { enter(course.id, lesson) }} />}
          {current === MADE && <MadePane items={made} now={now} onOpen={open} />}
        </div>
      )}
    </div>
  )
}
