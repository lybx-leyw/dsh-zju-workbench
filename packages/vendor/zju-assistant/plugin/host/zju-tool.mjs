/**
 * 给助手的 zju 工具：执行一条 ZJU Core 命令（core/zju/scripts/zju.ts），参数就是命令行上 zju 后面那一串。
 * 由宿主起子进程，不经 dsh 的命令行工具，也就不受它的沙箱影响。
 *
 * 写操作：命令带 --confirm 的（选课、预约和取消、二课报名、交作业、签到、发帖和私信）先经 dsh 的审批（ctx.approval）请用户点头，
 * 点了才给这一次开 ZJU_ALLOW_WRITE=1；没有审批渠道、权限模式不弹批准、用户拒绝或者取消，命令都不执行（approval.mjs）。core 自己的写闸（--confirm 加 ZJU_ALLOW_WRITE）照旧在。
 * 关着的行管的模块不执行（core 认 ZJU_DISABLED_MODULES），这里先拦下，说清是插件页上哪一行关着。
 * 缺 FFmpeg 时下载一份（ffmpeg.mjs），再把这条命令跑一遍。
 */
import os from 'node:os'
import { spawn } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { askToWrite } from './approval.mjs'
import { ZJU_SCRIPT, coreEnv, spawnNode } from './core.mjs'
import { ensureFfmpeg, missingFfmpeg } from './ffmpeg.mjs'

/** 默认等多久；签到、下载录播这类可以由 timeoutSeconds 放长。 */
const DEFAULT_TIMEOUT_S = 600, MAX_TIMEOUT_S = 4 * 3600
/** 日志（stderr）只留最后这么多字，命令出错又没给结果时带给助手看。 */
const LOG_TAIL = 4000

export const isWrite = args => args.some(arg => arg === '--confirm' || arg.startsWith('--confirm='))

/** 结束一个子进程连同它起的子进程（下载时的 FFmpeg）。Windows 上 kill 只结束 node 本身。 */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => { child.kill() })
  } else child.kill()
}

/** 跑一次，返回 core 打出的结果；--help 这类只往 stderr 写的，返回 { help }。 */
function runOnce(args, { env, cwd, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('已停止')); return }
    const child = spawnNode(ZJU_SCRIPT, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', log = ''
    const timer = setTimeout(() => { stop(child); reject(new Error(`命令在 ${Math.round(timeoutMs / 1000)} 秒内没有做完，已经停下；要等更久就把 timeoutSeconds 放长。`)) }, timeoutMs)
    const aborted = () => { stop(child); reject(new Error('已停止')) }
    signal?.addEventListener('abort', aborted, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { log = (log + chunk).slice(-LOG_TAIL) })
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted) }
    child.once('error', (error) => { done(); reject(error) })
    child.once('close', (code) => {
      done()
      if (!output.trim()) { resolve(code === 0 ? { help: log.trim() } : { ok: false, error: { code: 'NO_RESULT', message: log.trim() || `命令退出了（${code}），没有给出结果。` } }); return }
      try { resolve(JSON.parse(output)) } catch { resolve({ ok: false, error: { code: 'NO_RESULT', message: '命令的输出不是 JSON。', output: output.slice(0, LOG_TAIL), log: log.trim() } }) }
    })
  })
}

/**
 * campus 是根行的服务：disabledRow(module) 说这个模块归哪一行管、那一行关着时给出它的标题；dataDir() 是 ZJU Core 的数据目录。
 * ctx 用来取审批（approval）和会话的工作目录（workingDirectory）。
 */
export function zjuTool(ctx, campus) {
  return defineTool({
    name: 'zju',
    description: [
      '执行一条浙大校园命令（ZJU Core）：课表、考试、成绩、作业、课件和录播，学校与学院通知，二课活动，体育场馆，CC98，电子书和知网，读 PDF/Word/PPT 等文档。',
      '先加载 zju-campus 技能，照它和它链到的命令说明写参数。args 是命令行上 zju 后面那一串，一项一个，例如 ["notice","search","--keyword","奖学金"]；不确定参数时先用 ["<模块>","--help"]。',
      '带 --confirm 的是写操作（选课、预约、报名、交作业、签到、发帖），会先请用户批准，不用设 ZJU_ALLOW_WRITE；权限模式不弹批准时 dsh 会直接拒绝，照报错说的告诉用户，不要改用命令行。结果是命令输出的 JSON，ok 为 false 时照 error 里的原因和提示处理。',
      '结果里有 webvpnLinks（原地址 → WebVPN 地址）时，给用户的这些链接写成 Markdown [原地址或标题](对应的 WebVPN 地址)，显示原来的地址，点开在校外也能上；没有 webvpnLinks 就直接写原地址。',
    ].join(''),
    parameters: {
      args: { type: 'array', required: true, items: { type: 'string' }, description: 'zju 后面的参数，一项一个，如 ["zdbk","timetable"]' },
      timeoutSeconds: { type: 'integer', description: `最多等多少秒，默认 ${DEFAULT_TIMEOUT_S}；签到、下载录播这类要等得久的才放长，最多 ${MAX_TIMEOUT_S}` },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: args => ({ card: 'generic', title: `校园命令 ${Array.isArray(args?.args) ? args.args.filter(arg => !arg.startsWith('-')).slice(0, 3).join(' ') : ''}`.trim(), kind: 'other' }),
    async execute(input, exec) {
      const args = input.args
      if (!args.length || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.length > 8000 || /[\x00]/.test(arg))) throw new Error('args 要是一串参数，一项一个字符串。')
      const off = campus.disabledRow(args[0])
      if (off) throw new Error(`「${off}」在插件页「ZJU All-in-One Assistant」里关着，这类命令不执行；用户需要时请他到插件页打开这一行。`)
      const write = isWrite(args)
      if (write) {
        const what = args.filter(arg => !arg.startsWith('--confirm')).join(' ')
        await askToWrite(ctx, exec, {
          toolName: 'zju',
          reason: `campus write: zju ${what}`, displayReason: { en: `Run a campus write command: zju ${what}`, zh: `执行校园写操作：zju ${what}` },
        }, '命令没有执行')
      }
      const session = exec.agent?.session
      let cwd = os.homedir()
      try { if (session) cwd = ctx.get('workingDirectory')?.get(session) || cwd } catch { /* 取不到工作目录就从主目录跑 */ }
      const timeoutMs = Math.min(Math.max(Number(input.timeoutSeconds) || DEFAULT_TIMEOUT_S, 10), MAX_TIMEOUT_S) * 1000
      const run = () => runOnce(args, { env: coreEnv({ env: { PTA_INTERACTIVE:'1', ...(write ? { ZJU_ALLOW_WRITE: '1' } : {}) } }), cwd, signal: exec.signal, timeoutMs })
      let result = await run()
      if (missingFfmpeg(result)) {
        await ensureFfmpeg(campus.dataDir())
        result = await run()
      }
      // 经 WebVPN 时附上结果里校内地址该开的 WebVPN 地址，助手照它写链接（campus-page.mjs 的 links）。
      const links = result && typeof result === 'object' && !Array.isArray(result) ? campus.page?.links(result) : undefined
      return links ? { ...result, webvpnLinks: links } : result
    },
  })
}
