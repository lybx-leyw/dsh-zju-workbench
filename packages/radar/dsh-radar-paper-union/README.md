# dsh-radar-paper-union —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，本包**不 import 上游**，
> 也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

锁版引入 `dsh-ai-library@0.3.39`，**只借用它的 `lib/paper.js`**（`searchPapers()`，纯 Node、无依赖、
5 个真实可用的免 key 学术源），补上论文页检索的**第三段半径 —— 全网**。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

---

## 为什么是「强化」，不是「重复」

论文页的检索半径现在有两段，缺第三段：

| 段 | 学生怎么问 | 回答单位 | 谁在实现 |
| --- | --- | --- | --- |
| ① **单篇内** | 「这个定义在这篇第几页」 | 页 | 锁版上游 `@ggboy123/dsh-paper-reader` 的 `search_paper` |
| ② **文献库内** | 「我上传的这批里哪篇说过」 | 段落 + 出处 | r57 的 `dsh-radar-kb-rag`（骨架，未评审） |
| ③ **全网** | 「这个方向最新做到哪了 / 有没有人做过」 | **论文条目 + DOI + PDF 链接** | **缺** ← 本包 |

① ② 都要求「用户手里已经有那篇论文」，③ 恰恰是**还没有**的时候才问。三段半径互不重叠。

判据逐条：

1. **仍是同一个面板** —— 本包不注册 slot、不带 client，只在论文页已有的检索抽屉里多一个来源；
2. **功能仍相似正交** —— 半径不同，不是「搜索」的第二实现；
3. **底层多调了更优质实现** —— 本仓 `grep -rniE 'arxiv|crossref|openalex' packages/dsh-zhiyun-*/src`
   只有 1 处**注释**命中，零实现。这是从 0 到 1。

---

## ⛔ 不要整包挂（这是本包的立身之本）

上游 `package.json` 自带 `dsh.bundle.patch`，照抄它就变成：

| 挂载面 | 后果 |
| --- | --- |
| 客户端 `ctx.slots.inject('sidebar.panellist', …)`（`lib/client.js:5088`） | 侧栏多一个「资料馆」面板 = **第二个资料库**，违反「仍是同一个面板」 |
| 宿主 `/install` | 直接 `dsh plugin add` —— **从 Web 面板执行装包** |
| 宿主 `/update` | 对本地目录 `git pull` |
| `/market` / `/repo` / `/avatar` | 访问 `api.dshmk.com`、GitHub，域外 |

⇒ **只 `import('dsh-ai-library/lib/paper.js')`**。本包自己的 `cordis.patch.yml` 只 insert 本包。

---

## r92 实测到的上游缺陷（评审别再重查）

探针方式：把 `lib/paper.js` **原样** import，对真实网络打 20 次 `searchPapers()` + 17 次单端点探针。

| # | 结论 | 证据 |
| --- | --- | --- |
| a | **`auto` 只走 5 源** | `FREE_SOURCES` 10 个，`AUTO_SET = ['openalex','crossref','arxiv','doaj','europepmc']`（`paper.js:333`）；`openaire/inspire/zenodo/hal/datacite` 是死代码。3 组查询的实际 `usedSources` 从未出现第 6 个 |
| b | **arXiv 对多词查询不可靠** | 上游构造 `all:"<整句>"`。20 s 超时 → 放宽 30 s **200 但 0 条** → 去引号 **200 + 5 条**。12 个英文查询单源直打：11 成 1 超时；`spaced repetition memory` 5 次里 2 超时 / 3 空。中文 `all:"图神经网络"` **恒 0** |
| c | **`auto` 无相关性排序** | 按源轮转交错（`paper.js:388-396`）。中文查询 5 条里第 3 条是《卒中后…脑电图微状态》 |
| d | **npm 与仓库 tag 岔开** | 仓库 `0.3.54`，npm 最新 `0.3.39`（2026-10-19）。两者 `lib/paper.js` **逐字节相同**（399 行） |

实测样本（`auto`，limit=5）：

| 查询 | 耗时 | 条数 | 使用源 |
| --- | --- | --- | --- |
| `graph neural network` | 2.7 s | 5 | crossref / europepmc / openalex / arxiv / doaj |
| `图神经网络` | 1.2 s | 5 | doaj / arxiv / openalex / crossref / europepmc |
| `spaced repetition memory` | 2.0 s（含 1 次 arXiv 超时） | 5 | doaj / crossref / europepmc / arxiv / openalex |

---

## 骨架结构

```text
packages/radar/dsh-radar-paper-union/
├── package.json      # dependencies: { "dsh-ai-library": "0.3.39" }   ← 锁版，不用 ^
├── cordis.patch.yml  # 只 insert 本包
├── src/index.js      # 占位 + apply() 直接抛错 + 6 条 TODO
├── src/upstream.js   # 锁版凭据 + 三条缺陷 + 5 源真相
├── README.md         # 本文件
└── OWNERS            # Owner: shared
```

## 评审时的 TODO 顺序（先拍板，再写码）

| # | 待拍板 | 阻塞 |
| --- | --- | --- |
| **TODO-0** | 接受「5 源」，还是自己补到 10 源？（接受 ⇒ UI 文案不许写「十源」） | 是 |
| **TODO-1** | arXiv 这一源**留不留**？（中文用户下大概率是负资产：每次白等 20 s） | 是 |
| **TODO-2** | 相关性重排由谁做：LLM 小重排 / 词重叠打分 / 分组展示不排序 | 是 |
| TODO-3 | 结果落地走本仓已有「下载入库」链路，**不是**上游的 `ai-library/items/` | 否 |
| TODO-4 | 只 `import` 单文件，绝不挂上游 `dsh.bundle.patch` | 否 |
| TODO-5 | 上游 import 失败 → **不抛**，标「来源不可用」，其余照常 | 否 |
| TODO-6 | 运行时核对版本，仓库 tag `0.3.54` **不是**基准 | 否 |

评审通过后第一件事：补 `tests/paper-union.test.mjs`（锁版三处一致：声明 / 实际安装 / 代码预期）。
**本骨架未生成任何测试。**

---

## 许可证

上游 `dsh-ai-library` 为 **MIT**（GitHub `spdx_id` / `package.json` `license` / `LICENSE` 三处一致），
在宽松白名单内。本包不复制上游源码，仅以 npm 依赖方式锁版引入。
