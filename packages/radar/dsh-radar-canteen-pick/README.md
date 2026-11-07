# dsh-radar-canteen-pick —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 与 `src/upstream.js` 都是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [neoVqs88/ZJUersTodayRecipe](https://github.com/neoVqs88/ZJUersTodayRecipe) |
| 名称 | **zjuer 今天吃什么**（玉泉校区校园饮食与社区微信小程序） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；仓库根有 `LICENSE`，`package.json` 亦声明 MIT） |
| 包标识 | `zjuer-eat-what@1.0.0`（微信小程序，**非 npm 可安装包**） |
| Stars | ★0 |
| 最近推送 | 2026-09-08 |
| 首次发现 | 2026-11-06（B 组 · 浙大场景） |

---

## 集成类型

**B 类 · 其他 JS 项目**（非原生 DSH 插件包：无 `dsh.bundle.patch`、无 `cordis.patch.yml`）。

## 与现有功能的关系：**强化式集成**

三条判据**同时成立**：

1. **仍是同一个面板** —— 不新增页面。`packages/dsh-zhiyun-page-today/src/` 继续是唯一渲染入口，只是饭点时段的卡片由占位行变成有内容的行。
2. **功能仍相似正交** —— 本仓「今天」页饭点能力目前只有**时间占位**（按 `agenda.js` 的时段切分插一行提醒），**没有任何食堂/菜品数据**。新增的是同一时段内的具体选择，不是另开功能。
3. **底层多调了更优质实现** —— 本仓全仓 `grep -ri "canteen|食堂"` 零实现（仅命中文档）；上游有完整目录 + 推荐 + 打卡偏好。骨架只调用上游，不重写。

---

## 只取什么 / 不取什么

**取**（离线、无需网络与登录）：

- `data/` 玉泉校区基础目录（`canteens` / `dishes`）
- `services/` 中**纯函数**推荐与偏好排序（逐函数确认无 `wx.*` 调用）

**不取**（上游主体，与 DSH 宿主不兼容）：

| 上游路径 | 不取的理由 |
| --- | --- |
| `cloudfunctions/`（`ensureUser` / `communityPosts` / `communityComments` / `adminCommunity` / `mealCheckins` / `weeklyInsights` / `messageHelper`） | 依赖微信云开发运行时；本仓工作台无自建后端，写操作无处落库 |
| `pages/` `components/` `behaviors/` | 小程序 WXML/WXSS 绑定层，宿主不兼容 |
| `project.config.json` | 含上游云环境 ID，属上游配置 |

---

## 待评审确认

1. 上游 `data/` 是**降级基础目录**，菜品与价格可能过期 —— 是否仅作首次填充？
2. 提取 `services/` 纯函数时需确认无 `wx.*` / `getApp()` 耦合。
3. 与本仓 POI / 楼栋模型的字段对齐方式（窗口、楼层、供应时段）。

## TODO

见 `src/index.js` 与 `src/upstream.js` 顶部。整体顺序：

- [ ] 锁版 `zjuer-eat-what@1.0.0`，vendor 白名单文件到 `vendored/`，附 `VERSION` / `SOURCE`。
- [ ] 导出 `pickCanteen({ now, recentMeals, topK })` 与 `listDishes()`。
- [ ] 与「今天」页饭点卡片对接（**不新增页面**）。
- [ ] `ATTRIBUTION.md` 记明来源、版本、摘取文件清单。

## 许可

上游 MIT，本仓摘取部分沿用 MIT，摘取时在 `ATTRIBUTION.md` 记明。**不搬运上游源码**，只 vendor 数据与纯函数并在 `VERSION` 中锁版。
