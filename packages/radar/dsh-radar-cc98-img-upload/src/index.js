/**
 * dsh-radar-cc98-img-upload —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑，也不 import 上游。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 让「笔记」页里那些 `zy-asset://<id>` 的本地图片，能**一键换成 CC98 上可贴的图**。
 *
 *   现在：笔记里的图只能在本仓里看。要贴到 CC98（答疑、课评、小组招募），
 *        用户得自己找文件 → 手动传图 → 手动抄 UBB 链接。
 *   期望：选中一段笔记 → 「复制为 CC98 版」→ 得到 `[img]https://…[/img]` 拼好的 UBB。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增页面、不加插槽、不动导航。落点是
 *      `dsh-zhiyun-page-notes` 里**既有**的图片/导出操作，与「导出 Markdown」并列。
 *   2. **仍是相似正交的功能** —— 现有：内联图片在**本仓内**渲染；
 *      新增：把**同一张图**换成**远端 URL**。同一个对象，一个本地面、一个外发面。
 *   3. **底层多调了更优质实现** —— 本仓**没有任何上传实现**
 *      （`grep -r upload packages/dsh-zhiyun-source-cc98/src` 零命中）。
 *      现在调的是 CC98 官方上传端点（上游实测可用），而不是自造一套。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **不搬上游源码。** 上游是 Python + `markdown-it-py`，本仓是 JS。
 *     只借**协议事实**（见 `./upstream.js`）。Markdown 图片定位必须复用本仓
 *     `dsh-zhiyun-core-notes/src/note.js` 的 `zy-asset://` 扫描，不要再写一个解析器。
 *   - **不引入账号密码登录。** 上游用 `getpass` 交互换 token；本仓
 *     `dsh-zhiyun-source-cc98/src/token.js` 已有缓存/刷新/落盘的生命周期，
 *     **一律走本仓那一个真源**，否则同一个人会有两条 token 链。
 *   - **不做自动上传。** 只响应**显式点击**。后台静默把笔记里的私图推到公网论坛，
 *     是不可逆的信息泄露。
 *   - **失败不降级为「部分替换」。** 上游口径是「任一图失败则整篇不输出」。
 *     半张贴出去的帖子（有的图在、有的图是死链）比不贴更糟。这条保留。
 *   - **`zy-asset://` 不消失。** 换出来的 UBB 文本是**导出物**，笔记原文不改。
 */

/** 落点（全部是**既有**的面板与既有**一个**源包，本包不注册任何插槽）。 */
export const ADAPT_POINTS = Object.freeze({
  /**
   * ① 图片定位：`dsh-zhiyun-core-notes/src/note.js:281`（`extractAssets` 附近的 `zy-asset://` 扫描）。
   *    输入一篇笔记的 markdown，输出 `[{ assetId, ext, span:{start,end}, isImage }]`。
   *    TODO: 确认 span 是否足够精确到「只换 URL、不动说明/标题/空白/BOM」
   *          —— 上游专门为此保留原行偏移，本仓若靠正则重写会漂。
   */
  locate: 'dsh-zhiyun-core-notes/src/note.js:281',
  /**
   * ② 图片字节：`dsh-zhiyun-core-notes/src/store.js` 的 `note_assets/<id>.<ext>`。
   *    TODO: 需要一个「按 assetId 取 Buffer + mime」的只读口径；不要直接拼文件系统路径
   *          （store 才是路径真源，profile 目录可能被整体搬走）。
   */
  readAsset: 'dsh-zhiyun-core-notes/src/store.js',
  /**
   * ③ 鉴权：`dsh-zhiyun-source-cc98/src/token.js` 的既有 token 生命周期。
   *    TODO: 确认 token 的 audience 是否覆盖 `api.cc98.org/file`
   *          —— 若只签了读接口的 scope，上传会 401，而**不能**为此另开密码登录。
   */
  token: 'dsh-zhiyun-source-cc98/src/token.js',
  /**
   * ④ 出口 UI：`dsh-zhiyun-page-notes` 里既有的「导出 / 复制」动作组。
   *    TODO: 落成「复制为 CC98 版」一个按钮；失败要给**逐图**原因，不能只弹一个「失败」。
   */
  ui: 'dsh-zhiyun-page-notes',
});

/**
 * 上传一张图，返回可直接拼进 `[img]…[/img]` 的 URL。
 *
 * @param {object} _options
 * @param {Buffer|Uint8Array} _options.bytes - 图片字节（来自 `readAsset`）。
 * @param {string} _options.filename - 建议文件名（服务端可能重命名）。
 * @param {string} _options.mime - `image/png` / `image/jpeg` / …
 * @param {string} _options.token - 由 `token.js` 交出，本包**不自己管 token**。
 * @param {(url: string, init?: object) => Promise<Response>} _options.fetch
 *   - 注入的 fetch（便于宿主统一 UA / 代理 / 超时口径）。**不在包内自建全局 fetch**。
 * @returns {Promise<{ url: string, id?: string }>}
 *
 * TODO(评审后): 落实 §协议事实；403 → 等 1s **仅重试当前图一次**；其余 4xx/5xx 直接失败。
 * TODO(评审后): **已上传不可撤回** —— 必须在 UI 上明说「重跑会重传」，不能静默。
 */
export async function uploadImage(_options) {
  throw new Error('dsh-radar-cc98-img-upload: 候选骨架，未实现（uploadImage）');
}

/**
 * 把一篇笔记里所有 `zy-asset://` 图片换掉，产出 UBB 文本。
 *
 * @param {string} _markdown - 笔记原文（**只读，返回值是导出物**）。
 * @param {object} _deps - `{ locate, readAsset, uploadImage }` 注入，便于评审时替换真源。
 * @returns {Promise<{ ubb: string, uploaded: Array<{assetId: string, url: string}>, failed: Array<{assetId: string, reason: string}> }>}
 *
 * TODO(评审后): 任一图失败 ⇒ `ubb` 应为 `null`（整篇不输出），`failed` 逐条带原因。
 * TODO(评审后): 非图片附件（`isImage === false`）原样保留，不上传。
 */
export async function rewriteForCC98(_markdown, _deps) {
  throw new Error('dsh-radar-cc98-img-upload: 候选骨架，未实现（rewriteForCC98）');
}
