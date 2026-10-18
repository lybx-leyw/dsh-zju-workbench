# dsh-radar-mycoursereviews —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成方式：**强化式集成**

**不是「全新」**，也**不是**简单的「重复即接入」。按 skill 的「强化式集成」三条判定：

| 条件 | 本候选 | 结论 |
| --- | --- | --- |
| ① **仍是同一个面板** | 都是"学生产出结构化意见"的社区面板，形态同类 | ✅ |
| ② **功能仍相似正交** | 本仓 `page-feedback` = **工作台诉求板**（issue 形态：提需求 + 评论 + 状态推进）；上游 = **课程维度的众包评价库**（评分 + 课程标签 + 检索）。**两者服务于不同对象**，不重复 | ✅ |
| ③ **底层多调了更优质实现** | 上游有完整**课程评价数据模型**（课程实体 / 多维评分 / 标签体系 / 检索），本仓 `page-feedback` **只有条目+评论，无评分与课程索引** | ✅ |

> **结论**：符合「强化式集成」，**不是**skill 明令禁止的"重复且无增益"。

### ⚠ 但这不是 iframe 挂载，也不是锁版引入

上游**不是 DSH 插件包**（无 `dsh.bundle.patch`、无 `dsh.client`、未发布 npm），
且其**数据与课程目录属于阿德莱德大学（University of Adelaide）**：

```text
❌ 不得 iframe 挂载   —— 挂上去就是阿德莱德的课程目录，与本仓用户无关
❌ 不得搬运课程数据   —— 数据版权不属于 MIT 授权范围（MIT 只覆盖代码）
✅ 只借鉴数据模型 + 交互设计，课程数据接浙大自己的来源
```

因此本包形态是 **(a) 能力提取 + 自建**，**`package.json` 不引入上游 DSH 依赖**
（这是 B 类的正确形态；A 类的「锁版挂载」在此不适用）。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [compsci-adl/mycoursereviews](https://github.com/compsci-adl/mycoursereviews) |
| 许可证 | **MIT** ✅（已核 `/repos/.../license` 端点：`spdx_id=MIT`，`path=LICENSE`） |
| 作者 | compsci-adl（Adelaide University Computer Science & AI Discipline League） |
| Stars / Forks | ★2 / **forks=6**（fork 数 > star，典型"校内平台被广泛复刻"） |
| 语言 | TypeScript |
| 技术栈 | Next.js + Drizzle ORM + PostgreSQL + Keycloak(SSO) + Tailwind + Playwright |
| 最后推送 | 2026-10-12（**活跃**） |
| 仓库结构 | `src/`（Next.js app）/ `Dockerfile` + `docker-compose.yml` + `dev.Dockerfile` / `drizzle.config.ts` / `realm-export.json`(Keycloak) / `tests/`(Playwright) / `pnpm-workspace.yaml` |
| upstream 挂载形状 | **无** —— 非 DSH 插件包，**不适用锁版挂载** |

---

## 本包要增强哪个现有功能

**目标面板**：`dsh-zhiyun-page-feedback`（「反馈」页）

**缺口**：现有反馈页是 issue 形态的诉求板，**没有"课程"这个维度** ——
学生无法对**某一门课**给出可聚合的结构化评价（评分 / 标签 / "给学弟学妹的建议"）。

**本包要做的事**（评审通过后才实现）：

```text
在反馈页内新增「课程评价」子视图：
  - 课程实体（复用本仓课程页的课程数据源，不新建课程目录）
  - 多维评分（如 给分 / 作业量 / 讲课质量）
  - 标签体系（如 水课 / 硬核 / 点名 / 给分高）
  - 按课程检索 / 按标签筛选
不改变现有「诉求板」的任何行为 —— 是**并列子视图**，不是替换。
```

---

## 评审要点（请人工逐条裁定）

1. **是否值得**：本仓是否真需要"课程维度评价"，还是反馈页已够用？（**最关键的否定项**）
2. **数据来源**：课程目录接哪里？**绝不可**用上游阿德莱德的课程数据。
3. **边界冲突**：新增子视图后，与 `page-feedback` 的诉求板会不会出现**两个评价入口打架**？
4. **署名与隐私**：上游用 Keycloak 实名 SSO；本仓反馈页用**本机随机笔名**（不指向真人）。
   课程评价**是否应保持匿名**？（涉及评价真实性 vs. 责任可追溯的权衡，须人工定调）
5. **数据托管**：反馈页数据在**魔搭 Studio 收件服务**上，重启可能丢数据。
   课程评价是**累积型**数据（越多越有价值），**丢数据的代价远高于诉求板** ——
   上「课程评价」前须先解决持久化。

---

## 目录

```text
packages/dsh-radar-mycoursereviews/
├── package.json      # B 类：不引入上游 DSH 依赖（上游非 DSH 包）
├── cordis.patch.yml  # - insert: [{ id: radar-mycoursereviews, name: dsh-radar-mycoursereviews }]
├── src/index.js      # 占位 + TODO（说明适配点，不含业务逻辑）
├── README.md         # 本文件
├── ATTRIBUTION.md    # 借鉴声明（按 CONTRIBUTING 3.3）
└── OWNERS            # Owner: shared
```

> **未接入**：本包**不在** `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles` 中，
> 且**不得**被自动接入。接入须经人工评审 + 单独 PR。
