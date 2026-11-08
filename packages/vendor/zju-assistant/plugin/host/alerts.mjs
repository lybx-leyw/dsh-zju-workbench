/**
 * 页面上的提醒：公众号有新文章，监控的聊天、邮箱和 CC98 有新消息，二课有新活动，助手用 campus_notify 提醒的事。
 * 桌面版原来交给壳，让托盘图标闪；插件里没有壳，改成页面来取：侧栏「校园事务」的图标上出一个角标，
 * 用户允许过的话再弹一条浏览器通知（client/alerts.ts）。这里只在内存里留最近的几十条，dsh 重开就清空。
 * 点了去哪：sessionId 是一个对话，panel 是侧栏上的一页（后面可以跟冒号和页签，affairs:personal 是校园事务的「个人消息」）。
 */

/** 标题和内容各最多几个字。 */
const LIMIT = { title: 30, text: 80 }
/** 最多留多少条。 */
const KEEP = 50

const clip = (value, limit) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export class Alerts {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now
    this.items = []
    this.sequence = 0
  }

  /** 发一条，返回发出去的样子。 */
  push({ title, text, sessionId, panel } = {}) {
    if (!clip(title, LIMIT.title)) throw new Error('提醒要有标题：谁的消息，几个字')
    const alert = { id: ++this.sequence, at: new Date(this.now()).toISOString(), title: clip(title, LIMIT.title), text: clip(text, LIMIT.text), ...(sessionId ? { sessionId: String(sessionId) } : panel ? { panel: String(panel) } : {}) }
    this.items = [...this.items, alert].slice(-KEEP)
    return alert
  }

  /** after 之后的那几条（after 是页面上一次拿到的最后一条的 id），和现在最新的 id。 */
  since({ after = 0 } = {}) {
    const from = Number(after) || 0
    return { alerts: this.items.filter(item => item.id > from), latest: this.sequence }
  }
}

/** 点了去「校园事务」；冒号后面是右栏的页签。 */
const AFFAIRS = 'affairs'
const PERSONAL = `${AFFAIRS}:personal`

/** 公众号这一次检查新出现的文章，说成一条提醒：一篇时是「号名：标题」，多篇时带上一共几篇。 */
export function articlesAlert(articles) {
  if (!articles?.length) return undefined
  const [first] = articles
  return { title: '公众号有新文章', text: `${first.from}：${first.title}${articles.length > 1 ? ` 等 ${articles.length} 篇` : ''}`, panel: AFFAIRS }
}

/** 邮箱这一趟新到的信（从新到旧），说成一条提醒：一封时是「发件人：主题」，多封时带上一共几封。 */
export function mailAlert(items) {
  if (!items?.length) return undefined
  const [first] = items
  return { title: '邮箱有新邮件', text: `${first.from}：${first.title}${items.length > 1 ? ` 等 ${items.length} 封` : ''}`, panel: PERSONAL }
}

/** CC98 这一趟本人新收到的（从新到旧）：一条时就是那一行的标题，多条时带上一共几条。私信的内容不露出来。 */
export function cc98Alert(items) {
  if (!items?.length) return undefined
  return { title: 'CC98 有新消息', text: `${items[0].title}${items.length > 1 ? ` 等 ${items.length} 条` : ''}`, panel: PERSONAL }
}

/** 二课这一趟新出的活动。 */
export function activitiesAlert(items) {
  if (!items?.length) return undefined
  return { title: '二课有新活动', text: `${items[0].title}${items.length > 1 ? ` 等 ${items.length} 个` : ''}`, panel: AFFAIRS }
}
