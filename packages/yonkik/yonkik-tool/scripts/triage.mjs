#!/usr/bin/env node
// 多站 triage：对一组 origin 串行廉价试探（robots + 首页），判断可达性/登录方式/SPA。
// 全程串行、请求间隔 ≥2s（保守默认）。只输出非敏感元信息。
// 用法: node scripts/triage.mjs <origin1> <origin2> ...
const sleep = ms => new Promise(r => setTimeout(r, ms))
const origins = process.argv.slice(2)
let last = 0
async function get(url) {
  const gap = last + 2000 - Date.now()
  if (gap > 0) await sleep(gap)
  last = Date.now()
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (site-recon triage)' } })
  const text = await res.text()
  return { res, text }
}
for (const origin of origins) {
  const base = origin.replace(/\/$/, '')
  try {
    const { res: rb, text: rbt } = await get(base + '/robots.txt')
    const delay = (rbt.match(/Crawl-delay:\s*(\d+)/i) || [])[1]
    const { res, text } = await get(base + '/')
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''
    const sso = /passport|统一身份|sso|login|cas/i.test(res.url) ? 'SSO/login跳转' : '无登录跳转'
    const spa = /<div id="(root|app)">/i.test(text) && text.length < 30000 ? 'SPA壳' : '静态/服务端渲染'
    const loginPage = /登录|登陆|统一身份认证|password/i.test(text) ? '含登录入口' : ''
    console.log(`### ${base}`)
    console.log(`  robots:${rb.status}${delay ? ' Crawl-delay=' + delay : ''} | / → ${res.status} ${res.url !== base + '/' ? 'final=' + res.url : ''}`)
    console.log(`  title="${title.slice(0, 40)}" | ${spa} | ${sso} ${loginPage} | bytes=${text.length}`)
  } catch (e) {
    console.log(`### ${base} → ERR ${e.message}`)
  }
}