/**
 * 首页口号替换：只换那一处文本节点，版式与原生字典都不动。
 *
 * 为什么值得测：这条改动很容易写成「把整段 hero 重画」，那会立刻破坏字号、间距与
 * 响应式；也很容易写成「只扫一次」，于是在切工作区后英雄区重新挂载时失效。
 * 两个退化都不会报错，只会静默变回原文。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_COPY, applyHeroCopy, heroCopyFor } from '../packages/dsh-zhiyun-shell-bridge/src/hero-copy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(path.join(root, 'packages/dsh-zhiyun-shell-bridge/src/hero-copy.js'), 'utf8');

test('hero copy maps only the Chinese slogan and keeps native English', () => {
  assert.equal(heroCopyFor('探索未至之境'), '海纳江河，启真厚德');
  assert.equal(heroCopyFor('Into the Unknown'), undefined, '英文界面保持原生文案');
  assert.equal(heroCopyFor('别处的探索未至之境'), undefined, '只认完全相等的文本');
  assert.deepEqual(Object.keys(HERO_COPY), ['探索未至之境']);
});

test('applyHeroCopy rewrites the text node only, and restores it', () => {
  const doc = fakeDocument([
    span('探索未至之境', { class: 'headline' }),
    span('正文里提到探索未至之境但不是那一处'),
    span('探索未至之境', { nested: true }),
  ]);
  const restore = applyHeroCopy(doc);
  const [headline, prose, nested] = doc.spans;
  assert.equal(headline.textContent, '海纳江河，启真厚德');
  assert.equal(headline.attributes['data-zy-hero-copy'], '');
  assert.equal(headline.attributes.class, 'headline', '版式相关属性原样保留');
  assert.equal(prose.textContent, '正文里提到探索未至之境但不是那一处', '正文不受影响');
  assert.equal(nested.textContent, '探索未至之境', '有子元素的节点不替换');
  restore();
  assert.equal(headline.textContent, '探索未至之境', '卸载后还原原文');
  assert.equal(headline.attributes['data-zy-hero-copy'], undefined);
});

test('replacement is idempotent: re-scanning never flips the copy back', () => {
  const doc = fakeDocument([span('探索未至之境')]);
  const first = applyHeroCopy(doc);
  const second = applyHeroCopy(doc);
  assert.equal(doc.spans[0].textContent, '海纳江河，启真厚德');
  second();
  assert.equal(doc.spans[0].textContent, '海纳江河，启真厚德', '第二次的还原不应回滚第一次的替换');
  first();
  assert.equal(doc.spans[0].textContent, '探索未至之境');
});

test('nodes inside our own rail are never touched', () => {
  const node = span('探索未至之境');
  node.closest = selector => (selector === '[data-dsh-pages-shell]' ? {} : null);
  const doc = fakeDocument([node]);
  applyHeroCopy(doc);
  assert.equal(node.textContent, '探索未至之境');
});

test('the replacement is not a re-rendered hero and does not touch locale', () => {
  // 重新声明一份 locale 字典会与原生 `conversation` 命名空间冲突（重复注册直接抛错），
  // 重画组件则会丢掉原生版式。这条守卫钉住「只改文本」的实现选择。
  // 只看代码、不看注释：注释里正解释为什么不这么做。
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /locale\.register/);
  assert.doesNotMatch(code, /renderSlot|createRoot|createPortal/);
  assert.match(code, /textContent\s*=/);
});

/** 最小 DOM 替身：够 `applyHeroCopy` 用，不引入 jsdom。 */
function fakeDocument(spans) {
  return {
    spans,
    querySelectorAll(selector) {
      if (selector !== 'span') throw new Error(`unexpected selector ${selector}`);
      return spans;
    },
  };
}

function span(text, { class: className, nested = false } = {}) {
  const attributes = {};
  if (className) attributes.class = className;
  return {
    nodeType: 1,
    tagName: 'SPAN',
    attributes,
    textContent: text,
    get childElementCount() { return nested ? 1 : 0; },
    hasAttribute: name => Object.hasOwn(attributes, name),
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    closest: () => null,
  };
}
