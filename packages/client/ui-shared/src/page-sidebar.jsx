/**
 * React 绑定：把 `page-sidebar.js` 的注册表接成 hook。
 *
 * 与 `page-sidebar.js` 分开是因为那个文件必须是**纯 JS**：它要被非 React 环境
 * import（测试、诊断脚本），而这里需要 `useSyncExternalStore` / `useEffect`。这与
 * `component-registry.js` / `component-registry.jsx` 的拆分是同一个理由。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getPageSidebar, registerPageSidebar, subscribePageSidebar } from './page-sidebar.js';

/**
 * 取某一页注册的侧栏控制；注册 / 撤销 / 展开态变化会触发重渲染。
 *
 * ⚠️ 拿不到时返回 `undefined`，**不抛**。调用方必须自己决定降级形态 ——
 * 「这一页没有侧栏」和「页面还没挂载」都是合法状态，不该让导轨那一格崩掉。
 *
 * @param pageId - 页面 id。
 * @returns 控制对象，或 undefined。
 */
export function usePageSidebar(pageId) {
  // ⚠️ 两个参数都必须**稳定**：`useSyncExternalStore` 用它们的**引用**判断要不要
  // 重新订阅 / 重新取值。每渲染新建一个箭头函数，会让它在每次渲染后都退订再订阅一遍
  // （导轨那一格随页面壳重渲染很频繁），而且拿快照也变得不可比较。
  const subscribe = useCallback(listener => subscribePageSidebar(pageId, listener), [pageId]);
  const snapshot = useCallback(() => getPageSidebar(pageId), [pageId]);
  // 快照返回的是注册表里那个**对象本身**：同一份注册在多次调用之间引用不变，
  // 所以 `useSyncExternalStore` 的同一性判断成立，不会无限重渲染。
  return useSyncExternalStore(subscribe, snapshot,
    // 服务端渲染没有这张表，返回 undefined（调用方走降级分支）。
    () => undefined);
}

/**
 * 页面把自己的侧栏开关交给产品层（导轨顶部那格）。
 *
 * # 为什么入参是「状态 + 动作」而不是一个控制对象
 *
 * 导轨上那个按钮的 `aria-label` / `title` 必须说清「现在点一下会发生什么」——
 * 收藏起还是展开。所以注册必须带上**当前的展开态**，而不是一个不变的 getter：
 * 页面重新渲染时这个 hook 会重注册一次，产品层据此重渲染那个按钮。
 * 注册表内部对「展开态与文案都没变」的重复注册不派发通知，所以这不会变成
 * 每次渲染都抖一下导轨。
 *
 * # 必须在提前 return 之前调用
 *
 * 页面组件常有「加载中 / 出错」的提前 return（见 `tests/repo/hooks-order.test.mjs`）。
 * 这个 hook 里有 `useEffect`，写在 return 之后会让 React 在两次渲染之间看到不同的
 * hook 数量并直接抛错 —— 而表现是整页空白。所以调用点统一放在组件顶部。
 *
 * @param pageId - 页面 id（与 `page.content` 的 key 一致）。
 * @param control - `{ expanded, toggle, label? }`。
 * @returns 无。
 */
export function useRegisterPageSidebar(pageId, control) {
  /**
   * `control` 可以是 `null` —— 表示「这一页现在**没有**侧栏可收」。
   *
   * 学习页就是这样：没登录时整页只有一句引导，课程目录根本不在树里。那时若仍然
   * 登记一个开关，导轨上会出现一个按下去什么都不变的按钮。`null` 让它退回纯鲸鱼。
   *
   * 用可选链而不是解构：解构 `null` 会抛，而这个 hook 必须能被无条件调用。
   */
  const expanded = control?.expanded;
  const toggle = control?.toggle;
  const label = control?.label;
  const active = control !== null && control !== undefined;
  useEffect(() => {
    if (!active) return undefined;
    return registerPageSidebar(pageId, { expanded, toggle, label });
  }, [pageId, active, expanded, toggle, label]);
}
