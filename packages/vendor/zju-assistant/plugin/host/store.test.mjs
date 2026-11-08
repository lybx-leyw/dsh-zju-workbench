import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProfileStore, parseNote } from './store.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-profile-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { store: new ProfileStore(path.join(root, 'profile')), root }
}
const disk = (store, title, archived = false) => fs.readFileSync(store.memory.notePath(title, archived), 'utf8')

test('一篇笔记就是一个以标题命名的 Markdown 文件，属性在开头的属性区', t => {
  const { store } = fixture(t)
  const note = store.memory.save({ title: '数据结构基础', tags: ['课程', '已修'], properties: [{ key: '学期', value: '2025–2026 春夏' }], body: '学得不太扎实。\n\n## 学过\n- 链表' })
  assert.equal(disk(store, '数据结构基础'), '---\ntags: [课程, 已修]\n学期: 2025–2026 春夏\n---\n学得不太扎实。\n\n## 学过\n- 链表\n')
  assert.deepEqual(note.tags, ['课程', '已修'])
  assert.deepEqual(note.properties, [{ key: '学期', value: '2025–2026 春夏' }])
  assert.equal(note.body, '学得不太扎实。\n\n## 学过\n- 链表\n')
  // 重开一次读到的是同一篇；文件里没有谁写的、什么时候写的这类记录。
  const reopened = new ProfileStore(store.root).memory.note('数据结构基础')
  assert.equal(reopened.revision, note.revision)
  assert.doesNotMatch(reopened.raw, /actor|updatedAt|humanEdited|source/)
  // 没有属性的笔记不写属性区；正文以分隔线开头也不会被当成属性区。
  assert.equal(store.memory.save({ title: '随手记', body: '---\n一条线下面的话' }).body, '---\n一条线下面的话\n')
  assert.equal(store.memory.note('随手记').properties.length, 0)
})

test('在别的编辑器里写的笔记照样能读；属性区写坏了也列出来，能打开改好', t => {
  const { store } = fixture(t)
  fs.writeFileSync(store.memory.notePath('手写的'), '---\ntags: 课程, 在修\naliases: [甲, 乙]\n学期：2026 秋冬\n---\n\n正文 [[数据结构基础]]\n')
  fs.writeFileSync(store.memory.notePath('没有属性'), '只有正文')
  fs.writeFileSync(store.memory.notePath('写坏了'), '---\ntags: [课程\n---\n正文')
  const { notes, warnings } = store.memory.list()
  assert.equal(notes.length, 3)
  const written = store.memory.note('手写的')
  assert.deepEqual(written.tags, ['课程', '在修'])
  assert.deepEqual(written.properties, [{ key: 'aliases', value: '甲、乙' }, { key: '学期', value: '2026 秋冬' }])
  assert.equal(store.memory.note('没有属性').body, '只有正文')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /写坏了：属性区的格式不对/)
  const broken = store.memory.note('写坏了')
  assert.match(broken.body, /tags: \[课程/)
  // 页面上没动过的属性保留原来的写法（列表还是列表），动过的才按文字存。
  const saved = store.memory.save({ title: '手写的', from: '手写的', revision: written.revision, tags: written.tags, properties: [{ key: 'aliases', value: '甲、乙' }, { key: '学期', value: '2026–2027 秋冬' }], body: written.body })
  assert.match(saved.raw, /aliases: \[甲, 乙\]\n学期: 2026–2027 秋冬\n/)
  // 把正文里那段坏掉的属性区改对，保存后就正常了。
  const fixed = store.memory.save({ title: '写坏了', from: '写坏了', revision: broken.revision, tags: [], properties: [], body: broken.body.replace('[课程', '[课程]') })
  assert.deepEqual(fixed.tags, ['课程'])
  assert.equal(store.memory.list().warnings.length, 0)
})

test('标题就是文件名：不能重名，不能有文件名用不了的符号；改标题时别处的双链跟着改', t => {
  const { store } = fixture(t)
  const first = store.memory.save({ title: 'FDS', body: '数据结构基础' })
  store.memory.save({ title: '高级数据结构', body: '先修是 [[FDS]]，也见 [[FDS|数据结构基础]] 和 [[FDS#堆]]。[[FDS2]] 不是它。' })
  assert.throws(() => store.memory.save({ title: 'FDS', body: '另一篇' }), /已经有一条叫「FDS」/)
  for (const bad of ['a/b', 'a:b', '[[x]]', '..', 'nul', '结尾.', '']) assert.throws(() => store.memory.save({ title: bad, body: 'x' }), /标题|文件名/)
  assert.throws(() => store.memory.note('../../outside'), /标题/)
  const renamed = store.memory.save({ title: '数据结构基础', from: 'FDS', revision: first.revision, tags: [], properties: [], body: first.body })
  assert.equal(renamed.title, '数据结构基础')
  assert.equal(store.memory.find('FDS'), null)
  assert.equal(store.memory.note('高级数据结构').body, '先修是 [[数据结构基础]]，也见 [[数据结构基础|数据结构基础]] 和 [[数据结构基础#堆]]。[[FDS2]] 不是它。\n')
})

test('两处同时改不会互相覆盖：过期的版本和别的编辑器改过的都要先重新读', t => {
  const { store } = fixture(t)
  const first = store.memory.save({ title: '目标', body: 'A' })
  const edit = (base, body) => store.memory.save({ title: '目标', from: '目标', revision: base.revision, tags: [], properties: [], body })
  edit(first, 'B')
  assert.throws(() => edit(first, 'C'), /其他位置更新/)
  const current = store.memory.note('目标')
  fs.appendFileSync(store.memory.notePath('目标'), '\n外部编辑')
  assert.throws(() => edit(current, 'D'), /其他位置更新/)
  assert.match(store.memory.note('目标').body, /外部编辑/)
  fs.mkdirSync(store.file('.write-lock'))
  assert.throws(() => store.memory.save({ title: '被占用', body: 'x' }), /另一处保存/)
  fs.rmdirSync(store.file('.write-lock'))
})

test('助手自己写的、没人动过的笔记可以整篇重写；有人改过的只能在后面补充', t => {
  const { store } = fixture(t)
  const mine = store.memory.saveByAssistant({ title: '讲解偏好', body: '先看例子再看定义。', tags: ['偏好'], properties: { 来源: '用户 10 月 7 日说的' } })
  assert.equal(disk(store, '讲解偏好'), '---\ntags: [偏好]\n来源: 用户 10 月 7 日说的\n---\n先看例子再看定义。\n')
  const rewritten = store.memory.saveByAssistant({ title: '讲解偏好', revision: mine.revision, body: '先看例子再看定义；代码用 C。' })
  assert.equal(rewritten.body, '先看例子再看定义；代码用 C。\n')
  assert.deepEqual(rewritten.tags, ['偏好'])
  assert.throws(() => store.memory.saveByAssistant({ title: '讲解偏好', revision: mine.revision, body: '过期的' }), /其他位置更新/)
  assert.throws(() => store.memory.saveByAssistant({ title: '空的' }), /要有正文/)

  // 用户在页面上改过一次以后，助手不能再整篇换掉。
  const edited = store.memory.save({ title: '讲解偏好', from: '讲解偏好', revision: rewritten.revision, tags: ['偏好'], properties: [], body: '先看例子。不要太啰嗦。' })
  assert.throws(() => store.memory.saveByAssistant({ title: '讲解偏好', revision: edited.revision, body: '我重写的' }), /有人改过/)
  const appended = store.memory.saveByAssistant({ title: '讲解偏好', revision: edited.revision, body: '10 月 8 日：公式要配图。', append: true, properties: { 来源: '用户反馈' } })
  assert.equal(appended.body, '先看例子。不要太啰嗦。\n\n10 月 8 日：公式要配图。\n')
  assert.deepEqual(appended.properties, [{ key: '来源', value: '用户反馈' }])
  // 补充过以后它仍然是用户改过的笔记。
  assert.throws(() => store.memory.saveByAssistant({ title: '讲解偏好', revision: appended.revision, body: '再重写' }), /有人改过/)
  // 用户自己写的、在别的编辑器里改过的，也一样。
  const own = store.memory.save({ title: '我的目标', body: '保研' })
  assert.throws(() => store.memory.saveByAssistant({ title: '我的目标', revision: own.revision, body: '改掉' }), /有人改过/)
  fs.appendFileSync(store.memory.notePath('讲解偏好'), '外部加的一行\n')
  // 属性可以改：值给空就是去掉这一项，正文不动。
  const cleared = store.memory.saveByAssistant({ title: '讲解偏好', revision: store.memory.note('讲解偏好').revision, properties: { 来源: '' } })
  assert.equal(cleared.raw, '---\ntags: [偏好]\n---\n先看例子。不要太啰嗦。\n\n10 月 8 日：公式要配图。\n外部加的一行\n')
})

test('归档是挪进归档文件夹，助手默认读不到；删除只能由人在页面上做', t => {
  const { store } = fixture(t)
  const note = store.memory.saveByAssistant({ title: '旧目标', body: '已经不用了' })
  const archived = store.dispatch('archive', { title: '旧目标', revision: note.revision, archived: true })
  assert.equal(archived.archived, true)
  assert.equal(fs.existsSync(path.join(store.root, 'memory', '归档', '旧目标.md')), true)
  assert.equal(store.query().memory.length, 0)
  assert.equal(store.query({ archived: true }).memory.length, 1)
  assert.throws(() => store.memory.save({ title: '旧目标', body: '重名' }), /已经有一条/)
  // 助手也可以归档和取消归档。
  assert.equal(store.memory.saveByAssistant({ title: '旧目标', revision: archived.revision, archived: false }).archived, false)
  assert.equal(store.query({ query: '不用了' }).memory.length, 1)

  const current = store.memory.note('旧目标')
  assert.throws(() => store.dispatch('delete', { title: '旧目标', revision: 'stale' }), /其他位置更新/)
  assert.throws(() => store.dispatch('delete', { title: '旧目标', revision: current.revision }, 'ai'), /设置的「个人档案」里/)
  assert.throws(() => store.dispatch('archive', { title: '旧目标', revision: current.revision, archived: true }, 'ai'), /设置的「个人档案」里/)
  assert.deepEqual(store.dispatch('delete', { title: '旧目标', revision: current.revision }), { title: '旧目标' })
  assert.equal(store.memory.list().notes.length, 0)
  assert.throws(() => store.dispatch('delete', { title: '旧目标', revision: current.revision }), /没有这条记忆/)
})

test('导入的文件名就是标题，内容原样留着；导出的就是文件本身', t => {
  const { store } = fixture(t)
  const content = '---\ntags:\n  - 算法\n学期: 秋冬\n---\n\n学懂 AVL\n'
  const imported = store.dispatch('import', { filename: '学习目标.md', content })
  assert.equal(imported.title, '学习目标')
  assert.deepEqual(imported.tags, ['算法'])
  assert.equal(store.dispatch('export', { title: '学习目标' }).markdown, content)
  assert.throws(() => store.dispatch('import', { filename: '学习目标.md', content }), /已经有一条/)
  assert.throws(() => store.dispatch('import', { filename: '图片.png', content }), /Markdown/)
  assert.throws(() => store.dispatch('import', { filename: '坏的.md', content: '---\ntags: [a\n---\n' }), /属性区/)
  assert.throws(() => store.dispatch('import', { filename: '助手.md', content }, 'ai'), /设置的「个人档案」里/)
})

test('助手读到的是目录和摘要，按标题读全文', t => {
  const { store } = fixture(t)
  store.memory.save({ title: '数据结构基础', tags: ['课程'], properties: [{ key: '学期', value: '2025–2026 春夏' }], body: '学过链表和堆。' })
  store.memory.save({ title: '讲解偏好', body: '先看例子。' })
  const listed = store.query()
  assert.deepEqual(listed.memory.map(note => note.title).sort(), ['数据结构基础', '讲解偏好'].sort())
  const course = listed.memory.find(note => note.title === '数据结构基础')
  assert.deepEqual(course.properties, { 学期: '2025–2026 春夏' })
  assert.equal(course.summary, '学过链表和堆。\n')
  assert.equal('body' in course, false)
  assert.deepEqual(store.query({ query: '春夏' }).memory.map(note => note.title), ['数据结构基础'])
  assert.equal(store.query({ title: '讲解偏好' }).body, '先看例子。\n')
  assert.throws(() => store.dispatch('connect', {}), /不支持/)
})

test('备忘录和记忆各放各的文件夹，互不相见；助手只能补充用户写的备忘', t => {
  const { store } = fixture(t)
  store.memory.saveByAssistant({ title: '数据结构基础', body: '堆还不熟。', tags: ['课程'] })
  const memo = store.dispatch('memo-save', { title: '校园 AI 创新应用大赛', tags: [], properties: [{ key: '截止', value: '2026-10-21' }], body: '目标一等奖。' })
  assert.equal(fs.existsSync(path.join(store.root, 'notes', '校园 AI 创新应用大赛.md')), true)
  assert.equal(fs.existsSync(path.join(store.root, 'memory', '数据结构基础.md')), true)
  // 个人档案里只有记忆，备忘录里只有备忘；同一个标题可以两边各有一条。
  assert.deepEqual(store.snapshot().memory.map(note => note.title), ['数据结构基础'])
  assert.deepEqual(store.query().memory.map(note => note.title), ['数据结构基础'])
  assert.deepEqual(store.dispatch('memo-list').notes.map(note => note.title), ['校园 AI 创新应用大赛'])
  assert.equal(store.dispatch('memo-save', { title: '数据结构基础', body: '周五交大作业' }).title, '数据结构基础')
  assert.deepEqual(store.memos.query({ query: '一等奖' }).notes.map(note => note.title), ['校园 AI 创新应用大赛'])
  assert.equal('identity' in store.memos.query(), false)
  // 用户写的备忘，助手只能在后面补充；助手按用户说的新记的一条，没人动过时可以重写。
  assert.throws(() => store.memos.saveByAssistant({ title: memo.title, revision: memo.revision, body: '改掉' }), /这条备忘有人改过/)
  assert.match(store.memos.saveByAssistant({ title: memo.title, revision: memo.revision, body: '报名 10 月 18 日截止。', append: true }).body, /一等奖。\n\n报名/)
  const asked = store.memos.saveByAssistant({ title: '周五找辅导员签字', body: '带上申请表。' })
  assert.equal(store.memos.saveByAssistant({ title: asked.title, revision: asked.revision, body: '带上申请表和学生证。' }).body, '带上申请表和学生证。\n')
  // 删除和归档只有人能做，报错里说的是校园事务页的备忘录。
  assert.throws(() => store.dispatch('memo-delete', { title: memo.title, revision: 'x' }, 'ai'), /校园事务页的备忘录里/)
  assert.throws(() => store.dispatch('memo-delete', { title: '没有的', revision: 'x' }), /没有这条备忘/)
  assert.throws(() => store.dispatch('memo-snapshot'), /不支持/)
  assert.throws(() => store.dispatch('memo-identity', {}), /不支持/)
})

test('属性区的几种写法', () => {
  assert.deepEqual(parseNote('---\n---\n正文').tags, [])
  assert.deepEqual(parseNote('---\ntags: [a，b]\n---\n').tags, ['a', 'b'])
  assert.equal(parseNote('---\n日期: 2026-10-08\n数: 3\n---\n').properties.map(item => item.value).join(), '2026-10-08,3')
  assert.throws(() => parseNote('---\n- 只是一个列表\n---\n'), /属性区的格式不对/)
})

test('identity lives in the app profile and accepts only its own fields', t => {
  const { store } = fixture(t)
  const before = store.identity()
  assert.equal(before.values.college, '')
  const after = store.saveIdentity({ revision: before.revision, values: { college: '测试学院', major_name: '测试专业', campus: '紫金港' } })
  assert.equal(after.values.college, '测试学院')
  // ZJU core 读的就是这份文件里的 values。
  assert.equal(JSON.parse(fs.readFileSync(store.file('identity.json'), 'utf8')).values.major_name, '测试专业')
  assert.throws(() => store.saveIdentity({ revision: before.revision, values: { college: '旧学院' } }), /其他位置更新/)
  assert.throws(() => store.saveIdentity({ revision: store.identity().revision, values: { zju_password: 'x' } }), /无效/)
  assert.throws(() => store.saveIdentity({ revision: store.identity().revision, values: { college: 'AI 改的' } }, 'ai'), /设置的「个人档案」里/)
})
