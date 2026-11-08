import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createCipheriv } from 'node:crypto'
import { encode, getWavFileInfo } from 'silk-wasm'
import { saveMedia, wxgfPreview } from '../lib/chat-media.ts'

test('SILK becomes playable WAV; exported files preserve bytes and report missing resources', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-media-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source.txt')
  fs.writeFileSync(source, '附件原文')
  const pcm = Buffer.alloc(24000 * 2)
  for (let i = 0; i < 24000; i++)
    pcm.writeInt16LE(Math.round(3000 * Math.sin((i * 2 * Math.PI * 440) / 24000)), i * 2)
  const silk = await encode(pcm, 24000)
  const result = await saveMedia(
    {
      messageId: 'synthetic:1',
      profilePath: path.join(directory, 'profile'),
      resources: [
        { kind: 'voice', data: Buffer.from(silk.data).toString('base64'), variant: 'original' },
        { kind: 'file', path: source, name: '附件.txt', variant: 'original' },
        { kind: 'image', status: 'media_not_local' }
      ]
    },
    path.join(directory, 'output')
  )
  assert.equal(result.files.length, 2)
  assert.equal(result.failed.length, 1)
  assert.equal(result.complete, false)
  const wav = fs.readFileSync(String(result.files[0].file))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(getWavFileInfo(wav).fmt.sampleRate, 24000)
  assert.equal(fs.readFileSync(String(result.files[1].file), 'utf8'), '附件原文')
})

test(
  'shared image decoder restores padded AES, unencrypted middle and XOR tail without reading a process',
  { skip: process.platform !== 'win32' },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-image-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const plain = Buffer.alloc(2000, 17)
    plain.set([255, 216, 255, 224])
    plain.set([255, 217], 1998)
    const header = Buffer.alloc(15)
    header.set([7, 8, 86, 49, 8, 7])
    header.writeUInt32LE(1024, 6)
    header.writeUInt32LE(100, 10)
    const cipher = createCipheriv('aes-128-ecb', Buffer.from('cfcd208495d565ef'), null)
    const encrypted = Buffer.concat([
      header,
      cipher.update(plain.subarray(0, 1024)),
      cipher.final(),
      plain.subarray(1024, 1900),
      plain.subarray(1900).map((b) => b ^ 93)
    ])
    const input = path.join(directory, 'synthetic.dat')
    fs.writeFileSync(input, encrypted)
    const output = path.join(directory, 'decoded.jpg')
    const quote = (v) => "'" + v.replaceAll("'", "''") + "'"
    const sources = ['runtime-key.cs', 'snapshot.cs', 'image-key.cs']
      .map(
        (n) =>
          `[IO.File]::ReadAllText(${quote(fileURLToPath(new URL('../scripts/local/' + n, import.meta.url)))})`
      )
      .join('+')
    const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (${sources}); $bytes=[WeixinBizDbProbe]::DecodeImage(-1,${quote(input)},${quote(directory)}); [IO.File]::WriteAllBytes(${quote(output)},$bytes)`
    execFileSync(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'pipe' }
    )
    assert.deepEqual(fs.readFileSync(output), plain)
  }
)

const ffmpeg = (() => {
  try {
    return createRequire(import.meta.url)('ffmpeg-static')
  } catch {
    return null
  }
})()

test('without FFmpeg a WXGF preview fails with its own reason instead of breaking the module', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-wxgf-'))
  const saved = process.env.FFMPEG_PATH
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
    if (saved === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = saved
  })
  process.env.FFMPEG_PATH = path.join(directory, 'no-such-ffmpeg.exe')
  const file = path.join(directory, 'test.wxgf')
  fs.writeFileSync(file, 'wxgf')
  await assert.rejects(wxgfPreview(file), { status: 'media_conversion_failed' })
})

test('FFmpeg produces a PNG preview while preserving the complete WXGF source', { skip: ffmpeg ? false : 'ffmpeg-static is not installed' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-wxgf-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const stream = execFileSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=blue:size=64x64:rate=1',
      '-frames:v',
      '1',
      '-c:v',
      'libx265',
      '-f',
      'hevc',
      'pipe:1'
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const file = path.join(directory, 'test.wxgf')
  fs.writeFileSync(file, Buffer.concat([Buffer.from('wxgf'), stream]))
  const preview = await wxgfPreview(file)
  assert.equal(fs.readFileSync(preview).subarray(1, 4).toString(), 'PNG')
  assert(fs.existsSync(file))
})
