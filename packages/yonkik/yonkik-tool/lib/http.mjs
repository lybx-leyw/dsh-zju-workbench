import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { CookieJar } from './cookies.mjs'
import { loadCredentials } from './credentials.mjs'

const repoRoot = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 只暴露 get/post/download：能力面即安全边界，put/patch/delete 不存在。
// post 仅用于登录、搜索等只读语义（见 skills/site-recon/references/safety.md）。
// 所有请求串行（并发 1），间隔取 site.json 的 rateLimit.minIntervalMs。
export async function createClient(siteKey, { root = repoRoot, quiet = false } = {}) {
  const siteDir = path.join(root, 'sites', siteKey)
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'))
  const origin = site.origin.replace(/\/$/, '')
  const minInterval = site.rateLimit?.minIntervalMs ?? 2000
  const jar = new CookieJar()

  const stateFile = site.auth?.stateFile && path.join(siteDir, site.auth.stateFile)
  if (stateFile && fs.existsSync(stateFile)) {
    jar.importStorageState(JSON.parse(fs.readFileSync(stateFile, 'utf8')))
  }

  let tail = Promise.resolve()
  let lastStart = 0

  async function request(method, target, { query, body, headers = {} } = {}) {
    const url = new URL(target.startsWith('http') ? target : origin + (target.startsWith('/') ? target : '/' + target))
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)

    const h = { ...headers }
    let payload
    if (body != null) {
      if (typeof body === 'string') payload = body
      else if (body instanceof URLSearchParams) {
        payload = body.toString()
        h['content-type'] ??= 'application/x-www-form-urlencoded'
      } else {
        payload = JSON.stringify(body)
        h['content-type'] ??= 'application/json'
      }
    }

    const run = async () => {
      const gap = lastStart + minInterval - Date.now()
      if (gap > 0) await sleep(gap)
      for (let attempt = 0; ; attempt++) {
        lastStart = Date.now()
        const cookie = jar.headerFor(url)
        if (cookie) h.cookie = cookie
        const res = await fetch(url, { method, headers: h, body: payload, redirect: 'follow' })
        jar.setFromResponse(url, res)
        if (!quiet) console.error(`[${siteKey}] ${method} ${url.pathname} → ${res.status}`)
        if ((res.status === 429 || res.status === 503) && attempt < 3) {
          const wait = parseRetryAfter(res.headers.get('retry-after')) ?? minInterval * (attempt + 2)
          if (wait > 60_000) {
            throw new Error(`[${siteKey}] ${method} ${url.pathname} 限流等待 ${Math.round(wait / 1000)}s（>60s），停止。把实测限流写进 site.json 和 wiki。`)
          }
          await sleep(wait)
          continue
        }
        return res
      }
    }

    const result = tail.then(run, run)
    tail = result.then(() => {}, () => {})
    return result
  }

  async function json(method, target, opts) {
    const res = await request(method, target, opts)
    if (!res.ok) throw new Error(`[${siteKey}] ${method} ${target} → ${res.status}`)
    return res.json()
  }

  return {
    site,
    jar,
    credentials: () => loadCredentials(site.auth?.credentialKey ?? siteKey, { root }),
    request,
    get: (target, opts) => request('GET', target, opts),
    post: (target, opts) => request('POST', target, opts),
    getJSON: (target, opts) => json('GET', target, opts),
    postJSON: (target, body, opts = {}) => json('POST', target, { ...opts, body }),
    async download(target, dest, opts) {
      const res = await request('GET', target, opts)
      if (!res.ok) throw new Error(`[${siteKey}] GET ${target} → ${res.status}（下载失败）`)
      await fs.promises.mkdir(path.dirname(path.resolve(dest)), { recursive: true })
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
      return dest
    },
  }
}

function parseRetryAfter(value) {
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}