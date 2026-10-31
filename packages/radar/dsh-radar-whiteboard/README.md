# dsh-radar-whiteboard —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-10-31 · r118 · 能力域轴** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有路由、没有存储。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**本仓的「笔记」与「论文」只有文字一种表达。** 公式推导、架构草图、算法流程写在 Markdown 里会变形，
贴图又不可编辑、不可 diff。本包锁版引入上游白板（`.drawio`），**在原有面板里**补一层可编辑画布。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/zhang-guo-wen/dsh-whiteboard |
| npm | `@guowenzhang/dsh-whiteboard`（**锁版 `0.4.0`**，不用 `^`） |
| 编辑器依赖 | `@guowenzhang/dsh-drawioedit`（**锁版 `1.2.1`**，上游 `peerDependencies` 要求，必须同轮挂载） |
| 许可证 | **Apache-2.0** ✅（`npm view … license` = `Apache-2.0`；包内 `LICENSE` + `NOTICE` 齐全） |
| 形态 | `lib/index.mjs`（宿主）+ `lib/client.js`（客户端）；`dsh.bundle.patch → ./cordis.patch.yml` |
| engines | `node ^22.19.0 \|\| >=24.0.0`；`dsh >=0.2.0-rc.1` |

## 集成判定

- **类型**：**A · 原生 DSH 插件包**（`package.json` 实测含 `dsh.bundle.patch: ./cordis.patch.yml` 与 `dsh.client.inject`）
- **关系**：**强化式集成**（不是「全新」）
  - ① **仍是同一个面板** —— 笔记页仍是笔记页、论文页仍是论文页；**不新增左侧「Whiteboards」导航**；
  - ② **功能仍相似正交** —— 还是"在笔记/论文旁边记下想法"，只是从"只能写字"扩展到"能画"；
  - ③ **底层多调了更优质实现** —— 画布编辑、`.drawio` 读写、导出这些底层能力由上游提供，本仓不自造。

  > 三条缺一即降级为「重复且无增益」。若评审决定把白板做成**独立页面**，则第 ① 条不成立，**应直接驳回本骨架**。

## 不接半边（关键）

上游 `dsh.client.inject` 含 `dsh-client-ui-layout` / `-sidebar` / `-sidebar-right` / `-workspace`，
并导出 `./client` —— 它会**自建左侧导航与整块 workspace 视图**。
⇒ 本包**不引入 `./client`**；UI 由 `dsh-zhiyun-core-notes` / `dsh-zhiyun-page-paper` 以
**iframe 承载 + 主题注入 + 接管控件**三件套实现（效法 `packages/dsh-zhiyun-paper`）。

## 待人工评审的开放问题

1. **存储边界**：上游把画板存在**插件自己的 `files/` 目录**（其 README「Notes」明写），不在 workspace。
   好处是不抢 `dsh-zhiyun-core-notes` 的 store 键；代价是"笔记 ↔ 画板"的对应关系要靠本包旁挂索引，
   **索引格式须先定死**（建议 `.board-index.json`，键为 `sectionId`/`docId`）。
2. **导航抑制**：只挂宿主半边时，上游客户端不会注册导航 —— 但需实测其 `apply()` 是否会无条件 `insert` UI 槽位。
3. **升级策略**：上游 0.4.0 → 后续版本若改 `files/` 布局，需迁移脚本；骨架期不写。
4. **与 `amumulam/dsh-tldraw-canvas` 的关系**：registry 已登记该条目（同一"右栏画布"域，★0）。
   若评审倾向 tldraw（更适合随手草图），则本包与之一替一，**不要都接**。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 锁版依赖 + `dsh.bundle.patch` |
| `cordis.patch.yml` | `insert: [{ id: radar-whiteboard }]`（id 与上游 `whiteboard` 错开） |
| `src/index.js` | 插件入口占位 + TODO + 意图说明 |
| `src/upstream.js` | 上游封装占位（`loadUpstream()` / `checkHostCompat()`） |
| `OWNERS` | `Owner: shared` |

## 明确不做

- 不写测试（radar 包规则）；
- 不写 profile（`profiles/zhiyun-bench/package.json` 不得出现 `dsh-radar-*`）；
- 不复制上游源码；
- 不改 `build.mjs` / `profile.mjs` / `check-css-order.mjs`。
