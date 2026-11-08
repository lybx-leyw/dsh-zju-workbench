/** Browser-local preferences. Runtime objects and registrations never enter storage. */
import { PAGE_REGIONS, RAIL_POSITIONS, RAIL_WIDTH, validRailWidth } from './state.js';

const VERSION = 1;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = () => ({ version: VERSION, pages: Object.create(null) });

/** Preserve the existing product identity; never include transport tokens. */
export function preferencesStorageKey(config) {
  return 'dsh-pages:preferences:v1:' + encodeURIComponent(JSON.stringify([
    config.navigationSlot, config.pageSlot, config.classPrefix, config.homePage,
  ]));
}

export function decodePreferences(value) {
  if (!isRecord(value) || value.version !== VERSION || !isRecord(value.pages)) throw new Error('unsupported preferences document');
  const result = empty();
  if (validRailWidth(value.railWidth)) result.railWidth = value.railWidth;
  if (RAIL_POSITIONS.includes(value.railPosition)) result.railPosition = value.railPosition;
  for (const [id, arrangement] of Object.entries(value.pages)) {
    if (!id || !isRecord(arrangement)) continue;
    const saved = {};
    if (PAGE_REGIONS.includes(arrangement.region)) saved.region = arrangement.region;
    if (Number.isFinite(arrangement.order)) saved.order = arrangement.order;
    if (typeof arrangement.pinned === 'boolean') saved.pinned = arrangement.pinned;
    if (Number.isFinite(arrangement.pinOrder) && arrangement.pinOrder >= 0) saved.pinOrder = arrangement.pinOrder;
    if (Object.keys(saved).length) result.pages[id] = saved;
  }
  // Unknown fields (including retired export selections) are deliberately ignored.
  return result;
}

export function createBrowserPreferences(config, { getStorage = () => globalThis.localStorage, warn = (...args) => console.warn(...args) } = {}) {
  const key = preferencesStorageKey(config);
  let document = empty();
  const report = error => warn('dsh-pages: browser preferences unavailable or invalid; continuing with in-memory settings.', error);
  try {
    const storage = getStorage();
    if (!storage) throw new Error('localStorage is unavailable');
    const raw = storage.getItem(key);
    if (raw !== null && raw !== undefined) document = decodePreferences(JSON.parse(raw));
  } catch (error) { report(error); }
  const save = () => {
    try {
      const storage = getStorage();
      if (!storage) throw new Error('localStorage is unavailable');
      storage.setItem(key, JSON.stringify(document));
    } catch (error) { report(error); }
  };
  return {
    key,
    getRailPosition() { return document.railPosition; },
    setRailPosition(position) {
      if (!RAIL_POSITIONS.includes(position)) throw new RangeError(`dsh-pages: navigation position must be one of ${RAIL_POSITIONS.join(', ')}`);
      document.railPosition = position;
      save();
    },
    getRailWidth() {
      return document.railWidth ?? (validRailWidth(config.defaultRailWidth) ? config.defaultRailWidth : RAIL_WIDTH.default);
    },
    setRailWidth(width) {
      if (!validRailWidth(width)) throw new RangeError('dsh-pages: navigation width must be an integer between 40 and 96');
      document.railWidth = width;
      save();
    },
    getArrangement(id) { return { ...document.pages[id] }; },
    setArrangement(id, patch) {
      const next = { ...document.pages[id], ...patch };
      const valid = {};
      if (PAGE_REGIONS.includes(next.region)) valid.region = next.region;
      if (Number.isFinite(next.order)) valid.order = next.order;
      if (typeof next.pinned === 'boolean') valid.pinned = next.pinned;
      if (Number.isFinite(next.pinOrder) && next.pinOrder >= 0) valid.pinOrder = next.pinOrder;
      document.pages[id] = valid;
      save();
    },
  };
}
