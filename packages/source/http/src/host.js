/**
 * 共享 HTTP 层的**宿主半边**：把 `sharedFetch` 真正实现掉。
 *
 * # 这里修的是一个长期存在的假象
 *
 * `sharedFetch(ctx)` 一直写着「借 campus 提供的 `zhiyunEgress` 服务」，
 * 但全仓**没有任何一处 `ctx.provide('zhiyunEgress')`** —— 于是它每次调用都
 * 落到 `fallback`，也就是 `globalThis.fetch`。众包的注释与 README 都在描述
 * 一个不存在的服务，而实际行为是它们最想避免的那一种（走全局代理）。
 *
 * 现在由本模块真正提供 `zhiyunEgress`：
 *
 *   - 用 `@lybx-leyw/dsh-zju-source-webvpn` 的策略层建一份出口；
 *   - 在 `apply` 期间 `provide`，卸载时收回；
 *   - 其它包仍然只调 `sharedFetch(ctx)`，不需要改任何一行。
 *
 * # 为什么出口只该有一份
 *
 * 各包自己 `new undici.Agent()` 会各开一套连接池；各自登录 WebVPN 会互相
 * 作废会话（与 CAS 双登录同一类事故）。所以服务形态是**全局唯一**的，
 * 谁需要就 `ctx.get('zhiyunEgress')` 取那一份。
 *
 * # 校园网探测的代价
 *
 * `probeCampus()` 只在 `auto` 模式下、且目标确实是校园域时才发生，结果缓存一次。
 * 非校园域（CC98 / 学习通 / 拼题A）走不到探测，所以它们不会为此多花一次请求。
 */

import { createEgress, loadUndici } from '@lybx-leyw/dsh-zju-source-webvpn';

/**
 * 入口文件同时承担两件事：**Loader 条目**与**库**。
 *
 * `main` 指向本文件，所以别的包 `import { ClassroomError } from
 * '@lybx-leyw/dsh-zju-source-http'` 命中的就是这里。库的符号必须从这里
 * 再导出一次 —— 否则会得到「does not provide an export named 'ClassroomError'」，
 * 而那条错误指向的是**使用方**的文件，会把人引到错的包去查。
 */
export * from './index.js';

export const name = 'zju-source-http';

/** 只硬依赖 `profileContext` 是可选的：没有它也能建出口（不需要数据目录）。 */
export const inject = [];

/**
 * 建出口并把服务挂上去。
 *
 * @param ctx - 插件上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  return ctx.effect(() => {
    let egress = null;
    let disposed = false;

    const ensure = async () => {
      if (egress !== null || disposed) return egress;
      const undici = await loadUndici();
      if (disposed) return null;
      egress = createEgress({
        mode: 'auto',
        undici,
        log: () => {}, // 出口每次请求都打日志会淹掉真正的错误；诊断走 state()
      });
      return egress;
    };

    // 服务面是**惰性**的：`createEgress` 要异步装 undici，而 `provide` 是同步的。
    // 所以先给一个占位对象，内部保证首次调用时初始化完成。
    const service = {
      /**
       * 与 `fetch` 同签名。
       *
       * @param url - 逻辑地址。
       * @param init - fetch 选项。
       * @returns 响应。
       */
      async fetch(url, init) {
        const instance = await ensure();
        if (instance === null) return globalThis.fetch(url, init);
        try {
          return await instance.fetch(url, init);
        } catch (error) {
          // 出口自身坏掉时不该让调用方彻底取不到数：退回宿主 fetch，
          // 让「网络失败」以最原始的形态暴露出来，而不是变成 EGRESS 错误。
          if (error?.code === 'EGRESS') return globalThis.fetch(url, init);
          throw error;
        }
      },
      /** 当前出口事实（给状态面板与诊断用）。异步：首次调用要装 undici。 */
      async state() {
        const instance = await ensure();
        return instance === null ? { mode: 'unavailable' } : instance.state();
      },
      /** 清掉探测缓存（换网络、或用户点了「重新探测」时用）。 */
      async forget() {
        const instance = await ensure();
        instance?.forget();
      },
      /** 主动探一次校园网（状态面板的「重新探测」）。 */
      async probe() {
        const instance = await ensure();
        return instance === null ? null : instance.probeCampus();
      },
    };

    const disposeService = ctx.provide('zhiyunEgress', service);

    return async () => {
      disposed = true;
      try { disposeService?.(); } catch { /* 服务已被别的路径摘掉 */ }
      const closing = egress;
      egress = null;
      await closing?.close?.();
    };
  }, 'zju: shared egress service');
}
