/**
 * 课件页渲染器 —— 我们自己的实现。**住在 UI 层，不在 core**。
 *
 * # 为什么在 ui-shared 而不是 `core/classroom-renderer`
 *
 * 它 `import React` 并产出 DOM。按本仓分层：**core 不含 UI**（只有纯逻辑与
 * 宿主服务），页面的渲染组件归 UI 层。所以组件搬到这里，`core/classroom-renderer`
 * 只留画布常量这类纯数据。
 *
 * 这也修掉了一个真实的耦合：以前是 `core` 里的组件被 `page-study` 直接 import，
 * 于是「core 不依赖 React」这条边界一直是破的。
 *
 * # 为什么重写而不是继续 vendor
 *
 * 上游 `@openmaic/renderer` 是 246 个文件 / 1.5 MB 的构建产物，支持 11 类元素
 * （chart / table / code / audio / video / snapshot…）。但**产品实际只用到 4 类**：
 * 它自己的 prompt 就写着「只用 text / shape / image / latex 四类；没有配图就用 text」
 * （见 `core/classroom-generate/src/prompts.js` 的 `SCENE_SYSTEM.slide`）。
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
// 画布常量是**纯数据**，定义权留在 core（生成侧也要用它），这里只引用。
import { VIEWPORT_RATIO, VIEWPORT_SIZE } from '@lybx-leyw/dsh-zju-core-classroom-renderer';

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
      className="zwc-slide"
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
              // 文字与公式用 minHeight：它们的高度由内容（字体度量 / KaTeX 排版）
              // 决定，模型给的格子只是估计值，硬约束会把内容裁掉。
              // shape / image 仍用固定 height —— 它们的尺寸就是图形本身。
              ...(element.type === 'text' || element.type === 'latex'
                ? { minHeight: Math.max(1, num(element.height) * scale) }
                : { height: Math.max(1, num(element.height) * scale) }),
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
 *
 * # 高度是「最小高度」，不是硬约束
 *
 * 模型给的 `height` 是它估的排版格子。实测它经常**刚好等于** `fontSize × 1.5`
 * —— 例如标题 `fontSize:28 / height:42`，28×1.5 = 42，零余量。
 * 这时只要字体回退、加粗、或者浏览器行高度量与模型假设的差哪怕 1px，
 * 文字就会被 `overflow:hidden` 齐刷刷裁掉上半截 —— 表现是「标题被切一半」，
 * 而且元素坐标完全正确，很难看出是高度问题。
 *
 * 所以：
 *   - 行高默认降到 1.35（中文安全值），给字体度量留余量
 *   - `minHeight` 取代 `height`：内容真的长了就往下撑，不裁
 *   - 不设 `overflow:hidden`：宁可压到下一行一点点，也不让标题断头
 *
 * 外层 wrapper 同样用 `minHeight`，否则内层撑开了外层还是裁。
 */
function renderText(element) {
  const style = {
    width: '100%',
    minHeight: '100%',
    // 行高不写死 1.5：中文字体的 ascent/descent 与西文不同，
    // 1.5 在「高度刚好等于 font×1.5」的格子里必然卡死。
    lineHeight: element.lineHeight ?? 1.35,
    fontWeight: element.fontWeight ?? 'normal',
    textAlign: element.textAlign ?? 'left',
    color: element.color ?? 'inherit',
    // 保留换行与连续空格：模型给的 content 里可能有 <br> 与缩进
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    // 块级子元素（<p>）默认有 margin，会把内容顶出格子
    // 这里用 CSS 变量式写法不合适，交给 style.css 的 .zwc-slide p 规则
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
  // 与文字同一条理由：`height` 是模型估的格子，公式的实际行高由 KaTeX 决定。
  // 硬设 height + overflow:hidden 会把多行公式（矩阵、分段函数、长分式）
  // 齐头裁掉 —— 实测「qE + qv×B」需要 102px 而格子只给 55px。
  return (
    <div
      style={{ width: '100%', minHeight: '100%', display: 'flex', alignItems: 'center' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
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
