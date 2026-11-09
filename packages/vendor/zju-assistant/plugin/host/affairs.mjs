/**
 * 校园事务页上的作业：学在浙大和 PTA 里还没做完的；学习通的要用户在「课程与学习」的配置页里打开才接，默认不接
 * （2026-11-04 用户定的：有的课学习通只是放课件的地方）。每个系统读到的结果各存一份缓存，
 * 页面打开时先拿缓存，再让这里去各系统重新读；这次没读到时上一次的结果原样留着，只记下原因。
 * 点开一条作业看到的要求、附件、小题也是这样：先给缓存里有的，再去系统读完整的。
 * 附件可以一个个下载到「下载」文件夹里，下过的记在缓存里，页面上就能直接去它所在的文件夹。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ACCOUNTS, accountReady } from '../accounts.mjs'
import { accountRow } from '../rows.mjs'
import { runCore } from './core.mjs'

/** 读成功以后，这么久之内再进页面不重新读；页面上点刷新不受限制。 */
const FRESH_MS = 60_000
/** 读失败以后隔得久一些再自动重试：密码填错时每进一次页面就登录一次，账号可能被锁。 */
const RETRY_MS = 5 * 60_000

/** core 给的时间是北京时间「2026-10-09 23:59」，平台原样的 ISO 时间也认；读不出来的当作没有截止时间。 */
export function deadlineOf(value) {
  if (typeof value !== 'string' || !value) return null
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value)
  const at = Date.parse(local ? `${local[1]}T${local[2]}:00+08:00` : value)
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

/** 整份写进文件：先写到临时文件再换过去，写到一半出错时原来的还在。 */
function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

const text = value => typeof value === 'string' ? value.trim() : ''
/** 一行「名称：内容」；内容为空的不要。 */
const facts = rows => rows.filter(row => row && text(String(row[1] ?? ''))).map(([label, value]) => ({ label, value: String(value) }))

/**
 * `zju xuezai todos --done` 的结果：当前学期各课的作业和测验，交过的带 done（日程表把它标成已完成，校园事务页不列）。
 * requirement 是顺带读到的作业要求，只留在缓存里，点开这一条时先拿它顶着。
 */
export function fromXuezai(data) {
  if (!Array.isArray(data?.todos)) throw new Error('学在浙大给的待办格式不对。')
  return data.todos.map(todo => ({
    id: `xuezai:${text(todo.type)}|${text(todo.course)}|${text(todo.title)}`, source: 'xuezai',
    title: text(todo.title), course: text(todo.course), kind: text(todo.type) || '作业', deadline: deadlineOf(todo.deadline),
    ...(todo.done === true ? { done: true } : {}),
    ...(text(todo.requirement) ? { requirement: text(todo.requirement) } : {}),
  }))
}

/** `zju xuezai homework view` 的结果：一个作业的要求、老师给的附件、提交规则和本人交过的。 */
export function xuezaiDetail(data) {
  const sent = (Array.isArray(data?.submissions) ? data.submissions : []).filter(item => !item.draft)
  const last = sent.reduce((latest, item) => !latest || text(item.submittedAt) > text(latest.submittedAt) ? item : latest, undefined)
  const requirement = text(data?.requirement)
  return {
    body: requirement === '（老师未写文字说明）' ? '' : requirement, format: 'text',
    facts: facts([
      ['状态', data?.status], ['提交方式', data?.submitWith], ['重新提交', data?.resubmit], data?.groupHomework && ['小组作业', '是'],
      data?.score !== undefined && ['得分', data.score],
      last && ['最近一次提交', `${text(last.submittedAt)}${last.files?.length ? `，${last.files.length} 个文件` : ''}`],
    ]),
    files: (Array.isArray(data?.attachments) ? data.attachments : []).map(text).filter(Boolean),
  }
}

const PTA_UNFINISHED = new Set(['未开始', '未作答', '部分作答'])
// PTA 的「未开始」指本人还没开启答题实例，与老师设定的开放时间无关。
const ptaAnswerState = state => state === '未开始' ? '未作答' : state

/**
 * `zju pta homework list` 的结果。算作没做完的是还没截止、还有题没答的，和已经判出有题没通过的；
 * 全部答完（结果还没公布的也算）、自己交了卷的算做完了，带 done（日程表标成已完成，校园事务页不列）；
 * 截止了还没做完的不要。ref 是题目集的编号，读详情时用，只留在缓存里。
 */
export function fromPta(data) {
  if (!Array.isArray(data?.homeworks)) throw new Error('PTA 给的作业格式不对。')
  return data.homeworks.flatMap((set) => {
    const pending = !set.closed && !set.endedByUser && (PTA_UNFINISHED.has(set.state) || set.wrong > 0)
    const done = set.endedByUser === true || (!PTA_UNFINISHED.has(set.state) && !(set.wrong > 0))
    if (!pending && !done) return []
    const ref = /\/problem-sets\/(\d+)\//.exec(text(set.url))?.[1]
    return [{
      id: `pta:${text(set.url) || text(set.name)}`, source: 'pta', title: text(set.name), course: '', kind: '作业', deadline: deadlineOf(set.deadline),
      note: ptaAnswerState(set.state) === '未作答' ? '未作答'
        : typeof set.total === 'number' && typeof set.answered === 'number' && set.answered < set.total ? `答了 ${set.answered}/${set.total} 题`
        : set.wrong > 0 ? `${set.wrong} 题没通过` : '作答进度未知',
      ...(pending ? {} : { done: true }),
      ...(ref ? { ref } : {}),
    }]
  })
}

/** `zju pta homework view` 的结果：一份题目集的说明、进度和每道小题的情况。 */
export function ptaDetail(data) {
  const problems = Array.isArray(data?.problems) ? data.problems : undefined
  return {
    body: text(data?.description), format: 'markdown',
    facts: facts([
      ['作答状态', ptaAnswerState(data?.state)],
      typeof data?.total === 'number' && ['进度', `答了 ${data.answered}/${data.total} 题，通过 ${data.accepted} 题`],
      data?.score !== undefined && data?.score !== null && ['得分', data.score],
    ]),
    files: [],
    ...(problems ? { table: { columns: ['题号', '题型', '分值', '状态'], rows: problems.map(problem => [problem.label, problem.type, problem.score, problem.status].map(cell => String(cell ?? ''))) } } : {}),
    ...(text(data?.note) ? { note: text(data.note) } : {}),
  }
}

/**
 * `zju chaoxing homework list` 的结果：学习任务里的作业和测试，加上老师直接发的。
 * 没有截止时间的不要：老师挂在任务里不管的就是这样（比如写着交到学在浙大的实验报告），有截止时间的才是真要交的。
 * 截止了还没做的也不要；做完的带 done（日程表标成已完成，校园事务页不列）。有课没读到时整次算没读到，上一次的结果留着，不让那门课的作业凭空消失。
 * requirement 是老师写的要求，facts 是所在的学习任务和还有几项没学：都只留在缓存里，点开这一条时给（卡片上放不下，两栏时只有一百多像素宽）。
 */
export function fromChaoxing(data) {
  if (!Array.isArray(data?.homeworks)) throw new Error('学习通给的作业格式不对。')
  if (data.failed?.length) throw new Error(data.failed.map(item => `${text(item.course)}：${text(item.reason)}`).join('；'))
  return data.homeworks.flatMap((row) => {
    const deadline = deadlineOf(row.deadline), done = row.done === true
    if (!deadline || (row.closed === true && !done)) return []
    const details = facts([['学习任务', text(row.task)], !done && row.otherLeft > 0 && ['还没学完', `这个任务里还有 ${row.otherLeft} 项内容`]])
    return [{
      id: `chaoxing:${text(row.course)}|${text(row.task)}|${text(row.title)}`, source: 'chaoxing',
      title: text(row.title), course: text(row.course), kind: text(row.type) || '作业', deadline,
      ...(done ? { done: true } : {}), ...(text(row.requirement) ? { requirement: text(row.requirement) } : {}), ...(details.length ? { facts: details } : {}),
    }]
  })
}

/**
 * 接了哪些系统。plugin 是插件页上管它的那一项（关掉就不读），account 是要先填好的账号，
 * args 是读它的 ZJU Core 命令（写成函数时拿到这次是不是点了刷新），read 把命令的结果变成页面上的一条条。
 * optional 是配置页上那个开关的名字（settings 里的键），开着才接；freshMs 是这个系统读成功以后隔多久再自动读，不写用 FRESH_MS。
 * detail 是点开一条时再读的：args 给出读这一条的命令（这一类读不了时给 null），read 把结果变成详情；
 * download 给出把其中一个附件存到某个文件夹的命令，没有附件可下的系统不写。
 */
const SOURCES = [
  { id: 'xuezai', name: '学在浙大', plugin: 'zju-courses', account: 'zju', args: ['xuezai', 'todos', '--done'], read: fromXuezai,
    detail: {
      args: item => item.kind === '作业' ? ['xuezai', 'homework', 'view', '--course', item.course, '--name', item.title] : null, read: xuezaiDetail,
      download: (item, name, folder) => ['xuezai', 'homework', 'attachments', '--course', item.course, '--name', item.title, '--file', name, '--out-dir', folder],
    } },
  { id: 'pta', name: 'PTA', plugin: 'zju-courses', account: 'pta', args: ['pta', 'homework', 'list'], read: fromPta,
    detail: { args: item => ['pta', 'homework', 'view', '--set', item.ref ?? item.title], read: ptaDetail } },
  // 一门课要一项项读，超星对密集请求会要验证码，所以隔得久一些；要求在列表里已经有了，点开不用再读。
  { id: 'chaoxing', name: '学习通', plugin: 'zju-courses', account: 'chaoxing', optional: 'chaoxingHomework', freshMs: 10 * 60_000,
    args: force => ['chaoxing', 'homework', 'list', ...(force ? ['--fresh'] : [])], read: fromChaoxing,
    detail: { args: () => null, read: () => null } },
]

/** 账号在插件页的哪一项里填。 */
export const accountPlugin = accountRow
/** 缓存是哪个账号读到的；换了账号，旧的缓存就不能再给人看。只存指纹，不存账号本身。 */
export const fingerprint = value => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12)
const byDeadline = (a, b) => (a.deadline === null ? Infinity : Date.parse(a.deadline)) - (b.deadline === null ? Infinity : Date.parse(b.deadline)) || a.title.localeCompare(b.title, 'zh')
/** 给页面的一条：缓存里自己用的几项不带出去。 */
const shown = ({ requirement: _requirement, ref: _ref, facts: _facts, ...item }) => item

/** 课程名、作业名用作文件夹名：去掉文件夹名里不能有的符号。 */
const folderName = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '未分类'
const GONE = '这一项已经不在列表里了，可能已经交了或者过期了。'

/** 同一门课里重名的两项（极少见）在编号后面加序号，页面上每一条的编号不能重复。 */
function distinct(items) {
  const seen = new Map()
  return items.map((item) => {
    const count = (seen.get(item.id) ?? 0) + 1
    seen.set(item.id, count)
    return count === 1 ? item : { ...item, id: `${item.id}#${count}` }
  })
}

export class Affairs {
  /**
   * file 是缓存文件；settingsFile 存配置页上的开关，在档案目录里（换了缓存也不丢）；account 和 plugins 是账号和插件开关（account.mjs、plugins.mjs）；
   * downloads 管附件存到哪、怎么在文件管理器里打开（downloads.mjs）；
   * run 跑一条 ZJU Core 命令并返回结果里的 data。
   */
  constructor({ file, settingsFile, account, plugins, downloads, run = runCore, now = () => Date.now() }) {
    this.file = file
    this.settingsFile = settingsFile
    this.options = undefined
    this.account = account
    this.plugins = plugins
    this.downloads = downloads
    this.run = run
    this.now = now
    this.running = new Map()
    this.cache = undefined
  }

  /** 缓存：sources 是每个系统的列表，details 是点开过的每一条的详情（saved 是它下载过的附件存在哪）。 */
  load() {
    if (this.cache) return this.cache
    let saved
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { /* 没有缓存或读不了，都当作没有 */ }
    const part = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    this.cache = { sources: part(saved?.sources), details: part(saved?.details) }
    // 旧缓存也立刻改用明确的作答文案，不必等联网刷新成功。
    const pta = this.cache.sources.pta
    if (Array.isArray(pta?.items)) pta.items = pta.items.map(item => item.note === '还没开始' ? { ...item, note: '未作答' } : item)
    for (const [id, entry] of Object.entries(this.cache.details)) {
      if (id.startsWith('pta:') && Array.isArray(entry?.detail?.facts)) {
        entry.detail.facts = entry.detail.facts.map(fact => fact.label === '状态' ? { label: '作答状态', value: ptaAnswerState(fact.value) } : fact)
      }
    }
    return this.cache
  }

  write(cache) {
    this.cache = cache
    writeJson(this.file, cache)
  }

  /** 配置页上的开关：chaoxingHomework 是学习通的作业接不接校园事务，没存过时不接。 */
  settings() {
    if (!this.options) {
      let saved
      try { saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) } catch { /* 没存过或读不了，都当作没开 */ }
      this.options = { chaoxingHomework: saved?.chaoxingHomework === true }
    }
    return this.options
  }

  /** 改开关，存下来，返回改完的。 */
  saveSettings(patch = {}) {
    const next = { ...this.settings(), ...(typeof patch.chaoxingHomework === 'boolean' ? { chaoxingHomework: patch.chaoxingHomework } : {}) }
    writeJson(this.settingsFile, next)
    this.options = next
    return next
  }

  /** 换上一个系统新的列表；列表里已经没有的那几条，它们的详情一起丢掉。 */
  save(id, entry) {
    const { sources, details } = this.load()
    const kept = new Set(entry.items.map(item => item.id))
    this.write({
      sources: { ...sources, [id]: entry },
      details: Object.fromEntries(Object.entries(details).filter(([key]) => !key.startsWith(`${id}:`) || kept.has(key))),
    })
  }

  /** 这个系统现在能不能读：off 是插件关了，account 是账号还没填；能读时带上账号的指纹。 */
  status(source, accounts = this.account.read().data) {
    if (this.plugins.disabled().includes(source.plugin) || (source.optional && !this.settings()[source.optional])) return { state: 'off', plugin: source.plugin }
    if (!accountReady(accounts, source.account)) return { state: 'account', plugin: accountPlugin(source.account) }
    return { state: 'ready', plugin: source.plugin, owner: fingerprint(accounts[ACCOUNTS[source.account].user.key]) }
  }

  /** 这个账号上一次读到的那份；换过账号或还没读过时没有。 */
  kept(source, status) {
    const entry = this.load().sources[source.id]
    return status.state === 'ready' && entry?.owner === status.owner ? entry : undefined
  }

  /** 这次读是不是可以省掉：刚读成功过，或者刚失败过。 */
  recent(entry, force, freshMs = FRESH_MS) {
    return !force && !!entry && this.now() - Date.parse(entry.triedAt) < (entry.error ? RETRY_MS : freshMs)
  }

  /**
   * 页面要的全部内容，只看缓存，不联网：items 是各系统没做完的，按截止时间从近到远；
   * sources 是每个系统的情况：state、最近一次读成功的时间 fetchedAt、最近一次没读到的原因 error。
   */
  snapshot() {
    const accounts = this.account.read().data
    const items = [], sources = []
    for (const source of SOURCES) {
      // 用户没选接入的系统，页面上当它不存在。
      if (source.optional && !this.settings()[source.optional]) continue
      const status = this.status(source, accounts), entry = this.kept(source, status)
      if (entry) items.push(...entry.items.filter(item => !item.done).map(shown))
      sources.push({ id: source.id, name: source.name, state: status.state, plugin: status.plugin, fetchedAt: entry?.fetchedAt ?? null, error: entry?.error ?? null })
    }
    return { items: items.sort(byDeadline), sources }
  }

  /** 日程表要的：各系统读到的全部作业，交过的也在（done 为真）。只看缓存，不联网。 */
  tasks() {
    const accounts = this.account.read().data
    return SOURCES.flatMap(source => this.kept(source, this.status(source, accounts))?.items.map(shown) ?? [])
  }

  /** 每个系统都去读一次（刚读过的照常跳过），日程表打开时用。 */
  async refreshAll({ force = false } = {}) {
    await Promise.all(SOURCES.map(source => this.refresh({ source: source.id, force })))
    return this.snapshot()
  }

  /**
   * 去一个系统重新读，读完返回最新的全部内容。刚读过就不再读（force 为真时照读）；
   * 同一个系统同一时间只读一次，后来的请求等的是同一次。
   */
  async refresh({ source: id, force = false } = {}) {
    const source = SOURCES.find(item => item.id === id)
    if (!source) throw new Error('没有这个系统')
    const status = this.status(source)
    if (status.state !== 'ready') return this.snapshot()
    let run = this.running.get(id)
    if (!run) {
      if (this.recent(this.kept(source, status), force, source.freshMs)) return this.snapshot()
      run = this.fetch(source, status.owner, force).finally(() => { this.running.delete(id) })
      this.running.set(id, run)
    }
    await run
    return this.snapshot()
  }

  async fetch(source, owner, force = false) {
    const triedAt = new Date(this.now()).toISOString()
    try {
      const args = typeof source.args === 'function' ? source.args(force) : source.args
      const items = distinct(source.read(await this.run(args, { system: source.name, timeoutMs: 120_000 })))
      this.save(source.id, { owner, items, fetchedAt: triedAt, triedAt, error: null })
    } catch (error) {
      const entry = this.load().sources[source.id], same = entry?.owner === owner
      this.save(source.id, { owner, items: same ? entry.items : [], fetchedAt: same ? entry.fetchedAt : null, triedAt, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 列表里的一条，连同它所在的系统；不在现在能看的列表里时没有。 */
  find(id) {
    for (const source of SOURCES) {
      const status = this.status(source), item = this.kept(source, status)?.items.find(entry => entry.id === id)
      if (item) return { source, status, item }
    }
    return undefined
  }

  /**
   * 点开一条时页面要的，只看缓存，不联网。detail 是 { body, format, facts, files, table?, note? }：
   * 读过完整的就给完整的；没读过而列表里顺带有要求的，先给要求（partial 为真）；都没有就是 null。
   * more 说明这一条还能不能去系统读到更多；读不了的（比如在线测验）页面就不用等。
   * downloadable 说明附件能不能在这里下载；saved 是已经下载过、现在还在原处的附件，名字对着本机的路径。
   */
  detail({ id } = {}) {
    const found = this.find(id)
    if (!found) throw new Error(GONE)
    const { source, status, item } = found
    const entry = this.opened(id, status)
    const brief = item.requirement || item.facts ? { body: item.requirement ?? '', format: 'text', facts: item.facts ?? [], files: [] } : null
    return {
      item: shown(item), detail: entry?.detail ?? brief, partial: !entry?.detail && !!brief,
      more: source.detail.args(item) !== null, fetchedAt: entry?.fetchedAt ?? null, error: entry?.error ?? null,
      downloadable: !!source.detail.download,
      saved: Object.fromEntries(Object.entries(entry?.saved ?? {}).filter(([, file]) => fs.existsSync(file))),
    }
  }

  /** 这个账号点开这一条时存下的那份；换过账号或没点开过时没有。 */
  opened(id, status) {
    const entry = this.load().details[id]
    return entry?.owner === status.owner ? entry : undefined
  }

  /** 去系统读这一条完整的内容，读完返回和 detail 一样的东西。间隔和并发的规矩同 refresh。 */
  async refreshDetail({ id, force = false } = {}) {
    const found = this.find(id)
    if (!found) throw new Error(GONE)
    const { source, status, item } = found
    const args = source.detail.args(item)
    if (args === null) return this.detail({ id })
    const key = `detail:${id}`
    let run = this.running.get(key)
    if (!run) {
      if (this.recent(this.opened(id, status), force)) return this.detail({ id })
      run = this.fetchDetail(source, status.owner, id, args).finally(() => { this.running.delete(key) })
      this.running.set(key, run)
    }
    await run
    return this.detail({ id })
  }

  async fetchDetail(source, owner, id, args) {
    const triedAt = new Date(this.now()).toISOString()
    let entry
    try {
      entry = { owner, detail: source.detail.read(await this.run(args, { system: source.name, timeoutMs: 60_000 })), fetchedAt: triedAt, triedAt, error: null }
    } catch (error) {
      const before = this.load().details[id], same = before?.owner === owner
      entry = { owner, detail: same ? before.detail : null, fetchedAt: same ? before.fetchedAt : null, triedAt, error: error instanceof Error ? error.message : String(error) }
    }
    const { sources, details } = this.load(), before = details[id]
    // 下载过的附件记在同一条里，重读详情时带着。
    this.write({ sources, details: { ...details, [id]: { ...entry, ...(before?.owner === owner && before.saved ? { saved: before.saved } : {}) } } })
  }

  /**
   * 把这一条的一个附件下载到「下载位置\课程名\作业名」里，下完返回和 detail 一样的东西。
   * 只下详情里列着的附件；同一个附件同一时间只下一次。
   */
  async download({ id, name } = {}) {
    const found = this.find(id)
    if (!found) throw new Error(GONE)
    const { source, status, item } = found
    if (!source.detail.download || !this.opened(id, status)?.detail?.files.includes(name)) throw new Error('没有这个附件，回到列表重新点开这份作业再试。')
    const key = `file:${id}:${name}`
    let run = this.running.get(key)
    if (!run) {
      run = this.fetchFile(source, item, id, name).finally(() => { this.running.delete(key) })
      this.running.set(key, run)
    }
    await run
    return this.detail({ id })
  }

  async fetchFile(source, item, id, name) {
    const folder = path.join(await this.downloads.root(), folderName(item.course), folderName(item.title))
    const result = await this.run(source.detail.download(item, name, folder), { system: source.name, timeoutMs: 10 * 60_000 })
    const file = result?.files?.[0]?.path
    if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error(result?.failed?.[0]?.reason || '文件没有下载下来，稍后再试。')
    const { sources, details } = this.load(), entry = details[id]
    if (entry) this.write({ sources, details: { ...details, [id]: { ...entry, saved: { ...entry.saved, [name]: file } } } })
  }

  /** 在文件管理器里打开一个下载过的附件所在的文件夹。只认缓存里记着的路径，页面给不了别的路径。 */
  reveal({ id, name } = {}) {
    const found = this.find(id)
    const file = found ? this.opened(id, found.status)?.saved?.[name] : undefined
    if (!file || !fs.existsSync(file)) throw new Error('这个文件已经不在原来的位置了，重新下载一次。')
    this.downloads.reveal(file)
    return this.detail({ id })
  }
}
