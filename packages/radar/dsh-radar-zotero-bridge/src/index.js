/**
 * dsh-radar-zotero-bridge —— 候选骨架（占位实现）。
 *
 * ⚠ 未评审 · 未接入 profile · 不可直接使用。
 *
 * 目标形态（**强化式集成**，不是新建一个面板）：
 *
 *   上游 `@local/dsh-zotero@1.0.1` 在 `ctx.webServer` 上注册 `/zotero/*`：
 *     /zotero/api/status|items|item/:key|collections   库元数据 JSON
 *     /zotero/file/:attachmentKey                      PDF 字节（支持 Range）
 *     /zotero/viewer.html                             它自己的 PDF.js 阅读页
 *   以及两个 model tool：`zotero_search` / `zotero_paper`。
 *
 *   本包**不用**它的客户端（`lib/client.js` 会抢 `sidebar.panellist` 与
 *   `slots.register`，是第二套布局主张 —— 与 page-paper 的 iframe 外壳冲突），
 *   而是：
 *     1. 挂载上游 host 半边，拿到 `/zotero/*` 路由；
 *     2. 在 `dsh-zhiyun-page-paper` 的**同一个**论文面板里，把「文献库」
 *        多接一个来源：`zotero`。列表项点击 → 复用现有 `ReaderFrame`
 *        （iframe + 主题注入 + 选中即译），只是 iframe 的 src 换成
 *        `/zotero/viewer.html?file=/zotero/file/<key>`；
 *     3. 批注写回走 `/zotero/api/*`，落进 Zotero 自己的库，不自建存储。
 *
 * 三条判据在评审时的落点：
 *   ① 同一个面板 —— 复用 `ReaderFrame`，不新增侧栏入口（**本轮未实现**）
 *   ② 功能正交   —— Zotero 库是本仓完全没有的来源（page-paper 的库是上游自建）
 *   ③ 更优底层   —— 批注落在 Zotero 原生高亮/子笔记上
 */

import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './upstream.js'

export const name = 'radar-zotero-bridge'

/**
 * 上游 host 半边只要 `webServer`。本包若要往页面里塞「文献库来源」，
 * 还需要拿到页面侧的能力 —— 那是**另一个包**（page-paper）的事，
 * 本骨架不声明它，以免评审前就制造跨包耦合。
 */
export const inject = ['webServer']

export function apply(ctx, config) {
  void ctx
  void config

  // TODO(评审 1): 依赖解析。上游未发 npm，`dependencies` 必须指向
  //   GitHub Release 的 tarball 或 `github:nftuoa/dsh-zotero#v1.0.1`。
  //   当前 `package.json` 写的 `@local/dsh-zotero: 1.0.1` **装不上**，
  //   这是骨架的已知缺陷，不要试图 `npm i` 验证。
  ctx.logger?.warn?.(
    `[${name}] 候选骨架未实现：需要先按 ${UPSTREAM_REPOSITORY} 的 release 产物锁版 ${UPSTREAM_VERSION}`,
  )

  // TODO(评审 2): 许可证。上游自带 vendor/pdfjs/standard_fonts/LICENSE_LIBERATION
  //   为 GPL-2.0 + 字体例外（见 upstream.js 的清单）。在决定「剔除 / 接受」之前，
  //   不得把 vendor/ 搬进本仓，也不得摘取其中任何代码。

  // TODO(评审 3): 挂载宿主。上游 host 半边的 `apply` 只做路由注册 + tool 注册：
  //   ctx.webServer.register('/zotero', router)
  //   本包应以「锁版引入」的方式调用它，而不是复制它的 lib/*.mjs。
  //
  //   注意 `insert id`：上游 patch 用的是 `id: zotero`，本包必须用
  //   `id: radar-zotero-bridge`（见 cordis.patch.yml），否则两者会互抢同一个
  //   cordis 槽位 —— 这与 r83 里 `plugin-manager` 抢位是同一类问题。

  // TODO(评审 4): 面板归属。要满足「同一个面板」，需要改的是 page-paper：
  //   - `src/library.js` 增加 `source=zotero` 分支（只调 `/zotero/api/*`）
  //   - `ReaderFrame.jsx` 的 src 由 `readerUrl()` 改为可注入
  //   这两处都是**本仓包**的改动，不属于 radar 包；本骨架只提供 host 半边。

  // TODO(评审 5): 宿主窗口。上游自述在 0.2.1-rc.2 上验证；
  //   若按 ② 走「只借路由」，对客户端导出的依赖消失，
  //   但 `/zotero/viewer.html` 仍是一个同源自渲染页 —— 与现有 iframe 守卫
  //   （tests/build-seeds.test.mjs：产出不得含本包 src/ 之外的文件）**不冲突**，
  //   因为它是运行时请求，不是打包产物。
}

/** 仅供占位：让 `inject` 之外的导出不触发 lint 的 unused 警告。 */
export const meta = { upstream: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION }
