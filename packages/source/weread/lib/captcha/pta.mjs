import { SkillError } from '../errors.mjs'

/**
 * PTA 单拼块：在原图上沿 x 做归一化相关匹配，允许缺口处变暗。
 * 去掉透明边缘和白色描边，只比较内部纹理；坐标保留拼块的透明边距。
 * 本函数也在浏览器中运行，不依赖 Node、模型或第三方图像库。
 */
export function matchPtaSlider(background, piece, position) {
  const valid = image => Number.isInteger(image?.width) && Number.isInteger(image?.height)
    && image.width > 0 && image.width <= 2048 && image.height > 0 && image.height <= 1024
    && image.data?.length === image.width * image.height * 4
  if (!valid(background) || !valid(piece) || piece.width > 256 || piece.height > 256
    || piece.width >= background.width || !Number.isInteger(position?.y)
    || position.y < 0 || position.y + piece.height > background.height) return undefined
  const grey = (data, i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  const points = []
  for (let y = 3; y < piece.height - 3; y++) for (let x = 3; x < piece.width - 3; x++) {
    let inside = true
    for (let d = -3; d <= 3; d++) {
      if (piece.data[((y + d) * piece.width + x) * 4 + 3] < 250
        || piece.data[(y * piece.width + x + d) * 4 + 3] < 250) { inside = false; break }
    }
    if (inside) points.push({ x, y, value: grey(piece.data, (y * piece.width + x) * 4) })
  }
  if (points.length < 100) return undefined
  // 大拼块均匀采样，限制页面计算量；不改变原图坐标。
  const samples = points.filter((_point, i) => i % Math.ceil(points.length / 4096) === 0)
  const mean = samples.reduce((sum, p) => sum + p.value, 0) / samples.length
  const variance = samples.reduce((sum, p) => sum + (p.value - mean) ** 2, 0)
  if (variance / samples.length < 4) return undefined
  const matches = []
  for (let x = 0; x <= background.width - piece.width; x++) {
    let sum = 0, squares = 0, covariance = 0
    for (const p of samples) {
      const value = grey(background.data, ((position.y + p.y) * background.width + x + p.x) * 4)
      sum += value; squares += value * value; covariance += (p.value - mean) * value
    }
    const denominator = Math.sqrt(variance * Math.max(0, squares - sum * sum / samples.length))
    matches.push({ x, score: denominator ? covariance / denominator : 0 })
  }
  matches.sort((a, b) => b.score - a.score)
  // 平滑背景在同一缺口附近会形成宽峰；把这段视作一个候选，再比较远处的竞争缺口。
  const best = matches[0], other = matches.find(item => Math.abs(item.x - best.x) > Math.max(5, Math.round(piece.width / 6)))
  // 多个相近候选、低纹理或不匹配时交还官方窗口，不猜坐标、不调用模型。
  if (best.score < 0.75 || best.score - (other?.score ?? 0) < 0.05) return undefined
  return { targetX: best.x, targetY: position.y }
}

async function recognizeInPage(puzzle, match) {
  const decode = async source => {
    if (typeof source !== 'string' || !source.startsWith('data:image/png;base64,') || source.length > 12 * 1024 * 1024) return null
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('PTA image decode failed')); image.src = source })
    const width = image.naturalWidth, height = image.naturalHeight
    if (!width || width > 2048 || !height || height > 1024) return null
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, width, height)
  }
  const [background, piece] = await Promise.all([decode(puzzle.background.image), decode(puzzle.piece.image)])
  if (background?.width !== puzzle.background.width || background?.height !== puzzle.background.height
    || piece?.width !== puzzle.piece.width || piece?.height !== puzzle.piece.height) return null
  return match(background, piece, puzzle.piece) ?? null
}

/** 只使用当前验证码已经加载的 PNG，在本机浏览器里解码、匹配。 */
export class PtaSliderRecognizer {
  constructor(webContents) { this.webContents = webContents }
  async recognize(puzzle) {
    puzzle.signal?.throwIfAborted()
    if (puzzle.kind !== 'slider') throw new SkillError('unsupported_verification', 'PTA 本地模式只支持单拼块滑块，请在官方窗口完成当前题。')
    const input = { background: puzzle.background, piece: puzzle.piece }
    const answer = await this.webContents.executeJavaScript(`(${recognizeInPage.toString()})(${JSON.stringify(input)},${matchPtaSlider.toString()})`)
    puzzle.signal?.throwIfAborted()
    if (!answer) throw new SkillError('recognition_uncertain', 'PTA 滑块缺口匹配不确定，请在官方窗口完成当前题。')
    return answer
  }
}
