import React from 'react';
import { Sidebar, Page, AskChrome, AskMenuButton, PersonalSettingsBridge } from './components.jsx';
import { NAV, activePage, hiddenPageIds, pageBundle, panelKey, visiblePages } from './model.js';
import { adaptSettingsSurface } from './settings-adapter.js';
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
export const inject = ['slots', 'layout', 'theme', 'uiWorkspace', 'workspaces', 'sessions', 'remote'];
export function apply(ctx) {
  try { return applyUI(ctx); }
  catch (error) { console.error('zhiyun UI activation:', error); throw error; }
}
function applyUI(ctx) {
  /** 当前选中的产品页；「问一问」是唯一需要自动绑工作区的那一页。 */
  let active = 'today';
  const drawer = createSessionDrawer();
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
  const binding = createLearningSpaceBinding(ctx, () => active === 'ask', drawer);
  const controller = {
    navigate(id) {
      if (!NAV.some(item => item.id === id)) throw new Error(`Unknown Zhiyun page: ${id}`);
      active = id;
      // 抽屉属于问一问：离开这一页就交还右侧轨道。
      if (id !== 'ask') {
        drawer.close();
        binding.reset();
      }
      ctx.layout.selectPanel(id === 'ask' ? null : panelKey(id));
      if (id === 'ask') {
        drawer.releaseEmptySession();
        binding.attempt();
      }
    },
    toggleSidebar: () => ctx.layout.toggleSidebar(),
    toggleTheme: () => ctx.theme.setTheme(ctx.theme.getTheme().active.colorScheme === 'dark' ? 'light' : 'dark'),
    /** 打开/关闭账号面板。页面里的登录入口调它（见 createToggleStore 的说明）。 */
    openAccount: () => account.open(),
    closeAccount: () => account.close(),
  };
  ctx.effect(() => drawer.close, 'zhiyun: sessions drawer');
  ctx.effect(() => () => hidden.dispose(), 'zhiyun: hidden pages store');
  // 正停在的那一页被取消了：回「今天」，别把用户留在一个已经没有入口的页上。
  ctx.effect(() => hidden.subscribe(() => {
    const gone = hidden.getSnapshot();
    if (gone.size === 0) return;
    const showing = ctx.layout.panelInfo.getSnapshot().activePanelId;
    const page = activePage(showing, NAV);
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
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar', priority: -10,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      // ⚠️ 刻意**不声明** `sidebar.workspaces`：那是宿主的多项目工作区浏览器
      //    （带工作区切换），与本工作台的单一学习空间不是一回事。不声明 = 它不挂载。
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      // 账号面板里的登录表单。**内容由页面包提供**（`zhiyun-page-me` 注册），
      // 壳只负责"什么时候把它显示出来"—— 壳不认识智云课堂的账号协议。
      'sidebar.account.signin': { kind: 'single', scope: 'root' },
    },
    inject: () => ({ controller, hidden, account }),
  }, Sidebar));
  // DSH 0.2 gives child-slot ownership exclusively to the original entry.
  // Adapt its component in place so forms retain that authorization, store,
  // onboarding and plugin registrations; restore it on bundle disposal.
  ctx.effect(() => adaptSettingsSurface(ctx.slots, NativeSettings =>
    props => <PersonalSettingsBridge {...props} controller={controller} NativeSettings={NativeSettings}/>
  ), 'zhiyun: reversible settings surface adapter');
  // 汉堡放进会话头的 leading：那一列在会话名之前，标题会自己让开。
  // 不能用固定定位盖在面板角上，否则会压住会话名（宿主标题行就从这里开始）。
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    priority: -10,
    inject: () => ({ drawer }),
  }, AskMenuButton));
  // 抽屉挂在 `shell.overlay`（整层 absolute）。`shell.leading` 只在 macOS 且侧栏收起时挂载。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'zhiyun-ask-chrome',
    order: 10,
    inject: () => ({ drawer, sessions: ctx.sessions, workspaces: ctx.workspaces, uiWorkspace: ctx.uiWorkspace, getLearningSpace: () => ctx.get('zhiyunLearningSpace') }),
  }, AskChrome));
  ctx.slots.inject('main', function* () {
    // 七个页面面板都照常注册，**不**因为「某一页被取消」而撤掉注册：
    // 撤注册要在远程事件回来的异步时点调 `ctx.slots.register`，那时 shell 自己的 fiber
    // 未必还在有效的 effect 作用域里（会撞 INACTIVE_EFFECT），时序很难守。
    // 取消的效果落在**呈现**上（侧栏与跳转不列它），见 components.jsx 的 Sidebar/SearchDialog。
    for (const page of NAV.filter(item => item.id !== 'ask')) {
      yield ctx.slots.register({
        name: 'main', key: panelKey(page.id),
        children: { [`zhiyun.${page.id}.content`]: { kind: 'single', scope: 'root' }, ...(page.id === 'me' ? { 'zhiyun.me.network': { kind: 'single', scope: 'root' } } : {}) },
        inject: () => ({ controller, page: page.id }),
      }, Page);
    }
    // Startup selects Today only after all pages have been registered.
    controller.navigate('today');
  });
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10 }, () => <div className="zy-hero-brand"><span>海纳江河，启真厚德</span></div>));
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

/**
 * 历史会话抽屉的开合状态。
 *
 * 抽屉渲染在「问一问」面板上（见 components.jsx 的 AskChrome）：会话头 leading 里的汉堡
 * 点开后，从面板左缘拉出整高抽屉。不是宿主右栏。
 *
 * 为什么不用宿主布局的右侧轨道（`ctx.layout.openRightbar`）：
 * 那条轨道归宿主的右栏插件（文档/文件/终端分页）所有，它的呈现同步会把轨道关回去，
 * 我们打开会被立刻关掉；而停用那个插件又会让 9 个客户端插件（chat/skill/plan/…）
 * 因缺少 `sidebarRight` 服务而无法激活，整个前端起不来（实测）。
 * 所以我们不去抢那条轨道。
 */
function createSessionDrawer() {
  let shown = false;
  // 用户刚归档了正在看的那条：先别自动补一条新壳。补上的话，历史清了，列表里还是有一条会话。
  let skipAutoSession = false;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => shown,
    toggle() { shown = !shown; emit(); },
    close() { if (!shown) return; shown = false; emit(); },
    holdEmptySession() { skipAutoSession = true; },
    releaseEmptySession() { skipAutoSession = false; },
    shouldSkipAutoSession: () => skipAutoSession,
  };
}

/**
 * 「问一问」固定绑到本工作台的学习空间。
 *
 * 只有三个条件同时成立才动作：这一页正是问一问、当前没有已打开的会话、
 * 工作区列表里能**确定地**认出学习空间（见 `pickLearningWorkspace`）。
 *
 * 为什么不怕攒出一堆空会话：宿主的 `connectWorkspace` 会先找该目录下已有的空白会话
 * 并复用它，只在一条都没有时才新建。已经打开的会话绝不顶掉 —— 这里只填「什么都没有」的空档。
 * 抽屉刚归档了正在看的那条时先停一下：这时候补一条，历史清了，列表里马上又有壳。
 * 再次进入问一问会放开，仍按原来的规则填空档。
 *
 * ⚠️「当前有没有会话」在 0.2 不能读 `sessions.list.getSnapshot().current`：
 *    那个字段已经不存在了（旧版有），读它恒为 undefined ⇒ 每次进问一问都重新绑一次。
 *    现在读宿主自己持久化的「主面板在看哪个会话」（`uiWorkspace.selection`，
 *    也就是 localStorage 里的 `dsh.sessions.current`）。取不到就当作没有，
 *    退回原来的行为（不会更糟）；`?.` 保证宿主哪天换形状也不会把插件带崩。
 */
function createLearningSpaceBinding(ctx, isAskActive, drawer) {
  let pending = false;
  const openSessionId = () => ctx.uiWorkspace?.selection?.getSnapshot?.()?.sessionId;
  const attempt = () => {
    if (pending || !isAskActive() || drawer.shouldSkipAutoSession()) return;
    const workspace = ctx.workspaces.list.getSnapshot();
    const session = ctx.sessions.list.getSnapshot();
    if (workspace.phase !== 'ready' || session.phase !== 'ready') return;
    if (openSessionId() !== undefined) return;
    // 学习空间的定义（标题、怎么认）归领域状态包，壳按服务取，不复制第二份字面量。
    const learningSpace = ctx.get('zhiyunLearningSpace');
    const target = learningSpace?.pickLearningWorkspace(workspace.items, learningSpace.title);
    if (target === undefined) return;
    // 挂起一直留到主面板真的打开一条会话。列表一更新就放开的话，下一次 attempt
    // 会把这次还没走完的导航取消掉，然后自己再来一次，空档里会打成循环。
    pending = true;
    ctx.uiWorkspace.startSession(target.workspaceId);
  };
  ctx.effect(() => {
    const selection = ctx.uiWorkspace?.selection;
    if (selection == null || typeof selection.subscribe !== 'function') return undefined;
    return selection.subscribe(() => {
      if (openSessionId() !== undefined) pending = false;
    });
  }, 'zhiyun: bind learning space (selection)');
  ctx.effect(() => ctx.workspaces.list.subscribe(attempt), 'zhiyun: bind learning space (workspaces)');
  ctx.effect(() => ctx.sessions.list.subscribe(attempt), 'zhiyun: bind learning space (sessions)');
  return {
    attempt,
    reset() { pending = false; },
  };
}
