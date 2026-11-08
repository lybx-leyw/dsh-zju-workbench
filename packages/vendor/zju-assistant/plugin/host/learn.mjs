/**
 * 「课程讲解」插件的可选依赖。讲解的引擎（core/learn/engine）自己能跑，下面两样有了效果更好，没有也能出成品：
 *   tex      公式排版：打包时用 TeX（latex 和 dvisvgm）把公式排成字形轮廓；没有时由播放器里的后备排版来画（engine/tex.mjs）。
 *   browser  版面检查和截图：用本机的 Edge 或 Chrome 无界面地打开成品（engine/lint.mjs、shots.mjs）。Windows 自带 Edge，macOS 上要用户自己装 Chrome 或 Edge；这里只看有没有，不管装。
 * TeX 可以在插件页上点「安装」：从国内的 CTAN 镜像取 TeX Live 的安装程序，只装排公式用得到的那一小部分（约 300 MB），
 * 装在应用的数据目录里，不改系统的 PATH、注册表和开始菜单；卸载就是删掉那个文件夹。
 * 装好以后把位置放进环境变量 LEARN_TEX_BIN（engine/tex.mjs 第一个看的就是它），引擎之后启动的命令都会继承。
 * 千问 TTS 配音由 tts.mjs 单独管理；默认不安装，不影响这两项依赖。
 *
 * 动画常用的 gsap 和 three（engine/lib.mjs 把它们做成这一集的 lib/）解开有 30 MB，多数人不开「课程讲解」，所以不随插件带：
 * 这一行打开时下载（约 6 MB），核对 npm 登记的 SHA-512 后解到数据目录的 tools/learn-libs/node_modules，位置写进 LEARN_LIBS，lib.mjs 先看它。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export const PLUGIN = 'zju-learn'

/** 下载哪两个、什么版本：照仓库里讲解引擎装的那一份（core/learn/engine/vendor/package-lock.json），校验值也从那里来。 */
export const LIBS = {
  gsap: { version: '3.15.0', integrity: 'sha512-dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==' },
  three: { version: '0.186.1', integrity: 'sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==' },
}
/** npm 的下载源，从上往下试：国内的镜像在前，校验值对得上才用。 */
export const REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** TeX Live 的安装源，从上往下试，哪个先连上用哪个。 */
export const MIRRORS = [
  'https://mirrors.zju.edu.cn/ctan/systems/texlive/tlnet',
  'https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet',
  'https://mirrors.ustc.edu.cn/CTAN/systems/texlive/tlnet',
  'https://mirror.ctan.org/systems/texlive/tlnet',
]
/** 一次安装最多等这么久（校园网上实测十分钟以内）。 */
const INSTALL_LIMIT_MS = 45 * 60_000
const EXE = process.platform === 'win32' ? '.exe' : ''
/** 引擎找浏览器的几个位置（engine/lint.mjs、shots.mjs 里写的就是这几个）：前三个是 Windows 的，后两个是 macOS 的。 */
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']

const message = error => error instanceof Error ? error.message : String(error)
/** 环境变量的名字在 Windows 上不分大小写（PATH 也可能写成 Path），拷出来的普通对象却分，所以按不分大小写取。 */
const pick = (env, name) => env[name] ?? env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase()) ?? '']
/** TeX Live 装不进带中文或空格的路径。 */
const plain = value => /^[\x21-\x7E]+$/.test(value)
/** 引擎找 TeX 时最后看的那一处（engine/tex.mjs 里写死的 E:\texlive\<年份>），新的年份在前。 */
function yearly() {
  try { return fs.readdirSync('E:/texlive').sort().reverse().map(year => `E:/texlive/${year}/bin/windows`) } catch { return [] }
}
const hasTex = dir => !!dir && fs.existsSync(path.join(dir, `latex${EXE}`)) && fs.existsSync(path.join(dir, `dvisvgm${EXE}`))

/**
 * 应用自己装的 TeX 放哪：数据目录下的 tools\texlive。用户名带中文或空格时数据目录也带，
 * 这时改放 C:\ProgramData\CampusAgent\texlive（普通用户能在那里建文件夹）。两处都不行时照第一处给，安装时会说明原因。
 */
export function texHome(dataDir, env = process.env) {
  const own = path.join(dataDir, 'tools', 'texlive')
  if (plain(own)) return own
  const shared = pick(env, 'ProgramData')
  return shared && plain(shared) ? path.join(shared, 'CampusAgent', 'texlive') : own
}

/** 排公式要的那一小部分：只有安装器本身、基础和 LaTeX 两组包，不装文档和源码，不动系统。dvisvgm 不在这两组里，装完再单独加。 */
const profile = home => [
  'selected_scheme scheme-infraonly',
  `TEXDIR ${home}`,
  'collection-basic 1',
  'collection-latex 1',
  'instopt_portable 1',
  'instopt_adjustpath 0',
  'instopt_adjustrepo 1',
  'tlpdbopt_install_docfiles 0',
  'tlpdbopt_install_srcfiles 0',
  'tlpdbopt_desktop_integration 0',
  'tlpdbopt_file_assocs 0',
  'tlpdbopt_w32_multi_user 0',
  '',
].join('\n')

/** 把一个地址存成文件，边收边报收到多少字节、一共多少。 */
export async function download(url, file, onProgress) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`${new URL(url).host} 回了 ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  let bytes = 0
  const count = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; onProgress?.({ bytes, total }); done(null, chunk) } })
  await pipeline(Readable.fromWeb(response.body), count, fs.createWriteStream(file))
}

/**
 * 把 npm 的 .tgz 解到 dir：去掉最外面那层（package/），只放普通文件。长路径照 pax 或 GNU 的写法读；路径跑出 dir 的整个不要。
 * 不用系统的 tar：Windows 上的 tar.exe 认不好带中文的路径，用户名是中文时数据目录就带中文。
 */
export function untgz(packed, dir) {
  const tar = gunzipSync(packed), root = path.resolve(dir)
  let at = 0, long = ''
  while (at + 512 <= tar.length) {
    const head = tar.subarray(at, at + 512)
    if (head.every(byte => byte === 0)) break
    const field = (from, length) => head.subarray(from, from + length).toString('utf8').replace(/\0[\s\S]*$/, '')
    const size = parseInt(field(124, 12).trim() || '0', 8), type = field(156, 1) || '0'
    const body = tar.subarray(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') { long = /(?:^|\n)\d+ path=([^\n]*)/.exec(body.toString('utf8'))?.[1] ?? ''; continue }
    if (type === 'L') { long = body.toString('utf8').replace(/\0[\s\S]*$/, ''); continue }
    const name = long || (field(257, 5) === 'ustar' && field(345, 155) ? `${field(345, 155)}/${field(0, 100)}` : field(0, 100))
    long = ''
    if (type !== '0' && type !== '7') continue
    const parts = name.split('/').slice(1).filter(Boolean)
    if (!parts.length) continue
    const file = path.resolve(root, ...parts)
    if (!file.startsWith(root + path.sep)) throw new Error('压缩包里有跑出目录的路径，没有使用')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
  }
}

/** 跑一个程序到结束，输出一行一行交给 onLine；退出码不是 0 时带着最后几行报错。Windows 上的 .bat 要经 cmd 才能启动。 */
export function run(command, args, { cwd, env, onLine, timeoutMs = INSTALL_LIMIT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)
    const child = batch ? spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail = []
    let rest = ''
    const feed = (chunk) => {
      const lines = (rest + chunk).split(/\r?\n|\r/)
      rest = lines.pop()
      for (const line of lines) { if (!line.trim()) continue; tail.push(line); if (tail.length > 8) tail.shift(); onLine?.(line) }
    }
    child.stdout.setEncoding('utf8').on('data', feed)
    child.stderr.setEncoding('utf8').on('data', feed)
    const timer = setTimeout(() => { child.kill(); reject(new Error('等了太久没有装完，检查网络以后再试。')) }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(tail.slice(-3).join(' ').slice(0, 300) || `安装程序退出了（${String(code)}）`))
    })
  })
}

export class LearnKit {
  /**
   * dataDir 是应用的数据目录；plugins 是插件开关。env 是引擎进程的环境变量，装好的 TeX 的位置写在里面。
   * tools 是下载和跑程序的两个函数，browsers 是找浏览器的位置，elsewhere 是 PATH 以外还要看的 TeX 的位置；libs、registries 是要下载的库和下载源。测试时换成假的。
   */
  constructor({ dataDir, plugins, env = process.env, tools = { download, run }, browsers = BROWSERS, mirrors = MIRRORS, elsewhere = yearly, libs = LIBS, registries = REGISTRIES }) {
    this.elsewhere = elsewhere
    this.plugins = plugins
    this.env = env
    this.tools = tools
    this.browsers = browsers
    this.mirrors = mirrors
    this.home = texHome(dataDir, env)
    this.libs = libs
    this.registries = registries
    this.libsDir = path.join(dataDir, 'tools', 'learn-libs', 'node_modules')
    /** 正在下载动画库时下到哪了；没下成时 libsError 留着原因。 */
    this.libsJob = null
    this.libsError = ''
    // 启动环境里原有的 LEARN_TEX_BIN 是用户自己设的，没装我们这一份时还给他。
    this.inherited = env.LEARN_TEX_BIN
    /** 正在装的那一样装到哪了；装完或者没装成以后，error 留着上一次没装成的原因。 */
    this.job = null
    this.error = ''
    this.apply()
  }

  enabled() { return !this.plugins.disabled().includes(PLUGIN) }

  /** 应用自己装的那一份的程序目录。 */
  ownBin() { return path.join(this.home, 'bin', 'windows') }

  /** 现在用得上的 TeX：先看应用自己装的，再照引擎的找法看本机原有的（LEARN_TEX_BIN、PATH、E:\texlive）。 */
  tex() {
    if (hasTex(this.ownBin())) return { dir: this.ownBin(), where: 'app' }
    if (/^(off|none|0)$/i.test(this.inherited ?? '')) return null
    const dir = [this.inherited, ...(pick(this.env, 'PATH') ?? '').split(path.delimiter), ...this.elsewhere()].find(hasTex)
    return dir ? { dir, where: 'system' } : null
  }

  apply() {
    if (hasTex(this.ownBin())) this.env.LEARN_TEX_BIN = this.ownBin()
    else if (this.inherited === undefined) delete this.env.LEARN_TEX_BIN
    else this.env.LEARN_TEX_BIN = this.inherited
    this.env.LEARN_LIBS = this.libsDir
  }

  /** 这个库下好了、版本对。 */
  hasLib(name) {
    try { return JSON.parse(fs.readFileSync(path.join(this.libsDir, name, 'package.json'), 'utf8')).version === this.libs[name].version } catch { return false }
  }

  hasLibs() { return Object.keys(this.libs).every(name => this.hasLib(name)) }

  /** 这一行打开时叫：动画库不全就开始下载，马上返回。已经在下、或者这一行关着，什么都不做。 */
  prepare() {
    if (!this.enabled() || this.libsJob || this.hasLibs()) return
    this.libsJob = { step: '准备', percent: 0 }
    this.libsError = ''
    this.libsDone = this.fetchLibs().then(() => { this.libsError = '' }, (error) => { this.libsError = message(error) }).finally(() => { this.libsJob = null })
  }

  async fetchLibs() {
    const names = Object.keys(this.libs)
    for (const [index, name] of names.entries()) {
      if (this.hasLib(name)) continue
      const { version, integrity } = this.libs[name]
      const step = (text, done) => { this.libsJob = { step: text, percent: Math.floor((index + done) / names.length * 100) } }
      const target = path.join(this.libsDir, name), temp = `${target}.${randomUUID()}.tmp`, packed = `${temp}.tgz`
      fs.mkdirSync(this.libsDir, { recursive: true })
      try {
        const reasons = []
        for (const registry of this.registries) {
          try {
            step(`下载 ${name}`, 0)
            await this.tools.download(`${registry}/${name}/-/${name}-${version}.tgz`, packed, ({ bytes, total }) => { if (total) step(`下载 ${name}`, bytes / total * 0.9) })
            if (`sha512-${createHash('sha512').update(fs.readFileSync(packed)).digest('base64')}` !== integrity) throw new Error(`${new URL(registry).host} 给的和应有的不一样`)
            reasons.length = 0
            break
          } catch (error) { reasons.push(message(error)) }
        }
        if (reasons.length) throw new Error(`${name} 没有下载成：${reasons[0]}`)
        step(`解开 ${name}`, 0.9)
        untgz(fs.readFileSync(packed), temp)
        fs.rmSync(target, { recursive: true, force: true })
        fs.renameSync(temp, target)
      } finally {
        fs.rmSync(packed, { force: true })
        fs.rmSync(temp, { recursive: true, force: true })
      }
    }
  }

  snapshot() {
    const tex = this.tex(), installing = this.job !== null
    return {
      enabled: this.enabled(),
      parts: [
        {
          id: 'tex', state: installing ? 'installing' : tex ? 'ready' : 'missing', where: tex?.where ?? null,
          // 别的系统上没有做安装，只认本机已有的。
          installable: process.platform === 'win32', step: this.job?.step ?? '', percent: this.job?.percent ?? null, error: this.error,
        },
        { id: 'browser', state: this.browsers.some(file => fs.existsSync(file)) ? 'ready' : 'missing', where: null, installable: false, step: '', percent: null, error: '' },
        // 自动下载的，没有卸载；没下成时页面上的「安装」再下一次。
        { id: 'libs', state: this.libsJob ? 'installing' : this.hasLibs() ? 'ready' : 'missing', where: null, installable: true, step: this.libsJob?.step ?? '', percent: this.libsJob?.percent ?? null, error: this.libsError },
      ],
    }
  }

  /** 开始装一样依赖，马上返回；装到哪了页面隔一会儿来读。已经在装就不再起第二次。 */
  install(input) {
    if (input?.id !== 'tex' && input?.id !== 'libs') throw new Error('这一样不能在这里安装')
    if (!this.enabled()) throw new Error('「课程讲解」在插件页关着，先打开它。')
    if (input.id === 'libs') { this.prepare(); return this.snapshot() }
    if (process.platform !== 'win32') throw new Error('这个系统上还不能自动安装，请自己装好 TeX Live。')
    if (this.job) return this.snapshot()
    if (!plain(this.home)) throw new Error(`TeX Live 装不进带中文或空格的位置（${this.home}）。请自己装一份 TeX Live，装好后重新打开应用。`)
    this.job = { step: '准备', percent: 0 }
    this.error = ''
    this.done = this.installTex().then(() => { this.error = '' }, (error) => { this.error = message(error) }).finally(() => { this.job = null; this.apply() })
    return this.snapshot()
  }

  /** 卸载应用自己装的那一份：删掉它的文件夹。本机原有的 TeX 不动。 */
  remove(input) {
    if (input?.id !== 'tex') throw new Error('这一样不能在这里卸载')
    if (this.job) throw new Error('正在安装，装完再卸载。')
    fs.rmSync(this.home, { recursive: true, force: true })
    this.error = ''
    this.apply()
    return this.snapshot()
  }

  async installTex() {
    const home = this.home, setup = `${home}-setup`
    const step = (text, percent) => { this.job = { step: text, percent } }
    // 上一次没装完留下的半截先清掉。
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(setup, { recursive: true, force: true })
    fs.mkdirSync(setup, { recursive: true })
    try {
      // 安装程序是一个 25 MB 的压缩包，占整个过程的头 5%。
      const zip = path.join(setup, 'install-tl.zip')
      let mirror = '', reasons = []
      for (const candidate of this.mirrors) {
        try {
          step('下载安装程序', 0)
          await this.tools.download(`${candidate}/install-tl.zip`, zip, ({ bytes, total }) => { if (total) step('下载安装程序', Math.floor(bytes / total * 5)) })
          mirror = candidate
          break
        } catch (error) { reasons.push(message(error)) }
      }
      if (!mirror) throw new Error(`连不上 TeX Live 的下载源：${reasons[0] ?? '没有回应'}`)
      step('解开安装程序', 5)
      // Windows 10 起自带 tar，能解 zip。写全路径：PATH 上排在前面的可能是 Git 带的那个 tar，它把 C: 当成远程主机，解不了。
      await this.tools.run(path.join(pick(this.env, 'SystemRoot') ?? 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', setup])
      const folder = fs.readdirSync(setup, { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name.startsWith('install-tl'))
      if (!folder) throw new Error('安装程序的压缩包里没有要的东西')
      const installer = path.join(setup, folder.name)
      const profileFile = path.join(setup, 'texlive.profile')
      fs.writeFileSync(profileFile, profile(home.replaceAll('\\', '/')))
      // 安装程序自己的临时文件也放在不带中文的地方；本机别的 TeX 的环境变量不带进去，免得它停下来问。
      const temp = path.join(setup, 'tmp')
      fs.mkdirSync(temp, { recursive: true })
      // 代理的设置也不带：安装程序是直连镜像拿到的，后面的包走同一条路；真实装的时候经本机代理去连校内镜像，下到一半停住不动过。
      const env = Object.fromEntries(Object.entries(this.env).filter(([name]) => !/^(TEX|LEARN_TEX)/i.test(name) && !/^(https?|all|no)_proxy$/i.test(name)))
      Object.assign(env, { TEMP: temp, TMP: temp, TEXLIVE_INSTALL_ENV_NOCHECK: '1', TEXLIVE_INSTALL_NO_WELCOME: '1' })
      // 包一个一个用 curl 下。安装程序自己给 curl 的参数没有防停住的：连上以后对面不再发数据，它会一直等下去。
      // 换成我们的：三十秒里每秒不到 4 KB 就算断了，断了重试。输出的文件名由安装程序接在最后（所以 --output 放在末尾）。
      const curl = path.join(pick(this.env, 'SystemRoot') ?? 'C:/Windows', 'System32', 'curl.exe')
      if (fs.existsSync(curl)) Object.assign(env, {
        TEXLIVE_DOWNLOAD_PROGRAM: curl,
        TEXLIVE_DOWNLOAD_ARGS: '--user-agent texlive/curl --retry 6 --retry-delay 3 --retry-all-errors --connect-timeout 20 --speed-limit 4096 --speed-time 30 --fail --location --silent --output',
      })
      // 「Installing [012/098, …」：一共多少个包、装到第几个，占 5% 到 95%。它先装自己用的几个小包（总数只有个位数），那一轮不算，
      // 不然进度会先冲到头再退回来。
      const packages = (line) => { const at = /^Installing \[\s*(\d+)\/(\d+)[,\]]/.exec(line.trim()); return at && Number(at[2]) >= 20 ? Number(at[1]) / Number(at[2]) : null }
      step('安装 TeX Live', 5)
      await this.tools.run(path.join(installer, 'install-tl-windows.bat'), ['-no-gui', '-profile', profileFile, '-repository', mirror], {
        cwd: installer, env,
        onLine: (line) => { const at = packages(line); if (at !== null) step('安装 TeX Live', Math.max(this.job?.percent ?? 5, 5 + Math.floor(at * 90))) },
      })
      step('安装 dvisvgm', 95)
      await this.tools.run(path.join(home, 'bin', 'windows', 'tlmgr.bat'), ['install', 'dvisvgm'], { cwd: home, env })
      if (!hasTex(this.ownBin())) throw new Error('装完以后没有找到 latex 和 dvisvgm')
    } catch (error) {
      fs.rmSync(home, { recursive: true, force: true })
      throw error
    } finally {
      fs.rmSync(setup, { recursive: true, force: true })
    }
  }
}
