/**
 * 上游协议事实 —— `Cedar17/cc98-img-upload`（**Apache-2.0**，Python）。
 *
 * ⚠ 本文件**不是**上游代码的移植，也不 import 任何东西。
 *   它只把「从上游实核到的协议事实」写成常量，供 `./index.js` 的 TODO 对照。
 *   上游是 Python（依赖 `markdown-it-py`），**不可锁版、不可 import** ⇒ 本包为 **B 类，dependencies 为空**。
 *
 * 出处核对：`cc98_img_upload.py`（10826 B，2026-10-30 push），文件头
 * `SPDX-License-Identifier: Apache-2.0`，仓库根 `LICENSE` 11358 B 同为 Apache-2.0。
 *
 * ── 为什么不锁版本 ────────────────────────────────────────────────
 *
 *   上游没有 `package.json`、没有 npm 包、没有 Release —— 只有一个带 `uv` 内联依赖的
 *   Python 脚本。按本仓纪律（A 类才锁版），它只能是 **B 类：读语义 → 在本仓重写**。
 *   重写时以下四件事必须与上游**逐字对齐**，其余（Markdown 解析、CLI、交互登录）**一律不要**。
 */

/** ① 上传端点与请求形状。 */
export const UPLOAD = Object.freeze({
  url: 'https://api.cc98.org/file',
  method: 'POST',
  /** multipart/form-data；**字段名就是 `files`**（不是 `file`）。 */
  field: 'files',
  /** 上游显式带上的表单字段，服务端据此判断整体类型。 */
  formData: Object.freeze({ contentType: 'multipart/form-data' }),
  /** 文件部分的 (filename, bytes, mime) 三元组形状。 */
  filePart: '[filename, bytes, mime]',
  /**
   * 返回：服务端图片对象，携带可用于 `[img]…[/img]` 的地址/ID。
   * TODO(评审后): 实核返回 JSON 的确切键名（上游是取回后拼 URL，本骨架未固化键名）。
   */
  response: '服务端图片对象（含图片 id / URL）',
});

/** ② token 端点 —— ⚠ **本仓不用**，列出来只是为了让评审看见「我们刻意不走这条路」。 */
export const TOKEN_VIA_PASSWORD = Object.freeze({
  url: 'https://openid.cc98.org/connect/token',
  /** 上游用 public OpenID client 的 id/secret + 用户**账号密码**换 token。 */
  upstreamFlow: '客户端凭据 + 用户账号密码（getpass 交互）',
  /**
   * 为什么本仓不采用：
   *   ① 账号密码不该经过 workbench；
   *   ② 本仓 `dsh-zhiyun-source-cc98/src/token.js` 已有缓存 / 刷新 / 落盘的生命周期，
   *      再开一条就是**同一个人的两条 token 链**，过期时序会互相踩。
   */
  verdict: 'reject',
});

/** ③ 重试与失败语义 —— 这三条是上游最值钱的部分，必须保留。 */
export const FAILURE_POLICY = Object.freeze({
  /** HTTP 403 → 等 1s，**仅重试当前图一次**；再失败即整篇失败。 */
  on403: Object.freeze({ delayMs: 1000, retries: 1, scope: 'current-image' }),
  /** 任一图失败 ⇒ **不输出正文**（防「半张贴」）。 */
  onAnyFailure: '整篇不输出',
  /** 已上传的远端文件**无法撤回** ⇒ 重跑会重传。必须在 UI 上说清楚。 */
  irreversible: true,
  /** 传输超时（上游口径，连接/读取分开）。 */
  timeout: Object.freeze({ connectMs: 10000, readMs: 30000 }),
});

/**
 * ④ 上游**做了但本仓不要**的（都属 Markdown 解析/CLI 层，本仓有更权威的真源）。
 */
export const NOT_PORTED = Object.freeze([
  'Markdown 图片定位（用 `markdown-it-py` + 逐块 inline 偏移）→ 本仓用 core-notes 的 `zy-asset://` 扫描',
  '只换 URL、保留说明/标题/空白/换行/BOM 的字节级重写 → 本仓笔记是结构化文档，不需要字节保真',
  '支持 `![说明](路径 "标题")`、括号转义、百分号编码、`<带空格的路径>` → 本仓没有「相对路径图片」这种形态',
  '引用式图片 / Obsidian 嵌入 / HTML `<img>` 的排除规则 → 同上',
  'CLI、`uv` 依赖、stdout/stderr 分工、退出码 0/1/2/130 → 本仓是面板按钮，不是命令行',
  '账号密码交互登录（见 TOKEN_VIA_PASSWORD.verdict）',
]);

/** 本包**绝不**做的事（评审时按这张表驳）。 */
export const HARD_BOUNDARIES = Object.freeze([
  '不搬上游源码（Python → JS 不是翻译，是重写；只借协议事实）',
  '不引入账号密码 / 不新开 token 链（走 dsh-zhiyun-source-cc98/src/token.js）',
  '不做后台自动上传（只响应显式点击；静默外发 = 不可逆的隐私泄露）',
  '不改笔记原文（换出来的 UBB 只是导出物）',
  '不注册新页面 / 新插槽 / 导航项（落点仅在 dsh-zhiyun-page-notes 既有动作组）',
]);

/** 骨架占位：评审前任何调用都抛错。 */
export function upstreamFacts() {
  throw new Error('dsh-radar-cc98-img-upload: 候选骨架，未实现（upstreamFacts）');
}
