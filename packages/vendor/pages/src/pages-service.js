import { createPagesState, normalizeConfig } from './state.js';
import { createBrowserPreferences } from './preferences.js';

/** Own page metadata and arrangement; native settings and business data stay native. */
export function createPages(input = {}, options = {}) {
  const config = normalizeConfig(input);
  const preferences = options.preferences ?? (typeof window !== 'undefined' ? createBrowserPreferences(config) : undefined);
  const state = createPagesState(config, config.homePage, { preferences });
  const cleanups = [
    state.registerPage({ id: config.homePage, label: config.homeLabel, icon: config.homeIcon, glyph: '⌂', order: 0 }),
    state.registerPage({ id: config.managerPage, label: config.managerLabel, icon: config.managerIcon, glyph: '▦', order: 90, region: 'bottom' }),
  ];
  return {
    state,
    service: {
      config,
      getSnapshot: state.getSnapshot,
      subscribe: state.subscribe,
      selectPage: state.selectPage,
      registerPage: state.registerPage,
      /** 某页的生命周期钩子（`{ onActivate?, onDeactivate? }`）；壳在切页时调用。 */
      lifecycleOf: state.lifecycleOf,
      setPageRegion: state.setPageRegion,
      setPagePinned: state.setPagePinned,
      setRailWidth: state.setRailWidth,
      setRailPosition: state.setRailPosition,
      setDefaultRailWidth: state.setDefaultRailWidth,
      setRailPlaceholderIcon: state.setRailPlaceholderIcon,
      setPageOrder: state.setPageOrder,
      promotePage: state.promotePage,
    },
    dispose() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); },
  };
}
