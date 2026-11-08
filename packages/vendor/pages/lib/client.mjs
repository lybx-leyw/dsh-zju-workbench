// src/state.js
function isLocalizedText(value) {
  return value !== null && typeof value === "object" && typeof value.en === "string" && Object.values(value).every((entry) => typeof entry === "string");
}
function normalizeConfig(input = {}) {
  const text = (key, fallback) => {
    const value = input[key] ?? fallback;
    if (typeof value === "string" && value.length > 0 || isLocalizedText(value)) return value;
    throw new Error(`dsh-pages: \`${key}\` must be a non-empty string or LocalizedText`);
  };
  const id = (key, fallback) => {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || value.length === 0) throw new Error(`dsh-pages: \`${key}\` must be a non-empty string`);
    return value;
  };
  const homePage = id("homePage", "home");
  const managerPage = id("managerPage", "pages");
  const pageSlot = id("pageSlot", "page.content");
  if (!pageSlot.startsWith("page.")) throw new Error("dsh-pages: `pageSlot` must start with page.");
  if (homePage === managerPage) throw new Error("dsh-pages: `managerPage` must differ from `homePage`");
  const railActionSlot = id("railActionSlot", "page.rail-action");
  if (!railActionSlot.startsWith("page.") || railActionSlot === pageSlot) {
    throw new Error("dsh-pages: `railActionSlot` must start with page. and differ from pageSlot");
  }
  const railPosition = input.railPosition ?? "left";
  if (!RAIL_POSITIONS.includes(railPosition)) throw new Error(`dsh-pages: \`railPosition\` must be one of ${RAIL_POSITIONS.join(", ")}`);
  return {
    homePage,
    managerPage,
    pageSlot,
    classPrefix: id("classPrefix", "dsh-pages"),
    navigationSlot: id("navigationSlot", "page.navigation"),
    homeLabel: text("homeLabel", { en: "DSH workbench", zh: "DSH \u5DE5\u4F5C\u53F0" }),
    managerLabel: text("managerLabel", { en: "Pages", zh: "\u9875\u9762\u7BA1\u7406" }),
    // The product's own opening width and the value "reset width" returns to.
    // Omitted means the shell fallback; an out-of-range value is ignored rather
    // than thrown, so a product typo cannot stop the shell from booting.
    defaultRailWidth: validRailWidth(input.defaultRailWidth) ? input.defaultRailWidth : void 0,
    railActionSlot,
    railPosition,
    railPlaceholderIcon: input.railPlaceholderIcon,
    homeIcon: input.homeIcon,
    managerIcon: input.managerIcon
  };
}
var PAGE_REGIONS = Object.freeze(["top", "overflow", "bottom"]);
var RAIL_POSITIONS = Object.freeze(["left", "top", "bottom", "right"]);
var RAIL_WIDTH = Object.freeze({ min: 40, max: 96, default: 64 });
function validRailWidth(width) {
  return Number.isInteger(width) && width >= RAIL_WIDTH.min && width <= RAIL_WIDTH.max;
}
function createPagesState(config, initialPage = config.homePage, { preferences } = {}) {
  const defaultWidth = validRailWidth(config.defaultRailWidth) ? config.defaultRailWidth : RAIL_WIDTH.default;
  const storedPosition = preferences?.getRailPosition?.();
  const railPosition = RAIL_POSITIONS.includes(storedPosition) ? storedPosition : config.railPosition ?? "left";
  let snapshot = { railPosition, railWidth: preferences?.getRailWidth?.() ?? defaultWidth, defaultRailWidth: defaultWidth, railPlaceholderIcon: config.railPlaceholderIcon, activePage: initialPage, pages: Object.freeze([]) };
  const listeners = /* @__PURE__ */ new Set();
  const pages = /* @__PURE__ */ new Map();
  const registrations = /* @__PURE__ */ new Map();
  const lifecycle = /* @__PURE__ */ new Map();
  let sequence = 0;
  const publish = (patch) => {
    if (Object.entries(patch).every(([key, value]) => snapshot[key] === value)) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const publishPages = (patch = {}) => publish({
    ...patch,
    pages: Object.freeze([...pages.values()].sort((a, b) => a.order - b.order || a.seq - b.seq).map((entry) => Object.freeze({ ...entry })))
  });
  const validateRegion = (region) => {
    if (!PAGE_REGIONS.includes(region)) throw new Error(`dsh-pages: page \`region\` must be one of ${PAGE_REGIONS.join(", ")}`);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectPage(activePage) {
      if (!pages.has(activePage)) throw new Error(`dsh-pages: unknown page "${activePage}"`);
      publish({ activePage });
    },
    /** A client-owned component, not a persisted user preference. */
    setRailPlaceholderIcon(icon) {
      if (icon !== void 0 && typeof icon !== "function" && (icon === null || typeof icon !== "object")) {
        throw new TypeError("dsh-pages: rail placeholder icon must be a component or undefined");
      }
      publish({ railPlaceholderIcon: icon });
    },
    /** Product defaults are client-owned, separate from the user's saved width. */
    setDefaultRailWidth(width) {
      if (!validRailWidth(width)) throw new RangeError("dsh-pages: default navigation width must be an integer between 40 and 96");
      publish({ defaultRailWidth: width });
    },
    setRailPosition(position) {
      if (!RAIL_POSITIONS.includes(position)) throw new RangeError(`dsh-pages: navigation position must be one of ${RAIL_POSITIONS.join(", ")}`);
      preferences?.setRailPosition?.(position);
      publish({ railPosition: position });
    },
    setRailWidth(width) {
      if (!validRailWidth(width)) throw new RangeError("dsh-pages: navigation width must be an integer between 40 and 96");
      preferences?.setRailWidth?.(width);
      publish({ railWidth: width });
    },
    /** The returned disposer removes only this live registration, never a later one. */
    registerPage(spec) {
      if (spec === null || typeof spec !== "object") throw new TypeError("dsh-pages: registerPage() needs a spec object");
      const { id, label, icon } = spec;
      if (typeof id !== "string" || !id) throw new Error("dsh-pages: page `id` must be a non-empty string");
      if (!(typeof label === "string" && label.length > 0) && !isLocalizedText(label)) throw new Error("dsh-pages: page `label` must be a non-empty string or LocalizedText");
      if (pages.has(id)) throw new Error(`dsh-pages: page "${id}" is already registered`);
      const region = spec.region ?? "top";
      validateRegion(region);
      const order = spec.order ?? 0;
      if (!Number.isFinite(order)) throw new Error("dsh-pages: page `order` must be a finite number");
      if (icon !== void 0 && typeof icon !== "function" && (icon === null || typeof icon !== "object")) throw new Error("dsh-pages: page `icon` must be a component");
      const onActivate = typeof spec.onActivate === "function" ? spec.onActivate : void 0;
      const onDeactivate = typeof spec.onDeactivate === "function" ? spec.onDeactivate : void 0;
      const entry = { id, label, icon, glyph: spec.glyph ?? "\u25CF", region, order, seq: ++sequence, ...preferences?.getArrangement(id) };
      pages.set(id, entry);
      registrations.set(id, entry);
      if (onActivate !== void 0 || onDeactivate !== void 0) {
        lifecycle.set(id, { onActivate, onDeactivate });
      }
      publishPages();
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        if (registrations.get(id) !== entry) return;
        pages.delete(id);
        registrations.delete(id);
        const hooks = lifecycle.get(id);
        lifecycle.delete(id);
        if (hooks?.onDeactivate !== void 0) {
          try {
            hooks.onDeactivate();
          } catch (error) {
            console.warn(`[dsh-pages] page "${id}" onDeactivate threw:`, error);
          }
        }
        publishPages(snapshot.activePage === id ? { activePage: config.homePage } : {});
      };
    },
    /**
     * 取某页的生命周期钩子。
     * @param id - 页面 id。
     * @returns `{ onActivate?, onDeactivate? }`，未注册时为空对象。
     */
    lifecycleOf(id) {
      return lifecycle.get(id) ?? {};
    },
    setPageRegion(id, region) {
      validateRegion(region);
      const entry = pages.get(id);
      if (!entry) return false;
      preferences?.setArrangement(id, { region });
      if (entry.region === region) return false;
      if (entry.pinned) preferences?.setArrangement(id, { pinned: false, pinOrder: 0 });
      pages.set(id, { ...entry, region, pinned: false, pinOrder: 0 });
      publishPages();
      return true;
    },
    /** Append/remove a shortcut; do not change recycle membership or register a page. */
    setPagePinned(id, pinned) {
      const entry = pages.get(id);
      if (!entry || entry.region !== "overflow" || Boolean(entry.pinned) === Boolean(pinned)) return false;
      const pinOrder = pinned ? Math.max(0, ...[...pages.values()].map((page) => page.pinOrder || 0)) + 1 : 0;
      const patch = { pinned: Boolean(pinned), pinOrder };
      preferences?.setArrangement(id, { region: "overflow", ...patch });
      pages.set(id, { ...entry, ...patch });
      publishPages();
      return true;
    },
    setPageOrder(id, order) {
      if (!Number.isFinite(order)) throw new Error("dsh-pages: page `order` must be a finite number");
      const entry = pages.get(id);
      if (!entry) return false;
      preferences?.setArrangement(id, { order });
      if (entry.order === order) return false;
      pages.set(id, { ...entry, order });
      publishPages();
      return true;
    },
    /** Move to the front of the default top group, distinct from pinning. */
    promotePage(id) {
      const entry = pages.get(id);
      if (!entry) return false;
      const others = [...pages.values()].filter((page) => page.region === "top" && page.id !== id);
      const first = others.length ? Math.min(...others.map((page) => page.order)) : void 0;
      if (entry.region === "top" && (first === void 0 || entry.order < first)) {
        preferences?.setArrangement(id, { region: "top", order: entry.order });
        return false;
      }
      const patch = { region: "top", order: first === void 0 ? 0 : first - 1, pinned: false, pinOrder: 0 };
      pages.set(id, { ...entry, ...patch });
      preferences?.setArrangement(id, patch);
      publishPages();
      return true;
    }
  };
}

// src/page-shell.jsx
import React2, { useEffect, useLayoutEffect, useId, useRef, useState } from "react";

// src/preferences.js
var VERSION = 1;
var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var empty = () => ({ version: VERSION, pages: /* @__PURE__ */ Object.create(null) });
function preferencesStorageKey(config) {
  return "dsh-pages:preferences:v1:" + encodeURIComponent(JSON.stringify([
    config.navigationSlot,
    config.pageSlot,
    config.classPrefix,
    config.homePage
  ]));
}
function decodePreferences(value) {
  if (!isRecord(value) || value.version !== VERSION || !isRecord(value.pages)) throw new Error("unsupported preferences document");
  const result = empty();
  if (validRailWidth(value.railWidth)) result.railWidth = value.railWidth;
  if (RAIL_POSITIONS.includes(value.railPosition)) result.railPosition = value.railPosition;
  for (const [id, arrangement] of Object.entries(value.pages)) {
    if (!id || !isRecord(arrangement)) continue;
    const saved = {};
    if (PAGE_REGIONS.includes(arrangement.region)) saved.region = arrangement.region;
    if (Number.isFinite(arrangement.order)) saved.order = arrangement.order;
    if (typeof arrangement.pinned === "boolean") saved.pinned = arrangement.pinned;
    if (Number.isFinite(arrangement.pinOrder) && arrangement.pinOrder >= 0) saved.pinOrder = arrangement.pinOrder;
    if (Object.keys(saved).length) result.pages[id] = saved;
  }
  return result;
}
function createBrowserPreferences(config, { getStorage = () => globalThis.localStorage, warn = (...args) => console.warn(...args) } = {}) {
  const key = preferencesStorageKey(config);
  let document2 = empty();
  const report = (error) => warn("dsh-pages: browser preferences unavailable or invalid; continuing with in-memory settings.", error);
  try {
    const storage = getStorage();
    if (!storage) throw new Error("localStorage is unavailable");
    const raw = storage.getItem(key);
    if (raw !== null && raw !== void 0) document2 = decodePreferences(JSON.parse(raw));
  } catch (error) {
    report(error);
  }
  const save = () => {
    try {
      const storage = getStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      storage.setItem(key, JSON.stringify(document2));
    } catch (error) {
      report(error);
    }
  };
  return {
    key,
    getRailPosition() {
      return document2.railPosition;
    },
    setRailPosition(position) {
      if (!RAIL_POSITIONS.includes(position)) throw new RangeError(`dsh-pages: navigation position must be one of ${RAIL_POSITIONS.join(", ")}`);
      document2.railPosition = position;
      save();
    },
    getRailWidth() {
      return document2.railWidth ?? (validRailWidth(config.defaultRailWidth) ? config.defaultRailWidth : RAIL_WIDTH.default);
    },
    setRailWidth(width) {
      if (!validRailWidth(width)) throw new RangeError("dsh-pages: navigation width must be an integer between 40 and 96");
      document2.railWidth = width;
      save();
    },
    getArrangement(id) {
      return { ...document2.pages[id] };
    },
    setArrangement(id, patch) {
      const next = { ...document2.pages[id], ...patch };
      const valid = {};
      if (PAGE_REGIONS.includes(next.region)) valid.region = next.region;
      if (Number.isFinite(next.order)) valid.order = next.order;
      if (typeof next.pinned === "boolean") valid.pinned = next.pinned;
      if (Number.isFinite(next.pinOrder) && next.pinOrder >= 0) valid.pinOrder = next.pinOrder;
      document2.pages[id] = valid;
      save();
    }
  };
}

// src/pages-service.js
function createPages(input = {}, options = {}) {
  const config = normalizeConfig(input);
  const preferences = options.preferences ?? (typeof window !== "undefined" ? createBrowserPreferences(config) : void 0);
  const state = createPagesState(config, config.homePage, { preferences });
  const cleanups = [
    state.registerPage({ id: config.homePage, label: config.homeLabel, icon: config.homeIcon, glyph: "\u2302", order: 0 }),
    state.registerPage({ id: config.managerPage, label: config.managerLabel, icon: config.managerIcon, glyph: "\u25A6", order: 90, region: "bottom" })
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
      promotePage: state.promotePage
    },
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    }
  };
}

// src/page-manager.jsx
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var REGIONS = ["top", "overflow", "bottom"];
var DRAG_TYPE = "application/x-dsh-pages-manager";
var styles = `
[data-pages-manager]{box-sizing:border-box;width:100%;max-width:960px;min-width:0;margin:0 auto;padding:clamp(16px,4vw,40px);color:var(--dsw-alias-label-primary,#101318);font:inherit;overflow-wrap:anywhere}
[data-pages-manager] *{box-sizing:border-box;min-width:0}
[data-pages-manager] h2{margin:0;font-size:24px;letter-spacing:-.04em;font-weight:600}
[data-pages-manager] header p{margin:8px 0 28px;color:var(--dsw-alias-label-secondary,#6b7178);font-size:13px;line-height:1.6}
[data-pages-manager] section{margin:0 0 26px}
[data-pages-manager] h3{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6b7178)}
[data-pages-manager] h3 span{font:11px ui-monospace,monospace;opacity:.6}
[data-pages-manager] ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;min-height:48px;border-radius:8px}
[data-pages-manager] li{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-settings-card-stroke,#00000014);border-radius:8px;background:var(--dsw-alias-settings-card-fill,#00000005)}
[data-pages-manager] li[draggable=true]{cursor:grab}
[data-pages-manager] li[data-dragging=true]{opacity:.4}
[data-pages-manager] li[data-insert=before]{box-shadow:inset 0 3px var(--dsw-alias-brand-primary,#2f6fed)}
[data-pages-manager] li[data-insert=after]{box-shadow:inset 0 -3px var(--dsw-alias-brand-primary,#2f6fed)}
[data-pages-manager] ul[data-drop=true]{outline:2px dashed var(--dsw-alias-brand-primary,#2f6fed);outline-offset:3px}
[data-pages-manager] .pm-identity{display:flex;align-items:center;gap:10px;flex:1 1 180px}
[data-pages-manager] .pm-grip{color:var(--dsw-alias-label-caption,#8a9099);user-select:none}
[data-pages-manager] .pm-icon{display:grid;place-items:center;width:22px;height:22px;flex:none}
[data-pages-manager] .pm-icon svg{width:20px;height:20px}
[data-pages-manager] .pm-name{font-size:13px;font-weight:500}
[data-pages-manager] .pm-id{display:block;margin-top:2px;font:10px ui-monospace,monospace;color:var(--dsw-alias-label-caption,#8a9099)}
[data-pages-manager] .pm-actions{display:flex;flex:0 1 auto;flex-wrap:wrap;align-items:center;gap:6px;max-width:100%}
[data-pages-manager] button,[data-pages-manager] select{min-height:32px;max-width:100%;border:1px solid var(--dsw-alias-settings-card-stroke,#0000001f);border-radius:5px;background:var(--dsw-alias-bg-base,#f4f5f7);color:var(--dsw-alias-label-secondary,#4b5058);font:inherit;font-size:12px;padding:4px 8px;cursor:pointer}
/* A native <select> draws its arrow inside the content box, so Latin-size
   padding put the arrow on top of CJK labels (\u6C49\u5B57 is about twice as wide as
   the Latin glyphs the default padding assumed). Reserve the arrow's own space
   explicitly and draw the arrow ourselves instead of relying on the UA's. */
[data-pages-manager] select{
  appearance:none;-webkit-appearance:none;-moz-appearance:none;
  padding:4px 26px 4px 9px;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 13px) 52%,calc(100% - 8px) 52%;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;
}
[data-pages-manager] button{min-width:32px;white-space:normal;overflow-wrap:anywhere}
[data-pages-manager] button:hover:not(:disabled){background:var(--dsw-alias-button-elevated-fill,#0000000f)}
[data-pages-manager] :is(button,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:2px}
[data-pages-manager] button:disabled{opacity:.35;cursor:not-allowed}
[data-pages-manager] button[role=switch][aria-checked=false]{color:var(--dsw-alias-label-caption,#8a9099)}
[data-pages-manager] .pm-empty{display:flex;align-items:center;border-style:dashed;color:var(--dsw-alias-label-caption,#8a9099);font-size:12px;min-height:48px}
@media(max-width:560px){[data-pages-manager] .pm-identity{flex-basis:100%}[data-pages-manager] .pm-actions{flex:1 1 100%}[data-pages-manager] li{padding:10px}}
`;
function PageManager({ entries, railWidth = 64, defaultRailWidth = 64, railPosition = "left", resolveLabel, actions, t }) {
  const sizeLabel = t(railPosition === "top" || railPosition === "bottom" ? "navigationHeight" : "navigationWidth");
  const [dragging, setDragging] = React.useState(null);
  const [dropAt, setDropAt] = React.useState(null);
  const regionOf = (entry) => REGIONS.includes(entry.region) ? entry.region : "overflow";
  const ordered = [...entries].sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0));
  const groups = Object.fromEntries(REGIONS.map((region) => [region, ordered.filter((entry) => regionOf(entry) === region)]));
  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };
  const normalize = (list) => list.forEach((entry, index) => actions.setPageOrder(entry.id, index));
  const relocate = (id, region, targetId = null, side = "after", promote = false) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry || id === targetId) return;
    const source = regionOf(entry);
    const destination = groups[region].filter((item) => item.id !== id);
    const targetIndex = destination.findIndex((item) => item.id === targetId);
    const index = promote ? 0 : targetIndex < 0 ? destination.length : targetIndex + (side === "after" ? 1 : 0);
    destination.splice(index, 0, entry);
    if (promote) actions.promotePage(id);
    else if (source !== region) actions.setPageRegion(id, region);
    if (source !== region) normalize(groups[source].filter((item) => item.id !== id));
    normalize(destination);
  };
  const move = (entry, region, delta) => {
    const list = [...groups[region]];
    const index = list.findIndex((item) => item.id === entry.id);
    if (index < 0 || index + delta < 0 || index + delta >= list.length) return;
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    normalize(list);
  };
  const carriedId = (event) => {
    const transferred = event.dataTransfer?.getData(DRAG_TYPE) || event.dataTransfer?.getData("text/plain");
    return entries.some((entry) => entry.id === transferred) ? transferred : dragging;
  };
  const canDrop = () => dragging !== null;
  const regionTitle = (region) => t(region === "top" ? "managerTop" : region === "bottom" ? "managerBottom" : "managerHidden");
  return /* @__PURE__ */ jsxs("div", { "data-pages-manager": "", children: [
    /* @__PURE__ */ jsx("style", { "data-pages-manager-style": "", children: styles }),
    /* @__PURE__ */ jsxs("header", { children: [
      /* @__PURE__ */ jsx("h2", { children: t("managerTitle") }),
      /* @__PURE__ */ jsx("p", { children: t("managerHint") })
    ] }),
    actions.setRailPosition && /* @__PURE__ */ jsx("section", { "aria-label": t("navigationPosition"), children: /* @__PURE__ */ jsxs("label", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx("span", { children: t("navigationPosition") }),
      /* @__PURE__ */ jsx(
        "select",
        {
          "aria-label": t("navigationPosition"),
          value: railPosition,
          onChange: (event) => actions.setRailPosition(event.target.value),
          children: RAIL_POSITIONS.map((position) => /* @__PURE__ */ jsx("option", { value: position, children: t(`position${position[0].toUpperCase()}${position.slice(1)}`) }, position))
        }
      )
    ] }) }),
    actions.setRailWidth && /* @__PURE__ */ jsx("section", { "aria-label": sizeLabel, children: /* @__PURE__ */ jsxs("label", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx("span", { children: sizeLabel }),
      /* @__PURE__ */ jsx(
        "input",
        {
          "aria-label": sizeLabel,
          type: "range",
          min: "40",
          max: "96",
          step: "1",
          value: railWidth,
          onChange: (event) => actions.setRailWidth(Number(event.target.value))
        }
      ),
      /* @__PURE__ */ jsxs("output", { children: [
        railWidth,
        " px"
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => actions.setRailWidth(defaultRailWidth), children: t("resetWidth") })
    ] }) }),
    REGIONS.map((region) => /* @__PURE__ */ jsxs("section", { "aria-label": regionTitle(region), children: [
      /* @__PURE__ */ jsxs("h3", { children: [
        regionTitle(region),
        " ",
        /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: groups[region].length })
      ] }),
      /* @__PURE__ */ jsxs(
        "ul",
        {
          "aria-label": regionTitle(region),
          "data-group": region,
          "data-drop": dropAt?.region === region && dropAt.id === null,
          onDragOver: (event) => {
            if (!canDrop(region) || event.target !== event.currentTarget && groups[region].length) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropAt({ region, id: null, side: "after" });
          },
          onDragLeave: (event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDropAt(null);
          },
          onDrop: (event) => {
            event.preventDefault();
            const id = carriedId(event);
            if (id !== null) relocate(id, region);
            endDrag();
          },
          children: [
            groups[region].length === 0 && /* @__PURE__ */ jsx("li", { className: "pm-empty", children: t("managerEmpty") }),
            groups[region].map((entry, index) => {
              const label = resolveLabel(entry);
              const visible = region !== "overflow";
              const visibilityKey = visible ? "managerHide" : "managerShow";
              const Icon = entry.icon;
              return /* @__PURE__ */ jsxs(
                "li",
                {
                  "aria-label": label,
                  draggable: true,
                  "data-dragging": dragging === entry.id,
                  "data-insert": dropAt?.region === region && dropAt.id === entry.id ? dropAt.side : void 0,
                  onDragStart: (event) => {
                    if (event.target.closest?.("button,select")) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData(DRAG_TYPE, entry.id);
                    event.dataTransfer.setData("text/plain", entry.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(entry.id);
                  },
                  onDragEnd: endDrag,
                  onDragOver: (event) => {
                    event.stopPropagation();
                    if (!canDrop(region) || dragging === entry.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setDropAt({ region, id: entry.id, side: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
                  },
                  onDrop: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    relocate(carriedId(event), region, entry.id, event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
                    endDrag();
                  },
                  children: [
                    /* @__PURE__ */ jsxs("div", { className: "pm-identity", children: [
                      /* @__PURE__ */ jsx("span", { className: "pm-grip", "aria-hidden": "true", children: "\u283F" }),
                      /* @__PURE__ */ jsx("span", { className: "pm-icon", "aria-hidden": "true", children: Icon ? /* @__PURE__ */ jsx(Icon, {}) : entry.glyph }),
                      /* @__PURE__ */ jsxs("div", { children: [
                        /* @__PURE__ */ jsx("span", { className: "pm-name", children: label }),
                        /* @__PURE__ */ jsx("span", { className: "pm-id", children: entry.id })
                      ] })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { className: "pm-actions", children: [
                      /* @__PURE__ */ jsx(
                        "select",
                        {
                          "aria-label": `${t("managerGroup")} ${label}`,
                          value: region,
                          onChange: (event) => relocate(entry.id, event.target.value),
                          children: REGIONS.map((value) => /* @__PURE__ */ jsx("option", { value, children: regionTitle(value) }, value))
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          role: "switch",
                          "aria-checked": visible,
                          "aria-label": `${t(visibilityKey)} ${label}`,
                          onClick: () => relocate(entry.id, visible ? "overflow" : "top"),
                          children: t(visibilityKey)
                        }
                      ),
                      region === "overflow" && actions.setPagePinned && /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          "aria-pressed": Boolean(entry.pinned),
                          "aria-label": `${t(entry.pinned ? "unpin" : "pin")} ${label}`,
                          onClick: () => actions.setPagePinned(entry.id, !entry.pinned),
                          children: t(entry.pinned ? "unpin" : "pin")
                        }
                      ),
                      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": `${t("managerUp")} ${label}`, disabled: index === 0, onClick: () => move(entry, region, -1), children: "\u2191" }),
                      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": `${t("managerDown")} ${label}`, disabled: index === groups[region].length - 1, onClick: () => move(entry, region, 1), children: "\u2193" }),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          "aria-label": `${t("managerPin")} ${label}`,
                          disabled: region === "top" && index === 0,
                          onClick: () => relocate(entry.id, "top", null, "before", true),
                          children: "\u21C8"
                        }
                      ),
                      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": `${t("managerOpen")} ${label}`, onClick: () => actions.selectPage(entry.id), children: t("managerOpen") })
                    ] })
                  ]
                },
                entry.id
              );
            })
          ]
        }
      )
    ] }, region))
  ] });
}

// src/host-face.js
var HostFace = class {
  /**
   * @param {object} options
   * @param {() => object | undefined} options.getLayout - 惰性取 `ctx.layout`。
   * @param {() => Document | undefined} options.getDocument - 惰性取 document（测试可注入）。
   */
  constructor({ getLayout, getDocument }) {
    this._getLayout = getLayout;
    this._getDocument = getDocument;
  }
  /** 当前文档；SSR/测试环境下为 undefined。 */
  get document() {
    return this._getDocument();
  }
  // ── 右栏 ────────────────────────────────────────────────
  /**
   * 右栏当前是否展开。
   *
   * 优先读服务（`panelInfo` 的 observable）；服务缺席时回落到 DOM 标记。
   * @returns {boolean}
   */
  rightbarOpen() {
    const layout = this._getLayout();
    const info = layout?.panelInfo;
    if (info !== void 0 && typeof info.getSnapshot === "function") {
      try {
        const snapshot = info.getSnapshot();
        if (typeof snapshot?.cols?.rightbar === "number") return snapshot.cols.rightbar > 0;
      } catch {
      }
    }
    const doc = this.document;
    if (doc === void 0) return false;
    return doc.querySelector("[data-sidebar-right-panel][data-sidebar-right-open]") !== null;
  }
  /**
   * 展开右栏。
   * @param {{ track?: boolean, fullscreen?: boolean }} options - 见 `ILayout.openRightbar`。
   * @returns {boolean} 是否成功（服务缺席时为 false，调用方据此决定要不要回退）。
   */
  openRightbar({ track = true, fullscreen = false } = {}) {
    const layout = this._getLayout();
    if (typeof layout?.openRightbar !== "function") return false;
    try {
      layout.openRightbar(track, fullscreen);
      return true;
    } catch {
      return false;
    }
  }
  /** 收起右栏。@returns {boolean} 是否成功。 */
  closeRightbar() {
    const layout = this._getLayout();
    if (typeof layout?.closeRightbar !== "function") return false;
    try {
      layout.closeRightbar();
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 右栏面板的**内容区矩形**（用于把浮层对齐到它）。
   *
   * 这是唯一必须读 DOM 的几何：服务只报轨道宽度，不报面板滚到哪里、
   * 被 dockkit 的列偏移了多少。
   *
   * @returns {DOMRect | null} 未展开或文档缺席时为 null。
   */
  rightbarRect() {
    const doc = this.document;
    if (doc === void 0) return null;
    const panel = doc.querySelector("[data-sidebar-right-panel]");
    if (panel === null) return null;
    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }
  /**
   * 宿主三栏框架的当前轨道宽度（`grid-template-columns`）。
   *
   * 同样只有 DOM 能给。返回值按需解析失败时为空数组。
   * @returns {number[]}
   */
  frameTracks() {
    const doc = this.document;
    if (doc === void 0) return [];
    const col = doc.querySelector("[data-rightbar-col]");
    const frame = col?.parentElement;
    if (frame === void 0 || frame === null) return [];
    try {
      return getComputedStyle(frame).gridTemplateColumns.split(" ").map(parseFloat).filter(Number.isFinite);
    } catch {
      return [];
    }
  }
  // ── 左栏 ────────────────────────────────────────────────
  /** 切换左栏（服务面）。@returns {boolean} */
  toggleSidebar() {
    const layout = this._getLayout();
    if (typeof layout?.toggleSidebar !== "function") return false;
    try {
      layout.toggleSidebar();
      return true;
    } catch {
      return false;
    }
  }
  // ── 主题 ────────────────────────────────────────────────
  /**
   * 宿主当前是否深色，与具体主题服务解耦。
   *
   * 读的是渲染后的事实（根元素的 `data-theme` / 背景），不是服务的内部状态 ——
   * 页面只关心「我现在该用哪套颜色」。
   * @returns {'dark' | 'light'}
   */
  colorScheme() {
    const doc = this.document;
    if (doc === void 0) return "light";
    const root = doc.documentElement;
    const declared = root.getAttribute("data-theme") ?? root.getAttribute("data-color-scheme");
    if (declared === "dark" || declared === "light") return declared;
    try {
      return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
    } catch {
      return "light";
    }
  }
};
function createHostFace(ctx, options = {}) {
  const getDocument = options.getDocument ?? (() => typeof document === "undefined" ? void 0 : document);
  return new HostFace({
    // 惰性取：`layout` 是可选的，缺席时 `HostFace` 自动回落到 DOM 读。
    getLayout: () => {
      try {
        return ctx.get("layout");
      } catch {
        return void 0;
      }
    },
    getDocument
  });
}

// src/page-shell.jsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var namespace = "dsh-pages";
var translations = {
  en: {
    navigation: "Pages",
    back: "Back to workbench",
    more: "More pages",
    pin: "Pin to top group",
    unpin: "Unpin",
    managerTitle: "Page manager",
    managerHint: "Arrange the top, recycle and bottom groups. Recycled pages remain accessible in \u2026; pin them to append shortcuts after \u2026 in the top group.",
    managerTop: "Top group",
    managerBottom: "Bottom group",
    managerHidden: "Recycle group",
    managerEmpty: "No pages here.",
    managerUp: "Move up",
    managerDown: "Move down",
    managerShow: "Show",
    managerHide: "Hide",
    navigationWidth: "Navigation width",
    navigationHeight: "Navigation height",
    resetWidth: "Reset size",
    navigationPosition: "Navigation position",
    positionLeft: "Left",
    positionTop: "Top",
    positionBottom: "Bottom",
    positionRight: "Right",
    managerPin: "Move to top",
    managerOpen: "Open",
    managerGroup: "Group"
  },
  zh: {
    navigation: "\u9875\u9762",
    back: "\u8FD4\u56DE\u5DE5\u4F5C\u53F0",
    more: "\u66F4\u591A\u9875\u9762",
    pin: "\u56FA\u5B9A\u5230\u9876\u90E8\u7EC4\u672B\u5C3E",
    unpin: "\u53D6\u6D88\u56FA\u5B9A",
    managerTitle: "\u9875\u9762\u7BA1\u7406",
    managerHint: "\u7BA1\u7406\u9876\u90E8\u9ED8\u8BA4\u7EC4\u3001\u56DE\u6536\u7EC4\u548C\u5E95\u90E8\u7EC4\u3002\u6536\u8D77\u7684\u9875\u9762\u4ECD\u53EF\u4ECE \u2026 \u6253\u5F00\uFF1B\u56FA\u5B9A\u540E\u5728\u9876\u90E8\u7EC4\u7684 \u2026 \u4E0B\u65B9\u8FFD\u52A0\u5165\u53E3\u3002",
    managerTop: "\u9876\u90E8\u7EC4",
    managerBottom: "\u5E95\u90E8\u7EC4",
    managerHidden: "\u56DE\u6536\u7EC4",
    managerEmpty: "\u8FD9\u91CC\u6CA1\u6709\u9875\u9762\u3002",
    managerUp: "\u4E0A\u79FB",
    managerDown: "\u4E0B\u79FB",
    managerShow: "\u663E\u793A",
    managerHide: "\u9690\u85CF",
    navigationWidth: "\u5BFC\u822A\u5BBD\u5EA6",
    navigationHeight: "\u5BFC\u822A\u9AD8\u5EA6",
    resetWidth: "\u6062\u590D\u9ED8\u8BA4\u5C3A\u5BF8",
    navigationPosition: "\u5BFC\u822A\u4F4D\u7F6E",
    positionLeft: "\u5DE6\u4FA7",
    positionTop: "\u9876\u90E8",
    positionBottom: "\u5E95\u90E8",
    positionRight: "\u53F3\u4FA7",
    managerPin: "\u79FB\u5230\u6700\u524D",
    managerOpen: "\u6253\u5F00",
    managerGroup: "\u5206\u7EC4"
  }
};
var secondary = "var(--dsw-alias-label-secondary, #aaa)";
var border = "1px solid var(--dsw-alias-border-l2, #555)";
var surface = "var(--dsw-alias-bg-layer-2, #181818)";
var foreground = "var(--dsw-alias-label-primary, #ddd)";
var layoutCss = (width, position) => `
#root:has([data-dsh-pages-shell]) { box-sizing: border-box; padding-${position}: ${width}px; }
[data-dsh-pages-rail] button:hover { background: var(--dsw-alias-interactive-bg-hover, #333); }
[data-dsh-pages-shell] button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
`;
function RailIcon({ width, children }) {
  return /* @__PURE__ */ jsx2("span", { "data-dsh-pages-rail-icon": "", "aria-hidden": "true", style: {
    display: "grid",
    gridTemplateColumns: "23px",
    gridTemplateRows: "23px",
    placeItems: "center",
    width: 23,
    height: 23,
    lineHeight: 1,
    transform: `scale(${width / 64})`,
    transformOrigin: "center"
  }, children });
}
function PageIcon({ entry }) {
  if (entry.icon) return /* @__PURE__ */ jsx2(entry.icon, {});
  if (typeof entry.glyph === "string" && entry.glyph.length > 0) return /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", children: entry.glyph });
  return null;
}
function PageShell(props) {
  const snapshot = props.usePages((value) => value);
  const previousPageRef = useRef(snapshot.activePage);
  useLayoutEffect(() => {
    const previous = previousPageRef.current;
    const next = snapshot.activePage;
    if (previous === next) return void 0;
    previousPageRef.current = next;
    const outgoing = props.lifecycleOf?.(previous);
    if (outgoing?.onDeactivate !== void 0) {
      try {
        outgoing.onDeactivate();
      } catch (error) {
        console.warn(`[dsh-pages] page "${previous}" onDeactivate threw:`, error);
      }
    }
    const incoming = props.lifecycleOf?.(next);
    if (incoming?.onActivate !== void 0) {
      try {
        incoming.onActivate();
      } catch (error) {
        console.warn(`[dsh-pages] page "${next}" onActivate threw:`, error);
      }
    }
    return void 0;
  }, [snapshot.activePage, props]);
  const railWidth = snapshot.railWidth ?? 64;
  const railPosition = snapshot.railPosition ?? "left";
  const horizontal = railPosition === "top" || railPosition === "bottom";
  const railInset = {
    left: "0 auto 0 0",
    right: "0 0 0 auto",
    top: "0 0 auto 0",
    bottom: "auto 0 0 0"
  }[railPosition];
  const contentInset = {
    left: `0 0 0 ${railWidth}px`,
    right: `0 ${railWidth}px 0 0`,
    top: `${railWidth}px 0 0 0`,
    bottom: `0 0 ${railWidth}px 0`
  }[railPosition];
  const innerBorder = { left: "borderRight", right: "borderLeft", top: "borderBottom", bottom: "borderTop" }[railPosition];
  const selectionShadow = { left: "2px 0", right: "-2px 0", top: "0 2px", bottom: "0 -2px" }[railPosition];
  const scale = railWidth / 64;
  const PlaceholderIcon = snapshot.railPlaceholderIcon;
  const actionFallback = PlaceholderIcon ? /* @__PURE__ */ jsx2(PlaceholderIcon, {}) : /* @__PURE__ */ jsx2("span", { "aria-hidden": "true", style: { fontSize: 11 * scale, letterSpacing: "0.08em", fontWeight: 700 }, children: "P /" });
  const railButton = {
    width: 46 * scale,
    height: 46 * scale,
    minHeight: 46 * scale,
    padding: 0,
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    border: "none",
    borderRadius: 9 * scale,
    cursor: "pointer",
    font: "inherit",
    lineHeight: 1
  };
  const home = props.homePage;
  const open = snapshot.activePage !== home;
  const manager = snapshot.activePage === props.managerPage;
  const shell = useRef(null);
  const moreButton = useRef(null);
  const morePanel = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 });
  const contentId = useId();
  const [menu, setMenu] = useState(null);
  const active = snapshot.pages.find((entry) => entry.id === snapshot.activePage);
  const top = snapshot.pages.filter((entry) => entry.region === "top");
  const parked = snapshot.pages.filter((entry) => entry.region === "overflow");
  useLayoutEffect(() => {
    if (menu !== "more") return void 0;
    const place = () => {
      if (!moreButton.current || !morePanel.current) return;
      const anchor = moreButton.current.getBoundingClientRect();
      const panel = morePanel.current.getBoundingClientRect();
      const x = railPosition === "left" ? railWidth + 8 : railPosition === "right" ? window.innerWidth - railWidth - panel.width - 8 : anchor.left;
      const y = railPosition === "top" ? railWidth + 8 : railPosition === "bottom" ? window.innerHeight - railWidth - panel.height - 8 : anchor.top;
      const left = Math.max(12, Math.min(x, window.innerWidth - panel.width - 12));
      const top2 = Math.max(12, Math.min(y, window.innerHeight - panel.height - 12));
      setMenuPosition((previous) => previous.left === left && previous.top === top2 ? previous : { left, top: top2 });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    if (morePanel.current) observer.observe(morePanel.current);
    if (moreButton.current) observer.observe(moreButton.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [menu, railPosition, railWidth, parked.length]);
  useEffect(() => {
    if (menu === null) return void 0;
    const onPointer = (event) => {
      if (event.target.closest?.("[data-dsh-pages-more], [data-dsh-pages-more-panel]")) return;
      setMenu(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);
  useEffect(() => {
    if (parked.length === 0) setMenu(null);
  }, [parked.length]);
  const keyDown = (event) => {
    if (!open) return;
    event.stopPropagation();
    if (event.key === "Escape" && menu !== null) {
      event.preventDefault();
      setMenu(null);
    }
  };
  const navItem = (entry) => {
    const selected = entry.id === snapshot.activePage;
    const label = props.resolveLabel(entry.label);
    return /* @__PURE__ */ jsx2(
      "button",
      {
        type: "button",
        title: label,
        "aria-label": label,
        "aria-current": selected ? "page" : void 0,
        "aria-controls": entry.id === home ? void 0 : contentId,
        onClick: () => props.selectPage(entry.id),
        style: {
          ...railButton,
          color: selected ? foreground : secondary,
          background: selected ? "var(--dsw-alias-interactive-bg-hover, #333)" : "transparent",
          boxShadow: selected ? `inset ${selectionShadow} 0 currentColor` : "none"
        },
        children: /* @__PURE__ */ jsx2(RailIcon, { width: railWidth, children: /* @__PURE__ */ jsx2(PageIcon, { entry }) })
      },
      entry.id
    );
  };
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      ref: shell,
      "data-dsh-pages-shell": "",
      "data-active-page": snapshot.activePage,
      "data-rail-position": railPosition,
      role: open ? "dialog" : void 0,
      "aria-modal": open ? true : void 0,
      "aria-label": open ? props.resolveLabel(active?.label ?? "") : void 0,
      tabIndex: open ? -1 : void 0,
      style: { position: "fixed", inset: 0, zIndex: 1e3, pointerEvents: "none", color: foreground, fontFamily: "inherit" },
      onKeyDown: keyDown,
      onKeyUp: (event) => {
        if (open) event.stopPropagation();
      },
      children: [
        /* @__PURE__ */ jsx2("style", { "data-dsh-pages-layout": "", children: layoutCss(railWidth, railPosition) }),
        /* @__PURE__ */ jsxs2("nav", { "data-dsh-pages-rail": "", "aria-label": props.t("navigation"), style: {
          position: "absolute",
          inset: railInset,
          width: horizontal ? void 0 : railWidth,
          height: horizontal ? railWidth : void 0,
          boxSizing: "border-box",
          background: surface,
          [innerBorder]: border,
          display: "flex",
          flexDirection: horizontal ? "row" : "column",
          alignItems: "center",
          gap: 8 * scale,
          padding: horizontal ? `${8 * scale}px ${16 * scale}px` : `${16 * scale}px ${8 * scale}px`,
          pointerEvents: "auto",
          overflowY: horizontal ? "hidden" : "auto",
          overflowX: horizontal ? "auto" : "hidden"
        }, children: [
          /* @__PURE__ */ jsx2("div", { "data-dsh-pages-rail-action": "", style: { display: "grid", placeItems: "center", flexShrink: 0, width: 46 * scale, minHeight: 24 * scale, ...horizontal ? { paddingRight: 20 * scale } : { paddingBottom: 20 * scale }, color: secondary }, children: /* @__PURE__ */ jsx2(React2.Fragment, { children: props.renderSlot(props.railActionSlot ?? "page.rail-action", {
            pageId: snapshot.activePage,
            railWidth,
            railPosition
          }, { entryKey: snapshot.activePage, fallback: actionFallback }) }, snapshot.activePage) }),
          top.map(navItem),
          parked.length > 0 && /* @__PURE__ */ jsx2(
            "button",
            {
              ref: moreButton,
              type: "button",
              "data-dsh-pages-more": "",
              title: props.t("more"),
              "aria-label": props.t("more"),
              "aria-expanded": menu === "more",
              "aria-haspopup": "menu",
              onClick: () => setMenu(menu === "more" ? null : "more"),
              style: {
                ...railButton,
                color: parked.some((entry) => entry.id === snapshot.activePage) ? foreground : secondary,
                background: menu === "more" ? "var(--dsw-alias-interactive-bg-hover, #333)" : "transparent"
              },
              children: /* @__PURE__ */ jsx2(RailIcon, { width: railWidth, children: /* @__PURE__ */ jsxs2("svg", { width: "23", height: "23", viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", children: [
                /* @__PURE__ */ jsx2("circle", { cx: "5", cy: "12", r: "1.9" }),
                /* @__PURE__ */ jsx2("circle", { cx: "12", cy: "12", r: "1.9" }),
                /* @__PURE__ */ jsx2("circle", { cx: "19", cy: "12", r: "1.9" })
              ] }) })
            }
          ),
          parked.some((entry) => entry.pinned) && /* @__PURE__ */ jsx2("span", { "data-dsh-pages-pin-divider": "", style: { display: "block", flexShrink: 0, ...horizontal ? { height: 28 * scale, borderLeft: border } : { width: 28 * scale, borderTop: border } } }),
          parked.filter((entry) => entry.pinned).sort((a, b) => a.pinOrder - b.pinOrder).map(navItem),
          /* @__PURE__ */ jsx2("span", { style: { flex: 1 } }),
          snapshot.pages.filter((entry) => entry.region === "bottom").map(navItem)
        ] }),
        menu === "more" && /* @__PURE__ */ jsx2("div", { ref: morePanel, "data-dsh-pages-more-panel": "", role: "menu", "aria-label": props.t("more"), style: {
          position: "fixed",
          ...menuPosition,
          zIndex: 1001,
          width: "min(280px, calc(100vw - 24px))",
          maxHeight: `min(60vh, calc(100dvh - ${railWidth + 24}px))`,
          overflowY: "auto",
          padding: 6,
          boxSizing: "border-box",
          pointerEvents: "auto",
          background: surface,
          border,
          borderRadius: 10,
          boxShadow: "0 10px 32px #0007"
        }, children: parked.map((entry) => {
          const label = props.resolveLabel(entry.label);
          const selected = entry.id === snapshot.activePage;
          return /* @__PURE__ */ jsxs2("div", { "data-dsh-pages-more-row": "", style: { display: "flex", alignItems: "center", gap: 4 }, children: [
            /* @__PURE__ */ jsxs2(
              "button",
              {
                type: "button",
                role: "menuitem",
                "aria-current": selected ? "page" : void 0,
                onClick: () => {
                  setMenu(null);
                  props.selectPage(entry.id);
                },
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 36,
                  padding: "0 10px",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                  color: selected ? foreground : secondary,
                  background: selected ? "var(--dsw-alias-interactive-bg-hover, #333)" : "transparent"
                },
                children: [
                  /* @__PURE__ */ jsx2("span", { style: { display: "grid", placeItems: "center", width: 20, height: 20 }, children: /* @__PURE__ */ jsx2(PageIcon, { entry }) }),
                  label
                ]
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                type: "button",
                title: props.t(entry.pinned ? "unpin" : "pin"),
                "aria-label": `${props.t(entry.pinned ? "unpin" : "pin")} ${label}`,
                "data-dsh-pages-pin": "",
                "aria-pressed": Boolean(entry.pinned),
                onClick: () => props.setPagePinned(entry.id, !entry.pinned),
                style: {
                  width: 32,
                  minHeight: 32,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  font: "inherit",
                  color: secondary,
                  background: "transparent"
                },
                children: /* @__PURE__ */ jsx2("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", children: /* @__PURE__ */ jsx2("path", { d: "M14 2 22 10l-2.6 2.6-1.4-1.4-3.5 3.5.7 4.3-2.1 2.1-3.5-3.5L4 23l-1-1 4.5-5.5L4 13l2.1-2.1 4.3.7 3.5-3.5-1.4-1.4z" }) })
              }
            )
          ] }, entry.id);
        }) }),
        open && /* @__PURE__ */ jsx2("section", { id: contentId, "aria-label": props.resolveLabel(active?.label ?? ""), style: {
          // A bare full-bleed area. Everything a page shows inside it — headings,
          // toolbars, a back button, its own padding — belongs to the page. The
          // shell provides the region and the lifecycle, never the layout.
          position: "absolute",
          inset: contentInset,
          boxSizing: "border-box",
          pointerEvents: "auto",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          background: surface,
          color: foreground
        }, children: /* @__PURE__ */ jsx2("div", { "data-dsh-pages-content": "", style: {
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column"
        }, children: /* @__PURE__ */ jsx2(
          "div",
          {
            "data-page-scope": snapshot.activePage,
            style: {
              position: "relative",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              contain: "layout paint"
            },
            children: manager ? /* @__PURE__ */ jsx2(
              PageManager,
              {
                entries: snapshot.pages,
                railWidth,
                railPosition,
                defaultRailWidth: snapshot.defaultRailWidth ?? railWidth,
                resolveLabel: (entry) => props.resolveLabel(entry.label),
                t: props.t,
                actions: {
                  selectPage: props.selectPage,
                  setPageRegion: props.setPageRegion,
                  setPagePinned: props.setPagePinned,
                  setRailWidth: props.setRailWidth,
                  setRailPosition: props.setRailPosition,
                  setPageOrder: props.setPageOrder,
                  promotePage: props.promotePage
                }
              }
            ) : props.renderSlot(props.pageSlot, { host: props.host }, { entryKey: snapshot.activePage })
          },
          snapshot.activePage
        ) }) })
      ]
    }
  );
}
function installPageShell(ctx, config = {}) {
  const { slots } = ctx;
  const cleanups = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    let failure;
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  };
  return ctx.effect(() => {
    try {
      const pages = createPages(config);
      cleanups.push(() => pages.dispose());
      cleanups.push(ctx.reflect.provide("pages", pages.service));
      const host = createHostFace(ctx);
      cleanups.push(ctx.reflect.provide("hostUi", host));
      cleanups.push(ctx.locale.register(namespace, translations));
      cleanups.push(slots.inject("shell.overlay", () => slots.register({
        name: "shell.overlay",
        id: "dsh-pages.rail",
        children: {
          [pages.service.config.pageSlot]: { kind: "keyed", scope: "root" },
          [pages.service.config.railActionSlot]: { kind: "keyed", scope: "root" }
        },
        inject: () => ({
          hooks: { pages: { getSnapshot: pages.state.getSnapshot, subscribe: pages.state.subscribe } },
          homePage: pages.service.config.homePage,
          managerPage: pages.service.config.managerPage,
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
          resolveLabel: (value) => typeof value === "string" ? value : ctx.locale.resolveText(value)
        }),
        locale: namespace
      }, PageShell)));
      return dispose;
    } catch (error) {
      try {
        dispose();
      } catch {
      }
      throw error;
    }
  }, "dsh-pages: page shell");
}

// src/client.jsx
var name = "dsh-pages-client";
var inject = {
  slots: { required: true },
  locale: { required: true },
  layout: { required: false }
};
function apply(ctx, config = {}) {
  return applyWithConfig(ctx, config);
}
function applyWithConfig(ctx, config = {}) {
  return installPageShell(ctx, normalizeConfig(config));
}
export {
  apply,
  applyWithConfig,
  inject,
  installPageShell,
  name,
  normalizeConfig
};
