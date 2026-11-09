import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { dataDir, SkillError } from './config.ts'
import { bookIdOf, webAccounts, webArticles } from './web.ts'
import { articleLink, fetchArticle, parseDocument, type Document } from './article.ts'

/** 公众号和文章链接都从微信读书找，正文统一由 article.ts 获取。返回的 url 都可以直接交给 read/download。 */
export interface Article { id: string; title: string; url: string; publishedAt: string | null; originalUrl?: string; summary?: string }
export interface Account { biz: string; name: string; articles: Article[] }
export interface Options { account?: string; title?: string; url?: string; limit?: number; cancel?: boolean; query?: string; check?: boolean }

/** 按名称取唯一的一项：完全相同优先，否则按包含匹配。 */
function pick<T>(kind: 'account' | 'article', items: T[], text: string, name: (item: T) => string): T {
  const exact = items.filter(item => name(item) === text)
  const found = exact.length ? exact : items.filter(item => name(item).includes(text))
  if (found.length === 1) return found[0]
  const label = kind === 'account' ? '公众号' : '文章'
  throw found.length
    ? new SkillError(kind + '_ambiguous', `有 ${found.length} 个${label}匹配「${text}」，请写完整名称。`, { candidates: found.slice(0, 20).map(name) })
    : new SkillError(kind + '_not_found', `没有找到${label}「${text}」。`)
}

/** 某公众号最近的文章。给了 biz（已跟踪的公众号）就不再按名称查找。 */
async function accountOf(target: { name: string; biz?: string }, limit: number, stop?: (article: Article) => boolean): Promise<Account> {
  const account = target.biz ? { biz: target.biz, name: target.name } : pick('account', await webAccounts(target.name), target.name, account => account.name)
  return { ...account, articles: await webArticles(bookIdOf(account.biz), limit, stop) }
}

export async function list(options: Options) {
  const { articles, ...account } = await accountOf({ name: options.account! }, options.limit ?? 20)
  return { ok: true, account, articles }
}

/** 只说明这一个公众号读不到的错误；别的错误说明微信读书这次整个用不了。 */
const ACCOUNT_ONLY = ['account_not_found', 'remote_rejected', 'invalid_response']
type Failure = { status: string; message: string }

/**
 * 跟踪名单里每个号最近的文章，只看不记：new 的已读记录不动，所以宿主应用可以拿它定时刷新自己的列表。
 * 一个号读不到不影响别的号。微信读书整个用不了（没登录、要验证、被限频）时记在 state 里，剩下的号这次不再逐个去问。
 * state 为 null 表示名单是空的，这次没有问微信读书。
 */
export async function listTracked(options: Options) {
  const limit = options.limit ?? 20
  let state: ({ ok: true } | { ok: false } & Failure) | null = null
  const accounts: ({ biz: string; name: string } & ({ articles: Article[] } | { error: Failure }))[] = []
  for (const [biz, { name }] of Object.entries(loadTracked())) {
    if (state?.ok === false) { accounts.push({ biz, name, error: { status: state.status, message: state.message } }); continue }
    try {
      if (state) await pause(1500)   // 号与号之间留间隔，避免触发限频
      accounts.push({ biz, name, articles: (await accountOf({ biz, name }, limit)).articles })
      state = { ok: true }
    } catch (reason: any) {
      if (!(reason instanceof SkillError)) throw reason
      const error = { status: reason.code, message: reason.message }
      accounts.push({ biz, name, error })
      state = ACCOUNT_ONLY.includes(reason.code) ? state ?? { ok: true } : { ok: false, ...error }
    }
  }
  return { ok: true, state, accounts }
}

/** 按名称找公众号的候选，不改动任何记录；不给名称时列出书架上的全部公众号。 */
export async function accounts(options: Options) {
  const query = options.query?.trim() ?? ''
  const found = await webAccounts(query)
  if (!found.length) throw new SkillError('account_not_found', query ? `没有找到名称里带「${query}」的公众号。` : '微信读书的书架上还没有公众号。')
  return { ok: true, accounts: found.slice(0, 100) }
}

async function readLink(url: string, known?: Article): Promise<Document> {
  const link = articleLink(url)
  return parseDocument(await fetchArticle(link.url), known?.originalUrl ?? link.url, known)
}

/** 取一篇文章并转成 Markdown：给链接就直接取；给公众号和标题就先在微信读书里找到这篇文章。 */
export async function read(options: Options): Promise<Document> {
  const { url, account, title } = options
  if (url ? account || title : !account || !title) throw new SkillError('invalid_input', '请提供 --url，或者同时提供 --account 和 --title（二选一）。')
  if (url) return readLink(url)
  const { articles } = await accountOf({ name: account! }, 100, article => article.title.includes(title!))
  const article = pick('article', articles, title!, article => article.title)
  return readLink(article.url, article)
}

/**
 * 跟踪名单：每个公众号见过的文章。原来还有本机微信这个来源，两边的文章标识不一样，所以按来源分开记；
 * 现在只有 web 一个，存的样子不变，原来记下的 web 那一份接着用，local 那一份不再看。
 */
type Tracked = Record<string, { name: string; seen: { web?: string[] } }>
const trackedFile = () => path.join(dataDir, 'tracked.json')
const loadTracked = (): Tracked => fs.existsSync(trackedFile()) ? JSON.parse(fs.readFileSync(trackedFile(), 'utf8')) : {}
function saveTracked(tracked: Tracked) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(trackedFile(), JSON.stringify(tracked, null, 2))
}

/** 带公众号时开始跟踪（现有文章记为已读），再带 cancel 则停止跟踪；返回当前的跟踪名单。 */
export async function track(options: Options) {
  const tracked = loadTracked()
  let message: string | undefined
  if (options.account && options.cancel) {
    const [biz, { name }] = pick('account', Object.entries(tracked), options.account, ([, entry]) => entry.name)
    delete tracked[biz]
    message = `已停止跟踪「${name}」。`
  } else if (options.account) {
    const { biz, name, articles } = await accountOf({ name: options.account }, 50)
    tracked[biz] = { name, seen: { web: articles.map(article => article.id) } }
    message = `开始跟踪「${name}」，现有的 ${articles.length} 篇记为已读；之后用 new 查看新文章。`
  }
  if (message) saveTracked(tracked)
  return { ok: true, message, tracked: Object.entries(tracked).map(([biz, entry]) => ({ biz, name: entry.name })) }
}

/** 跟踪的公众号里上次检查之后新出现的文章。全部检查成功才记为已读，中途失败下次会重新返回。 */
export async function newArticles(options: Options) {
  const tracked = loadTracked()
  const targets = options.account ? [pick('account', Object.entries(tracked), options.account, ([, entry]) => entry.name)] : Object.entries(tracked)
  if (!targets.length) throw new SkillError('nothing_tracked', '还没有跟踪任何公众号，先执行 track --account 名称。')
  const articles: (Article & { account: string })[] = []
  for (const [biz, entry] of targets) {
    const latest = (await accountOf({ biz, name: entry.name }, 50)).articles
    // 还没有基线（比如原来只在本机微信读过这个号）时只记录不报新。
    const seen = entry.seen.web
    if (seen) articles.push(...latest.filter(article => !seen.includes(article.id)).map(article => ({ account: entry.name, ...article })))
    entry.seen = { web: [...new Set([...latest.map(article => article.id), ...seen ?? []])] }
  }
  saveTracked(tracked)
  return { ok: true, articles }
}
