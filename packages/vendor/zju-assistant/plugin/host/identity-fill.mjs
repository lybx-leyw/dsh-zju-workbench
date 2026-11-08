/**
 * 基础信息的自动填写。入学年份和培养层次从学号算；本科生的姓名、学院、专业从教务网读（ZJU Core 的 zdbk student）。
 * 保存统一身份认证账号后自动跑一次，只补空着的项；设置里个人档案的「从教务网读取」是手动再跑一次，学校给的几项以学校为准。
 */
import { IDENTITY_FIELDS } from '../accounts.mjs'
import { runCore } from './core.mjs'

const LEVELS = { 3: '本科', 2: '硕士', 1: '博士' }
const LABELS = Object.fromEntries(IDENTITY_FIELDS.map(field => [field.key, field.label]))

/** 学号首位是培养层次（3 本科，2 硕士，1 博士），第 2、3 位是入学年份；认不出来返回空对象。 */
export function fromStudentId(id) {
  const match = /^([123])(\d{2})\d{5,9}$/.exec(String(id ?? '').trim())
  return match ? { grade: `20${match[2]}`, student_level: LEVELS[match[1]] } : {}
}

export class IdentityFill {
  /** fetchStudent 返回教务网上的 { name, college, major }。这是应用自己要的数据，插件页上关掉「课程与学习」也照读。 */
  constructor(store, account, fetchStudent = () => runCore(['zdbk', 'student'], { system: '教务网', ignoreSwitches: true })) {
    this.store = store
    this.account = account
    this.fetchStudent = fetchStudent
    this.queue = Promise.resolve()
  }

  /**
   * 读一次并写进基础信息，返回 { identity, changed, note }，changed 是实际改了的几项的名字。
   * overwrite 为真时学院、专业、入学年份、培养层次以读到的为准；否则只补空着的。称呼只在空着时填。
   * 同一时间只跑一次，后来的排在后面。
   */
  refresh({ overwrite = false } = {}) {
    const run = this.queue.then(() => this.run(overwrite))
    this.queue = run.catch(() => {})
    return run
  }

  async run(overwrite) {
    const { data } = this.account.read()
    const id = typeof data.zju_username === 'string' ? data.zju_username : ''
    if (!id) throw new Error('还没有学号：先在插件页「ZJU All-in-One Assistant → 校园账号」的配置里填统一身份认证的学号和密码。')
    const derived = fromStudentId(id)
    const changed = this.apply(derived, overwrite)
    // 教务网只有本科生的学籍。
    if (derived.student_level && derived.student_level !== '本科') {
      return { identity: this.store.identity(), changed, note: '研究生的学院和专业在教务网查不到，请手动填写。' }
    }
    if (!data.zju_password) throw new Error('还没有统一身份认证的密码：先在插件页「ZJU All-in-One Assistant → 校园账号」的配置里填好。')
    const student = await this.fetchStudent()
    changed.push(...this.apply({ display_name: student?.name, college: student?.college, major_name: student?.major }, overwrite))
    return { identity: this.store.identity(), changed }
  }

  apply(found, overwrite) {
    const before = this.store.identity(), patch = {}
    for (const [key, raw] of Object.entries(found)) {
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value || value === before.values[key]) continue
      if (!before.values[key] || (overwrite && key !== 'display_name')) patch[key] = value
    }
    if (!Object.keys(patch).length) return []
    this.store.saveIdentity({ values: patch, revision: before.revision }, 'human', '教务网和学号')
    return Object.keys(patch).map(key => LABELS[key])
  }
}
