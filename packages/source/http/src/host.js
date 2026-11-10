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
    /**
     * 网关会话的来源，由上层注入。
     *
     * # 为什么是回调而不是直接读凭据
     *
     * 本包是 **tier 0**：不依赖任何业务包，也就不知道凭据存在哪、也不知道
     * 网关登录该怎么走（那是 `@lybx-leyw/dsh-zju-source-webvpn` 的 `webvpnLogin`
     * 与 `source/login` 的账号读取）。但出口这一层**必须**在「直连失败、要改走
     * 网关」之前确认「有人能建会话」—— 否则发出去的请求会被网关回一个登录页
     * （HTTP 200），各数据源把登录页当业务数据去解析，报出一堆莫名其妙的字段缺失。
     *
     * 所以这里只持有**回调**：上层（`source/login` 或 profile 装配层）通过
     * `setWebvpnSession` 注册一个「请确保网关会话可用」的函数。
     * 没注册时出口会抛 `WEBVPN_REQUIRED` 并提示去配账号 —— 明确的失败，
     * 好过把登录页当数据。
     */
    let webvpnSession = null;

    const ensure = async () => {
      if (egress !== null || disposed) return egress;
      const undici = await loadUndici();
      if (disposed) return null;
      egress = createEgress({
        mode: 'auto',
        undici,
        log: () => {}, // 出口每次请求都打日志会淹掉真正的错误；诊断走 state()
        // 惰性转发：注册可能晚于首次请求（profile 装配顺序不保证）。
        onWebvpnRequired: webvpnSession === null
          ? undefined
          : async () => {
            const current = webvpnSession;
            if (current === null) return false;
            try {
              return (await current()) !== false;
            } catch {
              // 建会话失败（账号没填、密码错、要验证码）→ 不让出口继续改写，
              // 调用方会拿到 WEBVPN_REQUIRED 而不是一个登录页。
              return false;
            }
          },
      });
      return egress;
    };

    // 服务面是**惰性**的：`createEgress` 要异步装 undici，而 `provide` 是同步的。
    // 所以先给一个占位对象，内部保证首次调用时初始化完成。
    const service = {
      /**
       * 注册「请确保网关会话可用」的回调。
       *
       * 回调返回 `true`（或任何不是 `false` 的值）表示会话可用；返回 `false`
       * 或抛错表示建不起来，出口会拒绝改写并抛 `WEBVPN_REQUIRED`。
       *
       * 传 `null` 取消注册。返回撤销函数（幂等）。
       *
       * ⚠️ 出口实例是**惰性**创建的，且创建后不会再换回调 —— 所以这个注册
       * 必须在第一次需要走网关的请求**之前**完成。profile 装配层应尽早调用；
       * 若晚于该请求，那一次仍会抛 `WEBVPN_REQUIRED`，下一次才生效。
       *
       * @param handler - 返回 Promise<boolean> 的函数，或 null。
       * @returns 撤销函数。
       */
      setWebvpnSession(handler) {
        webvpnSession = typeof handler === 'function' ? handler : null;
        return () => { if (webvpnSession === handler) webvpnSession = null; };
      },
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
