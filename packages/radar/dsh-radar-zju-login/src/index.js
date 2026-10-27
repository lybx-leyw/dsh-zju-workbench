/**
 * dsh-radar-zju-login —— 候选骨架（占位实现）。
 *
 * ⚠ 未评审 · 未接入 profile · 不可直接使用。
 *
 * # 目标形态
 *
 * **强化式集成**：不改「我的课 / 今天 / 笔记」任何一个面板的外观与交互，
 * 只把它们底下那层「怎么登进智云/学在浙大」换成上游 `login-zju@1.0.9` 的实现。
 *
 *   本仓现状（会话层是**手写、且按站各写一遍**）：
 *     dsh-zhiyun-source-classroom/src/auth.js   手写 CAS，只服务智云一个目标
 *     dsh-zhiyun-source-campus/…                另一套（xzzd）
 *     dsh-zhiyun-source-card/…                  CC98 走自己的 OAuth2
 *   上游现状：`new ZJUAM(user, pass)` + `new <Service>(am)` → `service.fetch(url)`
 *   把 12 个系统的登录/续期/COOKIE 收口成同一个 `fetch` 形状。
 *
 *   所以本包要做的事只有一件：**把 `fetch` 这一层换掉**，
 *   上层的解析、页面、字段全部不动。
 *
 * # 三条判据在评审时的落点
 *
 *   ① **仍是同一个面板**
 *      不新增页面、不新增侧栏入口。改动落在 `source-classroom` / `source-campus`
 *      的内部实现里，对外导出的函数签名不变。
 *      ⚠ **这一条最容易翻车**：上游要求把**明文密码**交给 `new ZJUAM(u, p)`，
 *      而本仓 `source-card` 的账号记录是**加密落盘**的、且明确「不把 Bearer 令牌回给页面」。
 *      若必须把密码解密后传给上游，等于在上游库里多存一份明文会话 →
 *      **需要在评审时明确批准或否决**，不能由本骨架默认。
 *
 *   ② **功能仍相似正交**  —— ⚠ **本轮判为「部分成立」，请评审重点看这条**
 *      正交：上游覆盖 classroom / courses / zdbk / apilib / bookinglib / alt，
 *            本仓恰好在这几处各写了一遍 → 是同一件事的重复实现，不是新功能。
 *      **但**：上游 `README` 的服务清单里**没有 WebVPN**，而本仓
 *            `dsh-zhiyun-source-netproxy` 是「分域中继 + 就近分流」。
 *            浙大校外访问大量依赖 WebVPN → **上游不能替代它**，
 *            只能替代「校内直连」那一段。这条边界必须写进实现，否则会误删中继。
 *
 *   ③ **底层多调了更优质实现** —— **成立但有时效**
 *      上游把 12 个站点的登录链收口，并维护「上次成功时间」；本仓是三套手写实现。
 *      但它的成功时间最新只到 2026/4/14（见 `upstream.js`）→
 *      **不是一个「更稳定」的承诺，只是「更完整」的覆盖**。
 *
 * # 为什么这个骨架暂时只做「探测」，不做「替换」
 *
 * 判据② 的边界（哪些站能替、哪些不能）与「明文密码入内存」的合规问题，
 * 都不是自动扫描能拍板的。骨架先给出**可执行的核对路径**：
 * 拿上游包去探本仓已登录的会话能不能被它接管 —— 探不通就整条撤销。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_SERVICES,
  UPSTREAM_VERSION,
} from './upstream.js'

export const name = 'dsh-radar-zju-login'

/** 本包不注入任何服务：它不是一个面板插件，只是一个候选会话层。 */
export const inject = []

/**
 * 挂载入口（占位）。
 *
 * 刻意**不注册任何路由、不读任何配置**：骨架一旦能跑，就会有人把它接进 profile。
 * 真正实现之前，这里应当保持「装上也不做任何事」。
 */
export function apply(ctx) {
  ctx?.logger?.info?.(
    `[${name}] 候选骨架（未评审）：上游 ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}，`
    + `${UPSTREAM_SERVICES.length} 个服务；本包未做任何挂载动作。`,
  )
  // TODO(评审 1): 真机核对 —— 用 `new ZJUAM(u, p)` 跑一次 `CLASSROOM.fetch('/api/...')`，
  //   与本仓 `source-classroom/src/auth.js` 的现有会话比对同一接口的返回形状。
  // TODO(评审 2): 明确 WebVPN 边界 —— 校外场景仍走 `dsh-zhiyun-source-netproxy`，
  //   上游只接管校内直连；两者的判定条件写在哪个函数里，需要先定。
  // TODO(评审 3): 密码传递方式 —— 上游 API 只接受明文；本仓账号是加密落盘的。
  //   可选：(a) 只在内存中解密并立即丢弃引用；(b) 否决整条（判 ⛔）。
  // TODO(评审 4): 上游 2026-04-14 之后未复验 —— 若真机已失效，本条直接撤销骨架。
}

/**
 * 只读探测接口：**不登录、不联网**，只把「上游声称能接哪些站」与
 * 「本仓自己维护会话的包」并排给出来。供评审时一眼看出重叠面与缺口。
 *
 * @returns {{ overlap: string[], uncovered: string[], upstreamOnly: string[] }}
 */
export function describeCoverage() {
  const upstreamSites = ['classroom', 'courses', 'zdbk', 'apilib', 'bookinglib', 'alt', 'cc98', 'eta', 'form']
  const localSites = ['classroom', 'courses', 'xzzd', 'pta', 'card', 'netproxy']
  const overlap = upstreamSites.filter((s) => localSites.includes(s))
  const uncovered = localSites.filter((s) => !upstreamSites.includes(s))
  return {
    overlap,
    // 上游**完全不覆盖**、必须由本仓继续持有的部分
    uncovered,
    // 上游覆盖、本仓尚无独立来源的站（将来可作「新增来源」的线索，不属于本骨架范围）
    upstreamOnly: upstreamSites.filter((s) => !localSites.includes(s)),
  }
}
