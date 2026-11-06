import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * 打成自包含 ESM 再 import：被测文件有 JSX，且要用真实 React 的 `useState`。
 *
 * 与 `pages-default-width` 的做法一致 —— 整包内联，`data:` URL 里解析不了裸模块。
 * 代价是 React 也是内联的那一份，但这里只检查元素树形状，不渲染、不碰 hook 调度。
 */
async function bundleModule(relative) {
  const result = await build({
    entryPoints: [path.join(root, relative)],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const railAction = await bundleModule('packages/client/pages-default/src/rail-action.jsx');

/** 一个记账用的假槽位服务：记录每次注册的槽名与 key。 */
function fakeSlots() {
  const registrations = [];
  return {
    registrations,
    slots: {
      inject(name, callback) { return callback(); },
      register(options, component) {
        const record = { name: options.name, key: options.key, component, disposed: false };
        const dispose = () => { record.disposed = true; };
        registrations.push(record);
        return dispose;
      },
    },
  };
}

/** 最小假文档：只需 querySelectorAll / createElement / head，够验证隐藏与还原。 */
function fakeDocument({ toggles = 1 } = {}) {
  const made = [];
  const buttons = Array.from({ length: toggles }, () => {
    const attributes = new Map();
    return {
      attributes,
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      has: name => attributes.has(name),
    };
  });
  // 本包自己的替代按钮：同样声明快捷键，但带 data-zju-rail-collapse。
  // 它**必须**不被选中 —— 否则会被自己的样式藏掉（真机踩过）。
  const own = {
    attributes: new Map([['data-zju-rail-collapse', '']]),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    has(name) { return this.attributes.has(name); },
  };
  const doc = {
    head: { append: node => { made.push(node); } },
    documentElement: {},
    createElement(tag) {
      return { tag, dataset: {}, textContent: '', remove() { made.splice(made.indexOf(this), 1); } };
    },
    querySelectorAll(selector) {
      // 被测代码的两种选择器：原生按钮（带 :not 排除本包），和本包自己打的标记。
      if (selector.includes('Control+Alt+B')) {
        return selector.includes(':not([data-zju-rail-collapse])')
          ? buttons.filter(b => !b.has('data-zju-rail-collapse'))
          : buttons;
      }
      if (selector.includes('data-zju-native-toggle')) return buttons.filter(b => b.has('data-zju-native-toggle'));
      return [];
    },
  };
  return { doc, buttons, own };
}

test('only the home page gets a registered action; every other page keeps the shell fallback', () => {
  const { slots, registrations } = fakeSlots();
  const undo = railAction.installCollapseIntoWhale({
    slots,
    pages: { config: { railActionSlot: 'page.rail-action' } },
    layout: { toggleSidebar() {} },
    doc: fakeDocument().doc,
  });

  // keyed 槽：key 就是页面 id。只登记 home 是**有意为之** —— 没登记的 key 走 fallback。
  assert.equal(registrations.length, 1, '只注册 home 一页');
  assert.equal(registrations[0].name, 'page.rail-action');
  assert.equal(registrations[0].key, 'home');
  assert.equal(typeof registrations[0].component, 'function');

  undo();
  assert.equal(registrations[0].disposed, true, '卸载时撤掉注册');
});

test('the native collapse button is marked, and the mark is removed on dispose', () => {
  const { slots } = fakeSlots();
  const { doc, buttons } = fakeDocument({ toggles: 2 });
  const undo = railAction.installCollapseIntoWhale({
    slots, pages: { config: { railActionSlot: 'page.rail-action' } },
    layout: { toggleSidebar() {} }, doc,
  });
  for (const button of buttons) assert.ok(button.has('data-zju-native-toggle'), '原生按钮被标记（样式据此隐藏）');
  undo();
  for (const button of buttons) assert.equal(button.has('data-zju-native-toggle'), false, '卸载后标记撤销，按钮回来');
});

test('our own replacement button declares the same shortcut but must never be hidden', () => {
  // 回归：替代按钮为了可访问性声明了同一个快捷键，早期用纯快捷键选择器会把它一起选中，
  // 于是它被自己的样式藏掉 —— 表现是鲸鱼消失、按钮尺寸 0，日志里没有任何线索。
  const { slots } = fakeSlots();
  const { doc, buttons, own } = fakeDocument();
  railAction.installCollapseIntoWhale({
    slots, pages: { config: { railActionSlot: 'page.rail-action' } },
    layout: { toggleSidebar() {} }, doc,
  });
  assert.equal(own.has('data-zju-native-toggle'), false, '自己的按钮不能被标记');
  for (const button of buttons) assert.ok(button.has('data-zju-native-toggle'), '原生按钮照常标记');
  // 选择器本身也要显式排除自己，而不是靠调用顺序侥幸。
  assert.match(railAction.NATIVE_TOGGLE_SELECTOR, /:not\(\[data-zju-rail-collapse\]\)/);
});

test('a misshapen slot service hides nothing, so the user never loses the collapse entry', () => {
  const { doc, buttons } = fakeDocument();
  // register 存在但 inject 不存在 —— 替身挂不上。这时**必须**把 DOM 还原，
  // 否则结果是「原生按钮被藏 + 没有替身」，折叠入口彻底消失。
  const broken = { register() { return () => {}; } };
  const undo = railAction.installCollapseIntoWhale({
    slots: broken, pages: { config: { railActionSlot: 'page.rail-action' } },
    layout: { toggleSidebar() {} }, doc,
  });
  for (const button of buttons) assert.equal(button.has('data-zju-native-toggle'), false, '没有替身就不藏原生按钮');
  assert.doesNotThrow(undo);
});

test('the registered component passes the layout service through to the page action', () => {
  const { slots, registrations } = fakeSlots();
  const layout = { toggleSidebar() {} };
  railAction.installCollapseIntoWhale({
    slots, pages: { config: { railActionSlot: 'page.rail-action' } },
    layout, doc: fakeDocument().doc,
  });
  // 组件是「包了 layout 的那一层」：调用它得到的是页面动作的元素，layout 已注入。
  const element = registrations[0].component({ railWidth: 51 });
  assert.equal(element.type.name, 'CollapseIntoWhale');
  assert.equal(element.props.layout, layout, '折叠能力由服务注入，不去点 DOM 里的原生按钮');
  assert.equal(element.props.railWidth, 51, '导轨宽度透传，图标据此跟随缩放');
});

test('the panel icon is the host\'s 16x16 outline artwork, drawn with currentColor', () => {
  const element = railAction.PanelIcon({ size: 18 });
  assert.equal(element.type, 'svg');
  assert.equal(element.props.viewBox, '0 0 16 16');
  assert.equal(element.props['aria-hidden'], 'true');
  const paths = element.props.children;
  assert.equal(paths.length, 2, '外框 + 左侧分隔线');
  for (const stroke of paths.map(path => path.props.stroke)) assert.equal(stroke, 'currentColor');
});

// —— 收起 = 整列消失 ——

/** 一个只够验证网格改写的假 frame。 */
function fakeFrame(collapsed, columns) {
  const attributes = new Map();
  if (collapsed) attributes.set('data-sidebar-collapsed', 'true');
  const style = { gridTemplateColumns: columns };
  return {
    attributes,
    style,
    getAttribute: name => attributes.get(name) ?? null,
  };
}

test('collapsing zeroes only the first grid track, leaving the other two untouched', () => {
  // 宿主写的是三段内联值；只该动第一段。硬写整条值会把右侧栏轨道算死。
  const frame = fakeFrame(true, '56px 1493px 0px');
  const doc = {
    documentElement: {},
    querySelectorAll: () => [frame],
  };
  const undo = railAction.collapseSidebarColumn(doc);
  assert.equal(frame.style.gridTemplateColumns, '0px 1493px 0px', '第一列归零，后两段逐字保留');
  undo();
  assert.equal(frame.style.gridTemplateColumns, '56px 1493px 0px', '卸载后写回宿主算出的原值');
});

test('the collapsed column override does not touch an expanded frame', () => {
  const expanded = fakeFrame(false, '280px 1269px 0px');
  const doc = { documentElement: {}, querySelectorAll: () => [expanded] };
  railAction.collapseSidebarColumn(doc);
  assert.equal(expanded.style.gridTemplateColumns, '280px 1269px 0px', '展开态一个像素都不碰');
});

test('re-expanding restores the host value even after the collapse wrote 0px', () => {
  const frame = fakeFrame(true, '56px 1493px 0px');
  const doc = { documentElement: {}, querySelectorAll: () => [frame] };
  railAction.collapseSidebarColumn(doc);
  assert.equal(frame.style.gridTemplateColumns, '0px 1493px 0px');
  // 宿主展开时会自己重算并覆盖内联样式。观察者绝不能把收起时的旧值写回去 ——
  // 那等于把展开又改回收起（早期版本真踩过）。
  frame.getAttribute = () => null;
  frame.style.gridTemplateColumns = '280px 1269px 0px';
  railAction.collapseSidebarColumn(doc);
  assert.equal(frame.style.gridTemplateColumns, '280px 1269px 0px', '展开后回到宿主值，不是 0');
});

test('the collapse never hides the sidebar column with display, which would shift every grid track', () => {
  // 回归：曾给侧栏列加 `display:none`。frame 的列是**自动放置**的，侧栏列一旦不生成
  // 盒子，中间列就左移落到第 1 列 —— 而第 1 列被压成 0px，于是整个页面跟着消失。
  // 契约：收起只能改网格轨道，不能改任何子元素的 display。
  const css = railAction.injectedCss();
  assert.ok(css.includes('data-zju-native-toggle'), '仍然隐藏原生折叠按钮');
  assert.equal(/display\s*:\s*none/i.test(css.replace(/\[data-zju-native-toggle\]\{[^}]*\}/, '')), false,
    '除了隐藏原生按钮，样式表里不能再有 display:none');
  assert.equal(css.includes(':first-child'), false, '不再按子元素序号隐藏任何列');
});

test('a frame whose grid is not three-part is left alone rather than broken', () => {
  // 宿主换形状（比如变成两段或用了别的布局原语）时，宁可留着窄轨也不能改坏布局。
  const frame = fakeFrame(true, '56px 1493px');
  const doc = { documentElement: {}, querySelectorAll: () => [frame] };
  railAction.collapseSidebarColumn(doc);
  assert.equal(frame.style.gridTemplateColumns, '56px 1493px', '形状不符就原样不动');
});
