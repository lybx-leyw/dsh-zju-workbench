/** Outer page selection is independent of the native layout's panel selection. */
export function createWorkbenchState() {
  let snapshot = { activePage: 'today', navigationHost: null, pageHost: null };
  const listeners = new Set();
  const publish = patch => {
    if (Object.entries(patch).every(([key, value]) => snapshot[key] === value)) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    selectPage(activePage) { publish({ activePage }); },
    attachNavigation(navigationHost) { publish({ navigationHost }); },
    attachPage(pageHost) { publish({ pageHost }); },
  };
}

/** DSH 0.2 adapter: preserve the root entry's declarations, inject face and store.
 * Restore only our own wrapper, never overwrite a subsequent owner's change. */
export function adaptNativeRoot(slots, wrap) {
  let entry;
  let original;
  let adapted;
  const restore = () => {
    if (entry && entry.component === adapted) entry.component = original;
  };
  const bind = () => {
    const next = slots.entries('root')[0];
    if (next === entry) return;
    restore();
    entry = next;
    if (!entry) return;
    original = entry.component;
    adapted = wrap(original);
    entry.component = adapted;
  };
  bind();
  const off = slots.subscribe('root', bind);
  return () => { off(); restore(); };
}
