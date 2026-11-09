/**
 * 学习页的数据。两个来源合在一起：
 * 一是智云里本人的课程和每门课的课次，经 ZJU Core 读，各存一份缓存；页面打开时先拿缓存，再让这里去重新读，
 * 这次没读到时上一次的结果原样留着，只记下原因。
 * 二是本机两个文件夹里已经有的东西，每次现扫，不进缓存：
 *   <文档>\CampusAgent\课程\<课程名>\<课次>\   zhiyun download 下的资料（download.json 是清单）和助手写的 总结.md
 *   <文档>\CampusAgent\讲解\                   learn 技能的讲解目录：lessons\<主题>\ 是工作目录，dist\<主题> <标题>.html 是成品
 * 页面不自己拼文件夹的名字：课次的文件夹由 core 在下载时定，这里按清单里的课程编号和第几次课认。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ACCOUNTS, accountReady } from '../accounts.mjs'
import { accountRow } from '../rows.mjs'
import { runCore } from './core.mjs'

/** 读成功以后，这么久之内再进页面不重新读；页面上点刷新不受限制。课次一天变不了几回，比作业宽。 */
const FRESH_MS = 10 * 60_000
/** 读失败以后隔得久一些再自动重试：密码填错时每进一次页面就登录一次，账号可能被锁。 */
const RETRY_MS = 5 * 60_000
/** 早就上完的课（最后一次课在这么久以前），课次不会再变，一天最多读一次。 */
const SETTLED_AFTER_MS = 30 * 24 * 60 * 60_000, SETTLED_FRESH_MS = 24 * 60 * 60_000
const SYSTEM = '智云课堂', PLUGIN = 'zju-courses', ACCOUNT = 'zju'
const SUMMARY = '总结.md'
/** 页面上能下的几种资料，按这个先后排。音频不单列：要转写时由助手去取。 */
const KINDS = [
  { kind: 'ppt', label: '课件', timeoutMs: 10 * 60_000 },
  { kind: 'subtitles', label: '字幕', timeoutMs: 5 * 60_000 },
  { kind: 'slides', label: '课堂截图', timeoutMs: 20 * 60_000 },
  { kind: 'video', label: '回放', timeoutMs: 2 * 60 * 60_000 },
]
/** 从课次来的讲解，主题目录叫 c<课程编号>-<第几次>，成品就能对回那一次课。别的名字是用户自己的资料。 */
const TOPIC = /^c(\d+)-(\d+)$/
export const lessonTopic = (courseId, lesson) => `c${courseId}-${String(lesson).padStart(2, '0')}`

/**
 * 现在是哪个学期：8 月到次年 1 月是秋冬，2 月到 7 月是春夏，按北京时间（和 core/zju/lib/zhiyun/courses.ts 取当前学期的规矩一样）。
 * 课程的学期有两种写法（「2026-2027秋冬」和旧的「2024-2025秋,2024-2025冬」），所以给的是学年和这半年的两个季节，不是一个整串。
 */
export function currentTerm(now) {
  const beijing = new Date(now + 8 * 3600_000), year = beijing.getUTCFullYear(), month = beijing.getUTCMonth() + 1
  const start = month >= 8 ? year : year - 1
  return { years: `${start}-${start + 1}`, seasons: month >= 8 || month === 1 ? '秋冬' : '春夏' }
}
/** 这门课是不是这个学期的：学期里有这个学年，又有这半年的任一个季节。 */
const inTerm = (course, term) => course.term.includes(term.years) && [...term.seasons].some(season => course.term.includes(season))

const accountPlugin = accountRow
const fingerprint = value => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12)
const message = error => error instanceof Error ? error.message : String(error)
/** 课次的开始时刻；core 给的日期和时间是北京时间。没排日期的当作还没上。 */
const startOf = lesson => lesson.date ? Date.parse(`${lesson.date}T${lesson.time || '00:00'}:00+08:00`) : NaN
const part = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const list = (directory) => { try { return fs.readdirSync(directory, { withFileTypes: true }) } catch { return [] } }
const changed = (file) => { try { return fs.statSync(file).mtime.toISOString() } catch { return null } }

/** 一次同时跑几件事，全部做完才返回；单件失败不影响别的（各自记在自己的缓存里）。 */
async function pool(items, size, work) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) await work(items[cursor++]).catch(() => {})
  }))
}

export class Learning {
  /**
   * file 是缓存文件；account 和 plugins 是账号和插件开关；chats 给出 <文档>\CampusAgent 在哪（chats.mjs）；
   * downloads 用来在文件管理器里打开文件夹（downloads.mjs）；run 跑一条 ZJU Core 命令并返回结果里的 data。
   */
  constructor({ file, account, plugins, chats, downloads, run = runCore, now = () => Date.now() }) {
    this.file = file
    this.account = account
    this.plugins = plugins
    this.chats = chats
    this.downloads = downloads
    this.run = run
    this.now = now
    this.running = new Map()
    /** 正在下的资料各下到哪了：键和 running 里下载的那个键一样，值是 { bytes, total }。 */
    this.progress = new Map()
    this.cache = undefined
  }

  /** 缓存：courses 是课程表，lessons 按课程编号放每门课的课次，resources 按「课程编号:第几次」放一次课有哪些资料。 */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    this.cache = { owner: typeof saved?.owner === 'string' ? saved.owner : '', courses: saved?.courses ?? null, lessons: part(saved?.lessons), resources: part(saved?.resources) }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    try { fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  /** 现在能不能读：off 是插件关了，account 是账号还没填；能读时带上账号的指纹。 */
  status() {
    if (this.plugins.disabled().includes(PLUGIN)) return { state: 'off', plugin: PLUGIN }
    const accounts = this.account.read().data
    if (!accountReady(accounts, ACCOUNT)) return { state: 'account', plugin: accountPlugin(ACCOUNT) }
    return { state: 'ready', plugin: PLUGIN, owner: fingerprint(accounts[ACCOUNTS[ACCOUNT].user.key]) }
  }

  /** 这个账号读到的那份缓存；换过账号的不给人看，下一次写的时候整份换掉。 */
  kept(status) {
    const cache = this.load()
    return status.state === 'ready' && cache.owner === status.owner ? cache : { owner: status.owner ?? '', courses: null, lessons: {}, resources: {} }
  }

  recent(entry, force, fresh = FRESH_MS) {
    return !force && !!entry && this.now() - Date.parse(entry.triedAt) < (entry.error ? RETRY_MS : fresh)
  }

  /** 同一件事同一时间只做一次，后来的请求等的是同一次。 */
  once(key, work) {
    let run = this.running.get(key)
    if (!run) {
      run = work().finally(() => { this.running.delete(key) })
      this.running.set(key, run)
    }
    return run
  }

  /**
   * 读一样东西存进缓存的一格：成功换上新的，失败留着旧的、记下原因。place 把新的一格放进整份缓存。
   * retries 是没读到时马上再试几次：到智云的连接偶尔会断，一门课一门课地读，课多了总有一两门碰上。
   * 只给课程表之后的读取用（那时登录已经成了）；课程表自己不重试，密码填错时反复登录账号可能被锁。
   */
  async fetch(status, args, read, before, place, { timeoutMs = 120_000, retries = 0 } = {}) {
    const triedAt = new Date(this.now()).toISOString()
    let entry
    for (let attempt = 0; !entry; attempt++) {
      try { entry = { items: read(await this.run(args, { system: SYSTEM, timeoutMs })), fetchedAt: triedAt, triedAt, error: null } }
      catch (error) { if (attempt >= retries) entry = { items: before?.items ?? [], fetchedAt: before?.fetchedAt ?? null, triedAt, error: message(error) } }
    }
    this.write(place({ ...this.kept(status), owner: status.owner }, entry))
  }

  // ── 本机的两个文件夹 ───────────────────────────────────────

  async roots() {
    const root = await this.chats.root()
    return { courses: path.join(root, '课程'), films: path.join(root, '讲解') }
  }

  /** 课程文件夹里下过东西的每一次课，键是「课程编号:第几次」。只认带清单的文件夹。 */
  async shelf() {
    const { courses } = await this.roots(), found = new Map()
    for (const course of list(courses).filter(entry => entry.isDirectory())) {
      for (const lesson of list(path.join(courses, course.name)).filter(entry => entry.isDirectory())) {
        const dir = path.join(courses, course.name, lesson.name)
        let manifest
        try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'download.json'), 'utf8')) } catch { continue }
        const row = manifest?.lessons?.[0]
        if (manifest?.type !== 'zhiyun-download' || !row) continue
        const files = (Array.isArray(row.files) ? row.files : []).filter(file => typeof file?.path === 'string' && fs.existsSync(file.path))
          .map(file => ({ kind: file.kind === 'courseware' ? 'ppt' : file.kind, name: String(file.name ?? ''), path: file.path }))
        found.set(`${manifest.courseId}:${row.lessonNumber}`, {
          courseId: String(manifest.courseId), title: String(manifest.title ?? course.name), lesson: Number(row.lessonNumber), date: typeof row.startsAt === 'string' ? row.startsAt.slice(0, 10) : null,
          dir, files, summaryAt: changed(path.join(dir, SUMMARY)),
        })
      }
    }
    return found
  }

  /** 讲解目录里的成品和还在做的。成品的文件名是「主题 标题.html」。 */
  async films() {
    const { films } = await this.roots(), found = []
    const done = list(path.join(films, 'dist')).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    for (const entry of done) {
      const name = entry.name.slice(0, -5), cut = name.indexOf(' ')
      found.push({ id: entry.name, topic: cut < 0 ? name : name.slice(0, cut), title: cut < 0 ? name : name.slice(cut + 1), state: 'done', at: changed(path.join(films, 'dist', entry.name)) })
    }
    for (const entry of list(path.join(films, 'lessons')).filter(item => item.isDirectory())) {
      if (found.some(film => film.topic === entry.name)) continue
      found.push({ id: '', topic: entry.name, title: '', state: 'making', at: changed(path.join(films, 'lessons', entry.name)) })
    }
    return found
  }

  // ── 列表 ─────────────────────────────────────────────────

  /**
   * 页面要的全部内容，只看缓存和本机文件夹，不联网。
   * courses 只有本学期的课（智云的「我的课程」里以前学期的也在，用户 2026-10-10 定的只列本学期），按最近一次上课的时间从新到旧；
   * products 是右栏的总结和讲解，新的在上，以前学期的也照列；filmRoot 是讲解目录的位置。
   */
  async snapshot() {
    const status = this.status(), cache = this.kept(status), now = this.now()
    const titles = new Map((cache.courses?.items ?? []).map(course => [course.id, course.title]))
    const current = this.current(cache)
    const courses = current.map((course) => {
      const held = (cache.lessons[course.id]?.items ?? []).filter(lesson => startOf(lesson) <= now)
      const last = held.at(-1)
      return { ...course, count: held.length, last: last ? { lesson: last.lesson, date: last.date } : null, sort: last ? startOf(last) : 0 }
    }).sort((a, b) => b.sort - a.sort || a.title.localeCompare(b.title, 'zh')).map(({ sort: _sort, ...course }) => course)

    const [shelf, films, roots] = await Promise.all([this.shelf(), this.films(), this.roots()])
    const products = []
    for (const held of shelf.values()) {
      if (held.summaryAt) products.push({ kind: 'summary', state: 'done', id: `${held.courseId}:${held.lesson}`, title: held.title, courseId: held.courseId, lesson: held.lesson, at: held.summaryAt })
    }
    for (const film of films) {
      const from = film.topic.match(TOPIC)
      products.push({
        kind: 'film', state: film.state, id: film.id, title: film.title || film.topic, at: film.at,
        ...(from ? { courseId: from[1], lesson: Number(from[2]), course: titles.get(from[1]) ?? [...shelf.values()].find(held => held.courseId === from[1])?.title ?? '' } : {}),
      })
    }
    products.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const errors = [cache.courses?.error, ...current.map(course => cache.lessons[course.id]?.error)].filter(Boolean)
    return { state: status.state, plugin: status.plugin, courses, products, filmRoot: roots.films, fetchedAt: cache.courses?.fetchedAt ?? null, error: errors[0] ?? null }
  }

  /**
   * 缓存里这位学生上过的全部课的名字（智云「我的课程」里各学期的都在）。
   * 对话后的复盘拿它认一个标题是不是课（review.mjs）。插件关着、账号没填、还没读过时是空的。
   */
  courseTitles() {
    try { return [...new Set((this.kept(this.status()).courses?.items ?? []).map(course => course.title).filter(Boolean))] } catch { return [] }
  }

  /** 缓存的课程表里本学期的那几门。 */
  current(cache) {
    const term = currentTerm(this.now())
    return (cache.courses?.items ?? []).filter(course => inTerm(course, term))
  }

  /** 去智云重新读课程表和本学期每门课的课次，读完返回最新的全部内容。刚读过的跳过（force 为真时照读）。 */
  async refresh({ force = false } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return this.snapshot()
    await this.once('courses', async () => {
      const before = this.kept(status).courses
      if (this.recent(before, force)) return
      await this.fetch(status, ['zhiyun', 'search', 'courses', '--scope', 'mine', '--limit', '200'],
        data => (data?.courses ?? []).map(course => ({ id: String(course.courseId), title: String(course.title ?? ''), teacher: String(course.teacher ?? ''), term: String(course.term ?? '') })),
        before, (cache, entry) => ({ ...cache, courses: entry }))
    })
    await pool(this.current(this.kept(status)), 3, course => this.readLessons(status, course.id, force))
    return this.snapshot()
  }

  readLessons(status, id, force) {
    return this.once(`lessons:${id}`, async () => {
      const before = this.kept(status).lessons[id], final = before?.items.at(-1)
      const settled = !!final && this.now() - startOf(final) > SETTLED_AFTER_MS
      if (this.recent(before, force, settled ? SETTLED_FRESH_MS : FRESH_MS)) return
      await this.fetch(status, ['zhiyun', 'search', 'lessons', '--course', id],
        data => (data?.lessons ?? []).map(row => ({ lesson: Number(row.lesson), date: row.date ?? null, time: row.time ?? null, playable: row.playable === true, kinds: Array.isArray(row.kinds) ? row.kinds : [] })),
        before, (cache, entry) => ({ ...cache, lessons: { ...cache.lessons, [id]: entry } }), { retries: 1 })
    })
  }

  // ── 一门课 ───────────────────────────────────────────────

  find(status, id) {
    const course = this.kept(status).courses?.items.find(item => item.id === String(id))
    if (!course) throw new Error('这门课已经不在课程表里了，回到列表刷新一下。')
    return course
  }

  /** 课程表里编号是 id 的那门课，不在了就报错。学在浙大那一边按它的名字和教师去对是哪门课（xuezai.mjs）。 */
  known(id) {
    return this.find(this.status(), id)
  }

  /**
   * 一门课的课次，只看缓存和本机文件夹：已经上过的从新到旧，每一次带上本机有什么（saved 是下了哪几种资料，summary 是有没有总结，
   * film 是讲解做到哪了，做好了的 filmId 是成品的文件名，页面凭它直接放）；upcoming 是还没上的有几次。
   */
  async course({ id } = {}) {
    const status = this.status(), course = this.find(status, id), entry = this.kept(status).lessons[course.id], now = this.now()
    const [shelf, films] = await Promise.all([this.shelf(), this.films()])
    const all = entry?.items ?? [], held = all.filter(lesson => startOf(lesson) <= now)
    return {
      course, upcoming: all.length - held.length, fetchedAt: entry?.fetchedAt ?? null, error: entry?.error ?? null,
      lessons: held.reverse().map((lesson) => {
        const local = shelf.get(`${course.id}:${lesson.lesson}`), film = films.find(item => item.topic === lessonTopic(course.id, lesson.lesson))
        return { ...lesson, saved: [...new Set(local?.files.map(file => file.kind) ?? [])], summary: !!local?.summaryAt, film: film?.state ?? null, ...(film?.state === 'done' ? { filmId: film.id } : {}) }
      }),
    }
  }

  async refreshCourse({ id, force = false } = {}) {
    const status = this.status()
    if (status.state === 'ready') await this.readLessons(status, this.find(status, id).id, force)
    return this.course({ id })
  }

  // ── 一次课 ───────────────────────────────────────────────

  /**
   * 点开一次课时页面要的，只看缓存和本机文件夹。resources 一种资料一行：text 是它的内容（课件的文件名、字幕几句），
   * saved 是已经下到本机，busy 是正在下；没读过完整的时只知道有哪几种（partial 为真）。
   * summary 是这次课的 总结.md 的全文；film 是它的讲解（done 时 id 是成品的文件名）；dir 是这次课的文件夹，还没下过东西时没有。
   */
  async lesson({ course: id, lesson: number } = {}) {
    const status = this.status(), course = this.find(status, id)
    // 以前学期的课不在列表里，课次没人读过；从右栏点它的总结进来时，在这里现读一次。
    if (status.state === 'ready' && !this.kept(status).lessons[course.id]) await this.readLessons(status, course.id, false)
    const cache = this.kept(status)
    const lesson = cache.lessons[course.id]?.items.find(item => item.lesson === Number(number))
    if (!lesson) throw new Error('这次课已经不在课次里了，回到上一页刷新一下。')
    const key = `${course.id}:${lesson.lesson}`, entry = cache.resources[key]
    const [shelf, films, roots] = await Promise.all([this.shelf(), this.films(), this.roots()])
    const local = shelf.get(key), full = new Map((entry?.items ?? []).map(item => [item.kind, item]))
    const resources = KINDS.filter(({ kind }) => entry?.fetchedAt ? full.has(kind) : lesson.kinds.includes(kind)).map(({ kind, label }) => ({
      kind, label, text: full.get(kind)?.text ?? '', saved: local?.files.some(file => file.kind === kind) ?? false, busy: this.running.has(`file:${key}:${kind}`),
    }))
    let summary = null
    if (local?.summaryAt) { try { summary = { text: fs.readFileSync(path.join(local.dir, SUMMARY), 'utf8').slice(0, 300_000), at: local.summaryAt } } catch { /* 刚被挪走，当作没有 */ } }
    const film = films.find(item => item.topic === lessonTopic(course.id, lesson.lesson))
    return {
      course, lesson, resources, partial: !entry?.fetchedAt, summary, film: film ? { state: film.state, id: film.id, title: film.title } : null,
      dir: local?.dir ?? null, topic: lessonTopic(course.id, lesson.lesson), filmRoot: roots.films, fetchedAt: entry?.fetchedAt ?? null, error: entry?.error ?? null,
    }
  }

  /** 去智云读这一次课完整的资料清单，读完返回和 lesson 一样的东西。 */
  async refreshLesson({ course: id, lesson: number, force = false } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return this.lesson({ course: id, lesson: number })
    const course = this.find(status, id), key = `${course.id}:${Number(number)}`
    await this.once(`resources:${key}`, async () => {
      const before = this.kept(status).resources[key]
      if (this.recent(before, force)) return
      await this.fetch(status, ['zhiyun', 'search', 'resources', '--course', course.id, '--lesson', String(Number(number))], (data) => {
        const found = data?.lessons?.[0]?.resources ?? [], of = kind => found.filter(item => item.kind === kind)
        const video = of('video').map(item => Number(item.height)).filter(Number.isFinite).sort((a, b) => b - a)[0]
        return [
          ...(of('ppt').length ? [{ kind: 'ppt', text: of('ppt').map(item => item.name).filter(Boolean).join('、') }] : []),
          ...(of('subtitles')[0]?.count > 0 ? [{ kind: 'subtitles', text: `${of('subtitles')[0].count} 句` }] : []),
          ...(of('slides')[0]?.count > 0 ? [{ kind: 'slides', text: `${of('slides')[0].count} 张` }] : []),
          ...(of('video').length ? [{ kind: 'video', text: video ? `${video}p` : '' }] : []),
        ]
      }, before, (cache, entry) => ({ ...cache, resources: { ...cache.resources, [key]: entry } }), { retries: 1 })
    })
    return this.lesson({ course: id, lesson: number })
  }

  /** 把这次课的一种资料下到本机（位置由 core 定，在 <文档>\CampusAgent\课程 里），下完返回和 lesson 一样的东西。 */
  async download({ course: id, lesson: number, kind } = {}) {
    const status = this.status(), spec = KINDS.find(item => item.kind === kind)
    if (status.state !== 'ready' || !spec) throw new Error('现在下载不了这一项。')
    const course = this.find(status, id), running = `file:${course.id}:${Number(number)}:${kind}`
    await this.once(running, async () => {
      this.progress.set(running, { bytes: 0, total: 0 })
      try {
        const result = await this.run(['zhiyun', 'download', '--course', course.id, '--lesson', String(Number(number)), '--kind', kind],
          { system: SYSTEM, timeoutMs: spec.timeoutMs, onProgress: (state) => { this.progress.set(running, state) } })
        if (!result?.files?.some(file => file.kind === kind)) throw new Error(result?.skipped?.find(item => item.kind === kind)?.reason || '文件没有下载下来，稍后再试。')
      } finally { this.progress.delete(running) }
    })
    return this.lesson({ course: id, lesson: number })
  }

  /**
   * 这次课正在下的资料各下到哪了，按种类给：{ video: { bytes, total } }。页面下载时隔一会儿问一次，只看内存，不碰文件和网络。
   * 刚开始、还没报过进度的也在里面（都是 0）；下完或没下成的不在，页面看到它不在了就重读这次课。
   */
  downloading({ course: id, lesson: number } = {}) {
    const prefix = `file:${String(id)}:${Number(number)}:`
    return Object.fromEntries([...this.progress].filter(([key]) => key.startsWith(prefix)).map(([key, state]) => [key.slice(prefix.length), state]))
  }

  /** 在文件管理器里打开这次课的文件夹，选中这一种资料的第一个文件（kind 是 summary 时选中总结）。只认扫到的路径。 */
  async reveal({ course: id, lesson: number, kind } = {}) {
    const local = (await this.shelf()).get(`${String(id)}:${Number(number)}`)
    const file = kind === 'summary' ? (local?.summaryAt ? path.join(local.dir, SUMMARY) : undefined) : local?.files.find(item => item.kind === kind)?.path
    if (!file || !fs.existsSync(file)) throw new Error('这个文件已经不在原来的位置了，重新下载一次。')
    this.downloads.reveal(file)
    return this.lesson({ course: id, lesson: number })
  }
}
