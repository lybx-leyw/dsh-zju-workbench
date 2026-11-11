# dsh-radar-paper-coach —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，本包**不 import 上游**，
> 也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

论文页右侧抽屉现在只有「你问，它答」。候选给同一个抽屉加一个**「伴读模式」开关**：
打开后，AI 不再把答案递到手上，而是先出题、等你读完原文自己答，答错**送回原文**再答。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

---

## 为什么是「强化」，不是「重复」

| 判据 | 本候选 | 结论 |
| --- | --- | --- |
| ① 仍是同一个面板 | 不注册页面、不注册 slot；落在 `dsh-zhiyun-page-paper` 已有的 `AssistantDrawer.jsx` 抽屉里，共用同一个输入框与同一条 SSE | ✅ |
| ② 功能仍相似正交 | 「问」要答案，「考」要理解。上游自己就把两者分开：Quick Q&A **明确不推进**学习计划 | ✅ |
| ③ 底层多调更优质实现 | 上游 1.6.x 的 `study_progress` / `study_update` + 每篇一份 `<论文>.study.json` 档案 + `&q=` 原句高亮 | ⚠ **半成立，见下** |

### 判据③为什么只算半成立

上游那套教练闸是**会话级 preset**（`preset-paper-reader`），设计上「选这个 preset 开一段对话」。
本包要做的是把它**反显进抽屉** —— 这是外围兼容层的活，不是上游现成能力。
所以准确说法是「底层多了更优质实现，**且**多了一层本仓自己的适配」，不能说「照抄即可」。

### 现有抽屉的实测形态（不是凭印象）

- `packages/dsh-zhiyun-page-paper/src/AssistantDrawer.jsx`（448 行）只做两件事：
  把问题交给 `/api/ask`，把 SSE 帧渲染成气泡（该文件第 19 行自己写着这句）。
- 抽屉里**没有**「计划 / 步骤 / 测验 / 档案」任何一种状态。
- `packages/dsh-zhiyun-*/src` 全量 grep `study_progress` / `study_update`：**0 命中**。

---

## 前置条件（**先看这条，否则后面的都白搭**）

**`LOCK_CONFLICT`**：本包依赖 `@ggboy123/dsh-paper-reader@1.3.1`（必须与本仓
`dsh-zhiyun-host-paper` 逐字符一致），但 `study_*` 工具与 `preset-paper-reader`
**只在上游 1.6.x 才有**。两条路，评审必须选一条：

| 路 | 做法 | 代价 | 对分级的影响 |
| --- | --- | --- | --- |
| **A** | `dsh-zhiyun-host-paper` 升到 1.6.x | 连带换掉整个论文页阅读器；触发 host-paper 自己的 `UPSTREAM_VERSION` 不一致 hard warn（「协议可能已经变化」） | 保持 🟢 |
| **B** | 只借 `study_*` 的契约形状，档案与闸门自研 | 判据③从「多调更优质实现」降为「借鉴契约」 | **应降 🟡** |

在此之前本包不实现任何逻辑。若评审选 B，请同步改 `registry.md` 的分级。

---

## 上游实测凭据（2026-11-03，npm 实装）

```
npm view @ggboy123/dsh-paper-reader version  →  1.6.1（MIT，javascript）
npm install @ggboy123/dsh-paper-reader@1.6.1  →  added 28 packages in 5s
node_modules 91M（其中 pdfjs-dist + @napi-rs 占大头），插件本体 3.0M
dist/index.js 启动日志：registered tools: list_papers, transcribe_pdf, search_paper, study_progress, study_update
dist/tools.js：readerUrl(ref) / readerUrlSchema（nullable：没有浏览器请求过时尚未捕获 origin）
```

上游 README 与 `cordis.patch.yml` 的 persona 原文口径（**引用，不抄写**）：
> 「NEVER summarize ... contents the student hasn't read and answered questions on yet」
> 「Stage gate (non-negotiable): a step passes only when the student's own-word answers show the understanding targeted by that step」

---

## 与既有 radar 包的关系

- `dsh-radar-paper-evidence`：答的是「落在原文**哪一块**」（粒度）。
- `dsh-radar-paper-union`：答的是「多篇**合起来**说什么」（范围）。
- **本包**：答的是「**你**读懂了多少」（理解）。三者同一面板、不同问题，不重叠。

---

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | A 类：`dependencies` **锁版** `@ggboy123/dsh-paper-reader: "1.3.1"`（与 host-paper 逐字符一致） |
| `cordis.patch.yml` | `insert: [{ id: radar-paper-coach, name: dsh-radar-paper-coach }]` |
| `src/index.js` | 占位；`apply()` 直接抛错，TODO 列了 5 条 |
| `src/upstream.js` | 锁版凭据 + `LOCK_CONFLICT` + `DESIRED_CAPABILITY` |
| `OWNERS` | `Owner: shared` |

无 `ATTRIBUTION.md`：本骨架**没有借鉴任何第三方的可摘代码**。上游是 npm 依赖（锁版引用，
不搬运源码），persona 口径只做引用。若评审选路 B 并摘取了上游 `study_*` 的契约实现，
**必须补 `ATTRIBUTION.md`** 并在根 `ATTRIBUTION.md` 指过来（CONTRIBUTING 3.3）。
