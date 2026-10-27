# dsh-radar-kb-rag —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 与 `src/upstream.js` 的两个函数
> **都直接抛错**，本包**不 import 上游**，也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

锁版引入 `dsh-kb-rag@1.6.8`，把**跨文献混合检索（BM25 + 本地向量）带出处**接进
论文阅读页**已有的问答抽屉** —— 强化现有的 `search_paper`（只做单篇内的页级定位），
**不是**再造一个搜索框。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 回答落在**已有**的 `packages/dsh-zhiyun-page-paper/src/AssistantDrawer.jsx`；不新建页面、不新增侧栏 |
| 功能仍相似正交 | ✅ | 现有 `search_paper` = 单篇 PDF 内定位；`kb_rag` = 跨语料检索 + 章节/页码/DOI。同一件事的两个粒度 |
| 底层多调了更优质实现 | ✅ | 现有 = 上游子串匹配 + 可选一次重排；接入后 = BM25(CJK) + 本地 bge-small 向量混合召回 + 本地 rerank + 出处字段，正文不出本机 |

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [Breeze136/dsh-kb-rag](https://github.com/Breeze136/dsh-kb-rag) |
| npm | **`dsh-kb-rag@1.6.8`**（2026-10-21T05:28Z 发布，`dist-tags.latest = 1.6.8`，共 23 个版本，本轮实查） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id`、npm `versions['1.6.8'].license`、包内 `LICENSE` 三处一致） |
| 作者 | Breeze136 |
| Stars | ★15（建仓 2026-08-16，push 2026-10-22，仍活跃） |
| 语言 | **JavaScript（宿主）+ Python（引擎）** |
| npm `dependencies` | **空** |
| 体积 | `unpackedSize` **678,877 B**（≈663 KB，含 `kb_engine.py`） |
| 原生 DSH 形态 | ✅ 包内自带 `cordis.patch.yml`，`dsh.bundle.patch` 指向它；`dsh.client.inject` 声明了 `dsh-client-ui-conversation` / `-primitives` |
| 注册点 | **只注册 model tool + command**：`ctx.tools.register` / `ctx.effect` / 可选 `commands`。**无页面、无 sidebar、无 slot** → 注入面限于本包 `ctx` |
| 首次发现 | 2026-10-23（C 组派生 ·「文献库近邻检索 / 混合检索底座」轴，r57） |

### 上游工具（10 个）

`kb_ingest` / `kb_search` / `kb_rag` / `kb_zotero` / `kb_dedup` / `kb_clear` /
`kb_fetch` / `kb_scope` / `kb_stats` / `kb_status`

### 上游引擎

`kb_engine.py`（**随包分发的 Python 脚本，不在 npm 依赖图里**）：
`sqlite3` 单库 + **内存 BM25（CJK 友好分词）+ 本地 `bge-small` 向量**混合召回，
可选本地 rerank；向量与重排都在本机跑。

---

## 三个阻塞项（评审必须先拍板，代码写不了）

| # | 问题 | 为什么必须评审先答 |
| --- | --- | --- |
| **TODO-0** | 宿主 profile 里有没有 `subprocess` 服务？ | 上游 `inject = ["tools","timer","subprocess"]`，缺了会 **`console.error` 后静默 `return`** —— 工作台照常启动、论文页照常打开，**只是那 10 个工具都不存在**。这是「不响的失败」 |
| **TODO-1** | Python 运行时从哪来？ | 引擎是 `spawn` 出去的 `.py`，首次可能还要下 `bge-small`。用户端是 Electron 壳，Python 不一定在 PATH 上 → 「装得上」≠「跑得起来」 |
| **TODO-2** | `kb.sqlite` 与 `.kb-rag/state.json` 落在哪？ | 上游默认写 `<workspace>/.kb-rag/`，会出现在用户的笔记目录里；与「笔记库只有 `.md`」的既有约定冲突 |

其余 TODO（3–5）见 `src/index.js` 文件头注释：挂载形态、挂载后自检、工具子集。

---

## 本骨架**不做**什么

- **不修改上游任何源码**（上游的 `cordis.patch.yml` 原样保留、不编辑）。
- **不消费上游的 `./client`**：论文页已有一套文献库 UI，再来一套就是「一个面板两个入口」。
- **不改 `profiles/zhiyun-bench/package.json`**。
- 不写任何检索逻辑（`apply()` 直接抛错）。

---

## 已知未做（不要让本文看起来像"已经能用"）

- 引擎**未实跑**，检索质量（中文召回、图表定位准确率）**未测**。
- `dsh-kb-rag-install --dry-run` **未执行**（它会改 profile），宿主是否有 `subprocess` **未确认**。
- 首次索引耗时、模型体积增量、gzip 后首屏增量**均未实测**。

## 相关登记

- 生态登记表：`docs/ecosystem-radar/registry.md` · 2026-10-23 第五十七轮
- 本轮报告：`docs/ecosystem-radar/2026-10-23-r57.md`
- 同域但不建议同时接：`Vncntvx/dsh-zotero`（★46，**面板**，已在册 🟡）
