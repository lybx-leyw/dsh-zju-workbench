import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { Downloads } from './downloads.mjs'

export const ZJU_MAIL = Object.freeze({ imap: { host: 'imap.zju.edu.cn', port: 993, secure: true }, smtp: { host: 'smtp.zju.edu.cn', port: 994, secure: true } })
const MAX_MESSAGE = 25 * 1024 * 1024, MAX_ATTACHMENTS = 10 * 1024 * 1024
const readJSON = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
function text(value, max = 500, optional = true) {
  if (optional && (value === undefined || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\0/.test(value)) throw new Error('输入内容为空或过长。')
  return value.trim()
}
function address(value) {
  const found = text(value, 254, false)
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(found)) throw new Error('请填写完整的邮箱地址。')
  return found
}
function recipients(value, required = false) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;，；]/).map(item => item.trim()).filter(Boolean) : []
  if (items.length > 20 || (required && !items.length)) throw new Error('请填写收件人，每栏最多 20 个地址。')
  return [...new Set(items.map(address))]
}
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('无效的页码或邮件编号。')
  return n
}
function date(value) {
  if (!value) return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('日期请使用 YYYY-MM-DD 格式。')
  return new Date(value + 'T00:00:00Z')
}
const addresses = values => (values ?? []).map(item => ({ name: item.name ?? '', address: item.address ?? '' }))
const iso = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : ''
function filename(value) {
  let name = String(value || 'attachment').split(/[\\/]/).pop().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160)
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `attachment-${name || 'file'}`
  return name
}
function connectionError(error) {
  if (error?.authenticationFailed || error?.code === 'EAUTH') return new Error('邮箱认证失败。请检查完整邮箱地址，并在网页版生成或更新 16 位客户端专用密码；收信和发信都使用它。')
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ETIMEOUT') return new Error('连接浙大邮箱超时，请检查网络后重试。')
  return new Error('未能连接浙大邮箱。请检查网络和客户端专用密码，服务器使用 IMAP 993、SMTP 994 加密连接。')
}

function snapshotAttachments(paths = []) {
  if (!Array.isArray(paths) || paths.length > 10) throw new Error('一封邮件最多附加 10 个文件。')
  const attachments = []; let total = 0
  for (const source of paths) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('附件须为本地文件的绝对路径。')
    const stat = fs.statSync(source)
    if (!stat.isFile() || total + stat.size > MAX_ATTACHMENTS) throw new Error('附件总大小不能超过 10 MB，且须为普通文件。')
    const content = fs.readFileSync(source); total += content.length
    if (total > MAX_ATTACHMENTS) throw new Error('附件总大小不能超过 10 MB。')
    attachments.push({ filename: filename(path.basename(source)), size: content.length, source, content: content.toString('base64') })
  }
  return attachments
}

/** One ZJU account, direct TLS connections, read-only IMAP and conversation-approved drafts. */
export class Mail {
  /** vault 存取专用密码（mail-vault.mjs）。 */
  constructor({ file, plugins, vault, downloads = new Downloads(), imap = options => new ImapFlow(options), smtp = options => nodemailer.createTransport(options) }) {
    this.file = file; this.outbox = path.join(path.dirname(file), 'mail-outbox'); this.plugins = plugins
    this.vault = vault; this.downloads = downloads; this.imap = imap; this.smtp = smtp
    this.busy = false; this.generation = 0; this.clients = new Set()
  }
  enabled() { return !this.plugins.disabled().includes('zju-mail') }
  assertEnabled() { if (!this.enabled()) throw new Error('请先在插件页「ZJU All-in-One Assistant」里打开「浙大邮箱」。') }
  account() { return readJSON(this.file, null) }
  snapshot() {
    const account = this.account()
    return { enabled: this.enabled(), connected: !!account, address: account?.address ?? '', connectedAt: account?.connectedAt ?? '', busy: this.busy, servers: ZJU_MAIL }
  }
  changed() { this.generation++; for (const client of this.clients) { try { client.close() } catch {} } }
  check(generation) {
    this.assertEnabled()
    if (generation !== this.generation) throw new Error('邮箱连接或插件状态已改变，请重新操作。')
  }
  async exclusive(work) {
    this.assertEnabled()
    if (this.busy) throw new Error('邮箱正在处理上一项操作，请稍后再试。')
    this.busy = true
    const generation = this.generation
    const running = (async () => { try { return await work(generation) } finally { this.busy = false } })()
    this.running = running.catch(() => {})
    return running
  }
  /** Waits for the operation in progress, so a page read does not collide with a background inbox check. */
  async idle(rounds = 3) {
    for (let round = 0; this.busy && round < rounds; round++) await this.running
  }
  async credentials() {
    const account = this.account()
    if (!account) throw new Error('请到插件页「ZJU All-in-One Assistant → 浙大邮箱」的配置里填写邮箱地址和客户端专用密码。')
    return { ...account, password: await this.vault.open(account.secret) }
  }
  async withImap(credentials, generation, work) {
    this.check(generation)
    const client = this.imap({ ...ZJU_MAIL.imap, auth: { user: credentials.address, pass: credentials.password }, logger: false, emitLogs: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000, maxLiteralSize: MAX_MESSAGE, maxResponseSize: MAX_MESSAGE + 1024 * 1024, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, disableAutoIdle: true })
    this.clients.add(client); client.on('error', () => {})
    try {
      try { await client.connect() } catch (error) { throw connectionError(error) }
      this.check(generation)
      return await work(client)
    } finally { this.clients.delete(client); client.close() }
  }
  transporter(credentials) {
    const client = this.smtp({ ...ZJU_MAIL.smtp, auth: { user: credentials.address, pass: credentials.password }, logger: false, debug: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true })
    this.clients.add(client)
    return client
  }
  async verify(credentials, generation) {
    await this.withImap(credentials, generation, client => client.mailboxOpen('INBOX', { readOnly: true }))
    this.check(generation)
    const smtp = this.transporter(credentials)
    try { await smtp.verify() } catch (error) { throw connectionError(error) }
    finally { this.clients.delete(smtp); smtp.close() }
    this.check(generation)
  }
  connect(input) {
    return this.exclusive(async generation => {
      const user = address(input?.address).toLowerCase(), password = text(input?.password, 128, false)
      if (!user.endsWith('@zju.edu.cn')) throw new Error('此插件连接 @zju.edu.cn 邮箱，请填写完整浙大邮箱地址。')
      if (!/^[\x21-\x7e]{16}$/.test(password)) throw new Error('请填写网页版生成的 16 位客户端专用密码，区分大小写。')
      // Seal before network work, so a missing credentials service cannot leave a falsely connected account.
      const secret = await this.vault.seal(password)
      await this.verify({ address: user, password }, generation)
      this.check(generation)
      writeJSON(this.file, { id: createHash('sha256').update(user).digest('hex'), address: user, secret, connectedAt: new Date().toISOString() })
      this.generation++
      return { ...this.snapshot(), busy: false }
    })
  }
  test() { return this.exclusive(async generation => { await this.verify(await this.credentials(), generation); return { ...this.snapshot(), busy: false } }) }
  disconnect() {
    if (this.busy) throw new Error('邮箱正在处理上一项操作，请结束后再断开。')
    this.changed()
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file)
    void this.vault.forget?.().catch(() => {})
    return this.snapshot()
  }
  folders() {
    return this.exclusive(async generation => this.withImap(await this.credentials(), generation, async client => {
      const folders = await client.list()
      this.check(generation)
      return { folders: folders.filter(item => !item.flags?.has('\\Noselect')).map(item => ({ path: item.path, name: item.name, specialUse: item.specialUse ?? '' })) }
    }))
  }
  list(input = {}) {
    return this.exclusive(async generation => this.withImap(await this.credentials(), generation, async client => {
      const mailbox = text(input.mailbox) || 'INBOX', limit = integer(input.limit, 20, 1, 50), offset = integer(input.offset, 0, 0, 1000000)
      const query = {}, since = date(input.since), until = date(input.until)
      if (since) query.since = since
      if (until) query.before = until
      if (since && until && since >= until) throw new Error('结束日期须晚于开始日期（结束日期当天不计入）。')
      if (input.unread === true) query.seen = false
      if (input.from) query.from = text(input.from)
      if (input.query) query.subject = text(input.query)
      const box = await client.mailboxOpen(mailbox, { readOnly: true })
      const uids = (await client.search(Object.keys(query).length ? query : { all: true }, { uid: true }) || []).sort((a, b) => b - a)
      const page = uids.slice(offset, offset + limit)
      const messages = []
      if (page.length) for await (const item of client.fetch(page.join(','), { uid: true, envelope: true, flags: true, size: true }, { uid: true })) {
        const envelope = item.envelope ?? {}
        messages.push({ uid: item.uid, uidValidity: String(box.uidValidity), mailbox, subject: envelope.subject || '（无主题）', from: addresses(envelope.from), to: addresses(envelope.to), date: iso(envelope.date), unread: !item.flags?.has('\\Seen'), size: item.size })
      }
      this.check(generation)
      return { messages: messages.sort((a, b) => b.uid - a.uid), total: uids.length, offset, hasMore: offset + page.length < uids.length, mailbox, uidValidity: String(box.uidValidity) }
    }))
  }
  /**
   * New INBOX arrivals for the app's personal-message list, read-only so server unread flags never change.
   * New mail is decided by UID after the last one seen under the same UIDVALIDITY, never by unread flags, sender dates or one page.
   * Without a matching state (first run, or the folder was rebuilt) only the latest `baseline` headers are returned as a baseline.
   * At most `max` headers per call in UID order; `more` says the rest is still waiting, and `last` only advances over what was returned.
   */
  inbox(input = {}) {
    return this.exclusive(async generation => {
      const credentials = await this.credentials()
      return this.withImap(credentials, generation, async client => {
        const baseline = integer(input.baseline, 20, 1, 50), max = integer(input.max, 200, 1, 500)
        const box = await client.mailboxOpen('INBOX', { readOnly: true }), uidValidity = String(box.uidValidity)
        const after = Number.isSafeInteger(input.after) && input.after >= 0 ? input.after : -1
        const resume = after >= 0 && input.uidValidity === uidValidity
        // A "n:*" search always includes the newest message even below n, so the filter is required.
        const found = (await client.search(resume ? { uid: `${after + 1}:*` } : { all: true }, { uid: true }) || []).filter(uid => !resume || uid > after).sort((a, b) => a - b)
        const page = resume ? found.slice(0, max) : found.slice(-baseline)
        const messages = []
        if (page.length) for await (const item of client.fetch(page.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          const envelope = item.envelope ?? {}
          messages.push({ uid: item.uid, subject: envelope.subject || '（无主题）', from: addresses(envelope.from), date: iso(envelope.date), receivedAt: iso(item.internalDate) })
        }
        this.check(generation)
        const last = resume ? (page.at(-1) ?? after) : (found.at(-1) ?? 0)
        return { accountId: credentials.id, mailbox: 'INBOX', uidValidity, baseline: !resume, last, more: resume && found.length > page.length, messages: messages.sort((a, b) => a.uid - b.uid) }
      })
    })
  }
  async message(client, input) {
    const mailbox = text(input?.mailbox) || 'INBOX', uid = integer(input?.uid, 0, 1, 4294967295)
    const validity = text(input?.uidValidity, 30, false)
    const box = await client.mailboxOpen(mailbox, { readOnly: true })
    if (String(box.uidValidity) !== validity) throw new Error('邮箱目录已发生变化，请重新查询列表后再打开邮件。')
    const meta = await client.fetchOne(uid, { size: true }, { uid: true })
    if (!meta) throw new Error('邮件已被移动或删除，请刷新列表。')
    if (!Number.isFinite(meta.size) || meta.size > MAX_MESSAGE) throw new Error('这封邮件超过 25 MB，请在浙大邮箱网页版查看。')
    const item = await client.fetchOne(uid, { source: true }, { uid: true })
    if (!item?.source) throw new Error('邮件已被移动或删除，请刷新列表。')
    if (item.source.length > MAX_MESSAGE) throw new Error('这封邮件超过 25 MB，请在浙大邮箱网页版查看。')
    const parsed = await simpleParser(item.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: MAX_MESSAGE })
    return { parsed, mailbox, uid, uidValidity: validity }
  }
  read(input) {
    return this.exclusive(async generation => this.withImap(await this.credentials(), generation, async client => {
      const { parsed, ...reference } = await this.message(client, input)
      this.check(generation)
      return { ...reference, subject: parsed.subject || '（无主题）', from: addresses(parsed.from?.value), to: addresses(parsed.to?.value), cc: addresses(parsed.cc?.value), replyTo: addresses(parsed.replyTo?.value), messageId: parsed.messageId ?? '', date: iso(parsed.date), text: (parsed.text || '这封邮件没有可显示的文字，请在网页版查看。').slice(0, 60000), truncated: (parsed.text?.length ?? 0) > 60000, attachments: parsed.attachments.map((item, index) => ({ index, filename: filename(item.filename), size: item.size, contentType: item.contentType })) }
    }))
  }
  download(input) {
    return this.exclusive(async generation => this.withImap(await this.credentials(), generation, async client => {
      const { parsed } = await this.message(client, input)
      const index = integer(input.index, -1, 0, 1000), attachment = parsed.attachments[index]
      if (!attachment) throw new Error('没有找到这个附件，请重新打开邮件。')
      const directory = path.join(await this.downloads.root(), 'mail', randomUUID()), name = filename(attachment.filename)
      this.check(generation)
      fs.mkdirSync(directory, { recursive: true })
      const file = path.join(directory, name)
      fs.writeFileSync(file, attachment.content, { flag: 'wx' })
      return { file, filename: name, size: attachment.content.length }
    }))
  }
  draftFile(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的草稿编号。')
    return path.join(this.outbox, `${id}.json`)
  }
  revision(draft) { return createHash('sha256').update(JSON.stringify(draft)).digest('hex') }
  publicDraft(draft) { return { ...draft, revision: this.revision(draft), attachments: draft.attachments.map(({ content: _content, ...item }) => item) } }
  drafts() {
    this.assertEnabled()
    const account = this.account()
    if (!account || !fs.existsSync(this.outbox)) return { drafts: [] }
    const drafts = []
    for (const name of fs.readdirSync(this.outbox).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const item = readJSON(path.join(this.outbox, name))
      if (item.accountId === account.id) drafts.push(this.publicDraft(item))
    }
    return { drafts: drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  }
  prepare(input) {
    return this.exclusive(async generation => {
      const account = this.account()
      if (!account) throw new Error('请先连接浙大邮箱。')
      if (this.drafts().drafts.length >= 30) throw new Error('本地已保留 30 封草稿或发送记录，请先移除不需要的记录。')
      const to = recipients(input?.to, true), cc = recipients(input?.cc)
      const subject = text(input?.subject, 998, false), body = text(input?.text, 100000, false)
      if (/[\r\n]/.test(subject)) throw new Error('邮件主题不能包含换行。')
      const attachments = snapshotAttachments(input?.attachments)
      const draft = { id: randomUUID(), revision: randomUUID(), accountId: account.id, from: account.address, to, cc, subject, text: body, attachments, status: 'draft', createdAt: new Date().toISOString() }
      this.check(generation)
      writeJSON(this.draftFile(draft.id), draft)
      return { draft: this.publicDraft(draft), message: '草稿已保存，尚未发送。请在对话中展示完整内容，取得对应版本的发送授权后使用 campus_mail_send。' }
    })
  }
  removeDraft(input) {
    this.assertEnabled()
    if (this.busy) throw new Error('邮箱正在处理上一项操作，请稍后再试。')
    const file = this.draftFile(input?.id), draft = readJSON(file, null)
    if (!draft || this.revision(draft) !== input.revision || draft.accountId !== this.account()?.id) throw new Error('草稿已改变，请刷新后再操作。')
    fs.unlinkSync(file)
    return this.drafts()
  }
  updateDraft(input) {
    this.assertEnabled()
    if (this.busy) throw new Error('邮箱正在处理上一项操作，请稍后再试。')
    const file = this.draftFile(input?.id), draft = readJSON(file, null)
    if (!draft || draft.status !== 'draft' || this.revision(draft) !== input.revision || draft.accountId !== this.account()?.id) throw new Error('草稿已改变，请刷新后重新核对。')
    const subject = text(input.subject, 998, false)
    if (/[\r\n]/.test(subject)) throw new Error('邮件主题不能包含换行。')
    const attachments = input.attachments === undefined ? draft.attachments : snapshotAttachments(input.attachments)
    Object.assign(draft, { to: recipients(input.to, true), cc: input.cc === undefined ? draft.cc : recipients(input.cc), subject, text: text(input.text, 100000, false), attachments, revision: randomUUID() })
    writeJSON(file, draft)
    return { draft: this.publicDraft(draft) }
  }
  /** The assistant sends the exact draft revision authorized in the conversation. */
  send(input) {
    return this.exclusive(async generation => {
      if (input?.confirm !== true) throw new Error('请先在对话中确认邮件内容并取得用户的明确发送授权。')
      const file = this.draftFile(input.id), draft = readJSON(file, null), account = await this.credentials()
      if (!draft || this.revision(draft) !== input.revision || draft.accountId !== account.id || draft.from !== account.address) throw new Error('草稿或邮箱账号已改变，请刷新后重新核对。')
      if (draft.status !== 'draft') throw new Error('这封邮件已经尝试发送。为避免重复发送，请先核实发送结果。')
      this.check(generation)
      const smtp = this.transporter(account)
      // Persist before SMTP: a crash or uncertain response must never cause an automatic resend.
      draft.status = 'sending'; draft.revision = randomUUID(); writeJSON(file, draft)
      try {
        const result = await smtp.sendMail({ from: draft.from, to: draft.to, cc: draft.cc, subject: draft.subject, text: draft.text, attachments: draft.attachments.map(item => ({ filename: item.filename, content: Buffer.from(item.content, 'base64') })), disableFileAccess: true, disableUrlAccess: true })
        draft.status = result.rejected?.length ? 'partial' : 'sent'
        draft.messageId = result.messageId ?? ''; draft.sentAt = new Date().toISOString()
        draft.accepted = (result.accepted ?? []).map(String); draft.rejected = (result.rejected ?? []).map(String)
        draft.message = draft.status === 'partial' ? '部分收件人被服务器拒绝，请核对收件人结果，勿整封重复发送。' : '邮件已交给浙大邮件服务器。'
      } catch {
        draft.status = 'unknown'; draft.message = '发送未能确认。请在网页版或向收件人核实结果，避免重复发送。'
      } finally { this.clients.delete(smtp); smtp.close() }
      draft.revision = randomUUID(); writeJSON(file, draft)
      return { draft: this.publicDraft(draft) }
    })
  }
}
