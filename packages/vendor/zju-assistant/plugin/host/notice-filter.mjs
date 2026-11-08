/**
 * 「校园事务」的通知太多时，把和这位学生关系不大的收起来（用户 2026-10-12 要的：一周五十多条里，大半是劳务派遣招聘、经费认领、
 * 科研项目申报这些给教职工看的，加上公众号的文章以后更多）。
 * 两道：标题里有屏蔽词的直接收起；剩下的交给模型，照个人档案的基础信息（培养层次、学院、专业、年级、校区）一条条判断。
 * 收起不是删掉：页面上「另有 N 条」点开还在，判断错了找得回来。模型问不了的时候就不筛，照原样全给。
 *
 * 存两处：
 *   档案目录的 notices.json     屏蔽词，和要不要按个人档案筛。没有这个文件时用下面的默认值。
 *   缓存目录的 relevance.json   模型对每一条的判断。一条只问一次；基础信息变了就全部重问。上一次没问成的时间和原因也记在里面，查问题时看。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 一开始就带着的屏蔽词：这几样基本和学生没关系。只放不会误伤的（「招聘」就不行，校园招聘会也带这个词）。 */
export const DEFAULT_BLOCKED = ['劳务派遣', '经费认领', '汇款认领']
/** 屏蔽词最多几个、一个最多几个字。 */
const MAX_WORDS = 50, MAX_LENGTH = 20
/** 一次问模型多少条；一轮最多问几次（没问完的下一轮接着问，新的先问）。 */
const BATCH = 40, ROUNDS = 3
/** 问模型没问成以后，隔多久再问。 */
const RETRY_MS = 10 * 60_000
/** 给模型看的基础信息：档案里的键，和对它怎么叫。 */
const FIELDS = [['student_level', '培养层次'], ['college', '学院'], ['major_name', '专业'], ['grade', '入学年份'], ['campus', '校区']]

const SYSTEM = `你在替一位浙江大学的学生筛选通知。下面给你他的基础信息和一批通知（编号、来源、标题），请判断每一条和他有没有关系。

和他无关的：
- 面向教职工或科研人员的：招聘、人事、经费、科研项目申报、职称、工会、离退休、干部培训。
- 只面向别的培养层次的：他是本科生时的研究生、博士生事务，反过来也一样。
- 明确只针对别的学院、别的校区的。
- 只和别的年级有关的，比如他离毕业还远时的毕业手续。

和他有关的：面向全体学生或者他这一类学生的事务、活动、讲座、比赛、奖助学金、选课和考试安排，他所在校区的生活服务。拿不准的算有关。

来源以「公众号」开头的是他自己订阅的公众号发的文章，只有明显和学生无关时才算无关。
来源以「二课」开头的是素质拓展平台上可以报名的学生活动，后面是举办单位；只有明确只面向别的学院、别的校区或别的年级时才算无关。
基础信息里没有的项当作不知道。

只输出一个 JSON 对象，形如 {"无关": [2, 5]}，里面是无关的那几条的编号；都有关就输出 {"无关": []}。不要输出别的文字。`

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}

/** 整理屏蔽词：去掉空的、重复的和太长的。 */
function words(list) {
  if (!Array.isArray(list)) return undefined
  return [...new Set(list.filter(word => typeof word === 'string').map(word => word.trim()).filter(word => word && word.length <= MAX_LENGTH))].slice(0, MAX_WORDS)
}

/** 从模型的回答里取出无关的那几条的编号；看不懂就抛错。 */
export function parseVerdict(answer, count) {
  const start = answer.indexOf('{'), end = answer.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('模型的回答不是要的格式。')
  const list = Object.values(JSON.parse(answer.slice(start, end + 1)))[0]
  if (!Array.isArray(list)) throw new Error('模型的回答不是要的格式。')
  return new Set(list.map(Number).filter(index => Number.isInteger(index) && index >= 1 && index <= count))
}

export class NoticeFilter {
  /**
   * settingsFile、cacheFile 是上面说的两个文件；identity 给出个人档案基础信息的各项；
   * ask 问模型一次（{ system, text } → 回答的文字），问不了就抛错。
   */
  constructor({ settingsFile, cacheFile, identity, ask, now = () => Date.now() }) {
    Object.assign(this, { settingsFile, cacheFile, identity, ask, now })
    this.running = undefined
  }

  /** 屏蔽词，和要不要按个人档案筛。 */
  settings() {
    const saved = readJson(this.settingsFile) ?? {}
    return { blocked: words(saved.blocked) ?? DEFAULT_BLOCKED, byProfile: saved.byProfile !== false }
  }

  save(input) {
    const next = this.settings()
    if (input?.blocked !== undefined) {
      const blocked = words(input.blocked)
      if (!blocked) throw new Error('屏蔽词的格式不对')
      next.blocked = blocked
    }
    if (typeof input?.byProfile === 'boolean') next.byProfile = input.byProfile
    writeJson(this.settingsFile, next)
    return next
  }

  /** 基础信息里填了的几项，照给模型看的叫法；也用它认基础信息变没变。 */
  profile() {
    const values = this.identity() ?? {}
    return Object.fromEntries(FIELDS.flatMap(([key, label]) => typeof values[key] === 'string' && values[key].trim() ? [[label, values[key].trim()]] : []))
  }

  cache() {
    const saved = readJson(this.cacheFile) ?? {}
    // 基础信息和存下判断时的不一样了：以前的判断都不算数。
    const profile = JSON.stringify(this.profile())
    return saved.profile === profile && saved.verdicts && typeof saved.verdicts === 'object'
      ? { profile, verdicts: saved.verdicts, failedAt: saved.failedAt ?? null }
      : { profile, verdicts: {}, failedAt: null }
  }

  /**
   * 一批通知各自该不该收起：'blocked' 是标题里有屏蔽词，'irrelevant' 是模型判断关系不大，别的不收起（没在返回的表里）。
   * 还没问过模型的不收起。
   */
  hidden(items) {
    const { blocked, byProfile } = this.settings(), verdicts = byProfile ? this.cache().verdicts : {}, result = new Map()
    for (const item of items) {
      if (blocked.some(word => item.title.includes(word))) result.set(item.id, 'blocked')
      else if (verdicts[item.id] === false) result.set(item.id, 'irrelevant')
    }
    return result
  }

  /** 把还没问过的交给模型，问完才返回；同一时间只问一轮。问不成不抛错，过一阵再问。 */
  judge(items) {
    this.running ??= this.askAll(items).catch(() => {}).finally(() => { this.running = undefined })
    return this.running
  }

  async askAll(items) {
    const { blocked, byProfile } = this.settings()
    if (!byProfile) return
    let cache = this.cache()
    if (cache.failedAt && this.now() - Date.parse(cache.failedAt) < RETRY_MS) return
    const known = new Set(items.map(item => item.id))
    // 已经不在列表里的通知，判断不用再留。
    const verdicts = Object.fromEntries(Object.entries(cache.verdicts).filter(([id]) => known.has(id)))
    const waiting = items.filter(item => !(item.id in verdicts) && !blocked.some(word => item.title.includes(word)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    const profile = this.profile(), today = new Date(this.now() + 8 * 3_600_000).toISOString().slice(0, 10)
    try {
      for (let round = 0; round < ROUNDS && round * BATCH < waiting.length; round++) {
        const batch = waiting.slice(round * BATCH, (round + 1) * BATCH)
        const lines = batch.map((item, index) => `${index + 1}. [${item.kind === 'wechat' ? `公众号·${item.from}` : item.kind === 'sztz' ? `二课·${item.from}` : item.from}] ${item.title}`)
        const answer = await this.ask({ system: SYSTEM, text: `基础信息：${JSON.stringify(profile)}\n今天：${today}\n通知：\n${lines.join('\n')}` })
        const irrelevant = parseVerdict(answer, batch.length)
        batch.forEach((item, index) => { verdicts[item.id] = !irrelevant.has(index + 1) })
        // 问完一批存一批：后面的没问成，前面的也不白问。
        cache = { profile: cache.profile, verdicts: { ...verdicts }, failedAt: null }
        writeJson(this.cacheFile, cache)
      }
    } catch (error) {
      writeJson(this.cacheFile, { profile: cache.profile, verdicts, failedAt: new Date(this.now()).toISOString(), error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    if (Object.keys(verdicts).length !== Object.keys(cache.verdicts).length) writeJson(this.cacheFile, { profile: cache.profile, verdicts, failedAt: null })
  }
}
