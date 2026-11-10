import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * **元数据守卫**：这个包里三份「法律上必须存在」的文件，缺一份就不能发布。
 *
 * # 为什么值得单独一条测试
 *
 * 三份文件各自守的是一条不同的义务，而**没有一条会被功能测试碰到**：
 *
 * | 文件 | 守的是什么 |
 * | --- | --- |
 * | `THIRD_PARTY_NOTICES.txt` | MIT 的义务：保留版权声明与许可声明。删了就是违约。 |
 * | `ATTRIBUTION.md` | 本仓的约定：移植了谁的代码、改了哪里，让下游能追溯。 |
 * | `SKILL.md` | 上游技能本体。缺了它，命令照样能跑，但没人知道该怎么用。 |
 *
 * 它们最容易在两种时刻消失：整理 `files` 白名单时误删；
 * 或者从上游复制时漏了一个（这个包是逐个文件搬过来的，不是整目录搬）。
 *
 * 判据刻意用「存在且非空」而不是比对哈希：`SKILL.md` 本来就允许为本仓改写，
 * `ATTRIBUTION.md` 是本仓新写的。真正不许动的是 `THIRD_PARTY_NOTICES.txt`，
 * 那一条由 `scripts/check-attribution.mjs` 和代码评审把关，不在这里重复。
 */

const root = fileURLToPath(new URL('..', import.meta.url))

const REQUIRED = ['THIRD_PARTY_NOTICES.txt', 'ATTRIBUTION.md', 'SKILL.md']

test('三个必带文件都存在且非空', () => {
  const problems = []
  for (const name of REQUIRED) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) {
      problems.push(`${name}: 不存在`)
      continue
    }
    const stat = fs.statSync(file)
    if (!stat.isFile()) {
      problems.push(`${name}: 不是普通文件`)
      continue
    }
    // 只有空白的文件与不存在一样没用 —— 白名单里写着它、实际却是 0 字节，
    // 发布出去以后下游拿到的是一份「看起来有、其实没有」的声明。
    if (fs.readFileSync(file, 'utf8').trim().length === 0) problems.push(`${name}: 是空文件`)
  }
  assert.deepEqual(problems, [], `以下元数据文件有问题：\n${problems.join('\n')}`)
})

test('package.json 的 files 白名单没有把这三份文件漏掉', () => {
  // 文件在那儿、但没进 `files`，npm 打包时同样会被丢掉 ——
  // 这是上一条测不出的第二种丢失方式。
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const files = manifest.files ?? []
  const missing = REQUIRED.filter((name) => !files.includes(name))
  assert.deepEqual(missing, [], `package.json 的 files 里缺：${missing.join(', ')}`)
})

test('SKILL.md 的 frontmatter 保留了上游的 name 与 description', () => {
  // 上游技能靠这两个字段被宿主发现；移植时改目录名容易顺手改掉 name，
  // 那会让技能在「插件」页里认不出来。
  const text = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  assert.ok(front !== null, 'SKILL.md 缺 frontmatter')
  assert.match(front[1], /^name:\s*wechat\s*$/m, 'name 必须是 wechat')
  assert.match(front[1], /^description:\s*\S/m, 'description 不能为空')
})
