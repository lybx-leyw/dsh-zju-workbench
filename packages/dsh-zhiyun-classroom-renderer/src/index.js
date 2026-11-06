/**
 * 课堂渲染层（宿主半边）。
 *
 * **本包不再 vendor 上游**。原来是 `@openmaic/renderer@0.2.0` 的封装，246 个文件 /
 * 1.5 MB 的编译产物放在 `vendor/renderer/`。2026-10-31 改为自己的实现：
 *
 * - `src/view/slide.jsx` —— 课件页渲染器，支持 4 类元素（text / shape / image / latex）
 * - `src/client.jsx`     —— 浏览器半边，产物 `lib/client.js`
 * - `src/style.css`      —— `.zyc-` 前缀的样式边界
 *
 * # 为什么只做 4 类
 *
 * 生成侧的 prompt（`core-classroom-generate/src/prompts.js` 的 `SCENE_SYSTEM.slide`）
 * 原话是「只用 text / shape / image / latex 四类；没有配图就用 text」。
 * 上游另外 7 类（chart / table / code / audio / video / snapshot / 任意 SVG path）
 * 在整条链路里没有任何生产者 —— 为它们维护 1.5 MB 二进制代码没有回报。
 *
 * # 职责边界
 *
 * **只渲染**。不做数据（slide JSON 由课堂生成链路下发）、不做编辑、不新增页面。
 *
 * 宿主半边不 import 浏览器半边 —— 后者 import React 与 katex，
 * 拖进 Node 进程只为了拿一个常量不值得。
 */

export const name = 'zhiyun-classroom-renderer';
// ↑ 与被别的包 require 时的模块 id（`dsh-zhiyun-classroom-renderer`）不同名，
// 但宿主按 __ModuleLoader__ 注册的 id 建表，不需要它们一致。

/**
 * 历史来源标注。
 *
 * 保留它是因为 `ATTRIBUTION.md` 承诺的那份 MIT 代码的**设计**仍被沿用
 * （画布坐标系、元素字段命名、text/shape/image/latex 的分类），只是不再
 * 逐字节拷它的产物。
 */
export const upstream = Object.freeze({
  package: '@openmaic/renderer',
  version: '0.2.0',
  commit: '0ae3215e965412b8ee536feaa5d98f75b7a70923',
  /** 已删除：本包现在用 `src/view/slide.jsx` 自己的实现。 */
  vendor: null,
});

/**
 * 本包不提供任何运行时服务（只导出组件与常量），保留 `apply` 是为了与其它包的
 * 形状一致：客户端 Loader 会把 profile 里登记的每个条目当插件装配。
 */
export async function apply() {}
