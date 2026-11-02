/**
 * 【候选骨架·未评审、未接入 profile、不可直接使用】
 *
 * dsh-radar-foliate-reader —— 为「笔记」页既有阅读器补齐 Ebook 格式。
 *
 * 现状（本轮实测）：`dsh-zhiyun-page-notes/src/client.jsx` 的 intake 只认 `.md`（文件树）
 * 与 `.pdf`（`accept="application/pdf,.pdf"`），全仓 `packages/dsh-zhiyun-*\/src`
 * 里 grep `epub` 零命中。也就是说 EPUB 目前**根本打不开**，而不是「打得不好」。
 *
 * 落点：复用笔记页已有的**同源 iframe + 主题注入**形态（见 `page-notes/src/pdf-viewer.js`
 * 开头那段注释里的三条硬约束），把 EPUB 渲染交给 iframe 里的 foliate-js，
 * 宿主侧只负责「给一个 URL + 传主题变量」。**不新建页面、不新建导航项。**
 *
 * 本文件目前只有占位与 TODO —— 骨架只证明「这个上游锁得住、这个位置是空的」，
 * 不证明「接进去能跑」。评审通过前不要 import。
 */

export const name = 'radar-foliate-reader';

export const VERSION = '0.0.0';

/**
 * 占位：未来在这里导出宿主侧的 iframe 路由与主题注入。
 *
 * TODO(评审后)：
 *  1. 在笔记页加一条 `.epub` 的 open 分支，复用 `pdf-viewer.js` 的 iframe 路由与
 *     `--zy-*` 变量注入（**不要再写一套**同源 iframe 逻辑）。
 *  2. `upstream.js` 里包一层 `view.js` 的加载，注意 `view.open(path)` 需要可达 URL，
 *     而笔记库文件是宿主文件系统上的路径 → 需要一个 `blob:` 或本地路由把字节递给 iframe。
 *     上游 `reader.html` 的 CSP 是 `default-src 'self' blob:`，`blob:` 必须放行。
 *  3. 中文排版（竖排 / CJK 断行）未验，先别声称支持。
 */
export function apply() {
  return { ok: false, reason: 'skeleton: unreviewed, not wired' };
}
