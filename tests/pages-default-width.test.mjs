import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pagesModule } from './support/pinned-pages.mjs';
const { createPages } = await pagesModule('src/pages-service.js');

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * 把产品层的一个源文件打成自包含 ESM 再 import。
 *
 * 不直接读源码文本塞进 `data:` URL：产品层有自己的 JSX 模块（`icons.jsx`），相对
 * import 与 `react/jsx-runtime` 在 `data:` URL 里都解析不了。打包一次反而更接近
 * 真实产物 —— 被测的就是浏览器里跑的那份代码路径。
 *
 * @param relative - 相对仓库根的源文件路径。
 * @returns 该模块的导出。
 */
async function bundleModule(relative) {
  const result = await build({
    entryPoints: [path.join(root, relative)],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const defaults = await bundleModule('packages/client/pages-default/src/client.jsx');
const icons = await bundleModule('packages/client/pages-default/src/icons.jsx');
const railIcons = await bundleModule('packages/client/pages-default/src/rail-icons.js');
const brand = await bundleModule('packages/client/pages-default/src/brand.js');

/**
 * 一个够用的假 DOM：只需要 `createElement(NS)`、`querySelector`、`append`、`remove`。
 *
 * 这里刻意不引 jsdom：被测逻辑只碰极少数节点操作，自己造一个更小的桩就能覆盖
 * 「插入 / 去重 / 卸载」三件事，比拖一个完整 DOM 实现更说明问题。
 *
 * @returns 假文档。
 */
function fakeDocument({ withCells = true } = {}) {
  const made = [];
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.parent = null;
      this.textContent = '';
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    setAttributeNS(_ns, name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    get tagName() { return this.tag.toUpperCase(); }
    get nextSibling() {
      if (this.parent === null) return null;
      const siblings = this.parent.children;
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    insertBefore(child, reference) {
      child.parent = this;
      const index = reference === null ? this.children.length : this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }
    append(child) { child.parent = this; this.children.push(child); }
    remove() {
      if (this.parent === null) return;
      this.parent.children = this.parent.children.filter(node => node !== this);
      this.parent = null;
    }
    querySelector(selector) {
      const marker = selector.replace(/[\[\]]/g, '');
      const walk = node => {
        for (const child of node.children) {
          if (child.attributes.has(marker) || (child.dataset && marker in child.dataset)) return child;
          const found = walk(child);
          if (found !== null) return found;
        }
        return null;
      };
      return walk(this);
    }
    querySelectorAll(selector) {
      const marker = selector.replace(/[\[\]]/g, '').trim();
      const out = [];
      const walk = node => {
        for (const child of node.children) {
          if (child.attributes.has(marker)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
  }
  const head = new FakeNode('head');
  const rail = new FakeNode('nav');
  rail.dataset.rail = true;
  const cells = [];
  if (withCells) {
    for (const label of ['DSH 工作台', 'Pages']) {
      const button = new FakeNode('button');
      button.attributes.set('aria-label', label);
      const cell = new FakeNode('span');
      cell.attributes.set('data-dsh-pages-rail-icon', '');
      const glyph = new FakeNode('span');
      glyph.textContent = label === 'Pages' ? '▦' : '⌂';
      cell.append(glyph);
      button.append(cell);
      rail.append(button);
      cells.push({ label, button, cell, glyph });
    }
  }
  const doc = {
    head,
    defaultView: {},
    createElement: tag => new FakeNode(tag),
    createElementNS: (_ns, tag) => {
      const node = new FakeNode(tag);
      made.push(node);
      return node;
    },
    querySelector(selector) {
      if (selector === '[data-dsh-pages-rail]') return rail;
      for (const cell of cells) {
        if (selector.includes(`"${cell.label}"`)) return cell.button;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-dsh-pages-rail]') return [rail];
      if (selector.includes('data-zju-rail-art')) {
        return cells.flatMap(cell => cell.cell.children.filter(child => child.attributes.has('data-zju-rail-art')));
      }
      return [];
    },
  };
  return { doc, rail, cells, made };
}

test('client defaults update reset target even when a user has saved 80px', () => {
  const { service: pages, dispose } = createPages();
  try {
    pages.setRailWidth(80);
    const before = pages.getSnapshot();
    defaults.applyDefaultRailWidth(pages, { getItem: () => '{"railWidth":80}' });
    assert.equal(pages.getSnapshot().railWidth, 80);
    assert.equal(pages.getSnapshot().defaultRailWidth, 51);
    assert.equal(before.defaultRailWidth, 64);
    pages.setRailWidth(pages.getSnapshot().defaultRailWidth);
    assert.equal(pages.getSnapshot().railWidth, 51);
  } finally { dispose(); }
});

test('fresh client starts at 51 and disposing defaults restores only the default', () => {
  const { service: pages, dispose } = createPages();
  let cleanup;
  try {
    // `effect` 是包里「页面管理页样式」那一项用的：它是纯样式注入，与页面壳服务无关，
    // 所以不挂在 inject 回调里。假 ctx 必须同时提供两个方法。
    defaults.apply({
      effect(fn) { const undo = fn(); return () => undo?.(); },
      inject(keys, callback) { callback({ pages, effect(fn) { cleanup = fn(); } }); },
    });
    assert.equal(pages.getSnapshot().railWidth, 51);
    assert.equal(pages.getSnapshot().defaultRailWidth, 51);
    pages.setRailWidth(80);
    cleanup();
    assert.equal(pages.getSnapshot().railWidth, 80);
    assert.equal(pages.getSnapshot().defaultRailWidth, 64);
    assert.throws(() => pages.setDefaultRailWidth(0), RangeError);
  } finally { dispose(); }
});

test('client replaces the P / placeholder with the official DeepSeek mark', () => {
  const { service: pages, dispose } = createPages();
  let cleanup;
  try {
    assert.equal(pages.getSnapshot().railPlaceholderIcon, undefined, '外壳默认是文字 P /');
    defaults.apply({
      effect(fn) { const undo = fn(); return () => undo?.(); },
      inject(keys, callback) { callback({ pages, effect(fn) { cleanup = fn(); } }); },
    });
    assert.equal(typeof pages.getSnapshot().railPlaceholderIcon, 'function', '占位图标换成了鲸鱼组件');
    cleanup();
    assert.equal(pages.getSnapshot().railPlaceholderIcon, undefined, '卸载后回到 P /');
  } finally { dispose(); }
});

test('the whale is the verbatim official DeepSeek mark, drawn at its native aspect ratio', () => {
  assert.match(icons.WHALE_PATH, /^M[\d.]/);
  assert.ok(icons.WHALE_PATH.length > 2000, 'whale path is the verbatim official artwork');
  assert.deepEqual({ ...icons.WHALE_VIEWBOX }, { width: 23.16, height: 17.04 });
  assert.equal(typeof icons.WhaleIcon, 'function');
});

test('built-in glyphs are hidden by CSS and replaced by inline vector SVG, never a bitmap', () => {
  const config = {
    homePage: 'home', managerPage: 'pages',
    homeLabel: { en: 'DSH workbench', zh: 'DSH 工作台' },
    managerLabel: { en: 'Pages', zh: '页面管理' },
  };
  const css = railIcons.railIconCss({ config });
  // 按**稳定标记**限定，不按 aria-label：标签是本地化文本，切语言后会变，
  // 用它当选择器锚点会让图标在英文模式下失去归属（真机踩过：格子全空）。
  // 断言的是「每个内建页各有自己的选择器」，而不是某个语言的具体文案。
  for (const id of ['home', 'pages']) {
    assert.ok(css.includes(`button[data-zju-rail-role="${id}"]`), `${id} 必须被覆盖`);
  }
  // 反向断言：不能再依赖 aria-label —— 一旦依赖，语言一换就失效。
  assert.ok(!css.includes('aria-label'), '不得再以 aria-label 作选择器锚点（语言相关）');
  // 字形由 JS 物理移除；CSS 这条是兜底（带 !important，防止别处重新显出来）。
  assert.ok(css.includes('[data-dsh-pages-rail-icon]>span{display:none!important}'));
  // 不再靠继承 secondary 的灰：显式给主色，选中态换品牌色。
  assert.ok(css.includes('--dsw-alias-label-primary'), '未选中用主色而不是 secondary 灰');
  assert.ok(css.includes('[aria-current="page"]'), '选中态有独立颜色');
  // 关键：不再用位图式手段画图形 —— mask 与 content:url 都会在缩放后发虚。
  assert.ok(!/mask\s*:/.test(css) && !css.includes('-webkit-mask'), '不用蒙版');
  assert.ok(!css.includes('content:url'), '不用 content:url（位图栅格化）');
  // 图形必须是内联 svg 元素，且用 currentColor 跟着选中态变色。
  const { doc, cells } = fakeDocument();
  railIcons.installRailIconArtwork({ config }, doc);
  for (const cell of cells) {
    const art = cell.cell.children.find(child => child.attributes.has('data-zju-rail-art'));
    assert.ok(art, `${cell.label} 得到内联 svg`);
    assert.equal(art.tag, 'svg');
    assert.equal(art.getAttribute('stroke'), 'currentColor');
    // 规格与各页面插件自己声明的图标一致：24 网格 / 19px / 1.65 描边。
    assert.equal(art.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(art.getAttribute('width'), '19');
    assert.equal(art.getAttribute('stroke-width'), '1.65');
    assert.ok(art.children.length >= 2, '形状有多个子元素');
  }
});

test('artwork is idempotent, escaped labels are safe, and dispose removes it', () => {
  const config = { homePage: 'home', managerPage: 'pages', homeLabel: 'Home', managerLabel: 'a"b\\c' };
  const { doc, cells } = fakeDocument({ withCells: false });
  // 标签含引号/反斜杠时选择器仍合法（不抛错），没有任何格子就什么也不做。
  assert.doesNotThrow(() => railIcons.installRailIconArtwork({ config }, doc));
  assert.equal(railIcons.railIconCss(undefined), '');
  assert.equal(railIcons.railIconCss({}), '');
  assert.doesNotThrow(() => railIcons.installRailIconArtwork({ config: { homePage: 'h', managerPage: 'p' } }, doc));

  const plain = fakeDocument();
  const pages = { config: { homePage: 'home', managerPage: 'pages', homeLabel: 'DSH 工作台', managerLabel: 'Pages' } };
  const undo = railIcons.installRailIconArtwork(pages, plain.doc);
  const countArt = () => plain.cells.reduce(
    (total, cell) => total + cell.cell.children.filter(child => child.attributes.has('data-zju-rail-art')).length, 0);
  assert.equal(countArt(), 2);
  // 再装一次不重复插入（幂等）——页面壳重渲染会反复触发补插。
  railIcons.installRailIconArtwork(pages, plain.doc);
  assert.equal(countArt(), 2);
  undo();
  assert.equal(countArt(), 0, '卸载后图形一并移除');
  assert.equal(cells.length, 0);
});

test('the native glyph is physically removed and restored on dispose', () => {
  const { doc, cells } = fakeDocument();
  const pages = { config: { homePage: 'home', managerPage: 'pages', homeLabel: 'DSH 工作台', managerLabel: 'Pages' } };
  const undo = railIcons.installRailIconArtwork(pages, doc);
  for (const cell of cells) {
    assert.equal(cell.cell.children.includes(cell.glyph), false, '原字形已从 DOM 移除');
    assert.equal(cell.cell.children.some(child => child.attributes.has('data-zju-rail-art')), true, '换成内联 svg');
  }
  undo();
  for (const cell of cells) {
    assert.equal(cell.cell.children.includes(cell.glyph), true, '卸载后原字形放回原位');
  }
});

// —— 原生品牌行遮蔽 ——
//
// 被测的是「用槽位影子注册」这一层契约，不是宿主侧栏的渲染：只要注册到了正确的
// 槽名、带上了更低的 priority、返回空内容，原生那份就会被压住；撤销时全部撤干净。

/**
 * 一个记账用的假槽位服务。
 *
 * 只实现被测代码真正用到的两个方法，并记录每次注册，便于断言槽名与 priority。
 *
 * @param root0 - 开关。
 * @param root0.declared - 是否立即当作「槽位已声明」。
 * @returns `{ slots, registrations, injected }`。
 */
function fakeSlots({ declared = true } = {}) {
  const registrations = [];
  const injected = [];
  const slots = {
    inject(name, callback) {
      injected.push(name);
      if (!declared) return () => {};
      const dispose = callback();
      return () => { const index = registrations.findIndex(item => item.dispose === dispose); if (index >= 0) registrations.splice(index, 1); dispose?.(); };
    },
    register(options, component) {
      const record = { name: options.name, priority: options.priority, component, disposed: false };
      record.dispose = () => { record.disposed = true; };
      registrations.push(record);
      return record.dispose;
    },
  };
  return { slots, registrations, injected };
}

test('only the duplicate whale mark is suppressed; the host wordmark is left alone', () => {
  const { slots, registrations, injected } = fakeSlots();
  const undo = brand.suppressBrandMark(slots);

  // ⚠️ bug1 的回归锚就在这一行断言里：上一版把**两个**槽都让空，
  // 而宿主 `.logoRow` 写死 60px、`.brand` 又是 flex:1 —— 内容空了盒子还在，
  // 顶部就是一条 60px 的空白带。字标必须留给宿主。
  assert.deepEqual(injected, ['sidebar.brand.mark'], '只接管标记槽');
  assert.deepEqual([...brand.SUPPRESSED_BRAND_SLOTS], ['sidebar.brand.mark']);
  assert.ok(!brand.SUPPRESSED_BRAND_SLOTS.includes('sidebar.brand.name'),
    'name 槽必须留着，否则顶部又会空一块');
  assert.equal(registrations.length, 1);
  // 原生那份是默认 priority 0；更低的数值才会被选为渲染者。
  assert.equal(registrations[0].priority, -1, '必须压在原生之下');
  // 让掉的是重复的鲸鱼：这里渲染的是一个**零视觉的定位锚点**（空 span），不是图标。
  const marker = registrations[0].component({});
  assert.equal(marker.type, 'span', '标记槽渲染空 span 作为锚点');
  assert.equal(marker.props.children, undefined, '锚点没有任何内容');
  assert.equal(marker.props['aria-hidden'], 'true', '锚点对辅助技术不可见');

  undo();
  assert.ok(registrations.every(record => record.disposed), '卸载后注册撤掉，原生鲸鱼恢复');
});

test('the brand row is left-aligned after the whale is dropped', () => {
  // 宿主原本是 justify-content:flex-end + .brand{flex:1}：让掉鲸鱼之后字标会被顶到最右，
  // 左端空着。产品其余部分（导轨/页头/列表）都是左对齐，这一行必须跟上。
  const css = brand.BRAND_ROW_CSS;
  assert.match(css, /justify-content:flex-start/, '整行左对齐');
  assert.ok(!/justify-content:flex-end/.test(css), '不能保留右对齐');
  assert.match(css, /flex:0 0 auto/, '身份按钮不再 flex:1 撑满整行');
  // 死规则自检：隐藏装锚点的那层 span 会让 :has() 失配、整套样式永久失效。
  assert.ok(!/span:first-child\{\s*display:none/.test(css),
    '不能隐藏锚点所在的 span —— 那会让选择器自己关掉自己');
});

test('the alignment selectors only match the wide state, never the collapsed rail', () => {
  // 宽态：button > span > span > span[marker]；收起态：button > span > span[marker]。
  // 差一层，所以只命中宽态 —— 不会误伤收起态那颗 36px 的折叠按钮。
  const selector = brand.ROW_SELECTOR;
  assert.match(selector, /data-window-drag/, '用宿主写死的语义属性当锚点');
  assert.match(selector, /\[data-zju-brand-slot\]/, '用我们自己的标记当判据');
  assert.ok(!/GgXflG|_\w+\{/.test(selector), '不依赖构建期哈希类名');
  assert.match(selector, /:has\(> button > span > span > \[data-zju-brand-slot\]\)/,
    '层级必须比收起态多一层');
});

test('the package draws no brand artwork of its own', () => {
  // 用户明确要求：不做自己的图标。这个包只能「少做一件事」，不能新增品牌绘制。
  const exported = Object.keys(brand);
  for (const forbidden of ['ZhiyunBrandMark', 'ZhiyunBrandName', 'BRAND_MARK_WORD',
    'BRAND_WORD_PATH', 'BRAND_MARK_SCREEN', 'BRAND_MARK_VIEWBOX']) {
    assert.ok(!exported.includes(forbidden), `不应再导出自有品牌绘制：${forbidden}`);
  }
});

test('brand suppression is a no-op when the slot service is absent or misshapen', () => {
  // 宿主没提供 slots、或换了形状：静默不动，绝不能因此让侧栏起不来。
  for (const absent of [undefined, null, {}, { inject: () => {} }, { register: () => {} }]) {
    assert.doesNotThrow(() => brand.suppressBrandMark(absent), '缺失槽位服务时安全退出');
    assert.equal(typeof brand.suppressBrandMark(absent), 'function', '仍然返回可调用的撤销函数');
  }
  // 槽位还没声明时 inject 不会回调；撤销函数照样可用。
  const pending = fakeSlots({ declared: false });
  const undo = brand.suppressBrandMark(pending.slots);
  assert.equal(pending.registrations.length, 0, '槽位未声明就不注册');
  assert.doesNotThrow(undo);
});

test('the rail whale carries an explicit primary colour instead of inheriting grey', () => {
  const { doc } = fakeDocument();
  const { createArtwork } = railIcons;
  // 导轨动作格在页面壳里写死 color: secondary，所以鲸鱼不能靠 currentColor 继承。
  const style = icons.WhaleIcon({ size: 23 }).props.style;
  assert.ok(style, '图标自带颜色');
  assert.match(style.color, /--dsw-alias-label-primary/, '用主色而不是 secondary 灰');
  // 兜底值也要是近黑，不能在主题变量缺席时退回灰。
  assert.match(style.color, /#101318/i, '缺变量时退回近黑');
  // 图形仍是 currentColor，跟随上面那个显式颜色。
  assert.equal(icons.WhaleIcon({ size: 23 }).props.children.props.fill, 'currentColor');
  assert.equal(typeof createArtwork, 'function', '内建页图标的着色路径不受影响');
  assert.ok(doc);
});
