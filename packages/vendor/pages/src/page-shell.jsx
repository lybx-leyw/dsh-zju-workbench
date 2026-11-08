import React, { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPages } from './pages-service.js';
import { PageManager } from './page-manager.jsx';
import { createHostFace } from './host-face.js';

const namespace = 'dsh-pages';
const translations = {
  en: {
    navigation: 'Pages', back: 'Back to workbench', more: 'More pages', pin: 'Pin to top group', unpin: 'Unpin',
    managerTitle: 'Page manager', managerHint: 'Arrange the top, recycle and bottom groups. Recycled pages remain accessible in …; pin them to append shortcuts after … in the top group.',
    managerTop: 'Top group', managerBottom: 'Bottom group', managerHidden: 'Recycle group', managerEmpty: 'No pages here.',
    managerUp: 'Move up', managerDown: 'Move down', managerShow: 'Show', managerHide: 'Hide',
    navigationWidth: 'Navigation width', navigationHeight: 'Navigation height', resetWidth: 'Reset size',
    navigationPosition: 'Navigation position', positionLeft: 'Left', positionTop: 'Top', positionBottom: 'Bottom', positionRight: 'Right',
    managerPin: 'Move to top', managerOpen: 'Open', managerGroup: 'Group',
  },
  zh: {
    navigation: '页面', back: '返回工作台', more: '更多页面', pin: '固定到顶部组末尾', unpin: '取消固定',
    managerTitle: '页面管理', managerHint: '管理顶部默认组、回收组和底部组。收起的页面仍可从 … 打开；固定后在顶部组的 … 下方追加入口。',
    managerTop: '顶部组', managerBottom: '底部组', managerHidden: '回收组', managerEmpty: '这里没有页面。',
    managerUp: '上移', managerDown: '下移', managerShow: '显示', managerHide: '隐藏',
    navigationWidth: '导航宽度', navigationHeight: '导航高度', resetWidth: '恢复默认尺寸',
    navigationPosition: '导航位置', positionLeft: '左侧', positionTop: '顶部', positionBottom: '底部', positionRight: '右侧',
    managerPin: '移到最前', managerOpen: '打开', managerGroup: '分组',
  },
};
const secondary = 'var(--dsw-alias-label-secondary, #aaa)';
const border = '1px solid var(--dsw-alias-border-l2, #555)';
const surface = 'var(--dsw-alias-bg-layer-2, #181818)';
const foreground = 'var(--dsw-alias-label-primary, #ddd)';
// Explicit shell geometry, not discovery or relocation of native slots. Removing
// this component removes the rule and restores the original geometry.
const layoutCss = (width, position) => `
#root:has([data-dsh-pages-shell]) { box-sizing: border-box; padding-${position}: ${width}px; }
[data-dsh-pages-rail] button:hover { background: var(--dsw-alias-interactive-bg-hover, #333); }
[data-dsh-pages-shell] button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
`;

/** Scale the rendered icon, including third-party icons with fixed dimensions. */
function RailIcon({ width, children }) {
  return <span data-dsh-pages-rail-icon="" aria-hidden="true" style={{
    display: 'grid', gridTemplateColumns: '23px', gridTemplateRows: '23px', placeItems: 'center', width: 23, height: 23, lineHeight: 1,
    transform: `scale(${width / 64})`, transformOrigin: 'center',
  }}>{children}</span>;
}

/** Icons for the pages this shell itself registers. */
function PageIcon({ entry }) {
  // The page owns its icon. The shell renders exactly what the page declared —
  // an `icon` component, or a `glyph` string for dependency-free packages — and
  // never substitutes an icon of its own. A shell-invented default made every
  // page that forgot an icon look identical, which hid the omission instead of
  // surfacing it.
  if (entry.icon) return <entry.icon/>;
  if (typeof entry.glyph === 'string' && entry.glyph.length > 0) return <span aria-hidden="true">{entry.glyph}</span>;
  return null;
}

/**
 * Persistent navigation over the untouched native workbench.
 *
 * This component owns navigation and page content only. It deliberately renders
 * no native settings UI: those contributions remain with their original owner.
 *
 * @param props - injected page face and framework hooks.
 * @returns the rail and, when a product page is active, its content.
 */
export function PageShell(props) {
  const snapshot = props.usePages(value => value);
  /**
   * 页面生命周期：切页时先 `onDeactivate` 旧页，再 `onActivate` 新页。
   *
   * # 为什么放在壳里，而不是让每个页面自己 useEffect
   *
   * 页面做的事常常**不在 React 树里**（往 head 插样式、给别处节点加属性、
   * 注册全局监听/定时器）。那些在 React 卸载时不会自动撤销。真机踩过：
   * 论文插件的阅读器 `createPortal(..., document.body)` + `position: fixed`，
   * 切回 home 后它还在 —— 于是「page 层影响了 home」。
   *
   * 让壳保证这件事，页面作者只需要在 `onDeactivate` 里写撤销动作；
   * 忘写也只是多一次空调用，不残留。
   *
   * # 为什么 deactivate 要包 try/catch
   *
   * 一个页面的清理抛错，不该让导航失效 —— 用户还得能切走。
   */
  const previousPageRef = useRef(snapshot.activePage);
  useLayoutEffect(() => {
    const previous = previousPageRef.current;
    const next = snapshot.activePage;
    if (previous === next) return undefined;
    previousPageRef.current = next;

    // 先停旧的：此时旧页的 DOM 还在（React 尚未提交新树），清理能拿到自己的节点。
    const outgoing = props.lifecycleOf?.(previous);
    if (outgoing?.onDeactivate !== undefined) {
      try { outgoing.onDeactivate(); } catch (error) {
        console.warn(`[dsh-pages] page "${previous}" onDeactivate threw:`, error);
      }
    }
    const incoming = props.lifecycleOf?.(next);
    if (incoming?.onActivate !== undefined) {
      try { incoming.onActivate(); } catch (error) {
        console.warn(`[dsh-pages] page "${next}" onActivate threw:`, error);
      }
    }
    return undefined;
  }, [snapshot.activePage, props]);
  const railWidth = snapshot.railWidth ?? 64;
  const railPosition = snapshot.railPosition ?? 'left';
  const horizontal = railPosition === 'top' || railPosition === 'bottom';
  const railInset = {
    left: '0 auto 0 0', right: '0 0 0 auto', top: '0 0 auto 0', bottom: 'auto 0 0 0',
  }[railPosition];
  const contentInset = {
    left: `0 0 0 ${railWidth}px`, right: `0 ${railWidth}px 0 0`,
    top: `${railWidth}px 0 0 0`, bottom: `0 0 ${railWidth}px 0`,
  }[railPosition];
  const innerBorder = { left: 'borderRight', right: 'borderLeft', top: 'borderBottom', bottom: 'borderTop' }[railPosition];
  const selectionShadow = { left: '2px 0', right: '-2px 0', top: '0 2px', bottom: '0 -2px' }[railPosition];
  const scale = railWidth / 64;
  const PlaceholderIcon = snapshot.railPlaceholderIcon;
  const actionFallback = PlaceholderIcon
    ? <PlaceholderIcon/>
    : <span aria-hidden="true" style={{ fontSize: 11 * scale, letterSpacing: '0.08em', fontWeight: 700 }}>P /</span>;
  const railButton = {
    width: 46 * scale, height: 46 * scale, minHeight: 46 * scale,
    padding: 0, boxSizing: 'border-box', display: 'grid', placeItems: 'center', flexShrink: 0,
    border: 'none', borderRadius: 9 * scale, cursor: 'pointer', font: 'inherit', lineHeight: 1,
  };
  const home = props.homePage;
  const open = snapshot.activePage !== home;
  const manager = snapshot.activePage === props.managerPage;
  const shell = useRef(null);
  const moreButton = useRef(null);
  const morePanel = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 });
  const contentId = useId();
  // Which rail group is open in the "…" popover; local because it is a transient
  // view, not page state. Only one popover can be open at a time.
  const [menu, setMenu] = useState(null);
  const active = snapshot.pages.find(entry => entry.id === snapshot.activePage);
  const top = snapshot.pages.filter(entry => entry.region === 'top');
  // The recycle group is an explicit region, not "whatever did not fit": a page
  // is either on the rail or parked here, and parking never invents a new order.
  const parked = snapshot.pages.filter(entry => entry.region === 'overflow');
  // Measure the real panel rather than assuming its size. Keep it on the inward
  // side of each edge and inside the viewport after scroll, resize or regrouping.
  useLayoutEffect(() => {
    if (menu !== 'more') return undefined;
    const place = () => {
      if (!moreButton.current || !morePanel.current) return;
      const anchor = moreButton.current.getBoundingClientRect();
      const panel = morePanel.current.getBoundingClientRect();
      const x = railPosition === 'left' ? railWidth + 8
        : railPosition === 'right' ? window.innerWidth - railWidth - panel.width - 8 : anchor.left;
      const y = railPosition === 'top' ? railWidth + 8
        : railPosition === 'bottom' ? window.innerHeight - railWidth - panel.height - 8 : anchor.top;
      const left = Math.max(12, Math.min(x, window.innerWidth - panel.width - 12));
      const top = Math.max(12, Math.min(y, window.innerHeight - panel.height - 12));
      setMenuPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (morePanel.current) observer.observe(morePanel.current);
    if (moreButton.current) observer.observe(moreButton.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [menu, railPosition, railWidth, parked.length]);
  // A popover left open while its group empties would strand the panel; closing on
  // outside pointer input keeps it a transient view.
  useEffect(() => {
    if (menu === null) return undefined;
    const onPointer = event => {
      if (event.target.closest?.('[data-dsh-pages-more], [data-dsh-pages-more-panel]')) return;
      setMenu(null);
    };
    const onKey = event => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);
  useEffect(() => { if (parked.length === 0) setMenu(null); }, [parked.length]);
  const keyDown = event => {
    if (!open) return;
    // Only the rail's own popover is a shell concern. Escape inside page content,
    // tab order and focus containment belong to the page: a shell that trapped
    // focus here also took Escape away from editors, dialogs and their own
    // "leave this page" gestures.
    event.stopPropagation();
    if (event.key === 'Escape' && menu !== null) {
      event.preventDefault();
      setMenu(null);
    }
  };
  const navItem = entry => {
    const selected = entry.id === snapshot.activePage;
    const label = props.resolveLabel(entry.label);
    return <button key={entry.id} type="button"
      title={label} aria-label={label} aria-current={selected ? 'page' : undefined}
      aria-controls={entry.id === home ? undefined : contentId}
      onClick={() => props.selectPage(entry.id)} style={{
        ...railButton,
        color: selected ? foreground : secondary,
        background: selected ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
        boxShadow: selected ? `inset ${selectionShadow} 0 currentColor` : 'none',
      }}><RailIcon width={railWidth}><PageIcon entry={entry}/></RailIcon></button>;
  };
  return <div ref={shell} data-dsh-pages-shell="" data-active-page={snapshot.activePage} data-rail-position={railPosition}
    role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined}
    aria-label={open ? props.resolveLabel(active?.label ?? '') : undefined}
    tabIndex={open ? -1 : undefined}
    style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none', color: foreground, fontFamily: 'inherit' }}
    onKeyDown={keyDown} onKeyUp={event => { if (open) event.stopPropagation(); }}>
    <style data-dsh-pages-layout="">{layoutCss(railWidth, railPosition)}</style>
    <nav data-dsh-pages-rail="" aria-label={props.t('navigation')} style={{
      position: 'absolute', inset: railInset, width: horizontal ? undefined : railWidth,
      height: horizontal ? railWidth : undefined, boxSizing: 'border-box',
      background: surface, [innerBorder]: border, display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center',
      gap: 8 * scale, padding: horizontal ? `${8 * scale}px ${16 * scale}px` : `${16 * scale}px ${8 * scale}px`,
      pointerEvents: 'auto', overflowY: horizontal ? 'hidden' : 'auto', overflowX: horizontal ? 'auto' : 'hidden',
    }}>
      <div data-dsh-pages-rail-action="" style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 46 * scale, minHeight: 24 * scale, ...(horizontal ? { paddingRight: 20 * scale } : { paddingBottom: 20 * scale }), color: secondary }}>
        <React.Fragment key={snapshot.activePage}>
          {props.renderSlot(props.railActionSlot ?? 'page.rail-action', {
            pageId: snapshot.activePage, railWidth, railPosition,
          }, { entryKey: snapshot.activePage, fallback: actionFallback })}
        </React.Fragment>
      </div>
      {top.map(navItem)}
      {parked.length > 0 && <button ref={moreButton} type="button" data-dsh-pages-more=""
        title={props.t('more')} aria-label={props.t('more')}
        aria-expanded={menu === 'more'} aria-haspopup="menu"
        onClick={() => setMenu(menu === 'more' ? null : 'more')} style={{
          ...railButton,
          color: parked.some(entry => entry.id === snapshot.activePage) ? foreground : secondary,
          background: menu === 'more' ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
        }}><RailIcon width={railWidth}><svg width="23" height="23" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg></RailIcon></button>}
      {parked.some(entry => entry.pinned) && <span data-dsh-pages-pin-divider="" style={{ display: 'block', flexShrink: 0, ...(horizontal ? { height: 28 * scale, borderLeft: border } : { width: 28 * scale, borderTop: border }) }}/>}
      {parked.filter(entry => entry.pinned).sort((a, b) => a.pinOrder - b.pinOrder).map(navItem)}
      <span style={{ flex: 1 }}/>
      {snapshot.pages.filter(entry => entry.region === 'bottom').map(navItem)}
    </nav>
    {/* The "…" group: `position:fixed` and measured coordinates, because the rail
        column clips overflow and an absolutely positioned panel would be cut off. */}
    {menu === 'more' && <div ref={morePanel} data-dsh-pages-more-panel="" role="menu" aria-label={props.t('more')} style={{
      position: 'fixed', ...menuPosition, zIndex: 1001, width: 'min(280px, calc(100vw - 24px))',
      maxHeight: `min(60vh, calc(100dvh - ${railWidth + 24}px))`, overflowY: 'auto',
      padding: 6, boxSizing: 'border-box', pointerEvents: 'auto',
      background: surface, border, borderRadius: 10, boxShadow: '0 10px 32px #0007',
    }}>
      {parked.map(entry => {
        const label = props.resolveLabel(entry.label);
        const selected = entry.id === snapshot.activePage;
        // Recycle membership is independent of the optional top-tail shortcut.
        return <div key={entry.id} data-dsh-pages-more-row="" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" role="menuitem" aria-current={selected ? 'page' : undefined}
            onClick={() => { setMenu(null); props.selectPage(entry.id); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, minHeight: 36,
              padding: '0 10px', border: 'none', borderRadius: 7, cursor: 'pointer', font: 'inherit',
              textAlign: 'left', color: selected ? foreground : secondary,
              background: selected ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
            }}><span style={{ display: 'grid', placeItems: 'center', width: 20, height: 20 }}><PageIcon entry={entry}/></span>{label}</button>
          <button type="button" title={props.t(entry.pinned ? 'unpin' : 'pin')} aria-label={`${props.t(entry.pinned ? 'unpin' : 'pin')} ${label}`}
            data-dsh-pages-pin="" aria-pressed={Boolean(entry.pinned)} onClick={() => props.setPagePinned(entry.id, !entry.pinned)}
            style={{
              width: 32, minHeight: 32, display: 'grid', placeItems: 'center', flexShrink: 0,
              border: 'none', borderRadius: 6, cursor: 'pointer', font: 'inherit', color: secondary,
              background: 'transparent',
            }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2 22 10l-2.6 2.6-1.4-1.4-3.5 3.5.7 4.3-2.1 2.1-3.5-3.5L4 23l-1-1 4.5-5.5L4 13l2.1-2.1 4.3.7 3.5-3.5-1.4-1.4z"/></svg></button>
        </div>;
      })}
    </div>}
    {open && <section id={contentId} aria-label={props.resolveLabel(active?.label ?? '')} style={{
      // A bare full-bleed area. Everything a page shows inside it — headings,
      // toolbars, a back button, its own padding — belongs to the page. The
      // shell provides the region and the lifecycle, never the layout.
      position: 'absolute', inset: contentInset, boxSizing: 'border-box', pointerEvents: 'auto',
      overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
      background: surface, color: foreground,
    }}>
      <div data-dsh-pages-content="" style={{
        flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column',
      }}>
        {/*
         * 页面作用域容器。
         *
         * # 为什么包在**外层**（连内置页一起）
         *
         * 原先我把包装放进 `manager ? A : B` 的 B 分支，结果内置的「页面管理」
         * 走 A 分支，没有作用域 —— 真机验证时 `scopeCount: 0`。而它同样是一个页面，
         * 同样不该把样式漏出去。
         *
         * 「所有页面内容都在自己的作用域里」是无条件契约，不该按分支写。
         *
         * # 它提供什么
         *
         *   - `data-page-scope="<id>"` —— `scope.ownStyles()` 注入的样式靠它限界。
         *   - 独立定位上下文（`position: relative`）—— 页面内的绝对定位以自己为基准。
         *   - `contain: layout paint` —— 布局与绘制隔离：页面内部尺寸变化不触发外部
         *     重排，绘制不溢出到导航区。
         *
         * # 边界：只管 UI
         *
         * 这是**渲染层**的隔离，不动 cordis 服务、数据栈、功能插件 —— 那些在
         * 宿主进程里，与 DOM 无关。作用域容器只决定「这段 UI 画在哪、影响谁」。
         *
         * # 它不提供什么
         *
         * 布局。页面内部怎么排（三栏、全宽、版心）仍由页面自己决定。
         *
         * `key` 用 activePage：切页强制 remount，旧页 React 状态不残留。
         */}
        <div
          key={snapshot.activePage}
          data-page-scope={snapshot.activePage}
          style={{
            position: 'relative', flex: 1, minWidth: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column',
            contain: 'layout paint',
          }}
        >
          {manager
            ? <PageManager entries={snapshot.pages} railWidth={railWidth} railPosition={railPosition}
                defaultRailWidth={snapshot.defaultRailWidth ?? railWidth}
                resolveLabel={entry => props.resolveLabel(entry.label)} t={props.t}
                actions={{
                  selectPage: props.selectPage,
                  setPageRegion: props.setPageRegion,
                  setPagePinned: props.setPagePinned,
                  setRailWidth: props.setRailWidth,
                  setRailPosition: props.setRailPosition,
                  setPageOrder: props.setPageOrder,
                  promotePage: props.promotePage,
                }}/>
            : props.renderSlot(props.pageSlot, { host: props.host }, { entryKey: snapshot.activePage })}
        </div>
      </div>
    </section>}
  </div>;
}

/**
 * Install the parallel rail and its page slot without taking over native UI.
 *
 * @param ctx - client context with slots and locale.
 * @param config - page-shell configuration.
 * @returns the tracked disposer for this installation.
 */
export function installPageShell(ctx, config = {}) {
  const { slots } = ctx;
  const cleanups = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    let failure;
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  };
  return ctx.effect(() => {
    try {
      const pages = createPages(config);
      cleanups.push(() => pages.dispose());
      cleanups.push(ctx.reflect.provide('pages', pages.service));
      /**
       * 宿主抽象层：页面访问宿主 UI 的唯一入口。
       *
       * 页面通过 `props.host` 拿到它，而不是自己 `document.querySelector` 找
       * 宿主的节点。这样宿主改内部实现时，页面不会静默失效；页面也没有理由
       * 去改宿主样式（那正是「page 层影响 home」的来源）。
       */
      const host = createHostFace(ctx);
      cleanups.push(ctx.reflect.provide('hostUi', host));
      cleanups.push(ctx.locale.register(namespace, translations));
      cleanups.push(slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay', id: 'dsh-pages.rail',
        children: {
          [pages.service.config.pageSlot]: { kind: 'keyed', scope: 'root' },
          [pages.service.config.railActionSlot]: { kind: 'keyed', scope: 'root' },
        },
        inject: () => ({
          hooks: { pages: { getSnapshot: pages.state.getSnapshot, subscribe: pages.state.subscribe } },
          homePage: pages.service.config.homePage, managerPage: pages.service.config.managerPage,
          pageSlot: pages.service.config.pageSlot,
          railActionSlot: pages.service.config.railActionSlot,
          selectPage: pages.service.selectPage,
          // 切页生命周期：壳在 activePage 变化时调用对应页的钩子。
          lifecycleOf: pages.service.lifecycleOf,
          // 宿主抽象层：页面拿 `props.host`，不直接碰宿主 DOM。
          host,
          setPageRegion: pages.service.setPageRegion,
           setPagePinned: pages.service.setPagePinned,
           setRailWidth: pages.service.setRailWidth,
           setRailPosition: pages.service.setRailPosition,
          setPageOrder: pages.service.setPageOrder,
          promotePage: pages.service.promotePage,
          resolveLabel: value => typeof value === 'string' ? value : ctx.locale.resolveText(value),
        }),
        locale: namespace,
      }, PageShell)));
      return dispose;
    } catch (error) {
      try { dispose(); } catch { /* Preserve the original setup failure. */ }
      throw error;
    }
  }, 'dsh-pages: page shell');
}
