window.__ModuleLoader__.load({id:"@lybx-leyw/dsh-zju-yonkik-tool",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/yonkik/yonkik-tool/src/client.jsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_dsh_zju_ui_shared = require("@lybx-leyw/dsh-zju-ui-shared");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/yonkik/yonkik-tool/src/shared.js
var ROUTE_PATH = "/_dsh/yonkik";
var WRITE_HEADER = "x-zw-yonkik";
var MASK = "********";
function errorText(error, status) {
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const message = typeof error.message === "string" ? error.message.trim() : "";
    if (message) return message;
    if (typeof error.code === "string" && error.code) return error.code;
  }
  return `\u8BBE\u7F6E\u63A5\u53E3\u8FD4\u56DE ${status}`;
}

// packages/yonkik/yonkik-tool/src/wiki.css
var wiki_default = 'body[data-zw] .zw-yonkik-wiki { display:flex; flex-direction:column; gap:16px; color:var(--zw-text); font-size:var(--zw-fs-base); }\nbody[data-zw] .zw-yonkik-wiki h2 { margin:0; font-size:var(--zw-fs-lg); font-weight:600; }\nbody[data-zw] .zw-ykw-root { color:var(--zw-secondary); font-size:var(--zw-fs-sm); line-height:1.6; }\nbody[data-zw] .zw-ykw-tabs { display:flex; gap:8px; flex-wrap:wrap; border-bottom:1px solid var(--zw-line); padding-bottom:8px; }\nbody[data-zw] .zw-ykw-tabs button { padding:5px 12px; border:1px solid var(--zw-line); border-radius:7px; background:var(--zw-surface); color:var(--zw-text); font-size:var(--zw-fs-sm); cursor:pointer; }\nbody[data-zw] .zw-ykw-tabs button[data-active] { background:var(--zw-soft); border-color:var(--zw-accent); font-weight:600; }\nbody[data-zw] .zw-ykw-list { display:flex; flex-direction:column; gap:6px; }\nbody[data-zw] .zw-ykw-site { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--zw-line); border-radius:8px; background:var(--zw-surface); cursor:pointer; }\nbody[data-zw] .zw-ykw-site:hover { border-color:var(--zw-accent); }\nbody[data-zw] .zw-ykw-badge { font-size:var(--zw-fs-meta); padding:1px 8px; border-radius:999px; border:1px solid var(--zw-line); color:var(--zw-secondary); flex:none; }\nbody[data-zw] .zw-ykw-badge[data-status="done"] { color:var(--zw-accent); border-color:var(--zw-accent); }\nbody[data-zw] .zw-ykw-badge[data-status="blocked"] { color:var(--zw-danger,#b91c1c); border-color:var(--zw-danger,#b91c1c); }\nbody[data-zw] .zw-ykw-site-name { font-weight:500; }\nbody[data-zw] .zw-ykw-site-label { color:var(--zw-secondary); font-size:var(--zw-fs-sm); margin-left:auto; text-align:right; }\nbody[data-zw] .zw-ykw-md { line-height:1.7; }\nbody[data-zw] .zw-ykw-table { width:100%; border-collapse:collapse; font-size:var(--zw-fs-sm); }\nbody[data-zw] .zw-ykw-table th, body[data-zw] .zw-ykw-table td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--zw-line); vertical-align:top; }\nbody[data-zw] .zw-ykw-table th { color:var(--zw-secondary); font-weight:600; }\nbody[data-zw] .zw-ykw-back { align-self:flex-start; padding:4px 10px; border:1px solid var(--zw-line); border-radius:7px; background:var(--zw-surface); color:var(--zw-text); cursor:pointer; font-size:var(--zw-fs-sm); }\nbody[data-zw] .zw-ykw-section { display:flex; flex-direction:column; gap:10px; }\nbody[data-zw] .zw-ykw-h3 { font-size:var(--zw-fs-md); font-weight:600; margin:8px 0 0; }';

// packages/yonkik/yonkik-tool/src/client.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var name = "zw-yonkik-client";
var inject = ["slots"];
async function api(action = "", body) {
  const method = body ? "POST" : "GET";
  const response = await fetch(`${ROUTE_PATH}${action ? `?action=${action}` : ""}`, {
    method,
    headers: body ? { "content-type": "application/json", [WRITE_HEADER]: "1" } : {},
    body: body ? JSON.stringify(body) : void 0
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(payload.error, response.status));
  return payload;
}
function apply(ctx) {
  (0, import_dsh_zju_ui_shared.mountStyle)(ctx, { attribute: "zwYonkikSettingsStyle", css: import_dsh_zju_ui_shared.SETTINGS_CSS, label: "zw: yonkik settings styles" });
  (0, import_dsh_zju_ui_shared.mountStyle)(ctx, { attribute: "zwYonkikWikiStyle", css: wiki_default, label: "zw: yonkik wiki styles" });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "zw-yonkik",
    order: 80,
    label: () => "YONKIK \u4FA6\u5BDF\u51ED\u636E"
  }, () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsSection, {})));
  (0, import_dsh_zju_ui_shared.registerPageContent)(ctx, {
    id: "yonkik-wiki",
    label: "YONKIK \u77E5\u8BC6\u5E93",
    order: 90,
    render: () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WikiPage, {})
  });
}
var emptyRow = () => ({ key: "", \u63CF\u8FF0: "", n1: "\u952E\u4E00", n2: "\u952E\u4E8C", v1: "", v2: "", has1: false, has2: false });
function SettingsSection() {
  const [rows, setRows] = (0, import_react.useState)([]);
  const [sites, setSites] = (0, import_react.useState)("");
  const [msg, setMsg] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const load = (0, import_react.useCallback)(async () => {
    try {
      const d = await api();
      setRows((d.credentials ?? []).map((c) => {
        const ks = c.keys ?? [];
        return {
          key: c.key,
          \u63CF\u8FF0: c.\u63CF\u8FF0 ?? "",
          n1: ks[0]?.name ?? "\u952E\u4E00",
          n2: ks[1]?.name ?? "\u952E\u4E8C",
          v1: "",
          v2: "",
          has1: !!ks[0]?.hasValue,
          has2: !!ks[1]?.hasValue,
          fromWorkbench: !!c.fromWorkbench
        };
      }));
      setSites((d.sites ?? []).join("\n"));
    } catch (e) {
      setMsg({ err: e.message });
    }
  }, []);
  (0, import_react.useEffect)(() => {
    load();
  }, [load]);
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const credentials = {};
      for (const r of rows) {
        if (r.fromWorkbench) continue;
        const key = r.key.trim();
        if (!key) continue;
        const entry = { \u63CF\u8FF0: r.\u63CF\u8FF0 };
        entry[r.n1] = r.v1 === "" && r.has1 ? MASK : r.v1;
        if (r.n2) entry[r.n2] = r.v2 === "" && r.has2 ? MASK : r.v2;
        credentials[key] = entry;
      }
      const siteList = sites.split("\n").map((s) => s.trim()).filter(Boolean);
      await api("save", { credentials, sites: siteList });
      setMsg({ ok: "\u5DF2\u4FDD\u5B58\uFF08\u51ED\u636E\u52A0\u5BC6\u5B58\u50A8\uFF0C\u4E0D\u56DE\u663E\uFF09" });
      await load();
    } catch (e) {
      setMsg({ err: e.message });
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("clear", {});
      setMsg({ ok: "\u5DF2\u6E05\u9664" });
      await load();
    } catch (e) {
      setMsg({ err: e.message });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zju-setting-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.PageTitle, { children: "YONKIK \u4FA6\u5BDF\u51ED\u636E" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Intro, { children: "\u53EA\u8BFB\u4FA6\u5BDF\u7528\u7684\u51ED\u636E\u4E0E\u7AD9\u70B9\u3002\u51ED\u636E\u7ECF\u5BBF\u4E3B\u52A0\u5BC6\u670D\u52A1\u5B58\u50A8\u3001\u4E0D\u56DE\u663E\uFF1B\u5BC6\u7801\u7559\u7A7A\u8868\u793A\u6CBF\u7528\u5DF2\u5B58\u503C\u3002\u6BCF\u5957\u51ED\u636E\u4E00\u5F20\u5361\u7247\uFF0C\u952E\u540D\u81EA\u5B9A\uFF08\u5982\u8D26\u53F7/\u5BC6\u7801\uFF0C\u6216\u5355\u4E2A API key\uFF09\uFF0C\u5728\u63CF\u8FF0\u91CC\u8BF4\u660E\u6BCF\u4E2A\u952E\u662F\u4EC0\u4E48\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.StatusLine, { label: "\u5DF2\u914D\u7F6E\u51ED\u636E", value: rows.length ? `${rows.length} \u5957` : "\u65E0" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Rows, { children: rows.map((r, i) => r.fromWorkbench ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Card, { title: r.key, detail: r.\u63CF\u8FF0, defaultOpen: false, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_zju_ui_shared.Intro, { children: [
      "\u7531\u5DE5\u4F5C\u53F0\u7BA1\u7406\uFF0CYONKIK \u81EA\u52A8\u590D\u7528\uFF08\u51ED\u636E\u952E\uFF1A",
      r.key,
      "\uFF09\u3002\u8BF7\u5728\u5DE5\u4F5C\u53F0\u8BBE\u7F6E\u4E2D\u4FEE\u6539\uFF0C\u6B64\u5904\u53EA\u8BFB\u3002"
    ] }) }, i) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_zju_ui_shared.Card, { title: `\u51ED\u636E ${i + 1}`, detail: r.\u63CF\u8FF0 || "\u672A\u547D\u540D", defaultOpen: true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Field, { label: "\u952E\u540D", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.TextInput, { value: r.key, placeholder: "\u5982 cc98", onChange: (v) => setRow(i, { key: v }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Field, { label: "\u63CF\u8FF0", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.TextInput, { value: r.\u63CF\u8FF0, placeholder: "\u8D26\u53F7+\u5BC6\u7801 / API key\u2026", onChange: (v) => setRow(i, { \u63CF\u8FF0: v }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Field, { label: r.n1, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.TextInput, { value: r.v1, placeholder: r.has1 ? "\u5DF2\u5B58\uFF08\u7559\u7A7A\u6CBF\u7528\uFF09" : "", onChange: (v) => setRow(i, { v1: v }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Field, { label: r.n2, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.TextInput, { value: r.v2, placeholder: r.has2 ? "\u5DF2\u5B58\uFF08\u7559\u7A7A\u6CBF\u7528\uFF09" : "", onChange: (v) => setRow(i, { v2: v }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Actions, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => removeRow(i), children: "\u5220\u9664\u8FD9\u5957" }) })
    ] }, i)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Actions, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: addRow, children: "+ \u52A0\u4E00\u5957\u51ED\u636E" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Field, { label: "\u7AD9\u70B9\u6E05\u5355\uFF08\u6BCF\u884C\u4E00\u4E2A URL\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.TextArea, { value: sites, placeholder: "https://www.cc98.org\nhttps://\u2026", rows: 4, onChange: setSites }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_zju_ui_shared.Actions, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-primary": "", disabled: busy, onClick: save, children: "\u4FDD\u5B58" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: busy, onClick: clear, children: "\u6E05\u9664" })
    ] }),
    msg && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Intro, { children: msg.err ?? msg.ok })
  ] });
}
async function wikiApi(site) {
  const url = `${ROUTE_PATH}/wiki${site ? `?site=${encodeURIComponent(site)}` : ""}`;
  const r = await fetch(url);
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errorText(p.error, r.status));
  return p;
}
var WIKI_TABS = [["sites", "\u7AD9\u70B9"], ["playbook", "Playbook"], ["sso", "SSO \u5BB6\u65CF"], ["scripts", "\u811A\u672C"], ["memory", "MEMORY"]];
var MARKDOWN_LABELS = { code: { copyLabel: "\u590D\u5236", copiedLabel: "\u5DF2\u590D\u5236" }, footnotes: "\u6CE8\u91CA" };
var MarkdownSafe = class extends import_react.default.Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err: String(err?.message ?? err) };
  }
  render() {
    if (this.state.err) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-md", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_zju_ui_shared.Intro, { children: [
          "Markdown \u6E32\u67D3\u51FA\u9519\uFF1A",
          this.state.err,
          "\uFF08\u4EE5\u4E0B\u4E3A\u539F\u6587\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontSize: "var(--zw-fs-sm)" }, children: this.props.text })
      ] });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: this.props.text, labels: MARKDOWN_LABELS });
  }
};
function WikiPage() {
  const [tab, setTab] = (0, import_react.useState)("sites");
  const [data, setData] = (0, import_react.useState)(null);
  const [site, setSite] = (0, import_react.useState)(null);
  const [err, setErr] = (0, import_react.useState)(null);
  const load = (0, import_react.useCallback)(async () => {
    try {
      setData(await wikiApi());
    } catch (e) {
      setErr(e.message);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    load();
  }, [load]);
  const openSite = async (key) => {
    try {
      setSite(await wikiApi(key));
      setTab("site");
    } catch (e) {
      setErr(e.message);
    }
  };
  const sites = Object.entries(data?.index?.sites ?? {});
  const doneCount = sites.filter(([, v]) => v.status === "done").length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-yonkik-wiki", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "YONKIK \u77E5\u8BC6\u5E93" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-root", children: [
      "\u8BB0\u5FC6\u6839 ",
      data?.root ?? "\u2026",
      " \uFF5C \u7AD9\u70B9 ",
      sites.length,
      "\uFF08\u5DF2\u63A2 ",
      doneCount,
      "\uFF09\uFF5C \u811A\u672C ",
      data?.scripts?.length ?? 0
    ] }),
    err && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Intro, { children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-tabs", children: WIKI_TABS.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-active": tab === id ? "" : void 0, onClick: () => {
      setTab(id);
      if (id !== "site") setSite(null);
    }, children: label }, id)) }),
    tab === "sites" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-list", children: sites.map(([key, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-site", onClick: () => openSite(key), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "zw-ykw-badge", "data-status": v.status, children: v.status }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "zw-ykw-site-name", children: key }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "zw-ykw-site-label", children: v.signals?.label ?? v.summary ?? "" })
    ] }, key)) }),
    tab === "site" && site && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SiteDetail, { site, onBack: () => {
      setSite(null);
      setTab("sites");
    } }),
    tab === "playbook" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarkdownSafe, { text: data?.playbook ?? "" }) }),
    tab === "sso" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SsoView, { sso: data?.sso }),
    tab === "scripts" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "zw-ykw-table", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u811A\u672C" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u4F4D\u7F6E" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: (data?.scripts ?? []).map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: s }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: "~/.yonkik/scripts/" })
      ] }, s)) })
    ] }),
    tab === "memory" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarkdownSafe, { text: data?.memory ?? "" }) })
  ] });
}
function SiteDetail({ site, onBack }) {
  const ep = site.endpoints ?? {};
  const verified = ep.verified ?? [];
  const unverified = ep.unverified ?? [];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "zw-ykw-back", onClick: onBack, children: "\u2190 \u8FD4\u56DE\u7AD9\u70B9\u5217\u8868" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: site.key }),
    site.site && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-root", children: [
      "origin ",
      site.site.origin,
      " \uFF5C API ",
      site.site.apiUrl ?? "\u2014",
      " \uFF5C \u9650\u6D41 ",
      site.site.rateLimit?.minIntervalMs ?? "?",
      "ms \uFF5C \u9274\u6743 ",
      site.site.auth?.type ?? "\u2014"
    ] }),
    site.wiki && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarkdownSafe, { text: site.wiki }) }),
    verified.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-h3", children: [
        "\u5DF2\u9A8C\u8BC1\u63A5\u53E3\uFF08",
        verified.length,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "zw-ykw-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "id" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "method" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "path" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7528\u9014" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: verified.map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.id }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.method }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.path }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.purpose ?? "" })
        ] }, e.id)) })
      ] })
    ] }),
    unverified.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-h3", children: [
        "\u5019\u9009 / \u7591\u4F3C\u5199\uFF08",
        unverified.length,
        "\uFF0C\u4E0D\u8C03\u7528\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "zw-ykw-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "id" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "method" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "path" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u539F\u56E0" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: unverified.map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.id }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.method }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.path }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: e.reason ?? e.suspected ?? "" })
        ] }, e.id)) })
      ] })
    ] }),
    site.reconScripts?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-h3", children: [
        "\u5206\u6790\u811A\u672C\uFF08",
        site.reconScripts.length,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-root", children: site.reconScripts.join("\u3001") })
    ] }),
    site.hasCrawler && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-root", children: "crawler.mjs \u2713\uFF08\u53EA\u8BFB\u722C\u866B\uFF09" })
  ] });
}
function SsoView({ sso }) {
  const families = Object.entries(sso?.families ?? {});
  if (!families.length) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Intro, { children: "\u6682\u65E0 SSO \u5BB6\u65CF\u8BB0\u5F55\u3002" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "zw-ykw-section", children: families.map(([id, f]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_zju_ui_shared.Card, { title: id, detail: f.idp, defaultOpen: true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "zw-ykw-root", children: [
      "\u51ED\u636E\u952E ",
      f.credentialKey,
      " \uFF5C \u6210\u5458 ",
      (f.members ?? []).join("\u3001")
    ] }),
    f.evidence && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_zju_ui_shared.Intro, { children: f.evidence })
  ] }, id)) });
}
return module.exports;}});
