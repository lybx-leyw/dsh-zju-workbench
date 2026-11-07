/**
 * dsh-radar-canteen-pick —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 从上游 `zjuer 今天吃什么`（neoVqs88/ZJUersTodayRecipe，MIT，微信小程序，
 * 包名 `zjuer-eat-what@1.0.0`）**只提取两层数据/算法**，接到本仓「今天」页的
 * 饭点卡片上：
 *
 *   (a) **食堂 / 菜品目录**（`data/` 内置玉泉校区基础目录；`canteens` / `dishes` 集合）
 *       → 归一化为本仓的 POI 记录：楼栋、楼层、窗口、供应时段
 *   (b) **推荐排序**（`services/` 的菜品推荐与三餐打卡偏好）
 *       → 一个纯函数：给定「现在几点 / 已吃过的近 N 天」给出 Top-K 菜品
 *
 * ── 为什么是「强化式集成」而不是简单集成（B 类，三条同时成立）──────
 *
 *   1. **仍是同一个面板** —— 不新增页面。`packages/dsh-zhiyun-page-today/src/`
 *      继续是唯一渲染入口，只是饭点时段（11:00–13:00 / 17:00–19:00）的卡片
 *      由「空白 + 一句提示」变成「今天这几个窗口在供应什么」。
 *   2. **功能仍相似正交** —— 本仓现有「今天」页的饭点能力只有**时间占位**
 *      （按 `agenda.js` 的时段切分插入一行「该吃饭了」），**没有任何食堂数据**；
 *      新增的是**同一时段内的具体选择**。不是开一个新面板，是把占位行填上内容。
 *   3. **底层多调了更优质实现** —— 本仓全仓 `grep -ri canteen|食堂` 只命中
 *      文档与无关 README，**零实现**；上游有完整目录 + 推荐 + 打卡偏好。
 *      骨架只需调用上游目录，不重写。
 *
 * ── 反面情形（必须由评审裁掉的部分）─────────────────────────────
 *
 *   上游的主体是**微信小程序 + 云开发后端**：`cloudfunctions/` 里的
 *   `ensureUser`（微信登录 / OpenID）、`communityPosts` / `communityComments`
 *   （社区发帖与评论审核）、`adminCommunity`、`mealCheckins` 写库、
 *   `weeklyInsights`、`messageHelper`，以及 `project.config.json` 的
 *   云环境 ID。这些**本包一律不取**，理由：
 *
 *   - 依赖微信云开发（`wx.cloud`）运行时，与 DSH 宿主不兼容；
 *   - 本仓工作台**没有自建后端**（既有决定，见 registry 中同格一行的同类裁决），
 *     社区/打卡写操作无处落库；
 *   - 引入用户体系会牵出 OpenID 与隐私面，与雷达「只增强面板」的定位不符。
 *
 *   只保留**离线目录 + 纯函数排序**，两者都不需要网络与登录。
 *
 * ── 待评审确认的风险 ────────────────────────────────────────────
 *
 *   - 上游 `data/` 的玉泉基础目录是**降级数据**，菜品/价格可能已过期；
 *     评审需确认是否仅作为「首次填充」，真实数据另行同步。
 *   - 微信小程序目录为 `.js` 数据字面量，提取时需确认**无 WXML 绑定耦合**。
 *
 * ── TODO（评审通过后逐条落实）──────────────────────────────────
 *
 *   TODO(1) 锁定 `zjuer-eat-what@1.0.0`，仅 vendor `data/` 与推荐纯函数，
 *           不 vendor `cloudfunctions/`、`pages/`、`components/`。
 *   TODO(2) 在 `src/index.js` 导出 `pickCanteen({now, recentMeals, topK})`。
 *   TODO(3) 与本仓 POI / 楼栋模型对齐，供「今天」页饭点卡片消费。
 *   TODO(4) 上游目录许可为 MIT，摘取时在本包 ATTRIBUTION.md 记明来源与版本。
 *
 * @module dsh-radar-canteen-pick
 */

export const RADAR_PLACEHOLDER = true;

/**
 * 占位：未实现。评审通过前**不得**调用。
 *
 * @returns {never}
 */
export function pickCanteen() {
  throw new Error(
    'dsh-radar-canteen-pick: 候选骨架，未实现（见 src/index.js 顶部 TODO）'
  );
}

/**
 * 占位：未实现。评审通过前**不得**调用。
 *
 * @returns {never}
 */
export function listDishes() {
  throw new Error(
    'dsh-radar-canteen-pick: 候选骨架，未实现（见 src/index.js 顶部 TODO）'
  );
}
