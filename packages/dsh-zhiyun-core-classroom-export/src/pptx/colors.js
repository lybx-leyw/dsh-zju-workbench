/**
 * 颜色：PPTX 需要的是"不透明十六进制 + 单独透明度"这一对值。
 *
 * 源：ref/OpenMAIC/lib/export/use-export-pptx.ts:62-74（formatColor）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:293-344（阴影）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:348-362（描边）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:941-956（图表配色 / analogous）
 *
 * 上游用 `tinycolor2`；仓库 node_modules 已有（hoisted），这里经 createRequire
 * 取用，并留一个只认 hex/rgb() 的降级实现 —— 取不到时导出仍能跑，只是花名
 * （`red`）会退化成黑色而不是抛错。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let tinycolorFactory;
try {
  const loaded = require('tinycolor2');
  tinycolorFactory = typeof loaded === 'function' ? loaded : loaded?.default;
} catch {
  tinycolorFactory = null;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(([^)]+)\)$/i;

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 降级实现：只解析 hex 与 rgb()/rgba()，够覆盖 DSL 里的落盘写法。 */
function fallbackColor(input) {
  const text = String(input ?? '').trim();
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 1;
  if (HEX.test(text)) {
    const hex = text.slice(1);
    const expand = hex.length <= 4 ? hex.split('').map((c) => c + c).join('') : hex;
    r = parseInt(expand.slice(0, 2), 16);
    g = parseInt(expand.slice(2, 4), 16);
    b = parseInt(expand.slice(4, 6), 16);
    if (expand.length === 8) a = parseInt(expand.slice(6, 8), 16) / 255;
  } else if (RGB.test(text)) {
    const parts = text.slice(text.indexOf('(') + 1, -1).split(',').map((part) => part.trim());
    [r, g, b] = parts.slice(0, 3).map((part) => clamp255(parseFloat(part) || 0));
    if (parts[3] !== undefined) a = Math.max(0, Math.min(1, parseFloat(parts[3]) || 0));
  }
  const toHex = () => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return {
    getAlpha: () => a,
    setAlpha(next) {
      a = next;
      return this;
    },
    toHexString: toHex,
    toRgbString() {
      return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
    },
    isValid: () => true,
    analogous: () => Array.from({ length: 10 }, () => ({ toHexString: toHex })),
  };
}

/** 源：use-export-pptx.ts:64-72 —— 透明色一律落成 `#ffffff`（而不是黑色）。 */
export function formatColor(input) {
  if (!input) return { alpha: 0, color: '#000000' };
  const color = parseColor(input);
  if (!color.isValid()) return { alpha: 1, color: '#000000' };
  const alpha = color.getAlpha();
  return { alpha, color: alpha === 0 ? '#ffffff' : color.setAlpha(1).toHexString() };
}

export function parseColor(input) {
  return tinycolorFactory ? tinycolorFactory(input) : fallbackColor(input);
}

/** 源码里 `tinycolor.mix(a, b)` 的用法（渐变背景 / 形状渐变取中值）。 */
export function mixColor(a, b) {
  if (tinycolorFactory?.mix) return tinycolorFactory.mix(a, b).toHexString();
  const first = parseColor(a);
  const second = parseColor(b);
  const toRgb = (color) => {
    const hex = color.setAlpha(1).toHexString().slice(1);
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  };
  const [r1, g1, b1] = toRgb(first);
  const [r2, g2, b2] = toRgb(second);
  return `#${[r1 + r2, g1 + g2, b1 + b2]
    .map((sum) => Math.round(sum / 2).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 源：use-export-pptx.ts:942-956 —— 图表的 10 色轮。 */
export function chartColors(themeColors) {
  if (!Array.isArray(themeColors) || themeColors.length === 0) return [];
  if (themeColors.length === 10) return themeColors.map((color) => formatColor(color).color);
  if (themeColors.length === 1) {
    return parseColor(themeColors[0])
      .analogous(10)
      .map((color) => formatColor(color.toHexString()).color);
  }
  const length = themeColors.length;
  const supplement = parseColor(themeColors[length - 1])
    .analogous(10 + 1 - length)
    .map((color) => color.toHexString());
  return [...themeColors.slice(0, length - 1), ...supplement].map(
    (color) => formatColor(color).color,
  );
}

/** 源：use-export-pptx.ts:293-344 —— 阴影。 */
export function getShadowOption(shadow, ratioPx2Pt) {
  const color = formatColor(shadow.color);
  const { h, v } = shadow;

  let offset = 4;
  let angle = 45;

  if (h === 0 && v === 0) {
    offset = 4;
    angle = 45;
  } else if (h === 0) {
    if (v > 0) {
      offset = v;
      angle = 90;
    } else {
      offset = -v;
      angle = 270;
    }
  } else if (v === 0) {
    if (h > 0) {
      offset = h;
      angle = 1;
    } else {
      offset = -h;
      angle = 180;
    }
  } else if (h > 0 && v > 0) {
    offset = Math.max(h, v);
    angle = 45;
  } else if (h > 0 && v < 0) {
    offset = Math.max(h, -v);
    angle = 315;
  } else if (h < 0 && v > 0) {
    offset = Math.max(-h, v);
    angle = 135;
  } else if (h < 0 && v < 0) {
    offset = Math.max(-h, -v);
    angle = 225;
  }

  return {
    type: 'outer',
    color: color.color.replace('#', ''),
    opacity: color.alpha,
    // 与源一致：blur 换算过，offset 没有（上游已知的 33% 偏差，这里不"顺手修"）。
    blur: shadow.blur / ratioPx2Pt,
    offset: offset / ratioPx2Pt,
    angle,
  };
}

/** 源：use-export-pptx.ts:348-352 */
const dashTypeMap = { solid: 'solid', dashed: 'dash', dotted: 'sysDot' };

/** 源：use-export-pptx.ts:354-362 */
export function getOutlineOption(outline, ratioPx2Pt) {
  const color = formatColor(outline?.color || '#000000');
  return {
    color: color.color,
    transparency: (1 - color.alpha) * 100,
    width: (outline.width || 1) / ratioPx2Pt,
    dashType: outline.style ? dashTypeMap[outline.style] : 'solid',
  };
}

export { dashTypeMap };
