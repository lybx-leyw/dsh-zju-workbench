import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Xuezai, matchCourse } from './xuezai.mjs'

const link = id => `https://courses.zju.edu.cn/course/${id}/content`
// 大学物理实验一门课挂着十六位教师，肖婷是其中一位。
const MANY = [...'甲乙丙丁戊己庚辛壬', '肖婷', ...'癸子丑寅卯辰']
// 学在浙大这学期的课程表。大学物理实验的名字后面带着年份和时段，学期也和智云写的不一样；两门微积分只能靠教师分；最后一条没有链接。
const COURSES = { semesters: ['2026-2027秋冬', '2026-2027秋'], count: 6, courses: [
  { name: '计算机组成', semester: '2026-2027秋冬', teachers: ['马德'], link: link(104348) },
  { name: '大学物理（乙）Ⅱ', semester: '2026-2027秋冬', teachers: ['赵'], link: link(104101) },
  { name: '大学物理实验2026周四345', semester: '2026-2027秋', teachers: MANY, link: link(104202) },
  { name: '微积分（甲）Ⅰ', semester: '2026-2027秋冬', teachers: ['钱'], link: link(104303) },
  { name: '微积分（甲）Ⅱ', semester: '2026-2027秋冬', teachers: ['孙', '李'], link: link(104304) },
  { name: '没有链接的一条', semester: '2026-2027秋冬', teachers: [] },
] }
// 两门课的文件清单，按课程链接放。计算机组成里：「第一章节」隔着别的章又出现一次；有的活动标题就是文件名；
// 有一章的名字里带着文件夹名不能有的符号；最后一个文件没有归到章里。
const MATERIALS = {
  [link(104348)]: { course: '计算机组成', count: 7, materials: [
    { name: '1.Orga_Ch1_V2.4.pdf', size: '8.3 MB', chapter: '第一章节', activity: 'Ch1: Computer abstractions  and Technology' },
    { name: 'Lab1 实验指导.pdf', size: '1.0 MB', chapter: '第一章节', activity: 'Lab1实验指导' },
    { name: '第二章 录像.mp4', size: '1.2 GB', chapter: '第二章', section: '2.1 小节', activity: '录像', video: true },
    { name: '2.Orga_Ch2.pdf', size: '5.0 MB', chapter: '第二章', section: '2.2 小节', activity: 'Ch2: Instructions' },
    { name: '勘误.pdf', size: '20.0 KB', chapter: '第一章节', activity: '第一章勘误' },
    { name: '3.Orga_Ch3.pdf', size: '6.1 MB', chapter: 'Ch3: Arithmetic.', activity: '3.Orga_Ch3.pdf' },
    { name: '没归到章里的.pdf', size: '1.0 MB', activity: '补充' },
  ] },
  [link(104202)]: { course: '大学物理实验2026周四345', count: 1, materials: [
    { name: '绪论.pdf', size: '2.0 MB', chapter: '绪论', activity: '绪论课件' },
  ] },
}
// 智云那一边的课（learning.mjs 课程表里的样子）。形势与政策在学在浙大上没有对应的课。
const ZHIYUN = [
  { id: '101', title: '计算机组成', teacher: '马德', term: '2026-2027秋冬' },
  { id: '102', title: '大学物理实验', teacher: '肖婷', term: '2026-2027秋冬' },
  { id: '103', title: '形势与政策', teacher: '周', term: '2026-2027秋冬' },
]
const ORGA = '101', LAB = '102', NONE = '103'
const SLIDES = '第一章节\n1.Orga_Ch1_V2.4.pdf', VIDEO = '第二章\n第二章 录像.mp4', CH3 = 'Ch3: Arithmetic.\n3.Orga_Ch3.pdf', LOOSE = '\n没归到章里的.pdf'
const EMPTY = { matched: null, name: '', groups: [], count: 0, fetchedAt: null, error: null }

/** 一套假的账号、开关、文件夹、智云课程和 core，记下 core 被叫了几次、每次带的是什么。 */
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-xuezai-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = {
    accounts: { zju_username: '3240100001', zju_password: 'x' },
    disabled: [], calls: [], options: [], revealed: [], now: Date.parse('2026-10-10T12:00:00+08:00'), docs: path.join(root, 'docs'), file: path.join(root, 'cache', 'xuezai.json'),
    // fail 按命令放这次要报的错：{ 'course list': 错 }。
    fail: {},
  }
  world.create = () => new Xuezai({
    file: world.file,
    account: { read: () => ({ data: world.accounts }) },
    plugins: { disabled: () => world.disabled },
    chats: { root: async () => world.docs },
    downloads: { reveal: target => world.revealed.push(target) },
    course: (id) => {
      const found = ZHIYUN.find(item => item.id === String(id))
      if (!found) throw new Error('这门课已经不在课程表里了，回到列表刷新一下。')
      return found
    },
    now: () => world.now,
    run: async (args, options) => {
      world.calls.push(args)
      world.options.push(options)
      const what = args.slice(1, 3).join(' ')
      if (world.fail[what]) throw world.fail[what]
      if (what === 'course list') return COURSES
      if (what === 'material list') return MATERIALS[args[3].slice('--course='.length)]
      if (what === 'material download') return world.download(args, options)
      throw new Error(`没有准备这条命令：${args.join(' ')}`)
    },
  })
  /** 照 core 的样子把文件放进它被告知的文件夹：<out-dir>\<文件名>。 */
  world.download = async (args) => {
    const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
    const file = path.join(flag('out-dir'), flag('name'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x')
    return { course: '计算机组成', count: 1, files: [{ name: flag('name'), path: file, size: '1 B' }] }
  }
  world.stored = () => JSON.parse(fs.readFileSync(world.file, 'utf8'))
  return world
}
const file = (page, id) => page.groups.flatMap(group => group.files).find(item => item.id === id)

test('智云的课对到学在浙大的哪一门：名字一样的，一个包含另一个的；有好几门时看教师，分不清的不认', () => {
  const rows = COURSES.courses
  // 名字一样；全角半角、罗马数字的写法不算差别。
  assert.equal(matchCourse({ title: '大学物理（乙）Ⅱ', teacher: '赵' }, rows), 1)
  assert.equal(matchCourse({ title: '大学物理(乙)II', teacher: '' }, rows), 1)
  // 学在浙大的名字后面多了年份和时段：只有它包含「大学物理实验」，「大学物理（乙）Ⅱ」不算。
  assert.equal(matchCourse({ title: '大学物理实验', teacher: '肖婷' }, rows), 2)
  assert.equal(matchCourse({ title: '大学物理实验', teacher: '' }, rows), 2)
  // 反过来，智云的名字长一些的也认。
  assert.equal(matchCourse({ title: '计算机组成与设计', teacher: '' }, rows), 0)
  // 「微积分」两门的名字里都有：看教师，教师一栏写着几位的拆开看；对不上、两门都对得上的不认。
  assert.equal(matchCourse({ title: '微积分', teacher: '钱' }, rows), 3)
  assert.equal(matchCourse({ title: '微积分', teacher: '周、李' }, rows), 4)
  assert.equal(matchCourse({ title: '微积分', teacher: '周 孙' }, rows), 4)
  assert.equal(matchCourse({ title: '微积分', teacher: '周' }, rows), -1)
  assert.equal(matchCourse({ title: '微积分', teacher: '' }, rows), -1)
  assert.equal(matchCourse({ title: '微积分', teacher: '钱，孙' }, rows), -1)
  // 有名字一样的就不再看包含的：去掉全角以后「微积分（甲）Ⅰ」也在「微积分（甲）Ⅱ」里面。
  assert.equal(matchCourse({ title: '微积分（甲）Ⅰ', teacher: '' }, rows), 3)
  assert.equal(matchCourse({ title: '大学物理实验', teacher: '' }, [{ name: '大学物理实验2026周四345', teachers: [] }, { name: '大学物理实验', teachers: [] }]), 1)
  // 两门课名字一模一样时也看教师。
  const twins = [{ name: '体育', teachers: ['赵'] }, { name: '体育', teachers: ['钱'] }]
  assert.equal(matchCourse({ title: '体育', teacher: '钱' }, twins), 1)
  assert.equal(matchCourse({ title: '体育', teacher: '周' }, twins), -1)
  // 学在浙大上没有的课；只有一个字的名字不拿去比包含；没有名字的不认。
  assert.equal(matchCourse({ title: '形势与政策', teacher: '赵' }, rows), -1)
  assert.equal(matchCourse({ title: 'C', teacher: '' }, [{ name: 'C程序设计基础', teachers: [] }]), -1)
  assert.equal(matchCourse({ title: '', teacher: '' }, rows), -1)
})

test('先看缓存，再去学在浙大读：课程表读一次，对到的那门课读一次文件清单；文件按章分成一个个文件夹，章里分了节的一节一个', async (t) => {
  const world = setup(t), xuezai = world.create()
  assert.deepEqual(await xuezai.files({ course: ORGA }), { state: 'ready', plugin: 'zju-courses', ...EMPTY })
  let page = await xuezai.refreshFiles({ course: ORGA })
  assert.deepEqual(world.calls, [['xuezai', 'course', 'list'], ['xuezai', 'material', 'list', `--course=${link(104348)}`]])
  assert.deepEqual([page.state, page.plugin, page.matched, page.name, page.count, page.fetchedAt, page.error], ['ready', 'zju-courses', true, '计算机组成', 7, new Date(world.now).toISOString(), null])
  // 照课程里的先后；又出现一次的「第一章节」并进前面那一组；章里分了节的一节一个文件夹；没有归到章里的在最后。
  // 文件只有名字，挂在哪个活动上不往外给。文件的编号里只有章，没有节。
  const row = (chapter, name, video = false) => ({ id: `${chapter}\n${name}`, name, video, saved: false, busy: false })
  assert.deepEqual(page.groups, [
    { title: '第一章节', files: [row('第一章节', '1.Orga_Ch1_V2.4.pdf'), row('第一章节', 'Lab1 实验指导.pdf'), row('第一章节', '勘误.pdf')] },
    { title: '第二章 / 2.1 小节', files: [row('第二章', '第二章 录像.mp4', true)] },
    { title: '第二章 / 2.2 小节', files: [row('第二章', '2.Orga_Ch2.pdf')] },
    { title: 'Ch3: Arithmetic.', files: [row('Ch3: Arithmetic.', '3.Orga_Ch3.pdf')] },
    { title: '', files: [row('', '没归到章里的.pdf')] },
  ])
  // 缓存里：课程号取自链接，没有链接的那条不留；文件不留大小，没有的章和小节是空的。
  const stored = world.stored()
  assert.deepEqual(stored.courses.items.map(item => item.id), ['104348', '104101', '104202', '104303', '104304'])
  assert.deepEqual(stored.courses.items[0], { id: '104348', name: '计算机组成', teachers: ['马德'], link: link(104348) })
  assert.deepEqual(stored.files['104348'].items[2], { chapter: '第二章', section: '2.1 小节', name: '第二章 录像.mp4', activity: '录像', video: true })
  assert.deepEqual(stored.files['104348'].items.at(-1), { chapter: '', section: '', name: '没归到章里的.pdf', activity: '补充', video: false })
  // 名字不一样的课：交给 core 的是它在学在浙大的链接，name 是它在学在浙大的名字；课程表刚读过，不再读。
  page = await xuezai.refreshFiles({ course: LAB })
  assert.deepEqual(world.calls.slice(2), [['xuezai', 'material', 'list', `--course=${link(104202)}`]])
  assert.deepEqual([page.matched, page.name, page.count, page.groups.map(group => group.title)], [true, '大学物理实验2026周四345', 1, ['绪论']])
})

test('学在浙大上没有对应的课：说没对到，不去读文件清单；智云的课程表里已经没有的课，原话报出来', async (t) => {
  const world = setup(t), xuezai = world.create()
  const page = await xuezai.refreshFiles({ course: NONE })
  assert.deepEqual(world.calls, [['xuezai', 'course', 'list']])
  assert.deepEqual(page, { state: 'ready', plugin: 'zju-courses', ...EMPTY, matched: false })
  await assert.rejects(xuezai.files({ course: '999' }), /不在课程表里/)
  await assert.rejects(xuezai.refreshFiles({ course: '999', force: true }), /不在课程表里/)
  assert.equal(world.calls.length, 1)
})

test('刚读过不重读，点刷新照读；没读到时留着上一次的并记下原因，不马上重试；重开应用后缓存还在', async (t) => {
  const world = setup(t), xuezai = world.create()
  await xuezai.refreshFiles({ course: ORGA })
  world.now += 9 * 60_000
  await xuezai.refreshFiles({ course: ORGA })
  assert.equal(world.calls.length, 2)
  await xuezai.refreshFiles({ course: ORGA, force: true })
  assert.deepEqual(world.calls.slice(2), [['xuezai', 'course', 'list'], ['xuezai', 'material', 'list', `--course=${link(104348)}`]])
  const read = new Date(world.now).toISOString()
  // 文件清单这次没读到：上一次的各章还在，读到的时间也还是上一次的。
  world.now += 60_000
  world.fail = { 'material list': new Error('学在浙大一直没有回应，稍后再试。') }
  let page = await xuezai.refreshFiles({ course: ORGA, force: true })
  assert.equal(world.calls.length, 6)
  assert.deepEqual([page.matched, page.count, page.groups.length, page.fetchedAt, page.error], [true, 7, 5, read, '学在浙大一直没有回应，稍后再试。'])
  // 失败后的几分钟里再进页面不去读；过了这几分钟才重试，读到了原因就没了。
  world.now += 4 * 60_000
  await xuezai.refreshFiles({ course: ORGA })
  assert.equal(world.calls.length, 6)
  world.now += 2 * 60_000
  world.fail = {}
  page = await xuezai.refreshFiles({ course: ORGA })
  assert.deepEqual(world.calls.slice(6), [['xuezai', 'material', 'list', `--course=${link(104348)}`]])
  assert.deepEqual([page.fetchedAt, page.error], [new Date(world.now).toISOString(), null])
  // 课程表这次没读到：多半是登录没过，不接着读文件清单（再读一条就是再登录一次）；页面照上一次的课程表和文件清单画，原因记的是课程表的。
  world.fail = { 'course list': new Error('统一身份认证登录失败：密码错误') }
  page = await xuezai.refreshFiles({ course: ORGA, force: true })
  assert.deepEqual(world.calls.slice(7), [['xuezai', 'course', 'list']])
  assert.deepEqual([page.matched, page.name, page.count, page.error], [true, '计算机组成', 7, '统一身份认证登录失败：密码错误'])
  await xuezai.refreshFiles({ course: ORGA })
  assert.equal(world.calls.length, 8)
  page = await world.create().files({ course: ORGA })
  assert.deepEqual([page.matched, page.count, page.error], [true, 7, '统一身份认证登录失败：密码错误'])
})

test('课程表从来没读到过：不去读文件清单，也不马上重试；后来读到了再接着读', async (t) => {
  const world = setup(t), xuezai = world.create()
  world.fail = { 'course list': new Error('统一身份认证登录失败：密码错误') }
  let page = await xuezai.refreshFiles({ course: ORGA })
  assert.deepEqual(world.calls, [['xuezai', 'course', 'list']])
  assert.deepEqual(page, { state: 'ready', plugin: 'zju-courses', ...EMPTY, error: '统一身份认证登录失败：密码错误' })
  world.now += 4 * 60_000
  await xuezai.refreshFiles({ course: ORGA })
  assert.equal(world.calls.length, 1)
  world.now += 2 * 60_000
  world.fail = {}
  page = await xuezai.refreshFiles({ course: ORGA })
  assert.equal(world.calls.length, 3)
  assert.deepEqual([page.matched, page.count, page.error], [true, 7, null])
})

test('插件关着或账号没填时不联网，也不去问智云的课；换了账号看不到上一个账号读到的', async (t) => {
  const world = setup(t), xuezai = world.create()
  await xuezai.refreshFiles({ course: ORGA })
  world.disabled = ['zju-courses']
  assert.deepEqual(await xuezai.refreshFiles({ course: ORGA, force: true }), { state: 'off', plugin: 'zju-courses', ...EMPTY })
  assert.equal((await xuezai.files({ course: '999' })).state, 'off')
  await assert.rejects(xuezai.download({ course: ORGA, file: SLIDES }), /下载不了/)
  // 统一身份认证的账号在「校园账号」那一项里填。
  world.disabled = []
  world.accounts = { zju_username: '3240100001' }
  assert.deepEqual(await xuezai.refreshFiles({ course: ORGA, force: true }), { state: 'account', plugin: 'zju-account', ...EMPTY })
  assert.equal(world.calls.length, 2)
  world.accounts = { zju_username: '3240100002', zju_password: 'x' }
  assert.deepEqual(await xuezai.files({ course: ORGA }), { state: 'ready', plugin: 'zju-courses', ...EMPTY })
  world.accounts = { zju_username: '3240100001', zju_password: 'x' }
  assert.equal((await xuezai.files({ course: ORGA })).count, 7)
})

test('下载交给 core，落在智云那门课的文件夹里的「学在浙大」下面，一章一个文件夹；下完能在文件夹里找到', async (t) => {
  const world = setup(t), xuezai = world.create()
  await xuezai.refreshFiles({ course: ORGA })
  const folder = path.join(world.docs, '课程', '计算机组成', '学在浙大'), slides = path.join(folder, '第一章节', '1.Orga_Ch1_V2.4.pdf')
  let page = await xuezai.download({ course: ORGA, file: SLIDES })
  assert.deepEqual(world.calls.at(-1), ['xuezai', 'material', 'download', `--course=${link(104348)}`, '--chapter=第一章节', '--name=1.Orga_Ch1_V2.4.pdf', `--out-dir=${path.join(folder, '第一章节')}`])
  assert.deepEqual([world.options.at(-1).system, world.options.at(-1).timeoutMs], ['学在浙大', 20 * 60_000])
  assert.ok(fs.existsSync(slides))
  assert.deepEqual(page.groups[0].files.map(item => item.saved), [true, false, false])
  assert.deepEqual(world.stored().saved, { 104348: { [SLIDES]: slides } })
  await xuezai.reveal({ course: ORGA, file: SLIDES })
  assert.deepEqual(world.revealed, [slides])
  // 视频等得久一些。章的名字里有文件夹名不能有的符号：交给 core 的还是原来的名字，文件夹名换掉符号、去掉末尾的点。
  await xuezai.download({ course: ORGA, file: VIDEO })
  assert.equal(world.options.at(-1).timeoutMs, 2 * 60 * 60_000)
  await xuezai.download({ course: ORGA, file: CH3 })
  assert.deepEqual(world.calls.at(-1).slice(4), ['--chapter=Ch3: Arithmetic.', '--name=3.Orga_Ch3.pdf', `--out-dir=${path.join(folder, 'Ch3_ Arithmetic')}`])
  // 没有归到章里的：不带 --chapter，直接放在「学在浙大」里。
  page = await xuezai.download({ course: ORGA, file: LOOSE })
  assert.deepEqual(world.calls.at(-1), ['xuezai', 'material', 'download', `--course=${link(104348)}`, '--name=没归到章里的.pdf', `--out-dir=${folder}`])
  assert.equal(file(page, LOOSE).saved, true)
  // 两边名字不一样的课：文件夹用智云的课程名，和智云下的课次在一处。
  await xuezai.refreshFiles({ course: LAB })
  await xuezai.download({ course: LAB, file: '绪论\n绪论.pdf' })
  assert.equal(world.calls.at(-1).at(-1), `--out-dir=${path.join(world.docs, '课程', '大学物理实验', '学在浙大', '绪论')}`)
  // 重开应用后还认得；文件被挪走了就当作没下过，别的文件不受影响。
  assert.equal(file(await world.create().files({ course: ORGA }), SLIDES).saved, true)
  fs.rmSync(slides)
  page = await xuezai.files({ course: ORGA })
  assert.deepEqual([file(page, SLIDES).saved, file(page, LOOSE).saved], [false, true])
  await assert.rejects(xuezai.reveal({ course: ORGA, file: SLIDES }), /不在原来的位置/)
  assert.equal(world.revealed.length, 1)
})

test('下载的时候问得到下到哪了；下完、没下成以后就不在了', async (t) => {
  const world = setup(t), xuezai = world.create()
  await xuezai.refreshFiles({ course: ORGA })
  await xuezai.refreshFiles({ course: LAB })
  const seen = [], real = world.download
  world.download = async (args, options) => {
    seen.push(xuezai.downloading({ course: ORGA }))
    options.onProgress({ bytes: 50, total: 200 })
    seen.push(xuezai.downloading({ course: ORGA }))
    // 正在下的那一个在清单里标着；别的课问不到它，没对到的课也问不到。
    seen.push(file(await xuezai.files({ course: ORGA }), VIDEO).busy, xuezai.downloading({ course: LAB }), xuezai.downloading({ course: NONE }))
    return real(args)
  }
  const page = await xuezai.download({ course: ORGA, file: VIDEO })
  assert.deepEqual(seen, [{ [VIDEO]: { bytes: 0, total: 0 } }, { [VIDEO]: { bytes: 50, total: 200 } }, true, {}, {}])
  assert.deepEqual(xuezai.downloading({ course: ORGA }), {})
  assert.deepEqual([file(page, VIDEO).busy, file(page, VIDEO).saved], [false, true])
  world.download = async (_args, options) => { options.onProgress({ bytes: 1, total: 2 }); throw new Error('下载 HTTP 403') }
  await assert.rejects(xuezai.download({ course: ORGA, file: SLIDES }), /403/)
  assert.deepEqual(xuezai.downloading({ course: ORGA }), {})
})

test('下载不了的照实说：清单里没有的文件不去问 core，core 给的原因原样报；没下成的不记成已下载', async (t) => {
  const world = setup(t), xuezai = world.create()
  await xuezai.refreshFiles({ course: ORGA })
  await xuezai.refreshFiles({ course: NONE })
  const calls = world.calls.length
  // 没有这个名字的、章不对的、没说是哪个文件的、这门课在学在浙大上没对到的。
  await assert.rejects(xuezai.download({ course: ORGA, file: '第一章节\n别处的文件.pdf' }), /不在这门课里/)
  await assert.rejects(xuezai.download({ course: ORGA, file: '第二章\n1.Orga_Ch1_V2.4.pdf' }), /不在这门课里/)
  await assert.rejects(xuezai.download({ course: ORGA }), /不在这门课里/)
  await assert.rejects(xuezai.download({ course: NONE, file: SLIDES }), /不在这门课里/)
  await assert.rejects(xuezai.download({ course: '999', file: SLIDES }), /不在课程表里/)
  assert.equal(world.calls.length, calls)
  world.download = async () => { throw new Error('学在浙大登录失败：密码错误') }
  await assert.rejects(xuezai.download({ course: ORGA, file: SLIDES }), /密码错误/)
  world.download = async () => ({ count: 0, files: [], failed: [{ name: '1.Orga_Ch1_V2.4.pdf', reason: '下载多次中断或超时' }] })
  await assert.rejects(xuezai.download({ course: ORGA, file: SLIDES }), /多次中断/)
  world.download = async () => ({ count: 0, files: [] })
  await assert.rejects(xuezai.download({ course: ORGA, file: SLIDES }), /没有下载下来/)
  assert.equal(world.calls.length, calls + 3)
  assert.equal(file(await xuezai.files({ course: ORGA }), SLIDES).saved, false)
  assert.deepEqual(world.stored().saved, {})
  await assert.rejects(xuezai.reveal({ course: ORGA, file: SLIDES }), /不在原来的位置/)
})
