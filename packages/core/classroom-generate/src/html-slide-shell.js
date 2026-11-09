// Model output is data only. This module owns every executable byte and layout rule.
const NONCE = 'classroom-slide-shell-v1';
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fail = (message) => { throw new Error(`Invalid slide deck: ${message}`); };
function record(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) fail(path);
}
function text(value, max, path) {
  // 报错必须能分辨三种情况：**没有这个字段** / 不是字符串 / 是空的。
  // 只说 "expected nonempty plain text" 时，模型不知道自己是漏了字段还是写成了数组，
  // 重画还是照旧 —— 实测整批页面因为 `explanation` 缺失被打回，而它以为只是"写短了"。
  if (value === undefined || value === null) {
    fail(`${path}: 缺少这个字段。${path.endsWith('.explanation')
      ? '每页都必须给出 explanation（画布外的完整讲解，不限长度），它不能省略'
      : '请补上这个字段'}`);
  }
  if (typeof value !== 'string') {
    fail(`${path}: 必须是字符串，收到的是 ${Array.isArray(value) ? '数组' : typeof value}`);
  }
  if (!value.trim()) fail(`${path}: 不能是空字符串`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail(`${path}: 含有不可见的控制字符，请删掉后重发`);
  }
  if ([...value].length > max) fail(`${path}: max ${max} Unicode characters, got ${[...value].length}. ${path.endsWith('.points') ? 'Use short keywords only; move equations to formulas and long explanations to explanation.' : 'Shorten this label or split the slide; do not shrink text.'}`);
}
const svgTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
const mathTags = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mfenced', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'semantics', 'span', 'sub', 'sup']);
const number = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const color = /^(?:#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|none)$/;
function safeText(s) {
  return !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s) && !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/u.test(s);
}
// A deliberately small XML grammar, not a browser's error-recovering HTML parser.
function markup(source, kind, options = {}) {
  if (typeof source !== 'string' || !source.trim() || source.length > 50000) fail(`${kind} markup`);
  const tags = kind === 'svg' ? svgTags : mathTags;
  const stack = [];
  let offset = 0; let roots = 0;
  while (offset < source.length) {
    if (source[offset] !== '<') {
      const end = source.indexOf('<', offset);
      const chunk = source.slice(offset, end < 0 ? source.length : end);
      if (!safeText(chunk) || (kind === 'svg' && !stack.length && chunk.trim())) fail(`${kind} text`);
      if (/\\(?:frac|sqrt|begin|sum|overline|math|left|right)|[_^]\{/.test(chunk)) fail(`${kind}: raw LaTeX is not rendered. Use MathML in formula rows; use short Unicode labels in SVG.`);
      offset += chunk.length; continue;
    }
    const token = /^<(\/)?([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)>/.exec(source.slice(offset));
    if (!token) fail(`${kind} token`);
    const [, closing, tag, attrs, selfClosing] = token;
    if (!tags.has(tag)) fail(`${kind} tag ${tag}`);
    if (closing) {
      if (attrs.trim() || selfClosing || stack.pop() !== tag) fail(`${kind} nesting`);
    } else {
      if (!stack.length) { roots++; if (kind === 'svg' && (tag !== 'svg' || roots !== 1)) fail('svg root'); }
      if (kind === 'svg' && stack.length && tag === 'svg') fail('nested svg');
      let rest = attrs; const seen = new Set();
      while (rest.trim()) {
        const a = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest);
        if (!a) fail(`${kind} attributes`);
        const name = a[1]; const value = a[2] ?? a[3];
        if (seen.has(name) || value.includes('&')) fail(`${kind} attribute ${name}`);
        seen.add(name);
        let valid = false;
        if (kind === 'svg') {
          if (name === 'viewBox') valid = tag === 'svg' && value === '0 0 800 560';
          else if (name === 'xmlns') valid = tag === 'svg' && value === 'http://www.w3.org/2000/svg';
          else if (['fill', 'stroke'].includes(name)) valid = color.test(value);
          else if (['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'font-size', 'dx', 'dy', 'opacity', 'fill-opacity', 'stroke-opacity'].includes(name)) {
            valid = number.test(value) && Math.abs(Number(value)) <= 1600;
            // 图示标签的可读下限。
            //
            // 实测（Chromium，800×560 图示区按 800px 物理像素渲染）：
            //   16px → 行高 21px，一行约 50 个汉字
            //   18px → 行高 24px，一行约 44 个汉字
            //   20px → 行高 26px，一行约 40 个汉字
            //   24px → 行高 31px，一行约 33 个汉字
            //
            // 原来卡 24px，对中文讲义（每图 5-8 个标签）够用；但论文图示常有 15-20 个
            // 文献引用标签，24px 一行只能放 33 字 → 放不下 → 模型被反复打回。
            // 18px 是**清晰可读的正文大小**（渲染 24px 高），在此之上不再人为收紧。
            //
            // 真正的「看不清」由浏览器实测兜住（字号 × 画布缩放后的物理像素）。
            // 在这里拒绝而不是渲染时放大 —— 放大只改字号不改坐标，会把相邻行叠掉，
            // 而模型收到的错误会变成「标签重叠」，跟真正的原因对不上。
            //
            // ⚠️ 这是**生成期**的质量门。渲染已有数据时必须关掉（options.strictFontSize=false）：
            //    历史课件里存在更小的标签，用今天的门去卡昨天的产物，
            //    结果不是「质量更好」而是「课程打不开」。
            const MIN_SVG_FONT_SIZE = 18;
            if (options.strictFontSize !== false && valid && name === 'font-size' && tag === 'text' && Number(value) < MIN_SVG_FONT_SIZE) {
              fail(`svg text font-size ${value} 太小（下限 ${MIN_SVG_FONT_SIZE}）：请调大字号，并按新的行高重新排布，不要依赖渲染期放大`);
            }
          }
          else if (name === 'd') valid = tag === 'path' && /^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]+$/.test(value);
          else if (name === 'points') valid = ['polygon', 'polyline'].includes(tag) && /^[\d\s.,+-]+$/.test(value);
          else if (name === 'text-anchor') valid = ['start', 'middle', 'end'].includes(value);
          else if (name === 'dominant-baseline') valid = ['auto', 'middle', 'central', 'hanging'].includes(value);
          else if (name === 'font-weight') valid = ['normal', 'bold', '400', '500', '600', '700'].includes(value);
          else if (name === 'stroke-linecap') valid = ['butt', 'round', 'square'].includes(value);
          else if (name === 'stroke-linejoin') valid = ['miter', 'round', 'bevel'].includes(value);
          else if (name === 'stroke-dasharray') valid = /^[\d .,-]+$/.test(value);
          // `transform` 是 SVG 的标准坐标变换。只接受**列表形式**的
          // translate/scale/rotate/matrix/skew 组合 —— 不许出现 CSS 或外链，
          // 也不许 `url()`。它是纯几何运算，不执行任何东西，所以是安全的。
          else if (name === 'transform' && tag !== 'svg') {
            valid = /^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\s*\([^()]*\)\s*)+$/.test(value.trim());
          }
          // `role="img"` 是**无障碍标注**：把一组图形标记为一张图，让读屏软件
          // 用 `aria-label` 整段朗读而不是逐个读形状。`<svg>` 与 `<g>` 上都是合法用法
          // （模型两种都会写，实测 55 张图里有 2 张把 role 放在包裹用的 `<g>` 上）。
          // 只允许 `img` 一个值 —— 别把 `role="button"` 之类能改语义的值放进来。
          else if (name === 'role') valid = (tag === 'svg' || tag === 'g') && value === 'img';
          else if (name === 'aria-label') valid = value.length <= 200 && !/[<>\\\u0000-\u001f]/.test(value);
          else if (name === 'preserveAspectRatio') valid = ['xMidYMid meet', 'xMinYMin meet'].includes(value);
        } else {
          if (name === 'xmlns') valid = tag === 'math' && value === 'http://www.w3.org/1998/Math/MathML';
          else if (name === 'display') valid = tag === 'math' && ['inline', 'block'].includes(value);
          else if (name === 'mathvariant') valid = ['normal', 'bold', 'italic', 'bold-italic', 'double-struck', 'script', 'fraktur', 'sans-serif', 'monospace'].includes(value);
          else if (name === 'mathcolor') valid = color.test(value);
          // 标准 MathML 排版属性：`width` 给 `mspace`/`mtable` 定宽、`columnalign`
          // 管列对齐、`rowspacing`/`columnspacing` 管间距、`displaystyle` 管字号样式。
          // 都是纯排版，不执行任何东西，而且没有它们时多行推导根本排不整齐。
          else if (name === 'width' || name === 'height') valid = number.test(value) || /^\d+(?:\.\d+)?(?:%|em|ex|px)$/.test(value);
          else if (name === 'columnalign' || name === 'rowalign') valid = /^(?:left|center|right)(?:\s+(?:left|center|right))*$/.test(value);
          else if (name === 'rowspacing' || name === 'columnspacing') valid = /^[\d.\s%emx]+$/.test(value);
          else if (name === 'displaystyle') valid = ['true', 'false'].includes(value);
          else if (name === 'scriptlevel') valid = /^\d$/.test(value);
        }
        if (!valid) fail(`${kind} attribute ${name}`);
        rest = rest.slice(a[0].length);
      }
      if (kind === 'svg' && tag === 'svg' && !seen.has('viewBox')) fail('svg viewBox');
      if (!selfClosing) stack.push(tag);
    }
    offset += token[0].length;
  }
  if (stack.length || (kind === 'svg' && roots !== 1)) fail(`${kind} nesting`);
}
function validateSlideDeckStrict(deck, options = {}) {
  record(deck, ['slides', 'title', 'topic'], 'deck');
  if (!Array.isArray(deck.slides) || !deck.slides.length) fail('slides must contain at least one slide');
  Array.from(deck.slides).forEach((slide, i) => {
    const p = `slides[${i}]`;
    record(slide, ['title', 'kicker', 'points', 'summary', 'visualHtml', 'formulas', 'explanation', 'layout'], p);
    // `layout: 'wide-formula'`：公式优先版式（图示缩为上方一条，公式占满整幅宽）。
    // 由 fit 在「长公式连对半切都放不下」时写入，模型不产出这个字段。
    if (slide.layout !== undefined && slide.layout !== 'wide-formula') fail(`${p}.layout 只支持 "wide-formula"`);
    // 标题是 56px 字号、120px 高、1472px 宽的**单行**区域（实测一篇 24 字刚满）。
    // 超了不是「看着挤」，而是直接换行顶到正文区、把画面下压。
    {
      const length = [...String(slide.title ?? '')].length;
      if (length > 24) {
        fail(`${p}.title 有 ${length} 字，超出 24 字上限 ${length - 24} 字。`
          + '标题是 56px 单行区域，超出会换行并顶乱下面的版面。'
          + '请把副标题性质的内容挪到 kicker（≤28 字），细节放进 explanation。');
      }
      text(slide.title, 24, `${p}.title`);
    }
    text(slide.explanation, 100000, `${p}.explanation`);
    // 摘要与副标题的容量是**实测出来的版面约束**，不是随手定的字数。
    //
    // `.summary` 是画布底部固定 80px 高、30px 字号、40px 行高的横条，宽 1472px。
    // 实测（1472px 内、30px 汉字）：**48 字仍是两行（77px 高，未裁切）；
    // 50 字变三行（112px）开始被裁掉**。所以上限取 48 —— 这是「两行的量」的真实边界。
    //
    // 之前写 40 是拍脑袋估的，比真实容量少 8 字。代价是模型在 41-46 字之间频繁被打回
    // （实测 236 条 summary 里 14% 超限，中位数 33、p90 42）—— 那些其实都放得下。
    for (const [key, max, where] of [['kicker', 28, '副标题'], ['summary', 48, '底部核心总结']]) {
      if (slide[key] === undefined) continue;
      const length = [...String(slide[key])].length;
      if (length > max) {
        fail(`${p}.${key}（${where}）有 ${length} 字，超出 ${max} 字上限 ${length - max} 字。`
          + '这个位置在画布上是固定高度的一到两行：超出的字会被裁掉，不是「挤一挤就能放下」。'
          + '请删减到两句以内，把完整表述移到 explanation 讲解区。');
      }
    }
    if (slide.points !== undefined) {
      // 错误信息必须能让模型自己数清楚：只说 `slides[0].points` 时，
      // 模型不知道是「多了几个」还是「哪个太长」，重画仍是同一个错（实测连续 3 次）。
      if (!Array.isArray(slide.points)) fail(`${p}.points 必须是字符串数组`);
      if (slide.points.length > 3) {
        fail(`${p}.points 有 ${slide.points.length} 条，最多 3 条：${slide.points.map((point, n) => `${n + 1})${String(point).slice(0, 24)}`).join(' ')}。请合并或删减到 3 条以内，其余内容移入 explanation`);
      }
      // 长度上限按**实测容量**定，不是拍脑袋：
      // 内容栏 580px、字号 30px、行高 44px、左内边距 32px → 每行约 18 个汉字，
      // 纵向可放约 13 行。所以一条要点允许折成两行（≤36 字）也仍然读得下；
      // 真正溢出的情况由浏览器校验（`.content-pane` 的 scrollHeight）兜住，
      // 不需要在这里用一个人为的紧上限提前卡死 —— 那会让论文这种长术语
      // （「Melnychuk 等指出 ATE 存在先验诱导偏差」= 26 字）永远过不了。
      const POINT_MAX = 36;
      Array.from(slide.points).forEach((point, n) => text(point, POINT_MAX, `${p}.points[${n}]`));
    }
    markup(slide.visualHtml, 'svg', options);
    if (slide.formulas !== undefined) {
      if (!Array.isArray(slide.formulas)) fail(`${p}.formulas 必须是数组（没有公式就写 []）`);
      if (slide.formulas.length > 4) {
        fail(`${p}.formulas 有 ${slide.formulas.length} 条，最多 4 条：把推导拆到下一页，不要在一页塞完`);
      }
      Array.from(slide.formulas).forEach((formula) => {
        record(formula, ['html', 'label'], `${p}.formula`);
        markup(formula.html, 'formula');
        // 公式标记显示在画布外的「推导提示」列表里（`第 N 式：<label>`），
        // 那一列宽 580px、30px 字号。实测 14 个汉字仍是**单行**，15 个才换行；
        // 换行本身不裁切也不溢出（只是多占一行），所以上限取 14 —— 实测的单行边界。
        // 原来卡 12 是估的，比真实边界紧 2 字。
        if (formula.label !== undefined) text(formula.label, 14, `${p}.formula.label`);
      });
    }
  });
  return deck;
}
/**
 * 校验 slides 数据。
 *
 * @param deck 幻灯片数据
 * @param {{strictFontSize?: boolean}} [options]
 *   strictFontSize: false 用于**渲染已存在的数据**：字号下限是生成期质量门，
 *   拿今天的门去卡昨天生成的课件，后果是「课程打不开」，而不是「质量更好」。
 *   生成路径仍走默认的严格模式。
 */
export function validateSlideDeck(deck, options = {}) {
  record(deck, ['slides', 'title', 'topic'], 'deck');
  if (!Array.isArray(deck.slides) || !deck.slides.length) fail('slides must contain at least one slide');
  const errors = [];
  Array.from(deck.slides).forEach((slide, index) => {
    try { validateSlideDeckStrict({ ...deck, slides: [slide] }, options); }
    catch (error) { errors.push(error.message.replace(/slides\[0\]/g, `slides[${index}]`)); }
  });
  if (errors.length) fail(errors.slice(0, 16).join('; '));
  return deck;
}
// ⚠️ 这里**不做任何字号改写**。
//
// 曾经有过一版「把小于 24px 的标签放大到 24px」的兜底。那是个坏主意，真实事故：
// 模型按 19px、行距 22px 排了一张三层文献图，渲染时被统一放大到 24px，
// 相邻两行（Kim 2024 / Ching 2026）直接叠在一起，而校验报的是「标签重叠」——
// 模型看到的错误跟它真正犯的错（字号太小）对不上，连续 3 次修复都修不掉。
//
// 正确做法：**在校验阶段拒绝**过小的字号，让模型按可读下限重新排版。
// 可读性下限由 `font-size` 的语法校验负责（见 `markup()` 里的 `MIN_SVG_FONT_SIZE`）。
const readableSvg = svg => svg;
const CSS = `*{box-sizing:border-box}html,body{margin:0}html{height:100%}
body{display:flex;flex-direction:column;gap:10px;height:100dvh;padding:20px;overflow:clip;background:#e7e3d9;color:#202d2c;font-family:Georgia,'Noto Serif CJK SC','Songti SC',serif}
.deck-heading{flex:none;margin:0;font-size:22px;line-height:1.3;color:#2b3a37}
.deck-layout{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,min(26vw,440px));gap:20px;align-items:stretch}
.deck-stage{min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px}
.stage-viewport{flex:1 1 auto;min-height:0;display:grid;place-items:center}
.controls{flex:none;display:flex;flex-wrap:wrap;gap:8px}
.controls button{padding:8px 14px;background:#faf7ee;border:1px solid #176c68;color:#202d2c;font:inherit;font-size:14px;cursor:pointer;border-radius:4px}
.controls button:disabled{opacity:.45;cursor:default}
#status{align-self:center;padding:6px;font-size:13px;color:#48616b;font-variant-numeric:tabular-nums}
.page-progress{flex:none;height:10px;border-radius:5px;background:#d8d2c4}
.page-progress i{display:block;height:100%;width:0;border-radius:5px;background:#176c68;transition:width .18s ease}
.stage-wrapper{width:1600px;height:900px;position:relative}
.stage{width:1600px;height:900px;transform-origin:top left}
.slide{width:1600px;height:900px;padding:64px;background:#faf7ee;border-top:8px solid #176c68;position:relative}
.slide-header{height:120px}
.kicker{font-size:30px;line-height:36px;color:#176c68;margin:0 0 8px}
.slide h2{font-size:56px;line-height:68px;font-weight:600;margin:0;letter-spacing:0}
.slide-body{display:grid;grid-template-columns:820px 580px;gap:32px;height:560px;margin-top:0}
/* 公式优先版式：给拆不开的长公式腾出整幅宽度。
   fit 发现某条公式连「按项对半切」都放不下时，会给这一页加 data-layout="wide-formula"——
   否则它会被永久卡在 580px 里，模型改什么都过不去。
   图示仍然保留在右栏上方，只是缩到一行高度，不丢「每页一张图」的约束。 */
.slide[data-layout="wide-formula"] .slide-body{display:flex;flex-direction:column;gap:16px;height:560px}
.slide[data-layout="wide-formula"] .visual-pane{width:100%;height:180px;flex:none}
.slide[data-layout="wide-formula"] .visual-pane>svg{width:100%;height:180px}
.slide[data-layout="wide-formula"] .content-pane{width:100%;height:340px;flex:none;padding:0}
.slide[data-layout="wide-formula"] .formula-row{font-size:30px}
.visual-pane{width:820px;height:560px}
.visual-pane>svg{display:block;width:800px;height:560px;overflow:visible;font-size:30px}
.visual-pane text{font-family:Georgia,'Songti SC',serif}
.content-pane{width:580px;height:560px;padding:8px 0}
.points{padding:0 0 0 32px;margin:0 0 20px;font-size:30px;line-height:44px}
.formula-row{min-height:64px;display:flex;align-items:center;gap:16px;border-top:1px solid #b9cac0;font-size:32px;line-height:1.3;padding:10px 0}
.formula-content{width:100%;min-width:0}
.formula-guidance{white-space:normal;margin-top:16px}
.formula-guidance ol{margin:8px 0;padding-left:24px}
.formula-row math{font-size:32px}
.summary{height:80px;margin:0;padding:16px 0;border-top:3px solid #c18a33;font-size:30px;line-height:40px}
.deck-notes{min-width:0;height:100%;overflow-y:auto;overscroll-behavior:contain;border-left:4px solid #176c68;background:#fffdf6;padding:22px 26px}
.deck-notes:focus-visible{outline:3px solid #c18a33;outline-offset:-3px}
.explanation-panel{margin:0;font-size:19px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}
.explanation-panel h3{font-size:20px;line-height:1.4;margin:0 0 14px;color:#176c68}
.js-ready .stage-wrapper[hidden],.js-ready .explanation-panel[hidden]{display:none}
.js-ready .deck-notes{position:relative}
@page{size:1600px 900px;margin:0}
@media (max-width:900px){
  body{height:auto;min-height:100dvh;overflow:visible;padding:14px}
  .deck-layout{grid-template-columns:1fr;gap:14px}
  .deck-stage{min-height:0}
  .stage-viewport{flex:none}
  .deck-notes{height:auto;max-height:none;border-left:0;border-top:4px solid #176c68;padding:18px}
}
@media print{
  body{display:block;height:auto;padding:0;overflow:visible;background:white}
  .deck-heading,.controls,.page-progress{display:none!important}
  .deck-layout{display:block}
  .deck-stage,.stage-viewport,.deck-notes{display:block;height:auto;overflow:visible;padding:0;border:0;background:white}
  .stage-wrapper,.js-ready .stage-wrapper[hidden]{display:block!important;width:1600px!important;height:900px!important;margin:0;break-after:page}
  .stage{transform:none!important}
  .slide{break-inside:avoid}
  .formula-row{visibility:visible!important}
  .explanation-panel,.js-ready .explanation-panel[hidden]{display:block!important;break-after:page;margin:0;padding:64px}
}`;
const BOOT = `(()=>{'use strict';const slides=[...document.querySelectorAll('.slide')],wrappers=[...document.querySelectorAll('.stage-wrapper')],notes=[...document.querySelectorAll('.explanation-panel')],box=document.querySelector('.stage-viewport');let index=0,steps=slides.map(()=>0);const rows=()=>[...slides[index].querySelectorAll('[data-formula-step]')];function fit(){const availW=(box&&box.clientWidth)||(document.documentElement.clientWidth-40)||1600;const availH=(box&&box.clientHeight)||900;const scale=Math.max(.05,Math.min(1,availW/1600,availH/900));wrappers.forEach(w=>{w.style.width=1600*scale+'px';w.style.height=900*scale+'px';w.firstElementChild.style.transform='scale('+scale+')';});}function resetNotesScroll(){const n=notes[index];if(n&&n.parentElement)n.parentElement.scrollTop=0;}function update(){wrappers.forEach((w,i)=>{w.hidden=i!==index;});notes.forEach((n,i)=>{n.hidden=i!==index;});slides.forEach((s,i)=>s.querySelectorAll('[data-formula-step]').forEach((r,n)=>{const visible=n<steps[i];r.style.visibility=visible?'visible':'hidden';r.setAttribute('aria-hidden',String(!visible));}));document.getElementById('status').textContent=(index+1)+' / '+slides.length+' · '+steps[index]+' / '+rows().length;document.getElementById('previous-slide').disabled=index===0;document.getElementById('next-slide').disabled=index===slides.length-1;document.getElementById('previous-formula').disabled=steps[index]===0;document.getElementById('next-formula').disabled=steps[index]===rows().length;const bar=document.getElementById('page-progress-bar');if(bar){bar.style.width=((index+1)/slides.length*100)+'%';bar.parentElement.setAttribute('aria-valuenow',String(index+1));}try{parent.postMessage({type:'html-deck:state',slideIndex:index,slideCount:slides.length,formulaStep:steps[index],formulaCount:rows().length},'*');}catch(e){}fit();}function goTo(n){if(!Number.isFinite(n))return;const changed=n!==index;index=Math.max(0,Math.min(slides.length-1,Math.trunc(n)));update();if(changed)resetNotesScroll();}function formula(d){steps[index]=Math.max(0,Math.min(rows().length,steps[index]+d));update();}function showAllFormulas(){steps[index]=rows().length;update();}window.htmlDeck={goTo,showAllFormulas,getState:()=>({slideIndex:index,formulaStep:steps[index],slideCount:slides.length,formulaCount:rows().length})};document.getElementById('previous-slide').onclick=()=>goTo(index-1);document.getElementById('next-slide').onclick=()=>goTo(index+1);document.getElementById('previous-formula').onclick=()=>formula(-1);document.getElementById('next-formula').onclick=()=>formula(1);document.getElementById('show-all-formulas').onclick=showAllFormulas;document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;if(e.key==='ArrowLeft'){e.preventDefault();goTo(index-1);}if(e.key==='ArrowRight'){e.preventDefault();goTo(index+1);}if(e.code==='Space'){e.preventDefault();formula(1);}});window.addEventListener('resize',fit);if(window.ResizeObserver)new ResizeObserver(fit).observe(box||document.documentElement);document.documentElement.classList.add('js-ready');update();})();`;
/**
 * 渲染章节 HTML。
 *
 * @param {{title?: string, topic?: string, slides: object[], strictFontSize?: boolean}} input
 *   strictFontSize 默认 true（生成路径）。渲染**已存在**的课件时传 false：
 *   字号下限是生成期的质量门，历史数据里有 22/23px 的标签，用新门卡旧数据
 *   只会让课程打不开（见 markup() 里的说明）。
 */
export function renderSlideChapter({ title = '课堂讲义', topic = '', slides, strictFontSize = true }) {
  text(title, 200, 'title');
  if (typeof topic !== 'string' || /[<>]/.test(topic)) fail('topic');
  const deck = validateSlideDeck({ title, topic, slides }, { strictFontSize });
  const payload = JSON.stringify(deck).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const wrappers = slides.map((s, i) => `<div class="stage-wrapper"><div class="stage"><article class="slide" data-slide-index="${i}"${s.layout === 'wide-formula' ? ' data-layout="wide-formula"' : ''} aria-label="${escape(s.title)}"><header class="slide-header">${s.kicker ? `<p class="kicker">${escape(s.kicker)}</p>` : ''}<h2>${escape(s.title)}</h2></header><div class="slide-body"><div class="visual-pane">${readableSvg(s.visualHtml)}</div><div class="content-pane">${s.points?.length ? `<ul class="points">${s.points.map(p => `<li>${escape(p)}</li>`).join('')}</ul>` : ''}${(s.formulas || []).map((f, n) => `<div class="formula-row" data-formula-step="${n + 1}"><div class="formula-content">${f.html}</div></div>`).join('')}</div></div><p class="summary">${escape(s.summary || '')}</p></article></div></div>`).join('');
  const notes = slides.map((s, i) => `<section class="explanation-panel" data-explanation-index="${i}"><h3>${escape(s.title)} · 讲解</h3>${escape(s.explanation)}${s.formulas?.some(f => f.label) ? `<div class="formula-guidance"><strong>推导提示</strong><ol>${s.formulas.map((f, n) => `<li>第 ${n + 1} 式${f.label ? `：${escape(f.label)}` : ''}</li>`).join('')}</ol></div>` : ''}</section>`).join('');
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${NONCE}'; style-src 'nonce-${NONCE}'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style nonce="${NONCE}">${CSS}</style></head><body><h1 class="deck-heading">${escape(title)}${topic ? ` · ${escape(topic)}` : ''}</h1><main class="deck-layout"><div class="deck-stage"><nav class="controls" aria-label="演示控制"><button id="previous-slide">上一页</button><button id="next-slide">下一页</button><button id="previous-formula">上一步公式</button><button id="next-formula">下一步公式</button><button id="show-all-formulas">显示全部公式</button><output id="status" aria-live="polite"></output></nav><div class="page-progress" role="progressbar" aria-label="章节内页进度" aria-valuemin="1" aria-valuemax="${slides.length}" aria-valuenow="1"><i id="page-progress-bar"></i></div><div class="stage-viewport">${wrappers}</div></div><aside class="deck-notes" aria-label="本页讲解" tabindex="0">${notes}</aside></main><script id="slide-deck-data" type="application/json">${payload}</script><script nonce="${NONCE}">${BOOT}</script></body></html>`;
}
export function validateSlideChapter(html) {
  try {
    if (typeof html !== 'string') throw new Error();
    const match = /<script id="slide-deck-data" type="application\/json">([^<]*)<\/script>/.exec(html);
    // 用宽松模式重渲染做**逐字节比对**：这里校验的是「外壳没被篡改」，
    // 不是「内容达到今天的生成质量」。严格模式会让历史课件永远对不上。
    if (!match || renderSlideChapter({ ...JSON.parse(match[1]), strictFontSize: false }) !== html) throw new Error();
    return html;
  } catch { throw new Error('Invalid slide chapter: deterministic shell tamper'); }
}
