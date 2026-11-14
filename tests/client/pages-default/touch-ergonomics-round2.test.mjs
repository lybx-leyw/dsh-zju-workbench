/**
 * 触摸工效学（第二轮）：安全区、按下反馈、点按高亮、滚动链、输入框字号、横屏。
 *
 * # 这一组守卫在防什么
 *
 * 第一轮（`rail-touch-targets.test.mjs`）管的是「点不点得准」，这一轮管的是
 * 「手指按下去之后会发生什么」。这几条的共同点是：**桌面上完全看不出问题**，
 * 只有在真机触屏上才暴露，而任何一条被改回去都不会让功能测试变红。
 *
 * 全部只用裸 Node 读源码，不需要宿主与浏览器；真机读数与截图见
 * `packages/client/pages-default/docs/evidence/narrow-touch/`、
 * 方法与逐项证据见 `docs/narrow-touch-ergonomics-round2.md`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const RAIL_ACTION = read('packages/client/pages-default/src/rail-action.jsx');
const UI_SHARED = read('packages/client/ui-shared/src/style.css');
const VIDEO = read('packages/client/page-study/src/video.css');

/** 取出源文件里的一份模板串（`const NAME = \`…\``）。 */
function template(source, name) {
  const start = source.indexOf(`const ${name} = \``);
  assert.ok(start > 0, `应有 const ${name} 模板串`);
  return source.slice(start, source.indexOf('`;', start));
}

/**
 * 取出某个选择器在文本里的**最后一条**规则体。
 *
 * ⚠️ 不能直接 `indexOf(selector)` 再找它后面的第一个 `{`：注释里常写着
 * 「`max()` 而不是相加」这类说明，花括号会先在那里命中，取到的是半条注释。
 * 所以先把注释剥掉，再在**不含注释**的文本里取选择器位置 —— 而返回的规则体
 * 也从剥过注释的文本里取，调用方拿到的自然是纯声明。
 */
function lastRuleBody(css, selectorFragment) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let last = null;
  let from = 0;
  for (;;) {
    const at = stripped.indexOf(selectorFragment, from);
    if (at < 0) break;
    const open = stripped.indexOf('{', at);
    const close = stripped.indexOf('}', open);
    if (open < 0 || close < 0) break;
    last = stripped.slice(open + 1, close);
    from = close + 1;
  }
  return last;
}


/**
 * 取出 `@supports (…)` / `@media (…)` 这一块的**完整文本**（含嵌套花括号）。
 *
 * 只按选择器找规则体的做法不够用：同一个选择器会在别的块里再出现一次
 * （`[data-dsh-pages-rail]` 在「安全区」与「横屏」两块里都有），
 * 「全文最后一条」会量错对象。所以先按花括号配对切出目标块，再在块内找。
 *
 * @param css - 已剥注释的样式文本。
 * @param opening - 块开头（如 `@supports (inset: env(safe-area-inset-bottom))`）。
 * @returns 块的完整文本（含开头），找不到时 null。
 */
function blockText(css, opening) {
  const at = css.indexOf(opening);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  if (open < 0) return null;
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(at, i);
}

// ─────────────────────────────────────────────────────────────── 安全区

test('安全区：viewport-fit=cover 要求自己让开 home indicator / 刘海', () => {
  const touch = template(RAIL_ACTION, 'TOUCH_CSS');
  /**
   * 宿主的 meta 实测是 `width=device-width, initial-scale=1, viewport-fit=cover`
   * —— 画到屏幕物理边缘，刘海与 home indicator 盖住的地方也归产品。于是**必须**
   * 自己把内容让开那块区域。
   *
   * 实测 390×844：导轨最后一项「页面管理」底边 831，而 home indicator 占底部
   * 34px（844 − 34 = 810）—— 重叠 21px，点它会同时触发系统上滑手势。
   */
  assert.match(touch, /@supports \(inset: env\(safe-area-inset-bottom\)\)/,
    '安全区规则要包在 @supports 里 —— 不支持 env() 的浏览器下不能留下半条废规则');

  // 只在 @supports 块**内部**找 —— 同一选择器在「横屏」那个 @media 块里也有一条，
  // 「全文里最后一条」会取到那一条，量错了对象。
  //
  // 切片必须在**剥过注释**的文本上做：`lastRuleBody` 内部会剥注释，
  // 若这里用含注释的原文算下标，两边偏移就对不上，切出来的块会错位。
  const stripped = touch.replace(/\/\*[\s\S]*?\*\//g, '');
  const supportsBlock = blockText(stripped, '@supports (inset: env(safe-area-inset-bottom))');
  assert.ok(supportsBlock, '缺少 @supports 安全区块');
  const rail = lastRuleBody(supportsBlock, '[data-dsh-pages-rail]');
  assert.ok(rail, '导轨要有安全区规则');
  assert.match(rail, /padding-bottom:\s*max\(\s*[\d.]+px\s*,\s*env\(safe-area-inset-bottom\)\s*\)/,
    '导轨底部要用 max(原内边距, 安全区) —— 直接相加会在没有安全区的设备上凭空多出内边距');

  // 不能写成固定的 `+ env(...)`：非刘海设备上 env() 是 0，加法无害但 max() 更明确
  // 表达了「至少保留原来的内边距」这个意图。
  assert.doesNotMatch(rail, /padding-bottom:\s*calc\([\d.]+px\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/,
    '用 max() 而不是 calc(原值 + env())，意图是「至少原值」');

  // 规划页那只贴右下角的气泡同样会压到指示条。
  assert.match(touch, /zwpg-pet-fab[\s\S]{0,160}max\(\s*[\d.]+px\s*,\s*env\(safe-area-inset-bottom\)\s*\)/,
    '贴着右下角的浮层也要让开指示条');
});

// ─────────────────────────────────────────────────────────────── 按下反馈

test('按下反馈：粗指针下页面按钮必须有 :active', () => {
  /**
   * 触屏没有 hover。自有 1862 条规则里 `:active` 修复前只有 2 条（宿主 11 条），
   * 手机按下任何按钮都毫无反馈 —— 手指又正好盖住按钮本身，用户没有任何依据
   * 判断这一下点中没有。ch05 要求反馈在 0.1s 内出现。
   */
  const active = /:active/g;
  const count = (UI_SHARED.match(active) || []).length;
  assert.ok(count >= 1, 'ui-shared 要给出页面按钮的 :active');

  const coarseStart = UI_SHARED.indexOf('@media (pointer: coarse)');
  assert.ok(coarseStart > 0, '触摸相关规则要挂在 (pointer: coarse) 上');
  const coarseBlocks = UI_SHARED.slice(coarseStart);
  assert.match(coarseBlocks, /\.zw-page :is\(button, \[role="button"\], summary\):active:not\(:disabled\)/,
    '页面按钮的按下态要排除 disabled（禁用按钮按下去不该有反馈）');
  assert.match(coarseBlocks, /background-color:\s*color-mix\(in srgb, currentColor 10%/,
    '用背景色而不是位移/缩放 —— 背景不触发布局，快速连点不会抖');
});

test('按下反馈：实底主操作改用压深，不再叠半透明', () => {
  // 已经是实底的按钮再叠一层半透明会显得"按下去变浅"，与"被按住"的直觉相反。
  const coarseBlocks = UI_SHARED.slice(UI_SHARED.indexOf('@media (pointer: coarse)'));
  assert.match(coarseBlocks, /\.zws-primary[^{]*:active:not\(:disabled\)\s*\{[^}]*filter:\s*brightness\(/,
    '主操作按下时压深一档');
});

test('按下反馈：导轨与鲸鱼也有 :active', () => {
  const touch = template(RAIL_ACTION, 'TOUCH_CSS');
  assert.match(touch, /\[data-dsh-pages-rail\] button:active/,
    '导轨按钮要有按下态');
  assert.match(touch, /\[data-zju-rail-collapse\]:active/,
    '鲸鱼要有按下态 —— 它比导航项小得多，只靠背景变化不够，用内阴影压深');
});

// ─────────────────────────────────────────────────────────────── 点按高亮

test('点按高亮：系统蓝必须关掉，桌面不能跟着变', () => {
  /**
   * 移动端 WebKit 在每次点击后盖一层半透明蓝（默认 `rgba(51,181,229,.4)`）
   * 约 300ms。它不属于产品色板，暗色下尤其突兀，还会和 :active 叠成「闪两下」。
   *
   * 但**桌面要保留**：那是鼠标点击的默认反馈，不该被触摸的规则误伤。
   */
  const touch = template(RAIL_ACTION, 'TOUCH_CSS');
  assert.match(touch, /-webkit-tap-highlight-color:\s*transparent/,
    '导轨要关掉系统点按高亮');

  // 关键：这条必须在 `(pointer: coarse)` 里。写成全局会把桌面的点击反馈一起关掉。
  const coarseIndex = touch.indexOf('@media (pointer: coarse)');
  assert.ok(coarseIndex > 0, '导轨的触摸规则要挂在粗指针上');
  const highlightIndex = touch.indexOf('-webkit-tap-highlight-color');
  assert.ok(highlightIndex > coarseIndex,
    '点按高亮的关闭必须写在粗指针块内 —— 桌面的鼠标点击反馈要保留');

  assert.match(UI_SHARED, /-webkit-tap-highlight-color:\s*transparent/,
    '页面按钮同样要关掉系统蓝');
});

// ─────────────────────────────────────────────────────────────── 滚动链

test('滚动链：内层可滚面板用 contain，不用 none', () => {
  /**
   * 手机在文件树里划到底，余下的滑动会传给外层 —— 表现是「我在翻文件树，
   * 整页却跟着往上跑」，松手还得再划回来。
   *
   * 用 `contain` 不用 `none`：`none` 会把 iOS 的橡皮筋回弹一起取消，而那个回弹
   * 是用户判断「已经到头了」的主要线索。
   */
  assert.match(UI_SHARED, /overscroll-behavior-y:\s*contain/,
    '内层滚动容器要 contain');
  assert.doesNotMatch(UI_SHARED, /overscroll-behavior(-y)?:\s*none/,
    '不要用 none —— 会连橡皮筋回弹一起取消，用户失去"到头了"的线索');

  // 至少要覆盖文档目录、笔记文件树、笔记正文、外层滚动区这四类。
  for (const selector of ['.zw-scroll', '.zwd-nav', '.zws-nt-explorer', '.zws-nt-main']) {
    assert.ok(UI_SHARED.includes(selector), `滚动链规则要覆盖 ${selector}`);
  }
});

test('滚动链：导轨自己也是一层可滚容器', () => {
  // 十项在矮视口下会超出导轨高度；它划到底同样不该把余量传给外层。
  const touch = template(RAIL_ACTION, 'TOUCH_CSS');
  const stripped = touch.replace(/\/\*[\s\S]*?\*\//g, '');
  const supportsBlock = blockText(stripped, '@supports (inset: env(safe-area-inset-bottom))');
  const rail = lastRuleBody(supportsBlock, '[data-dsh-pages-rail]');
  assert.match(rail, /overscroll-behavior-y:\s*contain/,
    '导轨要 contain（它自己会滚）');
});

// ─────────────────────────────────────────────────────────────── 输入框字号

test('输入框字号：手机上 ≥16px，否则 iOS 聚焦会把整页放大且不恢复', () => {
  /**
   * iOS Safari 在聚焦 `font-size < 16px` 的输入框时会把整页放大到能看清那个字号，
   * 而且**不会自己恢复** —— 用户点一次搜索框，页面就永久停在放大状态。
   *
   * 本仓库的筛选框是 13 / 12.5 / 12px，全在阈值以下。改前笔记与论文那 16px 是
   * 第三方插件 `dsh-pocket` 的兜底给的；禁用它的样式表就回落到 13 / 12.5 ——
   * 也就是说产品自己没有这条保护。
   */
  const coarseBlocks = UI_SHARED.slice(UI_SHARED.indexOf('@media (pointer: coarse)'));
  const rule = /input:not\(\[type="checkbox"\][^)]*\)[^{]*\{[^}]*font-size:\s*16px\s*!important/;
  assert.match(coarseBlocks, rule, '粗指针下输入框要钉到 16px');

  // 排除不能放大的控件：checkbox / radio / range / color 放大只会破坏布局。
  for (const skipped of ['checkbox', 'radio', 'range', 'color']) {
    assert.ok(coarseBlocks.includes(`[type="${skipped}"]`), `要排除 ${skipped}`);
  }

  // 只在粗指针上抬：桌面上 13px 是算过 CJK 视觉角度的一档，不能跟着变。
  const beforeCoarse = UI_SHARED.slice(0, UI_SHARED.indexOf('@media (pointer: coarse)'));
  assert.doesNotMatch(beforeCoarse, /font-size:\s*16px\s*!important/,
    '桌面不应被这条影响');
});

// ─────────────────────────────────────────────────────────────── 横屏

test('横屏：矮视口下导轨收间距，但不动命中区', () => {
  /**
   * 实测 844×390：导轨内容 454px、可视 390px —— 溢出 64px，最后两项要先把那条
   * 51px 宽、没有滚动条的细列滚一下才够得着，而它完全看不出能滚。
   *
   * 缩的是**间距**：命中区上一条已经撑到 43 高、彼此相接，再压会重叠。
   */
  const touch = template(RAIL_ACTION, 'TOUCH_CSS');
  assert.match(touch, /@media \(pointer: coarse\) and \(max-height: \d+px\)/,
    '横屏规则要同时限定粗指针与矮视口 —— 桌面窗口拖成矮视口不该被压间距');
  const block = touch.slice(touch.indexOf('and (max-height'));
  assert.match(block, /padding-top:\s*6px/, '上下 padding 收到 6');
  assert.match(block, /gap:\s*2px/, '间距收到 2');
  // 不许在这里改命中区：那会让相邻项重叠（重叠比略小更糟，点错无提示）。
  const ruleBlock = block.slice(0, block.indexOf('`'));
  assert.doesNotMatch(ruleBlock, /::after\s*\{[^}]*inset/, '横屏压缩不许动 ::after 命中区');
});

// ─────────────────────────────────────────────────────────────── 可达性

test('课件小窗的翻页按钮在触屏上必须可见', () => {
  /**
   * `.zws-video-mini-bar` 基态 `opacity: 0`，唯一的两条显形途径是
   * `.zws-video-stage-ppt:hover` 与 `[data-detached="true"]`。实测 390×844 下
   * `(hover: none)` 为真 —— 手机永远 hover 不到，那组翻页按钮在手机上出不来。
   *
   * 这不是美观问题，是一组操作在手机上不可达（WCAG 2.1.1）。
   */
  assert.match(VIDEO, /body\[data-zw\] \.zws-video-mini-bar \{\s*opacity: 1/,
    '粗指针下这条控制条要常驻');
  const coarseIndex = VIDEO.indexOf('@media (pointer: coarse)');
  const miniIndex = VIDEO.indexOf('.zws-video-mini-bar {\n    opacity: 1;');
  assert.ok(coarseIndex > 0, '这条要挂在 (pointer: coarse) 上 —— 桌面仍按 hover 收起画面');
  assert.ok(miniIndex > coarseIndex, '常驻规则要在粗指针块内');
});
