/**
 * 页面注册：把一页成对交给 DSH 原生的两个槽位。
 *
 * # 为什么是两个槽
 *
 * 官方把「一页」拆成两半，靠**同一个 id** 关联：
 *
 *   sidebar.panellist  （ui-sidebar 声明，root 作用域 list）
 *       —— 导轨上的那个图标格子。拿到 { size, active }，自己画图标。
 *   main               （ui-layout 声明，root 作用域 keyed）
 *       —— 中央面板本体。key 就是同一个 id。
 *
 * 这是 DSH 推荐的做法，不是我们发明的：ui-sidebar 的 README 原话是
 * 「插件在 root 作用域的 sidebar.panellist list 中注册图标组件……同一个 id
 * 寻址布局中 root 作用域 main keyed slot 的组件」。
 *
 * # 迁移前是什么样
 *
 * 之前用第三方页面壳 @lybx-leyw/dsh-pages：它自建 rail、面板切换、图钉、
 * 偏好持久化，并声明 page.content 一类自己的槽。那是「在官方 main 旁边再
 * 造一套面板系统」。页面收窄到三页之后，这套自建壳的维护成本超过了收益。
 *
 * # 三个必须守住的点
 *
 * 1. **不能用 main 的 conversation key** —— 那是原生会话页的保留位，
 *    占用它会顶掉原生会话。我们的页面用各自的 id 作 key。
 * 2. **成对注册、成对注销**：只有图标没有面板 = 点开空白；只有面板没有图标
 *    = 永远进不去。两者在同一个 effect 里注册，卸载时按相反顺序撤销。
 * 3. **label 必须能在 locale 里解析**：sidebar 用 resolveSlotLabel() 取，
 *    拿不到就退回 id（界面上会出现英文 key）。所以传纯字符串或 { zh, en, … }。
 *
 * # 与导航清单的关系
 *
 * 导航的**唯一真源**是这里 —— 谁注册了页面，导轨上就有谁。外壳不再持有
 * 一张需要手工同步的 NAV 表（旧设计里漏改那张表的表现是「页面注册成功但
 * 导轨没入口」）。
 */
import React from 'react';

/**
 * 导轨格子里的图标。
 *
 * sidebar 只给 { size, active }：尺寸与选中态由它决定，图形由页面给。
 * data-active 留在 DOM 上，方便主题层给选中态做额外样式。
 *
 * @param props - size（边长像素）、active（是否当前页）、glyph（图形工厂）。
 * @returns 图标元素。
 */
function RailIcon({ size = 18, active = false, glyph }) {
  return (
    <span
      data-zw-rail-icon={glyph.key}
      data-active={active}
      aria-hidden="true"
      style={{ display: 'inline-flex', width: size, height: size }}
    >
      {glyph.render(size)}
    </span>
  );
}

/**
 * 把一页注册到 DSH 原生的导轨与中央面板。
 *
 * @param ctx - 客户端上下文；需能 slots.inject。
 * @param spec - 页面声明。
 * @param spec.id - 页面 id，同时是 main 的 key 与 sidebar.panellist 的 id。
 * @param spec.label - 导轨提示与无障碍名称；字符串或 { zh, en, … }。
 * @param spec.order - 导轨里的排序；越小越靠前。
 * @param spec.icon - 导轨图标：(size) => ReactNode。
 * @param spec.render - 面板内容：() => ReactNode。
 * @returns disposer；卸载时按「先摘面板、再摘图标」的顺序撤销。
 */
export function registerPage(ctx, spec) {
  const id = spec.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('registerPage: 缺少页面 id');
  }
  // conversation 是原生会话页的保留 key，占用它会顶掉会话本身。
  if (id === 'conversation') {
    throw new Error('registerPage: "conversation" 是原生会话页的保留 id，不能用作产品页');
  }
  return ctx.slots.inject('main', () => {
    // 先注册图标（入口），再注册面板（内容）。
    const disposeIcon = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id,
      order: spec.order ?? 0,
      label: spec.label ?? id,
    }, props => <RailIcon {...props} glyph={{ key: id, render: spec.icon }} />));

    const disposePanel = ctx.slots.register({ name: 'main', key: id }, () => <>{spec.render()}</>);

    return () => {
      // 与注册相反：先摘内容，避免「入口还在、点开空白」的中间态。
      if (typeof disposePanel === 'function') disposePanel();
      if (typeof disposeIcon === 'function') disposeIcon();
    };
  });
}

export default registerPage;
