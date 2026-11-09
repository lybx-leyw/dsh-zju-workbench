import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NoticeMemo, deadlinesIn, inSource, linkOf, memoTitle, parseSummary } from './notice-memo.mjs'
import { ProfileStore, noteTitle } from './store.mjs'
import { memoEvents } from '../calendar.mjs'

const SCHOOL = { id: 'school:https://bksy.example/1', kind: 'school', title: '关于 2026 年秋冬学期第三轮选课的通知', from: '教务网', at: '2026-10-08T00:00:00+08:00', dated: false, url: 'https://bksy.example/1', foundAt: null }
const ARTICLE = { id: 'wechat:a1', kind: 'wechat', title: '全明星校园行｜报名开始', from: '浙大体育与艺术', at: '2026-10-09T09:00:00.000Z', dated: true, url: 'https://mp.weixin.qq.com/s/x', foundAt: null }
const ACTIVITY = { id: 'sztz:77', kind: 'sztz', title: '图书馆志愿服务（十月）', from: '图书馆', at: '2026-10-09T02:00:00.000Z', dated: true, url: 'https://sztz.zju.edu.cn/dekt/#/index/hdzx?xmmc=a(b)&xmId=77', foundAt: null, opens: '2026-10-09T00:00:00.000Z', closes: '2026-10-20T04:00:00.000Z' }
const BODY = '各位同学：第三轮选课将于10月14日9:00开始，请于10月16日17:00前在教务网完成选课。大一新生不参加本轮选课。逾期不再受理，有问题联系本科生院 88206222。'
const ANSWER = { 讲了什么: '第三轮选课的时间安排。', 要做什么: '在教务网完成选课。', 截止: '10月16日17:00前', 时间地点: '10月14日9:00开始', 对象: '大一新生不参加。', 材料: '', 其他: '本科生院 88206222' }

/** asks 记下每次问模型给的内容；runs 记下跑过的 core 命令。answer、view、activities、article 是各处给的回答。 */
function fixture(t, { items = [SCHOOL, ARTICLE, ACTIVITY], answer = JSON.stringify(ANSWER), view = { contentStatus: 'full', text: BODY, attachments: [] }, activities = [], article = async () => ({ markdown: '' }) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-notice-memo-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(root, 'profile')), asks = [], runs = []
  const memo = new NoticeMemo({
    store, feed: { snapshot: async () => ({ items }) }, article,
    ask: async (input) => { asks.push(input); if (answer instanceof Error) throw answer; return answer },
    run: async (args, options) => {
      runs.push({ args, options })
      if (args[0] === 'notice') { if (view instanceof Error) throw view; return { notices: [view] } }
      return { activities }
    },
  })
  return { memo, store, asks, runs }
}

test('通知的标题变成能当文件名的备忘标题：符号换成全角，太长的截短，重名的加序号', () => {
  assert.equal(memoTitle('关于「形策」课程 [第2次] 的通知: 请于 10/21 前完成?'), '关于「形策」课程 ［第2次］ 的通知： 请于 10／21 前完成？')
  assert.equal(memoTitle('  多个   空格\n和换行  '), '多个 空格 和换行')
  assert.equal(memoTitle('.开头和结尾的点...'), '开头和结尾的点')
  assert.equal(memoTitle(''), '通知')
  assert.equal(memoTitle('CON'), 'CON 通知')
  const long = memoTitle('长'.repeat(120))
  assert.equal(long, `${'长'.repeat(79)}…`)
  const taken = new Set(['四六级报名', '四六级报名（2）'])
  assert.equal(memoTitle('四六级报名', title => taken.has(title)), '四六级报名（3）')
  // 截短以后加序号也不超过 80 个字。
  assert.equal(memoTitle('长'.repeat(120), title => title === long), `${'长'.repeat(76)}…（2）`)
  // 出来的标题档案那边都收。
  for (const title of ['a/b\\c:d*e?f"g<h>i|j[k]l#m^n', '长'.repeat(200), '.', 'nul', '\u0001\u0002']) assert.doesNotThrow(() => noteTitle(memoTitle(title)), title)
})

test('模型的回答里取出那几项：前后带了别的字也行，不是 JSON、几项全空的不要', () => {
  assert.deepEqual(parseSummary(`好的：\n\`\`\`json\n${JSON.stringify({ ...ANSWER, 多的: 'x' })}\n\`\`\``), ANSWER)
  assert.equal(parseSummary('{"讲了什么": "一行\\n两行", "要做什么": 3}').讲了什么, '一行 两行')
  assert.equal(parseSummary('{"讲了什么": "一行", "要做什么": 3}').要做什么, '')
  for (const bad of ['', '没有可总结的', '{"讲了什么": ""}', '[1, 2]', '{坏的']) assert.equal(parseSummary(bad), undefined, bad)
})

test('截止时间要在正文里对得上：原话，或者数字照顺序挨着出现', () => {
  assert.equal(inSource('10月16日17:00前', BODY), true)
  // 空白和全角的差别不算。
  assert.equal(inSource('10 月 16 日 17：00 前', BODY), true)
  // 改写过但数字都对得上的也认。
  assert.equal(inSource('10月16日（周五）17:00', BODY), true)
  // 正文里没有的日期、只有一个数字对上的不认。
  assert.equal(inSource('10月18日17:00前', BODY), false)
  assert.equal(inSource('16日前', BODY), false)
  assert.equal(inSource('', BODY), false)
  // 数字只对上前一截的不算：正文是 16 日，说成 1 日、说成 161 日都不认。
  assert.equal(inSource('10月1日前', BODY), false)
  assert.equal(inSource('10月16日170:00', BODY), false)
  // 给了几个的一个一个对，后面括号里注明是什么事的照样留着。
  assert.equal(deadlinesIn('10月16日17:00前（完成选课）；10月18日前（退课）; 10月14日9:00', BODY), '10月16日17:00前（完成选课）；10月14日9:00')
  assert.equal(deadlinesIn('', BODY), '')
})

test('直接添加：标题、来源、日期和原文链接，不联网、不问模型；同一条不重复加', async (t) => {
  const { memo, store, asks, runs } = fixture(t)
  assert.deepEqual(await memo.add({ id: SCHOOL.id }), { title: SCHOOL.title, existed: false, summarized: false, reason: '' })
  const note = store.memos.note(SCHOOL.title)
  assert.deepEqual(note.properties, [{ key: '来源', value: '教务网' }, { key: '日期', value: '2026-10-08' }])
  assert.equal(note.body, '[查看原文](https://bksy.example/1)\n')
  // 是用户点的，照人自己写的存：不算助手写的。
  assert.equal(store.memos.owned(note), false)
  assert.deepEqual([asks.length, runs.length], [0, 0])
  // 再点一次，直接点还是要总结，都告诉页面已经在了。
  assert.deepEqual(await memo.add({ id: SCHOOL.id }), { title: SCHOOL.title, existed: true, summarized: false, reason: '' })
  assert.deepEqual(await memo.add({ id: SCHOOL.id, summarize: true }), { title: SCHOOL.title, existed: true, summarized: false, reason: '' })
  assert.equal(store.memos.list().notes.length, 1)
  assert.deepEqual([asks.length, runs.length], [0, 0])
  // 归档了也算在；用户改了标题、正文里的链接还在，也认得出。
  store.memos.archive({ title: SCHOOL.title, revision: store.memos.note(SCHOOL.title).revision, archived: true })
  assert.equal((await memo.add({ id: SCHOOL.id })).existed, true)
  // 二课活动写报名截止；链接里的括号换掉，不然 Markdown 的链接会断。
  await memo.add({ id: ACTIVITY.id })
  const activity = store.memos.note('图书馆志愿服务（十月）')
  assert.deepEqual(activity.properties, [{ key: '来源', value: '图书馆' }, { key: '报名截止', value: '2026-10-20 12:00' }])
  assert.equal(activity.body, `[查看原文](${linkOf(ACTIVITY.url)})\n`)
  assert.match(activity.body, /xmmc=a%28b%29&xmId=77/)
  // 公众号文章的日期按北京时间算；标题里不能当文件名的符号换掉了。
  assert.equal((await memo.add({ id: ARTICLE.id })).title, '全明星校园行｜报名开始')
  assert.deepEqual(store.memos.note('全明星校园行｜报名开始').properties, [{ key: '来源', value: '浙大体育与艺术' }, { key: '日期', value: '2026-10-09' }])
  await assert.rejects(memo.add({ id: 'school:没有的' }), /已经不在列表里/)
  assert.throws(() => memo.add({}), /无效的请求/)
})

test('已经有一条同名的备忘（不是这条通知）时，新的加序号', async (t) => {
  const { memo, store } = fixture(t)
  store.memos.save({ title: SCHOOL.title, body: '我自己记的' })
  assert.equal((await memo.add({ id: SCHOOL.id })).title, `${SCHOOL.title}（2）`)
  assert.equal(store.memos.note(SCHOOL.title).body, '我自己记的\n')
})

test('AI 总结后添加：学校通知读正文、问模型，照固定的几项写进正文，截止时间另记成属性', async (t) => {
  const { memo, store, asks, runs } = fixture(t)
  assert.deepEqual(await memo.add({ id: SCHOOL.id, summarize: true }), { title: SCHOOL.title, existed: false, summarized: true, reason: '' })
  assert.deepEqual(runs.map(run => run.args), [['notice', 'view', '--url', SCHOOL.url]])
  assert.match(asks[0].system, /只根据给你的内容写/)
  assert.equal(asks[0].text, `标题：${SCHOOL.title}\n来源：教务网\n正文：\n${BODY}`)
  const note = store.memos.note(SCHOOL.title)
  assert.deepEqual(note.properties, [{ key: '来源', value: '教务网' }, { key: '日期', value: '2026-10-08' }, { key: '截止', value: '10月16日17:00前' }])
  assert.equal(note.body, [
    '第三轮选课的时间安排。', '', '**要做的事**：在教务网完成选课。', '',
    '- 截止：10月16日17:00前', '- 时间地点：10月14日9:00开始', '- 对象：大一新生不参加。', '- 其他：本科生院 88206222', '',
    'AI 根据原文总结，以原文为准。[查看原文](https://bksy.example/1)', '',
  ].join('\n'))
})

test('模型写的截止时间在正文里对不上就不要：不进属性，也不进正文', async (t) => {
  const { memo, store } = fixture(t, { answer: JSON.stringify({ ...ANSWER, 截止: '10月18日前' }) })
  await memo.add({ id: SCHOOL.id, summarize: true })
  const note = store.memos.note(SCHOOL.title)
  assert.deepEqual(note.properties.map(item => item.key), ['来源', '日期'])
  assert.doesNotMatch(note.body, /10月18日/)
  assert.match(note.body, /第三轮选课的时间安排/)
})

test('总结不成的时候照原样加上，并说明为什么：正文读不到、内容在附件里、命令出错、模型问不成、回答的格式不对', async (t) => {
  const cases = [
    [{ view: { contentStatus: 'unavailable', text: '', attachments: [] } }, '这条通知的正文读不到'],
    [{ view: { contentStatus: 'attachment-only', text: '', attachments: [{ url: 'https://bksy.example/a.pdf', text: '通知.pdf' }] } }, '这条通知的内容在附件里'],
    [{ view: { contentStatus: 'full', text: '见附件。', attachments: [] } }, '这条通知的正文读不到'],
    [{ view: new Error('校园通知一直没有回应，稍后再试。') }, '校园通知一直没有回应，稍后再试'],
    [{ answer: new Error('模型现在用不了。') }, '模型现在用不了'],
    [{ answer: '我不知道怎么总结。' }, '模型给的不是要的格式'],
  ]
  for (const [options, reason] of cases) {
    const { memo, store } = fixture(t, options)
    assert.deepEqual(await memo.add({ id: SCHOOL.id, summarize: true }), { title: SCHOOL.title, existed: false, summarized: false, reason }, reason)
    assert.equal(store.memos.note(SCHOOL.title).body, '[查看原文](https://bksy.example/1)\n', reason)
  }
})

test('正文带附件时把附件的名字也交给模型；太长的正文只给前面一段', async (t) => {
  const { memo, asks } = fixture(t, { view: { contentStatus: 'full', text: `${BODY}${'很长的附表。'.repeat(3000)}`, attachments: [{ url: 'https://bksy.example/a.xlsx', text: '选课安排表.xlsx' }] } })
  await memo.add({ id: SCHOOL.id, summarize: true })
  assert.ok(asks[0].text.length < 12_200)
  const short = fixture(t, { view: { contentStatus: 'full', text: BODY, attachments: [{ url: 'https://bksy.example/a.xlsx', text: '选课安排表.xlsx' }] } })
  await short.memo.add({ id: SCHOOL.id, summarize: true })
  assert.match(short.asks[0].text, /附件：选课安排表\.xlsx$/)
})

test('公众号文章读全文再总结，图片不交给模型；读不了时照原样加', async (t) => {
  const read = []
  const { memo, store, asks } = fixture(t, { article: async (url) => { read.push(url); return { markdown: `![](https://mmbiz.example/1.png)\n\n${BODY}\n\n![图](https://mmbiz.example/2.png)` } } })
  assert.equal((await memo.add({ id: ARTICLE.id, summarize: true })).summarized, true)
  assert.deepEqual(read, [ARTICLE.url])
  assert.doesNotMatch(asks[0].text, /mmbiz/)
  assert.match(store.memos.note('全明星校园行｜报名开始').body, /AI 根据原文总结/)
  const failed = fixture(t, { article: async () => { throw new Error('微信读书要先验证一次。') } })
  assert.deepEqual(await failed.memo.add({ id: ARTICLE.id, summarize: true }), { title: '全明星校园行｜报名开始', existed: false, summarized: false, reason: '微信读书要先验证一次' })
})

test('二课活动：记点、时间地点、报名办法照平台给的列出来，简介交给模型；截止时间不用模型的', async (t) => {
  const row = { name: ACTIVITY.title, category: '第二课堂·志愿公益', points: '0.2–0.5', startTime: '2026-10-25 09:00', endTime: '2026-10-25 17:00', place: '基础图书馆', signupOpens: '2026-10-09 08:00', signupCloses: '2026-10-20 12:00', signupMethod: '平台报名', quota: 30, signedCount: 12, intro: '协助图书上架和读者引导，全天分两个班次，每个班次三小时，报名时选择班次。', notes: '请穿着舒适的鞋，迟到十五分钟以上不记点。', contact: '王老师 \t88200000' }
  const other = { ...row, name: `${ACTIVITY.title}补录`, place: '别处' }
  const { memo, store, asks, runs } = fixture(t, { activities: [other, row], answer: JSON.stringify({ ...ANSWER, 截止: '10月30日前', 时间地点: '不该出现' }) })
  assert.equal((await memo.add({ id: ACTIVITY.id, summarize: true })).summarized, true)
  assert.deepEqual(runs[0].args, ['sztz', 'activity', 'list', '--keyword', ACTIVITY.title, '--limit', '50'])
  assert.match(asks[0].text, /已知：\n记点：第二课堂·志愿公益 0\.2–0\.5\n活动时间：2026-10-25 09:00 至 2026-10-25 17:00\n地点：基础图书馆/)
  const note = store.memos.note(ACTIVITY.title)
  assert.deepEqual(note.properties, [{ key: '来源', value: '图书馆' }, { key: '报名截止', value: '2026-10-20 12:00' }])
  assert.match(note.body, /- 记点：第二课堂·志愿公益 0\.2–0\.5\n- 活动时间：2026-10-25 09:00 至 2026-10-25 17:00\n- 地点：基础图书馆\n- 报名：平台报名，2026-10-09 08:00 至 2026-10-20 12:00\n- 名额：30 人，已报 12 人\n- 联系人：王老师 88200000\n- 对象：/)
  assert.doesNotMatch(note.body, /10月30日|不该出现/)
  // 平台上没写简介的，只列平台给的那几项，不问模型。
  const bare = fixture(t, { activities: [{ ...row, intro: undefined, notes: undefined }] })
  assert.equal((await bare.memo.add({ id: ACTIVITY.id, summarize: true })).summarized, true)
  assert.equal(bare.asks.length, 0)
  assert.match(bare.store.memos.note(ACTIVITY.title).body, /^- 记点：.*\n[\s\S]*\n\n以平台上写的为准。\[查看原文\]/)
  // 平台上找不到这个活动（下架了）就照原样加。
  const gone = fixture(t, { activities: [other] })
  assert.deepEqual(await gone.memo.add({ id: ACTIVITY.id, summarize: true }), { title: ACTIVITY.title, existed: false, summarized: false, reason: '平台上没有找到这个活动' })
})

test('同一条连点两下只加一次', async (t) => {
  const { memo, store, asks } = fixture(t)
  const [first, second] = await Promise.all([memo.add({ id: SCHOOL.id, summarize: true }), memo.add({ id: SCHOOL.id, summarize: true })])
  assert.deepEqual(first, second)
  assert.equal(asks.length, 1)
  assert.equal(store.memos.list().notes.length, 1)
})

test('聊天原文没有 URL 也可独立加入备忘录，去重依据稳定编号', async t => {
 const make = id => ({ id, kind:'chat', title:'同一标题', from:'年级群 · 辅导员', at:'2026-10-16T02:00:00Z', url:'', body:'原文\n  缩进', originals:[{id:'m'+id,text:'原文\n  缩进',sender:{name:'辅导员'},sentAt:'2026-10-16T02:00:00Z'}] })
 const { memo, store, asks, runs } = fixture(t, { items:[make('chat:one'),make('chat:two')] })
 const first=await memo.add({id:'chat:one'}); assert.equal(first.existed,false); assert.equal((await memo.add({id:'chat:one'})).existed,true)
 assert.equal((await memo.add({id:'chat:two'})).existed,false); assert.equal(store.memos.list().notes.length,2);assert.equal(asks.length,0);assert.equal(runs.length,0)
 assert.ok(store.memos.list().notes.every(n=>n.raw.includes('原文\n  缩进')))
})

test('邮件加到备忘录：直接添加不联网，不编链接，靠编号去重；AI 总结时只读地读正文', async t => {
  const MAIL = { id: 'mail:0123456789abcdef:INBOX:9:7', kind: 'mail', title: '项目申请材料的修改建议', from: '张老师', address: 'teacher@example.com', at: '2026-10-17T01:00:00.000Z', dated: true, url: '', foundAt: null, accountId: '0123456789abcdef0000', mailbox: 'INBOX', uid: 7, uidValidity: '9' }
  const answer = JSON.stringify({ 讲了什么: '老师请你补充项目进度。', 要做什么: '修改后回复邮件。', 截止: '10月22日前', 时间地点: '', 对象: '', 材料: '', 其他: '' })
  const reader = (reads) => ({ idle: async () => {}, read: async (ref) => { reads.push(ref); return { text: '申请材料已收到，请补充项目进度安排，并在10月22日前回复此邮件。', attachments: [{ filename: '模板.docx' }] } } })
  const plainReads = [], plain = fixture(t, { items: [MAIL], answer })
  plain.memo.mail = reader(plainReads)
  assert.equal((await plain.memo.add({ id: MAIL.id })).existed, false)
  assert.deepEqual([plainReads.length, plain.asks.length], [0, 0])
  const note = plain.store.memos.list().notes[0]
  assert.match(note.raw, /<!-- notice:mail:0123456789abcdef:INBOX:9:7 -->/)
  assert.doesNotMatch(note.raw, /\]\(/, '没有网页链接的不编一个')
  assert.ok(note.properties.some(entry => entry.key === '来源' && entry.value === '邮箱 · 张老师'))
  assert.equal((await plain.memo.add({ id: MAIL.id, summarize: true })).existed, true)
  const reads = [], summary = fixture(t, { items: [MAIL], answer })
  summary.memo.mail = reader(reads)
  assert.equal((await summary.memo.add({ id: MAIL.id, summarize: true })).summarized, true)
  assert.deepEqual(reads, [{ mailbox: 'INBOX', uid: 7, uidValidity: '9' }])
  assert.match(summary.asks[0].text, /附件：模板\.docx/)
  assert.ok(summary.store.memos.list().notes[0].properties.some(entry => entry.key === '截止' && entry.value === '10月22日前'))
})

test('CC98 的回复和 @ 指向同一楼也各加各的；私信抄下原话，不编链接', async t => {
  const make = (kind, id, url) => ({ id: `cc98:alice:${kind}:${id}`, kind: 'cc98', cc98Kind: kind, title: `${kind} ${id}`, from: 'bob', at: '2026-10-18T01:00:00.000Z', dated: true, url, foundAt: null, body: '这门课作业每学期会调整' })
  const floor = 'https://www.cc98.org/topic/100#3'
  const { memo, store, runs } = fixture(t, { items: [make('reply', 1, floor), make('at', 2, floor), make('message', '42:2026-10-18T01:00:00.000Z', '')] })
  for (const id of ['cc98:alice:reply:1', 'cc98:alice:at:2', 'cc98:alice:message:42:2026-10-18T01:00:00.000Z']) assert.equal((await memo.add({ id })).existed, false)
  assert.equal((await memo.add({ id: 'cc98:alice:at:2' })).existed, true)
  const notes = store.memos.list().notes
  assert.equal(notes.length, 3)
  assert.ok(notes.every(note => note.raw.includes('这门课作业每学期会调整')))
  assert.ok(notes.find(note => note.raw.includes('message:42')).raw.match(/\]\(/) === null)
  assert.equal(runs.length, 0)
})

test('AI 整理出来的聊天事项加到备忘录：直接用整理好的几项、截止进属性和日程表，不再问模型', async t => {
  const original = { id: 'm1', text: '实验三报告周五下午五点前交到学在浙大', sender: { name: '李助教' }, sentAt: '2026-10-21T01:00:00.000Z' }
  const matter = { 事项: '实验三报告提交', 要做什么: '在学在浙大提交实验三报告', 截止: '2026-10-23T17:00:00+08:00', 截止原文: '周五下午五点前', 时间地点: '', 发送者: '李助教' }
  const item = { id: 'chat:wechat:k:summary:abc', kind: 'chat', mode: 'summary', title: '实验三报告提交 · 10月23日 17:00 截止', from: '课程群 · 李助教', at: original.sentAt, url: '', body: '在学在浙大提交实验三报告\n截止：10月23日 17:00（周五下午五点前）', originals: [original], matter, deadline: matter.截止 }
  const dateOnly = { ...item, id: 'chat:wechat:k:summary:def', matter: { ...matter, 事项: '实验四报告提交', 截止: '2026-10-30' }, deadline: '2026-10-30' }
  const { memo, store, asks, runs } = fixture(t, { items: [item, dateOnly] })
  for (const summarize of [true, false]) assert.equal((await memo.add({ id: summarize ? item.id : dateOnly.id, summarize })).summarized, true)
  assert.deepEqual([asks.length, runs.length], [0, 0])
  const notes = store.memos.list().notes, note = notes.find(entry => entry.title === '实验三报告提交')
  assert.ok(note, '标题是事项，不带截止')
  assert.deepEqual(note.properties, [{ key: '来源', value: '课程群 · 李助教' }, { key: '日期', value: '2026-10-21' }, { key: '截止', value: '2026-10-23 17:00' }])
  assert.match(note.raw, /\*\*要做的事\*\*：在学在浙大提交实验三报告/)
  assert.match(note.raw, /- 截止：2026-10-23 17:00（原话「周五下午五点前」）/)
  assert.match(note.raw, /实验三报告周五下午五点前交到学在浙大/)
  assert.match(note.raw, /<!-- notice:chat:wechat:k:summary:abc -->/)
  assert.ok(notes.find(entry => entry.title === '实验四报告提交').properties.some(entry => entry.key === '截止' && entry.value === '2026-10-30'))
  // 「截止」属性日程表认得：排进那天的截止。
  assert.deepEqual(memoEvents(notes).map(event => [event.kind, event.date, event.time ?? '', event.title]).sort(), [['due', '2026-10-23', '17:00', '实验三报告提交'], ['due', '2026-10-30', '', '实验四报告提交']])
})
