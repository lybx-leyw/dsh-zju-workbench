/**
 * 组合包的 10 行，顺序就是官方插件页上的顺序：同一类的挨在一起，组和组之间、组内都按重要性从上往下排。
 * 官方插件页不能分组，只照 bundle/cordis.patch.yml 里声明的先后列成一列。
 * bundle/cordis.patch.yml、package.json 的 exports 和各行的 locale 都照这里写，rows.test.mjs 核对它们对得上。
 *
 * 分两个包：BUNDLE（bundle/）是插件页上那张「ZJU All-in-One Assistant」卡片，只带 patch，自己不占一行；PACKAGE（本目录）是十行的实现。
 * 官方把一个包的页面代码挂在名字恰好是包名的那一行，那一行又和包读同一份标题，所以本包的包根就是「校园账号」这一行，
 * 卡片的名字放在 BUNDLE 上。引擎认组合包依赖的包，聚合型的第三方插件也是这样挂别的包。
 *
 * key 是子路径（根行是空串），title 是插件页上的中文标题（和 locale/zh.json 一样，页面上说「哪一行关着」时用），
 * id 是代码里认这一行用的名字（plugins.disabled() 给的就是它），on 是装上以后默认开不开。patch 里那一行的 id 另见 entryId。
 * modules 是这一行管的 ZJU Core 模块：行关着时，这些模块的命令不执行。没列在任何一行里的（读文档的 doc）始终可用。
 * settings 是这一行「配置」页里放什么；没有的不登记配置页。accounts 是这一行配置页里要填的账号（accounts.mjs 的 ACCOUNTS）。
 */
export const PACKAGE = 'dsh-zju-campus'
export const BUNDLE = 'dsh-zju-assistant'

export const ROWS = [
  { key: '', title: '校园账号', id: 'zju-account', on: true, modules: ['profile', 'zjuam', 'webvpn'], accounts: ['zju', 'webvpn'], settings: '统一身份认证、WebVPN 和校内网站的访问方式' },
  { key: 'courses', title: '课程与学习', id: 'zju-courses', on: true, modules: ['zdbk', 'yjsy', 'xuezai', 'pta', 'lab', 'zhiyun', 'chaoxing', 'ebook', 'cnki'], accounts: ['pta', 'lab', 'chaoxing'], settings: 'PTA、大物实验课、超星学习通的账号，学习通作业接不接校园事务' },
  { key: 'learn', title: '课程讲解', id: 'zju-learn', on: false, modules: [], settings: '排公式的 TeX、检查版面用的浏览器、动画库' },
  { key: 'activities', title: '活动与场馆', id: 'zju-activities', on: true, modules: ['sztz', 'tyys'], accounts: ['tyys', 'buddy'], settings: '校园卡查询密码、场馆同伴的账号' },
  { key: 'community', title: '校园社区', id: 'zju-community', on: true, modules: ['cc98', 'chalaoshi'], accounts: ['cc98'], settings: 'CC98 账号' },
  { key: 'notices', title: '校园通知', id: 'zju-notices', on: true, modules: ['notice'], settings: '屏蔽词、按个人档案判断相关度' },
  { key: 'mail', title: '浙大邮箱', id: 'zju-mail', on: true, modules: [], settings: '浙大邮箱的连接' },
  { key: 'wechat-chat', title: '微信聊天', id: 'zju-wechat-chat', on: false, modules: [], platforms: ['win32', 'darwin'], settings: '监控哪些群和私聊、收谁的消息' },
  { key: 'dingtalk', title: '钉钉聊天', id: 'zju-dingtalk', on: false, modules: [], platforms: ['win32', 'darwin'], settings: '监控哪些群和私聊、收谁的消息' },
  { key: 'wechat', title: '微信公众号', id: 'zju-wechat', on: false, modules: [], settings: '微信读书登录、跟踪的公众号' },
]

/** patch 里这一行的 name：根行是包名，子行是包的子路径。 */
export const moduleName = row => row.key ? `${PACKAGE}/${row.key}` : PACKAGE

/**
 * patch 里这一行的 id，就用中文标题。官方插件页每行在标题、说明下面还会列出 id 和模块名，只有和标题一样时才不列；
 * 写成标题，插件页上就少一行 zju-courses 这样的字（模块名那一行去不掉）。
 */
export const entryId = row => row.title

/** 官方插件页 plugins.row.config 插槽的键：组合包的包名加 patch 里那一行的 id。 */
export const rowConfigKey = row => `${BUNDLE}#${entryId(row)}`

/** 这种账号在哪一行的配置页里填（rows.mjs 的 id）；页面上「去填账号」照它打开那一行。 */
export const accountRow = account => ROWS.find(row => row.accounts?.includes(account))?.id ?? ''

/** 这些行关着时，ZJU Core 不执行它们管的模块（ZJU_DISABLED_MODULES）。active 是开着的行的 key。 */
export const disabledModules = active => ROWS.filter(row => row.key && !active.has(row.key)).flatMap(row => row.modules)
