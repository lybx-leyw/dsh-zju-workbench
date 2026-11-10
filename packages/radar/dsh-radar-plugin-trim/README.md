# dsh-radar-plugin-trim —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-10 · **r169** 轮），**仅用于人工评审**。
> `src/index.js` 的 `apply()` **只打一行日志**，不注册任何服务、不改任何行为；
> `src/upstream.js` 的 `loadUpstream()` **恒返回 `{ ok: false }`**。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

**同一张插件表、同一个「要不要留它」的问题，多算两列账：它吃多少上下文、它和谁打架。**
外加一次**显式**的应用与一键回滚 —— 不是自动裁剪。

## 集成类型：**强化式集成**（不是「全新」）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化** |
| 强化哪个现有功能 | 「插件」页（`packages/client/page-plugins`）的插件清单与画像 |
| 上游 | [`Starlit-Sky-code/dsh-experience-optimizer`](https://github.com/Starlit-Sky-code/dsh-experience-optimizer) · npm `dsh-plugin-trim@0.2.2` |
| 许可证 | **MIT** ✅（GitHub `spdx_id` + 仓库 `LICENSE` + README badge） |
| 类型 | **A · 原生 DSH 插件包**（monorepo `packages/plugin-trim`，自带 Web 控制台） |
| Stars | ★0（2026-11 新建；README 有完整设计文档与 UI 预览，非空壳） |

### 三条判据

| # | 判据 | 是否成立 | 依据 |
| --- | --- | --- | --- |
| ① | **仍是同一个面板** | ⚠ **有前置条件** | 不新增导航项。上游自带「设置 → 插件 → 体验优化」页签，**只允许它出现在本仓「插件」页内**。若上游会自动注册独立导航页 ⇒ 判据①不成立 ⇒ **方案作废**（退到「只取计算模块」，见 TODO-1/TODO-2） |
| ② | **功能仍相似正交** | ✅ | 同一批插件、同一个「留/走」决策；正交的只是**成本**与**冲突**两维 |
| ③ | **底层多调了更优质实现** | ✅ | 本仓已有五个插件画像骨架全是**静态**画像（权限/能力/依赖/评分/账本），没有一个回答「它吃多少上下文、和谁冲突」 |

## 为什么不是「全新」

本仓「插件」页已经在回答「装了哪些插件、它们什么关系、它们能碰到什么」。
`plugin-trim` 回答的是同一组插件的**另一个侧面**，不是新的一页。
如果评审认为「成本估算」属于新功能，那么它同时也就落在「与 `context-dashboard` 重复」里 ——
所以本包的定位**必须**是「给现有插件表加两列」，这一点写死在这里，实现时不得偏离。

## 为什么只要 `-trim`，不要 `-recipe`

上游同仓还发布 `dsh-plugin-recipe`（把业务目标翻译成可校验的工作流蓝图）。
本仓 `dsh-radar-plan-solver` 与「规划」页已有一套计划表达，再接一套 blueprint
会形成**两套并存的计划语**，风险高于收益。`-recipe` 已在 `registry.md` 记为 🔵，留人工决定。

## 集成方式：锁版挂载 + 外围兼容层

- `package.json`：`dependencies` **写死** `"dsh-plugin-trim": "0.2.2"`（**不用 `^`**）；`dsh.bundle.patch` 指向本包 patch。
- `cordis.patch.yml`：用**本仓 id** `radar-plugin-trim` 插入本包名 `dsh-radar-plugin-trim`；
  **不使用**上游那份 patch（上游 id 为 `plugin-trim`，绕过 `dsh-radar-` 前缀的污染防护）。
- `src/upstream.js`：上游坐标单一真源 + 只允许的两个导出路径 + 版本契约（当前 fail-closed）。
- `src/index.js`：`apply()` 仅打日志；TODO 0–7 写清适配点。
- **不搬运上游源码**，**不改上游一行代码**。

## 挂载前必须回答的问题（评审重点）

0. **版本真值（阻塞）**：npm 上是否真有 `0.2.2`？README 主推的是 GitHub Release `.tgz`。
   没有就得把 `dependencies` 换成 tarball URL —— 否则 `pnpm i` 直接失败。
1. **面板位置**：上游会不会自动挂导航页？会 ⇒ 判据① 不成立。
2. **成本口径统一**：上游的 token 估算与 `dsh-radar-context-dashboard` 的口径必须对齐。
   两套数打架比不说更糟。
3. **与五个画像骨架的边界**：只**追加**两列、并**消费**它们的输出；自建完整插件清单 UI ⇒ 驳回。
4. **「应用/回滚」的落点**：上游改的是 profile bundles。**radar 包不写 profile** 是本仓硬规则，
   所以该动作只能由用户在插件页主动点击触发，绝不能是启动时的自动行为。
5. **冲突误报率**：先拿真实插件清单跑一遍上游的 compatibility 规则。

## 不做什么

- 不写入 `profiles/zju-workbench/package.json` 的 `dsh.profile.bundles`。
- 不自动裁剪、不自动关闭任何插件。
- 不新增导航项。
- 不引入测试文件（本仓 radar 包无测试；测试责任在评审通过后的实现方）。
- 不复制上游源码。

## 上游许可

MIT。本包仅 `import` 上游公开导出，不复制其源码；若后续有等价借鉴，
按 `CONTRIBUTING.md` 3.3 记入 `ATTRIBUTION.md`（本轮**无**借鉴，故无 ATTRIBUTION.md）。
