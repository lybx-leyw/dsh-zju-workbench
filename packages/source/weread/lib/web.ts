import { setTimeout as pause } from 'node:timers/promises'
import { SkillError, visionConfig } from './config.ts'
import { getBrowser } from './browser/runtime.ts'
import type { Article } from './sources.ts'

const ORIGIN = 'https://weread.qq.com'
const shelf = { userVid: '', synckey: 0, lectureSynckey: 0 }

/** 一次微信读书请求。登录过期时续期一次；遇到验证码就交给验证码模块，带着票据重发同一个请求。 */
async function request(path: string, query: Record<string, string | number> = {}): Promise<any> {
  const runtime = await getBrowser()
  const url = new URL(path, ORIGIN)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  const send = async (target: string, extra: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await runtime.request(target, { method: extra.body ? 'POST' : 'GET', body: extra.body ? JSON.stringify(extra.body) : undefined,
      headers: { accept: 'application/json, text/plain, */*', referer: ORIGIN + '/', ...(extra.body ? { 'content-type': 'application/json' } : {}), ...extra.headers } })
    let data: any = response.body
    try { data = JSON.parse(response.body) } catch {}
    return { status: response.status, data, code: data && typeof data === 'object' ? Number(data.errCode ?? data.errcode ?? 0) : 0 }
  }
  let headers: Record<string, string> | undefined, renewed = false
  for (;;) {
    const { status, data, code } = await send(url.href, { headers })
    if (code === -2041) {
      if (headers) throw new SkillError('verification_failed', '验证通过后微信读书仍然要求验证，请稍后重试。')
      const proof = await runtime.solve(visionConfig())
      headers = { 'x-wr-ticket': proof.ticket, 'x-wr-randstr': proof.randstr }
    } else if (code === -2010 || code === -2012 || status === 401) {
      const renewal = renewed ? null : await send(ORIGIN + '/web/login/renewal', { body: { rq: encodeURIComponent(path), ql: await runtime.cookie('wr_ql') === '1' } })
      if (renewal?.data?.succ !== 1) throw new SkillError('login_required', '微信读书没有登录或登录已失效，请先执行 login。')
      renewed = true
    } else if (status === 429 || code === -429) throw new SkillError('rate_limited', '微信读书暂时限制了访问，请过一段时间再试。')
    else if (code || status < 200 || status >= 300) throw new SkillError('remote_rejected', `微信读书拒绝了这次请求（${code || status}）。`)
    else return data
  }
}

/** 在自带浏览器窗口里扫码登录；已有的登录仍然有效时直接返回。 */
export async function login() {
  const { verified } = await (await getBrowser()).login()
  if (!verified) await request('/web/shelf/sync', shelf)   // 登录后的第一个请求被要求验证：走同一套验证码流程
  return { ok: true, message: '微信读书已登录，登录状态保存在 Skill 自带的浏览器里。' }
}

/** 只看自带浏览器里有没有登录记录，不联网也不开窗口；记录还有没有效，要到用的时候才知道。 */
export async function loginState() {
  return { ok: true, loggedIn: !!await (await getBrowser()).cookie('wr_vid') }
}

/** 退出微信读书：清掉自带浏览器里的登录状态。 */
export async function logout() {
  await (await getBrowser()).logout()
  return { ok: true, message: '已退出微信读书。' }
}

const bizOf = (bookId: string) => Buffer.from(bookId.slice(7)).toString('base64')
export const bookIdOf = (biz: string) => 'MP_WXS_' + Buffer.from(biz, 'base64').toString()

/** 书架和搜索结果的结构不同，统一按 bookId 形如 MP_WXS_<数字> 找出其中的公众号。 */
function publishers(payload: unknown, found = new Map<string, { biz: string; name: string }>()) {
  if (payload && typeof payload === 'object') {
    const { bookId, title, name = title } = payload as any
    if (typeof bookId === 'string' && /^MP_WXS_\d+$/.test(bookId) && typeof name === 'string' && name) found.set(bookId, { biz: bizOf(bookId), name })
    for (const child of Object.values(payload)) publishers(child, found)
  }
  return [...found.values()]
}

/** 名称对应的候选公众号：先看书架，书架里没有再搜索。不给名称时只列书架上的。 */
export async function webAccounts(name: string) {
  const mine = publishers((await request('/web/shelf/sync', shelf)).books).filter(account => account.name.includes(name))
  return mine.length || !name ? mine : publishers(await request('/api/store/search', { keyword: name }))
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** 接口里的标题和摘要带 HTML 实体。 */
const decodeEntities = (text: unknown) => String(text ?? '').replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos|nbsp));/gi, (all, hex, decimal, named) => {
  const code = hex ? parseInt(hex, 16) : Number(decimal)
  return named ? entities[named.toLowerCase()] : code <= 0x10ffff ? String.fromCodePoint(code) : all
})
// 微信读书的时间戳是秒；统一输出北京时间。
const beijing = (seconds: unknown) => Number(seconds) > 0 ? new Date(Number(seconds) * 1000 + 8 * 3600000).toISOString().replace('.000Z', '+08:00') : null

/** 某公众号最近的文章，由新到旧；取够 limit 篇或 stop 命中就不再翻页。 */
export async function webArticles(bookId: string, limit: number, stop?: (article: Article) => boolean): Promise<Article[]> {
  const found = new Map<string, Article>()
  for (let offset = 0; found.size < limit && !(stop && [...found.values()].some(stop));) {
    if (offset) await pause(1500)   // 翻页间隔，避免触发限频
    const { reviews } = await request('/web/mp/articles', { bookId, offset })
    if (!Array.isArray(reviews)) throw new SkillError('invalid_response', '微信读书没有返回文章列表。')
    const before = found.size
    for (const group of reviews) for (const sub of group.subReviews ?? []) {
      const review = sub.review ?? {}, mp = review.mpInfo ?? {}, id = review.reviewId ?? sub.reviewId
      if (typeof id !== 'string' || !id.startsWith(bookId + '_')) continue
      // reviewId / originalId 是微信读书自己的标识，不能拼成 mp.weixin.qq.com 短链。
      found.set(id, { id, title: decodeEntities(mp.title), url: `${ORIGIN}/web/mp/content?reviewId=${encodeURIComponent(id)}`,
        publishedAt: beijing(mp.time || review.createTime || group.createTime), summary: decodeEntities(mp.content || review.content) })
    }
    if (found.size === before) break   // 空页或重复页：已经到头
    offset += reviews.length
  }
  return [...found.values()].slice(0, limit)
}
