import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { align } from '../core/learn/tools/prep/zhiyun_align.mjs'

test('课堂截图对齐使用 Node，按偏移匹配字幕并生成总览；没有截图时给清楚错误', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-align-')), data = path.join(root, 'data'), plan = path.join(root, 'plan')
  t.after(() => { sharp.cache(false); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }) })
  fs.mkdirSync(path.join(data, 'slides'), { recursive: true })
  fs.writeFileSync(path.join(data, 'subtitles.json'), JSON.stringify({ captions: [{ start: 0, text: '之前' }, { start: 5, text: '第一张' }, { start: 15, text: '第二张' }] }))
  await assert.rejects(() => align(data, plan), /没有找到/)
  for (const [no, time] of [[1, 10], [2, 20]]) await sharp({ create: { width: 64, height: 36, channels: 3, background: 'white' } }).jpeg().toFile(path.join(data, 'slides', `${no}-${time}s.jpg`))
  const result = await align(data, plan, 5)
  assert.equal(result.slides, 2)
  assert.match(fs.readFileSync(result.timeline, 'utf8'), /第一张截图之前[\s\S]*之前[\s\S]*截图 1[\s\S]*第一张[\s\S]*截图 2[\s\S]*第二张/)
  const image = await sharp(path.join(plan, 'sheets/sheet-01.jpg')).metadata()
  assert.deepEqual([image.width, image.height], [1920, 1182])
})
