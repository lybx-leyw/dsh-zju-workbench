import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { accountReady } from '../accounts.mjs'
import { runCore } from './core.mjs'
import { contextId } from './context.mjs'
import { currentTerm } from './learning.mjs'

const digest = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
const str = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 2000) : ''
const names = value => Array.isArray(value) ? value.map(str).filter(Boolean) : str(value).split(/[、,，;；]/).filter(Boolean)
const termText = value => typeof value === 'string' ? value : value && typeof value === 'object' ? [...new Set([value.year, value.name, value.term].map(str).filter(Boolean))].join(' ') : ''
const SOURCES = [
  { id: 'zdbk', name: '教务课表', account: 'zju', plugin: 'zju-courses', key: 'zju_username', args: ['zdbk', 'timetable'], url: 'https://zdbk.zju.edu.cn' },
  { id: 'xuezai', name: '学在浙大', account: 'zju', plugin: 'zju-courses', key: 'zju_username', args: ['xuezai', 'course', 'list'], url: 'https://courses.zju.edu.cn' },
  { id: 'zhiyun', name: '智云课堂', account: 'zju', plugin: 'zju-courses', key: 'zju_username', args: ['zhiyun', 'search', 'courses', '--scope', 'mine', '--limit', '200'], url: 'https://classroom.zju.edu.cn' },
  { id: 'chaoxing', name: '超星学习通', account: 'chaoxing', plugin: 'zju-courses', key: 'chaoxing_username', args: ['chaoxing', 'course', 'list'], url: 'https://i.chaoxing.com' },
  { id: 'xuezai-todos', name: '学在待办', account: 'zju', plugin: 'zju-courses', key: 'zju_username', args: ['xuezai', 'todos'], url: 'https://courses.zju.edu.cn' },
  { id: 'pta', name: 'PTA', account: 'pta', plugin: 'zju-courses', key: 'pta_username', args: ['pta', 'homework', 'list'], url: 'https://pintia.cn' },
]
/** 一个监控的聊天在校园档案里那份平台档案的编号。 */
export const chatContextId = (platform, key) => contextId('platform', `${platform}:${key}`)
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return { sources: {} } } }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
function safeUrl(value) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|cookie|session|ticket|signature/i.test(key)) url.searchParams.delete(key)
    return url.href
  } catch { return '' }
}

/** Normalized observations are a disposable cache; only whitelisted business facts enter Markdown. */
export class ContextSources {
  constructor({ store, account, plugins, chatWatches = {}, mail, fill, run = runCore }) {
    Object.assign(this, { store, account, plugins, mail, fill, run })
    // 监控着的聊天（平台 → ChatWatch）由各自那一行在开着时登记，每次现取。
    this.watches = typeof chatWatches === 'function' ? chatWatches : () => chatWatches
    this.file = store.file('.context-sources.json')
  }
  state(source) {
    if (this.plugins.disabled().includes(source.plugin)) return { status: 'disabled' }
    const values = this.account.read().data
    if (!accountReady(values, source.account)) return { status: 'account_required' }
    return { status: 'available', scope: `${source.id}:${digest(values[source.key])}` }
  }
  records(source, data, scope, at) {
    const records = [], base = { scope, source: `${source.name} · ${source.url}`, at }
    records.push({ ...base, id: contextId('platform', scope), kind: 'platform', title: source.name, fields: { 入口类型: '服务入口' }, body: `# ${source.name}\n\n入口：${source.url}\n\n账号在应用对应插件中管理，这里不存凭证。` })
    if (['zdbk', 'xuezai', 'zhiyun', 'chaoxing'].includes(source.id)) {
      if (!Array.isArray(data?.courses)) throw new Error('课程列表格式不正确，未导入不完整结果。')
      const current = currentTerm(Date.now())
      const rows = source.id === 'zhiyun' ? data.courses.filter(row => str(row.term).includes(current.years) && [...current.seasons].some(season => str(row.term).includes(season))) : data.courses
      const semesterOf = row => {
        const term = termText(row.term || row.semester || data.term)
        return source.id === 'zdbk' && str(data.term?.year) && !/\d{4}/.test(term) ? `${data.term.year} ${term}` : term
      }
      for (const row of rows) {
        const title = str(row.name || row.title), teachers = names(row.teachers || row.teacher), term = semesterOf(row)
        if (!title) continue
        const same = rows.filter(other => str(other.name || other.title) === title && semesterOf(other) === term && JSON.stringify(names(other.teachers || other.teacher)) === JSON.stringify(teachers))
        const url = safeUrl(row.link || row.url), sourceId = str(row.id || row.courseId || row.courseCode)
        const key = sourceId || url || JSON.stringify([title, term, teachers, ...(same.length > 1 ? [row.meetings ?? []] : [])])
        const kind = source.id === 'zdbk' ? 'course' : 'platform'
        records.push({ ...base, id: contextId(kind, `${scope}:${key}`), kind, title: `${title}${term ? ` · ${term}` : ''}${kind === 'platform' ? ` · ${source.name}` : ''}`,
          fields: { 学期: term, 教师: teachers, 课程号: str(row.courseCode || row.code), 教学班: str(row.sectionId || row.className), 别名: [title], ...(kind === 'platform' ? { 入口类型: '课程入口', 所属课程: title } : {}) },
          body: `# ${title}\n\n来源：${source.name}\n\n${term ? `学期：${term}\n\n` : '学期未由该来源提供，关联前需核对。\n\n'}教师：${teachers.join('、') || '未提供'}\n\n${url ? `入口：${url}\n\n` : ''}来源编号：${sourceId || '该接口未提供，关联时需核对课程及教学班'}\n\n${kind === 'course' ? '这是教务课表中的课程记录。其他平台课程和课程群需分别核对关联。' : '这是平台中的课程入口，尚不能仅凭名称认定它对应某个教学班。'}` })
      }
    } else if (source.id === 'xuezai-todos' || source.id === 'pta') {
      const rows = source.id === 'pta' ? data?.homeworks : data?.todos
      if (!Array.isArray(rows)) throw new Error('事项列表格式不正确。')
      for (const row of rows) {
        if (row.closed || row.endedByUser) continue
        const title = str(row.title || row.name), course = str(row.course), deadline = str(row.deadline)
        if (!title) continue
        const state = row.state === '未开始' ? '未作答' : str(row.state || row.status) || '待处理'
        const key = str(row.id || row.url) || JSON.stringify([course, title, row.type])
        records.push({ ...base, id: contextId('matter', `${scope}:${key}`), kind: 'matter', title: course ? `${course} · ${title}` : title,
          fields: { 截止时间: deadline, 状态: state, 所属课程: course, 别名: [title, course].filter(Boolean), 学期: termText(row.term || data.term), 课程号: str(row.courseCode), 教学班: str(row.sectionId) },
          body: `# ${title}\n\n来源：${source.name}\n\n课程：${course || '该来源未提供，待关联'}\n\n截止：${deadline || '未提供'}\n\n作答或提交状态：${state}\n\n${safeUrl(row.url) ? `入口：${safeUrl(row.url)}\n\n` : ''}${str(row.requirement)}` })
      }
    }
    return records
  }
  observe() {
    const saved = read(this.file), records = [], scopes = [], messages = [], warnings = []
    for (const source of SOURCES) {
      const state = this.state(source), cached = saved.sources?.[source.id]
      if (state.status !== 'available') continue
      scopes.push(state.scope)
      if (cached?.scope === state.scope) {
        records.push(...(Array.isArray(cached.records) ? cached.records : []))
        if (cached.error) warnings.push(`${source.name}：${cached.error}；保留上次取得的资料`)
      }
    }
    for (const [platform, watch] of Object.entries(this.watches())) {
      if (!watch.enabled()) continue
      for (const track of watch.settings().tracks) {
        const scope = `${platform}:${track.key}`, id = chatContextId(platform, track.key)
        scopes.push(scope)
        records.push({ id, kind: 'platform', scope, title: `${track.name} · ${platform === 'dingtalk' ? '钉钉' : '微信'}`, fields: { 别名: [track.name], 入口类型: track.kind === 'personal' ? '个人聊天' : '群聊' }, source: `${platform} 本机已同步聊天`, at: watch.cache().states[track.key]?.checkedAt || '',
          body: `# ${track.name}\n\n平台：${platform === 'dingtalk' ? '钉钉' : '微信'}\n\n会话编号：${track.id}\n\n来源账号标识：${digest(track.profile || '')}\n\n这是用户已选择的监控会话。群名只供匹配参考，课程归属需要确认。仅覆盖本机已同步的数据。` })
        for (const notice of watch.notices().filter(item => item.trackKey === track.key).slice(0, 20)) messages.push({ profileId: id, id: notice.id, from: notice.from, at: notice.at, text: String(notice.body || '').slice(0, 6000), textTruncated: String(notice.body || '').length > 6000, coverage: 'local_synced', mode: notice.mode })
      }
    }
    const mail = this.mail?.snapshot()
    if (mail?.enabled && mail.connected) {
      const scope = `mail:${digest(mail.address)}`
      scopes.push(scope)
      records.push({ id: contextId('platform', scope), kind: 'platform', scope, title: '浙大邮箱', fields: { 入口类型: '邮箱' }, source: '邮箱插件连接状态', at: mail.connectedAt,
        body: '# 浙大邮箱\n\n入口：https://mail.zju.edu.cn\n\n已连接。助手按当前问题调用邮件工具读取所需邮件；初始化不扫描收件箱，也不保存专用密码。' })
    }
    messages.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return { records, scopes, messages, warnings }
  }
  /** No global account or user-specific template. Each run uses the calling app profile. */
  initialize() {
    if (this.running) return this.running
    this.running = this.collect().finally(() => { this.running = null })
    return this.running
  }
  async collect() {
    const results = [], blocked = new Set()
    if (accountReady(this.account.read().data, 'zju') && this.fill) {
      try { const value = await this.fill.refresh(); results.push({ source: '个人资料', status: 'ready', changed: value.changed }) }
      catch (error) { results.push({ source: '个人资料', status: 'error', error: error.message }); if (/认证|登录|密码|验证码/.test(error.message)) blocked.add('zju') }
    } else results.push({ source: '个人资料', status: 'account_required', action: '在插件页「ZJU All-in-One Assistant → 校园账号」里填好账号，或在设置的「个人档案」里填写资料。' })
    // Sequential within one campus account avoids parallel authentication and stop-on-auth-failure is handled by the core.
    const saved = read(this.file); saved.sources ||= {}
    for (const source of SOURCES) {
      const state = this.state(source)
      if (state.status !== 'available') {
        const action = source.account === 'zju' ? '在「校园账号」连接统一身份认证及所需的 WebVPN，教务、学在、智云共用这一处账号。' : source.account === 'pta' ? '在「课程与作业」填写独立 PTA 账号。' : '在「学习资料」填写独立学习通账号。'
        results.push({ source: source.name, status: state.status, ...(state.status === 'account_required' ? { action } : {}) }); continue
      }
      if (blocked.has(source.account)) { results.push({ source: source.name, status: 'authentication_blocked', action: '同一账号认证失败，本轮不重复尝试。' }); continue }
      try {
        const data = await this.run(source.args, { system: source.name, timeoutMs: 120000 })
        if (this.state(source).scope !== state.scope) { results.push({ source: source.name, status: 'account_changed' }); continue }
        const at = data?.cache?.fetchedAt || new Date().toISOString(), records = this.records(source, data, state.scope, at)
        const error = data?.cache?.stale ? '平台本次未能刷新，返回了旧缓存' : null
        saved.sources[source.id] = { scope: state.scope, records, at, error }
        write(this.file, saved)
        results.push({ source: source.name, status: error ? 'stale' : 'ready', records: records.length, ...(error ? { error } : {}) })
      } catch (error) {
        if (/认证|登录|密码|验证码/.test(error.message)) blocked.add(source.account)
        const old = saved.sources[source.id]
        if (old?.scope === state.scope) { old.error = error.message; write(this.file, saved) }
        results.push({ source: source.name, status: 'error', error: error.message })
      }
    }
    return { sources: results, chats: Object.entries(this.watches()).map(([platform, watch]) => ({ platform, enabled: watch.enabled(), selected: watch.enabled() ? watch.settings().tracks.length : 0 })), note: '未选择的聊天、邮件正文和附件未读取。课程群归属尚需核对，名称相似只作为候选。' }
  }
}
