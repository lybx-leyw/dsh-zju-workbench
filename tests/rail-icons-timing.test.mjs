import test from 'node:test';
import assert from 'node:assert/strict';

// 测「安装时机」这个真机踩过的坑：本包 apply 时导轨还不存在，之后页面壳才渲染进来。
const { installRailIconArtwork } = await import('../packages/client/pages-default/src/rail-icons.js');

function node(tag) {
  return {
    tag, children: [], attributes: new Map(), dataset: {}, parent: null, textContent: '',
    setAttribute(name, value) { this.attributes.set(name, value); },
    setAttributeNS(_ns, name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    append(child) { child.parent = this; this.children.push(child); },
    remove() {
      if (this.parent === null) return;
      this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null;
    },
    querySelector(selector) { return all(this, selector)[0] ?? null; },
    querySelectorAll(selector) { return all(this, selector); },
  };
}

/** 极小的选择器解释器：只认测试真正用到的那几种。 */
function all(root, selector) {
  const out = [];
  const roleMatch = /data-zju-rail-role="([^"]*)"/.exec(selector);
  const labelMatch = /aria-label="([^"]*)"/.exec(selector);
  const insideRail = selector.startsWith('[data-dsh-pages-rail]');
  const wantCell = selector.includes('data-dsh-pages-rail-icon');
  const wantMark = selector.includes('data-zju-rail-art');
  const walk = (element, inRail) => {
    for (const child of element.children) {
      const rail = inRail || child.attributes.has('data-dsh-pages-rail');
      // 标记优先：找到按钮后 install 会给它打 `data-zju-rail-role`，之后一律按标记定位，
      // 语言切换不再影响。标签只用于首帧识别（见 rail-icons.js 的 ROLE_ATTR 说明）。
      if (roleMatch !== null) {
        if (rail && child.attributes.get('data-zju-rail-role') === roleMatch[1]) out.push(child);
      } else if (labelMatch !== null) {
        if (rail && child.attributes.get('aria-label') === labelMatch[1]) out.push(child);
      } else if (wantMark) {
        if (child.attributes.has('data-zju-rail-art')) out.push(child);
      } else if (wantCell) {
        if (child.attributes.has('data-dsh-pages-rail-icon')) out.push(child);
      } else if (child.attributes.has('data-dsh-pages-rail')) {
        out.push(child);
      }
      walk(child, rail);
    }
  };
  walk(root, !insideRail);
  return out;
}

function documentStub() {
  const documentElement = node('html');
  const head = node('head');
  const body = node('body');
  documentElement.append(head);
  documentElement.append(body);
  const observers = [];
  const doc = {
    documentElement, head, body,
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
      },
    },
    createElement: tag => node(tag),
    createElementNS: (_ns, tag) => node(tag),
    querySelector(selector) {
      return all(documentElement, selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      if (selector.includes('data-zju-rail-art')) return all(documentElement, selector);
      return all(documentElement, selector);
    },
    trigger() { for (const observer of observers) if (!observer.disconnected) observer.callback(); },
  };
  return { doc, body, observers };
}

const pages = {
  config: { homePage: 'home', managerPage: 'pages', homeLabel: '工作台', managerLabel: '页面管理' },
};

function renderRail(body) {
  const rail = node('nav');
  rail.attributes.set('data-dsh-pages-rail', '');
  for (const label of ['工作台', '页面管理']) {
    const button = node('button');
    button.attributes.set('aria-label', label);
    const cell = node('span');
    cell.attributes.set('data-dsh-pages-rail-icon', '');
    const glyph = node('span');
    glyph.textContent = '⌂';
    cell.append(glyph);
    button.append(cell);
    rail.append(button);
  }
  body.append(rail);
  return rail;
}

test('artwork is filled in even when the rail renders after the plugin applies', () => {
  const { doc, body, observers } = documentStub();
  const undo = installRailIconArtwork(pages, doc);
  const count = () => all(doc.documentElement, '[data-zju-rail-art]').length;
  assert.equal(count(), 0, '安装时页面壳还没挂载');

  renderRail(body);
  doc.trigger();
  assert.equal(count(), 2, '导轨出现后两个格子都被填上 svg');
  assert.equal(all(doc.documentElement, '[data-dsh-pages-rail] button[aria-label="工作台"]').length, 1);

  // 页面壳重渲染（svg 被换掉）后仍补得回来
  for (const art of all(doc.documentElement, '[data-zju-rail-art]')) art.remove();
  doc.trigger();
  assert.equal(count(), 2);

  undo();
  assert.equal(count(), 0);
  assert.equal(observers.every(observer => observer.disconnected), true, '卸载时断开观察');
});

test('切换界面语言后图标不丢：定位锚点从 aria-label 换成稳定标记', () => {
  // 真机症状：英文模式下侧边栏 home 与页面管理两格**完全空白**。
  // 原因：dsh-pages 用 ctx.locale.resolveText() 实时解析 aria-label，切换语言后
  // 同一个按钮的标签变了；样式表是按 apply 那一刻的标签生成的，于是选择器失配 —
  // 原生字形已被物理移除，新图形却没被认领。
  // 修法：首次用（任一语言的）标签认出按钮，立刻打上 data-zju-rail-role=<id>，
  // 之后 CSS 与 JS 都只认标记，与语言无关。
  const { doc, body } = documentStub();
  const undo = installRailIconArtwork(pages, doc);
  renderRail(body);
  doc.trigger();

  const count = () => all(doc.documentElement, '[data-zju-rail-art]').length;
  assert.equal(count(), 2, '中文下两格都有图形');

  const buttons = all(doc.documentElement, '[data-dsh-pages-rail]');
  const rail = buttons[0];
  const labelled = () => rail.children.filter(child => child.attributes.has('aria-label'));

  // 模拟切到英文：只有 aria-label 变，DOM 结构不变
  const zhToEn = new Map([['工作台', 'DSH workbench'], ['页面管理', 'Pages']]);
  for (const button of labelled()) {
    const current = button.attributes.get('aria-label');
    if (zhToEn.has(current)) button.attributes.set('aria-label', zhToEn.get(current));
  }
  doc.trigger();
  assert.equal(count(), 2, '切到英文后图形必须仍在');

  // 再模拟页面壳整体重渲染：字形 span 回来、我们的 svg 被换掉
  for (const art of all(doc.documentElement, '[data-zju-rail-art]')) art.remove();
  for (const button of labelled()) {
    const cell = button.children.find(child => child.attributes.has('data-dsh-pages-rail-icon'));
    if (cell === undefined) continue;
    const span = node('span');
    cell.append(span);
  }
  doc.trigger();
  assert.equal(count(), 2, '英文下重渲染后仍要补回图形');

  // CSS 里不能再出现 aria-label —— 那是语言相关的锚点，用回去就复发
  const style = doc.head.children.find(child => child.dataset?.zjuRailIcons !== undefined);
  assert.ok(style !== undefined);
  assert.ok(!style.textContent.includes('aria-label'), '样式表不得以 aria-label 定位');
  assert.ok(style.textContent.includes('data-zju-rail-role="home"'), '按稳定标记定位');

  undo();
  assert.equal(count(), 0);
});
