/**
 * 「微信公众号」背后的 weread 技能（core/weread）要一个带着微信读书登录状态的浏览器。桌面版由壳开一个 Electron 窗口给它
 * （core/weread/lib/browser/service.cjs），插件里没有 Electron，改由这里在一条管道上提供同样的几个操作
 * （命令经 WEREAD_BROWSER_ENDPOINT 连上来，协议见 core/weread/lib/browser/runtime.ts）：
 *
 *   cookie、request   不用浏览器：登录状态是一份 cookie，存在 <数据目录>/weread/cookies.json，请求由宿主带着它直接发，
 *                     响应里新给的 cookie 记回去。后台半小时一次的检查都是这两样，不弹窗口。
 *   login、captcha    要用户本人扫码、过验证，开插件自己的浏览器窗口（browser.mjs，用的是本机的默认浏览器）；
 *                     login 等到窗口里有了登录 cookie 再取出来存下；captcha 在页面里装上官方的验证组件，有能看图的模型时
 *                     先让它自动作答（core/weread/lib/captcha）；PTA 模式在本地匹配滑块，不问模型。没认出来就等用户在窗口里做完，拿票据。
 *   article           文章正文：先直接请求；微信原文被要求验证时，在窗口里打开，同样先自动过、不成再等用户，然后从页面取 HTML。
 *   logout            删掉存下的 cookie。
 *
 * 这台电脑上没有 Chromium 内核的浏览器时，要窗口的几样报 browser_missing。
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { CORE_ROOT } from './core.mjs'
import { MISSING } from './browser.mjs'

const ORIGIN = 'https://weread.qq.com'
const WECHAT = 'https://mp.weixin.qq.com'
const LOGIN = ['wr_vid', 'wr_skey']
/** 等用户扫码、过验证最多多久（和 service.cjs 一样）。 */
const WAIT_MS = 290_000

const error = (code, message) => Object.assign(new Error(message), { code })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
/** 验证码模块（core/weread/lib/captcha）：用到时才加载。 */
const captchaKit = () => Promise.all(['index.mjs', 'electron.mjs'].map(file => import(pathToFileURL(path.join(CORE_ROOT, 'weread', 'lib', 'captcha', file)).href)))
  .then(([index, electron]) => ({ ...index, ...electron }))
/** 文章窗口里读当前页面：有没有正文、是不是验证页、「去验证」按钮在哪、页面上的出错提示（和 core/weread/lib/article/page.mjs 读的一样）。 */
const READ_PAGE = `(() => {
  const button = document.querySelector('#js_verify')?.getBoundingClientRect();
  const text = document.body?.innerText || '';
  return { html: document.documentElement.outerHTML, content: !!document.querySelector('#js_content'),
    verification: location.pathname.startsWith('/mp/wappoc_appmsgcaptcha'),
    button: button?.width && button?.height ? { x: button.x + button.width / 2, y: button.y + button.height / 2 } : null,
    message: /验证失败，请重试|系统繁忙，请稍后再试|系统失败/.exec(text)?.[0] };
})()`
function withSignal(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve,reject) => {
    const abort=()=>reject(signal.reason)
    if(signal.aborted){reject(signal.reason);return}
    signal.addEventListener('abort',abort,{once:true})
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
}

/** 一条 Set-Cookie 变成 ExportedCookie 那种写法；域名默认是请求的主机。 */
export function parseSetCookie(header, url) {
  const [pair, ...attributes] = header.split(';')
  const at = pair.indexOf('=')
  if (at < 1) return undefined
  const host = new URL(url).hostname, cookie = { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), domain: host, path: '/', secure: false, httpOnly: false }
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split('='), name = key.trim().toLowerCase(), value = rest.join('=').trim()
    if (name === 'domain' && value) cookie.domain = value.replace(/^\./, '').toLowerCase()
    else if (name === 'path' && value.startsWith('/')) cookie.path = value
    else if (name === 'secure') cookie.secure = true
    else if (name === 'httponly') cookie.httpOnly = true
    else if (name === 'max-age' && Number.isFinite(Number(value))) cookie.expirationDate = Date.now() / 1000 + Number(value)
    else if (name === 'expires' && Number.isFinite(Date.parse(value))) cookie.expirationDate = Date.parse(value) / 1000
  }
  return { ...cookie, url: `https://${cookie.domain}${cookie.path}` }
}

const matches = (cookie, url) => {
  const target = new URL(url), domain = (cookie.domain ?? new URL(cookie.url).hostname).replace(/^\./, '')
  return (target.hostname === domain || target.hostname.endsWith(`.${domain}`)) && target.pathname.startsWith(cookie.path ?? '/')
}
const live = cookie => !cookie.expirationDate || cookie.expirationDate * 1000 > Date.now()

export class WereadBridge {
  /**
   * dir 放 cookie；browser 返回插件的浏览器（browser.mjs；返回 undefined 当作没有）；
   * recognizer 返回认验证码的识别器（vision.mjs，没有能看图的模型时是 undefined）；fetchImpl 测试时换成假的。
   */
  constructor({ dir, browser, recognizer = async () => undefined, fetchImpl = fetch }) {
    Object.assign(this, { dir, browser, recognizer, fetchImpl })
    this.file = path.join(dir, 'cookies.json')
    this.queue = Promise.resolve()
  }

  jar() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).filter(live) } catch { return [] }
  }
  save(cookies) {
    fs.mkdirSync(this.dir, { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try { fs.writeFileSync(temp, JSON.stringify(cookies.filter(live), null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  remember(cookies) {
    const next = new Map(this.jar().map(cookie => [`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie]))
    for (const cookie of cookies) next.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie)
    this.save([...next.values()])
  }

  cookie(name) { return this.jar().find(cookie => cookie.name === name && matches(cookie, ORIGIN))?.value }

  async fetch(url, { method = 'GET', headers = {}, body } = {}) {
    const cookies = this.jar().filter(cookie => matches(cookie, url)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    const response = await this.fetchImpl(url, { method, body, redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { ...headers, ...(cookies ? { cookie: cookies } : {}) } })
    const set = response.headers.getSetCookie?.() ?? []
    if (set.length) this.remember(set.flatMap(header => parseSetCookie(header, url) ?? []))
    return { status: response.status, body: await response.text() }
  }

  request({ url, method, headers, body }) {
    if (new URL(url).origin !== ORIGIN) throw error('invalid_endpoint', '微信读书会话不能访问其他站点。')
    return this.fetch(url, { method, headers, body })
  }

  needBrowser(interactive, code, message) {
    if (!interactive) throw error(code, message)
    const browser = this.browser()
    if (!browser || browser.available?.() === false) throw error('browser_missing', MISSING)
    return browser
  }

  /** 识别器；没有能看图的模型、或者取的时候出了错，都当作没有，验证码交给用户。 */
  solver() { return Promise.resolve().then(() => this.recognizer()).catch(() => undefined) }

  /** 开一个看得见的窗口做一件事，做完关掉；一次只开一个。work 还收到这一次的期限：调用方取消了，或者等满 WAIT_MS。 */
  windowed(browser, label, url, work, { restore = true, signal } = {}) {
    const run = this.queue.then(async () => {
      signal?.throwIfAborted()
      const limit = signal ? AbortSignal.any([signal, AbortSignal.timeout(WAIT_MS)]) : AbortSignal.timeout(WAIT_MS)
      const session = await browser.open(label)
      try {
        signal?.throwIfAborted()
        if (restore) await withSignal(browser.restoreAuth(session, this.jar()).catch(() => 0),signal)
        await withSignal(browser.openUrl(session, { url }),signal)
        return await withSignal(work(session, limit),signal)
      } finally { await browser.close(session).catch(() => {}) }
    })
    this.queue = run.catch(() => {})
    return run
  }

  async login(_input, { interactive }) {
    const browser = this.needBrowser(interactive, 'login_required', '微信读书没有登录，需要在窗口里扫码。')
    return this.windowed(browser, '微信读书登录', `${ORIGIN}/`, async (session) => {
      const deadline = Date.now() + WAIT_MS
      while (Date.now() < deadline) {
        if (!browser.exists(session)) throw error('login_cancelled', '登录窗口已关闭。')
        const cookies = (await browser.flushAuth(session).catch(() => [])).filter(cookie => matches(cookie, ORIGIN))
        if (LOGIN.every(name => cookies.some(cookie => cookie.name === name && cookie.value))) {
          this.save(cookies)
          const response = await this.fetch(`${ORIGIN}/web/shelf/sync?userVid=&synckey=0&lectureSynckey=0`, { headers: { accept: 'application/json', referer: `${ORIGIN}/` } })
          let result
          try { result = JSON.parse(response.body) } catch { result = {} }
          if (Array.isArray(result.books)) return { verified: true }
          if (Number(result.errCode) === -2041) return { verified: false }
        }
        await pause(1000)
      }
      throw error('login_timeout', '没有在限定时间内完成微信读书登录。')
    })
  }

  /** 官方组件返回票据：微信读书问视觉模型，PTA 在本地匹配；失败后留在窗口等用户完成。 */
  captcha(_input, call) { return this.verifySite('weread',call) }
  ptaCaptcha(_input, call) { return this.verifySite('pta',call) }
  async verifySite(site, { interactive, signal }) {
    const pta=site==='pta', origin=pta?'https://pintia.cn':ORIGIN
    const browser = this.needBrowser(interactive, 'verification_required', `${pta?'PTA':'微信读书'}要先完成一次验证，请在对话里重新查询以打开验证窗口。`)
    const [{ verifyWeRead, verifyPta }, recognizer] = await Promise.all([captchaKit(), pta ? undefined : this.solver()])
    return this.windowed(browser, pta?'PTA 登录验证':'微信读书验证', pta?`${origin}/auth/login`:`${origin}/`, async (session, limit) => {
      await withSignal(browser.waitFor(session, {}).catch(() => {}),signal)
      if ((await browser.execute(session, { script: 'location.origin' })).value !== origin) throw error('verification_cancelled', '验证页面已离开本站。')
      // 组件做完时把结果交给验证码模块，和桌面版 preload 给的 wereadVerification 一样。
      let captcha
      const relay = browser.relay(session, 'wereadVerification', input => captcha?.receive(input))
      try {
        await relay.ready
        const proof = await (pta ? verifyPta : verifyWeRead)({ webContents: browser.webContents(session), recognizer, signal: limit, manual: true, bind: value => { captcha = value } })
        return { ticket: proof.ticket, randstr: proof.randstr }
      } finally { relay.stop() }
    }, { restore:!pta,signal })
  }

  async article({ url }, call = {}) {
    const target = new URL(url), wechat = target.origin === WECHAT
    if (!(wechat && (target.pathname === '/s' || target.pathname.startsWith('/s/'))) &&
        !(target.origin === ORIGIN && target.pathname === '/web/mp/content' && /^MP_WXS_\d+_[\w~-]+$/.test(target.searchParams.get('reviewId')))) {
      throw error('invalid_endpoint', '文章窗口只接受微信原文或微信读书文章链接。')
    }
    let proof
    for (let round = 0; round < 3; round++) {
      const { status, body } = await this.fetch(url, { headers: { referer: `${ORIGIN}/`, ...(proof ? { 'x-wr-ticket': proof.ticket, 'x-wr-randstr': proof.randstr } : {}) } })
      let data
      try { data = JSON.parse(body) } catch { /* 正文是 HTML */ }
      const code = Number(data?.errCode ?? data?.errcode ?? 0)
      if (!wechat && code === -2041) { proof = await this.captcha({}, call); continue }
      if (!wechat && ([-2010, -2012].includes(code) || status === 401)) throw error('login_required', '微信读书登录已失效，请先执行 login。')
      if (code === -429 || status === 429) throw error('rate_limited', '文章站点暂时限制了访问，请稍后再试。')
      if (wechat && /wappoc_appmsgcaptcha|js_verify/.test(body) && !body.includes('id="js_content"')) return this.verifyInWindow(url, call)
      if (code || status >= 400) throw error('remote_rejected', `文章站点拒绝了这次请求（${code || status}）。`)
      return body
    }
    throw error('verification_failed', '验证通过后微信读书仍然要求验证，请稍后重试。')
  }

  /** 微信原文要验证：在窗口里打开；有能看图的模型时先自动过一下，没有或者没过，就等用户过了，再从页面取 HTML。 */
  async verifyInWindow(url, { interactive, signal } = {}) {
    const browser = this.needBrowser(interactive, 'verification_required', '这篇文章要先完成一次验证。')
    const [{ verifyWeChat, ElectronCaptcha }, recognizer] = await Promise.all([captchaKit(), this.solver()])
    return this.windowed(browser, '公众号文章验证', url, async (session, limit) => {
      const read = async () => (await browser.execute(session, { script: READ_PAGE }).catch(() => ({ value: null }))).value ?? {}
      if (recognizer) {
        const captcha = new ElectronCaptcha({ webContents: browser.webContents(session), recognizer })
        try {
          await captcha.attach()
          const page = await verifyWeChat({ captcha, readPage: read, show: () => {}, signal: limit })
          if (page.content) return page.html
        } catch { /* 没认出来、或者微信说没过：窗口还开着，接着等用户自己过 */ }
        finally { captcha.cancel() }
      }
      while (!limit.aborted) {
        if (!browser.exists(session)) throw error('verification_cancelled', '文章窗口已关闭。')
        const page = await read()
        if (page.content) return page.html
        await pause(800)
      }
      throw error('verification_timeout', '没有在限定时间内取得文章正文。')
    }, { signal })
  }

  logout() {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file)
    return null
  }

  /** 在 endpoint 上开始听，返回停下来用的函数。 */
  listen(endpoint, { onlyPta = false, guard = () => {} } = {}) {
    if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true })
    const actions = onlyPta ? { ptaCaptcha:(input,call)=>this.ptaCaptcha(input,call) } : { cookie: name => this.cookie(name), request: input => this.request(input), article: (input, call) => this.article(input, call), login: (input, call) => this.login(input, call), captcha: (input, call) => this.captcha(input, call), logout: () => this.logout() }
    const sockets = new Set()
    const server = net.createServer((socket) => {
      const gone=new AbortController()
      sockets.add(socket)
      socket.on('close', () => { sockets.delete(socket);gone.abort() })
      socket.on('error', () => {})
      const send = value => { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n') }
      createInterface({ input: socket }).on('line', async (line) => {
        let message
        try { message = JSON.parse(line) } catch { return }
        try {
          guard()
          if (!Object.hasOwn(actions, message.action)) throw error('invalid_action', '不支持的浏览器操作。')
          send({ id: message.id, result: await actions[message.action](message.input, { interactive: message.interactive !== false, signal:AbortSignal.any([gone.signal,AbortSignal.timeout(WAIT_MS)]) }) })
        } catch (e) {
          const code = typeof e.code === 'string' ? e.code : e.name === 'TimeoutError' ? 'browser_timeout' : 'browser_error'
          send({ id: message.id, error: { code, message: typeof e.code === 'string' ? e.message : code === 'browser_timeout' ? '请求超时。' : '浏览器没有完成这次操作。' } })
        }
      })
    })
    server.listen(endpoint)
    return () => {
      server.close()
      for (const socket of sockets) socket.destroy()
    }
  }
}
