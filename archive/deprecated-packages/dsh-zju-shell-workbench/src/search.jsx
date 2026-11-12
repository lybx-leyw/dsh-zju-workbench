import React, { useEffect, useRef, useState } from 'react';
import { Icon, useStore } from '@lybx-leyw/dsh-zju-ui-shared';
import { matchingPages, visiblePages } from './model.js';

/**
 * 「跳转到…」搜索。
 *
 * **不占导航栏**：它只是浮窗 + Ctrl+K（产品决定）。导航由页面壳的导轨提供，
 * 这里不再重复列一遍页面，只保留「快速跳到某一页」这一件事。
 *
 * @param props - 见下。
 * @returns 对话框元素。
 */
export function SearchDialog({ controller, open, onClose, pages }) {
  const dialog = useRef(null);
  const [query, setQuery] = useState('');
  const items = matchingPages(query, pages);
  useEffect(() => {
    if (open) { setQuery(''); dialog.current.showModal(); }
    else if (dialog.current.open) dialog.current.close();
  }, [open]);
  return <dialog className="zw-search-dialog" ref={dialog} aria-label="跳转到" onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <form method="dialog" onSubmit={event => { event.preventDefault(); if (items[0]) { controller.navigate(items[0].id); onClose(); } }}>
      <div className="zw-search-input"><Icon name="search"/><input aria-label="搜索页面" placeholder="想去哪里？" value={query} onChange={event => setQuery(event.target.value)} autoFocus/><button type="button" onClick={onClose} aria-label="关闭跳转"><kbd>Esc</kbd></button></div>
      <div className="zw-search-results">{items.length ? items.map(item => <button type="button" key={item.id} onClick={() => { controller.navigate(item.id); onClose(); }}><Icon name={item.icon}/><span>{item.label}<small>{item.hint}</small></span><Icon name="arrow" size={16}/></button>) : <p>没有找到这个页面</p>}</div>
    </form>
  </dialog>;
}

/**
 * 外壳残留的**非导航** chrome：只有 Ctrl+K 搜索浮窗。
 *
 * 为什么只剩这一件：
 *   - 导航 —— 由页面壳（`@lybx-leyw/dsh-pages`）的导轨提供，这里再做一套就是两套；
 *   - 账号面板 —— 改走 DSH 原生设置（`settings.section` 的「账号与数据」）；
 *   - 明暗开关 —— 改走 DSH 原生设置里的外观项。
 *
 * 搜索没有对应的原生面，所以要自己留一个：它不占布局（`<dialog>` 走 top layer），
 * 只在按 Ctrl+K 时出现，因此挂在 overlay 里也不影响页面几何。
 *
 * @param props - `{ controller, hidden }`，都来自外壳。
 * @returns 搜索对话框元素。
 */
export function SearchOverlay({ controller, hidden }) {
  const [open, setOpen] = useState(false);
  // 被取消的页不进搜索：与导轨用同一份清单，否则会出现「导轨看不到、Ctrl+K 能跳过去」。
  const pages = visiblePages(useStore(hidden));
  useEffect(() => {
    function key(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(value => !value);
      }
    }
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  return <SearchDialog controller={controller} open={open} onClose={() => setOpen(false)} pages={pages}/>;
}
