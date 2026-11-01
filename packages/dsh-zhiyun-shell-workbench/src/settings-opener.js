/** Keep the native settings trigger reachable from the product rail.
 *
 * The settings surface belongs to the native `sidebar.settings` entry: it owns
 * the store, the section list and the modal. The product only forwards the
 * entry's own `open` action, so no second settings implementation exists. */
export function createSettingsOpener() {
  let actions;
  return {
    /** Bind the native entry's store actions; returns the unbind callback. */
    attach(next) {
      actions = next;
      return () => { if (actions === next) actions = undefined; };
    },
    /** Open the native panel. @returns whether a native settings entry was present. */
    open() {
      if (actions === undefined) return false;
      actions.open();
      return true;
    },
  };
}
