/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块：
 *
 *   1. `package.json` 里的依赖必须是**精确版本**（`1.0.1`，不是 `^1.0.1`）。
 *      上游 README 的 Compatibility 一节明写「浏览器半边用的是 `/client` 公共导出
 *      （`uiConversation.binding(...).target('chat')`、ChatSnapshot）」，并直言
 *      「若未来 DSH 改了这些内部结构，聊天面板会退回可重试错误」。也就是说
 *      **它的可用性绑定在宿主快照上**，`^` 会让一次无关的升级把契约换掉。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以运行时再核对一次（见 `index.js`）。
 *   3. `1.0.1` 对应的产物是 GitHub Release 附件
 *      `dsh-zotero-1.0.1.tgz`（2026-10-23T12:52Z）。上游**未发布到 npm**
 *      （它的包名故意叫 `@local/dsh-zotero`，README 的「Publish to npm」一节
 *      明确说自己改 scope 才能发），因此安装来源只能是该 tarball 或
 *      `github:nftuoa/dsh-zotero`，**不能**写 `@local/dsh-zotero@1.0.1` 交给 npm 解析。
 *
 * TODO(评审): 把 `dependencies` 的 `@local/dsh-zotero` 换成 tarball URL 或
 * `github:nftuoa/dsh-zotero#v1.0.1`，并在此处同步记录解析方式。
 */

export const UPSTREAM_PACKAGE = '@local/dsh-zotero';

/** 我们审查过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.0.1';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/nftuoa/dsh-zotero';

/** 上游发布产物（唯一可复现的安装来源）。 */
export const UPSTREAM_TARBALL =
  'https://github.com/nftuoa/dsh-zotero/releases/download/v1.0.1/dsh-zotero-1.0.1.tgz';

/**
 * 上游**没有**任何 `dependencies` / `peerDependencies`，也不 import 任何
 * `@deepseek-ai/*`（实测 `grep` lib/ 零命中）。它靠的是运行期 ctx 契约：
 * `inject: ['webServer']` + `/zotero/*` 同源路由 + 客户端 `slots`。
 *
 * 这带来一个反直觉的结论：**它不能被「锁版引入上游 DSH 包」的方式挂载**，
 * 因为根本没有可锁的 DSH 包。能锁的只有它自己。
 */
export const UPSTREAM_DECLARES_DSH_DEPS = false;

/**
 * 上游自带 `vendor/`：pdf.js + KaTeX + 字体。逐项核实过的许可证：
 *
 *   vendor/pdfjs/LICENSE                     Apache-2.0            ✅
 *   vendor/katex/LICENSE                     MIT                   ✅
 *   vendor/pdfjs/cmaps/LICENSE               BSD-3-Clause（Adobe） ✅
 *   vendor/pdfjs/iccs/LICENSE                BSD-3-Clause（ICC）    ✅
 *   vendor/pdfjs/wasm/LICENSE_OPENJPEG       BSD-2-Clause          ✅
 *   vendor/pdfjs/wasm/LICENSE_QCMS           MIT（Mozilla）         ✅
 *   vendor/pdfjs/standard_fonts/LICENSE_FOXIT       BSD-3-Clause    ✅
 *   vendor/pdfjs/standard_fonts/LICENSE_LIBERATION  GPL-2.0 + 字体例外条款 ⛔
 *
 * 最后一项是 pdf.js 的标配字体（Liberation Sans）。它是**渲染资源**、
 * 不是被改编的代码，但本仓对「嵌套许可证」一贯按一票否决处理（r55/r85 先例）。
 * 评审时必须先决定这一项：去掉字体子集 / 不打包 standard_fonts / 接受例外条款。
 * 在决定之前，**不得**把 vendor/ 整包搬进本仓。
 */
export const UPSTREAM_VENDOR_LICENSE_BLOCKERS = [
  'vendor/pdfjs/standard_fonts/LICENSE_LIBERATION: GPL-2.0 with font exception',
];

/**
 * 与本仓既有能力的关系（强化式集成的三条判据）：
 *
 *   ① 仍是同一个面板  —— 上游是**侧栏新入口**（`sidebar.panellist` + `slots.register`），
 *                        不是论文页。要做成「同一个面板」必须放弃它的客户端，
 *                        只借它的 `/zotero/*` 路由，由本仓 page-paper 渲染。
 *   ② 功能仍相似正交  —— ✅ Zotero 本地库 + 原生高亮/子笔记回写，本仓 page-paper
 *                        的文献库是上游 paper-reader 自建的，**零 Zotero 来源**（实测 grep）。
 *   ③ 底层更优        —— ✅ 走 Zotero 本地 API 写回，而不是自建一份批注库。
 *
 * ②③ 成立，① 需要改造 —— 这就是本骨架存在的理由，也是它「未评审」的核心待决项。
 */
export const INTEGRATION_SHAPE = 'bridge-same-panel';

/**
 * 宿主窗口：上游 README 自述在 **dsh 0.2.1-rc.2** 上测试通过，并依赖
 * `uiConversation` / ChatSnapshot 这两个客户端导出。本仓 page-paper 走的是
 * iframe 承载路线，**不用**这两个导出 —— 所以如果按 ② 的形态只借路由，
 * 宿主窗口的约束会显著放宽（退化成「`webServer.register` 还在不在」）。
 *
 * TODO(评审): 用 `scripts/radar-host-window.mjs` 对 0.2.1-rc.2 跑一次，
 * 把结果回填进 README 的「宿主窗口」一节。
 */
export const UPSTREAM_TESTED_HOST = '0.2.1-rc.2';
