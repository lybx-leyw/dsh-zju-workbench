import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { argumentsFor, main, fail } from '../../chat/common.mjs'
import { messageTypes } from '../lib/content.mjs'
const explanations = {
  wechat_not_running: '电脑版微信没有运行，请打开并登录微信。',
  wechat_database_missing:
    '未找到本机微信的聊天数据。在微信「设置 → 账号与存储」里改过存储位置的，请把聊天数据位置设成那里（命令行用 --data-dir）。',
  wechat_folder_unrecognized:
    '这个文件夹里没有微信聊天数据。请选微信「设置 → 账号与存储」里显示的存储位置，或者它下面 xwechat_files 里的账号文件夹。',
  multiple_wechat_processes: '同时运行了多个微信，请保留一个账号后重试。',
  multiple_wechat_profiles: '找到了多个微信账号的数据，请把聊天数据位置选到正在登录的那个账号的文件夹（xwechat_files 下面那一层）。',
  wechat_key_unavailable: '未取得数据库密钥，请确认微信已登录；当前微信版本也可能不兼容。',
  wechat_offline_key_unavailable: '尚未准备好离线密钥，请打开微信后再试。',
  wechat_key_cache_failed: '无法保存由 Windows 当前用户加密保护的密钥缓存。',
  runtime_missing: '应用的 Node 运行时不支持内存数据库，请更新应用。',
  macos_build_failed: '无法编译或签名 Mac 上读微信用的小程序，需要 Xcode 命令行工具（在终端运行 xcode-select --install）。',
  wechat_memory_denied:
    'macOS 不让读取微信进程。请在系统弹出的开发者工具授权里允许；系统完整性保护（SIP）开着时，官方微信多半仍然读不了，这里不会去改系统保护或微信。',
  snapshot_failed: '微信数据库快照未通过校验，请稍后重试。',
  local_reader_failed: '读取本机微信失败。'
}
await main(async () => {
  if (process.env.WECHAT_CHAT_DISABLED === '1')
    fail('plugin_disabled', '这个聊天插件已关闭，请先在插件页打开。')
  const query = argumentsFor(process.argv.slice(2), { media: true })
  if (query.help)
    return {
      ok: true,
      usage:
        'status | profiles | chat list/contacts/info/members/read/search [--chat ID] [--query 关键词] [--since ISO] [--sender ID] [--type 类型] [--limit 1..500] [--cursor 游标] [--offline] | chat download --message ID --out 目录；都可加 --data-dir 文件夹'
    }
  if (!['win32', 'darwin'].includes(process.platform)) fail('unsupported_platform', '微信聊天读取只支持 Windows 和 macOS。')
  // 插件设置里选的聊天数据位置经这个变量传进来；命令行的 --data-dir 优先。
  if (!query['data-dir'] && process.env.WECHAT_DATA_DIR) query['data-dir'] = process.env.WECHAT_DATA_DIR
  const mac = process.platform === 'darwin' ? await import('../lib/macos.mjs') : null
  if (query.op === 'status' && mac) {
    try {
      return { ok: true, running: mac.wechatPid() > 0 }
    } catch {
      fail('local_reader_failed', '无法检查微信运行状态。')
    }
  }
  if (query.op === 'status') {
    const { stdout } = await promisify(execFile)(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/tasklist.exe'),
      ['/FI', 'IMAGENAME eq Weixin.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true }
    )
    return { ok: true, running: /"Weixin\.exe"/i.test(stdout) }
  }
  if (query.type && !messageTypes.includes(query.type)) fail('invalid_input', '不支持的消息类型。')
  if (query.op === 'download') {
    if (!/^[^:]+:(?:\d+|message_\d+\.db:\d+)$/.test(query.message || '') || !query.out?.trim())
      fail('invalid_input', 'download 需要消息 ID 和保存目录。')
    if (query.offline) fail('invalid_input', '媒体导出不支持 --offline。')
    query.chat = query.message.split(':')[0]
    query.limit = 1
  }
  const check = new DatabaseSync(':memory:')
  const supported = typeof check.deserialize === 'function'
  check.close()
  if (!supported) fail('runtime_missing', explanations.runtime_missing)
  if (mac) return finish(await mac.readMac(query), query)
  const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe'
    ),
    script = fileURLToPath(new URL('./local/read-chat.ps1', import.meta.url))
  const output = await promisify(execFile)(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-NodePath',
      process.execPath,
      '-QueryBase64',
      Buffer.from(JSON.stringify(query)).toString('base64')
    ],
    {
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  ).then(
    (r) => r.stdout,
    (e) => e.stdout || ''
  )
  let result
  try {
    result = JSON.parse(output)
  } catch {
    fail('local_reader_failed', explanations.local_reader_failed)
  }
  return finish(result, query)
})

/** 两个系统的读取器交回的结果：错误码换成说明，结果不全时交代一句，download 再把媒体存下来。 */
async function finish(result, query) {
  if (result.error) fail(result.error, explanations[result.error] || explanations.local_reader_failed)
  // 读取器跳过了微信近来没打开过、内存里没有密钥的旧消息库：结果不全，照实交代。
  if (result.ok && result.partial)
    result.partialNote = `有 ${result.skippedShards} 个较早的聊天记录库这次没能解开（微信最近没有打开过它），结果里少了那一段时间的消息。只查最近的消息时加 --since 就不会碰到它。`
  if (!result.ok || query.op !== 'download') return result
  const { saveMedia } = await import('../lib/chat-media.ts')
  return saveMedia(result, query.out)
}
