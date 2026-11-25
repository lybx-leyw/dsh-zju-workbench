/**
 * 页面目录与导航纯函数。
 *
 * # 来历
 *
 * 原先住在 `dsh-zju-shell-workbench/src/model.js` —— 那个包是**产品界面外壳**
 * （侧栏、页框架、主题、React 组件）。外壳已随产品方向调整而退休（见
 * `archive/deprecated-packages/`），但本文件里的东西**不是外壳**：
 *
 *   - 零 import、零副作用，是纯数据 + 纯函数；
 *   - 测试（`profile.test.mjs`、`settings-adapter.test.mjs`）与脚本
 *     （`test-host.mjs`、`knowledge_tree_bench`）仍在用它做断言。
 *
 * 所以把它搬到共享层：**数据与判定继续可用，React 外壳安静归档。**
 *
 * # 与运行时装配的关系（2026-11 起）
 *
 * **导航的真源不再是这张表**，而是各页面包的注册点：页面调用
 * `registerPage()` 成对注册 `sidebar.panellist`（导轨图标）与 `main`（面板），
 * 装了就出现、卸载就消失（见 `page-native.jsx`）。
 *
 * 这张 `NAV` 是**离线镜像**：给测试、脚本与文档一个不启动宿主也能读到的清单。
 * 它可以用来断言「哪些页属于学习动线」，但**不能**拿它当运行时事实 ——
 * 引用前先确认你在测的是「模型」还是「装配」。两者的差别正是本仓吃过亏的地方。
 */

export const NAV = Object.freeze([
  // ⚠️ 每个图标必须**自带含义且彼此不重样**：侧栏是只有图标的导轨，名字靠悬停浮出。
  //    曾经「论文」「笔记」共用折角稿纸、「问一问」「反馈」共用对话气泡、
  //    「我的课」「看课」共用一本书 —— 一排里出现两个一样的图形，导轨就没法用了。
  { id: 'today', label: '今天', icon: 'calendarToday', hint: '从今天开始，按自己的节奏学习' },
  // 紧挨「今天」：两者都是「读材料」的入口，用户找论文时先看课程再看文献是自然顺序。
  { id: 'paper', label: '论文', icon: 'paper', hint: '打开本地 PDF，选中英文即可翻译并提问' },
  // 「问一问」已删除：原生 DSH 工作台现在是页面壳的**首页**（home），
  // 不需要产品再包一层 `ask` 页。原生会话/工作区状态不受影响。
  // 「学习」= 课程目录 + 回放 + 整理，**一页**。
  //
  // 这里曾经是三页：「我的课」（只列课程与节次）、「看课」（回放的视频/课件/字幕）、
  // 「学习」（讲义/终稿/出题/笔记）。三者读的是**同一份** `state.content`，用户走的
  // 也是同一段动线（选课 → 看回放 → 整理 → 回看），拆成三页的代价是每一步都要离开
  // 当前上下文：看课时读不到讲义，读讲义时回不到那一段，还得记着自己是从哪进来的。
  //
  // 现在播放是这一页里的一栏（`zws-content-switch` 的「视频」），课程目录是左栏，
  // 整理在其余几栏。导航因此少两项 —— 这是**合并**，不是删功能。
  { id: 'study', label: '学习', icon: 'bulb', hint: '课程、回放、课件与笔记，都在这一页' },
  // 「课堂」页面已移除（2026-11）：产品侧要的是**学习页里的 AI 教学**
  // ——生成课件、在学习页渲染单张课件——不要独立的课堂播放页与生成页。
  //
  // 因此这里不再有 `classroom` / `classroom-build` 两条 NAV：
  // `page-classroom-play`、`page-classroom-build`、`core/classroom-stage`、
  // `core/classroom-geometry` 都已归档到 `archive/deprecated-packages/`。
  // 保留的是生成与渲染链路（`classroom-generate` → `zwClassroomGenerate`，
  // `classroom-renderer` → `page-study` 的 `ClassroomSlide`）。
  // 「规划」页已于 2026-11 退役：整条链路（页面包 + 数据域 `core/planning`）
  // 一并下线，导航清单、profile 装配、客户端构建三处同时删。它的数据来源是中转站
  // 与平台待办，那两块仍各自独立存在（`deploy/relay-service`、平台待办聚合），
  // 只是不再有这一页去消费。若将来要接回，导航项、两个包、profile 三处都要一起加。
  //
  // 「题库 / 笔记 / 插件 / 文档」四页已于 2026-11 退役，连同它们独占的 core 包
  // （vault / plugin-graph）与渲染层（graph-render）一起归档到
  // archive/deprecated-packages/。导轨因此只剩学习动线的两页。
  // 若将来要接回，导航项、包、profile、构建清单四处都要一起加。
]);
export const panelKey = id => `zw.${id}`;

/**
 * 导航**上半组**：固定在上面、**不可撤销**的页 —— 学习动线（今天 / 论文 / 学习）。
 *
 * 它们不出现在「···」菜单里，也没有图钉可点：菜单只管**下半组**（分隔线下方
 * 那些由用户固定进来的页）。这条划分与 NAV 里那条注释是同一套理由 ——
 * 关于**工作台自己**的页（插件 / 文档等，现均已退役）不该挡住学习入口。
 *
 * ⚠️ 用 `Object.freeze` 的**清单**而不是给 NAV 加字段：上半组是「版式契约」，
 *    和 `FULL_BLEED_PAGES` 一样集中在这里，一眼能看全导轨长什么样。
 */
export const RAIL_DEFAULT = Object.freeze(['today', 'paper', 'study']);

/**
 * 导轨最下方那一格：**账号入口**，不是一个页面。
 *
 * 原来它指向「个人」页（`RAIL_ACCOUNT = 'me'`）。那一页已删除：它的内容搬进了
 * 原生设置的「账号与数据」分区，所以这一格不再「跳页」，而是直接浮出账号面板
 * （登录 / 设置）。
 *
 * 保留这个常量是为了让「头像这一格不可固定、不可撤销」的规则仍集中在一处 ——
 * `readPinned` 与「···」菜单都要把它排除在可管理页之外。
 */
export const RAIL_ACCOUNT = 'account';

/**
 * **整幅铺开**的页：内容区不套 `.zw-content` 的版心（980px 上限 + 文章式内边距）。
 *
 * 为什么需要这个区分：`.zw-content` 是给**文章型**页面用的（今天 / 插件），
 * 它的 max-width 与内边距让长文本行宽可读。但编辑器不是文章 —— 它是一个应用面板：
 *
 *   1. 版心 980px 减去左右各 48px 内边距，只剩约 880px；笔记页里再放
 *      文件树 + 编辑器 + 右栏，正文被挤到一两百像素宽；
 *   2. `.zw-content` 的高度由内容决定，于是页内元素的 `height:100%` 解析成
 *      `auto` —— 面板变成一张浮在滚动容器里的小卡片，四周全是死空间。
 *
 * 这类页面**自己**负责滚动（内部分区各自 overflow），所以整页不再纵向滚动。
 * 原先有两页：「笔记」与「文档」；两页均已于 2026-11 退役，清单现为空。
 * 保留这个常量与判据，是因为「铺开」是一种版式契约，将来加页面时仍要显式声明。
 *
 * ⚠️ 用显式清单而不是"按页面 id 猜"：铺开是一种版式契约，加进来时要有人想清楚
 * "这一页的滚动归谁"。猜错的表现是页脚被裁掉或出现双层滚动条。
 */
export const FULL_BLEED_PAGES = Object.freeze([]);

/**
 * 这一页的内容插槽名。
 *
 * 默认由 id 推导（`zw.<id>.content`），这是壳与页面包之间唯一的插槽约定。
 * 其余页面都用默认规则；需要自定义时在 NAV 里直接写 `slot`，这里只做取值。
 * @param page - `NAV` 里的一项。
 * @returns 插槽名。
 */
export function pageSlot(page) {
  return page.slot ?? `zw.${page.id}.content`;
}

/**
 * 承载页面的包名，与 `dsh-zhiyun-page-<id>` 推导不一致的那些。
 *
 * 目前为空：唯一曾需要它的「课堂」两页已归档。
 * 保留这个空对象而不是删掉函数，是因为 `pageBundle()` 与「插件」页的
 * 依赖图都读它 —— 删了要改三处调用方，留一个空表等价且更稳。
 */
const PAGE_BUNDLES = Object.freeze({});

/**
 * 一个页面由哪个包承载。
 *
 * 「问一问」是宿主原生会话，没有承载包，所以永远在（也不能被取消）。
 * 其余按 id 推导；「课堂」的两页由两个包分别承载，推导不出同一个名字，因此单列。
 *
 * 命名规则：页面包一律 `@lybx-leyw/dsh-zju-page-<id>`（目录 `packages/client/page-<id>`）。
 * 这条 fallback 与目录名一一对应 —— 目录改名时这里必须同步，否则
 * `hiddenPageIds()` 会把「包被取消」判断成「包还在」。
 *
 * @param id - 页面 id。
 * @returns 包名，或 null 表示这一页不属于任何可取消的包。
 */
export function pageBundle(id) {
  return PAGE_BUNDLES[id] ?? `@lybx-leyw/dsh-zju-page-${id}`;
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
  // 原生会话面板不是任何产品页（它属于页面壳的首页），返回 null 让导航不高亮。
  if (panel == null || panel === 'conversation') return null;
  return pages.find(page => panelKey(page.id) === panel)?.id ?? null;
}
export function matchingPages(query, pages = NAV) {
  const normalized = query.trim().toLocaleLowerCase();
  return pages
    .filter(page => page.sidebar !== false)
    .filter(page => `${page.label} ${page.hint}`.toLocaleLowerCase().includes(normalized));
}

// 这里曾经有一份 pickLearningWorkspace 的副本。拆包时学习空间连同它的挑选规则一起
// 搬进了 @lybx-leyw/dsh-zju-core-study/src/learning-space.js（那里要求「标题恰好命中一条」才算
// 确定，并把选中逻辑经 zwLearningSpace 服务暴露给外壳）。留在壳里的这份无人导入、
// 语义还更弱（find 而非 filter），是过期副本，已删除 —— 别再抄第二份。
export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
}
