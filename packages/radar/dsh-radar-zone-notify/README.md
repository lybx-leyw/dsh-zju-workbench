# dsh-radar-zone-notify —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-10-30 · r106 · A 组** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有触发口径、没有节流、没有 UI。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**本仓「今天有哪件事过期了」这件事，只在用户打开工作台的那几秒里存在。**
本包只补这一件事：锁版 `dsh-plugin-notifications` 的**宿主半边**，把「今日」页
已经算好的到期条目送到桌面。

## 集成方式：**强化式集成**（不是「全新」）

三条判据：

| # | 判据 | 本包 |
| --- | --- | --- |
| ① | **仍是同一个面板** | ✅ 不新增页面、不新增 settings 分组；通知是「今日」页既有内容的另一个出口 |
| ② | **功能仍相似正交** | ✅ 还是「今天做什么 / 哪件过期」；通知不参与判定做什么、哪件算过期 |
| ③ | **底层多调了更优质实现** | ✅ 「零送达」→ 上游桌面通知栈（发送器降级链 + 落盘队列 + 重启不重发） |

**不是简单集成**：本仓今天**没有**任何 `new Notification` / `requestPermission`
（全仓 `src` + `packages` 实测 0 处），所以不存在「接进来重复一份已有功能」的问题；
反过来说，接入的唯一正当性就是 ③ —— 若评审认为「打开页面就够」，本包应直接废弃。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [bertholomus/dsh-public-plugins · plugins/notifications](https://github.com/bertholomus/dsh-public-plugins/tree/main/plugins/notifications) |
| 包名 / 锁版 | `dsh-plugin-notifications@0.1.0`（**写死，不用 `^`**） |
| 许可证 | **MIT** ✅（根 `LICENSE` 首行 `MIT License / Copyright (c) 2026 bertholomus`；子包 `package.json` 亦为 `"license": "MIT"`） |
| Stars | 父仓 ★4（子插件未单列仓库） |
| 建仓 / 最近推送 | 2026-10-23 / 2026-10-29（**活跃**） |
| 语言 | JavaScript（`engines.node >= 22`） |
| 上游形状 | `dsh.bundle.patch: ./cordis.patch.yml` **＋** `dsh.client`（platform `web`） |
| npm | ⚠ **尚未发布**（`registry.npmjs.org/dsh-plugin-notifications` → 404） |

### 上游做什么

> *System notifications for DSH when its window is hidden or unfocused, for other plugins to call.*

发送器按顺序挑第一个在场的：`desktopRuntime` → 桌面应用窗口（Web Notifications API）
→ 浏览器标签页。无窗可发时**留在磁盘**、下次窗口回来再发一次，重启**不丢不重**；
通知历史在设置页可查。

## 为什么只挂宿主半边

上游 `dsh.client.inject` 带 `@deepseek-ai/dsh-client-ui-settings` 等一整组 UI 包 ——
它会**自己接管 settings 的一组页面**。本仓「今日」页已有自己的布局主张与设置分组，
叠两套外壳的代价大于收益。

⇒ **只挂宿主半边，UI 留在 `dsh-zhiyun-page-today`。** 该重写不在本骨架范围内。
同一条判断在 `dsh-radar-market`（上游 `dshmarket`）与 `dsh-zhiyun-host-paper` 已各写过一遍。

## 与本仓现有判定的关系

- 过期口径**不新造**：复用 `dsh-zhiyun-page-planning/src/time.js`（只算未完成）。
- 「不需要再被提醒了」的标记在 `dsh-zhiyun-page-planning/src/ticks.js`，本包**读不写**，
  勾掉的一律**不发**。
- 与 `dsh-radar-review-due`（FSRS 到期）无重叠：那个解决「先做哪道题」，
  本包解决「人不在电脑前时怎么知道」。两者都成立，**可以并存**。

## 接入前必须先做的事

按依赖顺序（`src/index.js` 里的 TODO 编号与之一一对应）：

1. **人工评审**确认判据 ① 成立（要不要通知设置面）。
2. **解决「从哪拿包」** —— npm 上还没有这个包。要么等上游发版，要么锁 git 引用
   并接受构建步骤。**这一条不解决，本包不可能跑起来。**
3. **触发口径**：只用 `time.js` 的未完成口径 + 尊重 `ticks.json`。
4. **节流与静默**：同一条多久只提醒一次、夜间是否静默 —— **产品决策，骨架不预设**。
5. 只发通知，不改「今日」数据、不替用户勾 `ticks`。
6. 客户端半边**不引入**。
7. **数据目录**拟 `data/zhiyun-zone-notify`；发不出去不能拖垮页面。
8. **窄接口**只出 `send` + `status`，不透传上游 API 面。
9. **真实宿主验证**：前台不弹 / 隐藏时弹且点击回到条目 / 重启不重发。

## 不写测试

依 `dsh-ecosystem-radar` 与仓库约定，radar 包内**不含** `test/` / `*.test.*`。
