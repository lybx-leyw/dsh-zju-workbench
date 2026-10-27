# dsh-radar-zotero-bridge —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实；
> `package.json` 的依赖指向 `@local/dsh-zotero: 1.0.1`，而上游**从未发布到 npm**，
> 所以 `npm install` 会直接失败 —— 这是**已知且故意保留**的缺陷，标记待决点。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成形态：**强化式集成**（不是「全新」）

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | **需改造** | 上游自带侧栏入口（`sidebar.panellist` + `slots.register`），是**第二套布局主张**；要做到「同一个面板」，必须放弃它的客户端、只借它的 `/zotero/*` 路由，由 `dsh-zhiyun-page-paper` 的 `ReaderFrame` 渲染 |
| ② 功能仍相似正交 | ✅ | 本仓 `page-paper` 的文献库来自上游 paper-reader 自建；全仓 **grep `zotero` 零命中** —— Zotero 本地库与「原生高亮 / 子笔记写回」是完全缺失的来源 |
| ③ 底层多调了更优质实现 | ✅ | 批注写进 Zotero 自己的库（本地 API），而不是再自建一份批注存储 |

②③ 成立、① 需改造 —— 这正是「强化」而非「新建」的形态，也是本骨架的核心待决项。

## 上游

- 仓库：[`nftuoa/dsh-zotero`](https://github.com/nftuoa/dsh-zotero)
- 锁版产物：`dsh-zotero-1.0.1.tgz`（GitHub Release `v1.0.1`，2026-10-23T12:52Z，4.26 MB）
- 许可证：**MIT** ✅（`LICENSE` 首行 `MIT License / Copyright (c) 2026 nftuoa`）
- 形态：原生 DSH 插件包，`package.json` 带 `dsh.bundle.patch`，`cordis.patch.yml` 为
  `- insert: [{ id: zotero, name: '@local/dsh-zotero' }]`

### 它是什么

Zotero 桌面库的 DSH 面板：分类树、条目列表、同源 PDF.js 阅读器、每篇论文独立的
会话抽屉（锁定 `uiConversation` 的 ChatSnapshot 渲染转录）、Zotero 原生高亮/子笔记
的读取与写回，外加两个 model tool（`zotero_search` / `zotero_paper`）。

### 结构上的两个意外

1. **没有任何 DSH 依赖**。`dependencies` / `peerDependencies` 均为空，`lib/` 下
   `@deepseek-ai/*` 零命中 —— 它靠的是运行期 ctx 契约（`inject: ['webServer']`
   + 同源 `/zotero/*` + 客户端 `slots`）。
   → 所以「锁版引入上游 DSH 包」这条路**不适用**，能锁的只有它自己。
2. **自带 `vendor/`**：pdf.js + KaTeX + 字体，共 3.7 MB。这意味着它不能以
   「外部依赖」的身份被引用，只能整包引入 —— 与本仓 iframe 路线的
   `tests/build-seeds.test.mjs` 守卫（产出不得含本包 `src/` 之外的文件）**不冲突**
   （运行时请求，不是打包产物），但**许可证要单独过一遍**。

### `vendor/` 许可证逐项核实

| 文件 | 许可证 | 判定 |
| --- | --- | --- |
| `vendor/katex/LICENSE` | MIT | ✅ |
| `vendor/pdfjs/LICENSE` | Apache-2.0 | ✅ |
| `vendor/pdfjs/cmaps/LICENSE` | BSD-3-Clause（Adobe） | ✅ |
| `vendor/pdfjs/iccs/LICENSE` | BSD-3-Clause（ICC） | ✅ |
| `vendor/pdfjs/wasm/LICENSE_OPENJPEG` | BSD-2-Clause | ✅ |
| `vendor/pdfjs/wasm/LICENSE_QCMS` | MIT（Mozilla） | ✅ |
| `vendor/pdfjs/standard_fonts/LICENSE_FOXIT` | BSD-3-Clause | ✅ |
| `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` | **GPL-2.0 + 字体例外条款** | ⛔ **一票否决** |

字体是**渲染资源**、不是被改编的代码（pdf.js 官方发行版就已这样分发），但本仓对
嵌套许可证一贯按一票否决处理（r55 / r85 先例）。评审须先在三者中选定一个：

- **剔除** `standard_fonts`（最省事；代价是少数 PDF 的嵌入字体回退）；
- 只留非 GPL 的字体子集；
- 明确接受字体例外条款并写进 ATTRIBUTION。

**在该决定落地之前，不得把 `vendor/` 搬进本仓，也不得摘取其中任何代码。**

## 宿主窗口

上游自述在 **dsh 0.2.1-rc.2** 上验证，且依赖 `uiConversation` / ChatSnapshot 两个
**客户端导出**。若按 ② 的形态「只借路由」，这两条依赖消失，约束退化为
「`webServer.register` 还在不在」—— 显著放宽。
`TODO(评审)`: 用 `scripts/radar-host-window.mjs` 对 0.2.1-rc.2 跑一次并回填。

## `insert id` 冲突

上游 patch 用 `id: zotero`，本包用 `id: radar-zotero-bridge`。两者**不能同时启用**
（同一 cordis 槽位互抢，与 r83 的 `plugin-manager` 同类），启用本包即视为替换上游。

## 待决清单

- [ ] 依赖解析：改为 tarball / `github:nftuoa/dsh-zotero#v1.0.1`（当前写法装不上）
- [ ] `vendor/` 的 GPL 字体：剔除 / 子集 / 接受（三选一）
- [ ] 面板归属：改 `page-paper` 的 `library.js` + `ReaderFrame.jsx`（属本仓，不属 radar 包）
- [ ] 宿主窗口：对 0.2.1-rc.2 实跑并回填
- [ ] 评审通过后再补测试（本骨架按规则**不含任何测试文件**）
