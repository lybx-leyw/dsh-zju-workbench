# dsh-radar-orb —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-10-31 · r119 · A 组（DSH 插件生态）** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有路由、没有存储。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**本仓所有「把外部材料变成学习内容」的入口都停在文件上；没有文件形态的课堂现场，只能手打。**
本包锁版引入上游 `dsh-orb` 的**宿主半边**，在今天页 / 课堂页的既有按钮旁补一条
「截一段屏 → 进当次会话」的路径 —— **新的是输入通道，不是面板**。

## 定性：**强化式集成**（不是「全新」）

| 判据 | 本包怎么满足 |
| --- | --- |
| 仍是同一个面板 | 入口是今天页「问一问」输入框旁的按钮 + 课堂页讲义工具栏的按钮，**不新增导航、不新增页面** |
| 功能仍相似正交 | 仍是「问一问 / 补资料」，只是输入从**文字**扩到**屏幕一帧**；不与笔记正文抢内容、不与讲义解析链抢节点 |
| 底层多调了更优质实现 | 截屏、附件封装、会话投影全由上游 `dsh-orb` 承担，本仓不自造截屏与附件管线 |

> 若评审认为「屏幕输入」应算作新能力域而非强化，请**先驳回**：
> 那意味着判据①不成立，本骨架的前提即消失。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/mini-yifan/dsh-orb-cordis |
| 许可证 | **MIT** ✅（仓库 `license.spdx_id` 实核） |
| 锁版 | **`dsh-orb@0.2.0`**（`npm view dsh-orb version license` → `0.2.0` / `MIT`，与仓库 `packages/bundle/package.json` 的 `0.2.0` 一致） |
| 类型 | **A · 原生 DSH 插件包**：子包 `packages/bundle` 带 `dsh.bundle.patch: ./cordis.patch.yml`，`packages/client-settings` 带 `dsh.client.inject` |
| 体量 | ★293，仓库为 pnpm monorepo（7 个子包：`bundle` / `host` / `client-settings` / `computer-use` / `helper` / `voice` / `native-selection`） |
| 活跃度 | push 2026-10-26，npm 已有多版本 |

上游 `dsh-orb@0.2.0` 的依赖面（实核）：`@deepseek-ai/dsh-*` 全部为区间
`>=0.1.7-rc.2 <0.3.0-0`，但 **`@deepseek-ai/cordis@4.0.4`** 与
**`@deepseek-ai/schemastery@3.18.4`** 是**写死版本** ⇒ 这是本包唯一的硬兼容风险，
见 `src/upstream.js` 的 `checkHostCompat()`。

## 三条必须守住的边界（评审重点）

1. **不引入 `preset-computer-use`**。上游 `packages/bundle/cordis.patch.yml` 的第一步就是
   `insert: preset-computer-use`（一个新 agent 预设、含自己的 persona 长提示词）。
   **新建 agent 模式 = 新入口形态**，与本仓「会话只有一个形态」冲突 ⇒ 本包 patch 不抄这一段。
2. **不引入 `./client`（桌面悬浮球）**。常驻桌面的球是**第三个外壳**；本仓外壳是
   `dsh-zhiyun-shell-workbench` + `dsh-zhiyun-shell-ui`。与 `dsh-radar-market` 不接
   `dsh-client-ui-settings` 同一条理由。`REFUSED_UPSTREAM_FACES` 已把这两项写死。
3. **截图不落本仓数据目录**。只进当次会话的附件流；要长期留存，交给
   `dsh-zhiyun-core-notes` 既有的「粘贴即附件」路径，**本包不建目录、不写 store**。

## 为什么不用 `dsh-orb` 的现成形态

上游给的是「Computer Use 预设 + 悬浮球」整套。若直接整套挂载：
左侧会多一个 agent 模式选择、桌面会多一个常驻球、还会额外拉进
`native-selection`（原生选中）+ `voice`（语音）两个子包。**这三点没有一条属于本仓的
学生场景主线**，却都会新增用户要理解的东西。

⇒ 本包只取「capture → attach」这一段，其余全部拒绝。代价：需自建薄兼容层
（今天页 / 课堂页的两个按钮），**不是**开箱即用。

## TODO（接入前必须完成，按顺序）

- [ ] **T0 版本守卫**：实现 `checkHostCompat()`，比对宿主实际 `cordis` / `schemastery` 版本与 `UPSTREAM_PINS`。
- [ ] **T1 面审计**：`auditFaces()` 改为读上游 `exports` 实际装载面，证明 `preset-computer-use` 与 `./client` 未被拉起。
- [ ] **T2 权限**：走宿主 `dsh-user-approval`，**不自建开关**。截图是敏感动作，需逐次确认。
- [ ] **T3 今天页**：「问一问」输入框中继 `onCapture` → 附件 id 进会话（不改 `dsh-zhiyun-page-today` 会话构造）。
- [ ] **T4 课堂页**：讲义工具栏「补一张板书」→ 挂当前讲义节点（不改 `dsh-zhiyun-source-classroom` 解析链）。
- [ ] **T5 平台判定**：上游 `host` / `helper` 为桌面侧实现；**网页部署形态下本包应整体不生效**（`platform` 判据必须先定）。

## 与在册条目的取舍

registry 已登记 4 条截屏/computer-use 类条目，**本包与它们均不重复**：

| 在册条目 | 判 🟢/🔵/⛔ 的原因 | 与本包的区别 |
| --- | --- | --- |
| `HaoyanZhang123/dsh-plugin-control-your-capture`（r107，🔵） | 本仓无截图面板，判据①不成立 | 本包把入口挂在**今天页/课堂页**上，不是独立面板 |
| `988hj7tczd-oss/dsh-computer-use`、`ZRui-C/dsh-computer-use`（🔵） | 宿主已有 GUI 自动化 | 本包**不做 GUI 操作**，只做「取一帧」 |
| `TaurusWood/dsh-plugin-appshot`（⛔） | 工具模板、18.9 MB 截图产物 | 本包零产物入库 |

## 风险（评审请先看）

- **桌面依赖**：上游核心在 `host`/`helper`（原生侧）。Web 形态下**本包可能整体不可用** —— T5 未定之前不要排期。
- **写死版本**：`cordis@4.0.4` / `schemastery@3.18.4` 写死，与本仓宿主差一个 minor 就可能不兼容。
- **上游是 monorepo**：npm 上只发了 `dsh-orb` 这一个聚合包，其余子包**未单独发布** ⇒ 无法只锁 `./host` 那一个面。

## 许可与归属

- 上游：`mini-yifan/dsh-orb-cordis`，**MIT**。
- 本包**不含任何上游源码**，仅依赖声明 + 占位实现；接入时按 MIT 保留版权声明（见 `ATTRIBUTION.md`）。
