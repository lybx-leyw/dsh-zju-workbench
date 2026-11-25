#!/usr/bin/env node
// 凭据桥接自检：报告 campus-sso 等凭据是否经 yonkik 工具注入到位。
// 只报存在性/键名，绝不回显凭据值。用法：yonkik 工具 script=credcheck。
import { loadCredentials } from '../lib/credentials.mjs'

const envInjected = !!process.env.YONKIK_CREDENTIALS
let envKeys = []
try { envKeys = Object.keys(JSON.parse(process.env.YONKIK_CREDENTIALS || '{}')) } catch { /* 忽略 */ }

const report = { envInjected, envKeys }
for (const k of ['campus-sso', 'webvpn']) {
  try {
    const c = loadCredentials(k)
    report[k] = { present: true, keys: Object.keys(c).filter(x => x !== '描述') }
  } catch (e) {
    report[k] = { present: false, error: e.message }
  }
}
console.log(JSON.stringify(report, null, 2))