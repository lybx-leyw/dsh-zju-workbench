#!/usr/bin/env node
// sites/<key>/crawler.mjs — 由 site-recon 生成。
// 只实现「已单发验证的只读操作」；提交/修改/删除不属于本脚本。
// 用法: node crawler.mjs --list
//       node crawler.mjs <op> [--参数 值] [--out 文件]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../../lib/http.mjs'

const siteKey = path.basename(path.dirname(fileURLToPath(import.meta.url)))
const client = await createClient(siteKey)

const ops = {
  // 按探索结果填充，例：
  // async search({ keyword, page = 1 }) {
  //   return client.postJSON('/opac/ajax/search', { keyword, page })
  // },
  // async detail({ id }) {
  //   return client.getJSON(`/opac/book/${id}`)
  // },
  // async download({ id, out }) {
  //   const { url } = await client.getJSON(`/opac/download-token/${id}`)  // token 现取现用
  //   return client.download(url, out ?? `${id}.pdf`)
  // },
}

const [opName, ...rest] = process.argv.slice(2)
if (!opName || opName === '--list') {
  console.log(Object.keys(ops).join('\n') || '(尚无操作 — 完成探索后填充 ops)')
  process.exit(0)
}
const op = ops[opName]
if (!op) {
  console.error(`未知操作 "${opName}"，用 --list 查看可用操作`)
  process.exit(1)
}

const args = {}
let out
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--out') { out = rest[++i]; continue }
  if (rest[i].startsWith('--')) {
    const next = rest[i + 1]
    args[rest[i].slice(2)] = next === undefined || next.startsWith('--') ? true : rest[++i]
  }
}

const result = await op(args)
const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
if (out) {
  fs.writeFileSync(out, text)
  console.error(`已写入 ${out}`)
} else {
  console.log(text)
}