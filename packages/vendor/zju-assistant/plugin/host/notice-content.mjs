import { runCore } from './core.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''
const beijing = iso => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 16)
/** 学校通知读到的正文是什么情况时，详情里怎么说明。 */
const PARTIAL = {
  'summary-only': '网站只给了摘要，完整内容请打开原文。',
  'attachment-only': '这条通知的内容在附件里，下面列出了附件。',
  unavailable: '这个网站的正文在应用里读不到，请打开原文。',
}
const named = list => (list ?? []).map(entry => `${entry.name ? `${entry.name} ` : ''}<${entry.address}>`).join('、')

/**
 * 通知点开以后在右栏原位显示的内容，不写备忘、不调用模型。只接受当前列表中的编号。
 * 每一种照它已有的阅读办法：学校通知用 `notice view`，公众号读全文，二课在平台上找这一条，邮件只读地读正文（不改服务器上的已读），
 * 聊天和 CC98 消息用列表里已经有的原文。返回 { title, from, markdown（Markdown）或 text（照原样换行的文字）, facts, originalUrl,
 * attachments（{ name, url?, index? }）, note（读到的不全时说明实际范围）, messages（聊天原文）, summary（AI 整理的那一段） }。
 */
export class NoticeContent {
  /** mail 是浙大邮箱插件；reveal(file) 在文件管理器里打开下载好的附件所在的文件夹。 */
  constructor({ feed, article, mail, reveal = () => {}, run = runCore }) { Object.assign(this, { feed, article, mail, reveal, run }) }

  async item(id) {
    const item = (await this.feed.snapshot()).items.find(entry => entry.id === id)
    if (!item) throw new Error('这条通知已经不在列表里了，刷新后再试。')
    return item
  }

  async read(input) {
    const item = await this.item(input?.id)
    if (item.kind === 'wechat') {
      const article = await this.article(item.url)
      if (!text(article?.markdown)) throw new Error('这篇文章的正文没有读到，请稍后重试。')
      // 原文链接只采用正文实际提供的地址，不能从微信读书的编号推算。
      const url = URL.parse(article.url ?? '')
      const originalUrl = url?.protocol === 'https:' && url.hostname === 'mp.weixin.qq.com'
        && (url.pathname === '/s' || url.pathname.startsWith('/s/')) ? url.href : null
      return { title: article.title || item.title, from: article.author || item.from, markdown: article.markdown, facts: [], originalUrl }
    }
    if (item.kind === 'school') return this.school(item)
    if (item.kind === 'mail') return this.letter(item)
    if (item.kind === 'chat') {
      // AI 整理出来的事项：截止、时间地点、发送者列成几项，要做什么放在整理的那一段。
      const matter = item.mode === 'summary' && item.matter && typeof item.matter === 'object' ? item.matter : null
      const deadline = text(item.deadline), said = text(matter?.截止原文)
      const due = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : Number.isFinite(Date.parse(deadline)) ? beijing(deadline) : ''
      const facts = matter ? [['截止', due ? `${due}${said ? `（${said}）` : ''}` : said], ['时间地点', text(matter.时间地点)], ['发送者', text(matter.发送者)]].filter(([, value]) => value) : []
      return { title: item.title, from: item.from, facts, originalUrl: null, messages: item.originals ?? [], text: item.originals?.length ? '' : text(item.body),
        ...(item.mode === 'summary' ? { summary: matter ? text(matter.要做什么) || text(matter.事项) : text(item.body) } : {}), ...(item.summaryError ? { note: item.summaryError } : {}) }
    }
    if (item.kind === 'cc98') {
      const note = item.cc98Kind === 'message' ? '私信这里只有这个会话最新的一条；完整的对话请到 CC98 打开（打开后 CC98 会把它标为已读）。' : text(item.note)
      return { title: item.title, from: `CC98 · ${item.from}`, text: text(item.body), facts: [], originalUrl: item.url || null, ...(note ? { note } : {}) }
    }
    if (item.kind !== 'sztz') throw new Error('这类通知请打开原文查看。')
    return this.activity(item)
  }

  /** 学校通知：用 `notice view` 读正文和附件；读不全时照实说，原文链接总是给。 */
  async school(item) {
    const data = await this.run(['notice', 'view', '--url', item.url], { system: '校园通知', timeoutMs: 60_000 })
    const record = data?.notices?.[0], body = text(record?.text), status = text(record?.contentStatus)
    const attachments = (Array.isArray(record?.attachments) ? record.attachments : []).flatMap((file) => {
      const name = text(file?.text ?? file?.name ?? file?.title), url = URL.parse(text(file?.url))
      return name ? [{ name, ...(url && /^https?:$/.test(url.protocol) ? { url: url.href } : {}) }] : []
    })
    const note = !body || status !== 'full' ? PARTIAL[status] ?? PARTIAL.unavailable : ''
    return { title: text(record?.title) || item.title, from: item.from, text: body, facts: [], originalUrl: item.url, attachments, ...(note ? { note } : {}) }
  }

  /** 邮件：照列表里的账号、目录、UIDVALIDITY 和 UID 只读地读；对不上的时候 mail.read 自己会拒绝，不会打开别的信。 */
  async letter(item) {
    if (!this.mail) throw new Error('邮箱现在读不了。')
    if (this.mail.account()?.id !== item.accountId) throw new Error('邮箱账号已经换了，这封邮件读不了。')
    await this.mail.idle()
    const letter = await this.mail.read({ mailbox: item.mailbox, uid: item.uid, uidValidity: item.uidValidity })
    const facts = [['发件人', named(letter.from)], ['收件人', named(letter.to)], ['抄送', named(letter.cc)], ['时间', letter.date ? beijing(letter.date) : '']].filter(([, value]) => value)
    return {
      title: letter.subject || item.title, from: `邮箱 · ${item.from}`, text: letter.text, facts, originalUrl: null,
      attachments: (letter.attachments ?? []).map(file => ({ name: file.filename, index: file.index })),
      ...(letter.truncated ? { note: '这封邮件太长，只显示了前面一部分，完整的请在浙大邮箱网页版看。' } : {}),
    }
  }

  /** 下载邮件的一个附件，存好以后打开它所在的文件夹。 */
  async download(input) {
    const item = await this.item(input?.id)
    if (item.kind !== 'mail' || !this.mail) throw new Error('这条通知没有可以下载的附件。')
    if (this.mail.account()?.id !== item.accountId) throw new Error('邮箱账号已经换了，这封邮件读不了。')
    await this.mail.idle()
    const saved = await this.mail.download({ mailbox: item.mailbox, uid: item.uid, uidValidity: item.uidValidity, index: input.index })
    this.reveal(saved.file)
    return { filename: saved.filename }
  }

  async activity(item) {
    const data = await this.run(['sztz', 'activity', 'list', '--keyword', item.title, '--include-ended', '--limit', '100'], { system: '素质拓展平台', timeoutMs: 90_000 })
    const same = (data?.activities ?? []).filter(entry => text(entry.name) === item.title)
    const precise = same.filter(entry => text(entry.signupCloses) === beijing(item.closes) && (!text(entry.organizer) || text(entry.organizer) === item.from))
    const matches = precise.length ? precise : same
    if (!matches.length) throw new Error('平台上没有找到这个活动，请刷新通知后再试。')
    if (matches.length !== 1) throw new Error('平台上有多个同名活动，暂时无法确认这一条的详情。')
    const found = matches[0]
    const facts = [
      ['状态', found.status], ['类别', found.category], ['类型', found.type], ['记点', found.points],
      ['活动时间', [found.startTime, found.endTime].filter(Boolean).join(' 至 ')], ['地点', found.place],
      ['报名时间', [found.signupOpens, found.signupCloses].filter(Boolean).join(' 至 ')], ['报名方式', found.signupMethod],
      ['名额', found.quota], ['已报名人数', found.signedCount], ['联系人', found.contact],
      ['我的报名', found.signedUp ? '已报名' : ''], ['我的收藏', found.favorite ? '已收藏' : ''],
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '').map(([name, value]) => [name, String(value)])
    // 保留短简介、注意事项和外部报名链接，阅读内容不经过模型概括。
    const markdown = [['报名说明', found.signupHow], ['活动简介', found.intro], ['注意事项', found.notes]]
      .filter(([, body]) => text(body)).map(([title, body]) => `### ${title}\n\n${body}`).join('\n\n')
    if (!markdown && !facts.length) throw new Error('这个活动在平台上还没有详情。')
    return { title: found.name, from: found.organizer || item.from, markdown, facts, originalUrl: null }
  }
}
