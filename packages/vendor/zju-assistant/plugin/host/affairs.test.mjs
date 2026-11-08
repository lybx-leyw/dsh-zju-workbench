import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Affairs, deadlineOf, fromChaoxing, fromPta, fromXuezai, ptaDetail, xuezaiDetail } from './affairs.mjs'

const XUEZAI = { todos: [
  { course: '数据结构基础', title: '实验三', type: '作业', deadline: '2026-10-12 23:59' },
  { course: '大学物理', title: '第二章测验', type: '在线测验', deadline: '2026-10-09 23:59' },
] }
const PTA = { homeworks: [
  { name: 'HW3', state: '部分作答', deadline: '2026-10-10 23:59', total: 10, answered: 3, accepted: 3, wrong: 0, url: 'https://pintia.cn/problem-sets/1/exam' },
  { name: 'HW2', state: '已全部作答', deadline: '2026-10-11 23:59', total: 5, answered: 5, accepted: 5, wrong: 0, url: 'https://pintia.cn/problem-sets/2/exam' },
] }

const CHAOXING = { homeworks: [
  { course: '示例课程', task: '第八周学习任务', title: '第八周周测', type: '测试', deadline: '2026-10-15 23:59', done: false, closed: false, requirement: '必做', otherLeft: 5 },
  { course: '示例课程', task: '第七周学习任务', title: '第七周报告', type: '作业', deadline: '2026-10-01 23:59', done: true, closed: true, requirement: '', otherLeft: 0 },
  { course: '示例课程', task: '第六周学习任务', title: '错过的周测', type: '测试', deadline: '2026-09-20 23:59', done: false, closed: true, requirement: '', otherLeft: 0 },
  { course: '放课件的课', task: '实验任务', title: '实验报告（请提交到别的平台）', type: '作业', deadline: null, done: false, closed: false, requirement: '', otherLeft: 2 },
] }

/** 一套假的账号、开关和 core，记下 core 被叫了几次。results 的键是命令的开头几个词，列表命令只写系统名。 */
function setup(t, { accounts = { zju_username: '3240100001', zju_password: 'x', pta_username: 'a@b.c', pta_password: 'y' } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-affairs-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = { accounts, disabled: [], calls: [], revealed: [], now: Date.parse('2026-10-08T00:00:00Z'), results: { xuezai: XUEZAI, pta: PTA, chaoxing: CHAOXING }, file: path.join(root, 'cache', 'affairs.json'), settingsFile: path.join(root, 'profile', 'affairs.json'), downloads: path.join(root, 'downloads') }
  world.create = () => new Affairs({
    file: world.file,
    settingsFile: world.settingsFile,
    account: { read: () => ({ data: world.accounts }) },
    plugins: { disabled: () => world.disabled },
    downloads: { root: async () => world.downloads, reveal: target => world.revealed.push(target) },
    now: () => world.now,
    run: async (args) => {
      const line = args.join(' ')
      const key = Object.keys(world.results).filter(name => line.startsWith(`${name} `)).sort((a, b) => b.length - a.length)[0]
      world.calls.push(key === args[0] ? key : line)
      const result = world.results[key]
      if (result instanceof Error) throw result
      return typeof result === 'function' ? result(args) : result
    },
  })
  return world
}

test('core results become page items: Beijing deadlines, PTA sets that still need work', () => {
  assert.equal(deadlineOf('2026-10-09 23:59'), '2026-10-09T15:59:00.000Z')
  assert.equal(deadlineOf('2026-10-09T15:59:00Z'), '2026-10-09T15:59:00.000Z')
  assert.equal(deadlineOf(null), null)
  assert.deepEqual(fromXuezai(XUEZAI)[1], { id: 'xuezai:在线测验|大学物理|第二章测验', source: 'xuezai', title: '第二章测验', course: '大学物理', kind: '在线测验', deadline: '2026-10-09T15:59:00.000Z' })
  const sets = fromPta({ homeworks: [
    ...PTA.homeworks,
    { name: '还没作答的', state: '未开始', deadline: '2026-10-20 23:59' },
    { name: '开启后没作答的', state: '未作答', deadline: '2026-10-20 23:59', total: 10, answered: 0 },
    { name: '进度没读全的', state: '部分作答', deadline: '2026-10-20 23:59' },
    { name: '答完但有错', state: '已全部作答', deadline: '2026-10-20 23:59', total: 4, answered: 4, accepted: 2, wrong: 2 },
    { name: '已交卷', state: '部分作答', deadline: '2026-10-20 23:59', total: 4, answered: 1, wrong: 0, endedByUser: true },
  ] })
  assert.deepEqual(sets.filter(set => !set.done).map(set => [set.title, set.note]), [['HW3', '答了 3/10 题'], ['还没作答的', '未作答'], ['开启后没作答的', '未作答'], ['进度没读全的', '作答进度未知'], ['答完但有错', '2 题没通过']])
  // 全部答完、自己交了卷的算做完了，留着给日程表标成已完成；截止了还没做完的不要。
  assert.deepEqual(sets.filter(set => set.done).map(set => set.title), ['HW2', '已交卷'])
  assert.deepEqual(fromPta({ homeworks: [{ name: '错过的', state: '未作答', deadline: '2026-10-01 23:59', closed: true }] }), [])
  assert.equal(fromXuezai({ todos: [{ course: '数据结构基础', title: '实验一', type: '作业', deadline: '2026-10-05 23:59', done: true }] })[0].done, true)
  assert.throws(() => fromXuezai({}), /格式不对/)
})

test('the page gets the cache first; a refresh replaces one system at a time and survives a restart', async (t) => {
  const world = setup(t), affairs = world.create()
  assert.deepEqual(affairs.snapshot(), { items: [], sources: [
    { id: 'xuezai', name: '学在浙大', state: 'ready', plugin: 'zju-courses', fetchedAt: null, error: null },
    { id: 'pta', name: 'PTA', state: 'ready', plugin: 'zju-courses', fetchedAt: null, error: null },
  ] })
  const first = await affairs.refresh({ source: 'xuezai' })
  assert.deepEqual(first.items.map(item => item.title), ['第二章测验', '实验三'])
  const both = await affairs.refresh({ source: 'pta' })
  // 两个系统的放在一起，按截止时间从近到远。
  assert.deepEqual(both.items.map(item => item.title), ['第二章测验', 'HW3', '实验三'])
  assert.equal(both.sources[0].fetchedAt, '2026-10-08T00:00:00.000Z')
  // 重新打开应用：不联网就能拿到上一次的结果。
  const reopened = world.create()
  assert.deepEqual(reopened.snapshot(), both)
  assert.deepEqual(world.calls, ['xuezai', 'pta'])
  assert.doesNotMatch(fs.readFileSync(world.file, 'utf8'), /3240100001|a@b\.c/)
  // 升级前保存的 PTA 卡片和详情也不能继续把作答进度说成开放状态。
  const legacy = JSON.parse(fs.readFileSync(world.file, 'utf8')), item = legacy.sources.pta.items[0]
  item.note = '还没开始'
  legacy.details[item.id] = { owner: legacy.sources.pta.owner, detail: { body: '', format: 'markdown', facts: [{ label: '状态', value: '未开始' }], files: [] } }
  fs.writeFileSync(world.file, JSON.stringify(legacy))
  const updated = world.create()
  assert.equal(updated.snapshot().items.find(entry => entry.id === item.id).note, '未作答')
  assert.deepEqual(updated.detail({ id: item.id }).detail.facts, [{ label: '作答状态', value: '未作答' }])
  assert.deepEqual(world.calls, ['xuezai', 'pta'])
})

test('refreshes are spaced out, shared while running, and a failure keeps the last result', async (t) => {
  const world = setup(t), affairs = world.create()
  // 同时来的两个请求等的是同一次读取。
  await Promise.all([affairs.refresh({ source: 'xuezai' }), affairs.refresh({ source: 'xuezai' })])
  assert.deepEqual(world.calls, ['xuezai'])
  // 一分钟内再进页面不重新读，点刷新才读。
  world.now += 30_000
  await affairs.refresh({ source: 'xuezai' })
  assert.deepEqual(world.calls, ['xuezai'])
  await affairs.refresh({ source: 'xuezai', force: true })
  assert.deepEqual(world.calls, ['xuezai', 'xuezai'])

  // 这次没读到：上一次的两项还在，原因记下来。
  world.now += 61_000
  world.results.xuezai = new Error('登录失败；检查密码')
  const failed = await affairs.refresh({ source: 'xuezai' })
  assert.equal(failed.items.length, 2)
  assert.equal(failed.sources[0].error, '登录失败；检查密码')
  assert.equal(failed.sources[0].fetchedAt, '2026-10-08T00:00:30.000Z')
  // 失败以后五分钟内不自动重试，免得用错的密码反复登录。
  world.now += 61_000
  await affairs.refresh({ source: 'xuezai' })
  assert.equal(world.calls.length, 3)
  world.now += 5 * 60_000
  world.results.xuezai = { todos: [XUEZAI.todos[0]] }
  const recovered = await affairs.refresh({ source: 'xuezai' })
  assert.deepEqual(recovered.items.map(item => item.title), ['实验三'])
  assert.equal(recovered.sources[0].error, null)
  await assert.rejects(() => affairs.refresh({ source: 'nope' }), /没有这个系统/)
})

test('nothing is read without an account or with the plugin off, and another account never sees the old cache', async (t) => {
  const world = setup(t, { accounts: { zju_username: '3240100001', zju_password: 'x' } }), affairs = world.create()
  // PTA 的账号没填：不去读，告诉页面到哪一项里填。
  const snapshot = await affairs.refresh({ source: 'pta' })
  assert.deepEqual(snapshot.sources[1], { id: 'pta', name: 'PTA', state: 'account', plugin: 'zju-courses', fetchedAt: null, error: null })
  assert.deepEqual(world.calls, [])
  assert.equal((await affairs.refresh({ source: 'xuezai' })).items.length, 2)

  // 换了一个学号：原来那个人的作业不再给出来。
  world.accounts = { zju_username: '3240100002', zju_password: 'x' }
  assert.deepEqual(affairs.snapshot().items, [])
  assert.equal(affairs.snapshot().sources[0].fetchedAt, null)
  world.accounts = { zju_username: '3240100001' }
  assert.deepEqual(affairs.snapshot().sources[0], { id: 'xuezai', name: '学在浙大', state: 'account', plugin: 'zju-account', fetchedAt: null, error: null })

  // 插件页关掉「课程与作业」：两个系统都不读，缓存也不显示。
  world.accounts = { zju_username: '3240100001', zju_password: 'x' }
  world.disabled = ['zju-courses']
  const off = await affairs.refresh({ source: 'xuezai', force: true })
  assert.deepEqual(off.sources.map(source => source.state), ['off', 'off'])
  assert.deepEqual(off.items, [])
  assert.deepEqual(world.calls, ['xuezai'])
})

test('opening one item: what the list already knows first, then the full view, each cached with its item', async (t) => {
  const world = setup(t), affairs = world.create()
  world.results.xuezai = { todos: [{ ...XUEZAI.todos[0], requirement: '完成实验三，提交报告' }, XUEZAI.todos[1]] }
  world.results['xuezai homework view'] = {
    name: '实验三', deadline: '2026-10-12 23:59', status: '未交', requirement: '完成实验三，提交报告和源码', attachments: ['实验三.pdf'],
    submitWith: '上传文件', resubmit: '不限次数', retractAllowed: true,
    submissions: [{ submittedAt: '2026-10-06 20:00', draft: true, files: [] }, { submittedAt: '2026-10-05 21:30', canRetract: true, files: ['a.zip', 'b.pdf'] }],
  }
  world.results['pta homework view'] = { name: 'HW3', description: '链表练习', state: '部分作答', total: 10, answered: 3, accepted: 2, wrong: 1, problems: [{ label: '7-1', type: '编程题', score: 20, status: '正确' }] }
  const list = await affairs.refresh({ source: 'xuezai' })
  await affairs.refresh({ source: 'pta' })
  // 列表里不带作业要求和内部的编号，它们只留在缓存里。
  assert.deepEqual(Object.keys(list.items[1]), ['id', 'source', 'title', 'course', 'kind', 'deadline'])
  const lab = list.items.find(item => item.title === '实验三'), quiz = list.items.find(item => item.title === '第二章测验')

  // 没读过完整的：先给列表顺带读到的要求，不联网。
  const first = affairs.detail({ id: lab.id })
  assert.deepEqual(first, { item: lab, detail: { body: '完成实验三，提交报告', format: 'text', facts: [], files: [] }, partial: true, more: true, fetchedAt: null, error: null, downloadable: true, saved: {} })
  const calls = world.calls.length
  const full = await affairs.refreshDetail({ id: lab.id })
  assert.deepEqual(world.calls.slice(calls), ['xuezai homework view --course 数据结构基础 --name 实验三'])
  assert.equal(full.partial, false)
  assert.equal(full.detail.body, '完成实验三，提交报告和源码')
  assert.deepEqual(full.detail.files, ['实验三.pdf'])
  assert.deepEqual(full.detail.facts, [
    { label: '状态', value: '未交' }, { label: '提交方式', value: '上传文件' }, { label: '重新提交', value: '不限次数' },
    { label: '最近一次提交', value: '2026-10-05 21:30，2 个文件' },
  ])
  // 再点开：直接是完整的；一分钟内不重读，重开应用后也在。
  await affairs.refreshDetail({ id: lab.id })
  assert.equal(world.calls.length, calls + 1)
  assert.deepEqual(world.create().detail({ id: lab.id }), full)

  // 在线测验读不到更多的内容，页面不用等。
  assert.deepEqual(await affairs.refreshDetail({ id: quiz.id }), { item: quiz, detail: null, partial: false, more: false, fetchedAt: null, error: null, downloadable: true, saved: {} })
  assert.equal(world.calls.length, calls + 1)

  // PTA 用题目集的编号去读；这次没读到时留着上一次的。
  const set = (await affairs.snapshot()).items.find(item => item.source === 'pta')
  const sheet = await affairs.refreshDetail({ id: set.id })
  assert.equal(world.calls.at(-1), 'pta homework view --set 1')
  assert.deepEqual(sheet.detail.table, { columns: ['题号', '题型', '分值', '状态'], rows: [['7-1', '编程题', '20', '正确']] })
  assert.equal(sheet.detail.format, 'markdown')
  world.now += 61_000
  world.results['pta homework view'] = new Error('PTA 没有回应')
  const failed = await affairs.refreshDetail({ id: set.id })
  assert.equal(failed.error, 'PTA 没有回应')
  assert.deepEqual(failed.detail, sheet.detail)

  // 作业交了以后从列表里消失，它的详情也不再留着，再问就说明原因。
  world.now += 61_000
  world.results.xuezai = { todos: [XUEZAI.todos[1]] }
  await affairs.refresh({ source: 'xuezai' })
  assert.throws(() => affairs.detail({ id: lab.id }), /不在列表里/)
  await assert.rejects(() => affairs.refreshDetail({ id: lab.id }), /不在列表里/)
  assert.doesNotMatch(fs.readFileSync(world.file, 'utf8'), /提交报告和源码/)
  assert.match(fs.readFileSync(world.file, 'utf8'), /链表练习/)
})

test('detail views keep only what the page shows', () => {
  assert.deepEqual(xuezaiDetail({ requirement: '（老师未写文字说明）', status: '未交', attachments: [], submissions: [], groupHomework: true, score: 0 }),
    { body: '', format: 'text', facts: [{ label: '状态', value: '未交' }, { label: '小组作业', value: '是' }, { label: '得分', value: '0' }], files: [] })
  assert.deepEqual(ptaDetail({ state: '未开始', note: '还没有开始答题' }),
    { body: '', format: 'markdown', facts: [{ label: '作答状态', value: '未作答' }], files: [], note: '还没有开始答题' })
})

test('an attachment is downloaded into its own folder, remembered, and shown in the file manager', async (t) => {
  const world = setup(t), affairs = world.create()
  world.results.xuezai = { todos: [{ course: '数据结构基础', title: '实验三: 树?', type: '作业', deadline: '2026-10-12 23:59' }] }
  world.results['xuezai homework view'] = { status: '未交', requirement: '见附件', attachments: ['题目.pdf', '模板.zip'], submissions: [] }
  // 假的 core：照命令里给的文件夹和文件名写一个文件。
  world.results['xuezai homework attachments'] = (args) => {
    const folder = args[args.indexOf('--out-dir') + 1], name = args[args.indexOf('--file') + 1]
    if (name === '模板.zip') return { count: 0, files: [], failed: [{ name, reason: '老师没有开放这个文件的下载' }] }
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, name), 'pdf')
    return { count: 1, files: [{ name, path: path.join(folder, name), size: '3 B' }] }
  }
  const item = (await affairs.refresh({ source: 'xuezai' })).items[0]
  // 还没点开读过完整的详情时不知道有哪些附件，不让下。
  await assert.rejects(() => affairs.download({ id: item.id, name: '题目.pdf' }), /没有这个附件/)
  await affairs.refreshDetail({ id: item.id })
  await assert.rejects(() => affairs.download({ id: item.id, name: '../别的文件' }), /没有这个附件/)

  const [done, same] = await Promise.all([affairs.download({ id: item.id, name: '题目.pdf' }), affairs.download({ id: item.id, name: '题目.pdf' })])
  // 文件夹名里去掉了不能用的符号；同时点两次只下一次。
  const saved = path.join(world.downloads, '数据结构基础', '实验三_ 树_', '题目.pdf')
  assert.deepEqual(done.saved, { '题目.pdf': saved })
  assert.deepEqual(same.saved, done.saved)
  assert.equal(world.calls.filter(line => line.startsWith('xuezai homework attachments')).length, 1)
  assert.ok(world.calls.at(-1).startsWith('xuezai homework attachments --course 数据结构基础 --name 实验三: 树? --file 题目.pdf --out-dir '))
  assert.ok(fs.existsSync(saved))

  // 重读详情、重开应用，下过的都还记着；在文件管理器里打开的只能是记着的那个路径。
  world.now += 61_000
  assert.deepEqual((await affairs.refreshDetail({ id: item.id })).saved, { '题目.pdf': saved })
  const reopened = world.create()
  reopened.reveal({ id: item.id, name: '题目.pdf' })
  assert.deepEqual(world.revealed, [saved])
  assert.throws(() => reopened.reveal({ id: item.id, name: '模板.zip' }), /重新下载/)

  // 没下成的把原因说出来；用户把文件删了，页面上就变回可以下载。
  await assert.rejects(() => affairs.download({ id: item.id, name: '模板.zip' }), /老师没有开放这个文件的下载/)
  fs.rmSync(saved)
  assert.deepEqual(affairs.detail({ id: item.id }).saved, {})
  assert.throws(() => affairs.reveal({ id: item.id, name: '题目.pdf' }), /重新下载/)
  // PTA 没有附件可下。
  await affairs.refresh({ source: 'pta' })
  assert.equal(affairs.detail({ id: affairs.snapshot().items.find(entry => entry.source === 'pta').id }).downloadable, false)
})

test('handed-in homework stays in the cache for the schedule but not on the affairs page', async (t) => {
  const world = setup(t)
  world.results.xuezai = { todos: [
    { course: '数据结构基础', title: '实验一', type: '作业', deadline: '2026-10-05 23:59', done: true },
    { course: '数据结构基础', title: '实验三', type: '作业', deadline: '2026-10-12 23:59' },
  ] }
  const affairs = world.create()
  await affairs.refreshAll()
  assert.deepEqual(affairs.snapshot().items.map(item => item.title), ['HW3', '实验三'])
  assert.deepEqual(affairs.tasks().filter(item => item.done).map(item => item.title), ['实验一', 'HW2'])
  assert.deepEqual(affairs.tasks().filter(item => !item.done).map(item => item.title).sort(), ['HW3', '实验三'])
})

test('Chaoxing homework: dated work only; undated reports, missed and done work are told apart', () => {
  const items = fromChaoxing(CHAOXING)
  assert.deepEqual(items.map(item => [item.title, item.kind, item.facts.map(fact => fact.value), item.done === true]), [
    ['第八周周测', '测试', ['第八周学习任务', '这个任务里还有 5 项内容'], false],
    ['第七周报告', '作业', ['第七周学习任务'], true],
  ])
  assert.equal(items[0].deadline, '2026-10-15T15:59:00.000Z')
  assert.equal(items[0].requirement, '必做')
  assert.throws(() => fromChaoxing({}), /格式不对/)
  // 有课没读到时整次算没读到，上一次的结果留着。
  assert.throws(() => fromChaoxing({ ...CHAOXING, failed: [{ course: '示例课程', reason: '超星没回应' }] }), /示例课程：超星没回应/)
})

test('Chaoxing is off by default: nothing is read and nothing shows until the switch is on', async (t) => {
  const accounts = { zju_username: '3240100001', zju_password: 'x', pta_username: 'a@b.c', pta_password: 'y', chaoxing_username: '13800000000', chaoxing_password: 'z' }
  const world = setup(t, { accounts })
  const affairs = world.create()
  assert.deepEqual(affairs.settings(), { chaoxingHomework: false })
  assert.equal(fs.existsSync(world.settingsFile), false)
  assert.equal(affairs.snapshot().sources.some(source => source.id === 'chaoxing'), false)
  await affairs.refreshAll()
  assert.ok(!world.calls.includes('chaoxing'))
  assert.ok(affairs.snapshot().items.every(item => item.source !== 'chaoxing'))

  // 打开以后读得到，点开是老师写的要求，不用再去系统读；日程表也拿得到做完的。
  assert.deepEqual(affairs.saveSettings({ chaoxingHomework: true }), { chaoxingHomework: true })
  await affairs.refresh({ source: 'chaoxing' })
  const shown = affairs.snapshot().items.filter(item => item.source === 'chaoxing')
  assert.deepEqual(shown.map(item => item.title), ['第八周周测'])
  assert.equal('requirement' in shown[0] || 'facts' in shown[0], false)
  const opened = affairs.detail({ id: shown[0].id })
  assert.equal(opened.more, false)
  assert.equal(opened.detail.body, '必做')
  assert.deepEqual(opened.detail.facts.map(fact => fact.label), ['学习任务', '还没学完'])
  assert.equal((await affairs.refreshDetail({ id: shown[0].id })).detail.body, '必做')
  assert.ok(affairs.tasks().some(item => item.title === '第七周报告' && item.done))

  // 重开应用还记得；关掉以后这些都不见了，也不再读。
  const reopened = world.create()
  assert.deepEqual(reopened.settings(), { chaoxingHomework: true })
  reopened.saveSettings({ chaoxingHomework: false })
  assert.ok(reopened.snapshot().items.every(item => item.source !== 'chaoxing'))
  assert.ok(reopened.tasks().every(item => item.source !== 'chaoxing'))
  assert.throws(() => reopened.detail({ id: shown[0].id }), /不在列表里/)
  const before = world.calls.length
  await reopened.refresh({ source: 'chaoxing', force: true })
  assert.equal(world.calls.length, before)
})

test('Chaoxing asks for the account only once the switch is on, reads less often, and refresh reads everything again', async (t) => {
  const world = setup(t)
  const affairs = world.create()
  assert.equal(affairs.snapshot().sources.some(source => source.id === 'chaoxing'), false)
  affairs.saveSettings({ chaoxingHomework: true })
  assert.equal(affairs.snapshot().sources.find(source => source.id === 'chaoxing').state, 'account')

  world.accounts = { ...world.accounts, chaoxing_username: '13800000000', chaoxing_password: 'z' }
  const seen = []
  world.results.chaoxing = (args) => { seen.push(args.join(' ')); return CHAOXING }
  await affairs.refresh({ source: 'chaoxing' })
  // 隔十分钟以内进页面不重新读；学在浙大那边是一分钟。
  world.now += 5 * 60_000
  await affairs.refresh({ source: 'chaoxing' })
  assert.deepEqual(seen, ['chaoxing homework list'])
  await affairs.refresh({ source: 'chaoxing', force: true })
  assert.deepEqual(seen, ['chaoxing homework list', 'chaoxing homework list --fresh'])
  world.now += 11 * 60_000
  await affairs.refresh({ source: 'chaoxing' })
  assert.equal(seen.length, 3)
})

test('when Chaoxing cannot be read the last list stays and the reason is shown', async (t) => {
  const world = setup(t, { accounts: { chaoxing_username: '13800000000', chaoxing_password: 'z' } })
  const affairs = world.create()
  affairs.saveSettings({ chaoxingHomework: true })
  await affairs.refresh({ source: 'chaoxing' })
  world.results.chaoxing = { ...CHAOXING, failed: [{ course: '示例课程', reason: '超星没回应' }], homeworks: [] }
  await affairs.refresh({ source: 'chaoxing', force: true })
  const snapshot = affairs.snapshot()
  assert.deepEqual(snapshot.items.map(item => item.title), ['第八周周测'])
  assert.match(snapshot.sources.find(source => source.id === 'chaoxing').error, /超星没回应/)
})
