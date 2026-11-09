import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createCipheriv, createHmac, pbkdf2Sync } from 'node:crypto'

const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe'
)
const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
const localFile = (name) => fileURLToPath(new URL('../scripts/local/' + name, import.meta.url))

test(
  'Windows PowerShell 5.1 compiles, authenticates and pipes a snapshot through Unicode paths',
  { skip: process.platform !== 'win32' },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-本地 兼容-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    // Entirely synthetic page/key; this test never opens WeChat or a user's database.
    const key = Buffer.alloc(32, 7),
      salt = Buffer.alloc(16, 9),
      iv = Buffer.alloc(16, 11)
    const plain = Buffer.alloc(4016)
    plain.write('SQLite format 3\0')
    plain.writeUInt32BE(1, 28)
    const cipher = createCipheriv('aes-256-cbc', key, iv)
    cipher.setAutoPadding(false)
    const payload = Buffer.concat([cipher.update(plain.subarray(16)), cipher.final(), iv])
    const macKey = pbkdf2Sync(
      key,
      salt.map((b) => b ^ 0x3a),
      2,
      32,
      'sha512'
    )
    const signature = createHmac('sha512', macKey)
      .update(payload)
      .update(Buffer.from([1, 0, 0, 0]))
      .digest()
    const database = path.join(directory, 'biz_message_0.db')
    fs.writeFileSync(database, Buffer.concat([salt, payload, signature]))
    // 解析那一步由跑技能的这一份 Node 来做；这里换成一个只核对输入、回一大段 JSON 的替身。
    const helper = path.join(directory, '解析 器.mjs')
    fs.writeFileSync(
      helper,
      `const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const data = Buffer.concat(chunks)
if (data.length !== 4096 || data.subarray(0, 16).toString('latin1') !== 'SQLite format 3\\0' || data[18] !== 1 || data[19] !== 1) process.exit(1)
process.stdout.write(JSON.stringify({ text: '中文'.repeat(200000) }).replace(/[\\u0080-\\uffff]/g, c => '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\\n')
`
    )
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
    $OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Expected Windows PowerShell 5.1'}
    Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(localFile('runtime-key.cs'))})+[IO.File]::ReadAllText(${quote(localFile('snapshot.cs'))}))
    $key=[Convert]::FromBase64String(${quote(key.toString('base64'))})
    [WeixinResearch.BizSnapshot]::Inspect($key,${quote(database)},${quote(process.execPath)},${quote(helper)})`
    const run = () =>
      execFileSync(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64')
        ],
        {
          windowsHide: true,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 5 * 1024 * 1024,
          timeout: 20000
        }
      )
    assert.equal(
      JSON.parse(run()).text,
      '中文'.repeat(200000),
      'large JSON is passed through as text, without the PS 5.1 JSON parser limit'
    )
    const corrupt = fs.readFileSync(database)
    corrupt[100] ^= 1
    fs.writeFileSync(database, corrupt)
    assert.throws(run, 'a modified page must fail authentication')
  }
)
