// Application entry: plugin switch and process status around the synchronized read-only CLI.
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { main as queryMain } from '../lib/cli.ts'
/** Whether DingTalk for Mac is running: pgrep exits 1 when nothing matches, and anything else is a failure. */
function macRunning() {
  const { status, error } = spawnSync('/usr/bin/pgrep', ['-x', 'DingTalk'], { stdio: 'ignore', timeout: 15000 })
  if (error || (status !== 0 && status !== 1)) throw error ?? new Error('pgrep failed')
  return status === 0
}
const args = process.argv.slice(2)
if (process.env.DINGTALK_CHAT_DISABLED === '1') {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      status: 'plugin_disabled',
      message: '钉钉聊天插件已关闭，请先在插件页打开。'
    }) + '\n'
  )
  process.exitCode = 1
} else if (args.length === 1 && args[0] === 'status') {
  try {
    const running =
      process.platform === 'win32'
        ? /"DingTalk\.exe"/i.test(
            execFileSync(
              path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/tasklist.exe'),
              ['/FI', 'IMAGENAME eq DingTalk.exe', '/FO', 'CSV', '/NH'],
              { windowsHide: true, encoding: 'utf8', timeout: 15000 }
            )
          )
        : process.platform === 'darwin' && macRunning()
    process.stdout.write(JSON.stringify({ ok: true, running }) + '\n')
  } catch {
    process.stdout.write(
      JSON.stringify({ ok: false, status: 'local_reader_failed', message: '无法检查钉钉运行状态。' }) + '\n'
    )
    process.exitCode = 1
  }
} else if (args.includes('--help')) {
  process.stdout.write(
    JSON.stringify({
      ok: true,
      usage:
        'status | profiles | chat list/contacts/info/members/read/search [--chat ID] [--query 关键词] [--profile ID] [--since ISO] [--until ISO] [--sender ID] [--type 类型] [--limit 1..500] [--cursor 游标]；profiles 和 chat 都可加 --data-dir 文件夹'
    }) + '\n'
  )
} else process.exitCode = queryMain(args)
