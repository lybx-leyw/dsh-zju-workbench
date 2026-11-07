# dsh-radar-diff-approval —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-30 · r111 轮），**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 与 `src/upstream.js` 的 `loadUpstream()`
> 都直接抛错，TODO 一条都没落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质

**「强化式集成」（重复且可强化）—— 但取决于一个待评审的前提。**

本仓 `dsh-zhiyun-paper` / `dsh-zhiyun-page-paper` 的写入是**整稿替换**：
用户只看到「内容变了」，看不到「哪一句被改了、哪一段被删了」，也没法只保留其中一段。
上游给的是**同一件事的更优底层**——逐块 diff + 分块 Keep/Revert + undo/redo。

强化式集成三条判据：

| # | 判据 | 是否成立 | 依据 |
| --- | --- | --- | --- |
| ① | **仍是同一个面板** | ✅（有条件） | 评审对象是论文编辑区 / 页面预览区旁**原有的确认动作**，不新增「审批中心」入口。前提是接入时把上游的待审队列**嵌回原面板**，而不是让它另开一个侧栏 |
| ② | **功能仍相似正交** | ✅ | 旧实现与上游答的是同一个问题：「Agent 改的这段要不要接受」 |
| ③ | **底层多调了更优质实现** | ✅ | 本仓是整稿 diff，上游是**逐块** diff + shiki 高亮 + undo/redo 栈 |

> **⚠ 唯一的前提**：本仓论文/页面的写入路径是否**真的**经过「待审变更」这一层。
> 若它目前是「Agent 直接写盘」，那么接入后得到的是**全新的编辑审批能力**，不是强化。
> 这个判断留给评审，本骨架**不预设结论**。
> 若评审判为「全新」，仍然可用，但必须在 README 与 registry 里把关系改标为「全新」。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [9087/dsh-diff-approval](https://github.com/9087/dsh-diff-approval) |
| npm | **`dsh-diff-approval@0.36.1`**（`dist-tags.latest`，2026-10-19 发布） |
| 许可证 | **MIT** ✅（GitHub `spdx_id` 与 npm `license` 两处一致） |
| 作者 | 9087 |
| Stars | ★15（建仓 2026-08-16，`pushed_at` 2026-10-28，**仍在维护**） |
| 语言 | TypeScript（npm 打包预构建，含 `build/`） |
| 运行时依赖 | 6 个：`diff@^9` / `shiki@^4.4.3` / `@shikijs/langs@^4.4.3` / `marked@^18` / `dompurify@^3.4.15` / `@deepseek-ai/dsh-home-paths@^0.1.0-rc.5` |
| peer | `react@^18.2.0`、`@deepseek-ai/cordis@>=4.0.1` |
| 体积 | tarball 解包 ≈ **20.06 MB**（`unpackedSize = 20056964`） |
| 挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web` —— **标准原生 DSH 插件（A 类）** |
| 上游 patch 行 | `- insert: [{ id: diff-approval, name: 'dsh-diff-approval' }]` |

### 上游做什么

> Agent 的每次文件编辑先进入**待审变更队列**；用户在整文件 diff 上逐条审批，
> 可以按文件、也可以按块 Keep 或 Revert，并支持撤销 / 重做。

- `dsh.client.inject` 声明了 `dsh-client-runtime` / `dsh-client-connection` /
  `dsh-client-locale` / `dsh-client-ui-settings` / `dsh-client-ui-sidebar`；
- 仓库自带 `e2e/` 与 `playwright.config.ts`、`.release-it.json`、`PUBLISH.md` ——
  是**有发布纪律**的插件，不是一次性的个人玩具。

---

## 学生场景

论文 / 课程报告 / 页面草稿由 Agent 改写时，「它到底改了哪一句」是最常被吐槽的点。
逐块审批让「保留这段、退回那段」变成一次点击，且**撤错了能撤回**。

---

## 与现有功能的关系

| 候选 | 现有能力 | 关系 | 判定 |
| --- | --- | --- | --- |
| 编辑审批 / 逐块 diff | 论文页、页面页的整稿替换确认 | **重复且可强化**（前提见上） | 🟢 |

## 为什么不选 `KERBALMans/dsh-modpack`（本轮同为 🟢，但未出骨架）

| 项 | `KERBALMans/dsh-modpack` | `9087/dsh-diff-approval` |
| --- | --- | --- |
| 场景 | 插件整合包导出/导入 | 编辑审批 |
| 与本仓关系 | **全新**（本仓无插件打包能力） | **重复且可强化** |
| 稳定度 | ★4，建仓 2026-10-28，**2 天** | ★15，建仓 2026-08-16，**2.5 个月** |
| npm 可锁版 | 仓库 `0.9.1`，npm 上却是 **`0.2.1`（他人 `M1r0er` 的旧仓）** → **锁不了版** | `0.36.1`，仓与 npm 一致 |
| 结论 | 只登记，待 npm 发布后再评 | **出骨架** |

> `dsh-modpack` 的 npm 包指向 `M1r0er/dsh-modpack`（同一思路的 **fork 源**），
> 版本号差 7 个 minor。**锁版会锁到另一个仓库的代码**，这是硬伤，本轮不出骨架。
> 同时也登记一条：`M1r0er/dsh-modpack`（★0，MIT，pushed 2026-10-20）。

---

## 本骨架的约束

- 只含**坐标、形态记录与 TODO**，不含任何上游源码；
- `dependencies` 里 `dsh-diff-approval` **锁死 `0.36.1`**（不用 `^`）；
- **无测试文件**、**不写 profile**、**不参与构建**（`build.mjs` / `profile.mjs` 只认 `dsh-zhiyun-` 前缀）；
- **不与上游 bundle 同时挂**（上游自带 bundle layer，双挂 = 同一个插件挂两次）。
