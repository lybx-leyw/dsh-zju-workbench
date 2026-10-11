/**
 * 把外层的主题变量送进同源 iframe，并顺手藏掉上游阅读器里**已经搬到本壳**的控件。
 *
 * 为什么需要这一步：上游 `reader/index.html` 是「自渲染 + 内联脚本」的独立页面，
 * 它有自己的 `#bar`、自己的翻译端点设置弹窗（`#cfg-pop`）、自己的选中即问浮层
 * （`#ask-pop`）。它不认识 `--zy-*`，所以默认是一块跟工作台脱节的灰底白字。
 *
 * 我们**不 fork 它的 HTML**（锁版的意义就在于不改上游源码），而是在它加载后注入
 * 一张样式表：
 *
 *   - 把 `--zy-*` 的具体色值写成它的 `--dpr-*` 兜底色，视觉上并进工作台；
 *   - `#cfg-open`/`#cfg-pop` 藏掉 —— 端点配置集中在「个人 → 设置 → 论文阅读」；
 *   - `#ask-pop` 藏掉 —— 提问走右侧的 AI 助手抽屉，不再有第二个输入框；
 *   - `#pdf-path`/`#ver` 藏掉 —— 那是给独立页面用的调试信息。
 *
 * 纯函数、不碰 DOM：`tests/paper.test.mjs` 直接断言它生成的选择器与取值。
 * 注入动作在 `ReaderFrame.jsx`。
 */

/** 外层 CSS 变量 → 上游 iframe 里实际会读到的属性。 */
const TOKEN_MAP = [
  ['--zy-bg', '--zp-frame-bg'],
  ['--zy-surface', '--zp-frame-surface'],
  ['--zy-text', '--zp-frame-text'],
  ['--zy-secondary', '--zp-frame-secondary'],
  ['--zy-line', '--zp-frame-line'],
  ['--zy-accent', '--zp-frame-accent'],
];

/** 兜底色：万一 `--zy-*` 没读到（主题插件没装），也别让 iframe 变成透明黑。 */
const FALLBACK = {
  '--zy-bg': '#ffffff',
  '--zy-surface': '#f7f7f8',
  '--zy-text': '#1f2328',
  '--zy-secondary': '#6b7280',
  '--zy-line': '#e5e7eb',
  '--zy-accent': '#165dff',
};

/**
 * 从一份「像 CSSStyleDeclaration 的对象」里取主题色。
 * 传 `undefined`（服务端渲染、测试）时全部回落到兜底色。
 */
export function readThemeTokens(style) {
  const tokens = {};
  for (const [source, target] of TOKEN_MAP) {
    const value = style?.getPropertyValue?.(source)?.trim();
    tokens[target] = value || FALLBACK[source];
  }
  return tokens;
}

/**
 * 隐藏那些「已经由本壳接管」的上游控件。
 * 每条都带 `!important`：上游对内联样式用的是 `style.display = 'block'`，
 * 只有样式表里的 `!important` 能压过它。
 */
const HIDE_RULES = [
  '#ask-pop',   // 选中即问浮层 → 右侧助手抽屉
  '#cfg-open',  // 翻译端点齿轮 → 宿主设置面板
  '#cfg-pop',   // 翻译端点弹窗 → 宿主设置面板
  '#pdf-path',  // 本地绝对路径（工作台里不该出现）
  '#ver',       // 上游版本号
];

export function frameThemeCss(tokens = readThemeTokens(undefined)) {
  const vars = Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join('\n');
  const hides = HIDE_RULES.map((selector) => `${selector} { display: none !important; }`).join('\n');
  return `/* 由 dsh-zhiyun-page-paper 注入：只改外观与可见性，不动上游逻辑。 */
:root {
${vars}
}
html, body { background: var(--zp-frame-bg); color: var(--zp-frame-text); }
${hides}
`;
}
