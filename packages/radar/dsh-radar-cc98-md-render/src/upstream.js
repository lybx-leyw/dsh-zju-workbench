/**
 * 上游语义记录 —— **本文件不含任何上游代码**，只写「该提取什么、为什么」。
 *
 * 上游：`amiongogo/cc98-vscode`（CC98 低调浏览，作者「季风」，MIT）
 * 形态：**VS Code 扩展**（TypeScript，`src/` 7 个文件约 46 KB）
 *
 * # 为什么不能锁版挂载（与 A 类的关键差别）
 *
 * 上游 `package.json` 的 `devDependencies` 只有 `@types/vscode`，
 * 运行时**完全依赖 `vscode` 虚拟模块**（`window.showTextDocument`、
 * `TextDocumentContentProvider`、`SecretStorage` …）。
 * 这个模块由 VS Code 宿主在运行时注入，**npm 上装不到**，
 * 所以「锁版引入上游」这条路在本包上**不成立** —— 只能是**能力提取**。
 *
 * # 要提取的三个语义（按价值排序）
 *
 * ## ① UBB → 带结构的 Markdown（核心，`src/render/`）
 *
 *   与 `dsh-zhiyun-source-cc98/src/ubb.js` 的 `ubbToText()` 覆盖面**相同**，
 *   但输出不同：那边把 `[img]u[/img]` 压成 `[图片: u]`、`[quote]` 压成 `> [引用]`、
 *   `[url=x]t[/url]` 压成 `t (x)` —— **链接与楼层关系在这一步就丢了**。
 *   上游输出的是 `![](u)`、嵌套 `> `、`[t](x)`，即「原样可渲染的结构」。
 *
 *   要提取的是**标记表**（哪些标记成对、哪些带属性、哪些要保留地址），
 *   不是它的实现代码。本仓应基于 `ubb.js` 已有的标记表扩展，保持单一真源。
 *
 * ## ② 引用楼层的锚点模型（`documents.ts` + `navigation.ts`）
 *
 *   上游把「帖子 → 引用楼层 → 被引用帖」建成带 id 的文档图，
 *   于是「跳到原帖」是一个**链接**而不是一段文字。这是纯文本方案做不到的，
 *   也是判据③「底层更优」最硬的一条证据。
 *
 * ## ③ WebVPN ticket 校验（`webvpn.ts`）
 *
 *   上游单独校验 ticket 与路由 Cookie，并在异常时给可读日志。
 *   本仓 `source-netproxy` / `zju-login` 已有等价能力 →
 *   **这一条不要重复实现**，只借它的「异常分类」措辞。
 *
 * # 明确不提取的部分
 *
 *   - `extension.ts`（21.5 KB）：命令注册与 VS Code UI 编排，与宿主耦合最深，
 *     且本包根本不需要「命令面板」这一层；
 *   - `views/`：VS Code 侧边栏 TreeView —— 本仓是 web 面板，模型不通；
 *   - 登录后的写操作（回复 / 点赞 / 收藏）：本包只做**读**，写方向归 `cc98-ubb-bridge`。
 */

/** 上游标识（评审时必须核对 LICENSE 仍在）。 */
export const UPSTREAM = Object.freeze({
  repo: 'amiongogo/cc98-vscode',
  name: 'CC98 低调浏览',
  author: '季风',
  license: 'MIT',
  licenseProof: 'GitHub license.spdx_id = MIT；根目录 LICENSE 1060 B 实文',
  kind: 'vscode-extension',
  /** 虚拟模块：npm 装不到，锁版挂载不成立。 */
  runtimeDependency: 'vscode (virtual)',
  extractable: ['render/ (UBB→Markdown 标记表)', 'documents.ts + navigation.ts (引用楼层锚点)', 'webvpn.ts (仅异常分类措辞)'],
  notExtractable: ['extension.ts', 'views/', '写操作（回复/点赞/收藏）'],
});

/** 上游不可锁版的原因 —— 评审第一问。 */
export const WHY_NOT_PINNED =
  '上游运行时依赖 `vscode` 虚拟模块（npm 无此包），无法作为依赖引入；只能按语义提取，且不得搬运源码。';

/** 本包与同簇包的关系（防止评审时重复造轮子）。 */
export const SIBLINGS = Object.freeze({
  'dsh-radar-cc98-ubb-bridge': '写方向（Markdown → UBB）。本包是读方向（UBB → Markdown）。**标记表必须同源**。',
  'dsh-zhiyun-source-cc98': '已有 `ubbToText()`（纯文本）与 `Cc98Client`。本包复用其取正文，只换「UBB → 什么」这一步。',
});
