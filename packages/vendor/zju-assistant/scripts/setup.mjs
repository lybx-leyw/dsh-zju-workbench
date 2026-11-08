/** Root npm ci/install prepares every independently locked Core. No Python or models. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORES = ['core/zju', 'core/weread', 'core/wechat', 'core/dingtalk', 'core/learn/engine/vendor']
const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== 24 || minor < 18) throw new Error('开发与打包请使用 Node.js 24.18 以上的 24.x 版本。')
const npm = process.env.npm_execpath
if (!npm || !fs.existsSync(npm)) throw new Error('请通过 npm run setup 执行，或在根目录执行 npm ci。')
// Electron is a development dependency used by the WeRead browser adapter tests,
// not an application shell or part of the DSH plugin package.
console.log('准备微信公众号浏览器适配器测试所需的运行时')
createRequire(import.meta.url)('electron')
for (const core of CORES) {
  console.log(`安装 ${core} 的锁定依赖`)
  await new Promise((resolve, reject) => {
    // The OS keyring binding in ZJU Core selects its native binary through optionalDependencies.
    const args = [npm, 'ci', '--no-audit', '--no-fund', '--include=dev', ...(core === 'core/zju' || core.endsWith('/vendor') ? [] : ['--omit=optional'])]
    const child = spawn(process.execPath, args, { cwd: path.join(root, core), stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${core} 安装失败（${code}）`)))
  })
}
console.log('依赖已齐备。配音运行环境和模型仅由插件页按需安装。')
