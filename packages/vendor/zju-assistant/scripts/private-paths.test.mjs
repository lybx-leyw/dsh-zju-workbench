import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPrivatePath, assertPublicFiles, copyPublicTree, checkPublishedTree } from './private-paths.cjs'

test('credentials, session dumps, local variants and development archives cannot ship', () => {
  for (const file of ['host/.env.local', 'core/zju/lib/.env.production', 'core/zju/scripts/profile.env', 'host/accounts.json', 'host/.credentials.yaml', 'skill/cookies.txt', 'rows/session.json.bak', 'core/foo/token.json', 'key.pem', 'client.p12', 'capture.har', 'chat.db-wal', 'state.sqlite3', 'video/demo/run.mjs', 'core/weread/dev/verification.md', 'plans/a.md', 'core/zju/data/auth.json', 'core/foo/downloads/page.html']) {
    assert.equal(isPrivatePath(file), true, file)
    assert.throws(() => assertPublicFiles([file]), /凭据文件/)
  }
})
test('the real copy operation excludes local credentials and refuses indirect files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-public-copy-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'), target = path.join(root, 'package')
  fs.mkdirSync(source)
  for (const name of ['module.mjs', '.env.example', '.env.local', 'accounts.json', 'cookies.txt', 'profile.env']) fs.writeFileSync(path.join(source, name), 'fixture')
  copyPublicTree(source, target, source)
  assert.deepEqual(fs.readdirSync(target).sort(), ['.env.example', 'module.mjs'])
  assert.equal(checkPublishedTree(target), 2)
  fs.writeFileSync(path.join(target, 'accounts.json'), 'fixture')
  assert.throws(() => checkPublishedTree(target), /凭据文件/)
  const elsewhere = path.join(root, 'elsewhere'); fs.mkdirSync(elsewhere)
  fs.symlinkSync(elsewhere, path.join(source, 'indirect'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => copyPublicTree(source, target, source), /符号链接/)
})
test('packing skips development references even when a sync puts them back into core/', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-public-docs-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'core'), target = path.join(root, 'package')
  fs.mkdirSync(path.join(source, 'zju', 'lib', 'zdbk'), { recursive: true })
  for (const name of ['zju/README.md', 'zju/SKILL.md', 'zju/lib/README.md', 'zju/lib/zdbk/README.md', 'zju/lib/zdbk/client.ts']) fs.writeFileSync(path.join(source, name), 'fixture')
  copyPublicTree(path.join(source, 'zju'), path.join(target, 'zju'), source)
  assert.deepEqual(fs.readdirSync(path.join(target, 'zju')).sort(), ['SKILL.md', 'lib'])
  assert.deepEqual(fs.readdirSync(path.join(target, 'zju', 'lib', 'zdbk')), ['client.ts'])
  assert.equal(fs.existsSync(path.join(target, 'zju', 'lib', 'README.md')), false)
})
test('runtime skills, public examples, licenses and credential-handling source remain publishable', () => {
  assertPublicFiles(['core/zju/SKILL.md', 'core/zju/lib/core/credential-vault.mjs', 'core/zju/lib/module.json', 'core/weread/LICENSE-Tencent', '.env.example', '.env.production.example', 'host/account.mjs', 'core/zju/references/commands.md',
    'README.md', 'plugin/README.md', 'plugin/bundle/README.md', 'core/weread/SKILL.md', 'core/skills/course-study/SKILL.md', 'core/learn/engine/vendor/node_modules/three/README.md'])
})
test('retired desktop files cannot be reintroduced, while public release history remains readable', () => {
  for (const file of ['desktop/main.cjs', 'ui/host.js', 'build/icon.ico', 'app.patch.yml', '.github/workflows/mac.yml', 'scripts/after-pack.cjs', 'core/AGENT.md', 'core/learn/tools/tts/app.py',
    'core/zju/README.md', 'core/zju/lib/README.md', 'core/zju/lib/zdbk/README.md', 'core/weread/README.md', 'core/skills/README.md', 'core/skills/skill-writer/SKILL.md', 'start.cmd', 'start.command']) {
    assert.throws(() => assertPublicFiles([file]))
    assert.doesNotThrow(() => assertPublicFiles([file], { allowRetired: true }))
  }
  assert.throws(() => assertPublicFiles(['plans/private.md'], { allowRetired: true }))
})
