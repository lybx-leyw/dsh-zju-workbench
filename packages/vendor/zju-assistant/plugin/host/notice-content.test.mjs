import test from 'node:test'
import assert from 'node:assert/strict'
import { NoticeContent } from './notice-content.mjs'

const activity = { id: 'sztz:7', kind: 'sztz', title: '读书会', from: '图书馆', closes: '2026-10-16T14:00:00Z' }
const article = { id: 'wechat:1', kind: 'wechat', title: '新文章', from: '测试号', url: 'https://weread.qq.com/web/mp/content?reviewId=MP_WXS_123_WR1abc' }
const feed = { snapshot: async () => ({ items: [article, activity] }) }

test('article reading uses the authenticated source and retains the full text and images', async () => {
  const reader = new NoticeContent({ feed, article: async url => {
    assert.equal(url, article.url)
    return { title: '正文标题', markdown: '很短的正文\n\n![图](https://images.example/a.jpg)', url: 'https://mp.weixin.qq.com/s/real' }
  } })
  const result = await reader.read({ id: article.id })
  assert.match(result.markdown, /!\[图\]/)
  assert.equal(result.originalUrl, 'https://mp.weixin.qq.com/s/real')
  assert.equal(result.title, '正文标题')
  await assert.rejects(reader.read({ id: 'unknown', url: 'https://example.com' }), /不在列表/)
})

test('content endpoints are never presented as a public original link and errors are explicit', async () => {
  const reader = new NoticeContent({ feed, article: async () => ({ markdown: '全文', url: article.url }) })
  assert.equal((await reader.read({ id: article.id })).originalUrl, null)
  reader.article = async () => { throw new Error('微信读书登录已失效') }
  await assert.rejects(reader.read({ id: article.id }), /登录已失效/)
  reader.article = async () => ({ markdown: '' })
  await assert.rejects(reader.read({ id: article.id }), /正文没有读到/)
})

test('activity details preserve short descriptions, registration links, zero counts and select the right date', async () => {
  const row = { name: '读书会', organizer: '图书馆', signupCloses: '2026-10-16 22:00', points: '0.5', quota: 0, signedCount: 0,
    intro: '带书来。', notes: '勿迟到。', signupHow: 'https://example.com/register', signupMethod: '不在本平台报名' }
  const reader = new NoticeContent({ feed, run: async args => {
    assert.deepEqual(args, ['sztz', 'activity', 'list', '--keyword', '读书会', '--include-ended', '--limit', '100'])
    return { activities: [{ ...row, signupCloses: '2026-10-15 22:00', intro: '旧活动' }, row] }
  } })
  const result = await reader.read({ id: activity.id })
  assert.match(result.markdown, /带书来。/); assert.match(result.markdown, /勿迟到。/); assert.match(result.markdown, /https:\/\/example.com\/register/)
  assert.doesNotMatch(result.markdown, /旧活动/)
  assert.ok(result.facts.some(([key, value]) => key === '名额' && value === '0'))
  assert.equal(result.originalUrl, null)
  reader.run = async () => ({ activities: [row, row] })
  await assert.rejects(reader.read({ id: activity.id }), /多个同名/)
  reader.run = async () => ({ activities: [] })
  await assert.rejects(reader.read({ id: activity.id }), /没有找到/)
})

test('学校通知原位读正文和附件，读不全时说明实际范围，原文链接总在', async () => {
  const school = { id: 'school:https://bksy.example/1', kind: 'school', title: '选课通知', from: '本科生院', url: 'https://bksy.example/1' }
  const reader = new NoticeContent({ feed: { snapshot: async () => ({ items: [school] }) }, run: async args => {
    assert.deepEqual(args, ['notice', 'view', '--url', school.url])
    return { notices: [{ title: '关于选课的通知', contentStatus: 'attachment-only', text: '', attachments: [{ text: '选课安排.pdf', url: 'https://bksy.example/a.pdf' }, { text: '说明', url: 'javascript:alert(1)' }] }] }
  } })
  const result = await reader.read({ id: school.id })
  assert.equal(result.originalUrl, school.url)
  assert.match(result.note, /附件里/)
  assert.deepEqual(result.attachments, [{ name: '选课安排.pdf', url: 'https://bksy.example/a.pdf' }, { name: '说明' }])
})

test('邮件只读地读：账号换了不读，编号原样交给邮箱；附件下载后打开所在文件夹', async () => {
  const letter = { id: 'mail:abc:INBOX:9:7', kind: 'mail', title: '修改建议', from: '张老师', accountId: 'abc-account', mailbox: 'INBOX', uid: 7, uidValidity: '9' }
  const reads = [], revealed = []
  const mail = {
    account: () => ({ id: 'abc-account' }), idle: async () => {},
    read: async ref => { reads.push(ref); return { subject: '修改建议', from: [{ name: '张老师', address: 't@example.com' }], to: [{ name: '', address: 's@zju.edu.cn' }], cc: [], date: '2026-10-17T01:00:00.000Z', text: '请补充进度。', truncated: true, attachments: [{ index: 0, filename: '模板.docx' }] } },
    download: async ref => { reads.push(ref); return { file: 'D:/downloads/mail/x/模板.docx', filename: '模板.docx' } },
  }
  const reader = new NoticeContent({ feed: { snapshot: async () => ({ items: [letter] }) }, mail, reveal: file => revealed.push(file) })
  const result = await reader.read({ id: letter.id })
  assert.deepEqual(reads[0], { mailbox: 'INBOX', uid: 7, uidValidity: '9' })
  assert.equal(result.text, '请补充进度。')
  assert.equal(result.originalUrl, null)
  assert.match(result.note, /只显示了前面一部分/)
  assert.deepEqual(result.facts[0], ['发件人', '张老师 <t@example.com>'])
  assert.deepEqual(await reader.download({ id: letter.id, index: 0 }), { filename: '模板.docx' })
  assert.deepEqual(reads[1], { mailbox: 'INBOX', uid: 7, uidValidity: '9', index: 0 })
  assert.deepEqual(revealed, ['D:/downloads/mail/x/模板.docx'])
  mail.account = () => ({ id: 'other' })
  await assert.rejects(reader.read({ id: letter.id }), /账号已经换了/)
})

test('CC98 私信只说明是最新一条、不给网页链接；聊天给原文和 AI 整理', async () => {
  const message = { id: 'cc98:alice:message:42:t', kind: 'cc98', cc98Kind: 'message', title: 'carol发来私信', from: 'carol', url: '', body: '周六打球吗' }
  const chat = { id: 'chat:wechat:k:summary:1', kind: 'chat', title: '整理', from: '年级群', mode: 'summary', body: '周五前交表', originals: [{ id: 'm1', text: '请周五前交表' }] }
  const reader = new NoticeContent({ feed: { snapshot: async () => ({ items: [message, chat] }) } })
  const dm = await reader.read({ id: message.id })
  assert.deepEqual([dm.text, dm.originalUrl], ['周六打球吗', null])
  assert.match(dm.note, /最新的一条/)
  const group = await reader.read({ id: chat.id })
  assert.deepEqual([group.summary, group.messages.length], ['周五前交表', 1])
  // AI 整理出来的事项：截止、时间地点、发送者列成几项，要做什么是整理的那一段。
  const matter = { ...chat, id: 'chat:wechat:k:summary:2', title: '交表 · 10月23日 17:00 截止', matter: { 事项: '交表', 要做什么: '把表交到学院办公室', 截止: '2026-10-23T17:00:00+08:00', 截止原文: '周五下午五点前', 时间地点: '', 发送者: '辅导员' }, deadline: '2026-10-23T17:00:00+08:00' }
  const structured = await new NoticeContent({ feed: { snapshot: async () => ({ items: [matter] }) } }).read({ id: matter.id })
  assert.deepEqual([structured.summary, structured.facts], ['把表交到学院办公室', [['截止', '2026-10-23 17:00（周五下午五点前）'], ['发送者', '辅导员']]])
})
