export class CookieJar {
  #cookies = new Map()

  setFromResponse(url, response) {
    const lines = response.headers.getSetCookie?.() ?? []
    for (const line of lines) this.#store(new URL(url), line)
  }

  importStorageState(state) {
    for (const c of state.cookies ?? []) {
      if (!c.name || c.value == null) continue
      this.#put({
        name: c.name,
        value: c.value,
        domain: String(c.domain ?? '').replace(/^\./, '').toLowerCase(),
        path: c.path ?? '/',
        expires: c.expires > 0 ? c.expires * 1000 : Infinity,
        secure: Boolean(c.secure),
        hostOnly: false,
      })
    }
  }

  headerFor(url) {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const now = Date.now()
    const matched = []
    for (const [key, c] of this.#cookies) {
      if (c.expires <= now) { this.#cookies.delete(key); continue }
      const domainOk = c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain)
      if (!domainOk) continue
      if (!u.pathname.startsWith(c.path)) continue
      if (c.secure && u.protocol !== 'https:') continue
      matched.push(c)
    }
    matched.sort((a, b) => b.path.length - a.path.length)
    return matched.map(c => `${c.name}=${c.value}`).join('; ')
  }

  #put(c) {
    this.#cookies.set(`${c.domain}|${c.path}|${c.name}`, c)
  }

  #store(u, line) {
    const [pair, ...attrs] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) return
    const c = {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: u.hostname.toLowerCase(),
      path: defaultPath(u.pathname),
      expires: Infinity,
      secure: false,
      hostOnly: true,
    }
    for (const attr of attrs) {
      const i = attr.indexOf('=')
      const k = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase()
      const v = i < 0 ? '' : attr.slice(i + 1).trim()
      if (k === 'domain' && v) { c.domain = v.replace(/^\./, '').toLowerCase(); c.hostOnly = false }
      else if (k === 'path') c.path = v || '/'
      else if (k === 'max-age') c.expires = Date.now() + Number(v) * 1000
      else if (k === 'expires') { const t = Date.parse(v); if (!Number.isNaN(t)) c.expires = t }
      else if (k === 'secure') c.secure = true
    }
    const key = `${c.domain}|${c.path}|${c.name}`
    if (c.expires <= Date.now()) this.#cookies.delete(key)
    else this.#cookies.set(key, c)
  }
}

function defaultPath(pathname) {
  const i = pathname.lastIndexOf('/')
  return i <= 0 ? '/' : pathname.slice(0, i + 1)
}