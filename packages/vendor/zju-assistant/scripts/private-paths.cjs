const path = require('node:path')
const fs = require('node:fs')

/** Publishing policy shared by Git checks, npm packaging and desktop packaging. */
function isPrivatePath(name) {
  const normalized = name.replaceAll('\\', '/').replace(/^\.\//, '')
  const parts = normalized.split('/'), base = parts.at(-1).toLowerCase()
  if (parts.some(part => ['.git', '.claude', '.codex', '.cursor', '.vscode', 'backup', 'plans', '计划', 'contest', 'video', 'voicelab', 'dev'].includes(part.toLowerCase()))) return true
  if (['agents.md', 'claude.md', '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519'].includes(base)) return true
  if (base === 'development.md') return true
  if (/^(?:\.env|profile\.env)(?:\.|$)/.test(base) && !/(?:^|\.)example$/.test(base)) return true
  if (/(?:^|\.)local\.(?:ya?ml|json)$/.test(base)) return true
  if (/^\.?(?:accounts?|credentials?|secrets?|cookies?|sessions?|tokens?)\.(?:jsonl?|ya?ml|txt)(?:\..*)?$/.test(base)) return true
  if (/\.(?:pem|key|p12|pfx|har|db(?:-.*)?|sqlite(?:3)?(?:-.*)?)$/.test(base)) return true
  return /^core\/.*(?:^|\/)(?:data|downloads|out)\//.test(normalized)
}

function isRetiredPath(name) {
  const file = name.replaceAll('\\', '/').toLowerCase()
  return /^(desktop|ui|build|core\/mail|core\/learn\/tools\/tts|scripts\/review-eval|scripts\/build-deps)\//.test(file)
    || ['app.patch.yml', 'api-keys.example.yaml', 'core/agent.md', 'docs/cover.jpg', '.github/workflows/mac.yml'].includes(file)
    || /^scripts\/(?:after-pack(?:\.test)?|before-pack|build-dependencies\.test|runtime-deps(?:\.test)?|smoke-packaged)\.cjs$/.test(file)
    || /^scripts\/(?:after-pack|build-dependencies|runtime-deps)\.test\.mjs$/.test(file)
    || file === 'scripts/installer.nsh'
    // Development references (protocol research, dated test notes) and desktop-only leftovers, removed from releases on 2026-11-04.
    || /^core\/zju\/(?:lib\/(?:[^/]+\/)*)?readme\.md$/.test(file)
    || ['core/weread/readme.md', 'core/skills/readme.md', 'start.cmd', 'start.command'].includes(file)
    || file.startsWith('core/skills/skill-writer/')
}

function assertPublicFiles(files, { allowRetired = false } = {}) {
  const bad = files.filter(file => isPrivatePath(file) || (!allowRetired && isRetiredPath(file)))
  if (bad.length) throw new Error(`发布范围包含本机资料或凭据文件：\n${bad.join('\n')}`)
}

function checkPublishedTree(root) {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Third-party dependencies have their own package manifests; inspect our files only.
      if (entry.name === 'node_modules') continue
      const absolute = path.join(dir, entry.name), relative = path.relative(root, absolute)
      if (entry.isSymbolicLink()) throw new Error(`发布目录中存在未审核的符号链接：${relative}`)
      if (entry.isDirectory()) walk(absolute)
      else files.push(relative)
    }
  }
  walk(root)
  assertPublicFiles(files)
  return files.length
}

function copyPublicTree(from, to, sourceRoot) {
  const stat = fs.lstatSync(from)
  if (stat.isSymbolicLink()) throw new Error(`打包源文件不能是符号链接：${path.relative(sourceRoot, from)}`)
  if (!stat.isDirectory()) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); return }
  for (const entry of fs.readdirSync(from)) {
    if (['node_modules', 'tests', '__pycache__'].includes(entry) || entry.endsWith('.test.mjs') || entry.endsWith('.pyc')) continue
    const child = path.join(from, entry)
    const published = `core/${path.relative(sourceRoot, child)}`
    if (isPrivatePath(published) || isRetiredPath(published)) continue
    copyPublicTree(child, path.join(to, entry), sourceRoot)
  }
}
module.exports = { isPrivatePath, isRetiredPath, assertPublicFiles, checkPublishedTree, copyPublicTree }
