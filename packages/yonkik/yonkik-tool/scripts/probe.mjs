#!/usr/bin/env node
// 只读 API 探针：从 state.json 读 Bearer token，对 apiUrl 单发串行验证接口。
// 只输出响应结构（键/数组长度/首项截断），不做批量调用。
// 用法: node scripts/probe.mjs <siteKey> <path1> [path2 ...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'

const root = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const siteKey = process.argv[2]
const paths = process.argv.slice(3)
const siteDir = path.join(root, 'sites', siteKey)
const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'))
const state = JSON.parse(fs.readFileSync(path.join(siteDir, site.auth.stateFile ?? 'state.json'), 'utf8'))
const client = await createClient(siteKey, { root, quiet: true })
const base = (site.apiUrl ?? site.origin).replace(/\/$/, '')

function shape(v) {
  if (Array.isArray(v)) return `array[${v.length}] 首项键: ${v[0] && typeof v[0] === 'object' ? Object.keys(v[0]).join(',') : typeof v[0]} | 首项: ${JSON.stringify(v[0]).slice(0, 280)}`
  if (v && typeof v === 'object') return `object 键: ${Object.keys(v).join(',')} | 截断: ${JSON.stringify(v).slice(0, 280)}`
  return String(v).slice(0, 200)
}

for (const p of paths) {
  try {
    const res = await client.get(base + p, { headers: { Authorization: 'Bearer ' + state.access_token } })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = null }
    console.log(`### ${p} → ${res.status}`)
    console.log('  ' + (data ? shape(data) : text.slice(0, 160).replace(/\s+/g, ' ')))
  } catch (e) {
    console.log(`### ${p} → ERR ${e.message}`)
  }
}