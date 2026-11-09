import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Chaoxing, matchTitle, matchTitles } from './chaoxing.mjs'

const link = (course, clazz) => `https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=${course}&clazzid=${clazz}&cpi=9&ismooc2=1&v=2`
// 两门课的名字一个包含另一个：按名字找会分不清，所以交回 core 的是链接。
const COURSES = { count: 3, courses: [
  { name: '大学物理实验2026', teacher: '甲, 乙,丙，丁、戊', class: '周三班', link: link(201, 31) },
  { name: '大学物理实验', teacher: '己', class: '去年的班', link: link(101, 21) },
  { name: '没有链接的一条', teacher: '', class: '' },
] }
const CHAPTERS = { course: '大学物理实验2026', count: 5, chapters: [
  { location: '力学实验 / 2.1 金属材料杨氏模量的测量', videos: [{ name: '杨氏模量.mp4', size: '80.0 MB' }] },
  { location: '力学实验 / 2.3 固定均匀弦振动', materials: [{ name: '弦振动.pdf', size: '2.1 MB' }] },
  { location: '光学实验 / 5.2 等厚干涉G', materials: [{ name: '等厚干涉.pdf', size: '8.1 MB' }, { name: '补充讲义.pptx', size: '2.0 MB' }], videos: [{ name: '等厚干涉.mp4', size: '195.0 MB' }] },
  { location: '资料', materials: [{ name: '实验报告模板.docx', size: '310.0 KB' }] },
  { location: '资料 / 讲义 / 往年', materials: [{ name: '绪论.pdf', size: '310.0 KB' }, { name: '不给下的.pdf', size: '1.0 MB', downloadable: false }] },
], notOpen: ['6.1 还没开放的一节'], warning: '资料栏没有读到：超时' }
// 实验课表：叫法和学习通差一两个字、带「▲」；两周连做的一项里有两个实验、上两次；有一个这门课里没有。按日期排好的。
const LABS = { currentTime: '2026-10-10 12:00', count: 4, sessions: [
  { date: '2026-10-14', start: '13:15', course: '大学物理实验', experiment: '等厚干涉▲', room: '东四', teacher: '甲', sequence: '1' },
  { date: '2026-10-21', start: '13:15', course: '大学物理实验', experiment: '组合1：金属材料杨氏模量的测定+▲固定均匀弦振动的研究（2周）', room: '东四', teacher: '乙', sequence: '2,3' },
  { date: '2026-10-28', start: '13:15', course: '大学物理实验', experiment: '组合1：金属材料杨氏模量的测定+▲固定均匀弦振动的研究（2周）', room: '东四', teacher: '乙', sequence: '2,3' },
  { date: '2026-11-04', start: '13:15', course: '大学物理实验', experiment: '光电效应', room: '东四', teacher: '丙', sequence: '4' },
] }

/** 一套假的账号、开关、文件夹和 core，记下 core 被叫了几次。 */
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-chaoxing-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = {
    accounts: { chaoxing_username: '13800000000', chaoxing_password: 'x', zju_username: '3240100001', lab_password: 'y' },
    disabled: [], calls: [], revealed: [], now: Date.parse('2026-10-10T12:00:00+08:00'), docs: path.join(root, 'docs'), fail: null, labs: LABS,
  }
  world.create = () => new Chaoxing({
    file: path.join(root, 'cache', 'chaoxing.json'),
    account: { read: () => ({ data: world.accounts }) },
    plugins: { disabled: () => world.disabled },
    chats: { root: async () => world.docs },
    downloads: { reveal: target => world.revealed.push(target) },
    now: () => world.now,
    run: async (args, options) => {
      world.calls.push(args)
      if (args[0] === 'lab') { if (!world.labs) throw new Error('实验课平台登录失败'); return world.labs }
      if (world.fail) throw world.fail
      if (args[1] === 'course') return COURSES
      if (args[1] === 'chapter') return CHAPTERS
      if (args[2] === 'download') return world.download(args, options)
      throw new Error(`没有准备这条命令：${args.join(' ')}`)
    },
  })
  /** 照 core 的样子把文件放进它被告知的文件夹：<out-dir>\<章节>\<文件名>，播放版另起名字。 */
  world.download = async (args) => {
    const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
    const name = flag('quality') === 'playback' ? `${flag('name').replace(/\.[^.]+$/, '')}（播放版）.mp4` : flag('name')
    const file = path.join(flag('out-dir'), ...flag('chapter').split(' / '), name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x')
    return { count: 1, files: [{ name, path: file, size: '1 B' }] }
  }
  world.sent = name => world.calls.filter(args => args[0] === name || `${args[0]} ${args[1]}` === name).length
  return world
}
const PHYSICS = '201-31', OPTICS = '光学实验 / 5.2 等厚干涉G', YOUNG = '力学实验 / 2.1 金属材料杨氏模量的测量'
const video = { course: PHYSICS, location: OPTICS, group: 'video', name: '等厚干涉.mp4' }
const section = (page, location) => page.sections.find(item => item.location === location)

test('课程照学习通的顺序列；教师太多只写前三位；没有链接的认不出是哪门课，不列', async (t) => {
  const world = setup(t), chaoxing = world.create()
  assert.deepEqual((await chaoxing.snapshot()).courses, [])
  const page = await chaoxing.refresh()
  assert.equal(page.state, 'ready')
  assert.deepEqual(page.courses, [
    { id: '201-31', title: '大学物理实验2026', teacher: '甲、乙、丙等 5 位', className: '周三班' },
    { id: '101-21', title: '大学物理实验', teacher: '己', className: '去年的班' },
  ])
  assert.deepEqual(world.calls, [['chaoxing', 'course', 'list']])
})

test('刚读过不重读，点刷新照读；没读到时留着上一次的并记下原因，不马上重试', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  await chaoxing.refresh()
  assert.equal(world.calls.length, 1)
  world.fail = new Error('超星登录失败：密码错误')
  const page = await chaoxing.refresh({ force: true })
  assert.equal(world.calls.length, 2)
  assert.equal(page.courses.length, 2)
  assert.equal(page.error, '超星登录失败：密码错误')
  // 失败后的几分钟里再进页面不去登录；重开应用后缓存还在。
  await chaoxing.refresh()
  assert.equal(world.calls.length, 2)
  assert.equal((await world.create().snapshot()).courses.length, 2)
})

test('插件关着或账号没填时不联网；换了账号看不到上一个账号的课', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  world.disabled = ['zju-courses']
  assert.equal((await chaoxing.refresh({ force: true })).state, 'off')
  world.disabled = []
  world.accounts = { chaoxing_username: '13800000000' }
  const page = await chaoxing.refresh({ force: true })
  assert.deepEqual([page.state, page.plugin], ['account', 'zju-courses'])
  assert.equal(world.calls.length, 1)
  world.accounts = { chaoxing_username: '13900000000', chaoxing_password: 'x' }
  assert.deepEqual((await chaoxing.snapshot()).courses, [])
})

test('一门课一次读回各节的文件，交给 core 的是链接；每一节归在哪个大章下面，视频有原文件和播放版两种', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  assert.deepEqual((await chaoxing.files({ id: PHYSICS })).sections, [])
  const page = await chaoxing.refreshFiles({ id: PHYSICS })
  assert.deepEqual(world.calls.find(args => args[1] === 'chapter'), ['chaoxing', 'chapter', 'list', `--course=${link(201, 31)}`])
  assert.deepEqual(page.course, { id: PHYSICS, title: '大学物理实验2026', teacher: '甲、乙、丙等 5 位', className: '周三班' })
  assert.deepEqual(page.sections.map(item => [item.group, item.title, item.materials.length, item.videos.length]), [
    ['力学实验', '2.1 金属材料杨氏模量的测量', 0, 1],
    ['力学实验', '2.3 固定均匀弦振动', 1, 0],
    ['光学实验', '5.2 等厚干涉G', 2, 1],
    ['资料', '资料', 1, 0],
    ['资料', '讲义 / 往年', 2, 0],
  ])
  const optics = section(page, OPTICS)
  assert.deepEqual(optics.materials.map(file => [file.name, file.size, Object.keys(file.copies)]), [['等厚干涉.pdf', '8.1 MB', ['original']], ['补充讲义.pptx', '2.0 MB', ['original']]])
  assert.deepEqual(Object.keys(optics.videos[0].copies), ['original', 'playback'])
  assert.deepEqual(optics.videos[0].copies.playback, { id: `${OPTICS}\nvideo\n等厚干涉.mp4\nplayback`, saved: false, busy: false })
  assert.deepEqual(section(page, '资料 / 讲义 / 往年').materials.map(file => file.downloadable), [true, false])
  assert.deepEqual([page.notOpen, page.warning, page.error], [1, '资料栏没有读到：超时', null])
  // 半小时内再进来不重读；点刷新时让 core 整门课重读；这次没读到时上一次的各节还在。
  await chaoxing.refreshFiles({ id: PHYSICS })
  assert.equal(world.sent('chaoxing chapter'), 1)
  await chaoxing.refreshFiles({ id: PHYSICS, force: true })
  assert.deepEqual(world.calls.filter(args => args[1] === 'chapter').at(-1).at(-1), '--fresh')
  world.fail = new Error('超星要求输入验证码')
  const failed = await chaoxing.refreshFiles({ id: PHYSICS, force: true })
  assert.deepEqual([failed.sections.length, failed.notOpen, failed.error], [5, 1, '超星要求输入验证码'])
  await assert.rejects(chaoxing.files({ id: '1-1' }), /不在超星的课程里/)
})

test('实验课表上的实验对到这门课的哪一节：叫法差一两个字、带符号的对得上，分不清的不认', () => {
  const titles = ['2.1 金属材料杨氏模量的测量', '2.3 固定均匀弦振动', '5.1 光的等厚干涉', '5.2 等厚干涉G', '5.3 迈克尔逊干涉仪', '4.2 惠斯通电桥', '4.3 双臂电桥测低电阻']
  assert.equal(matchTitle('金属材料杨氏模量的测定', titles), 0)
  assert.equal(matchTitle('固定均匀弦振动的研究▲', titles), 1)
  assert.equal(matchTitle('惠斯通电桥', titles), 5)
  assert.equal(matchTitle('5.3 迈克尔逊干涉仪', titles), 4)
  // 「等厚干涉」在两节的名字里都有，「电桥」「干涉」也是：分不清，不认。
  assert.equal(matchTitle('等厚干涉', titles), -1)
  assert.equal(matchTitle('电桥', titles), -1)
  assert.equal(matchTitle('霍尔效应', titles), -1)
  assert.equal(matchTitle('光', titles), -1)
  // 两周连做的一项里有两个实验：拆开各对各的，对不上的那一半不算。
  assert.deepEqual(matchTitles('惠斯通电桥', titles), [5])
  assert.deepEqual(matchTitles('组合1：▲迈克尔逊干涉仪+固定均匀弦振动的研究（2周）', titles), [4, 1])
  assert.deepEqual(matchTitles('组合2：金属材料杨氏模量的测定+霍尔效应（2周）', titles), [0])
  assert.deepEqual(matchTitles('选做：惠斯通电桥', titles), [5])
  assert.deepEqual(matchTitles('霍尔效应', titles), [])
})

test('自己要上的实验按上课的先后排在前面：一个实验只列一次，这门课里没有的不列；没有课表就没有这一块', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  assert.deepEqual((await chaoxing.files({ id: PHYSICS })).mine, [])
  const page = await chaoxing.refreshFiles({ id: PHYSICS })
  assert.deepEqual(world.calls.filter(args => args[0] === 'lab'), [['lab', 'timetable']])
  assert.deepEqual(page.mine, [
    { location: OPTICS, date: '2026-10-14', time: '13:15' },
    { location: YOUNG, date: '2026-10-21', time: '13:15' },
    { location: '力学实验 / 2.3 固定均匀弦振动', date: '2026-10-21', time: '13:15' },
  ])
  // 半小时内不重读课表；重开应用后还在。
  await chaoxing.refreshFiles({ id: PHYSICS })
  assert.equal(world.sent('lab'), 1)
  assert.equal((await world.create().files({ id: PHYSICS })).mine.length, 3)
  // 课表这次没读到：留着上一次的，不为它报错。
  world.labs = null
  const kept = await chaoxing.refreshFiles({ id: PHYSICS, force: true })
  assert.deepEqual([kept.mine.length, kept.error], [3, null])
  // 实验课的密码没填：不读课表，也不显示。插件版里实验课和学习通同在「课程与学习」一行，不会一个开一个关。
  world.labs = LABS
  const calls = world.sent('lab')
  world.accounts = { chaoxing_username: '13800000000', chaoxing_password: 'x', zju_username: '3240100001' }
  assert.deepEqual((await chaoxing.refreshFiles({ id: PHYSICS, force: true })).mine, [])
  assert.equal(world.sent('lab'), calls)
})

test('下载交给 core，落在「文档」的课程文件夹；视频的原文件和播放版各下各的、各记各的；下完能在文件夹里找到', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  await chaoxing.refreshFiles({ id: PHYSICS })
  const folder = path.join(world.docs, '课程', '大学物理实验2026')
  let page = await chaoxing.download({ ...video, copy: 'playback' })
  assert.deepEqual(world.calls.at(-1), ['chaoxing', 'video', 'download', `--course=${link(201, 31)}`, `--chapter=${OPTICS}`, '--name=等厚干涉.mp4', '--quality=playback', `--out-dir=${folder}`])
  assert.deepEqual(Object.entries(section(page, OPTICS).videos[0].copies).map(([copy, state]) => [copy, state.saved]), [['original', false], ['playback', true]])
  page = await chaoxing.download(video)
  assert.ok(!world.calls.at(-1).some(arg => arg.startsWith('--quality')))
  assert.deepEqual(Object.values(section(page, OPTICS).videos[0].copies).map(state => state.saved), [true, true])
  page = await chaoxing.download({ course: PHYSICS, location: OPTICS, group: 'material', name: '等厚干涉.pdf' })
  assert.equal(world.calls.at(-1)[1], 'material')
  assert.deepEqual(section(page, OPTICS).materials.map(file => file.copies.original.saved), [true, false])
  const small = path.join(folder, '光学实验', '5.2 等厚干涉G', '等厚干涉（播放版）.mp4')
  await chaoxing.reveal({ ...video, copy: 'playback' })
  assert.deepEqual(world.revealed, [small])
  // 重开应用后还认得；文件被挪走了就当作没下过，另一种不受影响。
  assert.equal(section(await world.create().files({ id: PHYSICS }), OPTICS).videos[0].copies.playback.saved, true)
  fs.rmSync(small)
  assert.deepEqual(Object.values(section(await chaoxing.files({ id: PHYSICS }), OPTICS).videos[0].copies).map(state => state.saved), [true, false])
  await assert.rejects(chaoxing.reveal({ ...video, copy: 'playback' }), /不在原来的位置/)
})

test('下载的时候问得到下到哪了；下完、没下成以后就不在了', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  await chaoxing.refreshFiles({ id: PHYSICS })
  const id = `${OPTICS}\nvideo\n等厚干涉.mp4\noriginal`, seen = []
  const real = world.download
  world.download = async (args, options) => {
    seen.push(chaoxing.downloading({ course: PHYSICS }))
    options.onProgress({ bytes: 50, total: 200 })
    seen.push(chaoxing.downloading({ course: PHYSICS }))
    // 正在下的那一份在清单里标着；别的课问不到它。
    seen.push(section(await chaoxing.files({ id: PHYSICS }), OPTICS).videos[0].copies.original.busy, chaoxing.downloading({ course: '101-21' }))
    return real(args)
  }
  await chaoxing.download(video)
  assert.deepEqual(seen, [{ [id]: { bytes: 0, total: 0 } }, { [id]: { bytes: 50, total: 200 } }, true, {}])
  assert.deepEqual(chaoxing.downloading({ course: PHYSICS }), {})
  world.download = async (_args, options) => { options.onProgress({ bytes: 1, total: 2 }); throw new Error('下载 HTTP 403') }
  await assert.rejects(chaoxing.download({ ...video, copy: 'playback' }), /403/)
  assert.deepEqual(chaoxing.downloading({ course: PHYSICS }), {})
})

test('下载不了的照实说：core 给的原因、清单里没有的文件、不认识的种类；老师没开放的标出来', async (t) => {
  const world = setup(t), chaoxing = world.create()
  await chaoxing.refresh()
  await chaoxing.refreshFiles({ id: PHYSICS })
  const calls = world.calls.length, data = { course: PHYSICS, location: '资料 / 讲义 / 往年', group: 'material' }
  await assert.rejects(chaoxing.download({ course: PHYSICS, location: OPTICS, group: 'material', name: '别处的文件.pdf' }), /不在这门课里/)
  await assert.rejects(chaoxing.download({ course: PHYSICS, location: '没有的一节', group: 'material', name: '等厚干涉.pdf' }), /不在这门课里/)
  await assert.rejects(chaoxing.download({ course: PHYSICS, location: OPTICS, group: 'audio', name: '等厚干涉.pdf' }), /下载不了/)
  await assert.rejects(chaoxing.download({ course: PHYSICS, location: OPTICS, group: 'material', name: '等厚干涉.pdf', copy: 'playback' }), /下载不了/)
  assert.equal(world.calls.length, calls)
  world.download = async () => { throw new Error('老师没有开放这个文件的下载') }
  await assert.rejects(chaoxing.download({ ...data, name: '不给下的.pdf' }), /没有开放/)
  world.download = async () => ({ count: 0, files: [], failed: [{ name: '绪论.pdf', reason: '超星没有给出这个文件的下载地址' }] })
  await assert.rejects(chaoxing.download({ ...data, name: '绪论.pdf' }), /没有给出/)
  assert.equal(section(await chaoxing.files({ id: PHYSICS }), data.location).materials[0].copies.original.saved, false)
})
