/**
 * 重命名对话框：**portal 到 `document.body`**，不在工作台的 DOM 子树里。
 *
 * # 为什么必须 portal
 *
 * 真机实测：宿主的主容器（`document.body > div`）常年带 `inert` 属性，
 * 它包住了整个工作台。`inert` 下**任何元素都拿不到焦点** ——
 * `el.focus()` 之后 `document.activeElement === el` 立刻为 false，
 * `focusin` 不触发，键入进不了输入框。
 *
 * 证据链：
 *   1. 在树里放一个 `<input>` 并 `focus()` → 失败（祖先有 `inert`）；
 *   2. 手动移除那个 `inert` → 同一行代码立刻成功，真实键入也进得去；
 *   3. 把输入框挂到 `document.body` 的**另一个子节点**（inert 之外）→ 成功。
 *
 * 所以这个对话框渲染到 `body` 下。代价是它不受工作台的层叠上下文约束，
 * 需要自己把 `z-index` 抬到最上层、自己画遮罩。
 *
 * # 为什么不用 `window.prompt`
 *
 * 曾经这么做过一版，测试里能过 —— 但那是 Playwright 拦截 dialog 的假通过。
 * DSH Desktop 是 Electron 壳，Electron **默认禁用 `window.prompt`**
 * （返回 `null` 且不弹框），真实用户按 F2 会毫无反应。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param props.open - 是否显示。
 * @param props.initial - 初始文本。
 * @param props.onSubmit - `(value) => void`；确认时调用。
 * @param props.onCancel - 取消。
 */
export function RenameDialog({ open, initial = '', onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef(null);

  // 每次打开都重置为当前名字，并把焦点抢过来。
  useEffect(() => {
    if (!open) return undefined;
    setValue(initial);
    const focus = () => {
      const el = inputRef.current;
      if (el === null) return;
      el.focus();
      // 全选：改名时通常要整体替换，而不是在末尾接着打。
      el.select?.();
    };
    focus();
    // 下一帧再抢一次：宿主在挂载后的那次渲染里可能还有动作。
    const raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
  }, [open, initial]);

  if (!open) return null;

  const submit = () => {
    const next = value.trim();
    if (next !== '') onSubmit?.(next);
    else onCancel?.();
  };

  // ⚠️ portal 到 body：必须落在 `inert` 容器之外，否则输入框拿不到焦点。
  return createPortal(
    <div
      className="zp-rename-mask"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}
    >
      <div className="zp-rename-box" role="dialog" aria-modal="true" aria-label="重命名">
        <p className="zp-rename-title">重命名</p>
        <input
          ref={inputRef}
          className="zp-rename-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
            else if (event.key === 'Escape') { event.preventDefault(); onCancel?.(); }
            // 阻止冒泡：否则树上的 Delete / F2 处理会把这些键也吃掉。
            event.stopPropagation();
          }}
        />
        <div className="zp-rename-actions">
          <button type="button" className="zp-rename-primary" onClick={submit}>确定</button>
          <button type="button" onClick={() => onCancel?.()}>取消</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
