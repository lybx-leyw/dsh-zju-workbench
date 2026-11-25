/**
 * `@lybx-leyw/dsh-zju-yonkik-skill`
 *
 * YONKIK 的方法论半边：把 SKILL.md（+ references）注册成一个 skill provider。
 * 模型自判何时侦察/查询（modelInvocable），不进输入框 / 菜单（userInvocable=false）。
 * 运行时与脚本在兄弟包 yonkik-tool；本包只负责让模型读到方法论。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_FILE = path.join(PKG, 'SKILL.md')
const PROVIDER = 'yonkik'

export const name = 'zw-yonkik-skill'
export const inject = ['skills']

function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const meta = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: raw.slice(m?.[0].length ?? 0).trim() + '\n' }
}

function skill() {
  const { meta, body } = frontmatter(fs.readFileSync(SKILL_FILE, 'utf8'))
  return {
    name: meta.name ?? 'site-recon',
    description: meta.description ?? '',
    path: SKILL_FILE,
    source: 'custom',
    provider: PROVIDER,
    resourceBase: { kind: 'directory', path: PKG },
    rank: 150,
    locator: SKILL_FILE,
    invocation: { modelInvocable: true, userInvocable: false },
    content: body,
  }
}

export function apply(ctx) {
  console.info('[yonkik-skill] apply：skills 服务就绪 =', !!ctx.skills)
  ctx.effect(() => ctx.skills.registerProvider(() => ({
    name: PROVIDER,
    list: async () => [skill()],
    get: async candidate => (candidate.locator === SKILL_FILE ? skill() : undefined),
  })))
  console.info('[yonkik-skill] skill provider 已注册（locator=' + SKILL_FILE + '）')
}