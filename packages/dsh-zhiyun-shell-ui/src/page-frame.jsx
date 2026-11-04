/**
 * 页面框：页面包自己把内容包成「一页」时用的外框。
 *
 * 迁移到 dsh-pages 后，导航与页面选择由页面壳拥有，**内容**由各页面包自己注册进
 * `page.content` 这个 keyed 槽。每个页面包因此都需要这套与产品外观有关、与「谁提供
 * 导航」无关的版式：版心上限、整幅铺开的例外、二级入口与回程按钮。
 *
 * 放在 shell-ui 而不是外壳里：外壳与页面包在客户端模块图里是**同层**，页面包不能
 * 依赖外壳（拓扑会绕成环）。shell-ui 是所有页面的公共底层。
 */
import React from 'react';
import { Empty, Icon } from './primitives.jsx';

/**
 * 一个页面的外框。
 *
 * @param props - `{ page, label, fullBleed, parent, children, navigate, body }`。
 * @returns 外框元素。
 */
/**
 * Page frame: the page's own UI, not the shell's.
 *
 * The page shell (dsh-pages) owns the rail and the active-page lifecycle, and
 * gives every page a bare full-bleed region. Everything inside that region —
 * the back link, the readable column, sub-navigation, empty states — is decided
 * here, by the product. That split is what lets a page be as complex as the
 * native workbench: the shell never imposes a layout on it.
 *
 * @param props - see below.
 * @returns the page's own frame.
 */
export function PageFrame({
  /** Page id; lands on `data-page` for styling and debugging. */
  page,
  /** Page title; used by the empty state. */
  label = '',
  /** App-style page: no readable column, the page owns its own scrolling. */
  fullBleed = false,
  /** Back link target: parent page `{ id, label }`. */
  parent,
  /** Sub-entries: `[{ id, label }]`. */
  children = [],
  /** Navigation function; buttons are omitted when absent. */
  navigate,
  /** Page body. */
  body,
}) {
  const contentClass = fullBleed ? 'zy-content zy-content-flush' : 'zy-content';
  const missing = <Empty title={`${label}暂时不可用`}>这个页面由独立的插件包提供，当前未启用。</Empty>;
  return <div className="zy-page" data-page={page}>
    {/* `tabIndex={-1}` is not for tab order: it lets the skip link move focus in.
        `-1` also keeps the container itself out of the tab sequence. */}
    <main className="zy-scroll" id="zy-main" tabIndex={-1}><div className={contentClass}>
      {parent && navigate && <button type="button" className="zy-page-back"
        onClick={() => navigate(parent.id)}><Icon name="arrowLeft" size={14}/>{parent.label}</button>}
      {children.length > 0 && navigate && <div className="zy-page-subnav" role="group" aria-label={`${label}的更多入口`}>
        {children.map(child => <button type="button" key={child.id}
          onClick={() => navigate(child.id)}>{child.label}<Icon name="arrow" size={14}/></button>)}
      </div>}
      {body ?? missing}
    </div></main>
  </div>;
}

export default PageFrame;
