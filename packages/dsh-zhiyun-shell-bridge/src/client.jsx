import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { adaptNativeRoot, createWorkbenchState } from './state.js';
import css from './style.css';

export const name = 'zhiyun-shell-bridge-client';
export const inject = ['slots', 'layout', 'uiWorkspace'];

/** The native root remains mounted, retaining plugin and conversation view state. */
function WorkbenchFrame({ NativeRoot, nativeProps, workbench }) {
  const { activePage } = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot);
  const ask = activePage === 'ask';
  return <div className="zy-workbench-frame" data-workbench-page={activePage}>
    <div className="zy-workbench-navigation" ref={workbench.attachNavigation}/>
    <div className="zy-workbench-body">
      <div className="zy-workbench-product" hidden={ask} ref={workbench.attachPage}/>
      <div className="zy-workbench-native" hidden={!ask} inert={!ask ? '' : undefined} aria-label="问一问 · DSH 工作区">
        <NativeRoot {...nativeProps}/>
      </div>
    </div>
  </div>;
}

/** This entry owns only new product slots; native children retain their owner. */
function WorkbenchOutlets({ renderSlot, workbench }) {
  const { activePage, navigationHost, pageHost } = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot);
  return <>
    {navigationHost && createPortal(renderSlot('zhiyun.shell.navigation', { activePage }), navigationHost)}
    {pageHost && activePage !== 'ask' && createPortal(renderSlot('zhiyun.shell.page', {}, { entryKey: activePage }), pageHost)}
  </>;
}

export function apply(ctx) {
  const workbench = createWorkbenchState();
  ctx.effect(() => ctx.reflect.provide('zhiyunWorkbench', workbench), 'zhiyun: outer workbench navigation');
  // Panel/session restores during boot must not override the product's start page;
  // only a user action makes a later native navigation reveal the workbench.
  let armed = false;
  ctx.effect(() => {
    const arm = () => { armed = true; };
    document.addEventListener('pointerdown', arm, true);
    document.addEventListener('keydown', arm, true);
    return () => {
      document.removeEventListener('pointerdown', arm, true);
      document.removeEventListener('keydown', arm, true);
    };
  }, 'zhiyun: arm native navigation reveal');
  // Native navigation (including global commands) reveals ask rather than updating
  // an invisible panel. Geometry/theme updates must not steal product navigation.
  ctx.effect(() => {
    let panel = ctx.layout.panelInfo.getSnapshot().activePanelId;
    return ctx.layout.panelInfo.subscribe(() => {
      const next = ctx.layout.panelInfo.getSnapshot().activePanelId;
      if (next === panel) return;
      panel = next;
      if (armed) workbench.selectPage('ask');
    });
  }, 'zhiyun: reveal native panel navigation');
  ctx.effect(() => {
    const selection = ctx.uiWorkspace.selection;
    let sessionId = selection.getSnapshot().sessionId;
    return selection.subscribe(() => {
      const next = selection.getSnapshot().sessionId;
      const changed = sessionId !== undefined && next !== undefined && next !== sessionId;
      sessionId = next;
      if (changed && armed) workbench.selectPage('ask');
    });
  }, 'zhiyun: reveal native session navigation');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.zhiyunBridge = 'true';
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, 'zhiyun: workbench layout styles');
  // shell.overlay stays mounted even when its native DOM ancestor is hidden.
  // Portals place only product content outside it; native overlays stay inside ask.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'zhiyun-workbench-outlets', order: 0,
    children: {
      'zhiyun.shell.navigation': { kind: 'single', scope: 'root' },
      'zhiyun.shell.page': { kind: 'keyed', scope: 'root' },
    },
    inject: () => ({ workbench }),
  }, WorkbenchOutlets));
  ctx.effect(() => adaptNativeRoot(ctx.slots, NativeRoot => {
    // Stable identity for this root registration: outer navigation never remounts DSH.
    return function BridgedRoot(nativeProps) {
      return <WorkbenchFrame NativeRoot={NativeRoot} nativeProps={nativeProps} workbench={workbench}/>;
    };
  }), 'zhiyun: reversible native root adapter');
}
