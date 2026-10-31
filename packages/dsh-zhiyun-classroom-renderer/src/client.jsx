/**
 * 「课件渲染层」的浏览器半边。
 *
 * # 不再 vendor 上游
 *
 * 这里原来是 `@openmaic/renderer` 的封装：246 个文件 / 1.5 MB 的编译产物原样
 * 放在 `../vendor/renderer/`。2026-10-31 改成我们自己的实现（`./view/slide.jsx`），
 * 理由：
 *
 *   1. 上游支持 11 类元素，而**产品实际只用 4 类** —— 生成侧的 prompt
 *      （`core-classroom-generate/src/prompts.js` 的 `SCENE_SYSTEM.slide`）
 *      原话就是「只用 text / shape / image / latex 四类」。
 *      另外 7 类（chart / table / code / audio / video / snapshot / 任意 path）
 *      在整条链路里**没有任何生产者**。
 *   2. 编译产物没法改：想调一个行高都要动 1.5 MB 的 bundle。
 *   3. 24 处 `"use client"` 是 Next.js 指令，在 Cordis 插件体系里毫无意义。
 *   4. 1.6 MB 的 `.map` + `.d.ts` 只给编辑器看，运行时不加载。
 *
 * 换来的代价是：**渲染结果不再与上游逐像素相同**。这对我们没有损失 ——
 * `classroom-render-parity` 那条测试需要一个上游 clone（`ref/OpenMAIC`）
 * 才能跑，本机从来没有过；而且真实课堂从未生成成功过（`runs/` 是空的）。
 *
 * # 依赖边界
 *
 * 只有 `react` 三件套由宿主种子表提供（见 package.json 的 `dsh.client.external`
 * 与 `scripts/build.mjs` 的 HOST_SEEDS）。`katex` 被打进本包 bundle —— 它是纯库，
 * 没有跨包共享实例的需求。
 */
import css from './style.css';
import {
  ClassroomSlide as ClassroomSlideImpl,
  VIEWPORT_SIZE as VIEWPORT_SIZEImpl,
  VIEWPORT_RATIO as VIEWPORT_RATIOImpl,
} from './view/slide.jsx';

// 插件面：本包不注册页面/插槽/导航项，但客户端 Loader 会把 profile 里登记的每个
// client 条目当插件装配（Cordis 要求 object 形态的插件带 `apply`）。空插件面，
// 与 `dsh-zhiyun-graph-render/src/client.jsx` 同形状。
export const name = 'zhiyun-classroom-renderer';
// ↑ 与被别的包 require 时的模块 id（`dsh-zhiyun-classroom-renderer`）不同名，
// 但宿主按 __ModuleLoader__ 注册的 id 建表，不需要它们一致。
export const inject = [];
export function apply() {}

export { css };

/** 一张最小但**完整合法**的 slide，用于预览位与静态测试。 */
export const DEMO_SLIDE = {
  id: 'demo-1',
  viewportSize: VIEWPORT_SIZEImpl,
  viewportRatio: VIEWPORT_RATIOImpl,
  theme: {
    backgroundColor: '#ffffff',
    themeColors: ['#5b8def'],
    fontColor: '#222222',
    fontName: 'sans-serif',
  },
  background: { type: 'solid', color: '#ffffff' },
  elements: [
    {
      id: 'demo-title',
      type: 'text',
      left: 80,
      top: 80,
      width: 840,
      height: 100,
      content: '<p>课堂演示</p>',
      fontSize: 40,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    {
      id: 'demo-body',
      type: 'text',
      left: 80,
      top: 220,
      width: 840,
      height: 240,
      content: '<p>这一页由 <code>dsh-zhiyun-classroom-renderer</code> 渲染。</p>',
      fontSize: 22,
      textAlign: 'left',
    },
  ],
};

// 导出方式要注意：`export const X = XImpl;` 会被 esbuild 折叠成
// `var X2 = X; ` 这种**局部变量**，不写进 `module.exports` ——
// 实测产物以 `return module.exports` 结尾，而 exports 是空的，
// 上层 require 拿到空对象，stage 取 ClassroomSlide 直接崩。
//
// 用 `export { ... }` 具名列表可以让 esbuild 生成 `__export` 描述符表，
// 进而写出 `module.exports = __toCommonJS(...)`。
export { ClassroomSlideImpl as ClassroomSlide, VIEWPORT_SIZEImpl as VIEWPORT_SIZE, VIEWPORT_RATIOImpl as VIEWPORT_RATIO };
