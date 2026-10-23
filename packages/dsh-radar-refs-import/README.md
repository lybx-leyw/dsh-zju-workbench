# dsh-radar-refs-import —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `previewImport()` / `planUploads()` / `loadUpstream()` / `parseReferences()` /
> `toLibraryHint()` / `apply()` 都直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 落点是**既有**的文献库抽屉 `dsh-zhiyun-page-paper/src/LibraryPanel.jsx`（已有「新建专题」「选择文件上传」），只加第三种入口「粘贴引用」。不新增页面、不新增导航项 |
| 功能相似且正交 | ✅ | 现有：**库内导航**（我有哪些 PDF、点开哪篇）。新增：**库的填充**（一串文献条目怎么变成库里的 PDF）。同一数据域、不同问题 |
| 底层多调了更优质实现 | ✅ | 本仓 BibTeX / RIS 解析**零实现**（见下「缺口」）。上游把两种语法折算成**同一个** CSL-JSON，手写要处理递归花括号 / `@string` 宏 / `#` 拼接 / `crossref` 继承 / LaTeX 重音符 / RIS 的 `TY`–`ER` 边界 |

> 它**不是**「再做一个文献管理器」，所以不继承 2026-10-18 判 🟡 的那条理由
> （那次的问题是「要真用得自建整条 UI：导入 / 选样式 / 插引用 / 生成文献表」，
> 属新功能页）。本骨架**只取整条链路的第一段**，且出口是既有上传路径。
> 引文样式、插引用、文献表生成**明确不在范围**。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [citation-js/citation-js](https://github.com/citation-js/citation-js) |
| npm（锁版） | **`@citation-js/core@0.9.0`**、**`@citation-js/plugin-bibtex@0.9.0`**、**`@citation-js/plugin-ris@0.9.0`** |
| 发布时间 | core 0.9.0 → 2026-09-18；三个包**必须同版本**（见 `src/upstream.js` `UPSTREAM_VERSION`） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；npm 各包 `license = MIT`；`LICENSE.md` 首行 `The MIT License (MIT) / Copyright (c) 2015-2026 Lars Willighagen`） |
| 作者 | Lars Willighagen（`larsgw`） |
| Stars | ★213，push **2026-10-22**（活跃；未经 archive） |
| 形态 | 纯 ES 解析库，`main/lib` + `module/lib-mjs`，**无 `browser` 字段、`lib-mjs/` 内无 `node:` 内置依赖** |

### 刻意不引的部分

| 包 | 原因 |
| --- | --- |
| `@citation-js/plugin-doi` | 会自行请求 Crossref / DataCite。我们的场景是「粘贴一段文本」，不需要联网；引它会多开一个网络出口（`sync-fetch-undici` 已在 core 的模块图里，见「成本」） |
| `@citation-js/plugin-csl` + `citeproc-js` | 负责**按 CSL 样式排版**（GB/T 7714、APA…）。本骨架不做引文输出，**故不触碰 2026-10-18 登记的 `citeproc-js` = NOASSERTION 那个未决点** |

---

## 缺口（本轮读码，可复现）

```bash
# ① 论文页 + 宿主半边里的全部 bibtex / ris / doi 命中
grep -rniE "\bbib\b|\.bib|ris|doi" \
  packages/dsh-zhiyun-page-paper/src packages/dsh-zhiyun-host-paper/src
# → 1 条，且是 AssistantDrawer.jsx:292 的一句注释（"回答里真出现外链（论文 DOI、arXiv）时…"）
#   ⇒ 不是能力，是注释

# ② 文献库的导入路径只有一条
grep -n "uploadPaper\|input type=\"file\"" packages/dsh-zhiyun-page-paper/src/LibraryPanel.jsx
# → 只有 uploadPaper({ topic, name, bytes })：选 PDF 文件上传。
#   没有「从条目起手」的入口。
```

**结论**：用户想收一篇论文，必须先去别处下 PDF，再回这里上传。中间那一段
（「我手上有的是 BibTeX 条目」→「变成库里的文件」）是断的。

形状与 r53（iCalendar）、r54（专注计时）相同：**「有下游、没上游」**。

---

## 接入点

本包**不改上游源码、不改 profile**。评审通过后的落点只有一处：

```
dsh-zhiyun-page-paper/src/LibraryPanel.jsx
  ├── 既有：新建专题  → createTopic()
  ├── 既有：选 PDF 上传 → uploadPaper({ topic, name, bytes })
  └── 新增：粘贴引用  → previewImport()  →（用户确认）→ planUploads() → 逐条 uploadPaper()
```

依赖锁版写在 `dsh-zhiyun-page-paper/package.json`，与
`dsh-zhiyun-host-paper` 锁 `@ggboy123/dsh-paper-reader@1.3.1` 是同一套做法
（写死版本、不用 `^`）。**本骨架的 `cordis.patch.yml` 评审后应删除。**

---

## 实测（2026-10-23，沙箱实跑，非推测）

环境：Node 22.13.0；`npm i --legacy-peer-deps @citation-js/core@0.9.0
@citation-js/plugin-bibtex@0.9.0 @citation-js/plugin-ris@0.9.0`。

| # | 断言 | 实测结果 |
| --- | --- | --- |
| M1 | BibTeX 单条 → CSL-JSON | ✅ `{type:'article-journal', title:'Literate Programming', author:[{given:'Donald E.',family:'Knuth'}], issued:{'date-parts':[[1984]]}, DOI:'10.1093/comjnl/27.2.97', page:'97-111'}` |
| M2 | RIS 单条 → CSL-JSON | ✅ `{type:'article-journal', title:'A Study of ZJU Courses', author:[{family:'Zhang',given:'San'}], issued:{'date-parts':[[2021]]}, DOI:'10.1000/test', page:'10-20'}` |
| M3 | 多条混合解析 | ✅ BibTeX + RIS 两段一起交 → `Cite#data.length === 2` |
| M4 | **中文条目** | ✅ `作者 = {王, 小明 and 李, 四}` → `[{family:'王',given:'小明'},{family:'李',given:'四'}]`；`title` / `container-title`（←`booktitle`）中文原样保留；`@inproceedings` → `type:'paper-conference'` |
| M5 | 非法输入 | ✅ 抛 `This format is not supported or recognized`（中文散文与随机英文都落这条）→ 这是**唯一**失败信号，见 R3 |
| M6 | 版本可混装？ | ❌ `core@0.9.0 + plugin-bibtex@0.8.4` → `ETARGET: No matching version found`；统一 0.9.0 后装成功（9 个包，963 ms） |
| M7 | 体积 | ⚠ core+2 插件+`@citation-js/{date,name}`+`moo`+`sync-fetch-undici` = **698,183 B unpacked（≈682 KB）** |
| M8 | 浏览器可用性 | ⏳ **未测完**。`lib-mjs/` 内 `grep` 不到 `node:` 内置依赖 → 预计可直接打包；但 `sync-fetch-undici` 被 core 主入口**静态** re-export（`index.js` → `util/index.js` → `fetchFile.js`），**必须在真实打包器里验一次**（见 `upstream.js` TODO-A-1） |

---

## 四条硬约束（实现前先记住）

| # | 约束 | 违反的后果 |
| --- | --- | --- |
| R1 | 三个包**同版本** | 装不上（`ETARGET` / `ERESOLVE`） |
| R2 | 插件是**副作用导入** | 少一行 `import '@citation-js/plugin-ris'` 代码照样编译，用户粘 RIS 时才炸 |
| R3 | 格式靠**内容嗅探** | 「粘错格式」与「粘了一段散文」是同一种错误 → 文案写「没认出这段文本的格式」，别写「BibTeX 解析失败」 |
| R4 | **682 KB** unpacked | 这是唯一真成本。在 M8 打包体积出数之前，**不得**从 🟢 升为已采纳 |

---

## 评审要拍板的三件事

1. **682 KB 值不值**（M7 / R4）。对照：r53 的 `ics` 是 75 KB 且判了 🟢。
   若认为「为导入一段文本引入 682 KB」不划算，应改判 🔵 并删除本目录。
2. **PDF 从哪来**（`src/index.js` TODO-3）。方案 A（只给命名建议，PDF 用户自己放）
   还是方案 B（解析 DOI/arXiv id，交给上游检索链路取）？**方案 C（本包自己下载）
   已否决**：开第二个网络出口 + 版权风险。B 需要先核实上游 24 条路由里是否
   真有「按 id 取 PDF」这一条 —— **本轮未核**。
3. **单次上限 50 条**（`upstream.js` TODO-D）是否合适。真实场景是 Zotero 全库导出。

---

## 许可与来源声明

- 本包**不包含任何上游源码**，只有锁版依赖声明与窄接口占位。
- 上游 MIT 许可证允许此类使用；本目录不含其代码副本，故无需复制 `LICENSE`。
- 若实现时摘录了上游任何片段（当前**没有**），须在本节登记具体文件与行号。
