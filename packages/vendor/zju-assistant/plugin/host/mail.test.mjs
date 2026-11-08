import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Mail, ZJU_MAIL } from './mail.mjs'
import { installMailTools } from './rows/mail.mjs'

const PASSWORD = 'testPassword1234', USER = 'student@zju.edu.cn'
const MIME = Buffer.from('From: Teacher <teacher@example.com>\r\nTo: student@zju.edu.cn\r\nSubject: Assignment\r\nMessage-ID: <assignment@example.com>\r\nDate: Sat, 17 Oct 2026 09:00:00 +0800\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test-boundary\r\n\r\n--test-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease read the attachment.\r\n--test-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../CON.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n--test-boundary--\r\n')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-mail-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const state = { disabled: [], imap: [], smtp: [], send: [], queries: [], sourceReads: 0, close: 0, authError: false, sendError: false, rejected: [], uidValidity: 9n, size: MIME.length }
  const mail = new Mail({ file: path.join(root, 'profile', 'mail.json'), plugins: { disabled: () => state.disabled },
    vault: { seal: async value => { assert.equal(value, PASSWORD); return 'ciphertext-only' }, open: async value => { assert.equal(value, 'ciphertext-only'); return PASSWORD } },
    downloads: { root: async () => path.join(root, 'downloads') },
    imap: options => {
      state.imap.push(options)
      return { on() {}, close() { state.close++ }, async connect() { if (state.authError) throw { authenticationFailed: true, message: PASSWORD } },
        async mailboxOpen(_name, options) { assert.equal(options.readOnly, true); return { uidValidity: state.uidValidity } },
        async list() { return [{ path: 'INBOX', name: 'INBOX', flags: new Set() }, { path: 'container', name: 'container', flags: new Set(['\\Noselect']) }] },
        async search(query, options) { state.queries.push(query); assert.equal(options.uid, true); return [2, 4, 7] },
        async *fetch(range, query, options) { assert.equal(options.uid, true); for (const uid of range.split(',').map(Number)) yield { uid, size: 40, envelope: { subject: 'Test ' + uid, from: [{ name: 'Teacher', address: 'teacher@example.com' }] }, flags: new Set(uid === 7 ? [] : ['\\Seen']) } },
        async fetchOne(_uid, query, options) { assert.equal(options.uid, true); if (query.source) { state.sourceReads++; return { source: MIME } }; return { size: state.size } },
      }
    },
    smtp: options => { state.smtp.push(options); return { close() {}, async verify() { if (state.smtpError) throw { code: 'EAUTH', message: PASSWORD } }, async sendMail(input) { state.send.push(input); if (state.sendError) throw new Error('lost connection'); return { messageId: '<sent@example.com>', accepted: ['receiver@example.com'], rejected: state.rejected } } } },
  })
  const connect = () => mail.connect({ address: USER, password: PASSWORD })
  const draft = () => mail.prepare({ to: ['receiver@example.com'], subject: 'Hello', text: 'Message body' })
  return { root, state, mail, connect, draft }
}

test('default TLS settings, two-server validation and encrypted-only credential storage', async t => {
  const { mail, state, connect } = fixture(t)
  assert.equal(mail.snapshot().connected, false)
  const result = await connect()
  assert.equal(result.connected, true); assert.equal(result.busy, false)
  assert.deepEqual([state.imap[0].host, state.imap[0].port, state.smtp[0].port], ['imap.zju.edu.cn', 993, 994])
  for (const options of [state.imap[0], state.smtp[0]]) { assert.equal(options.secure, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.logger, false) }
  assert.equal(ZJU_MAIL.smtp.host, 'smtp.zju.edu.cn')
  assert.doesNotMatch(fs.readFileSync(mail.file, 'utf8'), /testPassword1234/)
  assert.doesNotMatch(JSON.stringify(result), /ciphertext|password|secret/i)
  state.authError = true
  await assert.rejects(mail.test(), error => /认证失败/.test(error.message) && !error.message.includes(PASSWORD))
  assert.equal(state.close, 2)
  assert.equal(mail.snapshot().busy, false)
})

test('failed new connection preserves saved account; connection input validated before networking', async t => {
  const { mail, state, connect } = fixture(t)
  await assert.rejects(mail.connect({ address: 'person@gmail.com', password: PASSWORD }), /@zju/)
  await assert.rejects(mail.connect({ address: USER, password: 'bad' }), /16 位/)
  assert.equal(state.imap.length, 0)
  await connect()
  const before = fs.readFileSync(mail.file, 'utf8')
  state.smtpError = true
  await assert.rejects(mail.connect({ address: 'another@zju.edu.cn', password: PASSWORD }), /认证失败/)
  assert.equal(fs.readFileSync(mail.file, 'utf8'), before)
})

test('search filters, pagination and source reads preserve unread state and validate UIDVALIDITY', async t => {
  const { mail, connect, state } = fixture(t); await connect()
  const result = await mail.list({ limit: 2, from: 'teacher', query: 'Test', unread: true, since: '2026-10-01', until: '2026-11-01' })
  assert.deepEqual(result.messages.map(item => item.uid), [7, 4]); assert.equal(result.hasMore, true); assert.equal(result.messages[0].unread, true)
  assert.deepEqual(state.queries[0], { from: 'teacher', subject: 'Test', seen: false, since: new Date('2026-10-01'), before: new Date('2026-11-01') })
  const letter = await mail.read(result.messages[0])
  assert.match(letter.text, /Please read/); assert.equal(letter.attachments[0].filename, 'attachment-CON.txt')
  assert.equal((await mail.folders()).folders.length, 1)
  state.uidValidity = 10n
  await assert.rejects(mail.read(result.messages[0]), /重新查询/)
  assert.equal(state.sourceReads, 1)
  await assert.rejects(mail.list({ since: '2026-02-31' }), /日期/)
})

test('attachment download stays in its own directory and oversized messages are not fetched', async t => {
  const { mail, root, connect, state } = fixture(t); await connect()
  const ref = { uid: 7, uidValidity: '9', mailbox: 'INBOX' }
  const download = await mail.download({ ...ref, index: 0 })
  assert.ok(download.file.startsWith(path.join(root, 'downloads', 'mail') + path.sep))
  assert.equal(fs.readFileSync(download.file, 'utf8'), 'Hello')
  state.size = 26 * 1024 * 1024
  await assert.rejects(mail.read(ref), /25 MB/)
  assert.equal(state.sourceReads, 1)
})

test('draft creation and editing never send; confirmation binds content and attachment snapshot', async t => {
  const { mail, root, connect, state } = fixture(t); await connect()
  const file = path.join(root, 'assignment.txt'); fs.writeFileSync(file, 'original')
  const { draft } = await mail.prepare({ to: ['receiver@example.com'], cc: ['copy@example.com'], subject: 'Hello', text: 'Reviewed body', attachments: [file] })
  fs.writeFileSync(file, 'changed after preview')
  assert.equal(draft.attachments[0].content, undefined); assert.equal(state.send.length, 0)
  await assert.rejects(mail.send({ id: draft.id, revision: draft.revision }), /确认/)
  const edited = mail.updateDraft({ id: draft.id, revision: draft.revision, to: draft.to, cc: draft.cc, subject: 'Edited', text: 'Edited body' }).draft
  await assert.rejects(mail.send({ id: draft.id, revision: draft.revision, confirm: true }), /已改变/)
  const result = await mail.send({ id: edited.id, revision: edited.revision, confirm: true })
  assert.equal(result.draft.status, 'sent'); assert.equal(state.send.length, 1)
  assert.equal(state.send[0].text, 'Edited body'); assert.equal(state.send[0].attachments[0].content.toString(), 'original')
  await assert.rejects(mail.send({ id: result.draft.id, revision: result.draft.revision, confirm: true }), /已经尝试/)
  assert.equal(state.send.length, 1)
})

test('uncertain and partially accepted sends are recorded, never blindly retried', async t => {
  const { mail, connect, state, draft } = fixture(t); await connect()
  state.sendError = true
  const first = (await draft()).draft
  const unknown = (await mail.send({ id: first.id, revision: first.revision, confirm: true })).draft
  assert.equal(unknown.status, 'unknown')
  await assert.rejects(mail.send({ id: unknown.id, revision: unknown.revision, confirm: true }), /已经尝试/)
  state.sendError = false; state.rejected = ['copy@example.com']
  const second = (await draft()).draft
  assert.equal((await mail.send({ id: second.id, revision: second.revision, confirm: true })).draft.status, 'partial')
})

test('plugin gate blocks every data operation and disabling in flight cannot save an account', async t => {
  const { mail, connect, state, draft } = fixture(t); await connect()
  const saved = (await draft()).draft
  state.disabled = ['zju-mail']; mail.changed()
  for (const operation of [() => mail.test(), () => mail.list(), () => mail.folders(), () => mail.read({}), () => mail.download({}), () => draft(), () => mail.send({})]) await assert.rejects(operation(), /打开「浙大邮箱」/)
  assert.throws(() => mail.drafts(), /打开/)
  assert.throws(() => mail.updateDraft(saved), /打开/)
  assert.throws(() => mail.removeDraft(saved), /打开/)
  mail.disconnect(); assert.equal(mail.snapshot().connected, false)
  state.disabled = []
  mail.vault.seal = async () => { state.disabled = ['zju-mail']; mail.changed(); return 'ciphertext-only' }
  await assert.rejects(connect(), /打开/)
  assert.equal(fs.existsSync(mail.file), false)
})

test('disconnect deletes secret, reconnect restores own drafts; different accounts cannot send them', async t => {
  const { mail, connect, draft } = fixture(t); await connect()
  const saved = (await draft()).draft
  mail.disconnect(); assert.equal(fs.existsSync(mail.file), false)
  await connect(); assert.equal(mail.drafts().drafts[0].id, saved.id)
  await mail.connect({ address: 'other@zju.edu.cn', password: PASSWORD })
  assert.deepEqual(mail.drafts(), { drafts: [] })
  await assert.rejects(mail.send({ id: saved.id, revision: saved.revision, confirm: true }), /已改变/)
})

test('an outbox file changed outside the UI cannot be sent with a stale preview', async t => {
  const { mail, connect, draft, state } = fixture(t); await connect()
  const saved = (await draft()).draft, file = mail.draftFile(saved.id)
  const changed = JSON.parse(fs.readFileSync(file, 'utf8')); changed.text = 'Changed after preview'
  fs.writeFileSync(file, JSON.stringify(changed))
  await assert.rejects(mail.send({ id: saved.id, revision: saved.revision, confirm: true }), /已改变/)
  assert.equal(state.send.length, 0)
})

test('conversation tools support draft, edit, approved send and record lookup without a plugin composer', async t => {
  const { mail, root, connect, state } = fixture(t); await connect()
  const tools = new Map(), asked = []
  // 发信要经 dsh 的审批：这里的假审批按 answers 依次回答。
  const answers = []
  let policy
  const approval = { request: async (request) => { asked.push(request); return answers.shift() ?? 'allowed-once' }, overrideOf: () => policy }
  installMailTools({ tools: { register: tool => tools.set(tool.name, tool) }, get: name => name === 'approval' ? approval : undefined }, mail)
  const ACTIONS = { campus_mail_draft: 'draft', campus_mail_drafts: 'drafts', campus_mail_remove_draft: 'remove' }
  const call = (name, args = {}) => ACTIONS[name] ? tools.get('campus_mail').execute({ action: ACTIONS[name], ...args }, {}) : tools.get(name).execute(args, { agent: {}, callId: 'call-1' })
  const source = path.join(root, 'conversation-attachment.txt'); fs.writeFileSync(source, 'approved attachment')
  const initial = { to: ['receiver@example.com'], cc: ['copy@example.com'], subject: 'Draft from chat', text: 'First version', attachments: [source] }
  const first = await call('campus_mail_draft', initial)
  assert.match(first.message, /对话/); assert.doesNotMatch(first.message, /插件/)
  assert.equal(state.send.length, 0)
  const summaries = await call('campus_mail_drafts')
  assert.equal(summaries.drafts[0].text, undefined)
  const found = (await call('campus_mail_drafts', { id: first.draft.id })).draft
  assert.equal(found.text, 'First version')
  await assert.rejects(call('campus_mail_draft', { ...initial, id: found.id }), /同时提供/)
  fs.writeFileSync(source, 'modified source')
  const edited = (await call('campus_mail_draft', { id: found.id, revision: found.revision, to: found.to, subject: found.subject, text: 'Revised in conversation' })).draft
  assert.deepEqual(edited.cc, initial.cc)
  assert.equal(edited.attachments[0].size, Buffer.byteLength('approved attachment'))
  answers.push('rejected')
  await assert.rejects(call('campus_mail_send', { id: edited.id, revision: edited.revision }), /没有批准/)
  assert.equal(asked.length, 1); assert.match(asked[0].displayReason.zh, /receiver@example.com/)
  // 权限模式不弹批准时 dsh 没问用户就拒绝，不能说成用户没批准。
  policy = 'never'; answers.push('rejected')
  await assert.rejects(call('campus_mail_send', { id: edited.id, revision: edited.revision }), /用户没有被问过，邮件没有发送。[^]*\/permission workspace-write/)
  policy = undefined
  await assert.rejects(call('campus_mail_send', { id: found.id, revision: found.revision }), /已改变/)
  assert.equal(state.send.length, 0)
  const sent = (await call('campus_mail_send', { id: edited.id, revision: edited.revision })).draft
  assert.equal(sent.status, 'sent'); assert.equal(state.send.length, 1)
  assert.equal(state.send[0].text, 'Revised in conversation')
  assert.equal(state.send[0].attachments[0].content.toString(), 'approved attachment')
  await assert.rejects(call('campus_mail_send', { id: sent.id, revision: sent.revision }), /已经尝试/)
  assert.equal((await call('campus_mail_drafts', { id: sent.id })).draft.status, 'sent')
  await call('campus_mail_remove_draft', { id: sent.id, revision: sent.revision })
  assert.deepEqual(await call('campus_mail_drafts'), { drafts: [] })
})

test('editing draft attachments replaces snapshots only when explicitly supplied', async t => {
  const { mail, root, connect } = fixture(t); await connect()
  const one = path.join(root, 'one.txt'), two = path.join(root, 'two.txt')
  fs.writeFileSync(one, 'one'); fs.writeFileSync(two, 'two')
  const initial = (await mail.prepare({ to: ['receiver@example.com'], cc: ['copy@example.com'], subject: 'Subject', text: 'Body', attachments: [one] })).draft
  const replaced = mail.updateDraft({ ...initial, cc: [], attachments: [two] }).draft
  assert.deepEqual(replaced.cc, []); assert.equal(replaced.attachments[0].filename, 'two.txt')
  const cleared = mail.updateDraft({ ...replaced, attachments: [] }).draft
  assert.deepEqual(cleared.attachments, [])
})
