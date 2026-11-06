/**
 * 壳域：**版式与路由契约**（`dsh-zhiyun-shell-workbench/src/model.js`）。
 *
 * # 为什么基准需要壳
 *
 * 「知识树」不是一个孤立的数据结构 —— 它要落在某一页里、那一页可能整幅铺开、
 * 承载它的包可能被用户取消。这些判断都在壳里，而且是**纯函数**：
 *
 *   · `NAV` / `RAIL_DEFAULT` / `RAIL_ACCOUNT` —— 有哪些页、哪些固定在导轨上
 *   · `FULL_BLEED_PAGES` —— 哪一页不套版心（自己管滚动）
 *   · `pageBundle(id)` —— 一页由哪个包承载（用来判断"取消这个包会怎样"）
 *   · `hiddenPageIds(enabled)` —— 包被取消后，哪些页要从侧栏藏起来
 *   · `visiblePages(hidden)` —— 实际显示的页
 *   · `activePage(panel)` —— 当前停在哪一页
 *   · `matchingPages(query)` —— 跳转搜索命中哪些页
 *   · `beijingDate(now)` —— 今天页的日期标题
 *
 * 基准可以直接调这些函数回答"树/讲义该出现在哪、会不会被藏起来"，
 * 而不用在基准里再写一份页面规则（写第二份的结局是半年后两边不一致）。
 *
 * ⚠️ 这些是**纯函数**，不经装配 —— 与 source_bridge 里"必须经 apply()"的
 *    那条纪律不矛盾：那条纪律针对的是**需要注入/路由**的功能，不是纯判断。
 */

import { shell as shellModule } from './_base.mjs';

/**
 * 壳的全部功能函数。
 *
 * @returns 见文件头那张清单。
 */
export async function shellFunctions() {
  const m = await shellModule();
  return {
    NAV: m.NAV,
    RAIL_DEFAULT: m.RAIL_DEFAULT,
    RAIL_ACCOUNT: m.RAIL_ACCOUNT,
    FULL_BLEED_PAGES: m.FULL_BLEED_PAGES,
    panelKey: m.panelKey,
    pageBundle: m.pageBundle,
    hiddenPageIds: m.hiddenPageIds,
    visiblePages: m.visiblePages,
    activePage: m.activePage,
    matchingPages: m.matchingPages,
    beijingDate: m.beijingDate,
  };
}

/**
 * 一页的**版式画像**：这一页叫什么、由哪个包承载、是否整幅铺开、是否常驻导轨。
 *
 * 基准用它回答"知识树/讲义落在哪一页、那一页是什么版式"。
 *
 * @param id - 页面 id。
 * @returns `{ id, label, hint, bundle, fullBleed, pinned, accountPage }` 或 null。
 */
export async function pageProfile(id) {
  const m = await shellModule();
  const page = m.NAV.find((p) => p.id === id);
  if (!page) return null;
  return {
    id: page.id,
    label: page.label,
    hint: page.hint,
    icon: page.icon,
    bundle: m.pageBundle(page.id),
    fullBleed: m.FULL_BLEED_PAGES.includes(page.id),
    pinned: m.RAIL_DEFAULT.includes(page.id),
    accountPage: m.RAIL_ACCOUNT === page.id,
  };
}

/** 全部页的版式画像（基准里做"页面契约"快照用）。 */
export async function pageProfiles() {
  const m = await shellModule();
  const out = [];
  for (const page of m.NAV) out.push(await pageProfile(page.id));
  return out;
}

/**
 * 当某些包被停用时，侧栏会变成什么样。
 *
 * @param disabledBundles - 被停用的包名数组。
 * @returns `{ hidden, visible, navCount }`。
 */
export async function sidebarWithDisabled(disabledBundles = []) {
  const m = await shellModule();
  const enabled = new Map();
  for (const page of m.NAV) {
    const bundle = m.pageBundle(page.id);
    if (bundle) enabled.set(bundle, !disabledBundles.includes(bundle));
  }
  const hidden = m.hiddenPageIds(enabled);
  return { hidden: [...hidden], visible: m.visiblePages(hidden).map((p) => p.id), navCount: m.NAV.length };
}
