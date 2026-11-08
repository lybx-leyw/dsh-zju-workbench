import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { decode } from 'silk-wasm'
import { createRequire } from 'node:module'
import { SkillError } from '../../chat/common.mjs'

/** WXGF 预览要的 FFmpeg：用户在 FFMPEG_PATH 里指定的，或者开发时装的 ffmpeg-static。插件不带它，找不到时只有这一种图转不了，别的媒体照常存。 */
function findFfmpeg(): string | null {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try { return createRequire(import.meta.url)('ffmpeg-static') as string | null } catch { return null }
}

interface Resource { kind: string; name?: string; size?: number; path?: string; data?: string; variant?: string; status?: string }
interface ResolvedMedia { messageId: string; profilePath: string; resources: Resource[] }
const explanations: Record<string, string> = {
  media_not_local: '这份媒体尚未缓存在电脑上，请先在微信中打开或下载它。',
  image_key_unavailable: '未取得当前图片密钥，请在微信中打开这张图片后重试。',
  image_xor_unavailable: '尚未找到可验证的图片尾部密钥，请在微信中打开图片后重试。',
  image_decode_failed: '图片缓存解密失败。',
  unsupported_image: '当前图片缓存格式无法识别。',
  media_conversion_failed: '媒体转换失败，已保存的源文件保留在输出目录。',
  wechat_not_running: '电脑版微信没有运行，解图片要用到它，请打开并登录微信。',
  wechat_memory_denied: 'macOS 不让读取微信进程，图片解不开；系统完整性保护（SIP）开着时多半如此。',
  macos_build_failed: '无法编译或签名 Mac 上读微信用的小程序，需要 Xcode 命令行工具。',
}

export function wave(pcm: Uint8Array, rate = 24000) {
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(pcm.byteLength + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}

async function image(source: string, profile: string, destination: string) {
  if (process.platform === 'darwin') return (await import('./macos.mjs')).macImage(source, profile, destination) as Promise<{ file: string; format: string }>
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const helper = fileURLToPath(new URL('../scripts/local/read-image.ps1', import.meta.url))
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Source', source, '-Profile', profile, '-Destination', destination]
  const output = await promisify(execFile)(powershell, args, { windowsHide: true, timeout: 120000 })
    .then(r => r.stdout, e => e.stdout ?? '')
  let result: { file: string; format: string; error?: string }
  try { result = JSON.parse(output) } catch { throw new SkillError('image_decode_failed', explanations.image_decode_failed) }
  if (result.error) throw new SkillError(result.error, explanations[result.error] ?? explanations.image_decode_failed)
  return result
}

/** Keep the complete WXGF source and provide a viewable first frame. */
export async function wxgfPreview(file: string) {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new SkillError('media_conversion_failed', '这张图是 WXGF 格式，转成能看的图要 FFmpeg：请安装后把它的位置写进环境变量 FFMPEG_PATH。')
  const bytes = fs.readFileSync(file)
  const offset = bytes.indexOf(Buffer.from([0, 0, 0, 1, 0x40, 1]))
  if (offset < 0) throw new SkillError('media_conversion_failed', explanations.media_conversion_failed)
  const preview = file.replace(/\.wxgf$/, '.png')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg!, ['-v', 'error', '-f', 'hevc', '-i', 'pipe:0', '-frames:v', '1', '-n', preview], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new SkillError('media_conversion_failed', explanations.media_conversion_failed)))
    child.stdin.on('error', () => {})
    child.stdin.end(bytes.subarray(offset))
  })
  return preview
}

export async function saveMedia(result: ResolvedMedia, out: string) {
  if (!result.resources.some(r => r.path || r.data)) throw new SkillError('media_not_local', explanations.media_not_local)
  const root = path.resolve(out), relative = path.relative(result.profilePath, root)
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
    throw new SkillError('invalid_input', '请把媒体保存到微信数据目录之外。')
  fs.mkdirSync(root, { recursive: true })
  const id = createHash('sha256').update(result.messageId).digest('hex').slice(0, 10)
  const directory = fs.mkdtempSync(path.join(root, 'message-' + id + '-'))
  const files: Record<string, unknown>[] = [], failed: Record<string, unknown>[] = []
  for (const [i, resource] of result.resources.entries()) {
    if (resource.status) { failed.push({ index: i + 1, kind: resource.kind, status: resource.status, message: explanations[resource.status] }); continue }
    const prefix = path.join(directory, String(i + 1).padStart(3, '0'))
    try {
      let file: string, preview: string | undefined
      if (resource.kind === 'voice') {
        const pcm = await decode(resource.data ? Buffer.from(resource.data, 'base64') : fs.readFileSync(resource.path!), 24000)
        file = prefix + '.wav'
        fs.writeFileSync(file, wave(pcm.data), { flag: 'wx' })
      } else if (resource.kind === 'image' || resource.variant === 'thumbnail' || path.extname(resource.path!).toLowerCase() === '.dat') {
        const decoded = await image(resource.path!, result.profilePath, prefix)
        file = decoded.file
        if (decoded.format === 'wxgf') preview = await wxgfPreview(file)
      } else {
        const name = path.basename(resource.name || resource.path!).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(-160)
        file = prefix + '-' + name
        fs.copyFileSync(resource.path!, file, fs.constants.COPYFILE_EXCL)
      }
      files.push({ index: i + 1, kind: resource.kind, file, ...(preview ? { preview, previewFrames: 1 } : {}), variant: resource.variant, bytes: fs.statSync(file).size })
    } catch (error: any) {
      failed.push({ index: i + 1, kind: resource.kind, status: error.status ?? 'media_export_failed', message: explanations[error.status] ?? '保存媒体失败。' })
    }
  }
  if (!files.length) throw new SkillError(String(failed[0]?.status ?? 'media_export_failed'), String(failed[0]?.message ?? '没有保存任何媒体。'), { directory, failed })
  return { ok: true, messageId: result.messageId, directory, files, failed, complete: failed.length === 0 }
}
