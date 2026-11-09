import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { LearnKit, texHome, untgz } from './learn.mjs'

const EXE = process.platform === 'win32' ? '.exe' : ''
const windows = { skip: process.platform !== 'win32' && '安装只做了 Windows 的' }
const room = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-learn-')); t.after(() => { fs.rmSync(root, { recursive: true, force: true }) }); return root }
/** 在一个文件夹里放上假的 latex 和 dvisvgm。 */
const plant = (dir) => { fs.mkdirSync(dir, { recursive: true }); for (const name of ['latex', 'dvisvgm']) fs.writeFileSync(path.join(dir, name + EXE), '') }
const part = (kit, id) => kit.snapshot().parts.find(item => item.id === id)

/** 做一个 npm 那样的 .tgz：路径照写（npm 的都在 package/ 下面），超过 100 个字的路径用 pax 头写。 */
function tgz(files) {
  const header = (name, size, type) => {
    const head = Buffer.alloc(512)
    head.write(name.slice(0, 100), 0)
    head.write('0000644\0', 100)
    head.write(size.toString(8).padStart(11, '0') + '\0', 124)
    head.write(type, 156)
    head.write('ustar\x0000', 257)
    return head
  }
  const pad = data => Buffer.concat([data, Buffer.alloc((512 - data.length % 512) % 512)])
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    if (name.length > 100) {
      const rest = ` path=${name}\n`
      let length = rest.length + 1
      while (String(length).length + rest.length !== length) length++
      const record = Buffer.from(length + rest)
      blocks.push(header('PaxHeader', record.length, 'x'), pad(record))
    }
    const data = Buffer.from(content)
    blocks.push(header(name, data.length, '0'), pad(data))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
const integrity = packed => `sha512-${createHash('sha512').update(packed).digest('base64')}`
const libOf = url => /\/(gsap|three)\/-\//.exec(url)[1]
/** 两个假的库和它们的校验值；three 里有一个超过 100 个字的路径。 */
function fakeLibs() {
  const deep = `package/examples/jsm/${'addons/'.repeat(16)}Deep.js`
  const packs = {
    gsap: tgz({ 'package/package.json': '{"version":"3.15.0"}', 'package/dist/gsap.min.js': 'window.gsap={}' }),
    three: tgz({ 'package/package.json': '{"version":"0.186.1"}', 'package/build/three.module.js': 'export const REVISION="186"', [deep]: 'export {}' }),
  }
  return { packs, deep: deep.slice('package/'.length), libs: { gsap: { version: '3.15.0', integrity: integrity(packs.gsap) }, three: { version: '0.186.1', integrity: integrity(packs.three) } } }
}

test('where the bundled TeX goes: the data folder, or ProgramData when the user name is not plain ASCII', () => {
  assert.equal(texHome(path.join('C:', 'Users', 'a', 'AppData', 'Roaming', 'CampusAgent'), {}), path.join('C:', 'Users', 'a', 'AppData', 'Roaming', 'CampusAgent', 'tools', 'texlive'))
  assert.equal(texHome(path.join('C:', 'Users', '张三', 'AppData', 'Roaming', 'CampusAgent'), { ProgramData: 'C:\\ProgramData' }), path.join('C:\\ProgramData', 'CampusAgent', 'texlive'))
  assert.equal(texHome(path.join('C:', 'Users', 'Zhang San', 'CampusAgent'), { PROGRAMDATA: 'C:\\ProgramData' }), path.join('C:\\ProgramData', 'CampusAgent', 'texlive'))
  // 两处都不行时照第一处给，安装时再说明。
  assert.equal(texHome(path.join('D:', '数据'), {}), path.join('D:', '数据', 'tools', 'texlive'))
})

test('finds a TeX that is already on the machine, prefers the bundled one, and tells commands where it is', (t) => {
  const root = room(t), system = path.join(root, 'system-tex'), state = { disabled: [] }
  const env = { PATH: [path.join(root, 'nothing'), system].join(path.delimiter) }
  const kit = new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => state.disabled }, env, browsers: [path.join(root, 'no-browser.exe')] })
  assert.equal(part(kit, 'tex').state, 'missing')
  assert.equal(part(kit, 'browser').state, 'missing')
  assert.equal(part(kit, 'browser').installable, false)

  plant(system)
  assert.deepEqual([part(kit, 'tex').state, part(kit, 'tex').where], ['ready', 'system'])
  assert.equal(env.LEARN_TEX_BIN, undefined)

  // 应用自己装的那一份在时用它，位置写进环境变量；卸载以后回到本机原有的。
  plant(kit.ownBin())
  kit.apply()
  assert.deepEqual([part(kit, 'tex').state, part(kit, 'tex').where], ['ready', 'app'])
  assert.equal(env.LEARN_TEX_BIN, kit.ownBin())
  kit.remove({ id: 'tex' })
  assert.equal(fs.existsSync(kit.home), false)
  assert.equal(part(kit, 'tex').where, 'system')
  assert.equal(env.LEARN_TEX_BIN, undefined)
  assert.throws(() => kit.remove({ id: 'browser' }), /不能在这里卸载/)

  // 用户自己设的 LEARN_TEX_BIN 原样留着；设成 off 的就是不要 TeX。
  const own = { LEARN_TEX_BIN: system }
  assert.equal(part(new LearnKit({ elsewhere: () => [], dataDir: path.join(root, 'other'), plugins: { disabled: () => [] }, env: own }), 'tex').where, 'system')
  assert.equal(own.LEARN_TEX_BIN, system)
  assert.equal(part(new LearnKit({ elsewhere: () => [], dataDir: path.join(root, 'other'), plugins: { disabled: () => [] }, env: { LEARN_TEX_BIN: 'off', PATH: system } }), 'tex').state, 'missing')

  const browser = path.join(root, 'msedge.exe')
  fs.writeFileSync(browser, '')
  assert.equal(part(new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => [] }, env: {}, browsers: [path.join(root, 'none.exe'), browser] }), 'browser').state, 'ready')
})

test('installing TeX: tries mirrors in turn, reports progress, ends with a usable TeX', windows, async (t) => {
  const root = room(t), env = { PATH: '', SystemRoot: 'C:\\Windows', TEXMFHOME: 'elsewhere', HTTPS_PROXY: 'http://127.0.0.1:7890' }, calls = [], seen = []
  let kit
  const tools = {
    download: async (url, file, onProgress) => {
      calls.push(['download', url])
      if (url.startsWith('https://first')) throw new Error('first.example 回了 503')
      onProgress({ bytes: 50, total: 100 })
      seen.push({ ...kit.snapshot().parts[0] })
      fs.writeFileSync(file, 'zip')
    },
    run: async (command, args, options = {}) => {
      calls.push([path.basename(command), ...args.map(arg => path.basename(arg))])
      if (path.basename(command) === 'tar.exe') { fs.mkdirSync(path.join(args[3], 'install-tl-20260101')); return }
      if (path.basename(command) === 'install-tl-windows.bat') {
        // 安装程序拿到的是不带中文的临时目录，本机别的 TeX 的环境变量没带进来。
        assert.equal(options.env.TEXMFHOME, undefined)
        assert.equal(options.env.TEXLIVE_INSTALL_ENV_NOCHECK, '1')
        assert.match(fs.readFileSync(args[args.indexOf('-profile') + 1], 'utf8'), /selected_scheme scheme-infraonly[\s\S]*TEXDIR .*tools\/texlive\n[\s\S]*instopt_portable 1/)
        assert.equal(args[args.indexOf('-repository') + 1], 'https://second.example/tlnet')
        // 本机的代理设置也没带进来：安装程序直连镜像。
        assert.equal(options.env.HTTPS_PROXY, undefined)
        // 开头装它自己用的几个小包那一轮不算进度。
        options.onLine('Installing [3/3, time/total: 00:01/00:01]: texlive.infra [500k]')
        assert.equal(kit.snapshot().parts[0].percent, 5)
        options.onLine('Installing [049/098, time/total: 00:20/00:41]: latex [9000k]')
        seen.push({ ...kit.snapshot().parts[0] })
        fs.mkdirSync(kit.ownBin(), { recursive: true })
        fs.writeFileSync(path.join(kit.ownBin(), 'latex.exe'), '')
        return
      }
      // tlmgr install dvisvgm
      fs.writeFileSync(path.join(kit.ownBin(), 'dvisvgm.exe'), '')
    },
  }
  kit = new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => [] }, env, tools, mirrors: ['https://first.example/tlnet', 'https://second.example/tlnet'] })
  assert.equal(kit.install({ id: 'tex' }).parts[0].state, 'installing')
  // 已经在装时再点一次，不起第二次。
  kit.install({ id: 'tex' })
  assert.throws(() => kit.remove({ id: 'tex' }), /正在安装/)
  await kit.done
  assert.deepEqual(calls.map(call => call[0]), ['download', 'download', 'tar.exe', 'install-tl-windows.bat', 'tlmgr.bat'])
  assert.deepEqual(seen.map(item => [item.state, item.step, item.percent]), [['installing', '下载安装程序', 2], ['installing', '安装 TeX Live', 50]])
  assert.deepEqual([part(kit, 'tex').state, part(kit, 'tex').where, part(kit, 'tex').error], ['ready', 'app', ''])
  assert.equal(env.LEARN_TEX_BIN, kit.ownBin())
  assert.equal(fs.existsSync(`${kit.home}-setup`), false)
})

test('a failed install leaves nothing behind and says why; a closed plugin or an odd request installs nothing', windows, async (t) => {
  const root = room(t), state = { disabled: [] }
  const tools = { download: async () => { throw new Error('mirror.example 回了 404') }, run: async () => { assert.fail('不该走到这一步') } }
  const kit = new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => state.disabled }, env: { PATH: '' }, tools, mirrors: ['https://mirror.example/tlnet'] })
  assert.throws(() => kit.install({ id: 'browser' }), /不能在这里安装/)
  state.disabled = ['zju-learn']
  assert.equal(kit.snapshot().enabled, false)
  assert.throws(() => kit.install({ id: 'tex' }), /关着/)
  state.disabled = []
  kit.install({ id: 'tex' })
  await kit.done
  assert.deepEqual([part(kit, 'tex').state, part(kit, 'tex').error], ['missing', '连不上 TeX Live 的下载源：mirror.example 回了 404'])
  assert.equal(fs.existsSync(kit.home), false)
  assert.equal(fs.existsSync(`${kit.home}-setup`), false)

  // 装到一半出错：装了一半的文件夹删掉。
  const broken = new LearnKit({ elsewhere: () => [], dataDir: path.join(root, 'b'), plugins: { disabled: () => [] }, env: { PATH: '' }, mirrors: ['https://mirror.example/tlnet'], tools: {
    download: async (_url, file) => { fs.writeFileSync(file, 'zip') },
    run: async (command, args) => {
      if (path.basename(command) === 'tar.exe') { fs.mkdirSync(path.join(args[3], 'install-tl-20260101')); return }
      fs.mkdirSync(broken.ownBin(), { recursive: true })
      throw new Error('install-tl: 网络断了')
    },
  } })
  broken.install({ id: 'tex' })
  await broken.done
  assert.equal(part(broken, 'tex').error, 'install-tl: 网络断了')
  assert.equal(fs.existsSync(broken.home), false)
})

test('animation libraries: downloaded when the row opens, checked against npm, unpacked where lib.mjs looks', async (t) => {
  const root = room(t), env = {}, { packs, deep, libs } = fakeLibs(), urls = [], seen = []
  let kit
  const tools = {
    download: async (url, file, onProgress) => {
      urls.push(url)
      if (url.startsWith('https://mirror.example')) throw new Error('mirror.example 回了 502')
      onProgress({ bytes: 1, total: 2 })
      seen.push({ ...part(kit, 'libs') })
      fs.writeFileSync(file, packs[libOf(url)])
    },
    run: async () => { assert.fail('不该起程序') },
  }
  kit = new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => [] }, env, tools, libs, registries: ['https://mirror.example', 'https://npm.example'] })
  assert.equal(env.LEARN_LIBS, path.join(root, 'tools', 'learn-libs', 'node_modules'))
  assert.equal(part(kit, 'libs').state, 'missing')
  kit.prepare()
  // 已经在下时再叫一次，不起第二次。
  kit.prepare()
  assert.equal(part(kit, 'libs').state, 'installing')
  await kit.libsDone
  assert.deepEqual(urls, [
    'https://mirror.example/gsap/-/gsap-3.15.0.tgz', 'https://npm.example/gsap/-/gsap-3.15.0.tgz',
    'https://mirror.example/three/-/three-0.186.1.tgz', 'https://npm.example/three/-/three-0.186.1.tgz',
  ])
  assert.deepEqual(seen.map(item => [item.step, item.percent]), [['下载 gsap', 22], ['下载 three', 72]])
  assert.deepEqual([part(kit, 'libs').state, part(kit, 'libs').error], ['ready', ''])
  assert.equal(fs.readFileSync(path.join(env.LEARN_LIBS, 'gsap', 'dist', 'gsap.min.js'), 'utf8'), 'window.gsap={}')
  assert.equal(fs.readFileSync(path.join(env.LEARN_LIBS, 'three', ...deep.split('/')), 'utf8'), 'export {}')
  // 半截的临时文件不留下。
  assert.deepEqual(fs.readdirSync(env.LEARN_LIBS).sort(), ['gsap', 'three'])

  // 下好了再打开这一行，不再下载。
  kit.prepare()
  assert.equal(kit.libsJob, null)
  assert.equal(urls.length, 4)
})

test('animation libraries: a download that does not match is not used; a closed row downloads nothing; the page can retry', async (t) => {
  const root = room(t), state = { disabled: ['zju-learn'] }, { packs, libs } = fakeLibs()
  let good = false
  const tools = { download: async (url, file) => { fs.writeFileSync(file, good ? packs[libOf(url)] : 'not the package') }, run: async () => {} }
  const kit = new LearnKit({ elsewhere: () => [], dataDir: root, plugins: { disabled: () => state.disabled }, env: {}, tools, libs, registries: ['https://npm.example'] })
  kit.prepare()
  assert.equal(kit.libsJob, null)
  assert.throws(() => kit.install({ id: 'libs' }), /关着/)

  state.disabled = []
  kit.prepare()
  await kit.libsDone
  assert.deepEqual([part(kit, 'libs').state, part(kit, 'libs').error], ['missing', 'gsap 没有下载成：npm.example 给的和应有的不一样'])
  assert.deepEqual(fs.readdirSync(kit.libsDir), [])
  assert.throws(() => kit.remove({ id: 'libs' }), /不能在这里卸载/)

  good = true
  assert.equal(kit.install({ id: 'libs' }).parts.find(item => item.id === 'libs').state, 'installing')
  await kit.libsDone
  assert.deepEqual([part(kit, 'libs').state, part(kit, 'libs').error], ['ready', ''])
})

test('unpacking refuses paths that leave the folder', (t) => {
  const root = room(t), dir = path.join(root, 'out')
  assert.throws(() => untgz(tgz({ 'package/ok.js': '1', 'package/../../evil.js': '2' }), dir), /跑出目录/)
  assert.equal(fs.existsSync(path.join(root, 'evil.js')), false)
})
