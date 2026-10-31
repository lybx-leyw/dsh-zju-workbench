/**
 * 课件页渲染器 —— 我们自己的实现。
 *
 * # 为什么重写而不是继续 vendor
 *
 * 上游 `@openmaic/renderer` 是 246 个文件 / 1.5 MB 的构建产物，支持 11 类元素
 * （chart / table / code / audio / video / snapshot…）。但**产品实际只用到 4 类**：
 * 它自己的 prompt 就写着「只用 text / shape / image / latex 四类；没有配图就用 text」
 * （见 `core-classroom-generate/src/prompts.js` 的 `SCENE_SYSTEM.slide`）。
 *
 * 为一个用不到 1/3 能力的场景维护 1.5 MB 二进制代码，代价是：
 *   - 上游一升级就要重新 vendor 一次
 *   - 24 处 `"use client"`（Next.js 指令，在我们这里毫无意义）
 *   - 1.6 MB 的 .map / .d.ts 只给编辑器看
 *   - 想改任何一处渲染都要改编译产物
 *
 * 所以按「产品真的需要的 4 类」重写。这不是缩水：多出来的 7 类从来没有生产者。
 *
 * # 画布约定（与生成侧一致）
 *
 *   viewportSize  = 1000  ← 逻辑宽度
 *   viewportRatio = 0.5625（16:9）
 *   元素坐标是逻辑像素，左上原点，单位 px
 *
 * 渲染时按容器宽度等比缩放，所以同一份 slide 在 800px 和 1600px 下版式一致。
 */
import React from 'react';
import katex from 'katex';

/** 默认画布尺寸，与 `core-classroom-generate/src/prompts.js` 的常量保持一致。 */
export const VIEWPORT_SIZE = 1000;
export const VIEWPORT_RATIO = 0.5625;

/** 只有这四类会被渲染。其它类型原样跳过 —— 静默忽略比画错好。 */
const SUPPORTED = new Set(['text', 'shape', 'image', 'latex']);

/**
 * 渲染一页课件。
 *
 * @param {object}   props.slide    canvas 对象（含 elements / theme / viewportSize）
 * @param {number}   props.width    容器宽（px），高度按 viewportRatio 推算
 */
export function ClassroomSlide({ slide, width = 800 }) {
  const logical = Number(slide?.viewportSize) > 0 ? Number(slide.viewportSize) : VIEWPORT_SIZE;
  const ratio = Number(slide?.viewportRatio) > 0 ? Number(slide.viewportRatio) : VIEWPORT_RATIO;
  // 逻辑坐标 → CSS 像素的唯一换算点。所有元素都用它，不各自算。
  const scale = width / logical;
  const height = logical * ratio * scale;
  const theme = slide?.theme ?? {};
  const background = backgroundOf(slide?.background, theme);

  const elements = Array.isArray(slide?.elements) ? slide.elements : [];

  return (
    <div
      className="zyc-slide"
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background,
        color: theme.fontColor ?? '#222222',
        fontFamily: theme.fontName ?? 'sans-serif',
      }}
    >
      {elements.map((element) => {
        if (!element || !SUPPORTED.has(element.type)) return null;
        return (
          <div
            key={element.id}
            style={{
              position: 'absolute',
              left: num(element.left) * scale,
              top: num(element.top) * scale,
              width: Math.max(1, num(element.width) * scale),
              height: Math.max(1, num(element.height) * scale),
              // 元素自己按缩放后的尺寸排版，所以字号也要跟着缩放
              fontSize: num(element.fontSize, 18) * scale,
            }}
          >
            {renderElement(element)}
          </div>
        );
      })}
    </div>
  );
}

/** 背景：支持纯色与图片，其它一律退回白底。 */
function backgroundOf(background, theme) {
  if (typeof background === 'string' && background) return background;
  if (background?.type === 'image' && typeof background.src === 'string') {
    return `#ffffff url("${background.src}") center / cover no-repeat`;
  }
  if (background?.type === 'solid' && typeof background.color === 'string') return background.color;
  return theme.backgroundColor ?? '#ffffff';
}

/** 按类型分派。每类都只做产品需要的部分，不追求上游的完整能力。 */
function renderElement(element) {
  switch (element.type) {
    case 'text': return renderText(element);
    case 'shape': return renderShape(element);
    case 'image': return renderImage(element);
    case 'latex': return renderLatex(element);
    default: return null;
  }
}

/**
 * 文本。
 *
 * `content` 是 HTML 片段（生成侧就是这么给的，含 `<p>`）。
 * 用 `dangerouslySetInnerHTML` 是必要的：内容来自我们的模型 + 我们自己的 prompt 约束，
 * 不来自任意用户输入；而把它解析成 React 节点需要额外一个 HTML 解析器，不值得。
 */
function renderText(element) {
  const style = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    lineHeight: element.lineHeight ?? 1.5,
    fontWeight: element.fontWeight ?? 'normal',
    textAlign: element.textAlign ?? 'left',
    color: element.color ?? 'inherit',
  };
  const html = typeof element.content === 'string' ? element.content : '';
  return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 形状：矩形 / 圆 / 线。
 *
 * 用 CSS 画而不是 SVG —— 这三类都不需要路径，CSS 更轻、也不引入新依赖。
 * 上游支持任意 SVG path，但我们没有生产者会产出它。
 */
function renderShape(element) {
  const shape = element.shape ?? element.form ?? 'rect';
  const fill = element.fill ?? element.backgroundColor ?? 'transparent';
  const stroke = element.stroke ?? element.borderColor ?? 'transparent';
  const strokeWidth = num(element.strokeWidth ?? element.borderWidth, 0);

  if (shape === 'line' || shape === 'hline' || shape === 'vline') {
    const vertical = shape === 'vline';
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: stroke === 'transparent' ? fill : stroke,
          // 横线取容器的中间一条，竖线同理
          ...(vertical ? { width: Math.max(1, strokeWidth || 2), margin: '0 auto' } : { height: Math.max(1, strokeWidth || 2), margin: 'auto 0' }),
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: fill,
        border: strokeWidth > 0 ? `${strokeWidth}px solid ${stroke}` : undefined,
        // 圆 / 椭圆用 50% 圆角；矩形按需给 radius
        borderRadius: shape === 'circle' || shape === 'ellipse'
          ? '50%'
          : (element.radius !== undefined ? `${num(element.radius)}px` : undefined),
      }}
    />
  );
}

/** 图片：`src` 直接用，裁剪用 objectFit 近似。 */
function renderImage(element) {
  const src = element.src ?? element.url ?? '';
  if (!src) return null;
  return (
    <img
      src={src}
      alt={element.alt ?? ''}
      style={{
        width: '100%',
        height: '100%',
        objectFit: element.objectFit ?? 'cover',
        objectPosition: element.objectPosition ?? 'center',
        display: 'block',
      }}
    />
  );
}

/**
 * 公式：交给 KaTeX。
 *
 * KaTeX 已经是仓库依赖（`katex`），样式从哪来由上层决定 ——
 * 这里只产 DOM，不 import CSS，因为同页可能还有别的地方要用它。
 * 渲染失败时**显示原文**而不是抛错：一页里一个公式坏了不该让整页白掉。
 */
function renderLatex(element) {
  const source = element.latex ?? element.content ?? '';
  const displayMode = element.displayMode === true;
  let html;
  try {
    html = katex.renderToString(String(source), {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    html = escapeHtml(String(source));
  }
  return <div style={{ width: '100%', height: '100%', overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 数字兜底：NaN / undefined / 字符串数字都收。 */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
