export const NAV = Object.freeze([
  { id: 'today', label: '今天', icon: 'sun', hint: '从今天开始，按自己的节奏学习' },
  { id: 'courses', label: '我的课', icon: 'book', hint: '课程、回放与课堂资料' },
  // 紧挨「我的课」：两者都是「读材料」的入口，用户找论文时先看课程再看文献是自然顺序。
  // hint 里刻意不出现「规划」——tests/profile.test.mjs 用 matchingPages('规划') 断言
  // 搜索只命中「问一问」，那是一条守卫别名的测试，别让新页面污染它。
  { id: 'paper', label: '论文', icon: 'paper', hint: '打开本地 PDF，选中英文即可翻译并提问' },
  { id: 'ask', label: '问一问', icon: 'chat', hint: '和 AI 一起理解、思考与规划' },
  { id: 'study', label: '学习', icon: 'layers', hint: '把学过的内容，慢慢变成自己的知识' },
  { id: 'me', label: '个人', icon: 'user', hint: '你的学习空间' },
  // 「插件」放在最后：它是关于这个工作台**自己怎么组装**的一页，属于设置性质，
  // 不属于学习动线（找一个学习入口时不该先撞见它）。
  // hint 里同样刻意避开「规划」（同上面那条守卫）。
  { id: 'plugins', label: '插件', icon: 'graph', hint: '看这个工作台由哪些包组成，取消用不到的那些' },
]);
export const panelKey = id => `zhiyun.${id}`;
/**
 * 一个页面由哪个包承载。
 *
 * 「问一问」是宿主原生会话，没有承载包，所以永远在（也不能被取消）。
 * @param id - 页面 id。
 * @returns 包名，或 null 表示这一页不属于任何可取消的包。
 */
export function pageBundle(id) {
  return id === 'ask' ? null : `dsh-zhiyun-page-${id}`;
}
/**
 * 该从侧栏藏起来的页。
 *
 * 页面被取消后，外壳仍然按 `NAV` 无条件为它声明面板与内容插槽，于是侧栏会留着一个点开
 * 只有「暂时不可用」的入口 —— 这里把那种页挑出来。
 *
 * `enabled` **没有**报告某一页时一律当作还在（`enabled.has` 那道判断）：读不到状态时宁可
 * 多显示一个入口，也不要让整栏少几项。宿主没装插件管理、或读数还没回来，都走这条路。
 * @param enabled - 包名 → 是否启用（宿主插件管理的行级读数）。
 * @param pages - 候选页；默认 `NAV`。
 * @returns 要藏起来的页面 id 集合。
 */
export function hiddenPageIds(enabled, pages = NAV) {
  return new Set(pages
    .filter(page => {
      const bundle = pageBundle(page.id);
      return bundle !== null && enabled.has(bundle) && enabled.get(bundle) !== true;
    })
    .map(page => page.id));
}
/**
 * 实际显示在侧栏与跳转搜索里的页。
 * @param hidden - 要藏起来的页面 id 集合。
 * @param pages - 候选页；默认 `NAV`。
 * @returns 保留下来的页。
 */
export function visiblePages(hidden, pages = NAV) {
  return pages.filter(page => !hidden.has(page.id));
}
export function activePage(panel, pages = NAV) {
  if (panel == null || panel === 'conversation') return 'ask';
  return pages.find(page => panelKey(page.id) === panel)?.id ?? null;
}
export function matchingPages(query, pages = NAV) {
  const normalized = query.trim().toLocaleLowerCase();
  return pages.filter(page => `${page.label} ${page.hint}`.toLocaleLowerCase().includes(normalized));
}

// 这里曾经有一份 pickLearningWorkspace 的副本。拆包时学习空间连同它的挑选规则一起
// 搬进了 dsh-zhiyun-study-core/src/learning-space.js（那里要求「标题恰好命中一条」才算
// 确定，并把选中逻辑经 zhiyunLearningSpace 服务暴露给外壳）。留在壳里的这份无人导入、
// 语义还更弱（find 而非 filter），是过期副本，已删除 —— 别再抄第二份。
export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
}
