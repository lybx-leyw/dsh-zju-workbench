#!/usr/bin/env node
// 生态雷达 · 候选骨架「锁版依赖」一致性检查
//
// 背景：截至 r80（2026-10-27）雷达已登记 1,524 行候选、生成 67 个 dsh-radar-* 骨架，
// 其中 49 个骨架在 dependencies 里「锁版引入上游」。但这些锁版**从未被安装过**
// （npm ci 长期卡在 L-15），因此「写了一个 npm 上不存在的包」这类错误无人发现。
//
// 本脚本只做**静态 + 注册表**两层检查，不需要安装，可在 CI 里跑：
//   1. 结构层  package.json 可解析；dependencies 的版本必须是**精确版本**（不允许 ^ ~ >= 等范围）
//   2. 存在层  每个 (name, version) 在 npm registry 上真的存在
//   3. 新鲜层  锁版是否落后于 dist-tags.latest（只报告，不失败）
//   4. 声明层  骨架 README 是否含「未评审 / 未接入」声明（候选骨架的前置约束）
//   5. 共存层  两个骨架的上游包对**同一宿主包**（@deepseek-ai/dsh-*）要求的 peer 区间是否相交。
//              不相交 = 这两个骨架永远不可能同时接入同一个 profile（npm 安装时必 ERESOLVE）。
//
// 用法：
//   node scripts/radar-baseline-check.mjs                # 全量，需要联网
//   node scripts/radar-baseline-check.mjs --offline      # 只跑结构层与声明层
//   node scripts/radar-baseline-check.mjs --json         # 机器可读
//   node scripts/radar-baseline-check.mjs --coexist      # 只跑共存层（联网）
//
// 退出码：0 = 无 error；1 = 有 error（CI 应当失败）

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PKG_GLOB_PREFIX = 'dsh-radar-'
const REGISTRY = process.env.RADAR_NPM_REGISTRY || 'https://registry.npmjs.org/'
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const flags = new Set(process.argv.slice(2))
const offline = flags.has('--offline')
const asJson = flags.has('--json')

/**
 * 读取所有候选骨架的 package.json
 *
 * 扫描位置：`packages/` 与 `packages/radar/`。雷达骨架自 2026-10-28 起统一收进
 * `packages/radar/`（`packages/` 根不得有平铺雷达包），但历史上曾在根。
 * 只扫根会让本脚本在面对「0 骨架」时**静默通过**——这种假阳性比报错更危险，
 * 故两个位置都扫，根下的平铺骨架额外记一条 error。
 */
export async function listSkeletons(root = ROOT) {
  const roots = [path.join(root, 'packages'), path.join(root, 'packages', 'radar')]
  const out = []
  for (const [index, dir] of roots.entries()) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith(PKG_GLOB_PREFIX)) continue
      // index === 0 即包直接位于 packages/ 根下 → 违反「雷达包必须进 packages/radar/」
      const misplaced = index === 0
      const dirName = misplaced ? e.name : path.join('radar', e.name)
      const pkgPath = path.join(dir, e.name, 'package.json')
      let pkg
      try {
        pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      } catch (err) {
        out.push({
          name: e.name,
          dir: dirName,
          misplaced,
          error: `package.json 不可解析：${err.message}`,
        })
        continue
      }
      const readme = await readFile(path.join(dir, e.name, 'README.md'), 'utf8').catch(() => '')
      out.push({ name: e.name, dir: dirName, misplaced, pkg, readme })
    }
  }
  return out
}

/** 结构层 + 声明层：不联网 */
export function checkStatic(skeletons) {
  const findings = []
  for (const s of skeletons) {
    if (s.error) {
      findings.push({ level: 'error', code: 'PKG_INVALID', package: s.name, message: s.error })
      continue
    }
    if (s.misplaced) {
      findings.push({
        level: 'error',
        code: 'MISPLACED_PACKAGE',
        package: s.name,
        message: '雷达骨架必须放在 packages/radar/ 下，packages/ 根不得平铺 dsh-radar-*',
      })
    }
    for (const [dep, spec] of Object.entries(s.pkg.dependencies || {})) {
      if (!EXACT.test(spec)) {
        findings.push({
          level: 'error',
          code: 'NOT_PINNED',
          package: s.name,
          message: `依赖 ${dep}@${spec} 不是精确版本（候选骨架要求锁版，禁 ^ ~ >= * 与 tag）`,
        })
      }
    }
    // 候选骨架的前置约束：README 首屏必须声明未评审 / 未接入
    const head = (s.readme || '').slice(0, 1200)
    if (!/未评审/.test(head) || !/未接入/.test(head)) {
      findings.push({
        level: 'warn',
        code: 'MISSING_DISCLAIMER',
        package: s.name,
        message: 'README 首屏缺少「未评审 / 未接入」声明',
      })
    }
  }
  return findings
}

/** 存在层 + 新鲜层：查 registry（带 3 次重试） */
export async function checkRegistry(skeletons, { registry = REGISTRY, timeoutMs = 20000 } = {}) {
  const findings = []
  const cache = new Map()
  const names = new Set()
  for (const s of skeletons) {
    for (const dep of Object.keys(s.pkg?.dependencies || {})) names.add(dep)
  }

  for (const name of names) {
    const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}`
    let meta = null
    let lastErr = ''
    for (let attempt = 0; attempt < 3 && !meta; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (res.status === 404) { meta = {}; break } // 明确不存在
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
        meta = await res.json()
      } catch (err) {
        lastErr = err.message
      }
    }
    cache.set(name, meta === null ? { unknown: lastErr || 'fetch failed' } : meta)
  }

  for (const s of skeletons) {
    for (const [dep, spec] of Object.entries(s.pkg?.dependencies || {})) {
      const meta = cache.get(dep)
      if (!meta) continue
      if (meta.unknown) {
        findings.push({ level: 'warn', code: 'REGISTRY_UNKNOWN', package: s.name, message: `${dep}@${spec}：registry 查询失败（${meta.unknown}），本轮未判定` })
        continue
      }
      if (!meta.versions) {
        findings.push({ level: 'error', code: 'DEP_MISSING', package: s.name, message: `依赖 ${dep}@${spec} 在 npm 上不存在（404）—— 该骨架无法安装` })
        continue
      }
      if (!meta.versions[spec]) {
        findings.push({ level: 'error', code: 'VERSION_MISSING', package: s.name, message: `依赖 ${dep}@${spec} 不存在（可用 latest=${meta['dist-tags']?.latest ?? '?'}）` })
        continue
      }
      const latest = meta['dist-tags']?.latest
      if (latest && latest !== spec) {
        findings.push({ level: 'info', code: 'STALE_PIN', package: s.name, message: `${dep} 锁 ${spec}，latest=${latest}` })
      }
    }
  }
  return findings
}

/** 极简 semver 区间解析（只覆盖雷达里实际出现的写法）：
 *  精确 / ^x.y.z / ~x.y.z / >=a <b（空格即 AND）/ a || b（OR）
 *  返回区间数组 [[lo, hi), ...]；无法判定返回 null（不上报，避免误报）。
 *
 *  语义约定（与 npm 一致的部分）：
 *    ^0.1.2  → [0.1.2, 0.2.0)     ^0.2.3 → [0.2.3, 0.3.0)     ^1.2.3 → [1.2.3, 2.0.0)
 *    ~0.1.2  → [0.1.2, 0.2.0)
 *  预发布后缀（-rc.N）不参与比较——雷达只关心「哪一代」，不关心 rc 序号。
 */
export function peerBand(spec) {
  if (!spec || typeof spec !== 'string') return null
  const out = []
  for (const alt of spec.split('||').map((s) => s.trim()).filter(Boolean)) {
    let lo = null, hi = null
    for (const token of alt.split(/\s+/).filter(Boolean)) {
      const m = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(token)
      // 任一分支不可解析 ⇒ 整体不可判定。绝不「丢掉这一支继续算」：
      // 那会把范围悄悄收窄，让本应「未知」的判定变成「不相交」的误报。
      if (!m) return null
      const op = m[1] || '='
      const v = [Number(m[2]), Number(m[3]), Number(m[4])]
      if (op === '=') { lo = v; hi = [v[0], v[1], v[2] + 1] }
      else if (op === '^') {
        lo = v
        hi = v[0] === 0 ? [0, v[1] + 1, 0] : [v[0] + 1, 0, 0]
      } else if (op === '~') { lo = v; hi = [v[0], v[1] + 1, 0] }
      else if (op === '>=') lo = v
      else if (op === '>') lo = [v[0], v[1], v[2] + 1]
      else if (op === '<') hi = v
      else if (op === '<=') hi = [v[0], v[1], v[2] + 1]
    }
    out.push([lo || [0, 0, 0], hi || [Infinity, 0, 0]])
  }
  return out.length ? out : null
}

const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]

/** "scope/name@1.2.3" 或 "name@1.2.3" → 包名（不含版本）。
 *  不能用 split('@')[0]：scoped 包会切出空串。 */
export function pkgName(spec) {
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

/** 两个 peer 区间是否有交集 */
export function bandsOverlap(a, b) {
  if (!a || !b) return null
  for (const [alo, ahi] of a) {
    for (const [blo, bhi] of b) {
      if (cmp(alo, bhi) < 0 && cmp(blo, ahi) < 0) return true
    }
  }
  return false
}

/** 共存层：找出「永远不能同时接入同一 profile」的骨架对 */
export async function checkCoexist(skeletons, { registry = REGISTRY, timeoutMs = 20000 } = {}) {
  const findings = []
  const cache = new Map()
  const fetchMeta = async (name, spec) => {
    const key = `${name}@${spec}`
    if (cache.has(key)) return cache.get(key)
    let meta = null
    for (let i = 0; i < 3 && meta === null; i++) {
      try {
        const res = await fetch(`${registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}/${spec}`, { signal: AbortSignal.timeout(timeoutMs) })
        if (res.status === 404) { meta = {}; break }
        if (res.ok) meta = await res.json()
      } catch { /* 重试 */ }
    }
    const peers = meta?.peerDependencies || {}
    cache.set(key, peers)
    return peers
  }

  const hosts = []
  for (const s of skeletons) {
    for (const [dep, spec] of Object.entries(s.pkg?.dependencies || {})) {
      const peers = await fetchMeta(dep, spec)
      const dsh = Object.entries(peers).filter(([k]) => k.startsWith('@deepseek-ai/'))
      if (dsh.length) hosts.push({ skeleton: s.name, dep, spec, peers: Object.fromEntries(dsh) })
    }
  }

  for (let i = 0; i < hosts.length; i++) {
    for (let j = i + 1; j < hosts.length; j++) {
      const A = hosts[i], B = hosts[j]
      const shared = Object.keys(A.peers).filter((k) => k in B.peers)
      const clashes = []
      for (const k of shared) {
        const ov = bandsOverlap(peerBand(A.peers[k]), peerBand(B.peers[k]))
        if (ov === false) clashes.push(`${k}: ${A.peers[k]} ⟂ ${B.peers[k]}`)
      }
      if (clashes.length) {
        findings.push({
          level: 'warn',
          code: 'HOST_GENERATION_CLASH',
          package: `${A.skeleton} × ${B.skeleton}`,
          message: `两者对同一宿主包的 peer 区间不相交，不可能并入同一 profile：${clashes.slice(0, 3).join('；')}${clashes.length > 3 ? ` …（共 ${clashes.length} 个宿主包）` : ''}`,
        })
      }
    }
  }
  return findings
}

/** 实测层（--holdout）：对「带 @deepseek-ai/* peer 的骨架」两两做 npm --dry-run，
 *  用真实解析器判定能不能装进同一棵树。
 *
 *  为什么单靠 §共存层 不够：区间相交只说明"存在一个共同版本"，但 npm 还要在**同一棵依赖树**
 *  里同时满足 client 侧与宿主侧的传递 peer（例如 client-locale ^0.1.0-rc.8 与 ui-layout
 *  ^0.1.0-rc.6 不能共存），这类冲突只有真解析器看得见。
 */
export async function checkHoldout(skeletons, { cwd = '/tmp/radar-holdout', timeoutMs = 120000 } = {}) {
  const { execFile } = await import('node:child_process')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const os = await import('node:os')
  const findings = []
  const withHost = []
  if (withHost.length === 0) {
    // 先用静态信息筛：依赖已在 coexist 层取过 peer，这里重新取一次以保持函数自包含
    for (const s of skeletons) {
      for (const [dep, spec] of Object.entries(s.pkg?.dependencies || {})) {
        let peers = {}
        try {
          const res = await fetch(`${REGISTRY.replace(/\/$/, '')}/${dep.replace('/', '%2f')}/${spec}`, { signal: AbortSignal.timeout(20000) })
          if (res.ok) peers = (await res.json()).peerDependencies || {}
        } catch { /* 跳过 */ }
        if (Object.keys(peers).some((k) => k.startsWith('@deepseek-ai/'))) withHost.push(`${dep}@${spec}`)
      }
    }
  }
  const base = await mkdtemp(os.tmpdir() + '/radar-holdout-')
  const run = (items) => new Promise((resolve) => {
    execFile('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--dry-run', ...items],
      { cwd: base, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 }, (err) => resolve(!err))
  })
  try {
    await writeFile(`${base}/package.json`, '{"name":"holdout","private":true}')
    for (let i = 0; i < withHost.length; i++) {
      for (let j = i + 1; j < withHost.length; j++) {
        const okk = await run([withHost[i], withHost[j]])
        if (!okk) {
          findings.push({
            level: 'warn',
            code: 'HOLDOUT_CLASH',
            package: pkgName(withHost[i]) + ' × ' + pkgName(withHost[j]),
            message: `npm 实测（--dry-run）二者无法装进同一棵树：${withHost[i]} × ${withHost[j]}`,
          })
        }
      }
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
  return findings
}

async function main() {
  const skeletons = await listSkeletons()
  const coexistOnly = flags.has('--coexist')
  const holdout = flags.has('--holdout')
  let findings = coexistOnly || holdout ? [] : checkStatic(skeletons)
  if (holdout) findings = findings.concat(await checkHoldout(skeletons))
  else if (!offline && coexistOnly) findings = findings.concat(await checkCoexist(skeletons))
  else if (!offline) findings = findings.concat(await checkRegistry(skeletons)).concat(await checkCoexist(skeletons))

  const count = (lvl) => findings.filter((f) => f.level === lvl).length
  const summary = {
    skeletons: skeletons.length,
    pinnedDeps: skeletons.reduce((n, s) => n + Object.keys(s.pkg?.dependencies || {}).length, 0),
    error: count('error'),
    warn: count('warn'),
    info: count('info'),
    offline,
  }

  if (asJson) {
    console.log(JSON.stringify({ summary, findings }, null, 2))
  } else {
    for (const f of findings.filter((x) => x.level !== 'info')) {
      console.log(`${f.level === 'error' ? '✗' : '⚠'} [${f.code}] ${f.package}: ${f.message}`)
    }
    const stale = findings.filter((x) => x.code === 'STALE_PIN')
    if (stale.length) console.log(`ℹ 锁版落后 latest：${stale.length} 条（只报告）`)
    console.log(`\n骨架 ${summary.skeletons} 个 / 锁版依赖 ${summary.pinnedDeps} 条 → error ${summary.error} · warn ${summary.warn}${offline ? '（offline 模式：跳过 registry）' : ''}`)
  }
  process.exitCode = summary.error > 0 ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main()
}
