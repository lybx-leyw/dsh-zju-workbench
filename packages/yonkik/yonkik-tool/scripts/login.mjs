#!/usr/bin/env node
// OAuth password grant 登录（纯 HTTP，适用于拒绝自动化浏览器的站点）。
// 从 secrets/credentials.json 读凭据（键一=账号，键二=密码），密钥只在进程内存，
// 不进命令行参数/聊天/日志。单次尝试防锁号；成功存 token 到 state.json，不回显 token。
// 用法: node scripts/login.mjs <siteKey>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCredentials } from '../lib/credentials.mjs'

const root = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const siteKey = process.argv[2]
const siteDir = path.join(root, 'sites', siteKey)
const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'))
const oauth = site.auth?.oauth
if (!oauth) { console.error('site.json 缺少 auth.oauth 配置'); process.exit(1) }

const cred = loadCredentials(site.auth.credentialKey ?? siteKey, { root })
const username = cred.键一 ?? cred.username
const password = cred.键二 ?? cred.password
if (!username || !password || /<填/.test(String(username) + password)) {
  console.error('凭据缺失或仍是占位符，请在 secrets/intake.json 填好后重跑 scripts/intake.mjs')
  process.exit(1)
}

const body = new URLSearchParams({
  client_id: oauth.clientId,
  client_secret: oauth.clientSecret,
  grant_type: oauth.grantType ?? 'password',
  username, password,
  scope: oauth.scope ?? '',
})

const res = await fetch(oauth.tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
})
const text = await res.text()
let data
try { data = JSON.parse(text) } catch { data = null }

if (!res.ok || !data?.access_token) {
  // 只报 OAuth 错误码，不回显凭据/响应体里的敏感内容
  const err = data?.error ?? `HTTP ${res.status}`
  console.error(`登录失败：${err}${data?.error_description ? '（' + data.error_description + '）' : ''}`)
  console.error('可能原因：账号密码有误、需验证码/二次认证、或账号被锁。单次尝试已停止，请核对后再试。')
  process.exit(1)
}

const state = {
  access_token: data.access_token,
  refresh_token: data.refresh_token ?? null,
  expires_in: data.expires_in ?? null,
  obtainedAt: new Date().toISOString(),
  apiUrl: site.apiUrl,
  tokenUrl: oauth.tokenUrl,
}
fs.writeFileSync(path.join(siteDir, site.auth.stateFile ?? 'state.json'), JSON.stringify(state, null, 2))
console.log(`登录成功。access_token 已存入 state.json（有效期约 ${data.expires_in ?? '?'} 秒），未回显。`)