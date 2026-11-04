/**
 * 把 dsh-pages 的导航栏**默认宽度**校准成 51px。
 *
 * # 为什么不改 dsh-pages 本身
 *
 * 页面壳是通用插件，64px 只是它的兜底值。产品想要自己的默认值，应由产品这一层给出，
 * 而不是 fork 页面壳或改 node_modules —— 后者下次安装就丢。
 *
 * # 默认值的两半
 *
 * 「默认宽度」在两个地方被用到，必须一起校准，否则会出现「首次是 51、点恢复默认又变回
 * 64」的不一致：
 *   1. **启动时的初始宽度** —— 由页面壳的 `defaultRailWidth` 配置决定；
 *   2. **页面管理里「恢复默认宽度」的目标值** —— 同一个配置项。
 *
 * 本包通过客户端 pages.setDefaultRailWidth(51) 设置重置目标，再在没有用户宽度
 * 偏好时设置初始宽度。宿主 patch 的 config 不会自动传入客户端 apply，不能依赖它。
 * 老版本没有该 API 时只能设置初始宽度，不能保证其重置行为。
 */

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

export const name = 'zju-pages-default-client';

/** 只依赖页面壳服务；它不在时这个包静默不做事，不影响任何人。 */
export const inject = [];

/**
 * @param ctx - 客户端上下文。
 */
export function apply(ctx) {
  // 惰性取 pages：页面壳可能晚于本包挂载，而把它写进 inject 会让本包在
  // 页面壳缺席时一起 pending —— 一个只管默认宽度的包不该有这个连坐能力。
  ctx.inject(['pages'], scope => {
    scope.effect(() => {
      const pages = scope.pages;
      const previousDefault = pages.getSnapshot().defaultRailWidth;
      let storage;
      try { storage = globalThis.localStorage; } catch { /* storage may be denied */ }
      applyDefaultRailWidth(pages, storage);
      return () => {
        if (pages.getSnapshot().defaultRailWidth === DEFAULT_RAIL_WIDTH && Number.isInteger(previousDefault)) {
          pages.setDefaultRailWidth?.(previousDefault);
        }
      };
    }, 'zju: default rail width');
  });
}
