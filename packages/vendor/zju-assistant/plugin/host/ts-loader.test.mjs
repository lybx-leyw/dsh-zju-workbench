import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const LOADER = `--import=${new URL('./ts-loader.mjs', import.meta.url).href}`

test('node_modules 里的 .ts 靠 ts-loader.mjs 能跑，core 再起的 Node 子进程也带着它', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-ts-loader-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pkg = path.join(root, 'node_modules', 'demo')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"type":"module"}')
  fs.writeFileSync(path.join(pkg, 'add.ts'), 'export const add = (a: number, b: number): number => a + b\n')
  fs.writeFileSync(path.join(pkg, 'child.ts'), "import { add } from './add.ts'\nconsole.log(add(2, 3))\n")
  fs.writeFileSync(path.join(pkg, 'main.ts'), [
    "import { execFileSync } from 'node:child_process'",
    "import { fileURLToPath } from 'node:url'",
    "import { add } from './add.ts'",
    "const child: string = execFileSync(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))], { encoding: 'utf8' })",
    'console.log(add(1, 1), child.trim())',
  ].join('\n'))
  const run = (env) => spawnSync(process.execPath, [path.join(pkg, 'main.ts')], { encoding: 'utf8', env: { ...process.env, ...env } })
  assert.match(run({}).stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/, '不挂钩子时 Node 不肯跑')
  const { stdout, stderr } = run({ NODE_OPTIONS: LOADER })
  assert.equal(stdout.trim(), '2 5')
  assert.equal(stderr, '', '实验特性的警告不混进 stderr')
})
