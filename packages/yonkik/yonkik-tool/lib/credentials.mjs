import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(process.env.YONKIK_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

export function loadCredentials(key, { root = repoRoot } = {}) {
  // 凭据桥接优先：宿主工具把加密凭据服务里的配置经 env 注入（不落明文盘）。
  const envMap = process.env.YONKIK_CREDENTIALS
  if (envMap) {
    let map = null
    try { map = JSON.parse(envMap) } catch { map = null }
    if (map) {
      if (map[key]) return map[key]
      throw new Error(`凭据桥接里没有键 "${key}"。已有：${Object.keys(map).join(', ') || '(空)'}。请在「设置 → YONKIK 侦察凭据」里配置。`)
    }
  }
  const file = path.join(root, 'secrets', 'credentials.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      `缺少凭据文件 ${file}。把 secrets/credentials.example.json 复制为 credentials.json 并填入 "${key}" 的账号。` +
      '凭据只放这里（已 gitignore），不要写进脚本、wiki 或聊天。'
    )
  }
  const all = JSON.parse(fs.readFileSync(file, 'utf8'))
  const cred = all[key]
  if (!cred) {
    throw new Error(`secrets/credentials.json 里没有键 "${key}"。已有键：${Object.keys(all).join(', ') || '(空)'}`)
  }
  return cred
}