#!/usr/bin/env node
import { commands } from '../lib/cli.ts'
import { closeBrowser } from '../lib/browser/runtime.ts'

// 结果和错误都是 JSON：{ ok: true, … } 或 { ok: false, status, message }。
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))
try { await commands(print).parseAsync(process.argv) }
catch (error: any) {
  // commander 自己已经输出了帮助或用法错误。
  if (String(error.code).startsWith('commander.')) process.exitCode = error.exitCode
  else { print(error.publicResult?.() ?? { ok: false, status: 'failed', message: error.message }); process.exitCode = 1 }
}
finally { await closeBrowser() }
