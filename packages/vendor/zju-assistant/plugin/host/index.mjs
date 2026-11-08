/**
 * 根行，也就是包名本身那一行，插件页上叫「校园账号」。它提供各子行共用的服务 ctx.zjuCampus；页面那一半也挂在这一行上
 * （官方只把浏览器侧代码挂在名字恰好是包名的那一行）。
 *
 * 根服务管这些：哪些子行开着；档案（基础信息、记忆、备忘录）、各系统的账号和校园档案；执行校园命令（zju 工具和页面自己要的数据，core.mjs）；
 * 校园事务、学习、日程表三页的数据和通知汇总；页面上的提醒；给页面的 /api/zju-campus；zju-campus 这一个技能，正文按开着的行拼。
 * 照桌面版的 ui/profile/host.mjs 搬过来，去掉了不带的东西（Plan 第 4 节）：系统提示里一个字都不加，不包住引擎的服务。
 *
 * 各部件照旧自己看哪一行开着（plugins.disabled() 给的是关着的行的 id，rows.mjs）。只在一行开着时才有的东西由那一行自己登记
 * （host/rows/*.mjs）：它的工具、后台检查、监控着的聊天和公众号；根服务经 provide / part 拿到它们。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Service } from '@deepseek-ai/cordis'
import { load, JSON_SCHEMA } from 'js-yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { ROWS, disabledModules } from '../rows.mjs'
import { ProfileStore } from './store.mjs'
import { AccountSettings } from './account.mjs'
import { CORE_ROOT, provideCoreEnv, runCore } from './core.mjs'
import { IdentityFill } from './identity-fill.mjs'
import { collegeOptions } from './colleges.mjs'
import { Documents } from './documents.mjs'
import { Downloads } from './downloads.mjs'
import { Affairs } from './affairs.mjs'
import { Schedule } from './schedule.mjs'
import { Learning } from './learning.mjs'
import { Chaoxing } from './chaoxing.mjs'
import { Xuezai } from './xuezai.mjs'
import { LearnKit } from './learn.mjs'
import { Feed } from './feed.mjs'
import { NoticeFilter } from './notice-filter.mjs'
import { NoticeMemo } from './notice-memo.mjs'
import { NoticeContent } from './notice-content.mjs'
import { Mail } from './mail.mjs'
import { mailVault } from './mail-vault.mjs'
import { MailFeed } from './mail-feed.mjs'
import { Cc98Feed } from './cc98-feed.mjs'
import { CampusContext } from './context.mjs'
import { ContextSources } from './context-sources.mjs'
import { askModel } from './model.mjs'
import { captchaRecognizer, startModelBridge } from './vision.mjs'
import { WereadBridge } from './weread-bridge.mjs'
import { CampusBrowser } from './browser.mjs'
import { Alerts, cc98Alert, mailAlert } from './alerts.mjs'
import { CampusPage } from './campus-page.mjs'
import { zjuTool } from './zju-tool.mjs'
import { installTools } from './tools.mjs'
import { filmResponse } from './film.mjs'

const SKILL_DIR = fileURLToPath(new URL('../skill/', import.meta.url))
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md')
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const PROVIDER = 'zju-campus'
/** 各行在插件页上的中文标题，说「哪一行关着」时用。 */
const TITLES = Object.fromEntries(ROWS.map(row => [row.key, row.title]))

export default class ZjuCampus extends Service {
  static inject = ['connection', 'skills', 'tools']

  constructor(ctx) {
    super(ctx, 'zjuCampus')
    /** 开着的子行（rows.mjs 的 key）。根行自己不记：服务在，根行就在。 */
    this.active = new Set()
    /** 一行开着时它登记的东西（监控着的聊天、公众号）。 */
    this.parts = new Map()
    this.invalidate = () => {}
    this.store = new ProfileStore()
    /** $DSH_HOME/zju-campus：档案在 profile/，ZJU Core 的数据在 zju/，页面的缓存在 cache/。 */
    this.home = path.dirname(this.store.root)
    const cache = name => path.join(this.home, 'cache', name)
    this.account = new AccountSettings(this.store)
    this.plugins = { disabled: () => ROWS.filter(row => row.key && !this.active.has(row.key)).map(row => row.id) }
    this.alerts = new Alerts()
    this.push = (alert) => { if (alert) this.alerts.push(alert) }
    const ask = options => input => askModel(ctx, { ...input, ...options })

    // 校园命令要的环境：档案和数据目录、关着的行管的模块、场馆验证码问模型的管道（vision.mjs，原来由桌面版的壳开）。
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-zju-campus-model-${randomUUID()}` : path.join(tmpdir(), `dsh-zju-model-${randomUUID().slice(0, 8)}.sock`)
    const ptaEndpoint = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-zju-pta-${randomUUID()}` : path.join(tmpdir(), `dsh-zju-pta-${randomUUID().slice(0, 8)}.sock`)
    ctx.effect(() => provideCoreEnv(() => ({
      DSH_HOME: resolveDshHome(), CAMPUS_PROFILE_DIR: this.store.root, ZJU_DATA_DIR: this.dataDir(),
      ZJU_DISABLED_MODULES: [...new Set([...(process.env.ZJU_DISABLED_MODULES ?? '').split(',').filter(Boolean), ...disabledModules(this.active)])].join(','),
      CAMPUS_MODEL_ENDPOINT: endpoint,
      PTA_BROWSER_ENDPOINT: ptaEndpoint, PTA_INTERACTIVE: '0',
    })), 'zju-campus: campus command environment')
    ctx.effect(() => startModelBridge(ctx, { endpoint }), 'zju-campus: model bridge for campus commands')
    // 插件自己的浏览器（browser.mjs，用本机的默认浏览器）：公众号验证问当前模型（vision.mjs），PTA 模式本地匹配滑块。
    this.browser = new CampusBrowser({ dir: path.join(this.home, 'browser') })
    ctx.effect(() => () => { void this.browser.dispose() }, 'zju-campus: own browser')
    this.recognizer = () => captchaRecognizer(ctx)
    const ptaBrowser = new WereadBridge({ dir:path.join(this.home,'pta-verification'), browser:()=>this.browser, recognizer:this.recognizer })
    ctx.effect(() => ptaBrowser.listen(ptaEndpoint, { onlyPta:true, guard:()=>{
      if (!this.active.has('courses') || (process.env.ZJU_DISABLED_MODULES ?? '').split(',').includes('pta')) throw Object.assign(new Error('课程与学习插件已关闭。'), {code:'plugin_disabled'})
    } }), 'zju-campus: PTA verification browser')

    this.fill = new IdentityFill(this.store, this.account)
    this.documents = new Documents()
    this.affairs = new Affairs({ file: cache('affairs.json'), settingsFile: this.store.file('affairs.json'), account: this.account, plugins: this.plugins, downloads: new Downloads() })
    // 日程表：教务网的课表和考试，档案里的校历，再把作业截止和备忘录里写了时间的事排进去。
    this.schedule = new Schedule({
      file: cache('schedule.json'), calendarFile: this.store.file('calendar.json'), account: this.account, plugins: this.plugins,
      tasks: () => this.affairs.tasks(), refreshTasks: options => this.affairs.refreshAll(options), memos: () => this.store.memos.list().notes,
    })
    this.learning = new Learning({ file: cache('learning.json'), account: this.account, plugins: this.plugins, chats: this.documents, downloads: new Downloads() })
    this.chaoxing = new Chaoxing({ file: cache('chaoxing.json'), account: this.account, plugins: this.plugins, chats: this.documents, downloads: new Downloads() })
    this.xuezai = new Xuezai({ file: cache('xuezai.json'), account: this.account, plugins: this.plugins, chats: this.documents, downloads: new Downloads(), course: id => this.learning.known(id) })
    // 「课程讲解」的依赖（排公式的 TeX、检查版面的浏览器、动画用的库），装在插件的数据目录里。装好的 TeX 和库的位置写进 LEARN_TEX_BIN、LEARN_LIBS，命令行工具起的命令会继承。
    this.learnKit = new LearnKit({ dataDir: this.home, plugins: this.plugins })
    ctx.effect(() => () => { delete process.env.LEARN_TEX_BIN; delete process.env.LEARN_LIBS }, 'zju-campus: learn tex and library paths')

    this.mail = new Mail({ file: this.store.file('mail.json'), plugins: this.plugins, vault: mailVault(() => ctx.get('credentials')) })
    ctx.effect(() => () => this.mail.changed(), 'zju-campus: mailbox connection lifecycle')
    this.noticeFilter = new NoticeFilter({ settingsFile: this.store.file('notices.json'), cacheFile: cache('relevance.json'), identity: () => this.store.identity().values, ask: ask({ reasoningEffort: 'low' }) })
    this.mailFeed = new MailFeed({ mail: this.mail, file: cache('mail-feed.json'), onNew: items => this.push(mailAlert(items)) })
    this.cc98Feed = new Cc98Feed({ account: this.account, plugins: this.plugins, file: cache('cc98-feed.json'), onNew: items => this.push(cc98Alert(items)) })
    const article = url => this.part('wechat').article(url)
    this.feed = new Feed({
      file: cache('feed.json'), account: this.account, plugins: this.plugins, chatWatches: () => this.watches(), mail: this.mailFeed, cc98: this.cc98Feed, filter: this.noticeFilter,
      articles: input => this.part('wechat').articles(input), refreshArticles: () => this.part('wechat').refresh(),
    })
    // 不开着页面时也隔一阵看一眼邮箱和 CC98，有新的就提醒页面；各自看自己那一行开没开。
    ctx.effect(() => this.feed.start(), 'zju-campus: personal messages checking lifecycle')
    const downloads = new Downloads()
    this.noticeMemo = new NoticeMemo({ store: this.store, feed: this.feed, mail: this.mail, article, ask: ask({ reasoningEffort: 'low', maxTokens: 4000, timeoutMs: 60_000 }) })
    this.noticeContent = new NoticeContent({ feed: this.feed, mail: this.mail, article, reveal: file => downloads.reveal(file) })
    this.contextSources = new ContextSources({ store: this.store, account: this.account, plugins: this.plugins, chatWatches: () => Object.fromEntries(this.watches().map(watch => [watch.platform, watch])), mail: this.mail, fill: this.fill })
    this.context = new CampusContext({ store: this.store, observe: () => this.contextSources.observe() })
    // 页面上的校内链接在插件的浏览器里打开，带着 Core 的登录（campus-page.mjs）。
    this.page = new CampusPage({ browser: this.browser, account: this.account, dataDir: () => this.dataDir(), coreRoot: CORE_ROOT, run: runCore })

    ctx.connection.fetch.register({
      path: '/api/zju-campus', methods: ['POST'], requestBody: 'buffered',
      fetch: request => this.request(request),
    })
    // 讲解在新标签页里放，文件由这里给；讲解里的脚本是助手写的，见 film.mjs。
    ctx.connection.fetch.register({
      path: '/api/zju-campus/film', methods: ['GET'], requestBody: 'buffered',
      fetch: async request => filmResponse(request, (await this.learning.roots()).films),
    })
    ctx.tools.register(zjuTool(ctx, this))
    installTools(ctx, this)
    // 整个插件只往用户的技能目录里放这一个技能，也不进输入框的 / 菜单（Plan 第 7 节）。
    ctx.skills.registerProvider((control) => {
      this.invalidate = () => { control.invalidate() }
      return {
        name: PROVIDER,
        list: async () => [this.skill()],
        get: async candidate => candidate.locator === SKILL_FILE ? this.skill() : undefined,
      }
    })
  }

  /** ZJU Core 的数据目录（登录会话、缓存、下载的工具）。 */
  dataDir() { return path.join(this.home, 'zju') }

  /** 一个子行开始工作，返回它停下时要调的函数。子行在自己的 ctx.effect 里调它，行关掉时引擎替它调回去。 */
  activate(key) {
    this.active.add(key)
    this.invalidate()
    if (key === 'mail') this.mail.changed()
    return () => {
      this.active.delete(key)
      this.invalidate()
      if (key === 'mail') this.mail.changed()
    }
  }

  /** 一行开着时登记一样东西（name 是 wechat、wechat-chat、dingtalk），返回撤下它的函数。 */
  provide(name, value) {
    this.parts.set(name, value)
    return () => { if (this.parts.get(name) === value) this.parts.delete(name) }
  }

  /** 取一行登记的东西；那一行关着时说清楚。 */
  part(name) {
    const value = this.parts.get(name)
    if (!value) throw new Error(`「${TITLES[name] ?? name}」在插件页「ZJU All-in-One Assistant」里关着。`)
    return value
  }

  /** 现在监控着的聊天（微信、钉钉两行各一个）。 */
  watches() { return ['wechat-chat', 'dingtalk'].flatMap(name => this.parts.get(name) ?? []) }

  /** 现在开着的行，按插件页上的顺序；根行（空串）总在第一个。 */
  rows() {
    return ROWS.filter(row => !row.key || this.active.has(row.key)).map(row => row.key)
  }

  /** ZJU Core 的这个模块归哪一行管、那一行关着时给出它的标题；开着或不归哪一行时给空串。 */
  disabledRow(module) {
    const row = ROWS.find(item => item.key && item.modules.includes(String(module ?? '').toLowerCase()))
    return row && !this.active.has(row.key) ? TITLES[row.key] : ''
  }

  /**
   * zju-campus 技能：SKILL.md 是公共的一段，开着的行在 skill/rows/<key>.md 里有一段就接在后面，关着的行那一段不给模型看。
   * 正文里的 {{core}} 换成 core 代码所在的文件夹（命令说明在 core/zju/references 里，随 core 一起放）。
   */
  skill() {
    const raw = fs.readFileSync(SKILL_FILE, 'utf8')
    const match = raw.match(FRONT)
    const meta = load(match?.[1] ?? '', { schema: JSON_SCHEMA }) ?? {}
    const sections = this.rows().filter(Boolean)
      .map(key => path.join(SKILL_DIR, 'rows', `${key}.md`))
      .filter(file => fs.existsSync(file))
      .map(file => fs.readFileSync(file, 'utf8').trim())
    const core = CORE_ROOT.split(path.sep).join('/')
    const content = `${[raw.slice(match?.[0].length ?? 0).trim(), ...sections].join('\n\n').replaceAll('{{core}}', core)}\n`
    return {
      name: meta.name, description: meta.description, path: SKILL_FILE, source: 'custom', provider: PROVIDER,
      resourceBase: { kind: 'directory', path: SKILL_DIR }, rank: 150, locator: SKILL_FILE,
      invocation: { modelInvocable: true, userInvocable: false }, content,
    }
  }

  saveAccount(input) {
    const saved = this.account.save(input)
    // 学号或密码变了就顺手把基础信息里空着的几项补上；补不上不影响保存账号，设置的个人档案里可以手动再读。
    if (input?.values && ('zju_username' in input.values || 'zju_password' in input.values)) this.fill.refresh().catch(() => {})
    return saved
  }

  /** 页面的一个操作。名字前面是哪一样东西，后面是做什么；没有列出来的交给档案（store.dispatch）。 */
  async dispatch(action, input) {
    const chat = () => {
      const watch = this.part(input?.platform === 'dingtalk' ? 'dingtalk' : 'wechat-chat'), operation = action.slice('chat-watch-'.length)
      if (!['snapshot', 'profiles', 'find', 'members', 'read', 'add', 'set', 'remove', 'refresh', 'location', 'relocate'].includes(operation)) throw new Error('无效的聊天操作')
      return watch[operation](input)
    }
    const wechat = () => {
      const part = this.part('wechat'), operation = action.slice('wechat-'.length)
      if (!['read', 'visit', 'retry', 'find', 'track', 'untrack', 'login', 'logout', 'set'].includes(operation)) throw new Error('无效的公众号操作')
      return operation === 'read' ? part.snapshot() : part[operation](input)
    }
    switch (action) {
      // browser：这台电脑上有没有扫码、过验证码用得上的浏览器。
      case 'status': return { rows: this.rows(), browser: this.browser.available(), platform: process.platform }
      case 'account-read': return this.account.snapshot()
      case 'account-save': return this.saveAccount(input)
      case 'identity-refresh': return this.fill.refresh({ overwrite: true })
      case 'colleges': return collegeOptions()
      case 'alerts-read': return this.alerts.since(input)
      case 'page-open': return this.page.open(input?.url)
      case 'documents-root': return { root: await this.documents.root() }
      case 'affairs-read': return this.affairs.snapshot()
      case 'affairs-refresh': return this.affairs.refresh(input)
      case 'affairs-detail': return this.affairs.detail(input)
      case 'affairs-detail-refresh': return this.affairs.refreshDetail(input)
      case 'affairs-file-download': return this.affairs.download(input)
      case 'affairs-file-reveal': return this.affairs.reveal(input)
      case 'affairs-settings-read': return this.affairs.settings()
      case 'affairs-settings-save': return this.affairs.saveSettings(input)
      case 'schedule-read': return this.schedule.snapshot()
      case 'schedule-refresh': return this.schedule.refresh(input)
      case 'calendar-save': return this.schedule.saveCalendar(input)
      case 'schedule-event-save': return this.schedule.saveEvent(input)
      case 'schedule-event-remove': return this.schedule.removeEvent(input)
      case 'feed-read': return this.feed.snapshot()
      case 'feed-refresh': return this.feed.refresh(input)
      case 'feed-memo': return this.noticeMemo.add(input)
      case 'feed-content': return this.noticeContent.read(input)
      case 'feed-attachment': return this.noticeContent.download(input)
      case 'notice-filter-read': return this.noticeFilter.settings()
      case 'notice-filter-save': return this.noticeFilter.save(input)
      case 'learning-read': return this.learning.snapshot()
      case 'learning-refresh': return this.learning.refresh(input)
      case 'learning-course': return this.learning.course(input)
      case 'learning-course-refresh': return this.learning.refreshCourse(input)
      case 'learning-lesson': return this.learning.lesson(input)
      case 'learning-lesson-refresh': return this.learning.refreshLesson(input)
      case 'learning-download': return this.learning.download(input)
      case 'learning-reveal': return this.learning.reveal(input)
      case 'learning-downloading': return this.learning.downloading(input)
      case 'chaoxing-read': return this.chaoxing.snapshot()
      case 'chaoxing-refresh': return this.chaoxing.refresh(input)
      case 'chaoxing-files': return this.chaoxing.files(input)
      case 'chaoxing-files-refresh': return this.chaoxing.refreshFiles(input)
      case 'chaoxing-download': return this.chaoxing.download(input)
      case 'chaoxing-downloading': return this.chaoxing.downloading(input)
      case 'chaoxing-reveal': return this.chaoxing.reveal(input)
      case 'xuezai-files': return this.xuezai.files(input)
      case 'xuezai-files-refresh': return this.xuezai.refreshFiles(input)
      case 'xuezai-download': return this.xuezai.download(input)
      case 'xuezai-downloading': return this.xuezai.downloading(input)
      case 'xuezai-reveal': return this.xuezai.reveal(input)
      case 'learn-read': return this.learnKit.snapshot()
      case 'learn-install': return this.learnKit.install(input)
      case 'learn-remove': return this.learnKit.remove(input)
      case 'mail-status': return this.mail.snapshot()
      case 'mail-connect': return this.mail.connect(input)
      case 'mail-test': return this.mail.test()
      case 'mail-disconnect': return this.mail.disconnect()
      default:
        if (action?.startsWith('chat-watch-')) return chat()
        if (action?.startsWith('wechat-')) return wechat()
        return this.store.dispatch(action, input)
    }
  }

  async request(request) {
    const headers = { 'cache-control': 'no-store' }
    try {
      const { action, input } = await request.json()
      if (typeof action !== 'string') throw new Error('不认识的操作')
      return Response.json({ value: await this.dispatch(action, input ?? {}) }, { headers })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400, headers })
    }
  }
}
