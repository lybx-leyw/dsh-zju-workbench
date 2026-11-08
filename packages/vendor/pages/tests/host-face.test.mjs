import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostFace, HostFace } from '../src/host-face.js';

/**
 * 宿主抽象层的契约。
 *
 * # 守的是什么
 *
 * 页面通过 `host` 访问宿主 UI，而不是自己 `document.querySelector` 找宿主节点。
 * 这里守三件事：
 *
 *   1. **服务优先**：有 `layout` 服务时用服务，不读 DOM；
 *   2. **优雅回落**：服务缺席时读 DOM；连 DOM 都没有（SSR/测试）也不抛错；
 *   3. **写操作有反馈**：`openRightbar()` 之类返回布尔，页面能据此决定是否回退。
 */

/** 造一个最小的假 document（只实现被测用到的查询）。 */
function fakeDocument(nodes = {}) {
  return {
    documentElement: { getAttribute: () => null },
    querySelector: (selector) => nodes[selector] ?? null,
  };
}

/** 造一个几何为 w×h 的假元素。 */
function fakeElement(width, height, x = 10, y = 20) {
  return {
    getBoundingClientRect: () => ({ width, height, x, y, left: x, top: y, right: x + width, bottom: y + height }),
    parentElement: null,
  };
}

test('服务优先：有 layout.openRightbar 时调服务，不碰 DOM', () => {
  const calls = [];
  const host = new HostFace({
    getLayout: () => ({ openRightbar: (track, fullscreen) => calls.push([track, fullscreen]) }),
    getDocument: () => { throw new Error('不该读 DOM'); },
  });

  assert.equal(host.openRightbar({ track: true, fullscreen: false }), true);
  assert.deepEqual(calls, [[true, false]]);
});

test('openRightbar 支持全屏参数', () => {
  const calls = [];
  const host = new HostFace({
    getLayout: () => ({ openRightbar: (...args) => calls.push(args) }),
    getDocument: () => undefined,
  });

  host.openRightbar({ track: false, fullscreen: true });
  assert.deepEqual(calls, [[false, true]]);
});

test('服务缺席时写操作返回 false（页面据此回退）', () => {
  const host = new HostFace({ getLayout: () => undefined, getDocument: () => undefined });
  assert.equal(host.openRightbar(), false);
  assert.equal(host.closeRightbar(), false);
  assert.equal(host.toggleSidebar(), false);
});

test('服务抛错时返回 false，不把异常漏给页面', () => {
  const host = new HostFace({
    getLayout: () => ({ openRightbar: () => { throw new Error('宿主内部错误'); } }),
    getDocument: () => undefined,
  });
  assert.equal(host.openRightbar(), false);
});

test('rightbarOpen 读服务快照（轨道宽度 > 0）', () => {
  const host = new HostFace({
    getLayout: () => ({ panelInfo: { getSnapshot: () => ({ cols: { rightbar: 320 } }) } }),
    getDocument: () => { throw new Error('不该读 DOM'); },
  });
  assert.equal(host.rightbarOpen(), true);
});

test('rightbarOpen 服务报 0 轨道时为 false', () => {
  const host = new HostFace({
    getLayout: () => ({ panelInfo: { getSnapshot: () => ({ cols: { rightbar: 0 } }) } }),
    getDocument: () => { throw new Error('不该读 DOM'); },
  });
  assert.equal(host.rightbarOpen(), false);
});

test('rightbarOpen 服务缺席时回落到 DOM 标记', () => {
  const open = new HostFace({
    getLayout: () => undefined,
    getDocument: () => fakeDocument({
      '[data-sidebar-right-panel][data-sidebar-right-open]': fakeElement(300, 800),
    }),
  });
  assert.equal(open.rightbarOpen(), true);

  const closed = new HostFace({ getLayout: () => undefined, getDocument: () => fakeDocument({}) });
  assert.equal(closed.rightbarOpen(), false);
});

test('rightbarRect 返回面板几何；未展开时 null', () => {
  const host = new HostFace({
    getLayout: () => undefined,
    getDocument: () => fakeDocument({ '[data-sidebar-right-panel]': fakeElement(360, 900, 1080, 0) }),
  });
  const rect = host.rightbarRect();
  assert.equal(rect.width, 360);
  assert.equal(rect.height, 900);

  const collapsed = new HostFace({
    getLayout: () => undefined,
    getDocument: () => fakeDocument({ '[data-sidebar-right-panel]': fakeElement(0, 0) }),
  });
  assert.equal(collapsed.rightbarRect(), null, '零尺寸应视为未展开');
});

test('frameTracks 解析宿主 grid 轨道宽度', () => {
  // Node 没有 `getComputedStyle`（那是浏览器的），必须注入。
  // 顺带这也验证了：**没有它的环境里实现会安全返回 []**（见下一条测试）。
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ gridTemplateColumns: '280px 800px 360px' });

  try {
    const col = { parentElement: { getBoundingClientRect: () => ({ width: 1440, height: 900 }) } };
    const host = new HostFace({
      getLayout: () => undefined,
      getDocument: () => fakeDocument({ '[data-rightbar-col]': col }),
    });
    assert.deepEqual(host.frameTracks(), [280, 800, 360]);
  } finally {
    if (original === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = original;
  }
});

test('frameTracks 在没有宿主节点时返回空数组（不抛错）', () => {
  const host = new HostFace({ getLayout: () => undefined, getDocument: () => fakeDocument({}) });
  assert.deepEqual(host.frameTracks(), []);
});

test('完全没有 document（SSR）时所有读操作都不抛错', () => {
  const host = new HostFace({ getLayout: () => undefined, getDocument: () => undefined });
  assert.equal(host.rightbarOpen(), false);
  assert.equal(host.rightbarRect(), null);
  assert.deepEqual(host.frameTracks(), []);
  assert.equal(host.colorScheme(), 'light');
});

test('colorScheme 优先读根元素声明，其次系统偏好', () => {
  const declared = new HostFace({
    getLayout: () => undefined,
    getDocument: () => ({
      documentElement: { getAttribute: (name) => (name === 'data-theme' ? 'dark' : null) },
      querySelector: () => null,
    }),
  });
  assert.equal(declared.colorScheme(), 'dark');

  const fallback = new HostFace({
    getLayout: () => undefined,
    getDocument: () => ({
      documentElement: { getAttribute: () => null },
      querySelector: () => null,
    }),
  });
  // 测试环境没有 matchMedia，应安全回落到 light。
  assert.equal(fallback.colorScheme(), 'light');
});

test('createHostFace 惰性取 layout：服务后来出现也能拿到', () => {
  let layout;
  const host = createHostFace({ get: (name) => (name === 'layout' ? layout : undefined) }, { getDocument: () => undefined });

  assert.equal(host.openRightbar(), false, '服务还没到时返回 false');

  layout = { openRightbar: () => {} };
  assert.equal(host.openRightbar(), true, '服务出现后立刻可用（没有缓存 undefined）');
});

test('createHostFace 在 ctx.get 抛错时也不崩', () => {
  const host = createHostFace({ get: () => { throw new Error('inject gate'); } }, { getDocument: () => undefined });
  assert.equal(host.openRightbar(), false);
  assert.equal(host.rightbarOpen(), false);
});
