import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { assertPublicFiles } from './private-paths.cjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staged = process.argv.includes('--staged')
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('无法读取待发布的 Git 文件清单。')
  return result.stdout
}
const files = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z']).split('\0').filter(Boolean)
assertPublicFiles(files)
if (!staged) {
  const historical = git(['log', '--all', '--format=', '--name-only', '-z']).split('\0').map(name => name.replace(/^\n+/, '')).filter(Boolean)
  // Retired product source may remain in old releases; private material may not.
  assertPublicFiles([...new Set(historical)], { allowRetired: true })
}
const configured = spawnSync('git', ['config', '--local', '--get', 'security.gitleaksPath'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim()
const binary = process.env.GITLEAKS_BIN || configured || 'gitleaks'
if (configured && !process.env.GITLEAKS_BIN && !fs.existsSync(configured)) throw new Error('本机 Gitleaks 路径已失效，请安装 Gitleaks 8.30.1 并更新 security.gitleaksPath。')
const result = spawnSync(binary, ['git', root, '--redact=100', '--no-banner', ...(staged ? ['--pre-commit', '--staged'] : ['--log-opts=--all'])], { cwd: root, stdio: 'inherit', windowsHide: true })
if (result.error) throw new Error('缺少 Gitleaks 8.30.1。安装后加入 PATH，或设置 GITLEAKS_BIN。')
if (result.status !== 0) process.exitCode = result.status || 1
else console.log(`凭据与发布范围检查通过（${staged ? '暂存区' : '已跟踪文件及全部历史'}）。`)
