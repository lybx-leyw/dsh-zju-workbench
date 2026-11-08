import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'

/** 「下载」文件夹的位置。Windows 上问系统要（可能被挪到别的盘），别的系统用主目录下的 Downloads。 */
function downloadsDirectory() {
  const fallback = path.join(os.homedir(), 'Downloads')
  if (process.platform !== 'win32') return Promise.resolve(fallback)
  return new Promise((resolve) => {
    const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path"
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      const found = error ? '' : stdout.trim()
      resolve(found && path.isAbsolute(found) ? found : fallback)
    })
  })
}

/**
 * 在页面上点「下载」存下来的文件：放在 <下载>\CampusAgent\ 下面，由用的地方再分文件夹。
 * 不直接放进「下载」，是因为同名的文件会被换掉，那里可能有用户自己的东西。
 * CAMPUS_DOWNLOADS_DIR 可以把整个位置换掉（界面测试时用，免得往真实的「下载」里写）。
 */
export class Downloads {
  /** launch 用来启动系统的文件管理器，测试时换成假的。 */
  constructor(root = process.env.CAMPUS_DOWNLOADS_DIR, launch = spawn) {
    this.located = root ? Promise.resolve(path.resolve(root)) : downloadsDirectory().then(directory => path.join(directory, 'CampusAgent'))
    this.launch = launch
  }

  root() { return this.located }

  /** 在系统的文件管理器里打开这个文件所在的文件夹；Windows 和 macOS 上会选中它。只是打开文件夹，不运行文件。 */
  reveal(file) {
    const [command, args, options] = process.platform === 'win32'
      // explorer 要的写法是 /select,"路径"，引号得自己加，不能让 Node 把整个参数包起来。
      ? ['explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true }]
      : process.platform === 'darwin' ? ['open', ['-R', file], {}] : ['xdg-open', [path.dirname(file)], {}]
    const child = this.launch(command, args, { ...options, detached: true, stdio: 'ignore' })
    child.on?.('error', () => {})
    child.unref?.()
  }
}
