/**
 * SVG path（自定义几何形状 / 折线 / 公式回退）→ pptxgenjs 的 points。
 *
 * 源：ref/OpenMAIC/lib/export/svg-path-parser.ts:1-160
 *     ref/OpenMAIC/lib/export/svg2base64.ts:1-58
 *
 * 上游先用 `@openmaic/geometry` 的 `validateSvgPath` 做语法/尺寸校验（并把
 * 命令规范化），再用 `svg-pathdata` + `svg-arc-to-cubic-bezier` 展点。本仓不
 * import 别的包的 `src/`，所以这里直接调 `svg-pathdata`（仓库已有）：
 * `toAbs()` 归一为绝对坐标、`normalizeHVZ()` 展平 H/V/Z、`aToC()` 把圆弧转三次
 * 贝塞尔 —— 与上游 `validateSvgPath` 内部那条链（geometry/src/index.ts:193-206）
 * 同源，同时省掉手写的 arc→cubic。坏路径返回空数组，不抛（上游同一契约）。
 */

import { SVGPathData } from 'svg-pathdata';

const typeMap = {
  1: 'Z',
  2: 'M',
  4: 'H',
  8: 'V',
  16: 'L',
  32: 'C',
  64: 'S',
  128: 'Q',
  256: 'T',
  512: 'A',
};

const MAX_PATH_LENGTH = 20000;

/** 源：svg-path-parser.ts:25-34 —— 解析并规范化，异常上抛。 */
export function parseSvgPath(d) {
  const normalized = normalize(d);
  if (!normalized) throw new Error('path: Path must begin with moveto (M or m)');
  return normalized.commands.map((item) => ({ ...item, type: typeMap[item.type] }));
}

function normalize(d) {
  if (typeof d !== 'string' || d.length > MAX_PATH_LENGTH) return null;
  if (!/^\s*[Mm]/.test(d)) return null;
  try {
    return new SVGPathData(d).toAbs().normalizeHVZ().aToC();
  } catch {
    return null;
  }
}

/**
 * 源：svg-path-parser.ts:38-138 —— 展平成 pptxgenjs 的 points。
 * 相对坐标在 `toAbs()` 里已经消掉，因此这里不再看 `relative`。
 */
export function toPoints(d) {
  const pathData = normalize(d);
  if (!pathData) return [];
  const points = [];
  for (const item of pathData.commands) {
    const type = typeMap[item.type];
    if (item.type === 2 || item.type === 16) {
      points.push({ x: item.x, y: item.y, relative: false, type });
    } else if (item.type === 32) {
      points.push({
        x: item.x,
        y: item.y,
        curve: { type: 'cubic', x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 },
        relative: false,
        type,
      });
    } else if (item.type === 128) {
      points.push({
        x: item.x,
        y: item.y,
        curve: { type: 'quadratic', x1: item.x1, y1: item.y1 },
        relative: false,
        type,
      });
    } else if (item.type === 1) {
      points.push({ close: true, type });
    }
  }
  return points;
}

const ZERO_RANGE = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** 源：svg-path-parser.ts:140-158 */
export function getSvgPathRange(path) {
  const pathData = normalize(path);
  if (!pathData) return { ...ZERO_RANGE };
  try {
    const { minX, minY, maxX, maxY } = pathData.getBounds();
    if ([minX, minY, maxX, maxY].some((value) => value == null || !Number.isFinite(value))) {
      return { ...ZERO_RANGE };
    }
    return { minX, minY, maxX, maxY };
  } catch {
    return { ...ZERO_RANGE };
  }
}

/**
 * 源：svg2base64.ts:1-58 —— 上游用 DOM 的 XMLSerializer 序列化一个临时
 * `<svg>`。服务端没有 DOM，所以这里直接拼等价字符串再 base64：
 * 编码结果必须是 `data:image/svg+xml;base64,`（pptxgenjs 只认这条前缀）。
 */
const SVG_PREFIX = 'data:image/svg+xml;base64,';

export function svgMarkupToBase64(svg) {
  return SVG_PREFIX + Buffer.from(svg, 'utf8').toString('base64');
}

/** 一个只含 path 的 SVG（形状 / 公式回退两种用法共用一个拼装口）。 */
export function pathToSvgMarkup({
  viewBox,
  width,
  height,
  d,
  fill = 'none',
  stroke,
  strokeWidth = 1,
  strokeLinecap,
  strokeLinejoin,
}) {
  const attributes = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="${viewBox}"`,
    `width="${width}"`,
    `height="${height}"`,
    `fill="${fill}"`,
  ];
  if (stroke) {
    attributes.push(`stroke="${stroke}"`);
    attributes.push(`stroke-width="${strokeWidth}"`);
    if (strokeLinecap) attributes.push(`stroke-linecap="${strokeLinecap}"`);
    if (strokeLinejoin) attributes.push(`stroke-linejoin="${strokeLinejoin}"`);
  }
  return `<svg ${attributes.join(' ')}><path d="${d}"/></svg>`;
}
