/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块：
 *
 *   1. `package.json` 里的依赖必须是**精确版本**（`1.0.9`，不是 `^1.0.9`）。
 *      上游是「登录流程封装」—— 它内部贴着各站的 CAS/OAuth 跳转链，
 *      任何一次 `^` 升级都可能换掉表单字段名或回调地址，而**失败方式是静默的**
 *      （登录页面 200、但会话是空的）。锁版的意义就在这里。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以运行时再核对一次（见 `index.js`）。
 *   3. 本包锁的是 **npm 正式发布版**（与 r86 的 zotero 骨架不同：那条上游根本没有
 *      npm 包，只能挂 tarball / git ref）。核验记录（2026-10-28）：
 *        - `dist-tags.latest = 1.0.9`，发布时间 `2026-07-03T15:10:51Z`
 *        - `license = MIT`（`package.json` 与 tarball 内 `LICENSE` 首行一致：
 *          `MIT License / Copyright (c) 2024 5dbwat4`）
 *        - `dependencies` **只有** `nanoid ^5.1.9`；`peerDependencies` / `engines` 均为空
 *          → 零传递污染、无宿主版本门槛
 *        - `"type": "module"`，产物 `dist/login-ZJU.js`（单文件 bundle）
 *
 * ⚠ 一条必须写明的上游事实：README 的「上次成功时间」列里，
 * `ZJUAM`/`CLASSROOM`/`ZDBK`/`COURSES`/`APILIB`/`BOOKINGLIB`/`ALT` 最后成功是
 * **2026/4/14**，到本轮（2026-10-28）已 **6 个月**未在真机复验；
 * `FORM`/`YQFKGL`/`OPEN`/`ETA`/`CC98` 停在 2025-11 至 2025-12。
 * 这不是「不能用」，但它意味着：**接入前必须真机跑一次 `ZJUAM.fetch`**，
 * 不能因为「npm 上装得上、类型对得上」就认为它可用。
 */

export const UPSTREAM_PACKAGE = 'login-zju'
export const UPSTREAM_VERSION = '1.0.9'
export const UPSTREAM_REPOSITORY = 'https://github.com/5dbwat4/login-ZJU'
export const UPSTREAM_LICENSE = 'MIT'

/** 上游导出的服务名（`dist/index.d.ts` 逐字，2026-10-28 核）：12 个。 */
export const UPSTREAM_SERVICES = Object.freeze([
  'ZJUAM',
  'CLASSROOM',
  'ZDBK',
  'COURSES',
  'FORM',
  'YQFKGL',
  'OPEN',
  'CC98',
  'ETA',
  'APILIB',
  'BOOKINGLIB',
  'ALT',
])

/**
 * 本仓**已自有**的会话层 —— 这是判据②（功能正交）的核心证据集合。
 * 逐条对应 `packages/dsh-zhiyun-source-…` 各包的 `src` 目录里的实现；评审时请先核这些文件，
 * 再看本包到底该替换哪一段，**不要**整包换掉。
 */
export const LOCAL_SESSION_OWNERS = Object.freeze([
  { pkg: 'dsh-zhiyun-source-classroom', scope: '智云课堂 / 学在浙大（classroom.zju.edu.cn、courses.zju.edu.cn）' },
  { pkg: 'dsh-zhiyun-source-campus', scope: '综合服务门户（xzzd / pta 并入本包）' },
  { pkg: 'dsh-zhiyun-source-card', scope: '一卡通 + CC98 账号记录（含 CC98 OAuth2）' },
  { pkg: 'dsh-zhiyun-source-netproxy', scope: 'WebVPN 分域中继（**不在上游覆盖范围内**）' },
])
