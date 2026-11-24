import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

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
    // ⚠️ `@lybx-leyw/dsh-zju-ui-shared` 在这个包里是 external（运行时由客户端的模块表
    // 提供），而它的 `main` 是**宿主半边** `src/index.js` —— 只有 `apply()`，没有 React
    // 组件。直接打进来会得到 `No matching export … usePageSidebar`。
    //
    // 用桩替掉它：这里要验的是「按 pageId 取页面侧栏登记」这一层，注册表本身有
    // `tests/client/ui-shared/page-sidebar.test.mjs` 单独覆盖。
    plugins: [{
      name: 'ui-shared-stub',
      setup(builder) {
        builder.onResolve({ filter: /^@lybx-leyw\/dsh-zju-ui-shared$/ }, () => ({ path: 'ui-shared', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: [
            'const controls = new Map();',
            'export function usePageSidebar(pageId) { return controls.get(pageId); }',
            'export function __set(pageId, control) { controls.set(pageId, control); }',
          ].join('\n'),
          loader: 'js',
        }));
      },
    }],
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

/**
 * 一个够用的假页面服务：只有快照与订阅，形状照抄 `ctx.pages`。
 *
 * 快照形状必须是 `{ pages: [{ id }] }` —— 产品层据此决定给哪几页挂动作，
 * 与页面壳真实的 `state.js` 一致（`pages: Object.freeze([...])`）。
 */
function fakePages(ids) {
  const entries = ids.map(id => ({ id }));
  const listeners = new Set();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  return {
    config: { railActionSlot: 'page.rail-action', homePage: 'home' },
    getSnapshot: () => ({ pages: entries.map(entry => ({ ...entry })) }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    add(id) { entries.push({ id }); publish(); },
    remove(id) {
      const at = entries.findIndex(entry => entry.id === id);
      if (at !== -1) entries.splice(at, 1);
      publish();
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

test('every page in the snapshot gets a registered action, not just home', () => {
  // 这里曾经断言「只注册 home」，那是有意为之的旧口径。现在用户要求同样的位置
  // 在**每个**带侧栏的页面都能用，于是注册面跟着页面快照走。
  const { slots, registrations } = fakeSlots();
  const pages = fakePages(['home', 'paper', 'notes', 'docs', 'study']);
  const undo = railAction.installCollapseIntoWhale({
    slots, pages, layout: { toggleSidebar() {} }, doc: fakeDocument().doc,
  });

  assert.deepEqual(registrations.map(record => record.key), ['home', 'paper', 'notes', 'docs', 'study'],
    '快照里有几页就注册几页（keyed 槽只认精确 key）');
  for (const record of registrations) {
    assert.equal(record.name, 'page.rail-action');
    assert.equal(typeof record.component, 'function');
  }

  undo();
  for (const record of registrations) assert.equal(record.disposed, true, '卸载时撤掉全部注册');
});

test('a page that lands later is registered without re-registering the others', () => {
  // 插件按需装载：页面可能比导轨晚到。整批推倒重挂会让已经在那一格上的按钮
  // 闪一下并丢掉悬停态，所以按差集增量挂。
  const { slots, registrations } = fakeSlots();
  const pages = fakePages(['home', 'notes']);
  railAction.installCollapseIntoWhale({
    slots, pages, layout: { toggleSidebar() {} }, doc: fakeDocument().doc,
  });
  assert.equal(registrations.length, 2);

  pages.add('paper');
  assert.equal(registrations.length, 3, '新页面补挂一条');
  assert.deepEqual(registrations.map(record => record.disposed), [false, false, false], '旧的两条没有被推倒重来');

  pages.remove('notes');
  assert.equal(registrations[1].disposed, true, '回收的页面撤掉自己的那一条');
  assert.equal(registrations[0].disposed, false, 'home 不受影响');
});

test('home collapses the native sidebar; every other page gets the page-sidebar form', () => {
  const { slots, registrations } = fakeSlots();
  const layout = { toggleSidebar() {} };
  railAction.installCollapseIntoWhale({
    slots, pages: fakePages(['home', 'notes']), layout, doc: fakeDocument().doc,
  });
  const [home, notes] = registrations.map(record => record.component({ railWidth: 51 }));
  assert.equal(home.type.name, 'CollapseIntoWhale', 'home 仍是原生侧栏那条路径');
  assert.equal(notes.type.name, 'PageSidebarAction', '其他页走页面自己的侧栏');
  assert.equal(notes.props.pageId, 'notes', '页面 id 由 keyed 槽的 key 决定，不需要再猜');
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
