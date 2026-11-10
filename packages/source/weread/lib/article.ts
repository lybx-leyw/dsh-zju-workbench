import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'
// @ts-ignore package has no declaration file
import { gfm } from 'turndown-plugin-gfm'
import { SkillError, visionConfig } from './config.ts'
import { getBrowser } from './browser/runtime.ts'

export interface Document { title: string; author: string | null; publishedAt: string | null; url: string; markdown: string; images: string[] }

/** 保留各站的文章链接，统一交给浏览器加载。 */
export function articleLink(raw: string): { url: string } {
  let url: URL
  try { url = new URL(raw.trim().replaceAll('&amp;', '&')) }
  catch { throw new SkillError('invalid_link', '请提供微信公众号文章链接或微信读书文章链接。') }
  if (url.hostname === 'mp.weixin.qq.com' && (url.pathname === '/s' || url.pathname.startsWith('/s/'))) {
    // 只保留定位文章的参数，分享时附带的票据和来源标记不发出去。
    const query = new URLSearchParams(['__biz', 'mid', 'idx', 'sn'].flatMap(key => url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : []))
    return { url: 'https://mp.weixin.qq.com' + url.pathname + (query.size ? '?' + query : '') }
  }
  const reviewId = url.hostname === 'weread.qq.com' ? url.searchParams.get('reviewId') : null
  if (reviewId && /^MP_WXS_\d+_[\w~-]+$/.test(reviewId)) return { url: 'https://weread.qq.com/web/mp/content?reviewId=' + encodeURIComponent(reviewId) }
  throw new SkillError('invalid_link', '只支持 mp.weixin.qq.com 的文章链接，或 list 返回的微信读书文章链接。')
}

export async function fetchArticle(url: string): Promise<string> {
  return (await getBrowser()).article(articleLink(url).url, visionConfig())
}

/** 公众号文章 HTML → Markdown；原文和微信读书返回的是同一种页面。 */
export function parseDocument(html: string, url: string, known: { title?: string; publishedAt?: string | null } = {}): Document {
  const { document } = parseHTML(html)
  const body = document.querySelector('#js_content')
  if (!body) {
    document.querySelectorAll('script,style,noscript').forEach(node => node.remove())
    const message = document.body?.textContent || document.documentElement?.textContent || ''
    if (/该内容已被(?:发布者)?删除/.test(message)) throw new SkillError('article_deleted', '文章已被删除。')
    if (/(?:操作|访问)(?:过于)?频繁/.test(message)) throw new SkillError('article_rate_limited', '微信提示访问频繁，请稍后再试。')
    if (message.includes('环境异常')) throw new SkillError('mp_verification_required', '微信原文的环境验证尚未完成，没有取到正文。')
    throw new SkillError('content_unavailable', '页面里没有文章正文，文章可能已失效。')
  }
  body.querySelectorAll('script,style,noscript,iframe').forEach(node => node.remove())
  const images: string[] = []
  for (const img of body.querySelectorAll('img')) {
    // 微信正文图片是懒加载的，真实地址在 data-src。
    const raw = img.getAttribute('data-src') || img.getAttribute('src')
    const src = raw && URL.parse(raw, url)
    if (!src || !src.protocol.startsWith('http')) { img.remove(); continue }
    img.setAttribute('src', src.href)
    if (!images.includes(src.href)) images.push(src.href)
  }
  for (const a of body.querySelectorAll('a[href]')) {
    const target = URL.parse(a.getAttribute('href')!, url)
    if (target?.protocol.startsWith('http')) a.setAttribute('href', target.href)
    else a.removeAttribute('href')
  }
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  converter.use(gfm)
  converter.addRule('wechat-paragraph', { filter: 'section', replacement: content => '\n\n' + content + '\n\n' })
  const markdown = converter.turndown(body.innerHTML).trim()
  if (!markdown) throw new SkillError('content_unavailable', '文章正文为空。')
  const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() || null
  const meta = (name: string) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || null
  const canonical = meta('og:url')
  return {
    title: text('#activity-name') || meta('og:title') || known.title || '公众号文章',
    author: text('#js_name') || meta('author'),
    publishedAt: known.publishedAt || meta('article:published_time') || text('#publish_time'),
    url: canonical?.startsWith('https://mp.weixin.qq.com/s') ? articleLink(canonical).url : url,
    markdown, images,
  }
}

const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' }

/** 保存为 <目录>/<标题>-<链接哈希>/<标题>.md，图片放进 images/ 并改成相对路径。 */
export async function exportMarkdown(article: Document, directory: string) {
  const title = article.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(0, 90) || 'article'
  const folder = path.resolve(directory, `${title}-${createHash('sha256').update(article.url).digest('hex').slice(0, 8)}`)
  await fs.mkdir(path.join(folder, 'images'), { recursive: true })
  let markdown = article.markdown, saved = 0
  const failed: string[] = []
  for (const [index, url] of article.images.entries()) {
    try {
      const response = await fetch(url, { headers: { referer: article.url, 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) })
      const extension = imageTypes[(response.headers.get('content-type') || '').split(';')[0]]
      if (!response.ok || !extension) throw new Error('not an image')
      const name = `images/${String(index + 1).padStart(3, '0')}.${extension}`
      await fs.writeFile(path.join(folder, name), Buffer.from(await response.arrayBuffer()))
      markdown = markdown.replaceAll(url, name)
      saved++
    } catch { failed.push(url) }   // 下载失败的图片在 Markdown 里保留远程链接
  }
  const file = path.join(folder, `${title}.md`)
  const header = [article.author, article.publishedAt, `[原文](${article.url})`].filter(Boolean).join(' · ')
  await fs.writeFile(file, `# ${article.title}\n\n${header}\n\n${markdown}\n`, 'utf8')
  return { ok: true, file, images: { total: article.images.length, saved, failed } }
}
