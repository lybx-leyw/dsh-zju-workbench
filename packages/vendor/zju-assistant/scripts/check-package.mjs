import { spawnSync } from 'node:child_process'
import { assertPublicFiles } from './private-paths.cjs'

if (!process.env.npm_execpath) throw new Error('请通过 npm pack 或 npm publish 执行包检查。')
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8', windowsHide: true })
if (result.status !== 0) throw new Error('无法检查 npm 包文件清单。')
const packages = JSON.parse(result.stdout)
for (const pkg of packages) assertPublicFiles(pkg.files.map(file => file.path))
console.log(`发布文件检查通过：${packages.reduce((n, pkg) => n + pkg.files.length, 0)} 个文件。`)
