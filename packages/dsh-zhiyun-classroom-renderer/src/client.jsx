// 「课堂渲染层」的浏览器半边。
//
// 本包是 `@openmaic/renderer` 的 vendor 封装：上游 dist 原样放在 `../vendor/renderer/`，
// 这里只做两件事 ——（1）把 vendor 的公开导出透出去，（2）提供一个**能直接渲染一张
// slide** 的最小导出，供播放页/预览位调用。渲染树一行不改（规范第 2 节通道 4：
// 「只换壳，不重写渲染树」）。
//
// 依赖边界：`motion` / `echarts` / `shiki` / `katex` / `lucide-react` 等由 esbuild
// 打进本包的 lib/client.js（纯库，无宿主共享实例需求）；只有 react 三件套 external，
// 由宿主种子表提供。见 package.json 的 `dsh.client.external` 与
// `scripts/build.mjs` 的 HOST_SEEDS。
import css from './style.css';
import {
  SlideCanvas,
  SlideElement,
  SlideRendererProvider,
  useSlideContext,
} from '../vendor/renderer/index.js';

// 插件面：本包不注册页面/插槽/导航项，但客户端 Loader 会把 profile 里登记的每个
// client 条目当插件装配（Cordis 要求 object 形态的插件带 `apply`）。空插件面，
// 与 `dsh-zhiyun-graph-render/src/client.jsx` 同形状。
export const name = 'zhiyun-classroom-renderer';
export const inject = [];
export function apply() {}

export { css };

/**
 * 一张最小但**完整合法**的 slide（PPTist 风格 Slide JSON）。
 *
 * 字段取自上游 `README.md` 的 Quickstart 示例（`Slide` 的最小可渲染集），
 * 结构由 `dsh-zhiyun-classroom-dsl` 的 `validateSlide` / `validateScene` 约束。
 * 播放页拿到的真实 slide 从 `ctx.zhiyunClassroom.classroom.load(id)` 来，
 * 这个常量只是「渲染通道是否通」的对照物。
 */
export const DEMO_SLIDE = {
  id: 'demo-1',
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    backgroundColor: '#ffffff',
    themeColors: ['#5b8def'],
    fontColor: '#222222',
    fontName: 'sans-serif',
  },
  elements: [
    {
      type: 'text',
      id: 't1',
      left: 100,
      top: 80,
      width: 800,
      height: 60,
      rotate: 0,
      content: '<p>浙大智云 · 课堂渲染层</p>',
      defaultFontName: 'sans-serif',
      defaultColor: '#222',
    },
    {
      type: 'text',
      id: 't2',
      left: 100,
      top: 160,
      width: 800,
      height: 40,
      rotate: 0,
      content: '<p>@openmaic/renderer 0.2.0 · vendored</p>',
      defaultFontName: 'sans-serif',
      defaultColor: '#5b8def',
    },
  ],
  background: { type: 'solid', color: '#ffffff' },
};

/**
 * 渲染一张 slide。父容器必须有确定的 width × height（上游 `SlideCanvas` 靠它自动
 * 适配缩放），所以这里自己给一层定尺容器，调用方只需给宽。
 *
 * @param {object} props
 * @param {object} [props.slide] 幻灯片 JSON，缺省用 {@link DEMO_SLIDE}。
 * @param {number} [props.width] 容器宽（px），高按 slide.viewportRatio 推。
 * @param {number} [props.scale] 固定缩放；省略则按容器自动适配。
 */
export function ClassroomSlide({ slide = DEMO_SLIDE, width = 800, scale }) {
  const ratio = slide?.viewportRatio ?? 0.5625;
  return (
    // `.zyc-root` 是规范第 5 节的样式边界：渲染层的选择器一律挂在这个前缀下，
    // 不与工作台外壳的 `.zy-` 命名空间互相污染。
    <div className="zyc-root zyc-classroom-slide" style={{ width, height: width * ratio }}>
      <SlideCanvas slide={slide} scale={scale} />
    </div>
  );
}

export { SlideCanvas, SlideElement, SlideRendererProvider, useSlideContext };
