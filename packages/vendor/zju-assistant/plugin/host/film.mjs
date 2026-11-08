/**
 * 放讲解：讲解是课程讲解打包出来的单个 HTML，都在讲解目录的 dist 里（<文档>\CampusAgent\讲解\dist）。
 * 学习页上点播放，页面在新标签页里打开 /api/zju-campus/film?name=<文件名>，这里按文件名到那个文件夹里找。
 * 只认一个文件名：不认路径，不认别的文件夹，不认 .html 以外的文件。
 *
 * 讲解里的脚本是助手写的，和 dsh 的页面同源就能调 dsh 的接口。所以响应头带 CSP 的 sandbox：页面成了不透明的源，
 * 读不到 dsh 的 cookie 和存储，也不能联网（connect-src 'none'）、不能提交表单、不能把顶层页面带走；只能跑它自己的脚本、放它自带的图和声音。
 */
import fs from 'node:fs'
import path from 'node:path'

const POLICY = [
  'sandbox allow-scripts allow-pointer-lock',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:', 'media-src data: blob:', 'font-src data: blob:',
  "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ')

/** 文件名合不合规矩：只是一个名字，以 .html 结尾。 */
export function filmName(value) {
  const name = typeof value === 'string' ? value : ''
  return name && name === path.basename(name) && !/[\\/:*?"<>|]/.test(name) && name.toLowerCase().endsWith('.html') ? name : ''
}

const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><title>讲解</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1b1b1c;color:#c8c8c8;font:14px/1.6 system-ui,sans-serif"><p>${text}</p>`, {
  status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': POLICY, 'cache-control': 'no-store' },
})

/** filmRoot 是讲解目录。 */
export function filmResponse(request, filmRoot) {
  const name = filmName(new URL(request.url).searchParams.get('name'))
  if (!name) return page(400, '这不是一条讲解。')
  const file = path.join(filmRoot, 'dist', name)
  if (!fs.existsSync(file)) return page(404, '这条讲解不在了，可能已经被删掉或改了名字。')
  return new Response(fs.readFileSync(file), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': POLICY, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
