/**
 * 智云转音频、合并回放要 FFmpeg。不随插件带：ffmpeg-static 靠安装脚本下载，pnpm 默认拦下这类脚本，要用户点「允许这些脚本并重试」。
 * 改成第一次要用时由这里下载同一份预编译文件（ffmpeg-static 5.3.0 用的 b6.1.1），核对 SHA-256 以后放到 ZJU Core 自己会找的位置：
 * <数据目录>/tools/zhiyun-media/node_modules/ffmpeg-static/ffmpeg(.exe)（core/zju/lib/zhiyun/ffmpeg.ts 的 ffmpegPath）。
 * 用户自己设了 FFMPEG_PATH 的，core 先用那个，这里不会被叫到。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
/** 各系统和芯片那一份 .gz 的 SHA-256，2026-11-02 从发布页下载后算的。 */
const BUILDS = {
  'win32-x64': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'darwin-x64': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
  'darwin-arm64': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  'linux-x64': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
}

/** ZJU Core 找 FFmpeg 的那个位置。 */
export function ffmpegFile(dataDir, platform = process.platform) {
  return path.join(dataDir, 'tools', 'zhiyun-media', 'node_modules', 'ffmpeg-static', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

let running

/** 没有就下载；同时只下一份。返回放好的路径。fetchImpl 测试时换成假的。 */
export function ensureFfmpeg(dataDir, { platform = process.platform, arch = process.arch, fetchImpl = fetch } = {}) {
  const file = ffmpegFile(dataDir, platform)
  if (fs.existsSync(file)) return Promise.resolve(file)
  running ??= (async () => {
    const build = `${platform}-${arch}`, digest = BUILDS[build]
    if (!digest) throw new Error(`这种系统（${build}）没有现成的 FFmpeg，请自己装一个，并在环境变量 FFMPEG_PATH 里写上它的位置。`)
    const response = await fetchImpl(`${RELEASE}/ffmpeg-${build}.gz`, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok) throw new Error(`FFmpeg 没有下载成（${response.status}），稍后再试。`)
    const packed = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(packed).digest('hex') !== digest) throw new Error('下载到的 FFmpeg 和应有的不一样，没有使用，稍后再试。')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, gunzipSync(packed), { mode: 0o755 })
      fs.renameSync(temp, file)
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
    return file
  })().finally(() => { running = undefined })
  return running
}

/** core 的结果是不是「缺 FFmpeg」（core/zju/lib/zhiyun/ffmpeg.ts 报的 DEPENDENCY_MISSING）。 */
export const missingFfmpeg = result => result?.ok === false && result.error?.code === 'DEPENDENCY_MISSING' && /FFmpeg/i.test(result.error?.message ?? '')
