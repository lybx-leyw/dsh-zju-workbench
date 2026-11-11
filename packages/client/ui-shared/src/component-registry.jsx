/**
 * React 绑定：把 `component-registry` 的发布表接成 hook。
 *
 * 与 `component-registry.js` 分开是因为那个文件必须是**纯 JS**（它要被
 * 非 React 环境 import：测试、脚本都可能用），而这里需要 `useSyncExternalStore`。
 */
import { useSyncExternalStore } from 'react';
import { getComponent, subscribeComponent } from './component-registry.js';

/**
 * 取一个已发布的组件；发布/撤销会触发重渲染。
 *
 * ⚠️ 拿不到时返回 `undefined`，**不抛**。调用方必须自己决定降级形态：
 * 页面之间只通过契约名认识彼此，对方没装是合法状态（用户可能刚在
 * 「插件」页把那一页关掉），不该让当前页崩成白屏。
 *
 * @param name - 契约名。
 * @returns 组件，或 undefined。
 */
export function usePublishedComponent(name) {
  return useSyncExternalStore(
    // 订阅回调必须稳定到「同名即同一函数」：每次渲染新建一个会反复重订阅。
    listener => subscribeComponent(name, listener),
    () => getComponent(name),
    // 服务端渲染时没有发布表可用，返回 undefined（调用方走降级分支）。
    () => undefined,
  );
}
