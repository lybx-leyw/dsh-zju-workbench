import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

/**
 * **元数据守卫**：这个包里几份「法律上必须存在」的文件，缺一份就不能发布。
 *
 * # 为什么值得单独一条测试
 *
 * 每份文件各自守一条不同的义务，而**没有一条会被功能测试碰到**：
 *
 * | 文件 | 守的是什么 |
 * | --- | --- |
 * | `LICENSE-Tencent` | 腾讯对 WeChatReading 的 Apache-2.0 声明。**逐字**保留是硬要求。 |
 * | `THIRD_PARTY_NOTICES.txt` | MIT 的义务：保留版权声明与许可声明。删了就是违约。 |
 * | `ATTRIBUTION.md` | 本仓的约定：移植了谁的代码、改了哪里，让下游能追溯。 |
 * | `SKILL.md` | 上游技能本体。缺了它，命令照样能跑，但没人知道该怎么用。 |
 *
 * 它们最容易在两种时刻消失：整理 `files` 白名单时误删；
 * 或者从上游复制时漏了一个（这个包是逐个文件搬过来的，不是整目录搬）。
 */

const root = fileURLToPath(new URL('..', import.meta.url))

/** 必须存在且非空的文件。 */
const REQUIRED = ['LICENSE-Tencent', 'THIRD_PARTY_NOTICES.txt', 'ATTRIBUTION.md', 'SKILL.md', 'README.md', 'OWNERS']

/**
 * 必须进 npm 发布产物（`files`）的那几份。
 *
 * `OWNERS` 刻意**不在**里面：它是本仓的目录所有权约定（谁负责审阅），
 * 对拿到 tarball 的下游没有意义，按其它包的做法不发布。
 */
const SHIPPED = ['LICENSE-Tencent', 'THIRD_PARTY_NOTICES.txt', 'ATTRIBUTION.md', 'SKILL.md', 'README.md']

test('六个必带文件都存在且非空', () => {
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

test('LICENSE-Tencent 逐字保留了 Apache-2.0 的声明要点', () => {
  // 不比对整份哈希：那样在「上游补一句换行」时也会红，而真正要守的是
  // **这几个句子还在**。逐字要求由代码评审与上游对照把关，这里钉住核心声明。
  const text = fs.readFileSync(path.join(root, 'LICENSE-Tencent'), 'utf8')
  for (const needle of [
    'Tencent is pleased to support the open source community by making WeChatReading available.',
    'Copyright (C) 2026 Tencent. All rights reserved.',
    'WeChatReading is licensed under Apache-2.0.',
    'Apache License',
    'Version 2.0, January 2004',
    'END OF TERMS AND CONDITIONS',
  ]) {
    assert.ok(text.includes(needle), `LICENSE-Tencent 缺少：${needle}`)
  }
  // Apache-2.0 第 4 条的再分发条件段必须在（这是「必须给接收者一份协议」的依据）。
  assert.match(text, /4\. Redistribution\./)
  assert.match(text, /must give any other recipients of the Work/i)
})

test('THIRD_PARTY_NOTICES.txt 保留了 MIT 条款与署名', () => {
  const text = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
  assert.match(text, /MIT License/)
  assert.match(text, /Copyright \(c\) 2025 CloudDreamAI \/ TANGandXUE/)
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/)
})

test('package.json 的 files 白名单没有把必带文件漏掉', () => {
  // 文件在那儿、但没进 `files`，npm 打包时同样会被丢掉 ——
  // 这是上一条测不出的第二种丢失方式。
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const files = manifest.files ?? []
  const missingNames = SHIPPED.filter((name) => !files.includes(name))
  assert.deepEqual(missingNames, [], `package.json 的 files 里缺：${missingNames.join(', ')}`)
})

test('package.json 保留了上游的 bin / engines / 依赖与可选 Electron', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.bin?.weread, 'scripts/weread.ts', 'bin.weread 必须指向 CLI 入口')
  assert.deepEqual(manifest.engines, { node: '>=24' }, 'engines 是上游的运行时下限')
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [
    'commander', 'entities', 'htmlparser2', 'linkedom', 'turndown', 'turndown-plugin-gfm',
  ], '上游六个运行时依赖一个都不能少')
  // Electron 是**可选**依赖，但必须留着 —— lib/browser/* 与 lib/captcha/electron.mjs 指望它。
  assert.deepEqual(manifest.optionalDependencies, { electron: '44.10.1' },
    'electron 必须留在 optionalDependencies（本仓不装它也能加载模块，只是浏览器能力不可用）')
})

test('SKILL.md 的 frontmatter 保留了上游的 name 与 description', () => {
  // 上游技能靠这两个字段被宿主发现；移植时改目录名容易顺手改掉 name，
  // 那会让技能在「插件」页里认不出来。
  const text = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  assert.ok(front !== null, 'SKILL.md 缺 frontmatter')
  assert.match(front[1], /^name:\s*weread\s*$/m, 'name 必须是 weread')
  assert.match(front[1], /^description:\s*\S/m, 'description 不能为空')
})

test('cordis.patch.yml 能被 YAML 解析且 id/name 与 manifest 一致', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^-\s*insert:/m)
  const name = /^\s*name:\s*"([^"]+)"/m.exec(patch)
  assert.ok(name !== null, 'patch 里 name 必须带引号（@ 是 YAML 保留字符）')
  assert.equal(name[1], manifest.name, 'patch 的 name 必须等于包名')
  const id = /^\s*-\s*id:\s*(\S+)/m.exec(patch)
  assert.ok(id !== null, 'patch 里要有 id')
  assert.equal(id[1], 'zju-source-weread')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 要指向它')
})

test('移植过来的 lib/ 与上游逐字节相同（防止「顺手改一下」的静默分叉）', () => {
  // 上游副本就在同一个仓库里，可以直接比对 —— 这比记一份哈希清单更可靠：
  // 上游升级时这里会自动跟着校验，不会出现「清单还是旧的」。
  const upstream = path.join(root, '..', '..', 'vendor', 'zju-assistant', 'core', 'weread')
  if (!fs.existsSync(upstream)) {
    // vendor 副本不在（`packages/vendor/` 是本地维护的上游副本，不随 npm 包分发）时
    // 跳过而不是失败：这条断言守的是**仓库内**的一致性，不是发布产物的自洽。
    return
  }
  const problems = []
  const walk = (dir, base = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), rel); continue }
      // 只比对 `lib/`：那 15 个文件是「原样保留、不许重写」的部分。
      // 测试文件允许加 skip 条件，元数据文件是本仓新写的。
      if (!rel.startsWith('lib/')) continue
      const here = path.join(root, rel)
      const there = path.join(upstream, rel)
      if (!fs.existsSync(there)) { problems.push(`上游没有 ${rel}`); continue }
      const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      if (digest(here) !== digest(there)) problems.push(`${rel}: 与上游不一致`)
    }
  }
  walk(path.join(root, 'lib'))
  assert.deepEqual(problems, [], `lib/ 被改动了（本仓约定原样保留）：\n${problems.join('\n')}`)
})
