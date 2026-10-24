# dsh-radar-plugin-graph

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本包由「生态雷达」自动生成，**没有**被 `profiles/zhiyun-bench/package.json` 引用，
> 也没有通过任何人工评审。评审结论出来之前，**不得**把它加进 `dsh.profile.bundles`。

## 这是什么

给现有「插件」页（`dsh-zhiyun-page-plugins`）的模块图**多算一层**：跨文件循环依赖、
`dsh-zhiyun-*` 之外的边、以及「声明了 `inject` 但没有任何包提供该服务」的空边。
算这一层的是上游 **skott**（★877，MIT，2026-09-11 push），本包只做接线，不改上游源码。

## 集成方式：**强化式集成**（不是全新）

| 判据 | 是否成立 | 说明 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 仍是「插件」页的模块图，不新增页面、不新增 tab |
| ② 功能仍相似正交 | ✅ | 新增「循环依赖 / 空边 / 跨包文件级边」，与原「谁依赖谁 / 层序违规」同域但不同问题 |
| ③ 底层多调了更优质实现 | ✅（待验证） | 循环依赖检测与文件级图构建交给 skott 的静态分析，而不是自己再写一遍 DFS |

**与现有功能的关系：重复且可强化。** 本仓现有 `packages/dsh-zhiyun-page-plugins/src/runtime.js`
已经能把「模块边 + Cordis 硬边」折成一张包级图，`layerViolations` 也在算；但它**答不出**三件事：

1. 两个包之间存在**文件级**循环依赖（运行时图不区分文件）；
2. 有源码依赖但**本次没被加载**的边（运行时图只含已加载的包）；
3. `inject` 声明了、却没有任何包提供该服务的**空边**（`ctx.reflect.store` 里查不到提供者时只是 pending）。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/antoine-coulon/skott> |
| 作者 | Antoine Coulon |
| 许可证 | **MIT** ✅（在宽松白名单内） |
| 版本（锁死） | `skott@0.35.12`（`package.json` 写精确版本，上游 0.x 不得用 `^`） |
| 技术栈 | TypeScript / ESM（`"type": "module"`，与宿主一致） |
| 维护活跃度 | ★877，2026-09-11 push，2022 年建仓 |

> 依赖较重：`@parcel/watcher`（原生）、`typescript`、`effect`、`fp-ts`、`depcheck`、`polka`…
> 因此**只允许在宿主侧引入**。浏览器半边引入会把原生 watcher 打进 webpack 产物。

## 接线位置

```text
skott.buildModuleGraph({ entrypoints: packages/*/src/{index,host,client}.js* })
        │  （宿主侧，src/index.js 的 apply 里）
        ▼
/api/radar-plugin-graph  →  { nodes, edges, cycles, unresolved }
        │
        ▼
dsh-zhiyun-page-plugins/src/runtime.js   ← 与现有 layerViolations 合并（不替换）
        │
        ▼
Panel.jsx 的模块图（同一张图，多一层高亮）
```

## 评审必须先回答的问题

见 `src/index.js` 末尾的 5 条 TODO。其中**第 1 条是死结**：runtime 图是运行时/包级，
skott 图是文件系统/文件级 —— 粒度不同。评审先裁定「补盲区」还是「只跑算法」，
**不要两条都做**。

## 许可与归属

- 本包代码为本仓原创（占位）；上游 skott 以 MIT 许可分发，本包**不包含**其任何源码。
- 若将来需要摘取上游片段，按 `docs/contributing/CONTRIBUTING.md` 3.3 记入 `ATTRIBUTION.md`。

## 状态

| 项 | 值 |
| --- | --- |
| 雷达轮次 | 2026-10-18 · A 组（第 25 轮） |
| 分级 | 🟢 可直接集成（**但** §TODO 1 未裁定前不得实施） |
| Owner | `shared` |
| 接入 profile | **否**（禁止） |
