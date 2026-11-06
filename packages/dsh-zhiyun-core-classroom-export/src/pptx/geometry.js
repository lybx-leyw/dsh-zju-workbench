/**
 * 元素几何：PPTX 里的线/形状定位、表格主题副色。
 *
 * 源：ref/OpenMAIC/packages/@openmaic/renderer/src/utils/element.ts:1-134
 *     ref/OpenMAIC/lib/utils/element.ts:190-193（getTableSubThemeColor）
 *
 * 上游这两组函数从 `@openmaic/renderer` 的 `exports` 取；按移植规范 §1 判据 3
 * （不 import 别的包的 `src/`），这里把这两个纯函数逐行搬进本包 —— 它们只有
 * 算术和 tinycolor，没有渲染依赖。
 */

import { mixColor, parseColor } from '../pptx/colors.js';

/** 源：element.ts:15-38 */
export function getRectRotatedRange(element) {
  const { left, top, width, height, rotate = 0 } = element;
  const radius = Math.sqrt(width ** 2 + height ** 2) / 2;
  const auxiliaryAngle = (Math.atan(height / width) * 180) / Math.PI;

  const tlbraRadian = ((180 - rotate - auxiliaryAngle) * Math.PI) / 180;
  const trblaRadian = ((auxiliaryAngle - rotate) * Math.PI) / 180;

  const middleLeft = left + width / 2;
  const middleTop = top + height / 2;

  const xAxis = [
    middleLeft + radius * Math.cos(tlbraRadian),
    middleLeft + radius * Math.cos(trblaRadian),
    middleLeft - radius * Math.cos(trblaRadian),
    middleLeft - radius * Math.cos(trblaRadian),
  ];
  const yAxis = [
    middleTop - radius * Math.sin(tlbraRadian),
    middleTop - radius * Math.sin(trblaRadian),
    middleTop + radius * Math.sin(tlbraRadian),
    middleTop + radius * Math.sin(trblaRadian),
  ];

  return {
    xRange: [Math.min(...xAxis), Math.max(...xAxis)],
    yRange: [Math.min(...yAxis), Math.max(...yAxis)],
  };
}

/** 源：element.ts:43-44 — 端点偏移的走向规则，用扩展包围盒会让双折线翻向。 */
const isHorizontalElbow = (start, end) => Math.max(start[0], end[0]) >= Math.max(start[1], end[1]);

/** 源：element.ts:48-92 */
export function getElementRange(element) {
  let minX;
  let maxX;
  let minY;
  let maxY;

  if (element.type === 'line') {
    const xs = [element.start[0], element.end[0]];
    const ys = [element.start[1], element.end[1]];
    if (element.broken) {
      xs.push(element.broken[0]);
      ys.push(element.broken[1]);
    } else if (element.broken2) {
      if (isHorizontalElbow(element.start, element.end)) xs.push(element.broken2[0]);
      else ys.push(element.broken2[1]);
    } else if (element.curve) {
      xs.push(element.curve[0]);
      ys.push(element.curve[1]);
    } else if (element.cubic) {
      xs.push(element.cubic[0][0], element.cubic[1][0]);
      ys.push(element.cubic[0][1], element.cubic[1][1]);
    }
    minX = element.left + Math.min(...xs);
    maxX = element.left + Math.max(...xs);
    minY = element.top + Math.min(...ys);
    maxY = element.top + Math.max(...ys);
  } else if ('rotate' in element && element.rotate) {
    const { xRange, yRange } = getRectRotatedRange(element);
    [minX, maxX] = xRange;
    [minY, maxY] = yRange;
  } else {
    minX = element.left;
    maxX = element.left + element.width;
    minY = element.top;
    maxY = element.top + element.height;
  }
  return { minX, maxX, minY, maxY };
}

/** 源：lib/utils/element.ts:190-193 —— 主题色 0.3 / 0.1 透明度的两档副色。 */
export function getTableSubThemeColor(themeColor) {
  const color = parseColor(themeColor);
  return [color.setAlpha(0.3).toRgbString(), color.setAlpha(0.1).toRgbString()];
}

/** 源：element.ts:94-115 */
export function getLineElementPath(element) {
  const startArr = Array.isArray(element.start) ? element.start : [0, 0];
  const endArr = Array.isArray(element.end) ? element.end : [100, 100];
  const start = startArr.join(',');
  const end = endArr.join(',');
  if (element.broken) {
    return `M${start} L${element.broken.join(',')} L${end}`;
  }
  if (element.broken2) {
    if (isHorizontalElbow(startArr, endArr)) {
      return `M${start} L${element.broken2[0]},${startArr[1]} L${element.broken2[0]},${endArr[1]} ${end}`;
    }
    return `M${start} L${startArr[0]},${element.broken2[1]} L${endArr[0]},${element.broken2[1]} ${end}`;
  }
  if (element.curve) return `M${start} Q${element.curve.join(',')} ${end}`;
  if (element.cubic) {
    const [c1, c2] = element.cubic;
    return `M${start} C${c1.join(',')} ${c2.join(',')} ${end}`;
  }
  return `M${start} L${end}`;
}

/** 源：element.ts:60-90 的渐变混合用法（slide 背景 / 形状渐变）。 */
export function mixGradientColors(colors) {
  if (!colors?.length) return '#ffffff';
  return mixColor(colors[0].color, colors[colors.length - 1].color);
}
