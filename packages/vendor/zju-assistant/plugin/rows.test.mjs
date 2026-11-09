import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load, JSON_SCHEMA } from 'js-yaml'
import { BUNDLE, PACKAGE, ROWS, entryId, moduleName } from './rows.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'))
const bundle = JSON.parse(fs.readFileSync(path.join(here, 'bundle', 'package.json'), 'utf8'))
const at = relative => path.join(here, relative)

test('外层的组合包只带 patch、依赖实现包；实现包不是组合包，页面挂在它的包根上', () => {
  assert.equal(manifest.name, PACKAGE)
  assert.equal(bundle.name, BUNDLE)
  assert.equal(bundle.dsh.bundle.patch, './cordis.patch.yml')
  // 发到 npm 的组合包写死实现包的版本，两边一起升；开发时由 bundle/pnpm-workspace.yaml 覆盖成本地链接。
  assert.equal(bundle.dependencies[PACKAGE], manifest.version, '组合包依赖同版本的实现包')
  assert.equal(bundle.version, manifest.version, '两个包同版本发布')
  for (const pkg of [bundle, manifest]) assert.ok(pkg.files.includes('README.md') && fs.existsSync(path.join(here, pkg === bundle ? 'bundle' : '.', 'README.md')), `${pkg.name} 带 README`)
  assert.equal(manifest.dsh.bundle, undefined)
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(new Set(ROWS.map(row => row.id)).size, ROWS.length)
  assert.equal(ROWS[0].key, '', '包根那一行排第一')
})

test('两个包都有图标和中英文的标题、描述', () => {
  for (const [dir, pkg] of [['bundle', bundle], ['.', manifest]]) {
    assert.ok(pkg.icon && fs.existsSync(path.join(here, dir, pkg.icon)), `${pkg.name} 的图标`)
    for (const language of ['en', 'zh']) {
      const { meta } = JSON.parse(fs.readFileSync(path.join(here, dir, 'locale', `${language}.json`), 'utf8'))
      assert.ok(meta.title?.trim() && meta.description?.trim(), `${pkg.name} 的 ${language}.json`)
    }
  }
})

test('组合包页的详情是单独的短文档，不用整篇 README：每种语言都指向一份进了 npm 包的文件', () => {
  for (const language of ['en', 'zh']) {
    const { meta } = JSON.parse(fs.readFileSync(at(`bundle/locale/${language}.json`), 'utf8'))
    assert.match(meta.detail ?? '', /^[\w.-]+\.md$/, `${language}.json 的 meta.detail`)
    assert.ok(bundle.files.includes(meta.detail), `${meta.detail} 在组合包的 files 里`)
    const text = fs.readFileSync(at(`bundle/${meta.detail}`), 'utf8')
    assert.ok(text.trim(), `${meta.detail} 有内容`)
    assert.doesNotMatch(text, /^# /m, `${meta.detail} 不重复页面上已有的标题`)
  }
})

test('bundle/cordis.patch.yml 的行和 rows.mjs 一一对得上，顺序和默认开关也一样', () => {
  const patch = load(fs.readFileSync(at('bundle/cordis.patch.yml'), 'utf8'), { schema: JSON_SCHEMA })
  assert.equal(patch.length, 1)
  const rows = patch[0].insert
  assert.deepEqual(rows.map(row => [row.id, row.name, row.disabled === true]), ROWS.map(row => [entryId(row), moduleName(row), !row.on]))
})

test('每一行都有入口、图标和中英文的标题、描述', () => {
  for (const row of ROWS) {
    const prefix = row.key ? `./${row.key}` : '.'
    const entry = manifest.exports[prefix]
    assert.ok(entry && fs.existsSync(at(entry)), `${prefix} 的入口`)
    const icon = row.key ? manifest.exports[`./${row.key}/icon`] : manifest.icon
    assert.ok(icon && fs.existsSync(at(icon)), `${prefix} 的图标`)
    // 0.2.0 的引擎从 <子路径>/package.json 的 icon 读，图标要在那份清单旁边；文档里新的写法是导出 <子路径>/icon。两种都给。
    if (row.key) {
      const own = manifest.exports[`./${row.key}/package.json`]
      const declared = JSON.parse(fs.readFileSync(at(own), 'utf8')).icon
      assert.equal(path.resolve(path.dirname(at(own)), declared), at(icon), `${prefix} 的两种图标是同一个文件`)
    }
    const locale = manifest.exports[row.key ? `./${row.key}/locale/*.json` : './locale/*.json']
    assert.ok(locale, `${prefix} 的 locale`)
    for (const language of ['en', 'zh']) {
      const { meta } = JSON.parse(fs.readFileSync(at(locale.replace('*', language)), 'utf8'))
      assert.ok(meta.title?.trim() && meta.description?.trim(), `${prefix} 的 ${language}.json`)
      // 插件页上 id 和标题一样时才不多列一行 id
      if (language === 'zh') assert.equal(meta.title, entryId(row), `${prefix} 的中文标题就是 patch 里的 id`)
    }
  }
})

test('图标是自带渐变的独立 SVG，能当图片显示', () => {
  for (const file of ['icon.svg', ...ROWS.filter(row => row.key).map(row => `rows/${row.key}/icon.svg`)]) {
    const svg = fs.readFileSync(at(file), 'utf8')
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, file)
    for (const [, id] of svg.matchAll(/url\(#(\w+)\)/g)) assert.ok(svg.includes(`id="${id}"`), `${file} 的 #${id}`)
  }
})

test('子行的入口是注入根服务的插件', async () => {
  for (const row of ROWS.filter(item => item.key)) {
    const plugin = (await import(pathToFileURL(at(manifest.exports[`./${row.key}`])).href)).default
    assert.equal(plugin.inject[0], 'zjuCampus', row.key)
    assert.equal(typeof plugin.apply, 'function', row.key)
  }
})

test('技能正文：开着的行各有一段，链到的参考文档都在；core 的路径写成 {{core}}，由根行换成实际位置', () => {
  const links = text => [...text.matchAll(/\[[^\]\n]+\]\(([^)\s#]+)\)/g)].map(match => match[1]).filter(link => !/^https?:/.test(link))
  const core = path.join(here, '..', 'core')
  for (const file of ['skill/SKILL.md', ...fs.readdirSync(at('skill/rows')).map(name => `skill/rows/${name}`)]) {
    for (const link of links(fs.readFileSync(at(file), 'utf8'))) {
      const target = link.startsWith('{{core}}/') ? path.join(core, link.slice('{{core}}/'.length)) : at(path.join('skill', link))
      assert.ok(fs.existsSync(target), `${file} 链到的 ${link}`)
    }
  }
  for (const name of fs.readdirSync(at('skill/rows'))) assert.ok(ROWS.some(row => `${row.key}.md` === name), `skill/rows/${name} 对得上一行`)
})

test('技能只有一个，名字和说明齐全', () => {
  const raw = fs.readFileSync(at('skill/SKILL.md'), 'utf8')
  const meta = load(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1], { schema: JSON_SCHEMA })
  assert.equal(meta.name, 'zju-campus')
  assert.ok(meta.description.trim())
})
