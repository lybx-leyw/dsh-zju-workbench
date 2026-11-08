import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Learning, currentTerm, lessonTopic } from './learning.mjs'

// 「现在」是 2026-10-09，本学期是 2026-2027 秋冬。103 的学期是旧写法，090 是上学期的。
const COURSES = { courses: [
  { courseId: '101', title: '数据结构', teacher: '甲', term: '2026-2027秋冬' },
  { courseId: '102', title: '心理学', teacher: '乙', term: '2026-2027秋冬' },
  { courseId: '103', title: '还没开课', teacher: '丙', term: '2026-2027秋,2026-2027冬' },
  { courseId: '090', title: '上学期的课', teacher: '丁', term: '2025-2026春夏' },
] }
const LESSONS = {
  101: { lessons: [
    { lesson: 1, date: '2026-09-17', time: '13:25', playable: true, kinds: ['video', 'ppt'] },
    { lesson: 2, date: '2026-09-24', time: '13:25', playable: true, kinds: ['video', 'ppt'] },
    { lesson: 3, date: '2026-10-15', time: '13:25', playable: false, kinds: [] },
  ] },
  102: { lessons: [{ lesson: 1, date: '2026-10-07', time: '08:00', playable: true, kinds: ['video'] }] },
  103: { lessons: [{ lesson: 1, date: '2026-11-01', time: '08:00', playable: false, kinds: [] }] },
  '090': { lessons: [{ lesson: 1, date: '2026-05-10', time: '08:00', playable: true, kinds: ['video'] }] },
}
const RESOURCES = { lessons: [{ resources: [
  { kind: 'video', name: '回放', height: 1080 }, { kind: 'video', name: '回放 360p', height: 360 }, { kind: 'ppt', name: '第二讲.pptx' },
  { kind: 'slides', count: 45 }, { kind: 'audio', source: '下载时从视频里提取' }, { kind: 'subtitles', count: 0 },
] }] }

/** 一套假的账号、开关、文件夹和 core，记下 core 被叫了几次。 */
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-learning-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
  const world = { accounts: { zju_username: '3240100001', zju_password: 'x' }, disabled: [], calls: [], revealed: [], now: Date.parse('2026-10-09T12:00:00+08:00'), docs: path.join(root, 'docs'), fail: null }
  world.create = () => new Learning({
    file: path.join(root, 'cache', 'learning.json'),
    account: { read: () => ({ data: world.accounts }) },
    plugins: { disabled: () => world.disabled },
    chats: { root: async () => world.docs },
    downloads: { reveal: target => world.revealed.push(target) },
    now: () => world.now,
    run: async (args) => {
      world.calls.push(args.join(' '))
      if (world.fail) throw world.fail
      if (args[1] === 'search' && args[2] === 'courses') return COURSES
      if (args[1] === 'search' && args[2] === 'lessons') return LESSONS[args[4]]
      if (args[1] === 'search' && args[2] === 'resources') return RESOURCES
      if (args[1] === 'download') return world.download(args)
      throw new Error(`没有准备这条命令：${args.join(' ')}`)
    },
  })
  /** 照 core 的样子在课程文件夹里放一次课：清单加文件。 */
  world.put = (courseId, title, lesson, files, extra = {}) => {
    const dir = path.join(world.docs, '课程', title, `第${lesson}次 2026-09-24`)
    fs.mkdirSync(dir, { recursive: true })
    const rows = files.map(([kind, name]) => { const file = path.join(dir, name); fs.writeFileSync(file, 'x'); return { kind, name, path: file, bytes: 1 } })
    fs.writeFileSync(path.join(dir, 'download.json'), JSON.stringify({ version: 2, type: 'zhiyun-download', courseId, title, lessons: [{ lessonId: '9', lessonNumber: lesson, startsAt: '2026-09-24T13:25:00+08:00', files: rows }] }))
    for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), text)
    return dir
  }
  world.download = () => ({ files: [], skipped: [] })
  return world
}

test('课程按最近一次上课排，还没上过的在最后；行上带最近一次课', async (t) => {
  const world = setup(t), learning = world.create()
  assert.deepEqual((await learning.snapshot()).courses, [])
  const page = await learning.refresh()
  assert.deepEqual(page.courses.map(course => [course.title, course.count, course.last]), [
    ['心理学', 1, { lesson: 1, date: '2026-10-07' }],
    ['数据结构', 2, { lesson: 2, date: '2026-09-24' }],
    ['还没开课', 0, null],
  ])
  assert.equal(page.state, 'ready')
  assert.equal(page.filmRoot, path.join(world.docs, '讲解'))
  assert.equal(world.calls.length, 4)
})

test('只列本学期的课；以前学期的课次不主动读，从右栏点它的总结进来时才读', async (t) => {
  const at = text => currentTerm(Date.parse(text))
  assert.deepEqual(at('2026-10-09T12:00:00+08:00'), { years: '2026-2027', seasons: '秋冬' })
  assert.deepEqual(at('2027-01-20T12:00:00+08:00'), { years: '2026-2027', seasons: '秋冬' })
  assert.deepEqual(at('2027-03-01T12:00:00+08:00'), { years: '2026-2027', seasons: '春夏' })
  assert.deepEqual(at('2026-07-31T23:00:00+08:00'), { years: '2025-2026', seasons: '春夏' })
  const world = setup(t), learning = world.create()
  const page = await learning.refresh()
  assert.ok(!page.courses.some(course => course.title === '上学期的课'))
  assert.ok(!world.calls.some(line => line.endsWith('--course 090')))
  // 上学期那门课留下的总结照样在右栏；点进去时那门课的课次现读一次。
  world.put('090', '上学期的课', 1, [['subtitles', 'subtitles.json']], { '总结.md': '# 总结' })
  assert.deepEqual((await learning.snapshot()).products.map(item => [item.kind, item.title, item.lesson]), [['summary', '上学期的课', 1]])
  const lesson = await learning.lesson({ course: '090', lesson: 1 })
  assert.equal(lesson.course.title, '上学期的课')
  assert.equal(world.calls.filter(line => line === 'zhiyun search lessons --course 090').length, 1)
  await learning.lesson({ course: '090', lesson: 1 })
  assert.equal(world.calls.filter(line => line === 'zhiyun search lessons --course 090').length, 1)
})

test('刚读过不重读，点刷新照读；没读到时留着上一次的并记下原因', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  await learning.refresh()
  assert.equal(world.calls.length, 4)
  world.fail = new Error('智云没有回应')
  const page = await learning.refresh({ force: true })
  // 课程表只读一次（登录可能有问题，不重试）；每门课的课次没读到时马上再试一次：4 + 1 + 3 × 2。
  assert.equal(world.calls.length, 11)
  assert.equal(page.courses.length, 3)
  assert.equal(page.error, '智云没有回应')
  // 重开应用后缓存还在。
  assert.equal((await world.create().snapshot()).courses.length, 3)
})

test('插件关着或账号没填时不联网；换了账号看不到上一个账号的课', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  world.disabled = ['zju-courses']
  assert.equal((await learning.refresh({ force: true })).state, 'off')
  world.disabled = []
  world.accounts = { zju_username: '3240100001' }
  assert.equal((await learning.refresh({ force: true })).state, 'account')
  assert.equal(world.calls.length, 4)
  world.accounts = { zju_username: '3240100002', zju_password: 'x' }
  assert.deepEqual((await learning.snapshot()).courses, [])
})

test('一门课只列上过的课次，新的在上，带上本机有什么', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  world.put('101', '数据结构', 2, [['ppt', '第二讲.pptx'], ['subtitles', 'subtitles.json']], { '总结.md': '# 总结' })
  fs.mkdirSync(path.join(world.docs, '讲解', 'lessons', lessonTopic('101', 1)), { recursive: true })
  const page = await learning.course({ id: '101' })
  assert.equal(page.upcoming, 1)
  assert.deepEqual(page.lessons.map(lesson => [lesson.lesson, lesson.saved, lesson.summary, lesson.film]), [
    [2, ['ppt', 'subtitles'], true, null],
    [1, [], false, 'making'],
  ])
})

test('一次课：先只知道有哪几种，读过以后是完整的；没有字幕的不列', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  const brief = await learning.lesson({ course: '101', lesson: 2 })
  assert.equal(brief.partial, true)
  assert.deepEqual(brief.resources.map(item => item.kind), ['ppt', 'video'])
  const full = await learning.refreshLesson({ course: '101', lesson: 2 })
  assert.equal(full.partial, false)
  assert.deepEqual(full.resources.map(item => [item.label, item.text, item.saved]), [['课件', '第二讲.pptx', false], ['课堂截图', '45 张', false], ['回放', '1080p', false]])
  assert.equal(full.topic, 'c101-02')
  assert.equal(full.summary, null)
  assert.equal(full.film, null)
})

test('下载交给 core，下完那一行算已下载，能在文件夹里找到；core 说没有就报原因', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  await learning.refreshLesson({ course: '101', lesson: 2 })
  world.download = (args) => {
    assert.deepEqual(args.slice(0, 8), ['zhiyun', 'download', '--course', '101', '--lesson', '2', '--kind', 'ppt'])
    const dir = world.put('101', '数据结构', 2, [['ppt', '第二讲.pptx']])
    return { files: [{ kind: 'ppt', path: path.join(dir, '第二讲.pptx') }], skipped: [] }
  }
  const page = await learning.download({ course: '101', lesson: 2, kind: 'ppt' })
  assert.equal(page.resources.find(item => item.kind === 'ppt').saved, true)
  assert.ok(page.dir.endsWith('第2次 2026-09-24'))
  await learning.reveal({ course: '101', lesson: 2, kind: 'ppt' })
  assert.deepEqual(world.revealed, [path.join(page.dir, '第二讲.pptx')])
  world.download = () => ({ files: [], skipped: [{ kind: 'slides', reason: '该课次没有可用的此类资源' }] })
  await assert.rejects(learning.download({ course: '101', lesson: 2, kind: 'slides' }), /没有可用的此类资源/)
  await assert.rejects(learning.download({ course: '101', lesson: 2, kind: 'audio' }), /下载不了/)
  await assert.rejects(learning.reveal({ course: '101', lesson: 2, kind: 'video' }), /不在原来的位置/)
})

test('下载的时候问得到下到哪了，按种类给；下完、没下成以后就不在了', async (t) => {
  const world = setup(t), learning = world.create(), seen = []
  await learning.refresh()
  const run = learning.run
  learning.run = async (args, options) => {
    if (args[1] !== 'download') return run(args, options)
    seen.push(learning.downloading({ course: '101', lesson: 2 }))
    options.onProgress({ bytes: 300, total: 1200 })
    seen.push(learning.downloading({ course: '101', lesson: 2 }), learning.downloading({ course: '101', lesson: 1 }))
    const dir = world.put('101', '数据结构', 2, [['video', 'video.mp4']])
    return { files: [{ kind: 'video', path: path.join(dir, 'video.mp4') }], skipped: [] }
  }
  await learning.download({ course: '101', lesson: 2, kind: 'video' })
  assert.deepEqual(seen, [{ video: { bytes: 0, total: 0 } }, { video: { bytes: 300, total: 1200 } }, {}])
  assert.deepEqual(learning.downloading({ course: '101', lesson: 2 }), {})
  learning.run = async (_args, options) => { options.onProgress({ bytes: 1, total: 2 }); throw new Error('下载 HTTP 500') }
  await assert.rejects(learning.download({ course: '101', lesson: 2, kind: 'ppt' }), /500/)
  assert.deepEqual(learning.downloading({ course: '101', lesson: 2 }), {})
})

test('右栏：总结和讲解混在一起，新的在上；课次来的讲解对得回那次课，别的是自己的资料', async (t) => {
  const world = setup(t), learning = world.create()
  await learning.refresh()
  const dir = world.put('102', '心理学', 1, [['subtitles', 'subtitles.json']], { '总结.md': '# 心理学 第 1 次课\n\n## 整堂课总结' })
  fs.utimesSync(path.join(dir, '总结.md'), new Date('2026-10-08T10:00:00Z'), new Date('2026-10-08T10:00:00Z'))
  const dist = path.join(world.docs, '讲解', 'dist')
  fs.mkdirSync(dist, { recursive: true })
  for (const [name, at] of [['c101-02 伸展树.html', '2026-10-09T01:00:00Z'], ['attention Attention Is All You Need.html', '2026-10-07T01:00:00Z']]) {
    fs.writeFileSync(path.join(dist, name), '<html>')
    fs.utimesSync(path.join(dist, name), new Date(at), new Date(at))
  }
  fs.mkdirSync(path.join(world.docs, '讲解', 'lessons', 'c101-02'), { recursive: true })
  fs.mkdirSync(path.join(world.docs, '讲解', 'lessons', 'c102-01'), { recursive: true })
  const products = (await learning.snapshot()).products
  assert.deepEqual(products.filter(item => item.state === 'done').map(item => [item.kind, item.title, item.course ?? '', item.lesson ?? null]), [
    ['film', '伸展树', '数据结构', 2],
    ['summary', '心理学', '', 1],
    ['film', 'Attention Is All You Need', '', null],
  ])
  // 有工作目录、还没有成品的是正在做；已经有成品的那一个不重复列。
  assert.deepEqual(products.filter(item => item.state === 'making').map(item => [item.title, item.course, item.lesson]), [['c102-01', '心理学', 1]])
  const lesson = await learning.lesson({ course: '102', lesson: 1 })
  assert.match(lesson.summary.text, /整堂课总结/)
  assert.deepEqual(lesson.film, { state: 'making', id: '', title: '' })
  await learning.reveal({ course: '102', lesson: 1, kind: 'summary' })
  assert.deepEqual(world.revealed, [path.join(dir, '总结.md')])
})
