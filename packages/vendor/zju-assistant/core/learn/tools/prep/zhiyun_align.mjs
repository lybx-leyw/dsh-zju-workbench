/** Align downloaded slides and captions; uses the app's Node and sharp, not TTS/Python. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
const clock = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`
export async function align(dataDir, planDir, shift = 0) {
  if (!Number.isFinite(shift)) throw new Error('字幕偏移必须为秒数。')
  const slides = fs.readdirSync(path.join(dataDir, 'slides')).flatMap(name => {
    const hit = /^(\d+)-(\d+)s\.jpg$/i.exec(name)
    return hit ? [{ number: Number(hit[1]), time: Number(hit[2]), file: path.join(dataDir, 'slides', name) }] : []
  }).sort((a, b) => a.time - b.time || a.number - b.number)
  if (!slides.length) throw new Error('没有找到 slides/<序号>-<秒数>s.jpg 截图。')
  const { captions } = JSON.parse(fs.readFileSync(path.join(dataDir, 'subtitles.json'), 'utf8'))
  if (!Array.isArray(captions) || captions.some(c => !Number.isFinite(c.start) || typeof c.text !== 'string')) throw new Error('subtitles.json 的字幕格式不正确。')
  const said = rows => rows.map(c => `[${clock(c.start)}] ${c.text}`).join('\n')
  let text = `# 截图和字幕对照\n\n字幕是自动识别的，定义、公式、数字以截图为准。\n\n字幕按偏移 ${shift} 秒对到截图上；先核对几处内容再使用。\n`
  const before = captions.filter(c => c.start + shift < slides[0].time)
  if (before.length) text += `\n## 第一张截图之前\n\n${said(before)}\n`
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i], end = slides[i + 1]?.time ?? Infinity
    text += `\n## 截图 ${slide.number}（${clock(slide.time)}）\n\n${said(captions.filter(c => c.start + shift >= slide.time && c.start + shift < end)) || '（这一页上没有字幕）'}\n`
  }
  const sheets = path.join(planDir, 'sheets')
  fs.mkdirSync(sheets, { recursive: true })
  fs.writeFileSync(path.join(planDir, 'timeline.md'), text)
  for (let i = 0; i < slides.length; i += 9) {
    const layers = []
    for (const [at, slide] of slides.slice(i, i + 9).entries()) {
      const left = at % 3 * 640, top = Math.floor(at / 3) * 394
      layers.push({ input: await sharp(slide.file).resize(640, 360, { fit: 'contain', background: 'white' }).toBuffer(), left, top: top + 34 })
      const label = `<svg width="640" height="34"><rect width="640" height="34" fill="white"/><text x="8" y="25" font-family="sans-serif" font-size="22">${slide.number}   ${clock(slide.time)}</text></svg>`
      layers.push({ input: Buffer.from(label), left, top })
    }
    await sharp({ create: { width: 1920, height: 1182, channels: 3, background: 'white' } }).composite(layers).jpeg({ quality: 88 }).toFile(path.join(sheets, `sheet-${String(i / 9 + 1).padStart(2, '0')}.jpg`))
  }
  return { slides: slides.length, captions: captions.length, timeline: path.resolve(planDir, 'timeline.md'), sheets: Math.ceil(slides.length / 9) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) { console.error('用法：node "<SKILL>/tools/prep/zhiyun_align.mjs" <资料目录> <计划目录> [偏移秒数]'); process.exitCode = 1 }
  else align(path.resolve(process.argv[2]), path.resolve(process.argv[3]), Number(process.argv[4] || 0)).then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1 })
}
