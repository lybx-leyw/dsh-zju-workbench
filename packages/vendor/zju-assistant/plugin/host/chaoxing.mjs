/**
 * 学习页「超星」那一边的数据：学习通里本人的课程，和一门课各章节里的课件、视频。经 ZJU Core 读，各存一份缓存；
 * 和智云那一边（learning.mjs）一样，页面先拿缓存，再让这里去重新读，这次没读到时上一次的结果原样留着，只记下原因。
 * 一门课的文件要一节一节地读（三十节约十秒），所以整门课一次读回来，页面上点哪一节都不用再等。
 * 另外读本人的实验课表（lab timetable），把课表上的实验对到这门课的哪一节，页面按上课的先后把它们排在最前面；
 * 读不到、对不上的就没有这一块，不报错。
 * 下载交给 core，落在 <文档>\CampusAgent\课程\<课程名>\<章节>\ 里。文件具体在哪由 core 定，下完它会说，
 * 这里把路径记下来，页面凭它认「已下载」和打开文件夹；文件被挪走了就当作没下过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ACCOUNTS, accountReady } from '../accounts.mjs'
import { accountRow } from '../rows.mjs'
import { runCore } from './core.mjs'

/** 课程表读成功以后，这么久之内再进页面不重新读；页面上点刷新不受限制。 */
const FRESH_MS = 10 * 60_000
/** 读失败以后隔得久一些再自动重试：密码填错时每进一次页面就登录一次，平台会要验证码。 */
const RETRY_MS = 5 * 60_000
/** 一门课的文件清单 core 自己留半小时，这里问得再勤拿到的也是同一份；实验课表也按这个间隔读。点刷新时两样都重读。 */
const FILES_FRESH_MS = 30 * 60_000
const SYSTEM = '超星', PLUGIN = 'zju-courses', ACCOUNT = 'chaoxing'
/** 实验课表在另一个插件里（课程与作业），账号也是另一个。 */
const LAB_SYSTEM = '实验课选课平台', LAB_PLUGIN = 'zju-courses', LAB_ACCOUNT = 'lab'
/** 文件分两组，和 core 的两组命令（chaoxing material、chaoxing video）对应；rows 是 chapter list 结果里的哪一项。 */
const GROUPS = {
  material: { rows: 'materials', copies: ['original'], timeoutMs: 20 * 60_000 },
  // 视频有两种：original 是老师上传的原文件，playback 是平台的播放版（720p 左右，小得多）。两种分开存、分开记。
  video: { rows: 'videos', copies: ['original', 'playback'], timeoutMs: 2 * 60 * 60_000 },
}

const accountPlugin = accountRow
const fingerprint = value => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12)
const message = error => error instanceof Error ? error.message : String(error)
const part = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
/** 课程名用作文件夹名：去掉文件夹名里不能有的符号。 */
const folderName = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '未分类'
/** 一份文件的编号：哪一节、哪一组、叫什么、哪一种。记下载位置、认正在下的是哪个、页面上对进度，用的都是它。 */
const copyId = (location, group, name, copy) => [location, group, name, copy].join('\n')
/** 学习通的教师一栏常是一长串名字：超过三位只写前三位。 */
function people(text) {
  const names = String(text ?? '').split(/[,，、;；]+/).map(name => name.trim()).filter(Boolean)
  return names.length > 3 ? `${names.slice(0, 3).join('、')}等 ${names.length} 位` : names.join('、')
}

/**
 * core 给的一门课 → 缓存里的一条。link 是课程页面的地址，以后原样交回 core 指这门课（名字会重、会互相包含，链接不会）；
 * 页面用的编号取链接里的课程号和班级号。
 */
function courseOf(row) {
  let query
  try { query = new URL(row?.link).searchParams } catch { return [] }
  const id = `${query.get('courseid')}-${query.get('clazzid')}`
  return /^\d+-\d+$/.test(id) ? [{ id, title: String(row.name ?? ''), teacher: people(row.teacher), className: String(row.class ?? ''), link: String(row.link) }] : []
}
const filesOf = list => (Array.isArray(list) ? list : []).map(file => ({ name: String(file?.name ?? ''), size: typeof file?.size === 'string' ? file.size : '', downloadable: file?.downloadable !== false }))
/** 位置是「大章 / 小节」或「资料 / 文件夹」：第一段是它归在哪一类下面，后面的是这一节自己的名字（只有一段时两样相同）。 */
function placed(location) {
  const parts = location.split(' / ')
  return { location, group: parts[0], title: parts.length > 1 ? parts.slice(1).join(' / ') : parts[0] }
}
const shown = ({ link: _link, ...course }) => course

// ── 实验课表上的实验名对到哪一节 ─────────────────────────────
// 课表和学习通的叫法不完全一样（「金属材料杨氏模量的测定」对「2.1 金属材料杨氏模量的测量」，课表上还会带「▲」）。
// 规矩照 core 里 chaoxing 的 --chapter（core/zju/lib/chaoxing/cli.ts 的 chapterScope 和 similarity），改那边时这里跟着改：
// 先看去掉序号和符号后是不是同一个名字，再看哪一节的名字里包含它，都没有时找只差一两个字的；同样像的有两节就不认。

const bare = text => [...String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/^[\d.]+/, '').replace(/[^\p{L}\p{N}]/gu, '')]
/** 最长公共子序列的长度。 */
function common(a, b) {
  let row = new Array(b.length + 1).fill(0)
  for (const x of a) {
    const next = [0]
    for (let j = 0; j < b.length; j++) next.push(x === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]))
    row = next
  }
  return row[b.length]
}
/** 两个名字有多像（0..1）：公共子序列占较短一方的比例；共同的字不到 4 个，或只占较长一方不到六成的不算像。 */
function similarity(x, y) {
  const both = common(x, y)
  return both >= 4 && both / Math.max(x.length, y.length) >= 0.6 ? both / Math.min(x.length, y.length) : 0
}
/** titles 里和 name 是同一个实验的那一个的下标；对不上或者分不清是哪一个时是 -1。 */
export function matchTitle(name, titles) {
  const wanted = bare(name), text = wanted.join(''), all = titles.map(bare)
  if (wanted.length < 2) return -1
  const only = hits => hits.length === 1 ? hits[0] : -1
  const same = all.flatMap((title, index) => title.join('') === text ? [index] : [])
  if (same.length) return only(same)
  const inside = all.flatMap((title, index) => title.join('').includes(text) ? [index] : [])
  if (inside.length) return only(inside)
  const close = all.map((title, index) => ({ index, score: similarity(wanted, title) })).filter(row => row.score >= 0.85).sort((a, b) => b.score - a.score)
  return close.length && (close.length === 1 || close[0].score - close[1].score >= 0.1) ? close[0].index : -1
}
/**
 * 课表上的一项对到的各节，一般是一节。两周连做的会写成「组合1：▲甲实验+乙实验（2周）」，一项里有两个实验：
 * 整个名字对不上时，去掉冒号前面的编号和末尾括号里的说明，按加号拆开，各对各的。
 */
export function matchTitles(name, titles) {
  const whole = matchTitle(name, titles)
  if (whole >= 0) return [whole]
  const inner = String(name).replace(/^[^：:]*[：:]/, '').replace(/[（(][^（()）]*[)）]\s*$/, '')
  if (inner === String(name) && !/[+＋]/.test(inner)) return []
  return [...new Set(inner.split(/[+＋]/).map(part => matchTitle(part, titles)).filter(index => index >= 0))]
}

export class Chaoxing {
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
    /** 正在下的文件各下到哪了：键和 running 里下载的那个键一样，值是 { bytes, total }。 */
    this.progress = new Map()
    this.cache = undefined
  }

  /**
   * 缓存：courses 是课程表，files 按课程编号放每门课各节的文件，saved 按课程编号记下载过的每一份在哪，
   * labs 是实验课表（另一个账号读的，自己带着是谁读的）。
   */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    this.cache = { owner: typeof saved?.owner === 'string' ? saved.owner : '', courses: saved?.courses ?? null, files: part(saved?.files), saved: part(saved?.saved), labs: saved?.labs ?? null }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    try { fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  /** 现在能不能读：off 是插件关了，account 是学习通的账号还没填；能读时带上账号的指纹。 */
  status() {
    if (this.plugins.disabled().includes(PLUGIN)) return { state: 'off', plugin: PLUGIN }
    const accounts = this.account.read().data
    if (!accountReady(accounts, ACCOUNT)) return { state: 'account', plugin: accountPlugin(ACCOUNT) }
    return { state: 'ready', plugin: PLUGIN, owner: fingerprint(accounts[ACCOUNTS[ACCOUNT].user.key]) }
  }

  /** 这个账号读到的那份缓存；换过账号的不给人看，下一次写的时候整份换掉。 */
  kept(status) {
    const cache = this.load()
    return status.state === 'ready' && cache.owner === status.owner ? cache : { owner: status.owner ?? '', courses: null, files: {}, saved: {}, labs: null }
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
   * 读一样东西存进缓存的一格：成功换上新的，失败留着旧的、记下原因。read 把 core 的结果变成这一格的内容，place 把它放进整份缓存。
   * 没读到不马上重试：多半是登录没过或者平台要验证码，再试只会更糟。
   */
  async fetch(status, args, read, before, place, { system = SYSTEM, timeoutMs = 120_000 } = {}) {
    const triedAt = new Date(this.now()).toISOString()
    let entry
    try { entry = { ...read(await this.run(args, { system, timeoutMs })), fetchedAt: triedAt, triedAt, error: null } }
    catch (error) { entry = { ...before, items: before?.items ?? [], fetchedAt: before?.fetchedAt ?? null, triedAt, error: message(error) } }
    this.write(place({ ...this.kept(status), owner: status.owner }, entry))
  }

  /** 这门课记着的下载里现在还在原处的：键是那一份文件的编号，值是文件的路径。 */
  held(cache, id) {
    return new Map(Object.entries(part(cache.saved[id])).filter(([, file]) => typeof file === 'string' && fs.existsSync(file)))
  }

  // ── 课程 ─────────────────────────────────────────────────

  /** 页面要的课程列表，只看缓存，不联网。顺序照学习通自己的。 */
  async snapshot() {
    const status = this.status(), cache = this.kept(status)
    return { state: status.state, plugin: status.plugin, fetchedAt: cache.courses?.fetchedAt ?? null, error: cache.courses?.error ?? null, courses: (cache.courses?.items ?? []).map(shown) }
  }

  /** 去学习通重新读课程表，读完返回最新的列表。刚读过的跳过（force 为真时照读）。 */
  async refresh({ force = false } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return this.snapshot()
    await this.once('courses', async () => {
      const before = this.kept(status).courses
      if (this.recent(before, force)) return
      await this.fetch(status, ['chaoxing', 'course', 'list'], data => ({ items: (data?.courses ?? []).flatMap(courseOf) }), before, (cache, entry) => ({ ...cache, courses: entry }))
    })
    return this.snapshot()
  }

  // ── 一门课的文件 ─────────────────────────────────────────

  find(status, id) {
    const course = this.kept(status).courses?.items.find(item => item.id === String(id))
    if (!course) throw new Error('这门课已经不在超星的课程里了，刷新一下。')
    return course
  }

  /** 实验课表读不读得了：那个插件开着、实验课的账号填了。读得了时给出是谁的（指纹），读不了是空的。 */
  labOwner() {
    if (this.plugins.disabled().includes(LAB_PLUGIN)) return ''
    const accounts = this.account.read().data, user = accounts[ACCOUNTS[LAB_ACCOUNT].user.key] || accounts[ACCOUNTS.zju.user.key]
    return accountReady(accounts, LAB_ACCOUNT) && user ? fingerprint(user) : ''
  }

  /**
   * 一门课的全部内容，只看缓存：sections 是有文件的各节，照课程里的顺序，章节在前，「资料」栏的文件夹在后；
   * 每一节有 group（归在哪个大章下面，页面按它排成目录）、title，和 materials、videos 两组文件。
   * 一个文件带着它的每一种（copies：课件只有 original，视频还有 playback）各自的编号、是否已经在本机、是否正在下。
   * mine 是本人实验课表上的实验对到的那几节，按上课的先后；没有课表或者对不上时是空的。
   * notOpen 是还没开放的有几节；warning 是资料栏没读到时的原因。
   */
  async files({ id } = {}) {
    const status = this.status(), course = this.find(status, id), cache = this.kept(status), entry = cache.files[course.id]
    const held = this.held(cache, course.id)
    const sections = (entry?.items ?? []).map(section => ({
      ...placed(section.location),
      ...Object.fromEntries(Object.entries(GROUPS).map(([group, { rows, copies }]) => [rows, section[rows].map(file => ({
        ...file, copies: Object.fromEntries(copies.map((copy) => {
          const key = copyId(section.location, group, file.name, copy)
          return [copy, { id: key, saved: held.has(key), busy: this.running.has(`file:${course.id}:${key}`) }]
        })),
      }))])),
    }))
    return { course: shown(course), sections, mine: this.mine(cache, sections), notOpen: entry?.notOpen ?? 0, warning: entry?.warning ?? null, fetchedAt: entry?.fetchedAt ?? null, error: entry?.error ?? null }
  }

  /** 实验课表上的每次实验对到这门课的哪一节：一节只列一次，取最早的那一次课；资料栏的文件夹不参与。 */
  mine(cache, sections) {
    const labs = cache.labs
    if (!labs || labs.owner !== this.labOwner()) return []
    const chapters = sections.filter(section => section.group !== '资料'), titles = chapters.map(section => section.title), found = []
    for (const session of labs.items) {
      for (const section of matchTitles(session.experiment, titles).map(index => chapters[index])) {
        if (!found.some(item => item.location === section.location)) found.push({ location: section.location, date: session.date, time: session.start })
      }
    }
    return found
  }

  /** 去学习通读这门课各节的文件，顺带读实验课表，读完返回和 files 一样的东西。force 为真时不用 core 留着的那份清单，整门课重读。 */
  async refreshFiles({ id, force = false } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return this.files({ id })
    const course = this.find(status, id)
    await Promise.all([
      this.once(`files:${course.id}`, async () => {
        const before = this.kept(status).files[course.id]
        if (this.recent(before, force, FILES_FRESH_MS)) return
        await this.fetch(status, ['chaoxing', 'chapter', 'list', `--course=${course.link}`, ...(force ? ['--fresh'] : [])], data => ({
          items: (data?.chapters ?? []).map(row => ({ location: String(row?.location ?? ''), materials: filesOf(row?.materials), videos: filesOf(row?.videos) })),
          notOpen: Array.isArray(data?.notOpen) ? data.notOpen.length : 0, warning: typeof data?.warning === 'string' ? data.warning : null,
        }), before, (cache, entry) => ({ ...cache, files: { ...cache.files, [course.id]: entry } }), { timeoutMs: 5 * 60_000 })
      }),
      this.readLabs(status, force),
    ])
    return this.files({ id })
  }

  /** 读本人的实验课表存进缓存。读不了（插件关着、账号没填）就不读；没读到时留着上一次的，页面上不为它报错。 */
  readLabs(status, force) {
    const owner = this.labOwner()
    if (!owner) return Promise.resolve()
    return this.once('labs', async () => {
      const held = this.kept(status).labs, before = held?.owner === owner ? held : null
      if (this.recent(before, force, FILES_FRESH_MS)) return
      await this.fetch(status, ['lab', 'timetable'], data => ({
        owner, items: (data?.sessions ?? []).map(row => ({ date: typeof row?.date === 'string' ? row.date : null, start: String(row?.start ?? ''), experiment: String(row?.experiment ?? '') })).filter(row => row.experiment),
      }), before ?? { owner }, (cache, entry) => ({ ...cache, labs: entry }), { system: LAB_SYSTEM })
    })
  }

  // ── 下载 ─────────────────────────────────────────────────

  /** 清单里的这一份文件：是哪门课的、走哪一组命令、它的编号。位置、名字、种类都得是清单里有的。 */
  locate(status, { course: id, location, group, name, copy = 'original' } = {}) {
    const course = this.find(status, id), spec = GROUPS[group]
    if (!spec?.copies.includes(copy)) throw new Error('现在下载不了这一项。')
    const section = this.kept(status).files[course.id]?.items.find(item => item.location === location)
    if (!section?.[spec.rows].some(file => file.name === name)) throw new Error('这个文件已经不在这门课里了，刷新一下。')
    return { course, spec, key: copyId(location, group, name, copy) }
  }

  /**
   * 把一个文件下到本机，下完返回和 files 一样的东西。copy 是 playback 时视频下平台的播放版，否则下老师上传的原文件。
   * 下的过程中 core 一直在报进度，记在 progress 里给 downloading 问。
   */
  async download(input = {}) {
    const status = this.status()
    if (status.state !== 'ready') throw new Error('现在下载不了这一项。')
    const { course, spec, key } = this.locate(status, input), running = `file:${course.id}:${key}`
    await this.once(running, async () => {
      this.progress.set(running, { bytes: 0, total: 0 })
      try {
        const folder = path.join(await this.chats.root(), '课程', folderName(course.title))
        // 参数写成「--名字=值」：章节名和文件名是老师起的，以横线开头的也不会被当成另一个参数。
        const result = await this.run(['chaoxing', input.group, 'download', `--course=${course.link}`, `--chapter=${input.location}`, `--name=${input.name}`,
          ...(input.copy === 'playback' ? ['--quality=playback'] : []), `--out-dir=${folder}`],
        { system: SYSTEM, timeoutMs: spec.timeoutMs, onProgress: (state) => { this.progress.set(running, state) } })
        const file = result?.files?.[0]?.path
        if (typeof file !== 'string' || !file) throw new Error(result?.failed?.[0]?.reason || '文件没有下载下来，稍后再试。')
        const cache = { ...this.kept(status), owner: status.owner }
        this.write({ ...cache, saved: { ...cache.saved, [course.id]: { ...part(cache.saved[course.id]), [key]: file } } })
      } finally { this.progress.delete(running) }
    })
    return this.files({ id: course.id })
  }

  /**
   * 这门课正在下的文件各下到哪了，按那一份文件的编号给：{ 编号: { bytes, total } }。页面下载时隔一会儿问一次，只看内存。
   * 刚开始、还没报过进度的也在里面（都是 0）；下完或没下成的不在，页面看到它不在了就重读这门课。
   */
  downloading({ course: id } = {}) {
    const prefix = `file:${String(id)}:`
    return Object.fromEntries([...this.progress].filter(([key]) => key.startsWith(prefix)).map(([key, state]) => [key.slice(prefix.length), state]))
  }

  /** 在文件管理器里打开这个文件所在的文件夹并选中它。只认下载时记下的路径。 */
  async reveal(input = {}) {
    const status = this.status(), { course, key } = this.locate(status, input)
    const file = this.held(this.kept(status), course.id).get(key)
    if (!file) throw new Error('这个文件已经不在原来的位置了，重新下载一次。')
    this.downloads.reveal(file)
    return this.files({ id: course.id })
  }
}
