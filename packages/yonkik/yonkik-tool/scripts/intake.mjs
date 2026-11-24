#!/usr/bin/env node
// 读取 secrets/intake.json，校验 JSON，拆分落盘：
//   凭证 → secrets/credentials.json（键 = credentialKey）
//   网站 → sites/_index.json（pending 节点，待 triage）
// 只输出非敏感摘要（描述/键数/网址），绝不输出凭据值。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const intakeFile = path.join(root, 'secrets', 'intake.json')

let raw
try {
  raw = fs.readFileSync(intakeFile, 'utf8')
} catch {
  console.error('找不到 secrets/intake.json。请先按指引填写该文件。')
  process.exit(1)
}

let intake
try {
  intake = JSON.parse(raw)
} catch (e) {
  console.error('intake.json 不是合法 JSON：' + e.message)
  console.error('常见原因：多了/少了逗号、引号没配对、删掉了花括号。用记事本检查后重试。（不会读出你的密钥）')
  process.exit(1)
}

const placeholder = /<填|把这里换成|example\.edu/
const urls = (intake.网站 ?? []).filter(u => typeof u === 'string' && u.startsWith('http'))
const creds = Array.isArray(intake.凭证) ? intake.凭证 : []

const slug = (desc, i) => {
  const m = String(desc ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return m.length >= 2 ? m : `cred-${i + 1}`
}

const credentials = {}
const credSummary = []
const warnings = []
creds.forEach((c, i) => {
  const key = slug(c.描述, i)
  credentials[key] = { ...c }
  const valueKeys = Object.keys(c).filter(k => k !== '描述' && !k.startsWith('_'))
  for (const k of valueKeys) {
    if (placeholder.test(String(c[k]))) warnings.push(`凭据[${key}]的「${k}」似乎仍是占位符，请替换成真实值`)
  }
  credSummary.push({ key, 描述: c.描述 ?? '(无描述)', 键数: valueKeys.length })
})
for (const u of urls) {
  if (placeholder.test(u)) warnings.push(`网址「${u}」似乎仍是占位符，请替换成真实网址`)
}

fs.writeFileSync(path.join(root, 'secrets', 'credentials.json'), JSON.stringify(credentials, null, 2))

const indexFile = path.join(root, 'sites', '_index.json')
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { sites: {} }
for (const u of urls) {
  let host
  try { host = new URL(u).hostname } catch { continue }
  index.sites[host] ??= { status: 'pending', origin: u, requires: [], signals: {} }
}
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2))

console.log('校验通过，已拆分落盘。')
console.log(`网址（${urls.length}）：`)
for (const u of urls) console.log('  ' + u)
console.log(`凭据（${credSummary.length}）：`)
for (const s of credSummary) console.log(`  [${s.key}] ${s.描述} —— ${s.键数} 个键（值已写入 credentials.json，未回显）`)
if (warnings.length) {
  console.log('提醒：')
  for (const w of warnings) console.log('  ' + w)
}