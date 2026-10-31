export const NAV = Object.freeze([
  // ⚠️ 每个图标必须**自带含义且彼此不重样**：侧栏是只有图标的导轨，名字靠悬停浮出。
  //    曾经「论文」「笔记」共用折角稿纸、「问一问」「反馈」共用对话气泡、
  //    「我的课」「看课」共用一本书 —— 一排里出现两个一样的图形，导轨就没法用了。
  { id: 'today', label: '今天', icon: 'calendarToday', hint: '从今天开始，按自己的节奏学习' },
  // 紧挨「今天」：两者都是「读材料」的入口，用户找论文时先看课程再看文献是自然顺序。
  // hint 里刻意不出现「规划」——tests/profile.test.mjs 用 matchingPages('规划') 断言
  // 搜索只命中「问一问」，那是一条守卫别名的测试，别让新页面污染它。
  { id: 'paper', label: '论文', icon: 'paper', hint: '打开本地 PDF，选中英文即可翻译并提问' },
  { id: 'ask', label: '问一问', icon: 'askBubble', hint: '和 AI 一起理解、思考与规划' },
  // 「学习」= 课程目录 + 回放 + 整理，**一页**。
  //
  // 这里曾经是三页：「我的课」（只列课程与节次）、「看课」（回放的视频/课件/字幕）、
  // 「学习」（讲义/终稿/出题/笔记）。三者读的是**同一份** `state.content`，用户走的
  // 也是同一段动线（选课 → 看回放 → 整理 → 回看），拆成三页的代价是每一步都要离开
  // 当前上下文：看课时读不到讲义，读讲义时回不到那一段，还得记着自己是从哪进来的。
  //
  // 现在播放是这一页里的一栏（`zs-content-switch` 的「视频」），课程目录是左栏，
  // 整理在其余几栏。导航因此少两项 —— 这是**合并**，不是删功能。
  { id: 'study', label: '学习', icon: 'bulb', hint: '课程、回放、课件与笔记，都在这一页' },
  // 「课堂」= 生成出来的那一节课本身，紧跟在「学习」后面：学习读的是自己的课，
  // 课堂看的是生成出来的课，是同一段动线上相邻的两步。
  //
  // 它注册的插槽不叫 `zhiyun.<id>.content` —— 页面包（`dsh-zhiyun-page-classroom-play`）
  // 用的是 `zhiyun.classroom.play`。宿主侧插槽名归页面包所有（它同时被播放页的测试与
  // 客户端共用），所以这里**照实写死**，由 `pageSlot()` 统一取值，而不是让壳去猜一个
  // 页面包没注册过的名字（猜错的表现是这一页永远只有「暂时不可用」占位）。
  { id: 'classroom', label: '课堂', icon: 'play', slot: 'zhiyun.classroom.play', hint: '按场景播放生成出来的课堂，随时翻到任意一节' },
  // 「生成」是「课堂」的**二级入口**：`sidebar: false` + `parent` ——
  // 与并入「学习」之前的「看课」同一种写法（子页不占导轨、也不进 Ctrl+K）。
  // 理由：它是从课堂里 drill-in 的一步（要改的正是这一节课的大纲），离开课堂上下文
  // 单独点进去只有一张空表单。入口由课堂页的 `zy-page-subnav` 按钮给出。
  { id: 'classroom-build', label: '生成', icon: 'play', sidebar: false, parent: 'classroom', slot: 'zhiyun.classroom.build', hint: '写一段 brief，先改大纲再生成整节课' },
  // 「规划」紧跟「学习」：学完当天的事，接下来就是安排明天 —— 动线是连着的。
  //
  // ⚠️ label 与 hint 都**刻意不含「规划」**吗？不 —— 这一页就是叫「规划」。
  //    原先 tests/profile.test.mjs 用 matchingPages('规划') 断言"只命中问一问"，
  //    那条断言的前提是"还没有规划页"。现在有了，断言随之改成"问一问与规划各命中一次"，
  //    否则等于为了让旧测试好过而给页面起个不含本词的名字，是本末倒置。
  { id: 'quiz', label: '题库', icon: 'check', hint: '跨课程按知识点出题，新题与复习交错练习' },
  { id: 'planning', label: '规划', icon: 'calendar', hint: '读你自己中转站里推上来的规划与日记' },
  // 「笔记」紧跟「学习」：学完就记是连着发生的两步（整理 → 落成自己的话）。
  // hint 避开「规划」（守卫别名，见上面那条注释）。
  { id: 'notes', label: '笔记', icon: 'notebook', hint: '用双链把想法连成一张知识网' },
  { id: 'me', label: '个人', icon: 'user', hint: '你的学习空间' },
  // 「插件」放在最后：它是关于这个工作台**自己怎么组装**的一页，属于设置性质，
  // 不属于学习动线（找一个学习入口时不该先撞见它）。
  // hint 里同样刻意避开「规划」（同上面那条守卫）。
  { id: 'plugins', label: '插件', icon: 'plug', hint: '看这个工作台由哪些包组成，取消用不到的那些' },
  // 「文档」与「插件」「反馈」同居尾部：三者都是关于工作台**自己**的页（说明书、
  // 怎么组装、怎么提需求），不属于学习动线 —— 找一个学习入口时不该先撞见它们。
  //
  // 图标用 `book`（未被打架的一本书）。不要换成 `fileText`：它和「论文」的 `paper`
  // 在 24px 下只差末尾两笔，导轨里看着是同一个图形。
  // hint 同样避开「规划」（守卫别名，见 today 那条注释）。
  { id: 'docs', label: '文档', icon: 'book', hint: '查协作规范与开发指南' },
  // 「反馈」与「插件」并列放在最后：两者都是关于工作台**本身**的页（怎么组装、怎么
  // 提需求），不属于学习动线。hint 同样避开「规划」（守卫别名）。
  { id: 'feedback', label: '反馈', icon: 'megaphone', hint: '提需求、在讨论串里聊，看维护者怎么回' },
]);
export const panelKey = id => `zhiyun.${id}`;

/**
 * 导航**上半组**：固定在上面、**不可撤销**的页 —— 学习动线（今天 / 论文 /
 * 问一问 / 学习 / 课堂 / 规划 / 笔记）。
 *
 * 它们不出现在「···」菜单里，也没有图钉可点：菜单只管**下半组**（分隔线下方
 * 那些由用户固定进来的页）。这条划分与 NAV 里那条注释是同一套理由 ——
 * 「插件」「反馈」是关于**工作台自己**的页，找一个学习入口时不该先撞见它们，
 * 所以默认收在「···」里，要用了再钉上去。
 *
 * ⚠️ 用 `Object.freeze` 的**清单**而不是给 NAV 加字段：上半组是「版式契约」，
 *    和 `FULL_BLEED_PAGES` 一样集中在这里，一眼能看全导轨长什么样。
 */
export const RAIL_DEFAULT = Object.freeze(['today', 'paper', 'ask', 'study', 'classroom', 'quiz', 'planning', 'notes']);

/**
 * **单独钉在导轨最下方**的页：个人。
 *
 * 它不参与上半组/下半组那套分组 —— 呈现方式也不一样（一个圆形头像，不是图标），
 * 位置固定在左下角最底，与「切换明暗」等全局控件同处一块。
 * 同样**不可撤销**：既是账号入口，也是"这是我的空间"的唯一视觉标识。
 */
export const RAIL_ACCOUNT = 'me';

/**
 * **整幅铺开**的页：内容区不套 `.zy-content` 的版心（980px 上限 + 文章式内边距）。
 *
 * 为什么需要这个区分：`.zy-content` 是给**文章型**页面用的（今天 / 个人 / 插件），
 * 它的 max-width 与内边距让长文本行宽可读。但编辑器不是文章 —— 它是一个应用面板：
 *
 *   1. 版心 980px 减去左右各 48px 内边距，只剩约 880px；笔记页里再放
 *      ribbon + 文件树 + 编辑器 + 右栏，正文被挤到一两百像素宽；
 *   2. `.zy-content` 的高度由内容决定，于是页内元素的 `height:100%` 解析成
 *      `auto` —— 面板变成一张浮在滚动容器里的小卡片，四周全是死空间。
 *
 * 这类页面**自己**负责滚动（内部分区各自 overflow），所以整页不再纵向滚动。
 * 目前有两页：「笔记」（ribbon + 文件树 + 编辑器 + 右栏）与「文档」
 * （分区 tab + 左目录 + 正文 + 右页内目录）。
 *
 * ⚠️ 用显式清单而不是"按页面 id 猜"：铺开是一种版式契约，加进来时要有人想清楚
 * "这一页的滚动归谁"。猜错的表现是页脚被裁掉或出现双层滚动条。
 */
export const FULL_BLEED_PAGES = Object.freeze(['notes', 'docs']);

/**
 * 这一页的内容插槽名。
 *
 * 默认由 id 推导（`zhiyun.<id>.content`），这是壳与页面包之间唯一的插槽约定。
 * 「课堂」的两页是例外：它们注册的是 `zhiyun.classroom.play` / `zhiyun.classroom.build`
 * （名字归页面包所有，见 `dsh-zhiyun-page-classroom-play/src/index.js`），
 * 所以 NAV 里直接写着，这里只做取值 —— 不再维护第二份推导规则。
 * @param page - `NAV` 里的一项。
 * @returns 插槽名。
 */
export function pageSlot(page) {
  return page.slot ?? `zhiyun.${page.id}.content`;
}

/**
 * 承载页面的包名，与 `dsh-zhiyun-page-<id>` 推导不一致的那些。
 *
 * 只有「课堂」：「课堂」的播放与生成是两个包，而导航只有一页（指向播放），
 * 生成是它的二级页。被取消时要藏起来的正是**播放**那一项。
 */
const PAGE_BUNDLES = Object.freeze({
  classroom: 'dsh-zhiyun-page-classroom-play',
  'classroom-build': 'dsh-zhiyun-page-classroom-build',
});

/**
 * 一个页面由哪个包承载。
 *
 * 「问一问」是宿主原生会话，没有承载包，所以永远在（也不能被取消）。
 * 其余按 id 推导；「课堂」的两页由两个包分别承载，推导不出同一个名字，因此单列。
 * @param id - 页面 id。
 * @returns 包名，或 null 表示这一页不属于任何可取消的包。
 */
export function pageBundle(id) {
  if (id === 'ask') return null;
  return PAGE_BUNDLES[id] ?? `dsh-zhiyun-page-${id}`;
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
 *
 * 过滤两类：
 *   1. `hidden` —— 承载它的包被用户取消了；
 *   2. `sidebar === false` —— 子页（从别的页 drill-in 进来的页面）。它是从别的页
 *      进来的，直接列在主导航里没有意义：点进去没有上下文，只能显示空态。
 *      同时也不该出现在 Ctrl+K 里 —— 那里搜出来同样点不出东西。
 *
 * @param hidden - 要藏起来的页面 id 集合。
 * @param pages - 候选页；默认 `NAV`。
 * @returns 保留下来的页。
 */
export function visiblePages(hidden, pages = NAV) {
  return pages.filter(page => !hidden.has(page.id) && page.sidebar !== false);
}
export function activePage(panel, pages = NAV) {
  // ⚠️ 这里**不**过滤 `sidebar: false`：子页也要能被认出来。
  // 过滤了的话，停在子页时 `activePage` 返回 null，侧栏会把「问一问」当成
  // 当前页高亮，而主面板其实在别处 —— 两处说的不是同一件事。
  if (panel == null || panel === 'conversation') return 'ask';
  return pages.find(page => panelKey(page.id) === panel)?.id ?? null;
}
export function matchingPages(query, pages = NAV) {
  const normalized = query.trim().toLocaleLowerCase();
  return pages
    .filter(page => page.sidebar !== false)
    .filter(page => `${page.label} ${page.hint}`.toLocaleLowerCase().includes(normalized));
}

// 这里曾经有一份 pickLearningWorkspace 的副本。拆包时学习空间连同它的挑选规则一起
// 搬进了 dsh-zhiyun-core-study/src/learning-space.js（那里要求「标题恰好命中一条」才算
// 确定，并把选中逻辑经 zhiyunLearningSpace 服务暴露给外壳）。留在壳里的这份无人导入、
// 语义还更弱（find 而非 filter），是过期副本，已删除 —— 别再抄第二份。
export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
}
