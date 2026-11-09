/**
 * 学习页一门课里「学在浙大」那一块的数据。学习页的课程是从智云来的（learning.mjs），这里拿其中一门，
 * 在学在浙大（courses.zju.edu.cn）本人这学期的课程里找到同一门，经 ZJU Core 读它的课件清单（按章分），一个文件一个文件地下。
 * 和超星那一边（chaoxing.mjs）一样，页面先拿缓存，再让这里去重新读，这次没读到时上一次的结果原样留着，只记下原因。
 * 两边的课程名不总是一样（智云的「大学物理实验」在学在浙大叫「大学物理实验2026周四345」），怎么对见 matchCourse；
 * 对到哪一门不另存，每次拿缓存里的课程表现对。
 * 下载交给 core，落在 <文档>\CampusAgent\课程\<智云的课程名>\学在浙大\<章>\ 里，和智云下的课次在同一个课程文件夹下面。
 * 下完 core 会说文件在哪，这里把路径记下来，页面凭它认「已下载」和打开文件夹；文件被挪走了就当作没下过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ACCOUNTS, accountReady } from '../accounts.mjs'
import { accountRow } from '../rows.mjs'
import { runCore } from './core.mjs'

/** 课程表读成功以后，这么久之内再进页面不重新读；页面上点刷新不受限制。 */
const FRESH_MS = 10 * 60_000
/** 读失败以后隔得久一些再自动重试：密码填错时每进一次页面就登录一次，账号可能被锁。 */
const RETRY_MS = 5 * 60_000
/** 一门课的文件清单也是这么久之内不重读；老师刚传的课件，点刷新就看得到。 */
const FILES_FRESH_MS = 10 * 60_000
const SYSTEM = '学在浙大', PLUGIN = 'zju-courses', ACCOUNT = 'zju'
/** 下一个文件最多等多久：视频常有一两个 GB，别的文件小得多。 */
const FILE_TIMEOUT_MS = 20 * 60_000, VIDEO_TIMEOUT_MS = 2 * 60 * 60_000

const accountPlugin = accountRow
const fingerprint = value => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12)
const message = error => error instanceof Error ? error.message : String(error)
const part = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = value => typeof value === 'string' ? value : ''
/**
 * 用作文件夹名。和 core 的 safeName（core/zju/lib/zhiyun/download.ts）是同一个规矩，改那边时这里跟着改：
 * 智云下课次时课程文件夹就是用它起的名（<文档>\CampusAgent\课程\<课程名>），这里得落进同一个文件夹，两边的东西才在一处。
 */
function folderName(value) {
  let name = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '').slice(0, 140)
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return name && name !== '.' && name !== '..' ? name : 'unnamed'
}
/**
 * 一个文件的编号：在哪一章、叫什么（没有归到章里的，章是空的）。记下载位置、认正在下的是哪个、页面上对进度，用的都是它。
 * 同一章里有两个同名的文件时它们的编号相同，下载时 core 会回答这个名字对到不止一个文件；这种情况这里没有另想办法。
 * 文件名里带竖线（| 或 ｜）的也下不了：core 的 --name 用竖线隔开几个名字。
 */
const fileId = file => `${file.chapter}\n${file.name}`

/** core 给的一门课 → 缓存里的一条。课程号取链接里的那串数字；link 以后原样交回 core 指这门课（名字会互相包含，链接不会）。 */
function courseOf(row) {
  const id = /\/course\/(\d+)/.exec(text(row?.link))?.[1]
  return id ? [{ id, name: String(row.name ?? ''), teachers: (Array.isArray(row.teachers) ? row.teachers : []).map(String), link: row.link }] : []
}
/** core 给的一个文件 → 缓存里的一条。大小不留，页面上不显示。 */
const fileOf = row => ({ chapter: text(row?.chapter), section: text(row?.section), name: String(row?.name ?? ''), activity: text(row?.activity), video: row?.video === true })

// ── 智云的课对到学在浙大的哪一门 ─────────────────────────────

/** 比名字用：全角半角、大小写、空格都不算差别（「大学物理（乙）Ⅱ」和「大学物理(乙)II」是同一个名字）。 */
const plain = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
/** 智云的教师一栏可能写着好几位，用逗号、顿号、分号或空格隔开。外文名字中间也有空格，所以没按空格拆开的那一整段也算一个。 */
function people(value) {
  const names = String(value ?? '').split(/[,，、;；]+/)
  return new Set([...names, ...names.flatMap(name => name.trim().split(/\s+/))].map(plain).filter(Boolean))
}

/**
 * rows（学在浙大的课，{ name, teachers }）里和智云的这门课（course，{ title, teacher }）是同一门的那一个的下标；对不上或者分不清是哪一个时是 -1。
 * 先找名字一样的；没有，再找一个名字包含另一个的（智云的「大学物理实验」对学在浙大的「大学物理实验2026周四345」），两边都至少两个字。
 * 找到好几门时（智云的「微积分」对「微积分（甲）Ⅰ」和「微积分（甲）Ⅱ」）看教师：有智云这门课的教师在教的正好一门才认。
 * 不比学期：同一门课学在浙大写的是「2026-2027秋」，智云写的是「2026-2027秋冬」。
 */
export function matchCourse(course, rows) {
  const title = plain(course?.title), names = rows.map(row => plain(row?.name)), taught = people(course?.teacher)
  if (!title) return -1
  const pick = (hits) => {
    if (hits.length < 2) return hits[0] ?? -1
    const mine = hits.filter(index => (Array.isArray(rows[index].teachers) ? rows[index].teachers : []).some(name => taught.has(plain(name))))
    return mine.length === 1 ? mine[0] : -1
  }
  const same = names.flatMap((name, index) => name === title ? [index] : [])
  if (same.length) return pick(same)
  return pick(names.flatMap((name, index) => title.length >= 2 && name.length >= 2 && (name.includes(title) || title.includes(name)) ? [index] : []))
}

/**
 * 一个文件归在目录的哪个文件夹下面：它所在的章，章里分了节的写成「章 / 节」；没有归到章里的是空的。
 * 页面上一个文件夹一行，点开是里面的文件，像文件目录一样。文件挂在哪个活动上不往外给：
 * 第一版把活动的标题写在文件名下面当小字，和章名的小字一层叠一层，用户看了说乱，而且标题是老师随手起的（第五章下面的活动叫「第四章：PPT」）。
 */
const folderOf = file => file.chapter && file.section ? `${file.chapter} / ${file.section}` : file.chapter

export class Xuezai {
  /**
   * file 是缓存文件；account 和 plugins 是账号和插件开关；chats 给出 <文档>\CampusAgent 在哪（chats.mjs）；
   * downloads 用来在文件管理器里打开文件夹（downloads.mjs）；course 按编号给出智云的那门课（{ id, title, teacher }），
   * 这门课已经不在智云的课程表里时它会抛错，这里不拦，原样交给页面；run 跑一条 ZJU Core 命令并返回结果里的 data。
   */
  constructor({ file, account, plugins, chats, downloads, course, run = runCore, now = () => Date.now() }) {
    this.file = file
    this.account = account
    this.plugins = plugins
    this.chats = chats
    this.downloads = downloads
    this.course = course
    this.run = run
    this.now = now
    this.running = new Map()
    /** 正在下的文件各下到哪了：键和 running 里下载的那个键一样，值是 { bytes, total }。 */
    this.progress = new Map()
    this.cache = undefined
  }

  /** 缓存：courses 是学在浙大的课程表，files 按学在浙大的课程号放每门课的文件，saved 按课程号记下载过的每个文件在哪。 */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    this.cache = { owner: typeof saved?.owner === 'string' ? saved.owner : '', courses: saved?.courses ?? null, files: part(saved?.files), saved: part(saved?.saved) }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    const temp = `${this.file}.${randomUUID()}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    try { fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  /** 现在能不能读：off 是插件关了，account 是统一身份认证的账号还没填（它在另一个插件里填）；能读时带上账号的指纹。 */
  status() {
    if (this.plugins.disabled().includes(PLUGIN)) return { state: 'off', plugin: PLUGIN }
    const accounts = this.account.read().data
    if (!accountReady(accounts, ACCOUNT)) return { state: 'account', plugin: accountPlugin(ACCOUNT) }
    return { state: 'ready', plugin: PLUGIN, owner: fingerprint(accounts[ACCOUNTS[ACCOUNT].user.key]) }
  }

  /** 这个账号读到的那份缓存；换过账号的不给人看，下一次写的时候整份换掉。 */
  kept(status) {
    const cache = this.load()
    return status.state === 'ready' && cache.owner === status.owner ? cache : { owner: status.owner ?? '', courses: null, files: {}, saved: {} }
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
   * 没读到不马上重试：多半是登录没过，密码填错时反复登录账号可能被锁。
   */
  async fetch(status, args, read, before, place) {
    const triedAt = new Date(this.now()).toISOString()
    let entry
    try { entry = { items: read(await this.run(args, { system: SYSTEM, timeoutMs: 120_000 })), fetchedAt: triedAt, triedAt, error: null } }
    catch (error) { entry = { items: before?.items ?? [], fetchedAt: before?.fetchedAt ?? null, triedAt, error: message(error) } }
    this.write(place({ ...this.kept(status), owner: status.owner }, entry))
  }

  /** 这门课记着的下载里现在还在原处的：键是文件的编号，值是文件的路径。 */
  held(cache, id) {
    return new Map(Object.entries(part(cache.saved[id])).filter(([, file]) => typeof file === 'string' && fs.existsSync(file)))
  }

  /** 智云的这门课在学在浙大的课程表里是哪一门。课程表还没读到过时是 undefined，读到过但没有对到是 null。 */
  paired(cache, course) {
    if (!cache.courses?.fetchedAt) return undefined
    return cache.courses.items[matchCourse(course, cache.courses.items)] ?? null
  }

  // ── 一门课的文件 ─────────────────────────────────────────

  /**
   * 智云的这门课（id 是它在智云的编号）在学在浙大上的文件，只看缓存，不联网。
   * matched：学在浙大的课程表还没读到过时是 null，读到了以后是对到了没有；name 是对到的那门课在学在浙大上的名字。
   * groups 一个文件夹一组（title 是章，章里分了节的是「章 / 节」），照课程里的先后，同名的并成一组；没有归到章里的那一组 title 是空的，
   * core 把这些文件排在最后，这一组也就在最后。一个文件带着它的编号、是不是视频、是否已经在本机、是否正在下。count 是一共几个文件。
   * error 是课程表没读到的原因，课程表没事时是这门课的文件清单没读到的原因。
   * 插件关着或者账号没填时样子一样，里面是空的；这时不去问智云的那门课。
   */
  async files({ course: id } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return { state: status.state, plugin: status.plugin, matched: null, name: '', groups: [], count: 0, fetchedAt: null, error: null }
    const cache = this.kept(status), found = this.paired(cache, this.course(id))
    const entry = found ? cache.files[found.id] : undefined, held = found ? this.held(cache, found.id) : new Map()
    const groups = new Map()
    for (const file of entry?.items ?? []) {
      const key = fileId(file), folder = folderOf(file)
      if (!groups.has(folder)) groups.set(folder, [])
      groups.get(folder).push({ id: key, name: file.name, video: file.video, saved: held.has(key), busy: this.running.has(`file:${found.id}:${key}`) })
    }
    return {
      state: status.state, plugin: status.plugin, matched: found === undefined ? null : !!found, name: found?.name ?? '',
      groups: [...groups].map(([title, files]) => ({ title, files })), count: entry?.items.length ?? 0,
      fetchedAt: entry?.fetchedAt ?? null, error: cache.courses?.error ?? entry?.error ?? null,
    }
  }

  /**
   * 去学在浙大读：先读课程表，对到了再读那门课的文件清单，读完返回和 files 一样的东西。刚读过的跳过（force 为真时两样都照读）。
   * 课程表从来没读到过，或者上面没有这门课，就不去读文件清单。
   */
  async refreshFiles({ course: id, force = false } = {}) {
    const status = this.status()
    if (status.state !== 'ready') return this.files({ course: id })
    const course = this.course(id)
    await this.once('courses', async () => {
      const before = this.kept(status).courses
      if (this.recent(before, force)) return
      await this.fetch(status, ['xuezai', 'course', 'list'], data => (data?.courses ?? []).flatMap(courseOf), before, (cache, entry) => ({ ...cache, courses: entry }))
    })
    // 课程表这次（或几分钟前）没读到时不接着读文件清单：多半是登录没过，再读一条就是再登录一次。
    const listed = this.kept(status).courses, found = this.paired(this.kept(status), course)
    if (found && !listed?.error) {
      await this.once(`files:${found.id}`, async () => {
        const before = this.kept(status).files[found.id]
        if (this.recent(before, force, FILES_FRESH_MS)) return
        await this.fetch(status, ['xuezai', 'material', 'list', `--course=${found.link}`], data => (data?.materials ?? []).map(fileOf), before,
          (cache, entry) => ({ ...cache, files: { ...cache.files, [found.id]: entry } }))
      })
    }
    return this.files({ course: id })
  }

  // ── 下载 ─────────────────────────────────────────────────

  /**
   * 把一个文件下到本机，下完返回和 files 一样的东西。key 是文件的编号，得是这门课的清单里有的。
   * 下的过程中 core 一直在报进度，记在 progress 里给 downloading 问。
   */
  async download({ course: id, file: key } = {}) {
    const status = this.status()
    if (status.state !== 'ready') throw new Error('现在下载不了这一项。')
    const course = this.course(id), cache = this.kept(status), found = this.paired(cache, course)
    const file = found ? cache.files[found.id]?.items.find(item => fileId(item) === key) : undefined
    if (!file) throw new Error('这个文件已经不在这门课里了，刷新一下。')
    const running = `file:${found.id}:${key}`
    await this.once(running, async () => {
      this.progress.set(running, { bytes: 0, total: 0 })
      try {
        // 课程文件夹用智云的课程名（不是学在浙大的），一章一个子文件夹；没有归到章里的直接放在「学在浙大」里。
        const folder = path.join(await this.chats.root(), '课程', folderName(course.title), '学在浙大', ...(file.chapter ? [folderName(file.chapter)] : []))
        // 参数写成「--名字=值」：章节名和文件名是老师起的，以横线开头的也不会被当成另一个参数。
        const result = await this.run(['xuezai', 'material', 'download', `--course=${found.link}`, ...(file.chapter ? [`--chapter=${file.chapter}`] : []), `--name=${file.name}`, `--out-dir=${folder}`],
          { system: SYSTEM, timeoutMs: file.video ? VIDEO_TIMEOUT_MS : FILE_TIMEOUT_MS, onProgress: (state) => { this.progress.set(running, state) } })
        const saved = result?.files?.[0]?.path
        if (typeof saved !== 'string' || !saved) throw new Error(result?.failed?.[0]?.reason || '文件没有下载下来，稍后再试。')
        const latest = { ...this.kept(status), owner: status.owner }
        this.write({ ...latest, saved: { ...latest.saved, [found.id]: { ...part(latest.saved[found.id]), [key]: saved } } })
      } finally { this.progress.delete(running) }
    })
    return this.files({ course: id })
  }

  /**
   * 这门课正在下的文件各下到哪了，按文件的编号给：{ 编号: { bytes, total } }。页面下载时隔一会儿问一次，只看内存。
   * 刚开始、还没报过进度的也在里面（都是 0）；下完或没下成的不在，页面看到它不在了就重读这门课。
   */
  downloading({ course: id } = {}) {
    const found = this.paired(this.load(), this.course(id))
    if (!found) return {}
    const prefix = `file:${found.id}:`
    return Object.fromEntries([...this.progress].filter(([key]) => key.startsWith(prefix)).map(([key, state]) => [key.slice(prefix.length), state]))
  }

  /** 在文件管理器里打开这个文件所在的文件夹并选中它，返回和 files 一样的东西。只认下载时记下的路径。 */
  async reveal({ course: id, file: key } = {}) {
    const status = this.status(), cache = this.kept(status)
    const found = status.state === 'ready' ? this.paired(cache, this.course(id)) : undefined
    const file = found ? this.held(cache, found.id).get(key) : undefined
    if (!file) throw new Error('这个文件已经不在原来的位置了，重新下载一次。')
    this.downloads.reveal(file)
    return this.files({ course: id })
  }
}
