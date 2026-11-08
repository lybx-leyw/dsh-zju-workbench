import test from 'node:test'
import assert from 'node:assert/strict'
import { webAccounts, webArticles, login, loginState, logout } from '../lib/web.ts'
import { setBrowser, type BrowserRuntime } from '../lib/browser/runtime.ts'

const bookId = 'MP_WXS_1234567890'
const review = (n: number) => ({ review: { reviewId: `${bookId}_token~${n}`, mpInfo: { title: `文章 &amp; ${n}`, originalId: `token~${n}`, time: 1791590400 + n * 60 } } })
type Call = { path: string; query: Record<string, string>; headers: Record<string, string>; body?: any }

/** A fake browser that answers WeRead endpoints from `respond`; unmocked members fail the test. */
function fake(t: any, respond: (call: Call, calls: Call[]) => unknown, extra: Partial<BrowserRuntime> = {}) {
  const calls: Call[] = []
  setBrowser({
    request: async (url, options = {}) => {
      const target = new URL(url)
      const call = { path: target.pathname, query: Object.fromEntries(target.searchParams), headers: options.headers ?? {}, body: options.body && JSON.parse(options.body) }
      calls.push(call)
      const body = respond(call, calls)
      return { status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) }
    },
    article: async () => assert.fail('unexpected article'),
    cookie: async () => '1',
    login: async () => assert.fail('unexpected login'),
    solve: async () => assert.fail('unexpected captcha'),
    logout: async () => assert.fail('unexpected logout'),
    close: async () => {},
    ...extra,
  })
  t.after(() => setBrowser())
  return calls
}

test('a captcha in the middle of paging is solved once and only the challenged page is sent again', async t => {
  let solved = 0
  const calls = fake(t, call => call.query.offset === '0' ? { reviews: [{ subReviews: [review(4), review(3)] }] }
    : call.headers['x-wr-ticket'] ? { reviews: [{ subReviews: [review(2)] }, { subReviews: [review(1)] }] } : { errCode: -2041 },
    { solve: async () => { solved++; return { ticket: 'ticket', randstr: 'rand' } } })
  const articles = await webArticles(bookId, 4)
  assert.equal(solved, 1); assert.deepEqual(calls.map(call => call.query.offset), ['0', '1', '1'])
  assert.deepEqual([calls[2].headers['x-wr-ticket'], calls[2].headers['x-wr-randstr']], ['ticket', 'rand'])
  assert.deepEqual(articles.map(a => a.title), ['文章 & 4', '文章 & 3', '文章 & 2', '文章 & 1'])
  assert.deepEqual(articles[0], { id: `${bookId}_token~4`, title: '文章 & 4', url: `https://weread.qq.com/web/mp/content?reviewId=${bookId}_token~4`, publishedAt: '2026-10-10T08:04:00+08:00', summary: '' })
})

test('paging stops at the limit, at the requested article, or when a page brings nothing new', async t => {
  const calls = fake(t, call => ({ reviews: call.query.offset === '0' ? [{ subReviews: [review(2), review(1)] }] : [] }))
  assert.equal((await webArticles(bookId, 1)).length, 1)
  assert.equal((await webArticles(bookId, 50, article => article.title.endsWith('1'))).length, 2)
  assert.equal(calls.length, 2, 'neither call needed a second page')
  assert.equal((await webArticles(bookId, 50)).length, 2)
  assert.equal(calls.length, 4)
})

test('an expired login is renewed once; when renewal fails the user is told to log in', async t => {
  let renewable = true
  const calls = fake(t, (call, all) => call.path === '/web/login/renewal' ? { succ: renewable ? 1 : 0 }
    : all.some(c => c.path === '/web/login/renewal') && renewable ? { reviews: [] } : { errCode: -2012 })
  assert.deepEqual(await webArticles(bookId, 1), [])
  assert.deepEqual(calls.map(call => call.path), ['/web/mp/articles', '/web/login/renewal', '/web/mp/articles'])
  assert.deepEqual(calls[1].body, { rq: '%2Fweb%2Fmp%2Farticles', ql: true })
  renewable = false
  await assert.rejects(webArticles(bookId, 1), (e: any) => e.code === 'login_required')
})

test('accounts come from the shelf first and from search only when the shelf has no match', async t => {
  const calls = fake(t, call => call.path === '/web/shelf/sync'
    ? { books: [{ bookId, title: '书架公众号' }, { bookId: '12345', title: '普通图书' }] }
    : { results: [{ books: [{ bookInfo: { bookId: 'MP_WXS_9876543210', title: '搜索到的公众号' } }] }] })
  assert.deepEqual(await webAccounts('书架'), [{ biz: 'MTIzNDU2Nzg5MA==', name: '书架公众号' }])
  assert.equal(calls.length, 1)
  assert.deepEqual(await webAccounts('搜索'), [{ biz: 'OTg3NjU0MzIxMA==', name: '搜索到的公众号' }])
  assert.deepEqual(calls.at(-1)!.query, { keyword: '搜索' })
})

test('rate limits, rejections and a challenge that survives verification are reported, not retried', async t => {
  let response: unknown = { errCode: -429 }
  const calls = fake(t, () => response, { solve: async () => ({ ticket: 'ticket', randstr: 'rand' }) })
  await assert.rejects(webArticles(bookId, 1), (e: any) => e.code === 'rate_limited')
  response = { errCode: -3001 }
  await assert.rejects(webArticles(bookId, 1), (e: any) => e.code === 'remote_rejected' && e.message.includes('-3001'))
  assert.equal(calls.length, 2)
  response = { errCode: -2041 }
  await assert.rejects(webArticles(bookId, 1), (e: any) => e.code === 'verification_failed')
  assert.equal(calls.length, 4)
})

test('login finishes in the window; a challenge on the first request afterwards goes through the captcha flow', async t => {
  const calls = fake(t, call => call.headers['x-wr-ticket'] ? { books: [] } : { errCode: -2041 },
    { login: async () => ({ verified: false }), solve: async () => ({ ticket: 'ticket', randstr: 'rand' }) })
  assert.equal((await login()).ok, true)
  assert.deepEqual(calls.map(call => call.path), ['/web/shelf/sync', '/web/shelf/sync'])
})

test('login state is read from the browser without any request; logout clears it there', async t => {
  let vid: string | undefined = 'vid', cleared = 0
  const calls = fake(t, () => assert.fail('no request'), { cookie: async () => vid, logout: async () => { cleared++; vid = undefined } })
  assert.deepEqual(await loginState(), { ok: true, loggedIn: true })
  assert.equal((await logout()).ok, true)
  assert.deepEqual([await loginState(), cleared, calls.length], [{ ok: true, loggedIn: false }, 1, 0])
})
