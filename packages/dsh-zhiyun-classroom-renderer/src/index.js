/**
 * 课堂渲染层（宿主半边）。
 *
 * 本包是上游 `@openmaic/renderer@0.2.0` 的 vendor 封装：
 *
 * - `vendor/renderer/` —— 上游 `dist/` 与 `fonts.css` 的**原样**副本，一行未改；
 * - `src/client.jsx`  —— 浏览器半边，把 vendor 导出透出并给出能直接渲染一张 slide
 *   的最小出口（产物 `lib/client.js`，由 `scripts/build.mjs` 构建）；
 * - `src/style.css`   —— `.zyc-` 前缀的样式边界（规范第 5 节）。
 *
 * 职责边界：**只渲染**。不做数据（slide JSON 由 `ctx.zhiyunClassroom.classroom.load`
 * 下发）、不做编辑（编辑在上游 `@openmaic/editor`，属于另一个包）、不新增页面。
 *
 * 宿主半边刻意**不 import `vendor/renderer/index.js`** —— 那份代码在最外层就
 * `import react` 与 `motion/react`，把它拖进 Node 进程只为了拿一个常量不值得。
 * 需要组件的消费方一律走 `dsh-zhiyun-classroom-renderer/client`（浏览器半边）。
 *
 * 来源：https://github.com/THU-MAIC/OpenMAIC
 * commit 0ae3215e965412b8ee536feaa5d98f75b7a70923 · MIT · 见 ATTRIBUTION.md
 */

export const name = 'zhiyun-classroom-renderer';

/** 上游版本与落点，供 parity 工具核对「我们到底在跑哪一版上游」。 */
export const upstream = Object.freeze({
  package: '@openmaic/renderer',
  version: '0.2.0',
  commit: '0ae3215e965412b8ee536feaa5d98f75b7a70923',
  vendor: 'vendor/renderer',
});

/**
 * 本包不提供任何运行时服务（只导出组件与常量），保留 `apply` 是为了与其它包的
 * 形状一致：客户端 Loader 会把 profile 里登记的每个条目当插件装配。
 */
export async function apply() {}
