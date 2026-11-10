import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export { SkillError } from './errors.mjs'

// 配置只有一处：Skill 根目录的 .env；同名的系统环境变量优先。
const envFile = process.env.WEREAD_ENV_FILE || fileURLToPath(new URL('../.env', import.meta.url))
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

/** 保存自带浏览器的登录状态和跟踪名单。 */
export const dataDir = process.env.WEREAD_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.local', 'share'), 'weread-skill')

/** Skill 的根目录，也就是应用装着的地方。 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 命令行里给的保存目录（--out）。相对路径照常从当前目录算；当前目录在 Skill 自己的目录里时，改从数据目录的 downloads 算。
 * Skill 的目录是应用装着的地方：装在 C:\Program Files 下面写不进去，写得进去时升级也会把它整个换掉。
 * 助手有时把工作目录切到这里、再给一个相对的目录，文章不该存在里面。命令的结果里写的是完整路径。
 */
export function outPath(given: string, cwd = process.cwd()): string {
  if (path.isAbsolute(given)) return path.resolve(given)
  const fromRoot = path.relative(ROOT, cwd)
  const inside = fromRoot !== '..' && !fromRoot.startsWith('..' + path.sep) && !path.isAbsolute(fromRoot)
  return path.resolve(inside ? path.join(dataDir, 'downloads') : cwd, given)
}

export interface VisionConfig { endpoint: string; model: string; apiKey?: string; thinking?: string; reasoningEffort?: string; responseFormat?: string; audioInput?: boolean; maxTokens?: number }

/** 验证码识别模型；没有配置时由用户在官方窗口里手动完成验证。 */
export function visionConfig(): VisionConfig | undefined {
  const env = (name: string) => process.env['WEREAD_VISION_' + name] || undefined
  const endpoint = env('ENDPOINT'), model = env('MODEL')
  if (!endpoint || !model) return undefined
  return { endpoint, model, apiKey: env('API_KEY'), thinking: env('THINKING'), reasoningEffort: env('REASONING_EFFORT'), responseFormat: env('RESPONSE_FORMAT'),
    audioInput: env('AUDIO_INPUT') !== 'false', maxTokens: env('MAX_TOKENS') ? Number(env('MAX_TOKENS')) : undefined }
}
