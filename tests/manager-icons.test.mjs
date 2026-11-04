import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「页面管理页里的内建页图标」—— 与导轨同一套图形，但**渲染路径不同**。
 *
 * 导轨里页面壳渲染 `<span>` 包着字形，可以 CSS 隐藏 + JS 插 svg；
 * 管理行里 `.pm-icon` 里是**裸文本节点**（`⌂` / `▦`），CSS 藏不掉文本节点，
 * 只能清空文本再塞 `<svg>`。这里测的就是这条独立路径。
 */

const root = fileURLToPath(new URL('../', import.meta.url));

async function bundleModule(relative) {
  const result = await build({
    entryPoints: [path.join(root, relative)],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const railIcons = await bundleModule('packages/client/pages-default/src/rail-icons.js');

/** 最小节点：够页面壳管理行那一层用。 */
function node(tag, { text = '', attrs = {} } = {}) {
  return {
    tag,
    children: [],
    attributes: new Map(Object.entries(attrs)),
    dataset: {},
    parent: null,
    _text: text,
    isConnected: true,
    get textContent() {
      if (this.children.length === 0) return this._text;
      return this._text + this.children.map(child => child.textContent).join('');
    },
    set textContent(value) {
      this._text = value;
      this.children = [];
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    setAttributeNS(_ns, name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    get tagName() { return this.tag.toUpperCase(); },
    append(child) { child.parent = this; this.children.push(child); },
    remove() {
      if (this.parent === null) return;
      this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null;
    },
    querySelector(selector) { return query(this, selector)[0] ?? null; },
    querySelectorAll(selector) { return query(this, selector); },
  };
}

/** 极简选择器：只认测试用到的 `.pm-id` / `.pm-icon` / 带标记的 svg / 导轨按钮。 */
function query(rootNode, selector) {
  const out = [];
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  const wantMark = selector.includes('data-zju-rail-art');
  const walk = element => {
    for (const child of element.children) {
      const cls = child.attributes.get('class') ?? '';
      const hitsClass = classes.length > 0 && classes.every(name => cls.split(/\s+/).includes(name));
      if (hitsClass) out.push(child);
      else if (wantMark && child.attributes.has('data-zju-rail-art')) out.push(child);
      walk(child);
    }
  };
  walk(rootNode);
  return out;
}

/**
 * 造一份「页面管理页」的最小 DOM：两行内建页，`.pm-icon` 里是裸文本字形。
 *
 * @returns `{ doc, rows }`。
 */
function fakeManagerDocument() {
  const manager = node('div', { attrs: { 'data-pages-manager': '' } });
  const makeRow = (id, glyph) => {
    const li = node('li');
    const icon = node('span', { attrs: { class: 'pm-icon' }, text: glyph });
    const idNode = node('span', { attrs: { class: 'pm-id' }, text: id });
    li.append(icon);
    li.append(idNode);
    manager.append(li);
    return { li, icon };
  };
  const home = makeRow('home', '⌂');
  const pages = makeRow('pages', '▦');
  const doc = {
    documentElement: null,
    createElementNS(_ns, tag) {
      const element = node(tag);
      // createArtwork 用 children 表达 path/circle，这里保持同等形状即可
      return element;
    },
    querySelector: selector => (selector === '[data-dsh-pages-rail] button[aria-label="x"]' ? null : null),
    querySelectorAll(selector) {
      if (selector === '[data-pages-manager] li') return manager.children;
      if (selector.includes('data-zju-rail-art')) {
        const found = [];
        const walk = element => {
          for (const child of element.children) {
            if (child.attributes.has('data-zju-rail-art')) found.push(child);
            walk(child);
          }
        };
        walk(manager);
        return found;
      }
      return [];
    },
  };
  doc.documentElement = null;
  return { doc, rows: { home, pages }, manager };
}

const config = { homePage: 'home', managerPage: 'pages', homeLabel: 'DSH 工作台', managerLabel: '页面管理' };

test('the manager rows get the same vector artwork as the rail', () => {
  const { doc, rows } = fakeManagerDocument();
  const undo = railIcons.installRailIconArtwork({ config }, doc);

  for (const [key, row] of Object.entries(rows)) {
    const svg = row.icon.children.find(child => child.attributes.has('data-zju-rail-art'));
    assert.ok(svg, `${key} 行拿到了内联 svg`);
    assert.equal(svg.tag, 'svg');
    // 规格与各页面插件自己声明的图标严格一致 —— 不一致就会「两个图标比别的大一号」。
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('stroke-width'), '1.65');
    assert.equal(svg.getAttribute('width'), '19');
    assert.equal(svg.getAttribute('height'), '19');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    // 文本字形必须被清掉，否则会和 svg 叠在一起。
    assert.equal(row.icon.textContent.replace(/\s/g, ''), '', `${key} 行的原字形已清空`);
  }
  undo?.();
});

test('disposing writes the original glyphs back', () => {
  const { doc, rows } = fakeManagerDocument();
  const undo = railIcons.installRailIconArtwork({ config }, doc);
  undo?.();
  // 卸载后两行的文本节点恢复成页面壳原本的字形
  assert.equal(rows.home.icon.textContent.includes('⌂'), true, 'home 行恢复 ⌂');
  assert.equal(rows.pages.icon.textContent.includes('▦'), true, 'pages 行恢复 ▦');
});

test('a row whose id is not a built-in page is left untouched', () => {
  // 追加一行第三方页面：页面壳给它的是别的字形，不该被我们改写。
  const { doc, manager } = fakeManagerDocument();
  const foreign = node('li');
  const icon = node('span', { attrs: { class: 'pm-icon' }, text: '✦' });
  const idNode = node('span', { attrs: { class: 'pm-id' }, text: 'plugins' });
  foreign.append(icon);
  foreign.append(idNode);
  manager.append(foreign);

  const undo = railIcons.installRailIconArtwork({ config }, doc);
  assert.equal(icon.children.length, 0, '第三方行不插 svg');
  assert.equal(icon.textContent, '✦', '第三方行文本保持原样');
  undo?.();
});
