/**
 * `@lybx-leyw/dsh-zju-yonkik-tool`
 *
 * YONKIK 运行时半边，三件事：
 *   1. 设置路由 /_dsh/yonkik：把凭据表 + 站点清单存进宿主加密凭据服务（grant 记录，
 *      DPAPI 加密、值不回显），站点清单同步到本地 sites/_index.json（非敏感）。
 *   2. 读工具 `yonkik`：执行时从加密记录读凭据，经 env 注入子脚本（不落明文盘）。
 *   3. 驱动 scripts/ 下的只读侦察脚本（以本包根为 cwd）。
 *
 * 凭据桥接：at_rest 在宿主加密服务，at_runtime 经 YONKIK_CREDENTIALS env 进子进程内存；
 * lib/credentials.mjs 优先读 env，无 env 时退回本地文件（手动跑脚本用）。
 * 方法论见兄弟包 yonkik-skill。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MASK, ROUTE_PATH, WRITE_HEADER } from './shared.js'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// AI 记忆区：稳定根，与工作目录解耦。脚本经 YONKIK_HOME 读写这里的知识（~/.yonkik）。
const MEMORY_ROOT = path.resolve(process.env.YONKIK_HOME || path.join(os.homedir(), '.yonkik'))
const SCRIPTS = ['init', 'intake', 'login', 'triage', 'probe', 'recon', 'credcheck', 'put', 'run']
const CONFIG_KEY = 'yonkik/config'
// 工作台 source/login 管理的加密记录；YONKIK 只读复用。
const WORKBENCH_CREDENTIALS = {
  'campus-sso': { recordKey: 'zw-classroom/account', label: '浙大一卡通（来自工作台「浙大统一身份认证」，在工作台设置里修改）' },
  webvpn: { recordKey: 'zw-campus/webvpn', label: 'WebVPN 上网账号（在工作台设置里修改）' },
}

export const name = 'zw-yonkik-tool'
export const inject = ['tools', 'credentials']

function credsOf(ctx) {
  try {
    const s = ctx.get('credentials') ?? ctx.credentials
    if (s && typeof s.readRecord === 'function' && typeof s.modifyRecord === 'function') return s
    return null
  } catch { return null }
}

async function readConfig(ctx) {
  const s = credsOf(ctx)
  const empty = { credentials: {}, sites: [] }
  if (!s) return empty
  try {
    const r = await s.readRecord(CONFIG_KEY)
    if (r && r.kind === 'grant') return { credentials: {}, sites: [], ...(r.payload ?? {}) }
    return empty
  } catch { return empty }
}

async function readWorkbenchCredential(service, { recordKey, label }) {
  try {
    const record = await service.readRecord(recordKey)
    if (record?.kind !== 'grant') return null
    const { username, password } = record.payload ?? {}
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) return null
    return { 描述: label, 键一: username, 键二: password }
  } catch { return null }
}

// 仅在运行期合并；不回写 YONKIK 配置。显式配置的同名键优先。
async function resolveCredentials(ctx, cfg) {
  const credentials = { ...(cfg.credentials ?? {}) }
  const configured = new Set()
  const bridged = new Set()
  const service = credsOf(ctx)
  if (!service) return { credentials, configured, bridged }
  const entries = Object.entries(WORKBENCH_CREDENTIALS)
  const values = await Promise.all(entries.map(([, source]) => readWorkbenchCredential(service, source)))
  for (const [i, [key]] of entries.entries()) {
    if (!values[i]) continue
    configured.add(key)
    if (credentials[key]) continue
    credentials[key] = values[i]
    bridged.add(key)
  }
  return { credentials, configured, bridged }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

function readJsonBody(req) {
  return new Promise(resolve => {
    let d = ''
    req.on('data', c => { d += c })
    req.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

function writeSitesIndex(sites) {
  const dir = path.join(MEMORY_ROOT, 'sites')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '_index.json')
  let index = { sites: {} }
  try { index = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* 新建 */ }
  index.sites ??= {}
  for (const u of sites) {
    try {
      const h = new URL(u).hostname
      index.sites[h] ??= { status: 'pending', origin: u, requires: [], signals: {} }
    } catch { /* 跳过非法 URL */ }
  }
  fs.writeFileSync(file, JSON.stringify(index, null, 2) + '\n')
}

// 启动时把默认网站集（default-sites.json，来自 zjuers.com 的 98 站）并入 _index.json。
// 只补缺失节点，不覆盖已探索/已存在的节点；种子缺失或损坏都不阻断启动。
function seedDefaultSites() {
  try {
    const dir = path.join(MEMORY_ROOT, 'sites')
    fs.mkdirSync(dir, { recursive: true })
    // 种子优先用记忆区里的；没有则从包内 committed 种子复制一份过去。
    let seedFile = path.join(dir, 'default-sites.json')
    if (!fs.existsSync(seedFile)) {
      const pkgSeed = path.join(PKG, 'sites', 'default-sites.json')
      if (fs.existsSync(pkgSeed)) { fs.copyFileSync(pkgSeed, seedFile) } else return
    }
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
    const file = path.join(dir, '_index.json')
    let index = { sites: {} }
    try { index = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* 新建 */ }
    index.sites ??= {}
    for (const [h, v] of Object.entries(seed.sites ?? {})) {
      index.sites[h] ??= { status: 'pending', origin: v.origin, requires: [], signals: { source: v.source ?? 'default', label: v.label } }
    }
    fs.writeFileSync(file, JSON.stringify(index, null, 2) + '\n')
  } catch { /* 种子失败不阻断 */ }
}

function readTextSafe(p) { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
function listScriptsSafe(p) { try { return fs.readdirSync(p).filter(f => f.endsWith('.mjs')).sort() } catch { return [] } }

// 知识库只读路由：serve 记忆区的索引/wiki/接口/playbook/sso/脚本清单。
// **绝不 serve 凭据值或 state.json**；site.json 仅配置（无用户密钥）。
function createWikiHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const siteKey = url.searchParams.get('site')
    const sitesDir = path.join(MEMORY_ROOT, 'sites')
    if (siteKey) {
      const dir = path.join(sitesDir, siteKey)
      sendJson(res, 200, {
        key: siteKey,
        wiki: readTextSafe(path.join(dir, 'wiki.md')),
        endpoints: readJsonSafe(path.join(dir, 'endpoints.json')),
        site: readJsonSafe(path.join(dir, 'site.json')),
        scenarios: readTextSafe(path.join(dir, 'question-scenarios.md')),
        reconScripts: listScriptsSafe(path.join(dir, 'recon')),
        hasCrawler: fs.existsSync(path.join(dir, 'crawler.mjs')),
      })
      return
    }
    sendJson(res, 200, {
      root: MEMORY_ROOT,
      memory: readTextSafe(path.join(MEMORY_ROOT, 'MEMORY.md')),
      index: readJsonSafe(path.join(sitesDir, '_index.json')) ?? { sites: {} },
      playbook: readTextSafe(path.join(sitesDir, '_playbook.md')),
      sso: readJsonSafe(path.join(sitesDir, '_sso.json')),
      scripts: listScriptsSafe(path.join(MEMORY_ROOT, 'scripts')),
    })
  }
}

// 自检只报告凭据键名及存在性，不返回账号和密码。
function createCredCheckHandler(ctx) {
  return async (req, res) => {
    const { credentials, configured, bridged } = await resolveCredentials(ctx, await readConfig(ctx))
    const report = Object.fromEntries(Object.entries(credentials).map(([key, value]) => {
      const keys = Object.keys(value).filter(name => name !== '描述')
      return [key, { 描述: value.描述 ?? '', keys, hasValue: keys.length > 0 && keys.every(name => !!value[name]) }]
    }))
    sendJson(res, 200, { yonkikHome: MEMORY_ROOT, campusSsoBridged: configured.has('campus-sso'), webvpnBridged: bridged.has('webvpn'), credentials: report })
  }
}

function createHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const action = url.searchParams.get('action') ?? ''
    if (req.method === 'GET') {
      const cfg = await readConfig(ctx)
      const { credentials: effective, bridged } = await resolveCredentials(ctx, cfg)
      const credentials = Object.entries(effective).map(([key, v]) => ({
        key,
        描述: v.描述 ?? '',
        ...(bridged.has(key) ? { fromWorkbench: true } : {}),
        keys: Object.keys(v).filter(k => k !== '描述' && k !== 'fromWorkbench').map(name => ({ name, hasValue: !!v[name] })),
      }))
      sendJson(res, 200, { configured: credentials.length > 0, credentials, sites: cfg.sites ?? [] })
      return
    }
    if (req.method !== 'POST') { sendJson(res, 405, { error: '只支持 GET / POST' }); return }
    if (String(req.headers[WRITE_HEADER] ?? '') !== '1') { sendJson(res, 403, { error: `缺少 ${WRITE_HEADER} 头` }); return }
    const s = credsOf(ctx)
    if (action === 'clear') {
      if (s && typeof s.deleteRecord === 'function') await s.deleteRecord(CONFIG_KEY)
      sendJson(res, 200, { ok: true })
      return
    }
    const body = await readJsonBody(req)
    if (!body) { sendJson(res, 400, { error: '请求体不是合法 JSON' }); return }
    const existing = await readConfig(ctx)
    const credentials = {}
    for (const [key, v] of Object.entries(body.credentials ?? {})) {
      if (!key) continue
      const prev = existing.credentials?.[key] ?? {}
      const merged = { 描述: v.描述 ?? prev.描述 ?? '' }
      for (const [k, val] of Object.entries(v)) {
        if (k === '描述') continue
        merged[k] = val === MASK ? (prev[k] ?? '') : val
      }
      credentials[key] = merged
    }
    const sites = Array.isArray(body.sites) ? body.sites : (existing.sites ?? [])
    if (s) await s.modifyRecord(CONFIG_KEY, () => ({ kind: 'grant', payload: { credentials, sites } }))
    try { writeSitesIndex(sites) } catch { /* 站点同步失败不阻断凭据保存 */ }
    sendJson(res, 200, { ok: true })
  }
}

function spawnNode(scriptPath, args, signal, extraEnv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: cwd ?? MEMORY_ROOT,
      env: { ...process.env, YONKIK_HOME: MEMORY_ROOT, ...extraEnv },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    // 用 close 而非 exit：保证 stdout/stderr 读完后才回传，避免大输出被截断。
    child.on('error', e => resolve({ code: 1, stdout, stderr: stderr + e.message }))
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
    if (signal) signal.addEventListener('abort', () => child.kill(), { once: true })
  })
}

function runScript(script, args, signal, extraEnv) {
  if (!SCRIPTS.includes(script)) {
    return Promise.resolve({ code: 1, stdout: '', stderr: `未知脚本 ${script}（可用：${SCRIPTS.join(', ')}）` })
  }
  return spawnNode(path.join(PKG, 'scripts', `${script}.mjs`), args, signal, extraEnv, PKG)
}

// 路径守卫：只允许记忆根内的相对路径，防越界写/跑。
function resolveInMemory(rel) {
  const target = path.resolve(MEMORY_ROOT, rel ?? '')
  if (target !== MEMORY_ROOT && !target.startsWith(MEMORY_ROOT + path.sep)) return null
  return target
}

// put：把模型自写的脚本落盘到记忆根（如 sites/<key>/login.mjs）。
// 任何失败都返回结构化错误（error/stderr 同文），不要抛给调用方。
function putScript(rel, content) {
  const fail = message => ({ ok: false, error: message, stderr: message })
  if (typeof rel !== 'string' || !rel.trim()) return fail('缺少脚本路径：args=[相对路径, 脚本内容]')
  if (typeof content !== 'string') return fail('缺少脚本内容：args=[相对路径, 脚本内容]')
  const target = resolveInMemory(rel)
  if (!target) return fail('路径越界：只能写记忆根内')
  if (target === MEMORY_ROOT) return fail('路径不能是记忆根目录本身，请给出文件名')
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return { ok: true, written: rel }
  } catch (error) {
    return fail(`写入失败：${error?.code ?? error?.message ?? String(error)}`)
  }
}

// run：运行记忆根内模型自写的脚本（注入凭据、宿主进程外沙箱，可起浏览器）。
function runCustomScript(rel, args, signal, extraEnv) {
  const target = resolveInMemory(rel)
  if (typeof rel !== 'string' || !rel.trim()) {
    const message = '缺少脚本路径：args=[相对路径, ...参数]'
    return Promise.resolve({ code: 1, stdout: '', stderr: message, error: message })
  }
  if (!target) {
    const message = '路径越界：只能跑记忆根内脚本'
    return Promise.resolve({ code: 1, stdout: '', stderr: message, error: message })
  }
  if (!fs.existsSync(target)) {
    const message = `脚本不存在：${rel}（先用 put 写入）`
    return Promise.resolve({ code: 1, stdout: '', stderr: message, error: message })
  }
  return spawnNode(target, args, signal, extraEnv, path.dirname(target))
}

export function apply(ctx) {
  console.info('[yonkik-tool] apply：tools =', !!ctx.tools, 'credentials =', !!credsOf(ctx))
  seedDefaultSites()

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: createHandler(ctx) })
      const disposeWiki = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH + '/wiki', handler: createWikiHandler() })
      const disposeCred = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH + '/credcheck', handler: createCredCheckHandler(ctx) })
      console.info('[yonkik-tool] 设置路由：' + ROUTE_PATH + '｜知识库路由：' + ROUTE_PATH + '/wiki｜凭据自检：' + ROUTE_PATH + '/credcheck')
      return () => { dispose?.(); disposeWiki?.(); disposeCred?.() }
    }, 'yonkik: credential route')
  })

  ctx.effect(() => ctx.tools.register({
    name: 'yonkik',
    description: 'YONKIK 只读侦察工具。script ∈ {init,intake,login,triage,probe,recon,credcheck,put,run}。'
      + 'init: 记忆区为空时用内置初始记忆铺底（幂等；已有记忆不覆盖，除非 args 含 --force）。'
      + 'put: args=[相对路径, 脚本内容] 把自写脚本落盘记忆根；run: args=[相对路径, ...参数] 运行记忆根内自写脚本'
      + '（注入凭据、宿主进程外沙箱、可起浏览器）——CAS 等登录脚本由你自写后经 put+run 执行。'
      + '其余为固定脚本。凭据经 env 注入，勿在参数传明文密钥。只读侦察；提交/修改/删除等写操作不做。',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', enum: SCRIPTS },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['script'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec = {}) {
      const a = args.args ?? []
      const action = `yonkik:${args.script}`
      try {
        if (args.script === 'put') {
          const r = putScript(a[0], a[1])
          return { ok: r.ok, action, ...(r.ok ? {} : { error: r.error }), result: r }
        }
        const { credentials } = await resolveCredentials(ctx, await readConfig(ctx))
        const extraEnv = { YONKIK_CREDENTIALS: JSON.stringify(credentials) }
        if (args.script === 'run') {
          const result = await runCustomScript(a[0], a.slice(1), exec.signal, extraEnv)
          return { ok: result.code === 0, action, result }
        }
        const result = await runScript(args.script, a, exec.signal, extraEnv)
        return { ok: result.code === 0, action, result }
      } catch (error) {
        // 兜底：工具自身异常也转成结构化失败，别让调用直接崩。
        const message = `yonkik 执行失败：${error?.message ?? String(error)}`
        return { ok: false, action, error: message, result: { code: 1, stdout: '', stderr: message } }
      }
    },
  }))
  console.info('[yonkik-tool] yonkik 读工具已注册')
}