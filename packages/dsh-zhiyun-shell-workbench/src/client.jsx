import React from 'react';
import { Sidebar, Page, NativeSettingsHost } from './components.jsx';
import { NAV, hiddenPageIds, pageSlot } from './model.js';
import { adaptSettingsSurface } from './settings-adapter.js';
import { createSettingsOpener } from './settings-opener.js';
import { createLearningSpaceBinding } from './learning-binding.js';
import css from './style.css';

export const name = 'zhiyun-shell-client';
/**
 * `remote` 写进 inject 是必需的，也是安全的。
 *
 * 必需：`ctx.remote` 上的命名空间是**注入门禁**的 —— 没声明就访问 `remote.pluginManager`
 * 会抛 `cannot get property "remote.pluginManager" without inject`（真机踩到过）。
 *
 * 安全：`remote` 与 `pluginManager` 都由 `dsh-api-remotes` 无条件挂载（同一份 `apply` 里
 * 一起 mount），而它在 dsh-web-app 里；所以「有 remote」与「有 pluginManager」是同一件事，
 * 不会多出连坐面。真正要防的是**读不到就降级**，那由 hiddenPageIds 的空集语义负责。
 */
export const inject = ['slots', 'layout', 'theme', 'uiWorkspace', 'workspaces', 'sessions', 'remote', 'zhiyunWorkbench'];
export function apply(ctx) {
  try { return applyUI(ctx); }
  catch (error) { console.error('zhiyun UI activation:', error); throw error; }
}
function applyUI(ctx) {
  const workbench = ctx.zhiyunWorkbench;
  /**
   * 哪些页的包被取消了。
   *
   * 外壳**不**把 `remote.pluginManager` 写进 `inject`：那会让「宿主没装插件管理」时整个
   * 外壳一起 pending，连导航都没有（本仓 README 反复警告的那种连坐）。所以这里惰性取，
   * 取不到就是空集 —— 空集 = 一页都不藏，侧栏照常。
   */
  const hidden = createHiddenPages(ctx);
  /**
   * 账号面板（点导轨头像浮出来的那一层）的开合。
   *
   * 它挂在**壳的导航控制器**上，而不是某个页面里：打开它的入口有三个来源 ——
   * 导轨头像、以及「今天」「我的课」「学习」三页的登录按钮。那三页已经拿到了壳的
   * `controller`（页面契约里的 owner props），所以把它们的方法加在这里，
   * 比新造一个服务、要求每个包去 inject 便宜得多，也不会多出一条连坐依赖。
   */
  const account = createToggleStore();
  // binding 必须先于 controller 建立：controller.navigate 立刻就会用到它，
  // 而别的插件在自己的 apply 里调 zhiyunNavigation.navigate 也可能早于下面几行执行。
  const binding = createLearningSpaceBinding(ctx, () => workbench.getSnapshot().activePage === 'ask');
  // 设置 = 宿主原生浮窗。只把它的 store 动作接到壳上，导轨按钮与账号菜单共用这一入口。
  const settings = createSettingsOpener();
  const controller = {
    navigate(id) {
      if (!NAV.some(item => item.id === id)) throw new Error(`Unknown Zhiyun page: ${id}`);
      workbench.selectPage(id);
      // 外层页面切换不修改 DSH 内层的面板选择。
      if (id === 'ask') binding.enter();
      else binding.reset();
    },
    toggleSidebar: () => ctx.layout.toggleSidebar(),
    toggleTheme: () => ctx.theme.setTheme(ctx.theme.getTheme().active.colorScheme === 'dark' ? 'light' : 'dark'),
    /** 打开原生设置浮窗。宿主未提供设置面时明确报错，不静默无响应。 */
    openSettings: () => { if (!settings.open()) console.error('zhiyun: native settings surface is unavailable'); },
    /** 打开/关闭账号面板。页面里的登录入口调它（见 createToggleStore 的说明）。 */
    openAccount: () => account.open(),
    closeAccount: () => account.close(),
  };
  ctx.effect(() => () => hidden.dispose(), 'zhiyun: hidden pages store');
  // 正停在的那一页被取消了：回「今天」，别把用户留在一个已经没有入口的页上。
  ctx.effect(() => hidden.subscribe(() => {
    const gone = hidden.getSnapshot();
    if (gone.size === 0) return;
    const page = workbench.getSnapshot().activePage;
    if (page !== null && gone.has(page)) controller.navigate('today');
  }), 'zhiyun: leave a cancelled page');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.zhiyunStyle = 'true';
    style.textContent = css;
    document.head.append(style);
    const previous = document.body.getAttribute('data-zhiyun');
    document.body.setAttribute('data-zhiyun', 'true');
    return () => {
      style.remove();
      if (previous === null) document.body.removeAttribute('data-zhiyun');
      else document.body.setAttribute('data-zhiyun', previous);
    };
  }, 'zhiyun: owned styles');
  ctx.effect(() => ctx.reflect.provide('zhiyunNavigation', controller), 'zhiyun: navigation service');
  ctx.effect(() => ctx.theme.overrideTokens('dsh-zhiyun-shell-workbench', {
    '--dsw-alias-bg-base': { light: '#f7f7f5', dark: '#191c20' },
    '--dsw-alias-label-primary': { light: '#252a30', dark: '#e8ebee' },
    '--dsw-alias-label-secondary': { light: '#666b72', dark: '#afb6bf' },
    '--dsw-alias-button-info-fill': { light: '#00479d', dark: '#245fa9' },
    '--dsw-alias-button-info-hover': { light: '#003b83', dark: '#2b70c3' },
  }), 'zhiyun: reversible native theme layer');
  ctx.slots.inject('zhiyun.shell.navigation', () => ctx.slots.register({
    name: 'zhiyun.shell.navigation',
    children: { 'sidebar.account.signin': { kind: 'single', scope: 'root' } },
    inject: () => ({ controller, hidden, account, collapsed: true }),
  }, Sidebar));
  // 设置 = 宿主原生浮窗。这里只把它的 store 动作接到壳上：
  // 导轨「设置」按钮与账号菜单调同一个入口，不再跳「个人」页。
  ctx.effect(() => adaptSettingsSurface(ctx.slots, NativeSettings =>
    props => <NativeSettingsHost {...props} NativeSettings={NativeSettings} onActions={settings.attach}/>
  ), 'zhiyun: native settings surface');
  // Native sidebar, workspace browser, header and plugin panels stay inside ask.
  ctx.slots.inject('zhiyun.shell.page', function* () {
    // 产品页面面板都照常注册，**不**因为「某一页被取消」而撤掉注册：
    // 撤注册要在远程事件回来的异步时点调 `ctx.slots.register`，那时 shell 自己的 fiber
    // 未必还在有效的 effect 作用域里（会撞 INACTIVE_EFFECT），时序很难守。
    // 取消的效果落在**呈现**上（侧栏与跳转不列它），见 components.jsx 的 Sidebar/SearchDialog。
    for (const page of NAV.filter(item => item.id !== 'ask')) {
      yield ctx.slots.register({
        name: 'zhiyun.shell.page', key: page.id,
        // 内容插槽名从 NAV 取（`pageSlot`）：「课堂」的两页注册的是
        // `zhiyun.classroom.play` / `zhiyun.classroom.build`，不跟 id 推导。
        children: { [pageSlot(page)]: { kind: 'single', scope: 'root' } },
        inject: () => ({ controller, page: page.id }),
      }, Page);
    }
    // Startup selects Today only after all pages have been registered.
    controller.navigate('today');
  });
}

/**
 * 一个极小的开合 store（uSES 口径：`subscribe` + `getSnapshot`）。
 *
 * 目前只有账号面板用它。写成通用的小工厂而不是内联一个布尔量，是因为
 * 组件侧要用 `useSyncExternalStore` 订阅它 —— 而那个 hook 要求
 * `getSnapshot` 返回**稳定值**（每次渲染都新建对象会死循环），所以状态必须
 * 存在闭包里、由 store 自己发通知，不能在渲染路径上现算。
 *
 * @returns `{ subscribe, getSnapshot, open, close }`。
 */
function createToggleStore() {
  let open = false;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => open,
    open() { if (!open) { open = true; emit(); } },
    close() { if (open) { open = false; emit(); } },
  };
}

/**
 * 哪些页的包被取消了（侧栏与跳转都不列它们）。
 *
 * 读的是宿主插件管理的**行级**启用状态 —— 与「插件」页读的是同一份真值，所以那边一勾，
 * 这边立刻跟着变。**惰性取服务**：`remote` 拿不到（宿主没装插件管理）或读数失败时一律
 * 当作「一页都不藏」，侧栏照常可用。外壳绝不能因为这个可选能力缺席而挂掉。
 * @param ctx - 客户端插件上下文。
 * @returns `{ subscribe, getSnapshot, refresh, dispose }`（`getSnapshot` 是 uSES 口径）。
 */
function createHiddenPages(ctx) {
  const EMPTY = new Set();
  let snapshot = EMPTY;
  const listeners = new Set();
  let inflight = null;
  let disposed = false;
  const publish = (next) => {
    // 引用要稳定：内容没变就不re-publish，否则 uSES 会当成一直变。
    if (next.size === snapshot.size && [...next].every(id => snapshot.has(id))) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const refresh = () => {
    if (disposed) return Promise.resolve();
    inflight ??= (async () => {
      try {
        // `ctx.get` 而不是 `ctx.remote.pluginManager`：这是拓扑无关的查找，
        // 万一某个部署没挂这个命名空间，也只是取不到、退回空集，不会抛。
        const pluginManager = ctx.get('remote.pluginManager');
        if (pluginManager === undefined) return publish(EMPTY);
        const answer = await pluginManager.listPlugins();
        if (disposed || !answer?.ok) return;
        const enabled = new Map();
        for (const plugin of answer.value ?? []) {
          if (typeof plugin?.moduleName === 'string') enabled.set(plugin.moduleName, plugin.enabled === true);
        }
        publish(hiddenPageIds(enabled));
      } catch (error) {
        // 读数失败不是这一页的错：保持上一次的结论（或空集），不把导航弄没。
        console.error('zhiyun: reading plugin enablement failed', error);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  // 宿主说「装了什么、开了什么」变了就重读。
  ctx.effect(() => {
    const remote = ctx.get('remote');
    const off = remote?.$on?.('plugin-manager/changed', () => { void refresh(); });
    return () => { if (typeof off === 'function') off(); };
  }, 'zhiyun: hidden pages invalidation');
  void refresh();
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    refresh,
    dispose() { disposed = true; listeners.clear(); },
  };
}
