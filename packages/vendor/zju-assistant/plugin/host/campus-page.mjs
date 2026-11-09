/**
 * 页面上的校内链接（通知原文、教务网、学在浙大、CC98 的页面）在插件自己的浏览器窗口里打开（browser.mjs），点开就是登录好的，
 * 链接本身还是原来的地址（2026-11-04 起；0.1.2 交给系统默认浏览器，要用户自己再登一遍 WebVPN 和统一身份认证）。照最初借 dsh-builtin-browser 时的做法，
 * 那一版又是照桌面版的阅读窗口（desktop/reader.cjs）搬的：
 * - 打开前让 ZJU Core 把统一身份认证、WebVPN 的会话续上（已经有效时它不重新登录），把这两样的 cookie 写进窗口。
 * - 地址照 Core 的访问方式在后台换：默认经 WebVPN，统一身份认证和标注为公网可达的网站直连，选了校园网直连就都直连。
 *   CDP 能拦下页面里的跳转（ctx.browser 那时做不到），页面里点到别的校内链接、统一身份认证跳回来的地址也照样换路，不用再登录。
 * - 教务网这类不会自己把人带去统一身份认证的网站，先打开统一身份认证为它换票的地址，再打开要看的那一页。
 * CC98 不在 zju.edu.cn 下面，但只在校网里能上（Core 也当它是校网站点），一样经 WebVPN；它自己的账号要在这个窗口里登一次，插件的浏览器资料会记住。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const WEBVPN_HOST = 'webvpn.zju.edu.cn'
const CAS_HOST = 'zjuam.zju.edu.cn'
/** WebVPN 给主机名加密用的固定密钥，和 core/zju/lib/webvpn/client.ts 里的是同一个。 */
const WRD_KEY = Buffer.from('wrdvpnisthebest!', 'utf8')
/** 这两个会话文件里的 cookie 才放进窗口，而且只放 zju.edu.cn 下面的。 */
const SESSION_FILES = ['zjuam', 'webvpn']
/** 从校外实测过公网可达的站点（core/zju/lib/webvpn/README.md 的表），Core 访问它们也是直连。 */
const KNOWN_PUBLIC = ['zdbk.zju.edu.cn', 'courses.zju.edu.cn', 'classroom.zju.edu.cn', 'eta.zju.edu.cn']
/** 一个工具结果里最多给助手换多少条链接；通知列表一次几十条，够用。 */
const MAX_LINKS = 200
/** 要先到统一身份认证换票的网站，和换票的地址（core/zju/lib/zdbk/client.ts 的 CAS_SERVICE）。 */
const SITE_LOGINS = { 'zdbk.zju.edu.cn': 'https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html' }

export const isCampusHost = host => host === 'zju.edu.cn' || host.endsWith('.zju.edu.cn')
/** 只在校网里能上的网站：学校的，加上 CC98。 */
export const isIntranetHost = host => isCampusHost(host) || host === 'cc98.org' || host.endsWith('.cc98.org')

function encodeHost(host) {
  const cipher = crypto.createCipheriv('aes-128-cfb', WRD_KEY, WRD_KEY)
  return WRD_KEY.toString('hex') + Buffer.concat([cipher.update(Buffer.from(host.toLowerCase(), 'utf8')), cipher.final()]).toString('hex')
}

function decodeHost(hex) {
  const key = WRD_KEY.toString('hex')
  if (!hex.toLowerCase().startsWith(key)) return undefined
  const decipher = crypto.createDecipheriv('aes-128-cfb', WRD_KEY, WRD_KEY)
  const host = Buffer.concat([decipher.update(Buffer.from(hex.slice(key.length), 'hex')), decipher.final()]).toString('utf8')
  return /^[a-z0-9.-]+$/i.test(host) ? host : undefined
}

/** 真实地址 → WebVPN 形式，不带让 WebVPN 原样返回内容的 vpn-12-o2 标记：要给人看，页面里的链接得由 WebVPN 改写好。 */
export function wrapUrl(realUrl) {
  const url = new URL(realUrl)
  if (url.hostname === WEBVPN_HOST) return url.href
  return `https://${WEBVPN_HOST}/${url.protocol.replace(':', '')}${url.port ? `-${url.port}` : ''}/${encodeHost(url.hostname)}${url.pathname}${url.search}${url.hash}`
}

/** WebVPN 形式 → 真实地址；不是 WebVPN 形式的原样返回。 */
export function unwrapUrl(vpnUrl) {
  const url = new URL(vpnUrl)
  if (url.hostname !== WEBVPN_HOST) return url.href
  const match = /^\/(https?)(?:-(\d+))?\/([0-9a-f]+)(\/.*)?$/i.exec(url.pathname)
  const host = match ? decodeHost(match[3]) : undefined
  if (!host) return url.href
  const search = url.search.replace(/[?&]vpn-12-o2-[^&]*/g, '').replace(/^&/, '?')
  return `${match[1]}://${host}${match[2] ? `:${match[2]}` : ''}${match[4] ?? '/'}${search}${url.hash}`
}

/** 读通知模块的逐站标注表，取出标为公网可达的主机；表还没生成时只有实测过的那几个。 */
function publicHostsFrom(file) {
  const hosts = new Set(KNOWN_PUBLIC)
  try {
    for (const [host, note] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).hosts ?? {})) if (note?.network === 'public') hosts.add(host)
  } catch { /* 没有这张表或读不了 */ }
  return hosts
}

/**
 * 一个要去的地址实际该打开哪个地址；transport 是 Core 的访问方式。不是 http(s) 的返回 undefined。
 * 页面跳转途中也用它：经 WebVPN 时，WebVPN 把去统一身份认证的跳转改写成了它自己的地址，统一身份认证要直连（登录状态在本机）。
 */
export function routeUrl(target, transport, publicHosts = new Set(KNOWN_PUBLIC)) {
  let url
  try { url = new URL(target) } catch { return undefined }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (transport !== 'webvpn') return url.href
  if (url.hostname === WEBVPN_HOST) {
    const real = unwrapUrl(url.href)
    return real !== url.href && new URL(real).hostname === CAS_HOST ? real : url.href
  }
  if (url.hostname === CAS_HOST || publicHosts.has(url.host)) return url.href
  return isIntranetHost(url.hostname) ? wrapUrl(url.href) : url.href
}

/** Core 存的一条 cookie 变成 restoreAuth 认的写法；不在 zju.edu.cn 下面的不要。 */
export function exportedCookie(cookie) {
  const domain = typeof cookie?.domain === 'string' ? cookie.domain.replace(/^\./, '').toLowerCase() : ''
  if (!isCampusHost(domain) || typeof cookie.name !== 'string' || !cookie.name || typeof cookie.value !== 'string') return undefined
  const cookiePath = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/'
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${domain}${cookiePath}`, name: cookie.name, value: cookie.value, path: cookiePath, secure: cookie.secure === true,
    ...(cookie.hostOnly ? {} : { domain }),
    ...(typeof cookie.expires === 'number' && cookie.expires > 0 ? { expirationDate: cookie.expires / 1000 } : {}),
  }
}

export class CampusPage {
  /** browser 是插件自己的浏览器；account 读访问方式；dataDir 是 ZJU Core 的数据目录；coreRoot 找公网可达的标注表；run 跑一条 Core 命令。 */
  constructor({ browser, account, dataDir, coreRoot, run }) {
    Object.assign(this, { browser, account, dataDir, run })
    this.publicHosts = publicHostsFrom(path.join(coreRoot, 'zju', 'lib', 'notice', 'hosts.json'))
    this.queue = Promise.resolve()
  }

  transport() { return this.account.read().data.transport === 'direct' ? 'direct' : 'webvpn' }

  /**
   * 给助手的：一个工具结果里出现的校内地址，经 WebVPN 时各自该开的地址（原地址 → WebVPN 地址，最多 MAX_LINKS 条）。
   * 助手照它把链接写成 [原地址](WebVPN 地址)：聊天里看着还是原来的地址，点开在校外也能上（2026-11-04）。
   * 选了校园网直连、或者没有要换的，返回 undefined，助手直接写原地址。
   */
  links(value) {
    if (this.transport() !== 'webvpn') return undefined
    const found = new Map()
    for (const raw of JSON.stringify(value ?? null).match(/https?:\/\/[^\s"'<>\\)\]]+/g) ?? []) {
      const text = raw.replace(/[.,;:!?。，、；：！？）》」』】]+$/u, '')
      if (found.has(text) || found.size >= MAX_LINKS) continue
      let url
      try { url = new URL(text) } catch { continue }
      if (url.hostname === WEBVPN_HOST) continue
      const routed = routeUrl(url.href, 'webvpn', this.publicHosts)
      if (routed && routed !== url.href) found.set(text, routed)
    }
    return found.size ? Object.fromEntries(found) : undefined
  }

  cookies() {
    return SESSION_FILES.flatMap((system) => {
      try { return JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'sessions', `${system}.json`), 'utf8')).cookies ?? [] } catch { return [] }
    }).flatMap(cookie => exportedCookie(cookie) ?? [])
  }

  /** 在插件的浏览器里打开一个校内网页，一次一个，都在同一个窗口里；返回原来的地址。 */
  open(target) {
    let url
    try { url = new URL(target) } catch { url = undefined }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return Promise.reject(new Error('只能打开网页地址。'))
    const run = this.queue.then(() => this.show(url))
    this.queue = run.catch(() => {})
    return run
  }

  async show(url) {
    const transport = this.transport()
    // 会话过期时先让 Core 登录一次；登不上也照样打开，页面上会停在登录页，用户自己能看到。
    if (isCampusHost(url.hostname) || (isIntranetHost(url.hostname) && transport === 'webvpn')) {
      for (const system of transport === 'webvpn' ? ['zjuam', 'webvpn'] : ['zjuam']) {
        await this.run([system, 'session', 'login'], { system: system === 'zjuam' ? '统一身份认证' : 'WebVPN', timeoutMs: 60_000, ignoreSwitches: true }).catch(() => {})
      }
    }
    if (!this.window || !this.browser.exists(this.window)) {
      this.window = await this.browser.open('校内网页')
      await this.browser.reroute(this.window, (next) => {
        const routed = routeUrl(next, this.transport(), this.publicHosts)
        return routed !== next ? routed : undefined
      })
    }
    // TGT 除 cookie 外还绑定登录时的 UA。Core 续登时会保存它，不能用当前 Edge/Chrome 的版本代替。
    let userAgent
    try { userAgent = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'sessions', 'zjuam.json'), 'utf8')).extra?.userAgent } catch { /* 没有可复用的会话 */ }
    if (typeof userAgent === 'string' && userAgent) await this.browser.setUserAgent(this.window, userAgent)
    await this.browser.restoreAuth(this.window, this.cookies())
    await this.browser.focus(this.window)
    const site = SITE_LOGINS[url.host]
    if (site) await this.browser.openUrl(this.window, { url: `https://${CAS_HOST}/cas/login?service=${encodeURIComponent(site)}` }).catch(() => {})
    await this.browser.openUrl(this.window, { url: routeUrl(url.href, transport, this.publicHosts) })
    return { url: url.href }
  }
}
