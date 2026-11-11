/**
 * 设置分区的小工具：i18n 注册、字段行、按钮、状态行。
 *
 * # 为什么放在 ui-shared
 *
 * 每个 source 包都要一个设置分区（凭据 / Cookie / 连接状态），它们的外壳长得一样：
 * 一行标题、若干字段、保存与清除、一行状态。如果每个包各写一遍，光是
 * 间距与按钮样式就会漂成八种。
 *
 * # i18n
 *
 * 宿主提供 `ctx.locale.register(namespace, { en, zh })`，之后用
 * `ctx.locale.resolveText(key)` 或本文件的 `textOf()` 取值。
 *
 * ⚠️ **同一个 namespace + 同一种语言注册两次会抛错**（不是覆盖）。所以 namespace
 * 必须一包一个，且格式是 `zju-source-<包目录名>`。这个约定写死在
 * {@link REGISTER_NAMESPACE_PREFIX} 里，由测试守着。
 *
 * # 语言回退
 *
 * `locale` 服务缺席时（宿主版本没带、或本包早于它挂载）回退到中文 ——
 * 本仓的产品文案以中文为准，英文是译文。回退到英文会让中文用户看到半截英文。
 */

import React, { useState } from 'react';

/** namespace 前缀。一包一个，拼上包目录名，例如 `zju-source-xxt`。 */
export const REGISTER_NAMESPACE_PREFIX = 'zju-source-';

/**
 * 取一个字典项。
 *
 * @param dict - `{ en: {...}, zh: {...} }`。
 * @param key - 键名。
 * @param lang - 当前语言；缺省或未知时用中文。
 * @returns 文案；键不存在时返回键名本身（便于发现漏译，而不是显示空白）。
 */
export function textOf(dict, key, lang) {
  const table = dict?.[lang] ?? dict?.zh ?? {};
  return table[key] ?? dict?.zh?.[key] ?? key;
}

/**
 * 注册一个设置分区的字典，并返回**宿主自己的取词函数**。
 *
 * # 宿主 locale 的真实 API（0.2.2-rc.1 实测）
 *
 * | 方法 | 作用 |
 * | --- | --- |
 * | `register(ns, localeOrDicts, dict)` | 注册字典；传 `{ zh, en }` 对象，或 `register(ns, 'en', dict)` |
 * | **`bind(ns)`** | **返回 `t(key, params)`** —— 唯一的取词入口，内部按当前语言与回退链解析 |
 * | `getLocale()` | 当前语言快照 |
 * | `subscribe(fn)` | 订阅语言 / 字典变化 |
 * | `resolveText(text)` | 只解析 **LocalizedText 对象**（`{zh, en}`），**不查注册表** |
 *
 * # 之前为什么没生效（真机踩过）
 *
 * 上一版自己按 `locale.language` 拼了一个静态查表函数，**从没调用 `bind`**：
 *
 *   - 语言标识读的是 `locale.language`，而真实字段在 `locale.getLocale().active`；
 *   - 于是 `lang` 永远是兜底值 → 永远显示中文 → 「设置页全中文」。
 *
 * 现在直接拿 `bind(ns)`：语言切换、字典后到、回退链全由宿主处理，
 * 我们不再自己判断语言。
 *
 * @param ctx - 插件上下文。`locale` 缺席时退回静态查表（保证面板仍可用）。
 * @param namespace - 完整 namespace（`zju-source-<目录名>`），一包一个。
 * @param dict - `{ en, zh }`。
 * @returns `{ t, dispose }`。
 */
export function registerText(ctx, namespace, dict) {
  let off;
  try {
    // ⚠️ 诊断期保留：`locale` 的取得方式在 0.2.2-rc.1 里有坑（见文件头）。
    // 取值失败会表现成「设置分区全中文」，而界面上其它地方是英文 —— 只看界面
    // 无法区分「没注册」与「注册了但没绑上」。这一行把两者分开。
    console.info('zju: registerText', namespace, {
      hasGet: typeof ctx?.get === 'function',
      viaGet: ctx?.get?.('locale') !== undefined,
      viaCtx: ctx?.locale !== undefined,
    });
    const locale = ctx?.get?.('locale') ?? ctx?.locale;
    if (locale !== undefined && locale !== null) {
      const unregister = locale.register(namespace, dict);
      // bind 返回的函数是**惰性**的：每次调用按当前语言解析，所以切语言无需重新绑定。
      const bound = locale.bind?.(namespace);
      console.info('zju: locale bound', namespace, typeof bound);
      if (typeof bound === 'function') {
        return {
          t: (key, params) => bound(key, params),
          dispose: () => { try { unregister?.(); } catch { /* 卸载失败无处补救 */ } },
        };
      }
      off = unregister;
    } else {
      console.warn('zju: locale service unavailable for', namespace);
    }
  } catch (error) {
    // 注册/绑定失败不该让设置分区整个消失：退回静态查表（中文）。
    console.warn('zju: locale bind failed, falling back to zh', error?.message);
  }
  return {
    t: (key) => textOf(dict, key, 'zh'),
    dispose: () => { try { off?.(); } catch { /* 同上 */ } },
  };
}

/**
 * 设置分区的容器 —— 对应官方 `.section`（gap 12、max-width 720）。
 *
 * 标题 / 说明 / 卡片列表三者的间距由这个容器的 `gap` 统一决定，
 * 不靠各自 margin 拼凑（否则加一项就要重算一次）。
 */
export function Section({ children }) {
  return React.createElement('div', { className: 'zju-setting-section' }, children);
}

/**
 * 卡片列表 —— 对应官方 `.rows`（`margin: 12px 0 0`、`gap: 8px`）。
 *
 * 用 `ul/li` 而不是 `div`：它语义上就是一列条目，屏幕阅读器能报出项数。
 */
export function Rows({ children }) {
  return React.createElement('ul', { className: 'zju-setting-rows' },
    Array.isArray(children)
      ? children.map((child, i) => React.createElement('li', { key: i, style: { listStyle: 'none' } }, child))
      : children);
}

/**
 * 设置分区的标题（与原版 `h2` 同规格：500 16px/24px）。
 *
 * 原版每个分区都是「标题 → 灰色说明 → 卡片列表」三段式。缺了标题，
 * 内容会直接顶在弹窗上边缘，看起来像半截页面。
 */
export function PageTitle({ children }) {
  return React.createElement('h2', { className: 'zju-setting-title' }, children);
}

/** 标题下方的说明（原版同规格：400 14px/22px，`#adb2b8`）。 */
export function Intro({ children }) {
  return React.createElement('p', { className: 'zju-setting-intro' }, children);
}

/**
 * 一张设置卡片，**内容可折叠**。
 *
 * # 为什么必须有卡片（对照原版后的结论）
 *
 * 原版的设置项是卡片列表：0.5px 描边、20px 圆角、12/14px 内边距，
 * 行内「左侧文案 + 右侧操作」。平铺的表单看起来像调试面板，卡片看起来像设置。
 *
 * # 折叠交互
 *
 * 照抄官方 `DisclosureRow` 的**交互约定**（不抄它的样式 —— 那是进程行的
 * 24px tertiary 外观，与设置卡片不是一套语言）：
 *
 *   - 标题行是 disclosure 目标：`role="button"` + `tabIndex=0`
 *   - `aria-expanded` 反映真实状态
 *   - Enter / Space 可切换 —— 键盘可达，不是只有鼠标能点
 *   - 操作按钮（保存/清除）**不参与折叠切换**：点它们不该顺手收起卡片，
 *     所以标题行与操作区是两个兄弟节点，只有标题行带 onClick。
 *
 * # 默认状态
 *
 *   - 有 `actions` 的卡片默认**展开**：用户进这一页就是来填的；
 *   - 纯状态卡片默认**收起**：它只是确认「通没通」，不该占版面。
 *
 * @param root0 - 依赖。
 * @param root0.title - 卡片主文案（左）。
 * @param root0.detail - 次要说明（主文案下方，可省；收起时仍显示，因为它是摘要）。
 * @param root0.actions - 右侧操作区（可省）。点它不会触发折叠。
 * @param root0.defaultOpen - 初始是否展开；缺省时按有无 actions 推断。
 * @param root0.children - 卡片内容（折叠区）。
 */
/**
 * 一张可折叠的设置卡片。
 *
 * # `open` 是**可选的受控**属性（后加）
 *
 * 不传 `open` 时行为与以前完全一致：内部 `useState` 记住用户点开的状开，
 * 初值取 `defaultOpen ?? Boolean(actions)`。
 *
 * 传了 `open` 就变成**受控**：展开状态由调用方决定。这条是给「按配置状态自动
 * 展开/收起」用的 —— 例如实验课平台那块，配好账号后应自动收起凭证卡片、
 * 展开状态卡片。
 *
 * ⚠️ 为什么不能只用 `defaultOpen`：它是 `useState` 的**初值**，只在挂载时读一次。
 * 而「配没配」是异步读回来的（`status` 加载完才知道），那时组件早挂载过了，
 * 改 `defaultOpen` 不会有任何效果。
 *
 * 受控时仍允许用户手动点开 —— 点击只调用 `onOpenChange`（若给了），
 * 不传则点击无效果（由调用方决定状态）。这样「自动展开」不会把卡片锁死。
 */
export function Card({ title, detail, actions, defaultOpen, open: controlledOpen, onOpenChange, children }) {
  const hasContent = children !== null && children !== undefined && children !== false;
  // 有操作区的卡片默认展开；纯状态卡片默认收起。
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? Boolean(actions));
  // 受控就听调用方的，否则用自己的 state。
  const controlled = controlledOpen !== undefined;
  const open = controlled ? Boolean(controlledOpen) : internalOpen;
  const toggle = () => {
    if (controlled) onOpenChange?.(!open);
    else setInternalOpen((current) => !current);
  };
  if (!hasContent) {
    // 没有内容的卡片退化成一行，不显示折叠箭头（否则点了没反应）。
    return React.createElement('div', { className: 'zju-setting-card' },
      React.createElement('div', { className: 'zju-setting-card-row' },
        React.createElement('div', { className: 'zju-setting-card-main' },
          React.createElement('span', { className: 'zju-setting-card-title' }, title),
          detail ? React.createElement('span', { className: 'zju-setting-card-detail' }, detail) : null),
        actions ? React.createElement('div', { className: 'zju-setting-card-actions' }, actions) : null));
  }
  return React.createElement('div', {
    className: 'zju-setting-card',
    'data-open': open ? '' : undefined,
  },
  React.createElement('div', { className: 'zju-setting-card-row' },
    // 标题行整体是 disclosure 目标 —— 键盘与读屏用户都能操作。
    React.createElement('div', {
      className: 'zju-setting-card-main zju-setting-card-toggle',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': open,
      title: open ? '收起' : '展开',
      onClick: toggle,
      onKeyDown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      },
    },
    React.createElement('span', {
      className: 'zju-setting-card-chevron',
      'data-open': open ? '' : undefined,
      'aria-hidden': 'true',
    }, '›'),
    React.createElement('span', { className: 'zju-setting-card-title' }, title),
    detail ? React.createElement('span', { className: 'zju-setting-card-detail' }, detail) : null),
    // 操作区在标题行**之外**：点保存不该顺手把卡片收起来。
    actions ? React.createElement('div', { className: 'zju-setting-card-actions' }, actions) : null),
  React.createElement('div', {
    className: 'zju-setting-card-body',
    hidden: !open,
  }, children));
}

/** 一行字段：标签在上，控件在下。 */
export function Field({ label, hint, children }) {
  return React.createElement('label', { className: 'zju-setting-field' },
    React.createElement('span', { className: 'zju-setting-label' }, label),
    children,
    hint ? React.createElement('span', { className: 'zju-setting-hint' }, hint) : null);
}

/** 一行状态：左侧文案，右侧可选的值。 */
export function StatusLine({ label, value, tone }) {
  return React.createElement('div', { className: 'zju-setting-status', 'data-tone': tone ?? 'plain' },
    React.createElement('span', null, label),
    value !== undefined && value !== null
      ? React.createElement('strong', null, String(value))
      : null);
}

/** 按钮组。 */
export function Actions({ children }) {
  return React.createElement('div', { className: 'zju-setting-actions' }, children);
}

/** 多行输入（粘 Cookie 用）。 */
export function TextArea({ value, onChange, placeholder, rows = 3, ariaLabel }) {
  return React.createElement('textarea', {
    className: 'zju-setting-textarea',
    rows,
    value,
    placeholder,
    'aria-label': ariaLabel,
    onChange: (event) => onChange(event.target.value),
  });
}

/** 单行输入。 */
export function TextInput({ value, onChange, placeholder, type = 'text', ariaLabel }) {
  return React.createElement('input', {
    className: 'zju-setting-input',
    type,
    value,
    placeholder,
    'aria-label': ariaLabel,
    onChange: (event) => onChange(event.target.value),
  });
}

/** 设置分区的样式。各包共用一张，避免八种间距。 */
export const SETTINGS_CSS = `
/* 照抄宿主官方设置页（Models）的样式，逐条对应 .ref 里的源码：
 *
 *   packages/client/ui-settings-models/src/client/ModelsSection.module.css
 *   packages/client/ui-primitives/src/settings-form/{fields,SettingsForm}.module.css
 *
 * 只把类名前缀换成 .zju-setting-*，数值与 token 原样保留。 */

/* ---- 分区容器（.section）：gap 12、最大宽 720 ---- */
.zju-setting-section{
  display:flex;flex-direction:column;gap:12px;max-width:720px;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
/* ---- 标题（.title）：16/24 500 ---- */
.zju-setting-title{
  margin:0;font-size:16px;line-height:24px;font-weight:500;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
/* ---- 说明（.intro）：14/22 tertiary ---- */
.zju-setting-intro{
  margin:0;font-size:14px;line-height:22px;
  color:var(--dsw-alias-label-tertiary,#adb2b8);
}
/* ---- 卡片列表（.rows）：margin 12 0 0、gap 8 ---- */
.zju-setting-rows{
  margin:12px 0 0;padding:0;list-style:none;
  display:flex;flex-direction:column;gap:8px;
}
/* ---- 卡片（.rowCard）：0.5px 描边、radius-xl、12/14 内边距、gap 12 ---- */
.zju-setting-card{
  display:flex;flex-direction:column;gap:12px;
  padding:12px 14px;
  border:0.5px solid var(--dsw-alias-settings-card-stroke,rgba(255,255,255,.2));
  background:var(--dsw-alias-settings-card-fill,#2c2c2e);
  border-radius:var(--dsw-radius-xl,20px);
}
/* ---- 卡片头行（.rowHead）：gap 10 ---- */
.zju-setting-card-row{
  display:flex;align-items:center;gap:10px;
  flex-wrap:nowrap;
}
/* 标题区可被压缩，但只在**它自己**内部截断，不挤压右侧操作区。 */
.zju-setting-card-row > .zju-setting-card-main{min-width:0;}
/* ---- 卡片主体（.rowIdentity）：gap 6、min-width 0 ---- */
.zju-setting-card-main{display:inline-flex;flex-direction:column;gap:2px;min-width:0;}
/* ---- 卡片名（.rowName）：14/22 500 ---- */
.zju-setting-card-title{
  font-size:14px;line-height:22px;font-weight:500;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
/* ---- 卡片副文案（.rowTag 的读法：比名字小、比提示亮） ---- */
.zju-setting-card-detail{
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary,#adb2b8);
}
/* ---- 卡片右侧操作（.rowActions）：靠右、gap 4 ---- */
.zju-setting-card-actions{
  display:inline-flex;align-items:center;gap:4px;margin-left:auto;
  /* 不参与收缩：中文标题再长也不该把按钮压成竖排。 */
  flex:none;
}

/* ---- 卡片折叠 ---- */
/* 标题行是 disclosure 目标：hover / focus 给出可点的反馈。 */
.zju-setting-card-toggle{
  cursor:pointer;
  border-radius:var(--dsw-radius-sm,8px);
  /* 内容与箭头之间的间隔；负 margin 让高亮块贴到卡片内边距边缘 */
  padding:2px 4px;margin:-2px -4px;
  gap:6px;
  flex-direction:row;align-items:center;
}
.zju-setting-card-toggle:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
}
.zju-setting-card-toggle:focus-visible{
  outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#94bdf4));
  outline-offset:1px;
}
/* 箭头：收起朝右、展开朝下。 */
.zju-setting-card-chevron{
  display:inline-block;flex:none;
  font-size:14px;line-height:1;
  color:var(--dsw-alias-label-tertiary,#adb2b8);
  transition:transform .15s ease;
  transform:rotate(0deg);
}
.zju-setting-card-chevron[data-open]{
  transform:rotate(90deg);
}
@media (prefers-reduced-motion: reduce){
  .zju-setting-card-chevron{transition:none;}
}
/* 标题与说明在 toggle 里竖排；箭头在左，整体仍是一列。 */
.zju-setting-card-toggle > .zju-setting-card-title,
.zju-setting-card-toggle > .zju-setting-card-detail{
  display:block;
}
/* 内容区：上边与标题行拉开一个卡片内的间距。 */
.zju-setting-card-body{
  display:flex;flex-direction:column;gap:12px;
}
.zju-setting-card-body[hidden]{
  display:none !important;
}

/* ---- 字段（fields.module.css .field）：gap 6、padding 12 0 ---- */
.zju-setting-field{
  display:flex;flex-direction:column;gap:6px;padding:12px 0;
}
.zju-setting-field + .zju-setting-field{
  border-top:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));
}
/* 卡片内的字段不要额外的上下 padding —— 卡片自己已经有 12/14。 */
.zju-setting-card .zju-setting-field{padding:0;}
.zju-setting-card .zju-setting-field + .zju-setting-field{border-top:none;}
/* ---- 标签（.label）：13/1.5 500 ---- */
.zju-setting-label{
  font-size:13px;font-weight:500;line-height:1.5;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
/* ---- 输入（.input）：高 34、padding 0 12、0.5px 边、radius-md、bg-layer-3 ---- */
.zju-setting-input,.zju-setting-textarea{
  width:100%;box-sizing:border-box;
  height:34px;padding:0 12px;
  border:0.5px solid var(--dsw-alias-border-l4,rgba(255,255,255,.29));
  border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-bg-layer-3,#151517);
  font-family:var(--dsw-font-family,inherit);
  font-size:13px;line-height:1.5;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
.zju-setting-textarea{
  height:auto;min-height:76px;padding:8px 12px;
  font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);
  resize:vertical;
}
.zju-setting-input:focus-visible,.zju-setting-textarea:focus-visible{
  outline:none;
  border-color:var(--dsw-alias-state-business-primary,#94bdf4);
}
/* ---- 提示（.hint）：12/1.5 tertiary ---- */
.zju-setting-hint{
  margin:0;font-size:12px;line-height:1.5;
  color:var(--dsw-alias-label-tertiary,#adb2b8);
}

/* ---- 按钮底座（.primaryButton/.secondaryButton）：高 36、padding 0 14、14/22 ---- */
.zju-setting-actions{display:flex;align-items:center;gap:8px;}
.zju-setting-actions button{
  box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;gap:4px;
  height:36px;padding:0 14px;
  border:none;border-radius:var(--dsw-radius-md,12px);
  font-family:var(--dsw-font-family,inherit);
  font-size:14px;line-height:22px;
  /* 中文没有词边界：不写 nowrap 会被逐字折成竖排（真机上看到过「保/存」两行）。 */
  white-space:nowrap;flex:none;
  cursor:pointer;
  background:transparent;
  color:var(--dsw-alias-label-primary,#f9fafb);
}
.zju-setting-actions button:disabled{opacity:.4;cursor:default;}
.zju-setting-actions button:focus-visible{
  outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#94bdf4));
  outline-offset:1px;
}
/* 主按钮（.primaryButton）：button-primary-fill + label-primary-foreground */
.zju-setting-actions button[data-primary]{
  background:var(--dsw-alias-button-primary-fill,#f9fafb);
  color:var(--dsw-alias-label-primary-foreground,#151517);
}
.zju-setting-actions button[data-primary]:hover:not(:disabled){
  background:var(--dsw-alias-button-primary-hover,#e6e8ea);
}
/* 次按钮（.secondaryButton）：0.5px 边、透明底 */
.zju-setting-actions button:not([data-primary]){
  border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));
}
.zju-setting-actions button:not([data-primary]):hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));
}
/* 卡片行内的按钮用紧凑尺寸（.rowActions .secondaryButton）：高 28、padding 0 10、radius-sm、12/18 */
.zju-setting-card-actions button{
  box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  height:28px;padding:0 10px;
  /* 同上：中文按钮必须 nowrap，否则被压窄时逐字折行。 */
  white-space:nowrap;flex:none;
  border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));
  border-radius:var(--dsw-radius-sm,8px);
  background:transparent;
  font-family:var(--dsw-font-family,inherit);
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-primary,#f9fafb);
  cursor:pointer;
}
.zju-setting-card-actions button:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.1));
}
.zju-setting-card-actions button:disabled{opacity:.4;cursor:default;}

/* ---- 状态行：官方没有对应组件，按卡片内一行的节奏做 ---- */
.zju-setting-status{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  padding:6px 0;font-size:13px;line-height:1.5;
  color:var(--dsw-alias-label-secondary,#cfd3d6);
}
.zju-setting-status + .zju-setting-status{
  border-top:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));
}
.zju-setting-status strong{font-weight:500;color:var(--dsw-alias-label-primary,#f9fafb);}
.zju-setting-status[data-tone=ok] strong{color:var(--dsw-alias-state-success-primary,#4caf7d);}
.zju-setting-status[data-tone=warn] strong{color:var(--dsw-alias-state-warn-label,#e0a24a);}
.zju-setting-status[data-tone=bad] strong{color:var(--dsw-alias-state-error-primary,#e06c6c);}
`;
