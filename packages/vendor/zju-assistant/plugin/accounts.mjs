/**
 * 各系统的账号怎么填、存在 accounts.json 的哪个键。照 ui/profile/catalog.mjs 搬过来的那一部分，键名和 ZJU Core 认的一样
 * （core/zju/lib/profile/profile.ts）。哪一行的配置页填哪几种账号写在 rows.mjs。
 * 页面会把本文件打进包里，这里不能引用 Node 模块。类型写在 accounts.d.mts。
 */

/** user 是账号那一栏（没有就只有密码），secret 是密码那一栏；key 是 accounts.json 里的键。 */
export const ACCOUNTS = {
  zju: { title: '统一身份认证', user: { key: 'zju_username', label: '学号' }, secret: { key: 'zju_password', label: '密码' } },
  webvpn: { title: 'WebVPN', user: { key: 'webvpn_username', label: '校园网账号' }, secret: { key: 'webvpn_password', label: '密码' } },
  pta: { title: 'PTA', user: { key: 'pta_username', label: '邮箱' }, secret: { key: 'pta_password', label: '密码' } },
  // 大物实验课的账号留空时用学号。
  lab: { title: '大物实验课', user: { key: 'lab_username', label: '账号', placeholder: '留空用学号', optional: true }, secret: { key: 'lab_password', label: '密码' } },
  chaoxing: { title: '超星学习通', user: { key: 'chaoxing_username', label: '手机号' }, secret: { key: 'chaoxing_password', label: '密码' } },
  // 可以填好几个：第一个用下面的键，再添加的在键名后加 _2、_3……，ZJU Core 认的就是这种写法。
  cc98: { title: 'CC98', multiple: true, user: { key: 'cc98_username', label: '论坛账号' }, secret: { key: 'cc98_password', label: '密码' } },
  tyys: { title: '体育场馆', secret: { key: 'tyys_card_password', label: '校园卡查询密码' } },
  // 要同伴才能订的场地，用同伴本人授权的统一身份认证账号取同伴码。
  buddy: { title: '场馆同伴', user: { key: 'tyys_buddy_username', label: '同伴学号' }, secret: { key: 'tyys_buddy_password', label: '同伴密码' } },
}

/** 校内网站怎么访问，和 WebVPN 账号排在一起。 */
export const TRANSPORT = {
  key: 'transport',
  label: '校内网站访问方式',
  options: [{ value: 'webvpn', label: 'WebVPN' }, { value: 'direct', label: '校园网直连' }],
}

/** 一种账号最多填几个。 */
export const MAX_ACCOUNTS = 9

/** 每种账号第一份的两个键，加上访问方式。 */
export function accountKeys() {
  return [...Object.values(ACCOUNTS).flatMap(account => [account.user?.key, account.secret.key].filter(Boolean)), TRANSPORT.key]
}

/** 第 index 个账号（1 起）用的两个键。 */
export function numberedKeys(id, index) {
  const { user, secret } = ACCOUNTS[id], suffix = index > 1 ? `_${index}` : ''
  return { user: user ? `${user.key}${suffix}` : undefined, secret: `${secret.key}${suffix}` }
}

/** 键名是不是「能填好几个的账号」后面追加的那几份；是的话给出是哪种账号的第几个。 */
function numbered(key) {
  const match = /^(.+)_([2-9])$/.exec(key)
  if (!match) return undefined
  const id = Object.keys(ACCOUNTS).find(name => ACCOUNTS[name].multiple && (ACCOUNTS[name].user?.key === match[1] || ACCOUNTS[name].secret.key === match[1]))
  return id ? { id, index: Number(match[2]) } : undefined
}

/** 页面能改的键：每个账号第一份的键、访问方式，以及追加的那几份。别的键（第二位场馆同伴）页面不动，原样留着。 */
export function isAccountKey(key) {
  return accountKeys().includes(key) || numbered(key) !== undefined
}

/** 这种账号现在填了第几个、第几个；第一个总在。 */
export function accountIndexes(values, id) {
  const found = new Set([1])
  for (const key of Object.keys(values)) {
    const extra = values[key] ? numbered(key) : undefined
    if (extra?.id === id) found.add(extra.index)
  }
  return [...found].sort((a, b) => a - b)
}

/** 这个账号是否已经填到能用的程度。 */
export function accountReady(values, id) {
  const { user, secret } = ACCOUNTS[id]
  if (id === 'webvpn' && values[TRANSPORT.key] === 'direct') return true
  return (!user || user.optional === true || !!values[user.key]) && !!values[secret.key]
}

/**
 * 设置里「个人档案」最上面的基础信息。core 为真的几项 ZJU Core 会读（学院定通知来源，专业和年级定培养方案）；
 * 称呼和校区只给助手看。
 */
export const IDENTITY_FIELDS = [
  { key: 'display_name', label: '称呼' },
  { key: 'college', label: '学院', core: true },
  { key: 'major_name', label: '专业', core: true },
  { key: 'major_code', label: '专业代码', core: true },
  { key: 'grade', label: '入学年份', core: true },
  { key: 'student_level', label: '培养层次', core: true },
  { key: 'campus', label: '校区', options: ['紫金港校区', '玉泉校区', '西溪校区', '华家池校区', '之江校区', '舟山校区', '海宁校区'] },
]
