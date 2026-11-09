/**
 * 插件自己的浏览器（2026-11-04 起；原来借 dsh-builtin-browser 的 ctx.browser）：扫码登录微信读书、过腾讯验证码、读要先验证的公众号原文、
 * 看校内网页（campus-page.mjs，带着 Core 的登录）时开的窗口。
 * 用本机的默认浏览器：它是 Chrome、Edge 这类 Chromium 内核的就用它；不是（Firefox、Safari 不支持 CDP）就用本机装着的另一个 Chromium 浏览器，都没有时报 browser_missing。
 *
 * 起的时候给它插件自己的资料目录（<数据目录>/browser/<哪一种>），不碰用户平时那份资料，已经开着的浏览器也不受影响；
 * 带 --remote-debugging-port=0 打开 CDP，浏览器把端口写进资料目录的 DevToolsActivePort，从那里连上，用的是 Node 自带的 WebSocket。
 * 窗口全关了就把浏览器关掉，下次要用再起。不开 Runtime 域（Runtime.enable 是网页看出有调试器连着的常见办法），脚本照样能跑。
 *
 * 对外的几样和原来 ctx.browser 里用到的一样（open、openUrl、waitFor、execute、restoreAuth、flushAuth、exists、close），
 * webContents() 再给验证码模块（core/weread/lib/captcha）包一层它认的 Electron webContents：那一套自动识别本来就是拿 CDP 写的。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

const error = (code, message) => Object.assign(new Error(message), { code })
export const MISSING = '这台电脑上没找到能用的浏览器：扫码登录和过验证码要 Chrome、Edge 这类 Chromium 内核的浏览器。'
const ARGS = ['--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-default-apps', '--new-window']
/** 一条 CDP 命令最多等多久。等用户扫码、过验证是轮询，不靠一条命令等。 */
const COMMAND_MS = 30_000
/** 浏览器起来、打开调试端口最多等多久；页面加载也按这个等。 */
const LAUNCH_MS = 20_000

/**
 * 认得的 Chromium 内核浏览器。windows 是常见的安装位置，mac 是 bundle id 和 .app 里的程序，linux 是命令名。
 * 默认浏览器不是这几样时，按这个顺序找本机装着的（Windows 都带 Edge）。
 */
const KINDS = [
  { kind: 'edge', name: 'Edge', exe: 'msedge.exe', windows: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'],
    mac: ['com.microsoft.edgemac', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'], linux: ['microsoft-edge', 'microsoft-edge-stable'] },
  { kind: 'chrome', name: 'Chrome', exe: 'chrome.exe', windows: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe'],
    mac: ['com.google.chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'], linux: ['google-chrome', 'google-chrome-stable'] },
  { kind: 'brave', name: 'Brave', exe: 'brave.exe', windows: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    mac: ['com.brave.browser', 'Brave Browser.app/Contents/MacOS/Brave Browser'], linux: ['brave-browser'] },
  { kind: 'vivaldi', name: 'Vivaldi', exe: 'vivaldi.exe', windows: ['%LOCALAPPDATA%\\Vivaldi\\Application\\vivaldi.exe', '%ProgramFiles%\\Vivaldi\\Application\\vivaldi.exe'],
    mac: ['com.vivaldi.vivaldi', 'Vivaldi.app/Contents/MacOS/Vivaldi'], linux: ['vivaldi', 'vivaldi-stable'] },
  { kind: 'chromium', name: 'Chromium', exe: 'chromium.exe', windows: ['%LOCALAPPDATA%\\Chromium\\Application\\chromium.exe'],
    mac: ['org.chromium.chromium', 'Chromium.app/Contents/MacOS/Chromium'], linux: ['chromium', 'chromium-browser'] },
]

/** 跑一个系统命令取它的输出，出错、超时都当作没有。 */
function runQuiet(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
}

/** %ProgramFiles% 这类写法换成实际的位置（Windows 的环境变量不分大小写）。 */
function expand(value, env) {
  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(env).find(item => item.toLowerCase() === name.toLowerCase())
    return key ? env[key] : whole
  })
}

/**
 * Windows：打开 https 链接用的那个程序（注册表里用户选的 ProgId，再看它的打开命令）。
 * 新一些的 Windows 11 把用户的选择记在 UserChoiceLatest（有的在它的 ProgId 子键里），UserChoice 可能还停在旧值，所以先看它。
 */
function windowsDefault({ env, run }) {
  const base = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\'
  let progId
  for (const key of ['UserChoiceLatest', 'UserChoiceLatest\\ProgId', 'UserChoice']) {
    progId = /ProgId\s+REG_SZ\s+(\S+)/.exec(run('reg', ['query', base + key, '/v', 'ProgId']))?.[1]
    if (progId) break
  }
  if (!progId) return undefined
  const command = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(run('reg', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']))?.[1]?.trim()
  if (!command) return undefined
  return expand(command.startsWith('"') ? command.slice(1, command.indexOf('"', 1)) : command.split(/\s+/)[0], env)
}

/** macOS：LaunchServices 里 https 交给哪个程序（bundle id）。没改过默认浏览器时没有这一项，就是 Safari。 */
function macDefault({ env, run }) {
  const plist = path.posix.join(env.HOME || os.homedir(), 'Library', 'Preferences', 'com.apple.LaunchServices', 'com.apple.launchservices.secure.plist')
  let handlers
  try { handlers = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', plist])).LSHandlers } catch { return undefined }
  const pick = scheme => handlers?.find(handler => handler.LSHandlerURLScheme === scheme)?.LSHandlerRoleAll
  return (pick('https') ?? pick('http'))?.toLowerCase()
}

/** 一种浏览器在本机的位置，没装时是 undefined。 */
function locate(entry, { platform, env, exists }) {
  if (platform === 'win32') return entry.windows.map(item => expand(item, env)).find(file => !file.includes('%') && exists(file))
  if (platform === 'darwin') return ['/Applications', path.posix.join(env.HOME || os.homedir(), 'Applications')].map(dir => path.posix.join(dir, entry.mac[1])).find(file => exists(file))
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    for (const name of entry.linux) { const file = path.posix.join(dir, name); if (exists(file)) return file }
  }
  return undefined
}

/**
 * 用哪个浏览器：默认浏览器是认得的 Chromium 内核浏览器就用它，不是就按 KINDS 的顺序找本机装着的。
 * 返回 { kind, name, path, isDefault }，一个都没有时返回 undefined。platform、env、run、exists 测试时换掉。
 */
export function findBrowser({ platform = process.platform, env = process.env, run = runQuiet, exists = fs.existsSync } = {}) {
  const options = { platform, env, run, exists }
  let preferred
  if (platform === 'win32') {
    const file = windowsDefault(options), entry = file && KINDS.find(item => item.exe === path.win32.basename(file).toLowerCase())
    if (entry && exists(file)) preferred = { entry, file }
  } else if (platform === 'darwin') {
    const id = macDefault(options), entry = KINDS.find(item => item.mac[0] === id)
    if (entry) preferred = { entry, file: locate(entry, options) }
  } else {
    const desktop = run('xdg-settings', ['get', 'default-web-browser']).trim().replace(/\.desktop$/, '')
    const entry = KINDS.find(item => item.linux.includes(desktop))
    if (entry) preferred = { entry, file: locate(entry, options) }
  }
  if (preferred?.file) return { kind: preferred.entry.kind, name: preferred.entry.name, path: preferred.file, isDefault: true }
  for (const entry of KINDS) {
    const file = locate(entry, options)
    if (file) return { kind: entry.kind, name: entry.name, path: file, isDefault: false }
  }
  return undefined
}

/** 一条 CDP 连接：send 发命令等回音；on 听事件（{ method, params, sessionId }）；gone 是连接断了。 */
class Cdp {
  static async connect(url, timeoutMs = 3000) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('timeout')) }, timeoutMs)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect failed')) }, { once: true })
    })
    return new Cdp(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    this.listeners = new Set()
    this.closed = false
    this.gone = new Promise(resolve => {
      socket.addEventListener('close', () => {
        this.closed = true
        for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error('browser_closed', '浏览器已经关了。')) }
        this.pending.clear()
        resolve()
      })
    })
    socket.addEventListener('message', ({ data }) => {
      let message
      try { message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')) } catch { return }
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id)
        if (!waiting) return
        this.pending.delete(message.id)
        clearTimeout(waiting.timer)
        if (message.error) waiting.reject(error('browser_error', message.error.message ?? '浏览器拒绝了这条命令。'))
        else waiting.resolve(message.result ?? {})
        return
      }
      for (const listener of this.listeners) { try { listener(message) } catch { /* 一个听的出错不影响别的 */ } }
    })
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(error('browser_closed', '浏览器已经关了。'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(error('browser_timeout', `浏览器没有回应（${method}）。`)) }, COMMAND_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(listener) { this.listeners.add(listener) }

  close() { try { this.socket.close() } catch { /* 已经断了 */ } }
}

/** 资料目录里有 DevToolsActivePort 时连上去：第一行是端口，第二行是浏览器那一层的路径。 */
async function attachTo(portFile) {
  const [port, target] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)
  if (!/^\d+$/.test(port) || !target?.startsWith('/devtools/browser/')) throw new Error('bad DevToolsActivePort')
  return Cdp.connect(`ws://127.0.0.1:${port}${target}`)
}

/** CDP 的 cookie 换成原来 ctx.browser 给的写法（domain 不带开头的点，expirationDate 是秒）。 */
function exported(cookie) {
  const domain = cookie.domain.replace(/^\./, '')
  return { name: cookie.name, value: cookie.value, domain, hostOnly: !cookie.domain.startsWith('.'), path: cookie.path, secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
    ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {}), url: `https://${domain}${cookie.path}` }
}

export class CampusBrowser {
  /** dir 放各种浏览器各自的资料目录；find、launch 测试时换掉。 */
  constructor({ dir, find = findBrowser, launch = spawn }) {
    Object.assign(this, { dir, find, launch })
    /** 开着的窗口：编号 → 页面的会话、页面里的子框架、听事件的、地址。 */
    this.windows = new Map()
  }

  /** 用哪个浏览器（找一次记住）。没有时是 undefined。 */
  choice() {
    if (this.found === undefined) this.found = this.find() ?? null
    return this.found ?? undefined
  }

  /** 这台电脑上有没有能用的浏览器。 */
  available() { return !!this.choice() }

  async connect() {
    await this.stopping
    if (this.cdp && !this.cdp.closed) return this.cdp
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    return this.starting
  }

  async start() {
    const browser = this.choice()
    if (!browser) throw error('browser_missing', MISSING)
    const profile = path.join(this.dir, browser.kind), portFile = path.join(profile, 'DevToolsActivePort')
    fs.mkdirSync(profile, { recursive: true })
    // 上一次起的还开着（比如 dsh 没正常退出）就接着用；连不上说明这个文件是留下来的。
    let cdp = await attachTo(portFile).catch(() => undefined)
    if (!cdp) {
      fs.rmSync(portFile, { force: true })
      let failed
      const child = this.launch(browser.path, [...ARGS, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: false })
      child.once('error', (cause) => { failed = cause })
      child.once('exit', () => { failed ??= new Error('已退出') })
      this.child = child
      const deadline = Date.now() + LAUNCH_MS
      while (!cdp) {
        if (failed) throw error('browser_failed', `${browser.name}没有起来（${failed.message}）。`)
        if (Date.now() > deadline) { child.kill(); throw error('browser_failed', `${browser.name}没有打开调试端口，扫码登录和过验证码用不了。`) }
        await pause(150)
        cdp = await attachTo(portFile).catch(() => undefined)
      }
    }
    cdp.on(message => this.route(message))
    void cdp.gone.then(() => {
      if (this.cdp === cdp) this.cdp = undefined
      for (const window of this.windows.values()) window.alive = false
    })
    // 浏览器起来时自己开的那一页留给第一个窗口，不另开一个空窗口。
    const { targetInfos = [] } = await cdp.send('Target.getTargets')
    this.spare = targetInfos.find(info => info.type === 'page' && !info.attached)?.targetId
    this.cdp = cdp
    return cdp
  }

  send(method, params, sessionId) {
    if (!this.cdp) return Promise.reject(error('browser_closed', '浏览器已经关了。'))
    return this.cdp.send(method, params, sessionId)
  }

  /** 收到的事件按会话分给窗口：页面自己的，和挂在页面下面的子框架（跨站的 iframe 是单独的 target）的。 */
  route({ method, params, sessionId }) {
    if (!method) return
    if (!sessionId) {
      // 浏览器那一层：用户把窗口关了，页面的会话就断了，这个窗口不再算开着的。
      if (method === 'Target.detachedFromTarget') {
        for (const window of this.windows.values()) if (window.sessionId === params.sessionId) { window.alive = false; this.windows.delete(window.id) }
      }
      return
    }
    for (const window of this.windows.values()) {
      const own = sessionId === window.sessionId, frame = window.frames.get(sessionId)
      if (!own && !frame) continue
      // 页面要去的地址先给 reroute 看（见 reroute()）：它给了另一个地址就回一个 302 跳过去，没给就照常走。
      if (own && method === 'Fetch.requestPaused') {
        let next
        try { next = window.reroute?.(params.request.url) } catch { /* 认不出的照常走 */ }
        const reply = next && next !== params.request.url
          ? this.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 302, responseHeaders: [{ name: 'Location', value: next }] }, sessionId)
          : this.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId)
        reply.catch(() => {})
        return
      }
      if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        window.frames.set(params.sessionId, { url: params.targetInfo.url, targetId: params.targetInfo.targetId })
        this.send('Page.enable', {}, params.sessionId).catch(() => {})
      }
      if (method === 'Target.detachedFromTarget') window.frames.delete(params.sessionId)
      // 子框架刚挂上时地址还是空的，导航以后父会话收到 targetInfoChanged（子会话这时多半还没开 Page 域，等不到 frameNavigated）。
      if (method === 'Target.targetInfoChanged' && params.targetInfo?.type === 'iframe') {
        for (const item of window.frames.values()) if (item.targetId === params.targetInfo.targetId) item.url = params.targetInfo.url
      }
      // 跨站 iframe 自己那一帧也带着 parentId（父框架在另一个进程里），它的帧 id 就是 targetId。
      if (method === 'Page.frameNavigated' && (own ? !params.frame.parentId : params.frame.id === frame.targetId)) (own ? window : frame).url = params.frame.url
      // 和 Electron 的 debugger 一样：页面自己的事件 sessionId 是空的，子框架的带着它的 sessionId。
      for (const listener of window.listeners) listener({}, method, params, own ? '' : sessionId)
      return
    }
  }

  alive(id) {
    const window = this.windows.get(id)
    if (!window?.alive) throw error('browser_closed', '窗口已关闭。')
    return window
  }

  /** 开一个窗口，返回它的编号。label 说这个窗口做什么（系统浏览器的窗口标题由页面定，这里只记着）。 */
  async open(label) {
    const cdp = await this.connect()
    let targetId = this.spare
    this.spare = undefined
    if (!targetId) ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true }))
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const id = randomUUID()
    this.windows.set(id, { id, label, targetId, sessionId, alive: true, url: 'about:blank', frames: new Map(), listeners: new Set() })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
    await cdp.send('Page.bringToFront', {}, sessionId).catch(() => {})
    return id
  }

  /** 等页面自己的一个事件，最多等 ms；返回 { done, stop }。 */
  waitEvent(window, name, ms) {
    let listener, timer
    const done = new Promise(resolve => {
      listener = (_event, method, _params, sessionId) => { if (method === name && !sessionId) resolve() }
      window.listeners.add(listener)
      timer = setTimeout(resolve, ms)
    })
    const stop = () => { window.listeners.delete(listener); clearTimeout(timer) }
    return { done: done.finally(stop), stop }
  }

  /** 打开一个地址，等它加载完（最多 LAUNCH_MS）。 */
  async openUrl(id, { url }) {
    const window = this.alive(id)
    const loaded = this.waitEvent(window, 'Page.loadEventFired', LAUNCH_MS)
    const { errorText } = await this.send('Page.navigate', { url }, window.sessionId).catch((cause) => { loaded.stop(); throw cause })
    if (errorText && errorText !== 'net::ERR_ABORTED') { loaded.stop(); throw error('browser_navigation', `页面没有打开（${errorText}）。`) }
    await loaded.done
  }

  /** 等当前页面加载完（最多十秒）。 */
  async waitFor(id) {
    const window = this.alive(id), deadline = Date.now() + 10_000
    while (Date.now() < deadline && window.alive) {
      if (await this.evaluate(window.sessionId, 'document.readyState').catch(() => '') === 'complete') return {}
      await pause(150)
    }
    return {}
  }

  async evaluate(sessionId, expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
    if (exceptionDetails) throw error('script_failed', exceptionDetails.exception?.description?.split('\n')[0] ?? exceptionDetails.text ?? '页面脚本出错。')
    return result?.value
  }

  async execute(id, { script }) { return { value: await this.evaluate(this.alive(id).sessionId, script) } }

  /** CAS 会话与登录时的 UA 绑定；只对复用该会话的窗口设置，不影响验证码等其他窗口。 */
  async setUserAgent(id, userAgent) {
    await this.send('Emulation.setUserAgentOverride', { userAgent }, this.alive(id).sessionId)
  }

  /** 把存下的 cookie 放进浏览器。CDP 用前导点区分父域 cookie，否则它只属于一个主机。 */
  async restoreAuth(id, cookies) {
    const window = this.alive(id)
    const list = cookies.filter(cookie => cookie.name && (cookie.domain || cookie.url)).map(cookie => ({ name: cookie.name, value: cookie.value,
      ...(cookie.domain && cookie.hostOnly !== true ? { domain: `.${cookie.domain.replace(/^\./, '')}` } : { url: cookie.url || `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path || '/'}` }),
      path: cookie.path ?? '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly, ...(cookie.expirationDate ? { expires: cookie.expirationDate } : {}) }))
    if (list.length) await this.send('Network.setCookies', { cookies: list }, window.sessionId)
    return list.length
  }

  /** 浏览器里现在的全部 cookie。 */
  async flushAuth(id) {
    this.alive(id)
    const { cookies = [] } = await this.send('Storage.getCookies', {})
    return cookies.map(exported)
  }

  exists(id) { return !!this.windows.get(id)?.alive }

  /** 把窗口提到前面。 */
  async focus(id) { await this.send('Page.bringToFront', {}, this.alive(id).sessionId).catch(() => {}) }

  /**
   * 这个窗口里页面（和同进程的子框架）每次要打开一个地址时先问 reroute(地址)：它返回另一个地址就改去那里，返回 undefined 照常走。
   * 校内网页经 WebVPN 看时用它：页面里点到的校内链接、统一身份认证跳回来的地址都要换路（campus-page.mjs）。
   */
  async reroute(id, reroute) {
    const window = this.alive(id)
    window.reroute = reroute
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] }, window.sessionId)
  }

  /**
   * 验证码组件做完时把结果交给 receive：页面里放一个 window[name].complete，和桌面版 preload 给的一样（taskId、ret、ticket、randstr）。
   * 不用 Runtime.addBinding（要开 Runtime 域），结果先记在页面里，隔一会儿取一次。返回 { ready, stop }。
   */
  relay(id, name, receive) {
    const window = this.alive(id), box = JSON.stringify('__campusCaptchaResults')
    let stopped = false
    const ready = this.evaluate(window.sessionId, `(()=>{window[${box}]=[];window[${JSON.stringify(name)}]={complete:r=>{window[${box}].push({taskId:r?.taskId,ret:r?.ret,ticket:r?.ticket,randstr:r?.randstr})}};return true})()`)
    void (async () => {
      await ready.catch(() => {})
      while (!stopped && window.alive) {
        const results = await this.evaluate(window.sessionId, `(()=>{const r=window[${box}]||[];window[${box}]=[];return r})()`).catch(() => [])
        for (const result of results ?? []) receive(result)
        await pause(200)
      }
    })()
    return { ready, stop: () => { stopped = true } }
  }

  /** 给验证码模块的 webContents：debugger 收发的就是这个窗口的 CDP，mainFrame.framesInSubtree 列出页面和跨站的子框架。 */
  webContents(id) {
    const window = this.alive(id)
    const run = sessionId => code => this.evaluate(sessionId, code)
    const mainFrame = {
      get url() { return window.url },
      executeJavaScript: run(window.sessionId),
      get framesInSubtree() { return [mainFrame, ...[...window.frames].map(([sessionId, frame]) => ({ url: frame.url, executeJavaScript: run(sessionId) }))] },
    }
    return {
      mainFrame,
      isDestroyed: () => !window.alive,
      executeJavaScript: run(window.sessionId),
      debugger: {
        isAttached: () => true,
        attach() {},
        detach() {},
        on: (name, listener) => { if (name === 'message') window.listeners.add(listener) },
        removeListener: (_name, listener) => { window.listeners.delete(listener) },
        sendCommand: (method, params = {}, sessionId) => this.send(method, params, sessionId || window.sessionId),
      },
    }
  }

  /** 关掉一个窗口；最后一个窗口关掉时整个浏览器退出，等它退干净，下次再起时资料目录不会还被占着。 */
  async close(id) {
    const window = this.windows.get(id)
    if (!window) return
    this.windows.delete(id)
    window.alive = false
    const cdp = this.cdp
    if (!cdp || cdp.closed) return
    if (this.windows.size) { await cdp.send('Target.closeTarget', { targetId: window.targetId }).catch(() => {}); return }
    this.cdp = undefined
    this.stopping = this.shutdown(cdp).finally(() => { this.stopping = undefined })
    await this.stopping
  }

  async shutdown(cdp) {
    const child = this.child
    this.child = undefined
    await cdp.send('Browser.close').catch(() => {})
    await Promise.race([cdp.gone, pause(5000)])
    if (child && child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)])
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
    cdp.close()
  }

  /** 插件停下时调：开着的窗口和浏览器都关掉。 */
  async dispose() {
    for (const id of [...this.windows.keys()]) await this.close(id)
    const cdp = this.cdp
    if (cdp) { this.cdp = undefined; await this.shutdown(cdp) }
  }
}
