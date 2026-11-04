/**
 * 产品层对 `@lybx-leyw/dsh-pages` 的校准：导航栏默认宽度、导航栏图标，以及
 * 原生侧栏品牌行的去留。
 *
 * # 为什么不改 dsh-pages 本身
 *
 * 页面壳是通用插件，64px 与兜底字形只是它的默认值。产品想要自己的默认值/外观，
 * 应由产品这一层给出，而不是 fork 页面壳或改 node_modules —— 后者下次安装就丢。
 *
 * # 默认宽度的两半
 *
 * 「默认宽度」在两个地方被用到，必须一起校准，否则会出现「首次是 51、点恢复默认又变回
 * 64」的不一致：
 *   1. **启动时的初始宽度** —— 由页面壳的 `defaultRailWidth` 配置决定；
 *   2. **页面管理里「恢复默认宽度」的目标值** —— 同一个配置项。
 *
 * 本包通过客户端 pages.setDefaultRailWidth(51) 设置重置目标，再在没有用户宽度
 * 偏好时设置初始宽度。宿主 patch 的 config 不会自动传入客户端 apply，不能依赖它。
 * 老版本没有该 API 时只能设置初始宽度，不能保证其重置行为。
 *
 * # 图标
 *
 * 页面壳注册 `home` / `pages` 用的是兜底字形 `⌂` / `▦`，顶部占位是文字 `P /`。
 * 这里换成矢量图标（见 `icons.jsx`），并且**不改注册归属**：页面仍由页面壳注册，
 * 产品只通过 `setPageIcon` / `setRailPlaceholderIcon` 决定画什么。三个设置都在同一个
 * effect 里，卸载时按「只撤自己改过的」规则还原。
 *
 * # 原生品牌行
 *
 * 产品自己那只鲸鱼在导轨上，原生侧栏头部再放一只鲸鱼加字标，就是两只同样的鲸鱼并排。
 * 所以顶部品牌行被让空（见 `brand.js`）。这一项与页面壳无关，走宿主槽位影子注册，
 * 且**只清身份区**：折叠按钮留在原处。它是独立 effect，页面壳缺席时照常生效。
 */

import { WhaleIcon } from './icons.jsx';
import { installRailIconArtwork } from './rail-icons.js';
import { suppressNativeBrand } from './brand.js';
import { installCollapseIntoWhale } from './rail-action.jsx';
import { installManagerStyle } from './manager-style.js';

/** 产品希望的导航栏默认宽度（像素）。 */
export const DEFAULT_RAIL_WIDTH = 51;

/**
 * dsh-pages 的偏好存储键。
 *
 * 与 `@lybx-leyw/dsh-pages` 的 `preferencesStorageKey()` 逐字一致：它不在包的公开
 * exports 里，而这里只读一次，复制这一行比多暴露一个 API 便宜。
 *
 * @param config - dsh-pages 归一化后的配置。
 * @returns localStorage 键名。
 */
export function preferencesStorageKey(config) {
  return 'dsh-pages:preferences:v1:' + encodeURIComponent(JSON.stringify([
    config.navigationSlot, config.pageSlot, config.classPrefix, config.homePage,
  ]));
}

/**
 * 用户是否已经显式选过宽度。
 *
 * 读不到（无痕模式、坏 JSON、没有 storage）时一律当作「没选过」——
 * 默认值该生效，而不是因为读不到就放弃。
 *
 * @param storage - Storage 实现。
 * @param key - 偏好存储键。
 * @returns 是否已有宽度偏好。
 */
export function hasStoredWidth(storage, key) {
  if (!storage) return false;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return false;
    const document = JSON.parse(raw);
    return Number.isInteger(document?.railWidth);
  } catch {
    return false;
  }
}

/**
 * 给还不认 `defaultRailWidth` 的页面壳兜底。
 *
 * 新版本页面壳自己会以 51 启动，并让「恢复默认宽度」回到 51 —— 那时这里什么都不做。
 * 只有在页面壳仍以 64 启动、且用户从未设置过宽度时，才补一次。
 *
 * @param pages - dsh-pages 服务（`ctx.pages`）。
 * @param storage - Storage 实现。
 * @returns 是否真的改了。
 */
export function applyDefaultRailWidth(pages, storage) {
  const config = pages?.config;
  if (!config) return false;
  // Cordis 宿主 entry.config 不会自动作为客户端 apply 的第二参数传入。
  // 必须通过客户端 pages 服务更新 reset 所读取的 snapshot，不能只改当前宽度。
  pages.setDefaultRailWidth?.(DEFAULT_RAIL_WIDTH);
  if (hasStoredWidth(storage, preferencesStorageKey(config))) return false;
  if (pages.getSnapshot().railWidth === DEFAULT_RAIL_WIDTH) return false;
  pages.setRailWidth(DEFAULT_RAIL_WIDTH);
  return true;
}

/**
 * 导航栏顶部的占位图标换成 DeepSeek 鲸鱼。
 *
 * 用的完全是 `@lybx-leyw/dsh-pages` **已经提供**的 `setRailPlaceholderIcon`：
 * 那个位置本来就是「产品可以自己填一个图标」的槽，默认是文字 `P /`。所以这一项
 * 不需要页面壳做任何改动。
 *
 * @param pages - dsh-pages 服务。
 * @returns 撤销本次替换的 disposer。
 */
export function applyRailIcons(pages) {
  if (typeof pages?.setRailPlaceholderIcon !== 'function') return () => {};
  const previous = pages.getSnapshot().railPlaceholderIcon;
  pages.setRailPlaceholderIcon(WhaleIcon);
  return () => {
    // 只撤自己改过的那一项：别人后来换掉的图标不该被我们覆盖回去。
    if (pages.getSnapshot().railPlaceholderIcon === WhaleIcon) pages.setRailPlaceholderIcon(previous);
  };
}

export const name = 'zju-pages-default-client';

/** 不写死依赖：各 effect 各自惰性 inject，缺谁就静默跳过谁。 */
export const inject = [];

/**
 * @param ctx - 客户端上下文。
 */
export function apply(ctx) {
  // 「页面管理」页的视觉整理是**纯样式覆盖**，与任何服务无关：页面壳自己就带
  // `data-pages-manager` 锚点。不写进 inject 依赖里，页面壳缺席时它也不该连坐。
  ctx.effect(() => installManagerStyle(), 'zju: manager page style');
  // 原生品牌行与页面壳**无关**：它由宿主侧栏自己的槽位渲染。放在同一个 effect 里会让
  // 「页面壳升级换 API」连坐掉整个品牌处理，所以两者各管各的。
  ctx.inject(['slots'], scope => {
    scope.effect(() => suppressNativeBrand(scope.slots), 'zju: native brand row');
  });
  // 「折叠收进鲸鱼」要三样东西一起才成立：槽位（挂替身）、页面壳（槽名）、布局（真去折叠）。
  // 少任何一个**都不隐藏**原生按钮 —— 否则用户会既没有替身、也没有原生入口。
  ctx.inject(['slots', 'pages', 'layout'], scope => {
    scope.effect(() => installCollapseIntoWhale({
      slots: scope.slots, pages: scope.pages, layout: scope.layout,
    }), 'zju: collapse into whale');
  });
  // 惰性取 pages：页面壳可能晚于本包挂载，而把它写进 inject 会让本包在
  // 页面壳缺席时一起 pending —— 一个只管默认宽度的包不该有这个连坐能力。
  ctx.inject(['pages'], scope => {
    scope.effect(() => {
      const pages = scope.pages;
      const previousDefault = pages.getSnapshot().defaultRailWidth;
      let storage;
      try { storage = globalThis.localStorage; } catch { /* storage may be denied */ }
      applyDefaultRailWidth(pages, storage);
      const undoIcons = applyRailIcons(pages);
      const undoCss = installRailIconArtwork(pages);
      return () => {
        undoCss();
        undoIcons();
        if (pages.getSnapshot().defaultRailWidth === DEFAULT_RAIL_WIDTH && Number.isInteger(previousDefault)) {
          pages.setDefaultRailWidth?.(previousDefault);
        }
      };
    }, 'zju: default rail width');
  });
}
