// 「插件」页的状态：一份只读快照 + 一个写动作（取消/启用某个包）。
//
// 为什么状态住在这里而不是组件里：这一页会被反复挂载/卸载（切到别的页面就卸载），
// 而读一次图要跨宿主往返；让快照活过页面切换，切回来就不用重新等。
// 快照的形状与 dsh-zhiyun-ui-primitives 的 `useStore`（subscribe + getSnapshot）对齐，
// 组件因此不需要认识任何服务。
import { buildView, fiberNameIndex, readPlane } from './runtime.js';

/**
 * 读一个 Cordis 平面的服务依赖事实。
 * @param ctx - 插件上下文（宿主面传入的是同一套读法的上下文）。
 * @returns `{ rows, providers }`，Map 折成数组以便跨信封传递。
 */
function planeOf(ctx) {
  const plane = readPlane({
    entries: [...ctx.loader.entries()],
    runtimes: [...ctx.registry.values()],
    store: ctx.reflect.store,
  });
  return { rows: plane.rows, providers: [...plane.providers.entries()] };
}

/** 还没读过时的快照：`status` 让页面能区分「空图」与「没读到」。 */
const INITIAL = Object.freeze({ status: 'idle', view: null, error: '', busy: [], pendingAction: null });

/**
 * 造一个页面状态句柄。
 *
 * @param ctx - 浏览器插件上下文，需要 `remote.pluginManager`、`loader`、`registry`、
 *   `reflect`、`connection`、`modules`。
 * @returns `{ subscribe, getSnapshot, ensure, refresh, setPluginEnabled, dismiss, dispose }`。
 */
export function createStore(ctx) {
  let snapshot = INITIAL;
  let inflight = null;
  let disposed = false;
  const listeners = new Set();

  const publish = (next) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        // 订阅者是页面组件；一个坏订阅者不该让整张图停止更新。
        console.error('zhiyun-plugins: subscriber failed', error);
      }
    }
  };

  /** 宿主面的读数：与 dsh-zhiyun-study-core 同一套信封，只读一个方法。 */
  const hostPlane = async () => {
    const result = await ctx.connection.rpc.call('/api', 'zhiyun-plugins', { method: 'graph' }, undefined);
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message ?? '宿主未返回依赖图'), { code: result?.error?.code });
    return result.value;
  };

  const read = async () => {
    const [bundles, plugins, host] = await Promise.all([
      ctx.remote.pluginManager.listBundles(),
      ctx.remote.pluginManager.listPlugins(),
      hostPlane(),
    ]);
    if (!bundles?.ok) throw new Error(bundles?.error?.message ?? '读取插件包失败');
    if (!plugins?.ok) throw new Error(plugins?.error?.message ?? '读取插件条目失败');
    const modules = ctx.modules?.manifest?.modules ?? [];
    return buildView({
      bundles: bundles.value,
      plugins: plugins.value,
      modules,
      host,
      client: planeOf(ctx),
      slots: ctx.slots.snapshot(),
      fiberNames: fiberNameIndex([...ctx.loader.entries()]),
    });
  };

  const load = async () => {
    publish({ status: snapshot.view === null ? 'loading' : 'ready', error: '' });
    try {
      const view = await read();
      publish({ status: 'ready', view, error: '', pendingAction: null });
    } catch (error) {
      publish({ status: snapshot.view === null ? 'error' : 'ready', error: String(error?.message ?? error), pendingAction: null });
    }
  };

  const refresh = () => {
    if (disposed) return Promise.resolve();
    inflight ??= load().finally(() => { inflight = null; });
    return inflight;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    /** 页面第一次挂载时读一次；已经读过就不重复。 */
    ensure() {
      if (snapshot.status === 'idle') void refresh();
    },
    refresh,
    /**
     * 打开 / 关闭某个包。
     *
     * 走宿主自己的**行级** `pluginManager.setPluginEnabled(entryId, enabled)` —— 它把
     * `disabled` 写进用户自己的 `cordis.patch.yml`，与宿主「插件」页的行开关同一条路径，
     * 因此共享它的只读保护与 `plugin-manager/changed` 通知。
     *
     * 为什么不用 `setBundleEnabled`（上一轮踩到的坑）：那个会把整个 bundle 从 profile 的
     * `dsh.profile.bundles` 里摘掉，而 `listBundles()` 只列**被选中**的 profile 依赖 ——
     * 摘掉之后这一页就再也看不到它了，成了单向门；更要命的是 profile 初始化会把我仓的源包
     * 重新补回 bundles 列表，于是这次取消在下次启动时被静默撤销。行级开关写在用户 overlay 里，
     * 初始化明确保留，行也还在，随时能再打开。
     * @param entryId - Loader 条目身份（`listPlugins()` 给的 `entryId`）。
     * @param enabled - 目标状态。
     * @returns 完成后重读一次图。
     */
    async setPluginEnabled(entryId, enabled) {
      if (disposed) return;
      publish({ pendingAction: entryId, busy: [...snapshot.busy, entryId] });
      try {
        const result = await ctx.remote.pluginManager.setPluginEnabled(entryId, enabled);
        if (!result?.ok) throw new Error(result?.error?.message ?? '宿主拒绝了这次更改');
        if (result.value?.application === 'failed') throw new Error(result.value?.error?.diagnostic ?? '更改未能生效');
        publish({ error: '' });
      } catch (error) {
        publish({ error: String(error?.message ?? error) });
      } finally {
        publish({ pendingAction: null, busy: snapshot.busy.filter(item => item !== entryId) });
        await refresh();
      }
    },
    /** 关掉错误条。 */
    dismiss() {
      publish({ error: '' });
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
