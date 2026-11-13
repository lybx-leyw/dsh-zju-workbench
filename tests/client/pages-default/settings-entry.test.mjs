import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「设置入口搬进导轨」——**我们自己的按钮**挂在 body 下，几何由 pages 服务算出。
 *
 * 这一版取代了「改原生设置区样式」的旧实现。原因（实测）：
 * 原生设置区在 `.hHd-Xa_footArea` 子树里，收起侧栏时那个容器 `opacity: 1 → 0 → 1`，
 * 设置图标就跟着淡出再淡入 —— 用户看到「先消失再出现」。`opacity` 是渲染树继承的，
 * 再 `fixed` 也没用，唯一办法是让它不再是那个容器的后代。
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function bundleModule(relative) {
  const result = await build({
    entryPoints: [path.join(root, relative)],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const entry = await bundleModule('packages/client/pages-default/src/settings-entry-style.js');
const { VARS, OWN_MARK, settingsGeometry } = entry;

/** 默认快照：51px、左侧导轨、bottom 组一项（页面管理）。 */
function snapshot(overrides = {}) {
  return {
    railWidth: 51,
    railPosition: 'left',
    activePage: 'today',
    pages: [
      { id: 'home', region: 'top' },
      { id: 'today', region: 'top' },
      { id: 'pages', region: 'bottom' },
    ],
    ...overrides,
  };
}

test('sizes follow the page shell scale formula, not hard-coded pixels', () => {
  const vars = settingsGeometry(snapshot());
  // 46 * (51/64) ≈ 36.66 → 37
  assert.equal(vars[VARS.button], '37px');
  // 23 * (51/64) ≈ 18.3 → 18
  assert.equal(vars[VARS.icon], '18px');
  // 9 * (51/64) ≈ 7.2 → 7
  assert.equal(vars[VARS.radius], '7px');
  // 横向起点 = 导轨 padding（8 * scale ≈ 6），与页面壳按钮同一条竖轴。
  assert.equal(vars[VARS.left], '6px');
});

test('a wider rail scales every value up, keeping the same proportions', () => {
  const vars = settingsGeometry(snapshot({ railWidth: 96 }));
  assert.equal(vars[VARS.button], '69px');  // 46 * 1.5
  assert.equal(vars[VARS.icon], '35px');    // 23 * 1.5 = 34.5
  assert.equal(vars[VARS.left], '12px');    // 8 * 1.5
});

test('the stroke is back-solved so every rail icon looks equally thick', () => {
  /**
   * 导轨里的图标「有的边粗有的细」的成因是 viewBox 不同：
   *
   *   页面图标：24 网格、stroke 1.65、显示 ~15.1px ⇒ 有效 ≈ 1.04
   *   我们的图标：16 网格（原生设置那枚），直接写 1.3、显示 18px ⇒ 有效 ≈ 1.46（粗 40%）
   *
   * 所以描边要按「目标有效值」反算，且**随显示尺寸变化** —— 写死像素会在别的
   * 导轨宽度下又变粗/变细。
   */
  const { TARGET_VISUAL_STROKE, strokeWidthFor } = entry;
  // 反算后，任何宽度下的有效描边都等于目标值。
  for (const width of [40, 51, 64, 96]) {
    const vars = settingsGeometry(snapshot({ railWidth: width }));
    const icon = Number.parseFloat(vars[VARS.icon]);
    const stroke = Number.parseFloat(vars[VARS.stroke]);
    const effective = stroke * icon / 16;
    assert.ok(
      Math.abs(effective - TARGET_VISUAL_STROKE) < 0.03,
      `railWidth=${width} 时有效描边应≈${TARGET_VISUAL_STROKE}，实际 ${effective.toFixed(3)}`,
    );
  }
  // 尺寸无效时不产生 NaN。
  assert.ok(Number.isFinite(strokeWidthFor(0)));
  assert.ok(Number.isFinite(strokeWidthFor(Number.NaN)));
});

test('the bottom offset is derived from how many pages share the bottom group', () => {
  const one = settingsGeometry(snapshot());
  const two = settingsGeometry(snapshot({
    pages: [{ id: 'home', region: 'top' }, { id: 'pages', region: 'bottom' }, { id: 'more', region: 'bottom' }],
  }));
  const bottomOf = vars => Number.parseInt(vars[VARS.bottom], 10);
  assert.ok(bottomOf(two) > bottomOf(one), '底部项越多，设置越靠上');
  // 差一档 = 一个按钮高 + 一个间距。
  assert.equal(bottomOf(two) - bottomOf(one), Math.round(37 + 8 * (51 / 64)));
});

test('each rail position picks its own edge instead of assuming the left rail', () => {
  assert.equal(settingsGeometry(snapshot({ railPosition: 'left' }))[VARS.left], '6px');
  assert.equal(settingsGeometry(snapshot({ railPosition: 'right' }))[VARS.right], '6px');
  assert.equal(settingsGeometry(snapshot({ railPosition: 'top' }))[VARS.top], '6px');
  assert.equal(settingsGeometry(snapshot({ railPosition: 'bottom' }))[VARS.bottom], '6px');
});

test('a snapshot without a usable rail width yields nothing rather than garbage', () => {
  assert.deepEqual(settingsGeometry(undefined), {});
  assert.deepEqual(settingsGeometry({}), {});
  assert.deepEqual(settingsGeometry({ railWidth: 0 }), {});
  assert.deepEqual(settingsGeometry({ railWidth: 3.5 }), {});
});

test('the settings entry is not transplanted while the sidebar is a drawer', () => {
  const css = entry.SETTINGS_ENTRY_CSS;
  /**
   * 手机 / 移动端插件接管侧栏时，宿主把侧栏做成**绝对定位抽屉**并给整列
   * `transform: translateX(-280px)` 做开合动画。
   *
   * `transform` 会让祖先成为 `position: fixed` 的**包含块** —— 于是搬到
   * `left: 6px` 的账号入口实际落在「相对那条 −280 浮层再左移」的位置。真机实测
   * 390×844：入口 rect 是 `[-223, 757, 37, 37]`，整个在视口左边外面。
   * 用户的原话是「设置项移到导航栏……没法很好落实到窄屏上面」。
   *
   * 抽屉态本来就有正确位置（抽屉底部），所以整段搬移必须挂 `:not(:has(drawer))`。
   */
  assert.match(css, /html:not\(:has\(\[data-sidebar-drawer\]\)\)/,
    '搬移规则要以「不存在抽屉 frame」为前缀');

  // 每一条碰位置的规则都要带这个前缀。少了任何一条，抽屉态都会留下半对齐的痕迹。
  const positioningSelectors = [
    '.hHd-Xa_settingsArea{',
    '.hHd-Xa_settingsArea .yHnPSG_trigger{',
    '.hHd-Xa_settingsArea .yHnPSG_avatar{',
    '.hHd-Xa_settingsArea .yHnPSG_label{',
  ];
  for (const selector of positioningSelectors) {
    const at = css.indexOf(selector);
    assert.ok(at > 0, `样式表里应有 ${selector}`);
    const before = css.slice(Math.max(0, at - 60), at);
    assert.match(before, /html:not\(:has\(\[data-sidebar-drawer\]\)\) ?$/,
      `${selector} 必须被抽屉条件排除，否则抽屉态会按常驻列摆`);
  }
});

test('the native entry is repositioned by variables, never hidden with display:none', () => {
  const css = entry.SETTINGS_ENTRY_CSS;
  /**
   * 这一版**保留原生入口并给它定位**，不再自绘替代品。
   *
   * 为什么不能 `display:none`（真机踩过）：原生设置菜单锚在触发器的
   * `getBoundingClientRect()` 上。藏掉它，rect 变成 (0,0,0,0)，菜单就弹到
   * 视口左上角。为什么不自绘（用户报过）：自绘按钮里只能放一张写死的人形 SVG，
   * 永远拿不到登录后的真实头像与昵称。
   *
   * 所以现在钉的是「原生区被移动」而不是「被藏掉」：
   *   - 容器选择器带 position:fixed 与四条变量定位；
   *   - 容器规则里**不出现** display:none。
   */
  const areaRule = css.slice(css.indexOf('.hHd-Xa_settingsArea{'), css.indexOf('}', css.indexOf('.hHd-Xa_settingsArea{')) + 1);
  assert.match(areaRule, /position:fixed/, '原生设置区要脱离文档流，才能钉到导轨底部');
  assert.match(areaRule, /left:var\(--zju-settings-left/, '左侧导轨用 --zju-settings-left 定位');
  assert.match(areaRule, /bottom:var\(--zju-settings-bottom/, '纵向位置走 --zju-settings-bottom');
  assert.doesNotMatch(areaRule, /display:\s*none/, '原生入口不能 display:none —— 菜单会失去锚点跑到左上角');
});

test('the settings entry no longer draws its own button', () => {
  const css = entry.SETTINGS_ENTRY_CSS;
  // 自绘按钮已撤销：内容（真实头像 / 昵称 / 菜单）归宿主，我们只做定位与尺寸。
  // 唯一保留的 `[OWN_MARK]` 规则是 `display:none` —— 那是清理**上一版热更新**
  // 遗留在 DOM 里的自绘节点，不是给自己画一个新按钮。
  const ownRule = css.slice(css.indexOf(`[${OWN_MARK}]`), css.indexOf('}', css.indexOf(`[${OWN_MARK}]`)) + 1);
  assert.match(ownRule, /display:\s*none/, '留下的自有标记只用于隐藏旧版残留节点');
  assert.doesNotMatch(ownRule, /position:\s*fixed/, '不应再给自有按钮做定位');

  const { doc } = fakeDocument();
  const undo = entry.installSettingsRailEntry({ pages: fakePages(), doc });
  assert.equal(doc.body.children.length, 0, '不往 body 挂自绘按钮');
  undo();
});

test('the shell-owned "more pages" icon is rescaled by CSS, not by patching dsh-pages', () => {
  const css = entry.SETTINGS_ENTRY_CSS;
  /**
   * 「更多页面」是**页面壳自己的**按钮，图标内部写死 width="23"，普通页面图标写的是 16，
   * 于是同一个缩放容器里它渲染成 18.3px、别的 15.1px（大 21%）。
   *
   * dsh-pages 是锁版本的上游依赖，不动它 —— 用纯 CSS 按比例缩：
   * 实测 15.1 / 18.3 ≈ 0.82，缩放后两者都是 ~15.1px。
   */
  assert.match(css, /button\[data-dsh-pages-more\] svg\{[^}]*transform:scale\(0\.82\)/);
  assert.match(css, /button\[data-dsh-pages-more\] svg\{[^}]*transform-origin:center/);
  // 选择器必须锚在页面壳的稳定数据属性上，而不是哈希类名。
  assert.equal(/data-dsh-pages-more/.test(css), true);
});

test('the native trigger keeps a real rect so the menu can anchor to it', () => {
  /**
   * 「闪一帧」曾经用「挂到 body 的自绘按钮」解决，现在换成**让原生触发器
   * 自己不动**：它还在原容器里，只是被定位到导轨底部。副作用是它的
   * `getBoundingClientRect()` 仍然是真实尺寸 —— 菜单锚点因此天然正确。
   *
   * 所以这条钉的是「原生触发器被保留并铺满容器」，而不是「挂了个新按钮」。
   */
  const css = entry.SETTINGS_ENTRY_CSS;
  assert.match(css, new RegExp(`[.]yHnPSG_trigger\\{[^}]*width:100%`), '原生触发器要铺满容器');
  assert.match(css, new RegExp(`[.]yHnPSG_trigger\\{[^}]*height:100%`), '原生触发器要铺满容器');
  assert.match(css, new RegExp(`[.]yHnPSG_avatar`), '头像仍由原生节点渲染（登录后是真头像）');

  const { doc } = fakeDocument();
  const undo = entry.installSettingsRailEntry({ pages: fakePages(), doc });
  assert.equal(doc.styles.length, 1, '只注入一份样式表');
  undo();
  assert.equal(doc.styles.length, 0, '卸载后样式移除');
});

/** 极简假文档：够验证样式注入、变量写入、按钮挂载与移除。 */
function fakeDocument() {
  const styles = [];
  const vars = new Map();
  const bodyChildren = [];
  const makeEl = (tag) => {
    const el = {
      tag, dataset: {}, textContent: '', attributes: {}, children: [], parent: null,
      style: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
      append(child) { child.parent = this; this.children.push(child); },
      remove() {
        const idx = styles.indexOf(this);
        if (idx >= 0) styles.splice(idx, 1);
        const j = bodyChildren.indexOf(this);
        if (j >= 0) { bodyChildren.splice(j, 1); this.parent = null; }
      },
      addEventListener() {},
      click() {},
    };
    return el;
  };
  const body = makeEl('body');
  Object.defineProperty(body, 'children', { get: () => bodyChildren });
  const doc = {
    styles, vars, body,
    head: { append: node => { node.parent = null; styles.push(node); } },
    createElement: tag => makeEl(tag),
    createElementNS: (_ns, tag) => makeEl(tag),
    documentElement: {
      style: {
        setProperty: (name, value) => vars.set(name, value),
        getPropertyValue: name => vars.get(name) ?? '',
        removeProperty: name => vars.delete(name),
      },
    },
    querySelectorAll(selector) {
      if (selector.includes('data-zju-settings-entry')) return [...styles];
      if (selector.includes(OWN_MARK)) return [...bodyChildren];
      return [];
    },
    querySelector() { return null; },
  };
  return { doc, body };
}

/** 记账用的假 pages 服务。 */
function fakePages(initial = snapshot()) {
  let current = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(next) { current = next; for (const listener of [...listeners]) listener(); },
    listenerCount: () => listeners.size,
  };
}

test('installing follows the pages service, so later changes propagate without re-install', () => {
  const { doc } = fakeDocument();
  const pages = fakePages();
  const undo = entry.installSettingsRailEntry({ pages, doc });

  assert.equal(doc.vars.get(VARS.button), '37px', '首次写入按当前快照');
  // 服务发通知（用户在页面管理里拖宽导轨）：变量随之更新，无需重装。
  pages.publish(snapshot({ railWidth: 80 }));
  assert.equal(doc.vars.get(VARS.button), '58px'); // 46 * (80/64) = 57.5
  // 底部多一页：设置要跟着上移。
  const before = Number.parseInt(doc.vars.get(VARS.bottom), 10);
  pages.publish(snapshot({
    railWidth: 80,
    pages: [{ id: 'pages', region: 'bottom' }, { id: 'more', region: 'bottom' }],
  }));
  assert.ok(Number.parseInt(doc.vars.get(VARS.bottom), 10) > before, '新增底部项后设置上移');

  undo();
  assert.equal(doc.styles.length, 0, '卸载后样式还原');
  assert.equal(pages.listenerCount(), 0, '卸载后不再订阅服务');
});

test('installing is idempotent', () => {
  const { doc } = fakeDocument();
  const pages = fakePages();
  const undo = entry.installSettingsRailEntry({ pages, doc });
  entry.installSettingsRailEntry({ pages, doc });
  assert.equal(doc.styles.length, 1, '重复安装只保留一份样式表');
  assert.equal(doc.body.children.length, 0, '本版不挂自绘按钮，body 下应始终为空');
  undo();
});

test('a missing pages service degrades to the stylesheet and button alone', () => {
  const { doc } = fakeDocument();
  assert.doesNotThrow(() => {
    const undo = entry.installSettingsRailEntry({ doc });
    undo();
  });
  assert.doesNotThrow(() => entry.installSettingsRailEntry(undefined));
  assert.doesNotThrow(() => entry.installSettingsRailEntry({}));
});

