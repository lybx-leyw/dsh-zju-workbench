/**
 * PPTX 生成：教室场景 → pptxgenjs 演示文稿 → zip 字节。
 *
 * 源：ref/OpenMAIC/lib/export/use-export-pptx.ts:530-1309（buildPptxBlob 全文）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:76-214（formatHTML：富文本 → 文本 run）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:244-289（formatPoints）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:364-389（链接 / 图片判定）
 *     ref/OpenMAIC/lib/export/narration.ts:266-282（演讲者备注）
 *     ref/OpenMAIC/lib/export/pptx-scene-placeholders.ts:430-655（占位页排版）
 *
 * # 与源的差别（都只因为"这里是 Node，不是浏览器"）
 *
 * 1. **媒体解析**：源经 `useMediaGenerationStore` / `resolveStoredBytes` / IndexedDB
 *    拿字节。宿主侧没有这些 store，媒体由调用方以 `assets: ref → dataURI|bytes`
 *    注入（`ctx.zhiyunClassroomUpload`/页面包负责落盘与取回）。拿不到的引用直接
 *    跳过该元素（源的行为也是"跳过"），不会把不透明 handle 塞进 pptxgenjs。
 * 2. **视频封面**：源先试 poster，再退到 `<video>` + canvas 抓首帧。Node 没有
 *    canvas，所以只用 poster；没有 poster 就只嵌视频本体（PowerPoint 显示默认播放键）。
 * 3. **形状几何兜底**：源对越界几何调用 `@openmaic/geometry` 的
 *    `shapeToTextFallback`；本仓不 import 别的包 `src/`，越界路径走
 *    `toPoints()` 的"空数组即跳过"，与上游 `toPoints` 的坏路径契约一致。
 * 4. **二维码**：占位页的 QR 见 placeholders.js 头注（无 `uqr`，恒不画）。
 */

import { createRequire } from 'node:module';
import {
  getElementRange,
  getLineElementPath,
  getTableSubThemeColor,
  mixGradientColors,
} from './geometry.js';
import {
  chartColors,
  dashTypeMap,
  formatColor,
  getOutlineOption,
  getShadowOption,
} from './colors.js';
import { toAST } from './html-parser.js';
import { inlineMathSource, proseToPlainText } from './rich-text.js';
import { latexToOmml } from './omml.js';
import { getSvgPathRange, pathToSvgMarkup, svgMarkupToBase64, toPoints } from './svg-path.js';
import {
  placeholderStyleFor,
  pptxSlideNumbers,
  renderScenePlaceholder,
  slidesOnlyDeck,
} from './placeholders.js';

const require = createRequire(import.meta.url);

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'Microsoft YaHei';

/** pptxgenjs 以 CJS 分发（`exports.require`）；按需加载，缺了就在调用时报错。 */
let PptxGenJS;
function loadPptxGenJS() {
  if (!PptxGenJS) {
    PptxGenJS = require('../../vendor/pptxgen.cjs');
    if (typeof PptxGenJS !== 'function') {
      throw new Error('pptxgenjs vendor 入口不是构造函数（vendor/pptxgen.cjs）');
    }
  }
  return PptxGenJS;
}

// ── 富文本 → 文本 run（源：use-export-pptx.ts:78-214）────────────────────────

export function formatHTML(html, ratioPx2Pt) {
  const ast = toAST(html);
  let bulletFlag = false;
  let indent = 0;
  const slices = [];

  const parse = (items, baseStyleObj = {}) => {
    for (const item of items) {
      const isBlockTag = 'tagName' in item && ['div', 'li', 'p'].includes(item.tagName);

      if (isBlockTag && slices.length) {
        const lastSlice = slices[slices.length - 1];
        if (!lastSlice.options) lastSlice.options = {};
        lastSlice.options.breakLine = true;
      }

      const styleObj = { ...baseStyleObj };
      const styleAttr =
        'attributes' in item ? item.attributes.find((attr) => attr.key === 'style') : null;
      if (styleAttr && styleAttr.value) {
        for (const styleItem of styleAttr.value.split(';')) {
          const match = styleItem.match(/([^:]+):\s*(.+)/);
          if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (key && value) styleObj[key] = value;
          }
        }
      }

      if ('tagName' in item) {
        if (item.tagName === 'em') styleObj['font-style'] = 'italic';
        if (item.tagName === 'strong') styleObj['font-weight'] = 'bold';
        if (item.tagName === 'sup') styleObj['vertical-align'] = 'super';
        if (item.tagName === 'sub') styleObj['vertical-align'] = 'sub';
        if (item.tagName === 'a') {
          const attr = item.attributes.find((a) => a.key === 'href');
          styleObj.href = attr?.value || '';
        }
        if (item.tagName === 'ul') styleObj['list-type'] = 'ul';
        if (item.tagName === 'ol') styleObj['list-type'] = 'ol';
        if (item.tagName === 'li') bulletFlag = true;
        if (item.tagName === 'p') {
          if ('attributes' in item) {
            const dataIndentAttr = item.attributes.find((a) => a.key === 'data-indent');
            if (dataIndentAttr && dataIndentAttr.value) indent = +dataIndentAttr.value;
          }
        }
      }

      // 行内公式只写 LaTeX 源码的一个 run，绝不走 KaTeX 树的文本。
      const mathSource = inlineMathSource(item);

      if ('tagName' in item && item.tagName === 'br') {
        slices.push({ text: '', options: { breakLine: true } });
      } else if ('content' in item || mathSource !== null) {
        const text =
          mathSource !== null
            ? mathSource
            : item.content
                .replace(/&nbsp;/g, ' ')
                .replace(/&gt;/g, '>')
                .replace(/&lt;/g, '<')
                .replace(/&amp;/g, '&')
                .replace(/\n/g, '');
        const options = {};

        if (styleObj['font-size']) options.fontSize = parseInt(styleObj['font-size'], 10) / ratioPx2Pt;
        if (styleObj.color) options.color = formatColor(styleObj.color).color;
        if (styleObj['background-color']) {
          options.highlight = formatColor(styleObj['background-color']).color;
        }
        for (const key of ['text-decoration-line', 'text-decoration']) {
          if (!styleObj[key]) continue;
          if (styleObj[key].indexOf('underline') !== -1) {
            options.underline = { color: options.color || '#000000', style: 'sng' };
          }
          if (styleObj[key].indexOf('line-through') !== -1) options.strike = 'sngStrike';
        }
        if (styleObj['vertical-align']) {
          if (styleObj['vertical-align'] === 'super') options.superscript = true;
          if (styleObj['vertical-align'] === 'sub') options.subscript = true;
        }
        if (styleObj['text-align']) options.align = styleObj['text-align'];
        if (styleObj['font-weight']) options.bold = styleObj['font-weight'] === 'bold';
        if (styleObj['font-style']) options.italic = styleObj['font-style'] === 'italic';
        if (styleObj['font-family']) options.fontFace = styleObj['font-family'];
        if (styleObj.href) options.hyperlink = { url: styleObj.href };

        if (bulletFlag && styleObj['list-type'] === 'ol') {
          options.bullet = { type: 'number', indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25 };
          options.paraSpaceBefore = 0.1;
          bulletFlag = false;
        }
        if (bulletFlag && styleObj['list-type'] === 'ul') {
          options.bullet = { indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25 };
          options.paraSpaceBefore = 0.1;
          bulletFlag = false;
        }
        if (indent) {
          options.indentLevel = indent;
          indent = 0;
        }

        slices.push({ text, options });
      } else if ('children' in item) {
        parse(item.children, styleObj);
      }
    }
  };
  parse(ast);
  return slices;
}

// ── SVG path → points（源：use-export-pptx.ts:244-289）──────────────────────

export function formatPoints(points, ratioPx2Inch, scale = { x: 1, y: 1 }, origin = { x: 0, y: 0 }) {
  return points.map((point) => {
    if (point.close !== undefined) return { close: true };
    if (point.type === 'M') {
      return {
        x: ((point.x - origin.x) / ratioPx2Inch) * scale.x,
        y: ((point.y - origin.y) / ratioPx2Inch) * scale.y,
        moveTo: true,
      };
    }
    if (point.curve) {
      if (point.curve.type === 'cubic') {
        return {
          x: ((point.x - origin.x) / ratioPx2Inch) * scale.x,
          y: ((point.y - origin.y) / ratioPx2Inch) * scale.y,
          curve: {
            type: 'cubic',
            x1: ((point.curve.x1 - origin.x) / ratioPx2Inch) * scale.x,
            y1: ((point.curve.y1 - origin.y) / ratioPx2Inch) * scale.y,
            x2: ((point.curve.x2 - origin.x) / ratioPx2Inch) * scale.x,
            y2: ((point.curve.y2 - origin.y) / ratioPx2Inch) * scale.y,
          },
        };
      }
      if (point.curve.type === 'quadratic') {
        return {
          x: ((point.x - origin.x) / ratioPx2Inch) * scale.x,
          y: ((point.y - origin.y) / ratioPx2Inch) * scale.y,
          curve: {
            type: 'quadratic',
            x1: ((point.curve.x1 - origin.x) / ratioPx2Inch) * scale.x,
            y1: ((point.curve.y1 - origin.y) / ratioPx2Inch) * scale.y,
          },
        };
      }
    }
    return {
      x: ((point.x - origin.x) / ratioPx2Inch) * scale.x,
      y: ((point.y - origin.y) / ratioPx2Inch) * scale.y,
    };
  });
}

// ── 链接 / 图片判定（源：364-389）───────────────────────────────────────────

function getLinkOption(link, slideNumbers) {
  const { type, target } = link;
  if (type === 'web') return { url: target };
  if (type === 'slide') {
    const slideNumber = slideNumbers.get(target);
    if (slideNumber !== undefined) return { slide: slideNumber };
  }
  return null;
}

const isBase64Image = (url) => /^data:image\/[^;]+;base64,/.test(url);
const isSVGImage = (url) => /^data:image\/svg\+xml;base64,/.test(url) || /\.svg$/.test(url);

/** 源：narration.ts:266-282 —— 演讲者备注：按动作顺序拼接 speech 文本。 */
export function collectSpeechText(scene) {
  const actions = scene?.actions;
  if (!actions || actions.length === 0) return '';
  const parts = [];
  for (const action of actions) {
    if (action.type !== 'speech') continue;
    parts.push(action.text ?? '');
  }
  return parts.join('\n');
}

// ── 主构建（源：530-1309）────────────────────────────────────────────────────

/**
 * @param {object[]} slides            幻灯片画布（`scene.content.canvas`）
 * @param {object[]} slideScenes       与 slides 同序的 scene（取演讲者备注）
 * @param {object} ratios              { viewportRatio, viewportSize, ratioPx2Inch, ratioPx2Pt }
 * @param {object} options             { deck, lang, resolveMedia, allowRemote, fetch }
 * @returns {Promise<Buffer>}
 */
export async function buildPptxBuffer(slides, slideScenes, ratios, options = {}) {
  const { viewportRatio, viewportSize, ratioPx2Inch, ratioPx2Pt } = ratios;
  const deck = options.deck ?? slidesOnlyDeck(slides.length);
  const resolveMedia = options.resolveMedia ?? (async () => '');
  const pptxgen = loadPptxGenJS();
  const pptx = new pptxgen();

  // 源：557-560 —— 版式只认 16:10 / 4:3，其余一律 16:9。
  if (viewportRatio === 0.625) pptx.layout = 'LAYOUT_16x10';
  else if (viewportRatio === 0.75) pptx.layout = 'LAYOUT_4x3';
  else pptx.layout = 'LAYOUT_16x9';

  const slideNumbers = pptxSlideNumbers(deck, slides);
  const placeholderStyle = placeholderStyleFor(slides);

  for (const entry of deck) {
    const pptxSlide = pptx.addSlide();

    if (entry.kind === 'placeholder') {
      // 测验旁白常常讲解答案，因此不进备注；互动场景的旁白保留。
      if (entry.placeholder.sceneType === 'interactive') {
        const notes = collectSpeechText(entry.placeholder.scene);
        if (notes) pptxSlide.addNotes(notes);
      }
      renderScenePlaceholder(
        pptxSlide,
        entry.placeholder,
        placeholderStyle,
        { viewportSize, viewportRatio },
        { ratioPx2Inch, ratioPx2Pt },
        // 二维码：本仓无 uqr（见 placeholders.js 头注），恒不画。
        undefined,
      );
      continue;
    }

    const slideIdx = entry.slideIndex;
    const slide = slides[slideIdx];
    if (!slide) continue;

    const scene = slideScenes[slideIdx];
    if (scene) {
      const notes = collectSpeechText(scene);
      if (notes) pptxSlide.addNotes(notes);
    }

    // ── 背景（源：597-634）──
    if (slide.background) {
      const bg = slide.background;
      if (bg.type === 'image' && bg.image) {
        const resolvedSrc = await resolveMedia(bg.image.src);
        if (!resolvedSrc) {
          // 缺失的生成背景留空，而不是把不透明 ref 交给 pptxgenjs。
        } else if (isSVGImage(resolvedSrc)) {
          pptxSlide.addImage({
            data: resolvedSrc,
            x: 0,
            y: 0,
            w: viewportSize / ratioPx2Inch,
            h: (viewportSize * viewportRatio) / ratioPx2Inch,
          });
        } else if (isBase64Image(resolvedSrc)) {
          pptxSlide.background = { data: resolvedSrc };
        } else {
          pptxSlide.background = { path: resolvedSrc };
        }
      } else if (bg.type === 'solid' && bg.color) {
        const color = formatColor(bg.color);
        pptxSlide.background = { color: color.color, transparency: (1 - color.alpha) * 100 };
      } else if (bg.type === 'gradient' && bg.gradient) {
        const color = formatColor(mixGradientColors(bg.gradient.colors));
        pptxSlide.background = { color: color.color, transparency: (1 - color.alpha) * 100 };
      }
    }

    if (!slide.elements) continue;

    for (const el of slide.elements) {
      // ── TEXT（源：649-703）──
      if (el.type === 'text') {
        const textProps = formatHTML(el.content ?? '', ratioPx2Pt);
        const textOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
          fontFace: el.defaultFontName || DEFAULT_FONT_FAMILY,
          color: '#000000',
          valign: el.vAlign ?? 'top',
          margin: 10 / ratioPx2Pt,
          paraSpaceBefore: 5 / ratioPx2Pt,
          lineSpacingMultiple: 1.5 / 1.25,
          autoFit: true,
        };
        if (el.rotate) textOptions.rotate = el.rotate;
        if (el.wordSpace) textOptions.charSpacing = el.wordSpace / ratioPx2Pt;
        if (el.lineHeight) textOptions.lineSpacingMultiple = el.lineHeight / 1.25;
        if (el.fill) {
          const color = formatColor(el.fill);
          const opacity = el.opacity === undefined ? 1 : el.opacity;
          textOptions.fill = {
            color: color.color,
            transparency: (1 - color.alpha * opacity) * 100,
          };
        }
        if (el.defaultColor) textOptions.color = formatColor(el.defaultColor).color;
        if (el.defaultFontName) textOptions.fontFace = el.defaultFontName;
        if (el.shadow) textOptions.shadow = getShadowOption(el.shadow, ratioPx2Pt);
        if (el.outline?.width) textOptions.line = getOutlineOption(el.outline, ratioPx2Pt);
        if (el.opacity !== undefined) textOptions.transparency = (1 - el.opacity) * 100;
        if (el.paragraphSpace !== undefined) {
          textOptions.paraSpaceBefore = el.paragraphSpace / ratioPx2Pt;
        }
        if (el.vertical) textOptions.vert = 'eaVert';
        pptxSlide.addText(textProps, textOptions);
        if (el.link) {
          const hyperlink = getLinkOption(el.link, slideNumbers);
          if (hyperlink) {
            // pptxgenjs 不为富文本框的 options 建关系（会写出 rIdundefined），
            // 所以在上面盖一个透明矩形，让整块可点。
            pptxSlide.addShape('rect', {
              x: textOptions.x,
              y: textOptions.y,
              w: textOptions.w,
              h: textOptions.h,
              rotate: textOptions.rotate,
              fill: { color: '#ffffff', transparency: 100 },
              line: { color: '#ffffff', transparency: 100 },
              hyperlink,
            });
          }
        }
        continue;
      }

      // ── IMAGE（源：706-770）──
      if (el.type === 'image') {
        let resolvedSrc = await resolveMedia(el.src);
        if (!resolvedSrc) continue;
        if (!isBase64Image(resolvedSrc)) {
          resolvedSrc = await toDataUrl(resolvedSrc, options);
          if (!resolvedSrc) continue;
        }

        const imageOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
        };
        if (isBase64Image(resolvedSrc)) imageOptions.data = resolvedSrc;
        else imageOptions.path = resolvedSrc;
        if (el.flipH) imageOptions.flipH = el.flipH;
        if (el.flipV) imageOptions.flipV = el.flipV;
        if (el.rotate) imageOptions.rotate = el.rotate;
        if (el.link) {
          const linkOption = getLinkOption(el.link, slideNumbers);
          if (linkOption) imageOptions.hyperlink = linkOption;
        }
        if (el.filters?.opacity) imageOptions.transparency = 100 - parseInt(el.filters.opacity, 10);
        if (el.clip) {
          if (el.clip.shape === 'ellipse') imageOptions.rounding = true;
          const [start, end] = el.clip.range;
          const [startX, startY] = start;
          const [endX, endY] = end;
          const originW = el.width / ((endX - startX) / ratioPx2Inch);
          const originH = el.height / ((endY - startY) / ratioPx2Inch);
          imageOptions.w = originW / ratioPx2Inch;
          imageOptions.h = originH / ratioPx2Inch;
          imageOptions.sizing = {
            type: 'crop',
            x: ((startX / ratioPx2Inch) * originW) / ratioPx2Inch,
            y: ((startY / ratioPx2Inch) * originH) / ratioPx2Inch,
            w: (((endX - startX) / ratioPx2Inch) * originW) / ratioPx2Inch,
            h: (((endY - startY) / ratioPx2Inch) * originH) / ratioPx2Inch,
          };
        }
        pptxSlide.addImage(imageOptions);
        continue;
      }

      // ── SHAPE（源：773-895）──
      if (el.type === 'shape') {
        if (el.special) {
          // 特殊形状走 SVG 图片（源用 DOM 拼 SVG，这里拼字符串）。
          const base64Svg = svgMarkupToBase64(
            pathToSvgMarkup({
              viewBox: `0 0 ${el.viewBox[0]} ${el.viewBox[1]}`,
              width: el.width,
              height: el.height,
              d: el.path,
              fill: el.fill || 'none',
              stroke: el.outline?.color,
              strokeWidth: el.outline?.width || 1,
            }),
          );
          const imageOptions = {
            data: base64Svg,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          if (el.rotate) imageOptions.rotate = el.rotate;
          if (el.flipH) imageOptions.flipH = el.flipH;
          if (el.flipV) imageOptions.flipV = el.flipV;
          if (el.link) {
            const linkOption = getLinkOption(el.link, slideNumbers);
            if (linkOption) imageOptions.hyperlink = linkOption;
          }
          pptxSlide.addImage(imageOptions);
        } else {
          const scale = { x: el.width / el.viewBox[0], y: el.height / el.viewBox[1] };
          const rawPoints = toPoints(el.path);
          if (!rawPoints.length) continue; // 坏路径：toPoints 已按契约返回空数组。
          const points = formatPoints(rawPoints, ratioPx2Inch, scale);

          let fillColor = formatColor(el.fill);
          if (el.gradient) fillColor = formatColor(mixGradientColors(el.gradient.colors));
          if (el.pattern) fillColor = formatColor('#00000000');
          const opacity = el.opacity === undefined ? 1 : el.opacity;

          const shapeOptions = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fill: {
              color: fillColor.color,
              transparency: (1 - fillColor.alpha * opacity) * 100,
            },
            points,
          };
          if (el.flipH) shapeOptions.flipH = el.flipH;
          if (el.flipV) shapeOptions.flipV = el.flipV;
          if (el.shadow) shapeOptions.shadow = getShadowOption(el.shadow, ratioPx2Pt);
          if (el.outline?.width) shapeOptions.line = getOutlineOption(el.outline, ratioPx2Pt);
          if (el.rotate) shapeOptions.rotate = el.rotate;
          if (el.link) {
            const linkOption = getLinkOption(el.link, slideNumbers);
            if (linkOption) shapeOptions.hyperlink = linkOption;
          }
          pptxSlide.addShape('custGeom', shapeOptions);
        }

        // 形状上的文字
        if (el.text) {
          const textProps = formatHTML(el.text.content ?? '', ratioPx2Pt);
          const textOptions = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
            fontFace: DEFAULT_FONT_FAMILY,
            color: '#000000',
            paraSpaceBefore: 5 / ratioPx2Pt,
            valign: el.text.align,
          };
          if (el.rotate) textOptions.rotate = el.rotate;
          if (el.text.defaultColor) textOptions.color = formatColor(el.text.defaultColor).color;
          if (el.text.defaultFontName) textOptions.fontFace = el.text.defaultFontName;
          pptxSlide.addText(textProps, textOptions);
        }

        // 图案浮层
        if (el.pattern) {
          const patternOptions = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          const patternSrc = isBase64Image(el.pattern)
            ? el.pattern
            : await toDataUrl(el.pattern, options);
          if (!patternSrc) continue;
          if (isBase64Image(patternSrc)) patternOptions.data = patternSrc;
          else patternOptions.path = patternSrc;
          if (el.flipH) patternOptions.flipH = el.flipH;
          if (el.flipV) patternOptions.flipV = el.flipV;
          if (el.rotate) patternOptions.rotate = el.rotate;
          pptxSlide.addImage(patternOptions);
        }
        continue;
      }

      // ── LINE（源：898-927）──
      if (el.type === 'line') {
        const path = getLineElementPath(el);
        const { minX, maxX, minY, maxY } = getElementRange(el);
        const points = formatPoints(toPoints(path), ratioPx2Inch, undefined, {
          x: minX - el.left,
          y: minY - el.top,
        });
        const color = formatColor(el.color);
        const lineOptions = {
          x: minX / ratioPx2Inch,
          y: minY / ratioPx2Inch,
          w: (maxX - minX) / ratioPx2Inch,
          h: (maxY - minY) / ratioPx2Inch,
          line: {
            color: color.color,
            transparency: (1 - color.alpha) * 100,
            width: el.width / ratioPx2Pt,
            dashType: dashTypeMap[el.style],
            beginArrowType: el.points?.[0] ? 'arrow' : 'none',
            endArrowType: el.points?.[1] ? 'arrow' : 'none',
          },
          points,
        };
        if (el.shadow) lineOptions.shadow = getShadowOption(el.shadow, ratioPx2Pt);
        if (!points.length) continue;
        pptxSlide.addShape('custGeom', lineOptions);
        continue;
      }

      // ── CHART（源：930-1027）──
      if (el.type === 'chart') {
        const chartData = el.data.series.map((values, index) => ({
          name: `Series ${index + 1}`,
          labels: el.data.labels,
          values,
        }));
        const colors = chartColors(el.themeColors ?? []);
        const chartOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          chartColors:
            el.chartType === 'pie' || el.chartType === 'ring'
              ? colors
              : colors.slice(0, el.data.series.length),
        };

        const textColor = formatColor(el.textColor || '#000000').color;
        chartOptions.catAxisLabelColor = textColor;
        chartOptions.valAxisLabelColor = textColor;
        const fontSize = 14 / ratioPx2Pt;
        chartOptions.catAxisLabelFontSize = fontSize;
        chartOptions.valAxisLabelFontSize = fontSize;

        if (el.fill || el.outline) {
          const plotArea = {};
          if (el.fill) plotArea.fill = { color: formatColor(el.fill).color };
          if (el.outline) {
            plotArea.border = {
              pt: el.outline.width / ratioPx2Pt,
              color: formatColor(el.outline.color).color,
            };
          }
          chartOptions.plotArea = plotArea;
        }

        if (
          (el.data.series.length > 1 && el.chartType !== 'scatter') ||
          el.chartType === 'pie' ||
          el.chartType === 'ring'
        ) {
          chartOptions.showLegend = true;
          chartOptions.legendPos = 'b';
          chartOptions.legendColor = textColor;
          chartOptions.legendFontSize = fontSize;
        }

        let type = pptx.ChartType.bar;
        if (el.chartType === 'bar') {
          type = pptx.ChartType.bar;
          chartOptions.barDir = 'col';
          if (el.options?.stack) chartOptions.barGrouping = 'stacked';
        } else if (el.chartType === 'column') {
          type = pptx.ChartType.bar;
          chartOptions.barDir = 'bar';
          if (el.options?.stack) chartOptions.barGrouping = 'stacked';
        } else if (el.chartType === 'line') {
          type = pptx.ChartType.line;
          if (el.options?.lineSmooth) chartOptions.lineSmooth = true;
        } else if (el.chartType === 'area') {
          type = pptx.ChartType.area;
        } else if (el.chartType === 'radar') {
          type = pptx.ChartType.radar;
        } else if (el.chartType === 'scatter') {
          type = pptx.ChartType.scatter;
          chartOptions.lineSize = 0;
        } else if (el.chartType === 'pie') {
          type = pptx.ChartType.pie;
        } else if (el.chartType === 'ring') {
          type = pptx.ChartType.doughnut;
          chartOptions.holeSize = 60;
        }

        pptxSlide.addChart(type, chartData, chartOptions);
        continue;
      }

      // ── TABLE（源：1030-1121）──
      if (el.type === 'table') {
        const hiddenCells = [];
        for (let i = 0; i < el.data.length; i++) {
          for (let j = 0; j < el.data[i].length; j++) {
            const cell = el.data[i][j];
            if (cell.colspan > 1 || cell.rowspan > 1) {
              for (let row = i; row < i + cell.rowspan; row++) {
                for (let col = row === i ? j + 1 : j; col < j + cell.colspan; col++) {
                  hiddenCells.push(`${row}_${col}`);
                }
              }
            }
          }
        }

        const tableData = [];
        const theme = el.theme;
        const themeColor = theme ? formatColor(theme.color) : null;
        const subThemeColors = theme
          ? getTableSubThemeColor(theme.color).map((color) => formatColor(color))
          : [];

        for (let i = 0; i < el.data.length; i++) {
          const row = el.data[i];
          const cells = [];
          for (let j = 0; j < row.length; j++) {
            const cell = row[j];
            const cellOptions = {
              colspan: cell.colspan,
              rowspan: cell.rowspan,
              bold: cell.style?.bold || false,
              italic: cell.style?.em || false,
              underline: { style: cell.style?.underline ? 'sng' : 'none' },
              align: cell.style?.align || 'left',
              valign: 'middle',
              fontFace: cell.style?.fontname || DEFAULT_FONT_FAMILY,
              fontSize: (cell.style?.fontsize ? parseInt(cell.style.fontsize, 10) : 14) / ratioPx2Pt,
            };
            if (theme && themeColor) {
              let color = i % 2 === 0 ? subThemeColors[1] : subThemeColors[0];
              if (theme.rowHeader && i === 0) color = themeColor;
              else if (theme.rowFooter && i === el.data.length - 1) color = themeColor;
              else if (theme.colHeader && j === 0) color = themeColor;
              else if (theme.colFooter && j === row.length - 1) color = themeColor;
              cellOptions.fill = { color: color.color, transparency: (1 - color.alpha) * 100 };
            }
            if (cell.style?.backcolor) {
              const color = formatColor(cell.style.backcolor);
              cellOptions.fill = { color: color.color, transparency: (1 - color.alpha) * 100 };
            }
            if (cell.style?.color) cellOptions.color = formatColor(cell.style.color).color;
            if (!hiddenCells.includes(`${i}_${j}`)) {
              cells.push({ text: proseToPlainText(cell.text ?? ''), options: cellOptions });
            }
          }
          if (cells.length) tableData.push(cells);
        }

        const tableOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          colW: el.colWidths.map((item) => (el.width * item) / ratioPx2Inch),
        };
        if (el.theme) tableOptions.fill = { color: '#ffffff' };
        if (el.outline?.width && el.outline?.color) {
          tableOptions.border = {
            type: el.outline.style === 'solid' ? 'solid' : 'dash',
            pt: el.outline.width / ratioPx2Pt,
            color: formatColor(el.outline.color).color,
          };
        }
        if (tableData.length) pptxSlide.addTable(tableData, tableOptions);
        continue;
      }

      // ── LATEX（源：1124-1186）──
      if (el.type === 'latex') {
        const lineBreaks = (el.latex?.match(/\\\\/g) || []).length;
        const lines = lineBreaks + 1;
        const boxHeightPt = el.height / ratioPx2Pt;
        const fontSize = Math.round(boxHeightPt / (lines * 3));
        const omml = el.latex ? await latexToOmml(el.latex, fontSize) : null;

        if (omml) {
          pptxSlide.addFormula({
            omml,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fontSize,
            align: el.align,
          });
        } else if (el.path) {
          // 回退：把公式的渲染路径当 SVG 图片贴上去（不可编辑）。
          const range = getSvgPathRange(el.path);
          const strokeWidth = el.strokeWidth || 0;
          const base64Svg = svgMarkupToBase64(
            pathToSvgMarkup({
              viewBox: `${range.minX - strokeWidth} ${range.minY - strokeWidth} ${
                range.maxX - range.minX + strokeWidth * 2
              } ${range.maxY - range.minY + strokeWidth * 2}`,
              width: el.width,
              height: el.height,
              d: el.path,
              fill: 'none',
              stroke: el.color || '#000000',
              strokeWidth,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          );
          const latexOptions = {
            data: base64Svg,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          if (el.link) {
            const linkOption = getLinkOption(el.link, slideNumbers);
            if (linkOption) latexOptions.hyperlink = linkOption;
          }
          pptxSlide.addImage(latexOptions);
        }
        continue;
      }

      // ── VIDEO / AUDIO（源：1189-1304）──
      if (el.type === 'video' || el.type === 'audio') {
        const sourceRef = el.src;
        const resolvedSrc = await resolveMedia(sourceRef);
        if (!resolvedSrc) continue;
        const base64 = isBase64Image(resolvedSrc)
          ? resolvedSrc
          : await toDataUrl(resolvedSrc, options);
        if (!base64) continue;

        const mediaOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          data: base64,
          type: el.type,
        };
        const extMatch = resolvedSrc.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
        if (extMatch && extMatch[1]) mediaOptions.extn = extMatch[1];
        else if (el.ext) mediaOptions.extn = el.ext;
        else mediaOptions.extn = el.type === 'video' ? 'mp4' : 'mp3';

        if (el.type === 'video') {
          // 源还会用 canvas 抓首帧；Node 没有 canvas，只用元素自带的 poster。
          const posterSrc = el.poster ? await resolveMedia(el.poster) : '';
          if (posterSrc) {
            const cover = isBase64Image(posterSrc)
              ? posterSrc
              : await toDataUrl(posterSrc, options);
            if (cover) mediaOptions.cover = cover;
          }
        }

        pptxSlide.addMedia(mediaOptions);
      }
    }
  }

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

/**
 * 非 data: 的图片地址 → data:。源在浏览器里 `fetch` 后转 base64；服务端只有
 * 显式允许（`options.allowRemote`）且地址是 http(s) 时才去取，避免导出进程
 * 偷偷发外网请求。
 */
async function toDataUrl(src, options) {
  if (src.startsWith('data:')) return src;
  if (!options.allowRemote || !/^https?:/i.test(src)) return '';
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return '';
  try {
    const response = await fetchImpl(src);
    if (!response.ok) return '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return '';
    const type = response.headers?.get?.('content-type')?.split(';')[0]?.trim();
    const mime = type && type.startsWith('image/') ? type : guessImageMime(src);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

const IMAGE_MIME = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function guessImageMime(url) {
  const path = url.split(/[?#]/)[0] ?? '';
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_MIME[extension] ?? 'application/octet-stream';
}
