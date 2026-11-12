/**
 * 页面自注册：页面包把自己的内容交给页面壳，不再依赖产品外壳代为声明子槽。
 *
 * 迁移前：外壳为每一页声明 `zw.<id>.content` 子槽，页面包往里注册 —— 页面包因此
 * 隐含依赖「外壳在场」。迁移后：页面包直接注册到页面壳拥有的 `page.content`（keyed），
 * 外壳只负责导航元数据、主题与设置，不再介入内容。
 *
 * 导航元数据仍由外壳统一注册（`NAV` 是唯一真源，搜索/隐藏列表都读它），所以这里
 * **不**再注册页面，否则同一个 id 注册两遍会直接抛错。
 */
import React from 'react';
import { PageFrame } from './page-frame.jsx';

/**
 * 把一页的内容注册到页面壳。
 *
 * @param ctx - 客户端上下文；需能 `inject(['pages'], …)`。
 * @param spec - 页面声明。
 * @param spec.id - 页面 id（也是 `page.content` 的 key）。
 * @param spec.label - 标题；用于占位与二级入口的 `aria-label`。
 * @param spec.fullBleed - 应用型页面（不套版心）。
 * @param spec.parent - 父页 `{ id, label }`。
 * @param spec.children - 二级入口 `[{ id, label }]`。
 * @param spec.render - `(props) => ReactNode`，props 含 `{ navigate }`。
 * @param spec.priority - keyed 槽同 key 多份注册时的优先级；越大越优先。默认 0。
 */
export function registerPageContent(ctx, spec) {
  // 导航控制器是可选的：外壳缺席时页面仍要能显示，只是按钮不可用。
  const navigate = () => ctx.get('zwNavigation')?.navigate;
  /**
   * 在**已就绪的 pages 服务**上注册；服务还没到时等它。
   *
   * 不能再嵌套一层 `ctx.inject(['pages'], …)`：调用方常常已经在一个注入作用域里
   * （例如先等 `zwClassroomStudio`），嵌两层会让注册落在内层 fiber，外层一旦
   * 先被丢弃就跟着没了 —— 表现是「导轨有入口、点开空白」。
   *
   * `ctx.get('pages')` 存在则立刻注册；不存在则**不静默跳过**（那会变成空白页），
   * 而是等 `pages` 出现后再注册，保证「有入口就一定有内容」。
   */
  /**
   * 注册导航条目 —— 让页面自己声明「我叫什么、排第几」。
   *
   * # 这取代了静态 `NAV` 清单
   *
   * 旧设计：外壳持有一张 11 页的 `NAV`，逐页注册。每加一页都要改那张表，
   * 而漏改的表现是「页面内容注册成功，但导轨上没有入口」——论文页踩过。
   *
   * 新设计：`dsh-pages` 的 `registerPage(spec)` 本来就是动态累加（返回一个
   * 「只移除这一次注册」的 disposer）。谁装了页面包，导轨就多一个入口。
   *
   * @param shell - `pages` 服务。
   * @returns disposer，或 undefined（外壳不提供 registerPage 时）。
   */
  const registerNav = shell => {
    // 自定义外壳可能没有 registerPage。缺席时只注册内容 —— 不报错，
    // 否则一个可选能力的缺失会让整个页面注册失败。
    if (typeof shell.registerPage !== 'function') return undefined;
    return shell.registerPage({
      id: spec.id,
      label: spec.label,
      ...(spec.icon === undefined ? {} : { icon: spec.icon }),
      ...(spec.order === undefined ? {} : { order: spec.order }),
      ...(spec.region === undefined ? {} : { region: spec.region }),
    });
  };

  const attach = shell => ctx.slots.inject(shell.config.pageSlot, () => ctx.slots.register({
    name: shell.config.pageSlot,
    key: spec.id,
    ...(spec.priority === undefined ? {} : { priority: spec.priority }),
  }, () => <PageFrame
    page={spec.id}
    label={spec.label}
    fullBleed={spec.fullBleed}
    parent={spec.parent}
    children={spec.children}
    navigate={navigate()}
    body={spec.render({ navigate: navigate() })}
  />));
  /**
   * 挂上内容与导航，返回组合 disposer。
   *
   * 卸载顺序反过来：先摘导航（入口消失），再摘内容 —— 避免出现
   * 「入口还在、点开空白」的中间态。
   */
  const bind = shell => {
    const disposeContent = attach(shell);
    const disposeNav = registerNav(shell);
    return () => {
      if (typeof disposeNav === 'function') disposeNav();
      if (typeof disposeContent === 'function') disposeContent();
    };
  };

  const shell = ctx.get('pages');
  if (shell !== undefined) return bind(shell);
  return ctx.inject(['pages'], scope => bind(scope.pages));
}
