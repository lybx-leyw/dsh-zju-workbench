// Store page-relative coordinates so zoom and page reconstruction preserve anchors.
export function noteAnchor(y, rect) {
  return Math.max(0, Math.min(0.98, (y - rect.top) / rect.height));
}

export function attachCornellNotes(doc, { topic, name, storage }) {
  const key = `zhiyun.paper.cornell.anchors.${JSON.stringify([topic, name])}`;
  let notes = [];
  let status = '点击空白处记笔记 · 当前浏览器保存';
  let readFailed = false;
  try {
    storage ??= globalThis.localStorage;
    const raw = storage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((n) => typeof n.id === 'string'
        && Number.isInteger(n.page) && n.page > 0 && Number.isFinite(n.y)
        && n.y >= 0 && n.y <= 0.98 && typeof n.text === 'string')) throw new Error('Invalid notes');
      notes = parsed;
    }
  } catch { status = '读取失败，请勿编辑覆盖原笔记'; readFailed = true; }
  const mounted = new Map();
  const style = doc.createElement('style');
  style.textContent = `
    .zp-cornell-visible #pdf-pages > .page { margin-left: 280px; }
    .zp-page-notes { display: none; position: absolute; right: calc(100% + 12px); top: 0;
      bottom: 0; width: 260px; box-sizing: border-box; background: var(--zp-frame-surface);
      color: var(--zp-frame-text); border: 1px solid var(--zp-frame-line); }
    .zp-cornell-visible .zp-page-notes { display: block; }
    .zp-page-notes-label { position: absolute; top: 0; left: 8px; right: 8px;
      font: 11px/18px sans-serif; color: var(--zp-frame-secondary); pointer-events: none; }
    .zp-page-note { position: absolute; left: 8px; width: 242px; box-sizing: border-box;
      padding: 4px 6px; min-height: 32px; resize: none; border: 1px solid var(--zp-frame-line);
      border-radius: 4px; background: var(--zp-frame-surface); color: var(--zp-frame-text);
      font: 14px/22px sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
    .zp-page-note:focus { outline: 2px solid var(--zp-frame-accent); z-index: 2; }
  `;
  doc.head.append(style);
  const updateStatus = () => {
    for (const entry of mounted.values()) entry.label.textContent = `康奈尔 · 第 ${entry.page} 页 · ${status}`;
  };
  const save = () => {
    try { storage.setItem(key, JSON.stringify(notes)); status = '已保存 · 当前浏览器'; }
    catch { status = '保存失败，请勿刷新或离开；输入可重试'; }
    updateStatus();
  };
  const layout = (entry) => {
    const fields = [...entry.aside.querySelectorAll('textarea')]
      .sort((a, b) => Number(a.dataset.anchorY) - Number(b.dataset.anchorY));
    fields.forEach((field, index) => {
      // Keep long notes from covering another anchor or spilling onto the next PDF page.
      const end = fields[index + 1] ? Number(fields[index + 1].dataset.anchorY) : 1;
      const room = Math.max(24, (end - Number(field.dataset.anchorY)) * entry.aside.clientHeight - 4);
      field.style.minHeight = `${Math.min(32, room)}px`;
      field.style.maxHeight = `${room}px`;
      field.style.height = '0px';
      field.style.height = `${Math.min(room, Math.max(32, field.scrollHeight + 2))}px`;
    });
  };
  const addEditor = (entry, note, focus = false) => {
    const field = doc.createElement('textarea');
    field.className = 'zp-page-note';
    field.setAttribute('aria-label', `第 ${note.page} 页位置笔记`);
    field.style.top = `${note.y * 100}%`;
    field.dataset.anchorY = String(note.y);
    field.value = note.text;
    field.wrap = 'soft';
    field.readOnly = readFailed;
    field.addEventListener('input', () => { note.text = field.value; layout(entry); save(); });
    field.addEventListener('blur', () => {
      if (note.text.trim() || readFailed) return;
      notes = notes.filter((item) => item !== note);
      field.remove(); layout(entry); save();
    });
    entry.aside.append(field);
    layout(entry);
    if (focus) field.focus();
  };
  const sync = () => {
    for (const [node, entry] of mounted) {
      if (!node.isConnected) { entry.resize.disconnect(); mounted.delete(node); }
    }
    for (const node of doc.querySelectorAll('#pdf-pages > .page[data-page]')) {
      if (mounted.has(node)) continue;
      const page = Number(node.dataset.page);
      const aside = doc.createElement('aside');
      aside.className = 'zp-page-notes';
      aside.setAttribute('aria-label', `第 ${page} 页康奈尔笔记`);
      const label = doc.createElement('div');
      label.className = 'zp-page-notes-label'; label.setAttribute('role', 'status');
      aside.append(label);
      // Keep the upstream canvas at firstChild.
      node.append(aside);
      const resize = new doc.defaultView.ResizeObserver(() => layout(entry));
      const entry = { aside, label, page, resize };
      mounted.set(node, entry); resize.observe(node); resize.observe(aside);
      for (const note of notes.filter((item) => item.page === page)) addEditor(entry, note);
      aside.addEventListener('click', (event) => {
        if (event.target !== aside || readFailed) return;
        const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, page,
          y: noteAnchor(event.clientY, node.getBoundingClientRect()), text: '' };
        notes.push(note); addEditor(entry, note, true);
      });
    }
    updateStatus();
  };
  const observer = new doc.defaultView.MutationObserver(sync);
  const container = doc.getElementById('pdf-pages');
  if (container) observer.observe(container, { childList: true });
  sync();
  return () => {
    observer.disconnect();
    for (const entry of mounted.values()) { entry.resize.disconnect(); entry.aside.remove(); }
    mounted.clear(); style.remove();
    doc.documentElement.classList.remove('zp-cornell-visible');
  };
}
