/** Host half: the plugin only renders in the browser. */
export const name = 'dsh-pages';

/**
 * No host behavior. The client bundle is discovered through the host loader
 * entry, which is why this file must exist even though it does nothing.
 */
export function apply() {}
