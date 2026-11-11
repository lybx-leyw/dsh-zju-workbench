/**
 * 页面之间的**唯一**通信方式：按名字发布/取用一个 React 组件。
 *
 * # 为什么需要它
 *
 * 需求是「每个 page 不认识其他 page」。但产品里确实有跨页复用：学习页要嵌
 * 一块「以知识点出题」的面板，而那块的实现属于题库页（它要题库的持久化、
 * 进度、历史题，全在 `page-quiz` 里）。
 *
 * 原来靠**直接 import 对方包**实现：
 *
 * ```js
 * import { QuizPanel } from '@lybx-leyw/dsh-zju-page-quiz';
 * ```
 *
 * 后果是页面之间硬耦合：
 *   - 停用题库页（用户可以在「插件」页取消它）→ 学习页构建产物里还 require
 *     那个模块，运行时解析不到，整页空白；
 *   - 题库页重构一次导出，学习页跟着改；
 *   - 「这一页不依赖任何页」这条规矩无法用测试钉住，因为它本来就破了。
 *
 * # 契约
 *
 * 提供方（`page-quiz`）：在 `apply()` 里 `publishComponent('quiz.pointPanel', QuizPanel)`。
 * 使用方（`page-study`）：`usePublishedComponent('quiz.pointPanel')`，
 * 拿不到就渲染一句「该面板由题库页提供」，而不是崩。
 *
 * 名字用 `<页>.<东西>` 前缀，谁提供的一眼可见。**两端都不 import 对方**，
 * 构建时的 external 也就不再需要那一行 —— 装了才可见，没装就是一格说明。
 */

/** 已发布的组件：`name → component`。 */
const published = new Map();

/** 订阅者：name → Set<() => void>，用于让 React 重渲染。 */
const listeners = new Map();

/**
 * 发布一个组件。
 *
 * @param name - 契约名，建议 `'<页>.xxx'`。
 * @param component - React 组件。传 null/undefined 表示撤下。
 * @returns 撤销函数（幂等）。
 */
export function publishComponent(name, component) {
  if (typeof name !== 'string' || name === '') {
    throw new Error('publishComponent: name 必须是非空字符串');
  }
  if (component === null || component === undefined) published.delete(name);
  else {
    if (typeof component !== 'function' && typeof component !== 'object') {
      throw new Error(`publishComponent: ${name} 不是组件（拿到 ${typeof component}）`);
    }
    published.set(name, component);
  }
  for (const notify of listeners.get(name) ?? []) notify();
  return () => {
    // 只撤自己发布的那一份：后来者覆盖之后，前一个的 disposer 不该把它抹掉。
    if (published.get(name) !== component) return;
    published.delete(name);
    for (const notify of listeners.get(name) ?? []) notify();
  };
}

/**
 * 直接取组件（非 React 环境、或调用方自己管订阅时用）。
 *
 * @param name - 契约名。
 * @returns 组件，或 undefined。
 */
export function getComponent(name) {
  return published.get(name);
}

/**
 * 订阅某个契约名的变化。
 *
 * @param name - 契约名。
 * @param listener - 变化时调用。
 * @returns 退订函数。
 */
export function subscribeComponent(name, listener) {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(name);
  };
}

/** 测试用：清空全部注册（含订阅者）。 */
export function resetPublishedComponents() {
  published.clear();
  for (const set of listeners.values()) for (const notify of set) notify();
  listeners.clear();
}
