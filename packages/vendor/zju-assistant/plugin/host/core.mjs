/**
 * 跑 ZJU Core 和别的 core 脚本（weread、聊天读取器）的地方。插件不经 dsh 的命令行工具，由宿主进程直接起子进程，不走 shell，
 * 也不包住 ctx.shell、ctx.fs。
 *
 * core 代码在哪：发到 npm 的包里，打包前把仓库的 core/ 拷进本包的 core/（pack-core.mjs）；开发时用链接装进 profile，
 * 本包就是仓库里的 plugin/，core 在它旁边的 ../core，依赖也是仓库里 npm 装好的那一份。先找包里的，没有再找仓库的。
 *
 * 用哪个 Node：宿主自己的那个（process.execPath）。官方桌面版里它可能是 Electron 本身，靠 ELECTRON_RUN_AS_NODE=1 当 Node 用，
 * 版本是 Electron 带的 Node 24，能直接跑 .ts；dsh web 里就是普通的 Node，这个变量不起作用。
 * 从 npm 装的 core 在 node_modules 里，Node 不给那里的 .ts 剥类型，由 ts-loader.mjs 接手，见 nodeEnv。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packed = fileURLToPath(new URL('../core/', import.meta.url))
export const CORE_ROOT = path.resolve(fs.existsSync(path.join(packed, 'zju', 'scripts', 'zju.ts')) ? packed : fileURLToPath(new URL('../../core/', import.meta.url)))
export const ZJU_SCRIPT = path.join(CORE_ROOT, 'zju', 'scripts', 'zju.ts')

// 用文件 URL：路径里的空格和中文都转义掉了，NODE_OPTIONS 里不用再加引号。
const TS_LOADER = CORE_ROOT.split(path.sep).includes('node_modules') ? `--import=${new URL('./ts-loader.mjs', import.meta.url).href}` : ''

/** 起 core 脚本的子进程用的环境：宿主的环境，接上只给这一次的 env；core 装在 node_modules 里时在 NODE_OPTIONS 后面挂上 ts-loader.mjs。 */
export function nodeEnv(env = {}) {
  const merged = { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' }
  if (TS_LOADER) merged.NODE_OPTIONS = [merged.NODE_OPTIONS, TS_LOADER].filter(Boolean).join(' ')
  return merged
}

/** core 报下载进度的那种行（core/zju/lib/core/output.ts 的 progress）。 */
const PROGRESS = '[zju:progress] '

/**
 * 校园命令要的环境变量，由根行（host/index.mjs）在开着的时候给：档案和数据目录、按关着的行算出的 ZJU_DISABLED_MODULES、
 * 场馆验证码问模型的管道。不写进宿主的 process.env：那是 dsh 和别的插件共用的，命令行工具起的命令也会继承。
 */
let campusEnv = () => ({})
export function provideCoreEnv(read) {
  campusEnv = read
  return () => { if (campusEnv === read) campusEnv = () => ({}) }
}

/** 起一个跑 script 的 Node 子进程。env 是只给这一次的环境变量，接在宿主的环境后面；options 原样交给 spawn。 */
export function spawnNode(script, args, { env = {}, ...options } = {}) {
  return spawn(process.execPath, [script, ...args], { ...options, env: nodeEnv(env), windowsHide: true })
}

/**
 * ZJU Core 一条命令的环境：宿主的环境、校园命令的那几样、再是这一次另给的。ignoreSwitches 为真时不受关着的行影响（页面要读档案用）。
 */
export function coreEnv({ ignoreSwitches = false, env = {} } = {}) {
  const { ZJU_DISABLED_MODULES: disabled, ...campus } = campusEnv()
  return { ...campus, ...(disabled && !ignoreSwitches ? { ZJU_DISABLED_MODULES: disabled } : {}), ...env }
}

/**
 * 跑一条 ZJU Core 命令，返回结果里的 data；出错时把 core 给的原因和提示带出来。应用自己（不是助手）要校园数据时用它。
 * system 是出错时对用户说的系统名。ignoreSwitches 为真时不受插件页上关掉哪些行的影响。env 是只给这一次命令的环境变量。
 * onProgress 给了就让 core 边下边报进度，每报一次叫一回：{ bytes 已经收到多少字节, total 一共多少（还估不出来时是 0） }。
 */
export function runCore(args, { system, timeoutMs = 90_000, ignoreSwitches = false, env: extra = {}, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const env = coreEnv({ ignoreSwitches, env: onProgress ? { ...extra, ZJU_PROGRESS: '1' } : extra })
    const child = spawnNode(ZJU_SCRIPT, args, { env, stdio: ['ignore', 'pipe', onProgress ? 'pipe' : 'ignore'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${system}一直没有回应，稍后再试。`)) }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    if (onProgress) {
      // stderr 上别的都是日志，只要进度那种行；一行可能分两次到。
      let rest = ''
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()
        for (const line of lines) {
          if (!line.startsWith(PROGRESS)) continue
          let state
          try { state = JSON.parse(line.slice(PROGRESS.length)) } catch { continue }
          onProgress({ bytes: Math.max(0, Number(state?.bytes) || 0), total: Math.max(0, Number(state?.total) || 0) })
        }
      })
    }
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', () => {
      clearTimeout(timer)
      let result
      try { result = JSON.parse(output) } catch { reject(new Error(`没有拿到${system}的结果，稍后再试。`)); return }
      if (result.ok) resolve(result.data)
      else reject(new Error([result.error?.message, result.error?.hint].filter(Boolean).join('；') || `没能从${system}读到内容。`))
    })
  })
}
