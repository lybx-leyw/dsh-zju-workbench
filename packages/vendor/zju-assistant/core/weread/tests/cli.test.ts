import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/weread.ts', import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-cli-'))
test.after(() => fs.rmSync(directory, { recursive: true, force: true }))
const run = (...args: string[]) => runWith({}, ...args)
const runWith = (extra: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, WEREAD_DATA_DIR: directory, ...extra }, windowsHide: true, encoding: 'utf8' })

test('help lists every command', () => {
  const result = run('--help')
  assert.equal(result.status, 0)
  assert.deepEqual([...result.stdout.matchAll(/^  (\w+) /gm)].map(match => match[1]), ['login', 'logout', 'accounts', 'list', 'read', 'download', 'track', 'new', 'help'])
})

test('results and errors are JSON; bad arguments fail before any source is touched', () => {
  assert.deepEqual(JSON.parse(run('track').stdout), { ok: true, tracked: [] })
  assert.deepEqual(JSON.parse(run('list').stdout), { ok: true, state: null, accounts: [] }, 'with nothing tracked there is nothing to look up')
  for (const [args, status] of [[['read', '--url', 'https://example.com/a'], 'invalid_link'], [['read', '--account', '测试号'], 'invalid_input'], [['new'], 'nothing_tracked']] as const) {
    const result = run(...args)
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, status)
  }
  for (const args of [['list', '--account', '测试号', '--limit', '0'], ['download', '--url', 'https://mp.weixin.qq.com/s/abc']]) {
    const result = run(...args)
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /error:/)
  }
  const off = runWith({ WEREAD_DISABLED: '1' }, 'track')
  assert.deepEqual([off.status, JSON.parse(off.stdout).status], [1, 'plugin_disabled'], 'a host that switched the feature off stops every command')
  assert.deepEqual(fs.readdirSync(directory), [], 'nothing above needed a browser profile or wrote any state')
})

test('a relative --out given from inside the skill folder is saved under the data folder, not next to the code', () => {
  const source = `import { outPath } from ${JSON.stringify(new URL('../lib/config.ts', import.meta.url).href)}; console.log(JSON.stringify(process.argv.slice(1).map(cwd => outPath('saved', cwd))))`
  const root = fileURLToPath(new URL('..', import.meta.url)), elsewhere = fs.realpathSync(os.tmpdir())
  // The skill folder is where the app is installed: read-only under C:\Program Files, and replaced on every upgrade.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, root, path.join(root, 'scripts'), elsewhere, path.dirname(path.resolve(root))], { env: { ...process.env, WEREAD_DATA_DIR: directory }, windowsHide: true, encoding: 'utf8' })
  const inData = path.join(directory, 'downloads', 'saved')
  assert.deepEqual(JSON.parse(result.stdout), [inData, inData, path.join(elsewhere, 'saved'), path.join(path.dirname(path.resolve(root)), 'saved')])
})

test('the vision model comes from .env, and real environment variables win', () => {
  const file = path.join(os.tmpdir(), `weread-env-${process.pid}`)
  fs.writeFileSync(file, 'WEREAD_VISION_ENDPOINT=https://model.example/chat\nWEREAD_VISION_MODEL=from-file\nWEREAD_VISION_AUDIO_INPUT=false\n')
  try {
    const source = `import { visionConfig } from ${JSON.stringify(new URL('../lib/config.ts', import.meta.url).href)}; console.log(JSON.stringify(visionConfig() ?? null))`
    const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEREAD_')))
    const config = (extra: Record<string, string>) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...env, ...extra }, cwd: os.tmpdir(), windowsHide: true, encoding: 'utf8' }).stdout)
    assert.deepEqual(config({ WEREAD_ENV_FILE: file }), { endpoint: 'https://model.example/chat', model: 'from-file', audioInput: false })
    assert.equal(config({ WEREAD_ENV_FILE: file, WEREAD_VISION_MODEL: 'from-env' }).model, 'from-env')
    assert.equal(config({ WEREAD_ENV_FILE: file + '.missing' }), null, 'no model configured: the user completes verification in the window')
  } finally { fs.rmSync(file, { force: true }) }
})
