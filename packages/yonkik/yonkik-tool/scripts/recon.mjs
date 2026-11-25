#!/usr/bin/env node
// 浏览器侦察：打开站点首页与 /login，截图并列出表单字段。不读取/不接触凭据。
// 用法: node scripts/recon.mjs <siteKey>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// 依赖与浏览器路径一律由环境变量或常规解析给出 —— 本仓是公开仓库，
// 不能把开发机上的用户名目录写进源码。
//   YONKIK_PLAYWRIGHT   playwright-core 的入口路径（不填则按常规模块解析）
//   YONKIK_CHROMIUM     浏览器可执行文件路径（不填则用 playwright 自带的）
const { chromium } = require(process.env.YONKIK_PLAYWRIGHT || 'playwright-core')
const exe = process.env.YONKIK_CHROMIUM || undefined

const root = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const siteKey = process.argv[2]
const site = JSON.parse(fs.readFileSync(path.join(root, 'sites', siteKey, 'site.json'), 'utf8'))
const dir = path.join(root, 'sites', siteKey)

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage()

async function probe(url, tag) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3500)
    const info = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map(i => ({
        type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
      }))
      const buttons = [...document.querySelectorAll('button, a.btn, input[type=submit]')].slice(0, 20).map(b => ({
        text: (b.textContent || b.value || '').trim().slice(0, 30), type: b.type,
      }))
      return { url: location.href, title: document.title, inputs, buttons, bodyLen: document.body.innerText.length }
    })
    await page.screenshot({ path: path.join(dir, `_recon-${tag}.png`), fullPage: false })
    console.log(`=== ${tag} ===`)
    console.log(JSON.stringify(info, null, 2))
  } catch (e) {
    console.log(`=== ${tag} === 失败: ${e.message}`)
  }
}

await probe(site.origin, 'home')
await probe(site.origin.replace(/\/$/, '') + '/login', 'login')
await browser.close()