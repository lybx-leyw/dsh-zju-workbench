# dsh-radar-markitdown-js —— 候选骨架

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
| 仓库 | [Mirza-Glitch/markitdown-js](https://github.com/Mirza-Glitch/markitdown-js) |
| npm | `markitdown-js@0.0.14` |
| 许可证 | **MIT** ✅（`/license` 端点核实 + npm `license: MIT`，宽松白名单内） |
| 作者 | Mirza-Glitch |
| Stars | ★21 |
| 最近推送 | 2025-03-02（**上游已停滞约 19 个月**） |
| 语言 | TypeScript |
| 包形状 | `type: module`，`main: dist/markitdown.js` |
| 上游依赖 | `mammoth`(docx)、`turndown`(html→md)、`node-html-parser`、`node-pptx-parser`、`xlsx`、`pdf-parse-tt-message-gone`、`node-tesseract-ocr`、`exiftool-vendored`、`fluent-ffmpeg`、`iconv-lite`、`@kenjiuno/msgreader`、`unzipper`、`xmldom`、`axios`、`mime-types`、`tmp` |

上游是 [microsoft/markitdown](https://github.com/microsoft/markitdown)（MIT，★190577）的 **JS 端口**：
按格式分派到各格式的专用成熟库，产出「LLM 友好」的 Markdown。

---

## 类型与集成判定

- **类型**：**B · 其他 JS 项目**
  —— 上游**不是**原生 DSH 插件包：npm 包里**没有** `dsh.bundle.patch` / `dsh.client`。
- **集成方式**：**能力提取 + 封装**（B 类范式，**不是** A 类的「锁版挂载 + 外围承载」）
  —— 本包的 `cordis.patch.yml` 只把**本包自己**挂进 DSH 运行时；
  `dependencies` 里的 `markitdown-js` 与 DSH 运行时无关，仅作能力来源。
- **与现有功能的关系**：**重复且可强化** ✅

### 为什么是「强化式集成」而不是简单集成

三条同时成立：

| 条 | 判断 |
| --- | --- |
| **仍是同一个面板** | 产物喂给**已有的**笔记页 / 论文页导入通路，**不新增页面、不改导航** ✅ |
| **功能仍相似正交** | 两边都在做「把外来文档变成可读文本」，不是两套并列能力 ✅ |
| **底层多调了更优质实现** | 本仓**原本没有格式转换底层** —— `dsh-zhiyun-parser` 是三阶段 **LLM 解析器**（依赖仅 `sharp`），走「模型理解」而非「格式转换」；`dsh-zhiyun-paper` 的 `pdfjs-dist` 只负责 PDF **渲染**。上游按格式分派到**各格式专用库**，正是现有链路缺的那层 ✅ |

**强化式集成的意义**：不是「本仓已有一份 docx→md，再接一份重复的」，
而是「本仓**没有** docx/pptx/xlsx→md，接进来让导入通路**多出多种格式**」。

> ⚠ **反向条件**：若评审认定本仓**不打算**做多格式导入，
> 则「底层多调了更优质实现」一条**不再成立** → 本条应降为 🔵，**整个目录删除**。
> **这正是第 1 条裁量点。**

---

## 裁量点（评审时必须逐条裁决）

### 裁量一（最高优先）：本仓是否需要多格式导入？

- **需要** → 继续评审裁量二、三、四。
- **不需要** → **降 🔵，删除本目录**。

### 裁量二：整包引入 vs 自建收敛子集？

上游 `dependencies` 含三个**平台强绑定**项：

| 依赖 | 问题 |
| --- | --- |
| `exiftool-vendored` | 捆绑二进制（体积 + 平台矩阵） |
| `fluent-ffmpeg` | 需系统 ffmpeg |
| `node-tesseract-ocr` | 需系统 tesseract |

**建议：自建收敛子集**（若只要 docx/pptx/xlsx/html 通路）。
以下候选底层件的许可证已逐一核实（2026-10-17），**全部在宽松白名单内** ✅：

| 包 | 版本 | 许可证 | 覆盖 |
| --- | --- | --- | --- |
| `turndown` | 7.2.4 | MIT ✅ | html → markdown（**事实标准**） |
| `turndown-plugin-gfm` | 1.0.2 | MIT ✅ | GFM 表格/删除线等扩展 |
| `mammoth` | 1.13.0 | BSD-2-Clause ✅ | docx → html/markdown |
| `node-pptx-parser` | 1.0.1 | MIT ✅ | pptx 文本抽取 |
| `xlsx` | 0.18.5 | Apache-2.0 ✅ | xlsx 解析 |

自建路线的收益：**避开三个二进制依赖**，显著减小体积与部署风险。

### 裁量三：`markitdown-js` vs `instax-dutta/MarkItDownJS` —— 二选一

| | `Mirza-Glitch/markitdown-js` | `instax-dutta/MarkItDownJS` |
| --- | --- | --- |
| Stars | ★21 | **★1** |
| 许可证 | MIT ✅ | MIT ✅ |
| 最近推送 | 2025-03-02（停滞） | **2026-08-24（活跃）** |
| 覆盖 | docx/pptx/xlsx/pdf/html/msg/图片/音频 | **更广**：PDF/DOCX/PPTX/XLSX/HTML/CSV/JSON/XML/图片/音频/EPUB/压缩包 |
| npm | `markitdown-js@0.0.14` ✅ | 未核实到同名发布 |

**两者功能重叠 → 不要都接。** 本轮出的是 `markitdown-js` 骨架（npm 可锁版、star 略高）；
若评审更看重**活跃度与覆盖面**，可改用 `MarkItDownJS` 并重出骨架。

### 裁量四：与 `danburzo/percollate`（★4688）的关系

`percollate` 是 Node CLI：网页 → 可读 PDF/EPUB/HTML/**Markdown**（内置 Readability），
成熟度远高于本候选，但**是 CLI 而非可 import 的库**，需改造。

- **分工建议**：网页导入走 `percollate`，本地文档导入走本包。
- 或 **二选一**（若本仓的导入场景以网页为主，则 `percollate` 更优）。

---

## 风险清单

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 上游停滞 | 最后推送 2025-03-02，已约 19 个月 | 走裁量二自建收敛子集 → 风险基本消解 |
| 二进制依赖 | `exiftool-vendored` / `fluent-ffmpeg` / `node-tesseract-ocr` | 同上 |
| 补丁包依赖 | `pdf-parse-tt-message-gone` 是 `pdf-parse` 的 fork 补丁包 | 自建路线可改用官方 `pdf-parse@2.4.5`（Apache-2.0） |
| 社区验证不足 | ★21 体量小 | 评审时重点看代码质量与测试覆盖 |
| 版本语义 | `0.0.x` 无任何兼容性承诺 | 已写死精确版本 + 运行时核对（见 `src/upstream.js`） |

---

## 目录结构

```text
packages/dsh-radar-markitdown-js/
├── package.json       # 锁版 markitdown-js@0.0.14（写死，不用 ^）；dsh.bundle.patch → ./cordis.patch.yml
├── cordis.patch.yml   # - insert: [{ id: radar-markitdown-js, name: dsh-radar-markitdown-js }]
├── src/index.js       # 占位 + TODO（「能力提取 + 封装」的适配点，不写业务逻辑）
├── src/upstream.js    # 上游锁版凭据 + 依赖形状 + 自建候选件清单
├── README.md          # 本文件
└── OWNERS             # Owner: shared
```

---

## 硬边界声明

- ✅ 锁版（写死 `0.0.14`，**不用 `^`**）引入上游
- ✅ **绝不修改上游源码**
- ✅ **未**写入 `profiles/zhiyun-bench/package.json`（候选包不接进 profile）
- ✅ `OWNERS` 为 `shared`（**不碰他人 OWNERS**）
- ✅ 无 ATTRIBUTION.md —— 本骨架**未借鉴任何第三方代码**，仅引用公开的许可证与版本信息
