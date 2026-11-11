import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dataDir, SkillError, type VisionConfig } from '../config.ts'

export interface BrowserRuntime {
  /** 带着登录会话请求 weread.qq.com。 */
  request(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }>
  /** 在真实页面中加载文章链接，按需调用站点验证码处理，再返回 HTML。 */
  article(url: string, vision?: VisionConfig): Promise<string>
  cookie(name: string): Promise<string | undefined>
  login(): Promise<{ verified: boolean }>
  solve(vision?: VisionConfig): Promise<{ ticket: string; randstr: string }>
  /** 清掉浏览器里的登录状态。 */
  logout(): Promise<void>
  close(): Promise<void>
}

let browser: BrowserRuntime | undefined
/** 被应用托管时（WEREAD_BROWSER_ENDPOINT）用应用提供的浏览器，否则启动 Skill 自带的 Electron。 */
export const getBrowser = async () => browser ??= await (process.env.WEREAD_BROWSER_ENDPOINT ? connectBrowser(process.env.WEREAD_BROWSER_ENDPOINT) : openBrowser())
export async function closeBrowser() { await browser?.close(); browser = undefined }
/** 测试用：替换整个浏览器边界。 */
export function setBrowser(next?: BrowserRuntime) { browser = next }

/**
 * 一条连接上的调用：一行一条 JSON，按 id 对回结果（另一头是 service.cjs 的 serve）。
 * WEREAD_INTERACTIVE=0 表示这次命令没有人在场：要扫码或要验证时不开窗口，直接报 login_required、verification_required。
 */
function channel(socket: net.Socket, onEvent: (message: any) => void = () => {}) {
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const interactive = process.env.WEREAD_INTERACTIVE !== '0'
  let sequence = 0
  createInterface({ input: socket }).on('line', line => {
    const message = JSON.parse(line)
    if (message.event) return onEvent(message)
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) call?.reject(new SkillError(message.error.code, message.error.message, message.error.details))
    else call?.resolve(message.result)
  })
  const call = (action: string, input?: unknown): Promise<any> => new Promise((resolve, reject) => {
    if (socket.destroyed) return reject(new SkillError('browser_closed', '浏览器已退出。'))
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.write(JSON.stringify({ id, action, input, interactive }) + '\n')
  })
  /** 连接没了：还在等结果的调用全部以这个错误结束。 */
  const fail = (error: Error) => { for (const waiting of pending.values()) waiting.reject(error); pending.clear() }
  const runtime = (close: () => Promise<void>): BrowserRuntime => ({
    request: (url, options) => call('request', { url, ...options }),
    article: (url, vision) => call('article', { url, vision }),
    cookie: name => call('cookie', name),
    login: () => call('login'),
    solve: vision => call('captcha', { vision }),
    logout: () => call('logout'),
    close,
  })
  return { call, fail, runtime }
}

/** 连到宿主应用开的管道上。窗口、会话和识别模型都归宿主管，命令结束时只断开连接。 */
export async function connectBrowser(endpoint: string): Promise<BrowserRuntime> {
  const socket = net.connect(endpoint)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', () => reject(new SkillError('browser_start_failed', '连不上宿主应用提供的浏览器，请确认应用正在运行。')))
  })
  const { fail, runtime } = channel(socket)
  socket.on('error', () => {})
  socket.on('close', () => fail(new SkillError('browser_closed', '和宿主应用的连接已断开。')))
  return runtime(async () => { socket.destroy() })
}

/** 启动 Skill 自带的 Electron（host.cjs）。登录状态保存在 profile 目录，凭据只经过这条私有管道。 */
export async function openBrowser(profile = path.join(dataDir, 'browser')): Promise<BrowserRuntime> {
  let executable: string
  try { executable = createRequire(import.meta.url)('electron') }
  catch { throw new SkillError('browser_missing', '请先在 Skill 目录执行 npm install，安装自带的 Electron。') }
  fs.mkdirSync(profile, { recursive: true })
  // Electron 是 GUI 程序，标准流不可靠，所以用命名管道通信。
  const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\weread-' + randomUUID() : path.join(os.tmpdir(), 'weread-' + randomUUID() + '.sock')
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
  // 只传运行所需的环境变量，.env 里的密钥不进浏览器进程。
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PATH', 'LANG', 'HOME', 'DISPLAY'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const child = spawn(executable, [fileURLToPath(new URL('./host.cjs', import.meta.url)), endpoint, path.resolve(profile)], { env, stdio: 'ignore' })
  let link: ReturnType<typeof channel> | undefined, socket: net.Socket | undefined
  const exited = new Promise<void>(resolve => child.once('exit', () => {
    server.close(); socket?.destroy()
    link?.fail(new SkillError('browser_closed', 'Electron 意外退出。'))
    resolve()
  }))
  const ready = new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(new SkillError('browser_start_failed', 'Electron 没有在 20 秒内启动。')), 20000).unref()
    child.once('error', () => reject(new SkillError('browser_start_failed', '无法启动自带的 Electron。')))
    child.once('exit', () => reject(new SkillError('browser_start_failed', 'Electron 启动后立即退出。')))
    server.once('connection', connection => {
      socket = connection; server.close()
      link = channel(connection, message => {
        if (message.event === 'ready') resolve()
        else if (message.event === 'fatal') reject(new SkillError(message.code, message.message))
      })
    })
  })
  try { await ready } catch (error) { child.kill(); server.close(); throw error }
  return link!.runtime(async () => {
    link!.call('close').catch(() => {})
    const kill = setTimeout(() => child.kill(), 5000)
    await exited
    clearTimeout(kill)
  })
}
