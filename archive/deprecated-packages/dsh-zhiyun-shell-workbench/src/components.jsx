import React, { useEffect } from 'react';
import { Empty, Icon } from '@lybx-leyw/dsh-zju-ui-shared';
import { NAV, FULL_BLEED_PAGES, pageSlot } from './model.js';

/**
 * 页面框架。
 *
 * 迁移到页面壳后，导航由 `@lybx-leyw/dsh-pages` 提供；本文件只负责「一页长什么样」：
 * 版心、整幅铺开的例外、二级入口与回程。页面内容仍由各页面包注册进
 * `zhiyun.<id>.content`，所以页面包本身零改动。
 *
 * @param props - 见下。
 * @returns 页面外框。
 */
export function Page({ page, controller, renderSlot }) {
  const item = NAV.find(entry => entry.id === page);
  // 页面内容由各自的页面包注册进 `zhiyun.<page>.content`。壳不认识它们，
  // 所以这里的 fallback 是「这个页面包没装」的占位 ——
  // 壳在场时导航、主题都照常可用。
  const missing = () => <Empty title={`${item.label}暂时不可用`}>这个页面由独立的插件包提供，当前未启用。</Empty>;
  // 页面契约仍由壳定义：`controller`（导航/主题）与 `renderSlot`（渲染它自己的子插槽）
  // 作为 owner props 交给页面组件 —— owner props 在宿主渲染顺序里最后展开，
  // 页面不必知道这些服务从哪来。
  //
  // 应用型页面（笔记页的编辑器）不套版心：980px 上限 + 文章式内边距会把
  // 多栏面板挤成一张小卡片。见 model.js 的 FULL_BLEED_PAGES。
  const contentClass = FULL_BLEED_PAGES.includes(page) ? 'zy-content zy-content-flush' : 'zy-content';
  // 二级入口（`parent`）与回程：都是 NAV 里的字段，不另立清单 ——
  // 「课堂 → 生成」是子页，子页在导轨与 Ctrl+K 里都不出现（`sidebar: false`），
  // 所以它的唯一入口是主线页里这一行按钮，回程也必须由这里给。
  const children = NAV.filter(entry => entry.parent === page);
  const parent = item?.parent ? NAV.find(entry => entry.id === item.parent) : undefined;
  return <div className="zy-page" data-page={page}>
    {/* skip link 的落点。
        `tabIndex={-1}` 不是为了进 Tab 序列，而是让锚点跳转能把焦点**移进**这个容器：
        不写的话浏览器只滚动、焦点还留在链接上，再按一次 Tab 又从头绕回导轨。
        `-1` 同时保证它自己不出现在 Tab 序列里。 */}
    <main className="zy-scroll" id="zy-main" tabIndex={-1}><div className={contentClass}>
      {parent && <button type="button" className="zy-page-back" onClick={() => controller.navigate(parent.id)}><Icon name="arrowLeft" size={14}/>{parent.label}</button>}
      {children.length > 0 && <div className="zy-page-subnav" role="group" aria-label={`${item.label}的更多入口`}>
        {children.map(child => <button type="button" key={child.id} onClick={() => controller.navigate(child.id)}>{child.label}<Icon name="arrow" size={14}/></button>)}
      </div>}
      {renderSlot(pageSlot(item ?? { id: page }), { controller, renderSlot }, { fallback: React.createElement(missing) })}
    </div></main>
  </div>;
}

/**
 * 原生设置面板的宿主。
 *
 * 设置**就是**宿主那个浮窗：`settings.section` / `settings.action` 全都是它的子槽位，
 * 浮窗本身由它自己 portal 到 `body`。这里只把它的 store 动作交给壳，**不复制任何
 * 分组或表单**，插件的 `settings.section` 注册零改动。
 *
 * 账号与明暗入口都走这个原生面板（产品决定），所以外壳不再自建侧栏。
 */
export function NativeSettingsHost({ NativeSettings, onActions, ...props }) {
  const { actions } = props;
  useEffect(() => { onActions(actions); }, [actions, onActions]);
  return <NativeSettings {...props}/>;
}
