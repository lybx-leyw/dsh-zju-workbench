import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { missing } from './helpers/environment.mjs'

// `lib/article.ts` 在模块加载阶段就 import `linkedom` / `turndown` /
// `turndown-plugin-gfm`；本仓按约定不跑 `npm install`，缺一个就会在 import 这里
// 抛 ERR_MODULE_NOT_FOUND，把「环境没装」伪装成「测试失败」。见 helpers/environment.mjs。
const skip = missing(['linkedom', 'turndown', 'turndown-plugin-gfm'])

const { articleLink, parseDocument, exportMarkdown } = skip
  ? ({} as typeof import('../lib/article.ts'))
  : await import('../lib/article.ts')

const long = 'https://mp.weixin.qq.com/s?__biz=MTIzNDU2Nzg5MA==&mid=123&idx=1&sn=abcdef'

test('links: originals lose share parameters, WeRead links keep their site, anything else is rejected', { skip }, () => {
  assert.equal(articleLink(long.replace('&mid', '&amp;mid') + '&pass_ticket=secret&scene=1').url, long.replace('==', '%3D%3D'))
  assert.deepEqual(articleLink('http://mp.weixin.qq.com/s/abc_defghi#rd'), { url: 'https://mp.weixin.qq.com/s/abc_defghi' })
  assert.equal(articleLink('https://weread.qq.com/web/mp/content?reviewId=MP_WXS_1234567890_abc~def').url, 'https://weread.qq.com/web/mp/content?reviewId=MP_WXS_1234567890_abc~def')
  for (const url of ['not a url', 'https://example.com/s/abc', 'https://weread.qq.com/web/reader/abc']) assert.throws(() => articleLink(url), (e: any) => e.code === 'invalid_link')
})

test('HTML becomes Markdown: structure kept, lazy images resolved, scripts dropped, canonical link preferred', { skip }, () => {
  const doc = parseDocument(`<html><head><meta property="og:url" content="${long}&scene=1"></head><body><h1 id="activity-name">文章</h1><span id="js_name">公众号</span>
    <div id="js_content"><h2>小节</h2><ul><li>项目</li></ul><table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table>
    <img data-src="https://images.example/a.png"><a href="javascript:void(0)">文字</a><script>secret()</script></div></body></html>`, 'https://mp.weixin.qq.com/s/abcdefgh', { publishedAt: '2026-10-09T08:00:00+08:00' })
  assert.match(doc.markdown, /## 小节/); assert.match(doc.markdown, /-\s+项目/); assert.match(doc.markdown, /\| 列 \|/)
  assert.match(doc.markdown, /!\[\]\(https:\/\/images\.example\/a\.png\)/); assert.doesNotMatch(doc.markdown, /secret|javascript/)
  assert.deepEqual([doc.title, doc.author, doc.publishedAt, doc.url], ['文章', '公众号', '2026-10-09T08:00:00+08:00', articleLink(long).url])
  assert.deepEqual(doc.images, ['https://images.example/a.png'])
})

test('pages without an article body say why', { skip }, () => {
  const page = (text: string) => `<html><body>${text}<script>var other = "该内容已被发布者删除"</script></body></html>`
  for (const [text, code] of [['环境异常', 'mp_verification_required'], ['该内容已被发布者删除', 'article_deleted'], ['访问过于频繁', 'article_rate_limited'], ['别的', 'content_unavailable']]) {
    assert.throws(() => parseDocument(page(text), long), (e: any) => e.code === code)
  }
  assert.match(parseDocument('<div id="js_content">正文里提到环境异常</div>', long).markdown, /环境异常/)
})

test('export writes Markdown with local image paths; images that fail keep their remote link', { skip }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weread-export-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('a.png')
    ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    : new Response('denied', { status: 403 }))
  const doc = parseDocument('<div id="js_content"><img src="https://images.example/a.png"><img src="https://images.example/b.jpg"></div>', long, { title: '标题: 一/二' })
  const result = await exportMarkdown(doc, directory)
  assert.deepEqual(result.images, { total: 2, saved: 1, failed: ['https://images.example/b.jpg'] })
  assert.equal(path.basename(result.file), '标题_ 一_二.md')
  const markdown = await fs.readFile(result.file, 'utf8')
  assert.match(markdown, /^# 标题: 一\/二\n/); assert.match(markdown, /\(images\/001\.png\)/); assert.match(markdown, /\(https:\/\/images\.example\/b\.jpg\)/)
  assert.deepEqual(await fs.readdir(path.join(path.dirname(result.file), 'images')), ['001.png'])
})
