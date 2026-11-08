import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CampusBrowser, findBrowser, MISSING } from './browser.mjs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WIN_ENV = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }

/** 假的 reg query：https 交给 progId（记在 UserChoice 下），它的打开命令是 command。latest 给了就是 UserChoiceLatest 里记的那个。 */
const registry = (progId, command, latest) => (_command, args) => {
  if (args.includes('ProgId') && args[1].endsWith('\\UserChoiceLatest')) return latest ? `\r\n    ProgId    REG_SZ    ${latest}\r\n` : ''
  if (args.includes('ProgId') && args[1].endsWith('\\UserChoice')) return `\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    ${progId}\r\n`
  if (args.includes('ProgId')) return ''
  if (latest && args[1] === `HKCR\\${latest}\\shell\\open\\command`) return `\r\n    (默认)    REG_SZ    "${CHROME}" --single-argument %1\r\n`
  if (args[1] === `HKCR\\${progId}\\shell\\open\\command`) return `\r\nHKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command\r\n    (默认)    REG_SZ    ${command}\r\n`
  return ''
}

test('默认浏览器是 Chromium 内核的就用它，Firefox 这类不支持 CDP 的换成本机装着的 Edge', () => {
  const both = file => [EDGE, CHROME].includes(file)
  assert.deepEqual(findBrowser({ platform: 'win32', env: WIN_ENV, exists: both, run: registry('ChromeHTML', `"${CHROME}" --single-argument %1`) }),
    { kind: 'chrome', name: 'Chrome', path: CHROME, isDefault: true })
  assert.deepEqual(findBrowser({ platform: 'win32', env: WIN_ENV, exists: both, run: registry('MSEdgeHTM', `"${EDGE}" --single-argument %1`) }),
    { kind: 'edge', name: 'Edge', path: EDGE, isDefault: true })
  const firefox = registry('FirefoxURL-308046B0AF4A39CB', '"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"')
  assert.deepEqual(findBrowser({ platform: 'win32', env: WIN_ENV, exists: both, run: firefox }), { kind: 'edge', name: 'Edge', path: EDGE, isDefault: false })
  // 注册表里写的程序已经卸掉了，也照装着的找。
  assert.equal(findBrowser({ platform: 'win32', env: WIN_ENV, exists: file => file === EDGE, run: registry('ChromeHTML', `"${CHROME}" %1`) }).kind, 'edge')
  assert.equal(findBrowser({ platform: 'win32', env: WIN_ENV, exists: () => false, run: firefox }), undefined)
  // 新的 Windows 11 把用户改过的选择记在 UserChoiceLatest，UserChoice 还是旧的 Edge：以前者为准。
  assert.deepEqual(findBrowser({ platform: 'win32', env: WIN_ENV, exists: both, run: registry('MSEdgeHTM', `"${EDGE}" --single-argument %1`, 'ChromeHTML') }),
    { kind: 'chrome', name: 'Chrome', path: CHROME, isDefault: true })
})

test('macOS 看 LaunchServices 里 https 交给谁；没改过（Safari）时用装着的 Chrome', () => {
  const home = '/Users/me', chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  const handlers = list => () => JSON.stringify({ LSHandlers: list })
  const exists = file => [chrome, edge].includes(file)
  assert.deepEqual(findBrowser({ platform: 'darwin', env: { HOME: home }, exists, run: handlers([{ LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.microsoft.edgemac' }]) }),
    { kind: 'edge', name: 'Edge', path: edge, isDefault: true })
  assert.deepEqual(findBrowser({ platform: 'darwin', env: { HOME: home }, exists: file => file === chrome, run: handlers([{ LSHandlerURLScheme: 'mailto', LSHandlerRoleAll: 'com.apple.mail' }]) }),
    { kind: 'chrome', name: 'Chrome', path: chrome, isDefault: false })
})

test('没有能用的浏览器时不起任何进程，说清楚要装什么', async () => {
  let launched = false
  const browser = new CampusBrowser({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'campus-browser-')), find: () => undefined, launch: () => { launched = true } })
  assert.equal(browser.available(), false)
  await assert.rejects(browser.open('微信读书登录'), error => error.code === 'browser_missing' && error.message === MISSING)
  assert.equal(launched, false)
})

test('恢复认证保留父域和仅主机 cookie 的范围，导出再恢复不会改变范围', async () => {
  const browser = new CampusBrowser({ dir: os.tmpdir() }), sent = []
  const original = [
    { name: 'tgt', value: 'parent', domain: '.example.org', path: '/', secure: true },
    { name: 'sid', value: 'host', domain: 'login.example.org', path: '/cas', secure: true },
  ]
  browser.cdp = { async send(method, params) { sent.push({ method, params }); return method === 'Storage.getCookies' ? { cookies: original } : {} } }
  browser.windows.set('w', { alive: true, sessionId: 'page' })
  await browser.restoreAuth('w', [
    { name: 'tgt', value: 'parent', domain: 'example.org', path: '/', secure: true },
    { name: 'sid', value: 'host', url: 'https://login.example.org/cas', path: '/cas', secure: true },
  ])
  const first = sent.at(-1).params.cookies
  assert.equal(first[0].domain, '.example.org')
  assert.equal(first[1].domain, undefined)
  assert.equal(first[1].url, 'https://login.example.org/cas')
  await browser.restoreAuth('w', await browser.flushAuth('w'))
  assert.deepEqual(sent.at(-1).params.cookies, first)
  await browser.setUserAgent('w', 'session-agent')
  assert.deepEqual(sent.at(-1), { method: 'Emulation.setUserAgentOverride', params: { userAgent: 'session-agent' } })
})

test('给验证码模块的 webContents：事件按会话分给窗口，跨站的子框架列在 framesInSubtree 里，窗口被关掉时看得出来', async () => {
  const browser = new CampusBrowser({ dir: os.tmpdir(), find: () => undefined })
  const sent = []
  browser.cdp = { closed: false, async send(method, params, sessionId) { sent.push([method, sessionId]); return method === 'Runtime.evaluate' ? { result: { value: `${sessionId}:${params.expression}` } } : {} } }
  browser.windows.set('w', { id: 'w', sessionId: 'page', alive: true, url: 'about:blank', frames: new Map(), listeners: new Set() })
  const wc = browser.webContents('w'), seen = []
  wc.debugger.on('message', (_event, method, _params, sessionId) => seen.push([method, sessionId]))
  const template = 'https://captcha.gtimg.com/static/template/drag_ele.html'
  // 刚挂上时地址是空的，导航以后父会话收到 targetInfoChanged。
  browser.route({ method: 'Target.attachedToTarget', sessionId: 'page', params: { sessionId: 'frame', targetInfo: { type: 'iframe', url: '', targetId: 'F1' } } })
  browser.route({ method: 'Target.targetInfoChanged', sessionId: 'page', params: { targetInfo: { type: 'iframe', url: template, targetId: 'F1' } } })
  browser.route({ method: 'Network.responseReceived', sessionId: 'frame', params: {} })
  browser.route({ method: 'Network.responseReceived', sessionId: 'someone-else', params: {} })
  assert.deepEqual(seen, [['Target.attachedToTarget', ''], ['Target.targetInfoChanged', ''], ['Network.responseReceived', 'frame']])
  const frame = wc.mainFrame.framesInSubtree.find(item => item.url === template)
  assert.equal(await frame.executeJavaScript('1'), 'frame:1')
  assert.equal(await wc.executeJavaScript('2'), 'page:2')
  await wc.debugger.sendCommand('Network.enable')
  await wc.debugger.sendCommand('Network.getResponseBody', { requestId: '1' }, 'frame')
  assert.deepEqual(sent.slice(-2), [['Network.enable', 'page'], ['Network.getResponseBody', 'frame']])
  // 子框架的页面换了地址，列出来的也跟着换；断开以后不再列。
  browser.route({ method: 'Page.frameNavigated', sessionId: 'frame', params: { frame: { id: 'F1', parentId: 'P', url: `${template}?b=1` } } })
  browser.route({ method: 'Page.frameNavigated', sessionId: 'frame', params: { frame: { id: 'F2', parentId: 'F1', url: 'https://ads.example/' } } })
  assert.ok(wc.mainFrame.framesInSubtree.some(item => item.url === `${template}?b=1`))
  browser.route({ method: 'Target.detachedFromTarget', sessionId: 'page', params: { sessionId: 'frame' } })
  assert.equal(wc.mainFrame.framesInSubtree.length, 1)
  assert.equal(wc.isDestroyed(), false)
  browser.route({ method: 'Target.detachedFromTarget', params: { sessionId: 'page' } })
  assert.equal(wc.isDestroyed(), true)
  assert.equal(browser.exists('w'), false)
})
