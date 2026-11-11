/**
 * 页面侧栏契约：**页面**把自己的「收起 / 展开」交给产品层，产品层把它挂进导轨顶部那只鲸鱼。
 *
 * # 要解决的问题
 *
 * home 页左上角那只鲸鱼点一下就收起原生侧栏；其他带侧栏的页面（论文 / 笔记 / 文档 /
 * 学习）的侧栏却是页面自己管的，收起按钮长在页面里面、各页形状都不一样。用户看到的
 * 是「同一个位置，home 能点、别的页不能点」。
 *
 * 修法不能是「产品层去认每一页的内部状态」—— 那会让 `pages-default` 认识 `page-paper`，
 * 违反本仓的**页面之间互不相识**（见 `tests/repo/page-isolation.test.mjs`）。也不能反过来
 * 让页面去改导轨：导轨属于页面壳，页面只该声明「我这页有侧栏、怎么开关」。
 *
 * 所以这里是一条**单向契约**：
 *
 *   - 页面在自己组件里 `useRegisterPageSidebar('notes', { expanded, toggle })`；
 *   - 产品层用 `usePageSidebar('notes')` 拿到它，把动作挂进鲸鱼；
 *   - 页面没注册（没有侧栏，或者这一页没装）时，产品层渲染壳原本的纯鲸鱼，
 *     与今天完全一致 —— **不注册就是默认路径**。
 *
 * # 为什么按 pageId 注册，而不是「当前页是谁」
 *
 * 页面壳的导轨动作槽是 keyed 的（key 就是页面 id），拿到的是 `pageId`。按 id 注册
 * 与它天然对齐，也不需要页面知道「我现在是不是活动页」—— 切换页面时页面壳会卸载
 * 旧页、挂载新页，注册随组件生命周期自然来去。
 *
 * # 为什么用一个模块级表而不是 Cordis 服务
 *
 * 它没有宿主侧行为、不需要跨进程、也不需要在这个包之外被注入：注册方与取用方都是
 * 浏览器里的 React 组件，且同一页只挂载一次。再走一遍服务注册只是把同样的表搬到
 * `ctx` 上，还要处理 pending / inject 的时序。`useSyncExternalStore` 已经能保证
 * 「后来注册 → 导轨立刻可点」。
 *
 * @module
 */

/** pageId → 该页的侧栏控制 `{ expanded, toggle, label }`。 */
const controls = new Map();

/** pageId → 订阅者集合。 */
const listeners = new Map();

/**
 * 判断两份控制是否等价。
 *
 * 等价时不派发通知：`useRegisterPageSidebar` 每次渲染都会重跑，而导轨那一格是
 * 页面壳的内联样式子树 —— 每渲染一次就让它重渲染一次没有意义，还会让按钮的
 * 悬停态在页面无关键重渲染时闪一下。
 *
 * @param a - 旧控制。
 * @param b - 新控制。
 * @returns 是否等价。
 */
function same(a, b) {
  return a !== undefined && b !== undefined
    && a.expanded === b.expanded && a.toggle === b.toggle && a.label === b.label;
}

/**
 * 页面注册自己的侧栏控制。
 *
 * @param pageId - 页面 id（与 `page.content` / `page.rail-action` 的 key 一致）。
 * @param control - `{ expanded, toggle, label? }`；`toggle()` 收起或展开该页侧栏。
 * @returns 撤销函数（幂等）。页面卸载时调用它，产品层随之回到纯鲸鱼。
 */
export function registerPageSidebar(pageId, control) {
  if (typeof pageId !== 'string' || pageId === '') {
    throw new Error('registerPageSidebar: pageId 必须是非空字符串');
  }
  if (control === null || typeof control !== 'object' || typeof control.toggle !== 'function') {
    throw new Error(`registerPageSidebar: ${pageId} 的 control 必须带 toggle()`);
  }
  if (!same(controls.get(pageId), control)) {
    controls.set(pageId, control);
    notify(pageId);
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // 只撤自己那一份：页面重挂载时新注册已经就位，旧 disposer 不该把它抹掉。
    if (controls.get(pageId) !== control) return;
    controls.delete(pageId);
    notify(pageId);
  };
}

/**
 * 取某页已注册的侧栏控制。
 *
 * @param pageId - 页面 id。
 * @returns 控制对象，或 undefined（该页没有侧栏 / 尚未挂载）。
 */
export function getPageSidebar(pageId) {
  return controls.get(pageId);
}

/**
 * 订阅某一页的侧栏控制变化（注册 / 撤销 / 展开态）。
 *
 * @param pageId - 页面 id。
 * @param listener - 变化回调。
 * @returns 退订函数。
 */
export function subscribePageSidebar(pageId, listener) {
  let set = listeners.get(pageId);
  if (set === undefined) { set = new Set(); listeners.set(pageId, set); }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(pageId);
  };
}

/**
 * 通知某一页的订阅者。
 *
 * 逐个 `try`：一个订阅者抛错不该让其余订阅者收不到通知 —— 页面壳在渲染期订阅，
 * 抛错会把整格导轨做掉。
 *
 * @param pageId - 页面 id。
 */
function notify(pageId) {
  for (const listener of [...(listeners.get(pageId) ?? [])]) {
    try { listener(); } catch { /* 单个订阅者失败不影响其他订阅者 */ }
  }
}

/** 测试用：清空注册表（模块级状态跨用例存活）。 */
export function resetPageSidebars() {
  for (const pageId of [...controls.keys()]) {
    controls.delete(pageId);
    notify(pageId);
  }
  listeners.clear();
}
