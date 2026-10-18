# dsh-radar-lookatstudy —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [Kaiji-Z/dsh-plugin-lookatstudy](https://github.com/Kaiji-Z/dsh-plugin-lookatstudy) |
| npm | `dsh-plugin-lookatstudy@0.26.3` **已核实可锁版挂载** ✅ |
| 许可证 | **MIT** ✅（宽松白名单内，允许锁版引入） |
| 作者 | Kaiji-Z |
| Stars | ★19 |
| 最近推送 | 2026-10-06 |
| 语言 | TypeScript |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client`（npm registry 已核实） |
| 上游运行时依赖 | **无**（`dependencies` 为空 —— 零传递污染） |
| 上游 peerDependencies | `@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`、`react >= 18`、`react-dom >= 18` |
| 上游 engines | `node >= 22.19` ⚠ 须核查本仓环境 |

## 类型与集成判定

- **类型**：**A · 原生 DSH 插件包**（带 `dsh.bundle.patch` + `dsh.client`，最高优先）
- **集成方式**：**强化式集成** —— 锁版挂载 + 外围承载，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ 「学习 / 习题」页，不新增页面、不改导航 |
| 功能仍相似正交 | ✅ 同属「让用户学会某块知识」这条动作链；本仓**缺的是掌握度模型**，上游补的正是这一段 |
| 底层多调了更优质实现 | ✅ **BKT 知识追踪** + **门控技能树**，均为本仓现有「做对/做错」二值记录所没有 |

## 增强哪个现有功能

`packages/dsh-zhiyun-quiz`（出题与质检）、`packages/dsh-zhiyun-study-core`（学习核心）
与「学习 / 习题」页的**推进逻辑**。

| 本仓现状 | 上游补上的 | 结果 |
| --- | --- | --- |
| `dsh-zhiyun-quiz`：**出题器**（零 UI、零落盘） | 技能树门控 | 「会出题」升级为「**按掌握度决定下一个该学什么**」 |
| 无任何掌握度建模 | **BKT** 贝叶斯知识追踪 | 从「答对/答错」二值记录，升级为**知识点级掌握概率** |
| 无学习路径形态 | gated skill tree | 从平铺题目列表，升级为**有前置依赖的学习路径** |

## 接入边界（重要）

1. **这是骨架，不是实现。** `src/index.js` 的 `apply()` 刻意留空。
2. **不改上游源码。** 只锁版引入，由本包 `cordis.patch.yml` 挂载。
3. ⚠ **首要待决：SM-2 排程与本仓 FSRS 骨架冲突。**

   上游自带 **SM-2** 复习排程；本仓已有 `packages/dsh-radar-fsrs-scheduler`
   （锁版 `ts-fsrs@5.4.2`，同样是候选骨架，未评审）。
   **二者只能留一个** —— 这正是 `tyfforu/dsh-flashcard` 被判 ⛔ 的同一理由。

   但本候选**与 flashcard 有本质区别**：flashcard 的全部价值就是 SM-2，
   而本候选的独有价值是 **BKT 掌握度 + 门控技能树**（与 FSRS 正交、可叠加）。
   因此**建议方向**（须人工拍板，非本骨架结论）：

   > **取 BKT 与技能树，关掉上游 SM-2，排程仍归 `fsrs-scheduler`。**
   > 若评审认为「剥不掉上游 SM-2」，则本骨架与 `fsrs-scheduler` **二选一**，
   > 倾向保留 `fsrs-scheduler`（FSRS 优于 SM-2），本骨架删除。

4. **不接入 profile。** 绝不写入 `profiles/zhiyun-bench/package.json`。
5. **注入点须核对。** 上游声明 `dsh.client.inject = ['slots','workspaces','sessions','locale']`，
   其中 `slots` 是本仓多个 `dsh-zhiyun-page-*` 共用的挂载点，**须逐一确认不争抢**。
6. **学生数据边界。** 掌握度属学情数据，落盘须遵守本仓「账号 + 课程 + 节次」
   的隔离约定，**不得新建平行业务落盘通道**。

## 下一步

见 `src/index.js` 头部的 `TODO` 清单。**第 1 条（SM-2 / BKT 划界）未拍板前，
不得推进任何实现。**

---

## 归属

- 本包由 `dsh-ecosystem-radar` 自动生成，`Owner: shared`（见 `OWNERS`）。
- 上游代码版权归原仓库作者所有，见上方「上游」表。
- 本包**未搬运上游源码**，仅声明锁版依赖。
