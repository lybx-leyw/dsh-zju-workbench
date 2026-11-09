import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { load, dump, JSON_SCHEMA } from 'js-yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { IDENTITY_FIELDS } from '../accounts.mjs'

const IDENTITY_KEYS = IDENTITY_FIELDS.map(field => field.key)
export const IDENTITY_DOCUMENT = '00-个人资料.md'
/** 已归档的放在各自文件夹下面的这个子文件夹里。 */
const ARCHIVE = '归档'
/**
 * 档案目录里按「一条一个 Markdown 文件」存的两样东西，格式相同，各占一个文件夹：
 * 记忆写的是用户这个人（学过什么、偏好、目标），助手自己记，用户能改；
 * 备忘写的是一件事（比赛、要办的手续），用户自己记，或者用户让助手记。
 * page 是只有人能做的操作该去哪一页做。
 */
const SHELVES = {
  memory: { folder: 'memory', name: '记忆', page: '设置的「个人档案」里' },
  memo: { folder: 'notes', name: '备忘', page: '校园事务页的备忘录里' },
}
/** 开头两行 --- 之间是属性区，写法和 Obsidian 的一样。 */
const FRONT = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/

const hash = value => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const read = (file, fallback = '') => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback
const json = (file, fallback) => JSON.parse(read(file, JSON.stringify(fallback)))
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, limit = 100000) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error('内容格式不正确或过长')
  return value.replaceAll('\r\n', '\n')
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temp, value, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

/** 标题就是文件名，所以不能有文件名和双链里用不了的符号。 */
export function noteTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new Error('请填写标题')
  if (title.length > 80) throw new Error('标题太长了，最多 80 个字')
  if (/[\\/:*?"<>|[\]#^\x00-\x1f]/.test(title)) throw new Error('标题里不能有这些符号：\\ / : * ? " < > | [ ] # ^')
  if (title.startsWith('.') || title.endsWith('.') || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(title)) throw new Error('这个标题不能用作文件名，换一个')
  return title
}
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

/** 标签可以写成列表，也可以写成用逗号或空格隔开的一串；前面的 # 去掉。 */
function tagList(value) {
  const items = (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' || typeof item === 'number')
  return [...new Set(items.flatMap(item => String(item).split(/[,，、\s]+/)).map(item => item.replace(/^#/, '')).filter(Boolean))]
}
const shown = value => Array.isArray(value) ? value.filter(item => item != null && typeof item !== 'object').join('、')
  : value == null || typeof value === 'object' ? '' : String(value)

/** 把一条的原文拆成属性和正文。属性区写错时说明是哪一行。 */
export function parseNote(raw) {
  const match = raw.match(FRONT)
  let meta = {}
  if (match?.[1]) {
    // 中文输入法下容易把「名称: 值」的冒号打成全角，这里认它。
    const source = match[1].replace(/^([^\s:：#-][^:：]*)：[ \t]*/gm, '$1: ')
    try { meta = load(source, { schema: JSON_SCHEMA, json: true }) ?? {} } catch { meta = null }
    if (!object(meta)) throw new Error('属性区的格式不对。属性写在开头两行 --- 之间，一行一项，例如「tags: [课程, 已修]」「学期: 2026 秋冬」。')
  }
  const properties = Object.entries(meta).filter(([key]) => key !== 'tags').map(([key, value]) => ({ key, value: shown(value) })).filter(item => item.value)
  return { meta, tags: tagList(meta.tags ?? []), properties, body: (match ? raw.slice(match[0].length) : raw).replace(/^\n+/, '') }
}

/**
 * 属性区要写成什么：标签在最前，后面是「名称 / 值」一项一行。before 是这一条原来的属性，
 * 值没动过的保留原来的写法（比如在别的编辑器里写成的列表），动过的按文字存；值空着的一项不存。
 */
function noteMeta(before, tags, properties) {
  if (!Array.isArray(tags) || tags.length > 20) throw new Error('标签最多 20 个')
  if (!Array.isArray(properties) || properties.length > 20) throw new Error('属性最多 20 项')
  const meta = {}, names = tagList(tags)
  if (names.length) meta.tags = names
  for (const item of properties) {
    const key = typeof item?.key === 'string' ? item.key.trim() : '', value = text(String(item?.value ?? ''), 500).trim()
    if (!key && !value) continue
    if (!key || key === 'tags' || key.length > 40 || /[\n:：]/.test(key)) throw new Error(key ? `属性名「${key}」不能用` : '有一项属性没有写名称')
    if (key in meta) throw new Error(`属性「${key}」写了两次`)
    if (value) meta[key] = key in before && shown(before[key]) === value ? before[key] : value
  }
  return meta
}

/** 属性和正文合成一条的原文。标签写成一行，和手写的样子一致。 */
function compose(meta, body) {
  const front = Object.keys(meta).length ? `---\n${dump(meta, { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true, flowLevel: 1 })}---\n` : ''
  const content = body.replace(/^\n+/, '').trimEnd()
  // 没有属性、正文又以分隔线开头时空一行，免得这条线被当成属性区的开头。
  return `${!front && content.startsWith('---') ? '\n' : ''}${front}${content}\n`
}

/**
 * 插件自己的数据放在 dsh 主目录下的 zju-campus 文件夹（dsh-builtin-browser 也是这样，放在 $DSH_HOME/dsh-builtin-browser-host），
 * 档案在里面的 profile/，ZJU Core 经 CAMPUS_PROFILE_DIR 读同一个文件夹；它旁边的 zju/ 是 ZJU Core 的数据，cache/ 是页面的缓存。
 * 桌面版（校园智能体）的数据在 %APPDATA%\CampusAgent，两边不共用。
 */
export function defaultProfileRoot() {
  return path.join(resolveDshHome(), 'zju-campus', 'profile')
}

/**
 * 档案目录里的一个文件夹：一条一个 Markdown 文件，文件名就是标题。记忆和备忘各是一个。
 * 写入时用的锁和版本检查是档案目录共用的那一套。
 */
class Shelf {
  constructor(store, { folder, name, page }) {
    this.store = store
    this.folder = folder
    this.name = name
    this.page = page
    fs.mkdirSync(path.join(store.root, folder), { recursive: true })
  }

  notePath(title, archived = false) { return path.join(this.store.root, this.folder, archived ? ARCHIVE : '', `${noteTitle(title)}.md`) }
  /** 这个标题的那一条在哪；没有就是 null。 */
  find(title) {
    for (const archived of [false, true]) {
      const file = this.notePath(title, archived)
      if (fs.existsSync(file)) return { file, archived }
    }
    return null
  }
  load(file, title, archived) {
    const raw = read(file).replaceAll('\r\n', '\n')
    const base = { title, raw, archived, updatedAt: fs.statSync(file).mtime.toISOString(), revision: hash(raw) }
    // 属性区写坏了的照样列出来，打开就能改。
    try { const { tags, properties, body } = parseNote(raw); return { ...base, tags, properties, body } }
    catch (error) { return { ...base, tags: [], properties: [], body: raw, problem: error.message } }
  }
  note(title) {
    const found = this.find(title)
    if (!found) throw new Error(`没有这条${this.name}，请刷新`)
    return this.load(found.file, noteTitle(title), found.archived)
  }
  list() {
    const notes = []
    for (const archived of [false, true]) {
      const directory = path.join(this.store.root, this.folder, archived ? ARCHIVE : '')
      if (!fs.existsSync(directory)) continue
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) notes.push(this.load(path.join(directory, entry.name), entry.name.slice(0, -3), archived))
      }
    }
    notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { notes, warnings: notes.filter(note => note.problem).map(note => `${note.title}：${note.problem}`) }
  }

  /**
   * 助手原样写下、之后没人动过的，助手可以整篇重写；别的只能在后面补充。
   * 判断办法是记下助手每次写完时的内容指纹，和现在的对不上就是有人改过。
   */
  assistantMarks() { try { return json(this.store.file(`${this.folder}/.assistant.json`), {}) } catch { return {} } }
  mark(title, revision) {
    const marks = this.assistantMarks()
    if (revision) marks[title] = revision
    else if (title in marks) delete marks[title]
    else return
    atomic(this.store.file(`${this.folder}/.assistant.json`), JSON.stringify(marks, null, 2))
  }

  /**
   * 页面上保存一条。from 是改之前的标题，没有就是新建；标题变了就是改文件名。
   * tags、properties（[{ key, value }]）、body 是编辑时的三块；导入时直接给整篇原文 raw。
   */
  save(input) {
    const title = noteTitle(input.title)
    return this.store.locked(() => {
      const current = input.from ? this.note(input.from) : null
      if (current) this.store.checkRevision(current.revision, input.revision)
      if (this.find(title) && !(current && sameName(current.title, title))) throw new Error(`已经有一条叫「${title}」的${this.name}`)
      // 属性区写坏了的，编辑框里放的是整篇原文，改好以后原样存回去。
      const whole = input.raw !== undefined ? input.raw : current?.problem ? (input.body ?? '') : undefined
      const raw = whole !== undefined ? text(whole) : compose(noteMeta(parseNote(current?.raw ?? '').meta, input.tags ?? [], input.properties ?? []), text(input.body ?? ''))
      parseNote(raw)
      const target = this.notePath(title, current?.archived)
      if (current && current.title !== title) {
        fs.renameSync(this.notePath(current.title, current.archived), target)
        this.relink(current.title, title)
        this.mark(current.title)
      }
      atomic(target, raw)
      this.mark(title)
      return this.note(title)
    })
  }
  /** 改了标题以后，同一个文件夹里指向它的双链跟着改。 */
  relink(from, to) {
    const link = new RegExp(`\\[\\[\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=[\\]|#])`, 'g')
    for (const note of this.list().notes) {
      const raw = note.raw.replace(link, `[[${to}`)
      if (raw !== note.raw) atomic(this.notePath(note.title, note.archived), raw)
    }
  }
  /** 助手新建或更新一条。 */
  saveByAssistant(input) {
    const title = noteTitle(input.title)
    return this.store.locked(() => {
      const current = this.find(title) ? this.note(title) : null
      if (current?.problem) throw new Error(`这条${this.name}的属性区有格式问题，请用户先在${this.page}改好：${current.problem}`)
      if (current) this.store.checkRevision(current.revision, input.revision)
      const owned = !current || this.assistantMarks()[current.title] === current.revision
      const parsed = current ? parseNote(current.raw) : { meta: {}, tags: [], properties: [], body: '' }
      let body = parsed.body
      if (input.body !== undefined) {
        const given = text(input.body).trim()
        if (!given) throw new Error('正文不能是空的')
        if (input.append && current) body = `${body.trimEnd()}\n\n${given}`
        else if (!owned) throw new Error(`这条${this.name}有人改过。用 append 在后面补充，不要整篇覆盖。`)
        else body = given
      } else if (!current) throw new Error(`新建${this.name}要有正文`)
      // 给了 tags 就整组换；properties 里给到的几项覆盖原值，值为空是去掉这一项，没给到的不动。
      const changes = input.properties ?? {}
      if (!object(changes)) throw new Error('properties 要写成 {"名称": "值"}')
      const merged = new Map(parsed.properties.map(item => [item.key, item.value]))
      for (const [key, value] of Object.entries(changes)) merged.set(key.trim(), value == null ? '' : String(value))
      const meta = noteMeta(parsed.meta, input.tags ?? parsed.tags, [...merged].map(([key, value]) => ({ key, value })))
      const changed = input.body !== undefined || input.tags !== undefined || input.properties !== undefined
      const raw = changed || !current ? compose(meta, body) : current.raw
      const archived = typeof input.archived === 'boolean' ? input.archived : (current?.archived ?? false)
      const target = this.notePath(current?.title ?? title, archived)
      if (current && archived !== current.archived) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(this.notePath(current.title, current.archived), target) }
      if (!current || raw !== current.raw) atomic(target, raw)
      if (owned) this.mark(current?.title ?? title, hash(raw))
      return this.note(title)
    })
  }
  /** 这一条是不是助手写下以后没人动过。 */
  owned(note) { return this.assistantMarks()[note.title] === note.revision }
  /**
   * 撤销一次对话后的整理（review.mjs）时用：现在的内容还是整理完的样子（revision 对得上）才换回 raw。
   * owned 是整理之前这一条算不算助手写的，照样记回去。
   */
  restore(input) {
    return this.store.locked(() => {
      const note = this.note(input.title)
      this.store.checkRevision(note.revision, input.revision)
      const raw = text(input.raw)
      parseNote(raw)
      atomic(this.notePath(note.title, note.archived), raw)
      this.mark(note.title, input.owned ? hash(raw) : undefined)
      return this.note(note.title)
    })
  }
  /** 归档或取消归档：在这个文件夹和它下面的归档文件夹之间挪文件。 */
  archive(input) {
    if (typeof input.archived !== 'boolean') throw new Error('无效的归档状态')
    return this.store.locked(() => {
      const note = this.note(input.title)
      this.store.checkRevision(note.revision, input.revision)
      if (note.archived !== input.archived) {
        const target = this.notePath(note.title, input.archived)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.renameSync(this.notePath(note.title, note.archived), target)
      }
      return this.note(note.title)
    })
  }
  /** 永久删除一条，只能由人在页面上操作；助手只能归档。 */
  remove(input) {
    return this.store.locked(() => {
      const note = this.note(input.title)
      this.store.checkRevision(note.revision, input.revision)
      fs.unlinkSync(this.notePath(note.title, note.archived))
      this.mark(note.title)
      return { title: note.title }
    })
  }
  /** 导入一个 Markdown 文件：文件名就是标题，内容原样留着。 */
  importMarkdown(input) {
    const filename = text(input.filename, 240)
    if (!/\.md$/i.test(filename)) throw new Error('请选择 Markdown 文件')
    return this.save({ title: filename.replace(/\.md$/i, ''), raw: text(input.content) })
  }
  /** 给助手看的：title 读一条全文；否则是目录（标题、标签、属性、开头一段），query 搜索。 */
  query(input = {}) {
    const brief = ({ title, tags, properties, body, archived, updatedAt, revision }) =>
      ({ title, tags, properties: Object.fromEntries(properties.map(item => [item.key, item.value])), body, archived, updatedAt, revision })
    if (input.title) return brief(this.note(input.title))
    const query = text(input.query || '', 200).trim().toLowerCase()
    const { notes, warnings } = this.list()
    const found = notes.filter(note => (input.archived || !note.archived) && (!query || `${note.title}\n${note.raw}`.toLowerCase().includes(query)))
    return { notes: found.map(note => { const { body, ...rest } = brief(note); return { ...rest, summary: body.slice(0, 240) } }), warnings }
  }
}

/**
 * 档案目录的存储：基础信息以 Markdown 为准，JSON 仅供现有校园命令读取；记忆和备忘各一个文件夹。
 * 页面和模型工具用的是同一份；各系统的账号也在这个目录（account.mjs），共用这里的写锁。照 ui/profile/store.mjs 搬过来。
 */
export class ProfileStore {
  constructor(root = defaultProfileRoot()) {
    this.root = path.resolve(root)
    fs.mkdirSync(this.root, { recursive: true })
    this.memory = new Shelf(this, SHELVES.memory)
    this.memos = new Shelf(this, SHELVES.memo)
    this.locked(() => {
      if (fs.existsSync(this.file(IDENTITY_DOCUMENT))) return
      const previous = json(this.file('identity.json'), { values: {}, source: '本人填写' })
      const meta = Object.fromEntries(IDENTITY_FIELDS.map(field => [field.label, previous.values?.[field.key] || '']))
      meta.来源 = previous.source || '本人填写'
      atomic(this.file(IDENTITY_DOCUMENT), compose(meta, '# 个人资料\n\n开头的属性可直接编辑，也可在应用的个人档案设置中修改。正文可以补充个人说明。\n\n- [课程档案](01-课程.md)\n- [平台入口](02-平台入口.md)\n- [事项档案](03-事项.md)\n\n## 个人说明\n'))
    })
  }
  file(name) { return path.join(this.root, name) }
  locked(fn) {
    const lock = this.file('.write-lock')
    try { fs.mkdirSync(lock) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = json(path.join(lock, 'owner.json'), null)
      let abandoned = false
      if (owner?.pid) {
        try { process.kill(owner.pid, 0) } catch (probe) { abandoned = probe.code === 'ESRCH' }
      } else abandoned = Date.now() - fs.statSync(lock).mtimeMs > 30000
      if (!abandoned) throw new Error('档案正在被另一处保存，请稍后重试。')
      if (fs.existsSync(path.join(lock, 'owner.json'))) fs.unlinkSync(path.join(lock, 'owner.json'))
      fs.rmdirSync(lock)
      fs.mkdirSync(lock)
    }
    try {
      fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
      return fn()
    } finally {
      if (fs.existsSync(path.join(lock, 'owner.json'))) fs.unlinkSync(path.join(lock, 'owner.json'))
      fs.rmdirSync(lock)
    }
  }
  checkRevision(actual, expected) {
    if (!expected || actual !== expected) throw new Error('内容已在其他位置更新。请先重新读取，保留你的修改后再合并保存。')
  }

  identity() {
    const file = this.file(IDENTITY_DOCUMENT), raw = read(file), parsed = parseNote(raw)
    const values = Object.fromEntries(IDENTITY_FIELDS.map(field => [field.key, text(String(parsed.meta[field.label] ?? ''), 150).trim()]))
    const source = typeof parsed.meta.来源 === 'string' ? parsed.meta.来源 : '本人填写'
    const updatedAt = fs.statSync(file).mtime.toISOString()
    // 旧命令只读这个投影；每次读取 Markdown 后按需重建，绝不反向覆盖 Markdown。
    const projection = { values, updatedAt, source }
    let previous
    try { previous = json(this.file('identity.json'), null) } catch { previous = null }
    if (JSON.stringify(previous) !== JSON.stringify(projection)) atomic(this.file('identity.json'), JSON.stringify(projection, null, 2))
    return { ...projection, body: parsed.body, revision: hash(raw) }
  }
  /** source 记这次的内容从哪来：页面上手填的是「本人填写」，自动填的写具体来源。 */
  saveIdentity(input, actor = 'human', source = '本人填写') {
    if (actor !== 'human') throw new Error('基础信息请由用户在设置的「个人档案」里编辑')
    return this.locked(() => {
      const before = this.identity()
      this.checkRevision(before.revision, input.revision)
      if (!object(input.values) || Object.keys(input.values).some(key => !IDENTITY_KEYS.includes(key))) throw new Error('无效的基础信息字段')
      const values = { ...before.values }
      for (const [key, value] of Object.entries(input.values)) values[key] = text(value, 150).trim()
      const document = parseNote(read(this.file(IDENTITY_DOCUMENT))), meta = { ...document.meta, 来源: source }
      for (const field of IDENTITY_FIELDS) meta[field.label] = values[field.key]
      atomic(this.file(IDENTITY_DOCUMENT), compose(meta, document.body))
      return this.identity()
    })
  }

  /** 个人档案页要的：基础信息和全部记忆。 */
  snapshot() {
    const { notes, warnings } = this.memory.list()
    return { identity: this.identity(), memory: notes, warnings, root: this.root }
  }
  /** 给助手看的个人档案：不带参数是基础信息和记忆的目录，query 搜索，title 读一条记忆的全文。 */
  query(input = {}) {
    if (input.title) return this.memory.query(input)
    const { notes, warnings } = this.memory.query(input)
    return { identity: this.identity(), memory: notes, warnings }
  }
  /** 操作名前面带 memo- 的是备忘录的，别的是个人档案（基础信息和记忆）的。 */
  dispatch(action, input = {}, actor = 'human') {
    if (!object(input)) throw new Error('无效的请求')
    const memo = action.startsWith('memo-'), shelf = memo ? this.memos : this.memory, name = memo ? action.slice(5) : action
    const human = (what) => { if (actor !== 'human') throw new Error(`${what}请在${shelf.page}操作`) }
    switch (memo ? `memo:${name}` : name) {
      case 'snapshot': return this.snapshot()
      case 'identity': return this.saveIdentity(input, actor)
      case 'read': return this.query(input)
      case 'memo:list': return shelf.list()
      case 'memo:read': return shelf.query(input)
      case 'save': case 'memo:save': return actor === 'human' ? shelf.save(input) : shelf.saveByAssistant(input)
      case 'archive': case 'memo:archive': human('归档'); return shelf.archive(input)
      case 'import': case 'memo:import': human('导入'); return shelf.importMarkdown(input)
      case 'export': case 'memo:export': return { markdown: shelf.note(input.title).raw }
      case 'delete': case 'memo:delete': human('删除'); return shelf.remove(input)
      default: throw new Error('不支持的档案操作')
    }
  }
}
