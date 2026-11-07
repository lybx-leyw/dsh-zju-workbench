# dsh-radar-paper-evidence —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，本包**不 import 上游**，
> 也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把「论文阅读」页的 AI 回答落点从**页**精确到**原文区块**（可引用的块 id + 位置框 +
「支持什么 / 不支持什么 / 限制在哪」三字段），并给转录产物一个**可核对的构建身份**。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

---

## 为什么是「强化」，不是「重复」

论文页现在有三级回答粒度，**缺第四级**：

| 粒度 | 问法 | 现有实现 |
| --- | --- | --- |
| 篇 | 「这篇讲了什么」 | 右侧抽屉整段回答（锁版上游 `/paper-reader/api/session/follow`） |
| 选区 | 「这句英文什么意思」 | 悬停译文浮层（`ReaderFrame.jsx` + `selection-text.js`） |
| 页 | 「这个结论在第几页」 | `AssistantDrawer.jsx` 的页码 chip，可点跳转 |
| **块/句** | 「原话是**哪一句**、**没**说什么」 | **无** ← 本包 |

第四行问的仍是同一支问答，界面仍是同一页，**只是答案落点更细**。这正是
skill 定义的强化式集成三条判据：同一面板 ✔ / 功能相似正交（粒度）✔ / 底层多调更优质实现 —— **这条要打折扣，见下**。

## 底层「更优」在哪 —— 以及为什么不能整包照搬

候选源头是 [`piggymon907/codex-paper-reader-skill`](https://github.com/piggymon907/codex-paper-reader-skill)
（**MIT**，release `2.7.1`）。它值钱的是**契约**，不是 UI：

1. **坐标**：PDF point、左上原点；页面尺寸留在 `paper_index.json`，**只在浏览器换百分比**。
2. **断裂行**：一个标记挂多个 `bboxes`；图/表/公式另给 `visual_bbox` 供裁切放大。
3. **三字段强制**：`supports` / `does_not_support` / `limitations` —— 本仓**完全没有**「没说什么」这一维。
4. **单一证据对象**：侧栏摘要与全屏讲解**禁止**两套解释。
5. **构建身份不可变**：`run_manifest.json` 记 `generator.skill_version` 与四项文本质量计数
   （`long_alpha_runs` / `cid_artifacts` / `suspicious_glue_boundaries` / `damaged_formula_references`），
   身份不符按**校验失败**处理。

### 但它不是 npm 依赖 —— 这是本包最大的风险

| 部分 | 语言 | 能否直接用于本仓 |
| --- | --- | --- |
| `assets/reader/reader.js`（52.7 KB） | JS | ✅ 前端渲染，可作参考实现 |
| `references/data-contract.md` | 文档 | ✅ 契约，可照字段名使用 |
| `scripts/extract_paper.py`（25.7 KB）等 9 个脚本 | **Python** | ⛔ 本仓宿主是 Node |

⇒ 可选项只有两个，**评审须二选一**：

- **(a) 只取契约** —— 抽取仍用上游转录，自己算 bbox。（本骨架默认按 (a) 写）
- **(b) 引 Python 旁路** —— 新增 Python 运行时在服务端跑抽取。**架构级决定，超出雷达裁决权。**

> 另外，「已有页面里的 PDF 阅读器」锁的仍是 `@ggboy123/dsh-paper-reader@1.3.1`
> （见 `packages/dsh-zhiyun-host-paper/src/upstream.js`）。本包 `dependencies` 里的版本
> 必须与它**逐字符一致**，不得自行升级 —— 升它会连带换掉整页阅读器。

## 第一道闸门：上游给不给 bbox？

上游 reader 是**整页渲染**形态（`#pageImage` + `#pageCanvas` + `#markerLayer`），
画锚点需要「每页位图」+「每块 bbox」。本仓 `/paper-reader/` 的 24 条路由**是否提供**
这两样，**尚未核实**。

- 若提供 → 按 (a) 推进。
- 若不提供、且只能靠 pdf.js text layer 现算 → **先测精度**；精度不达标则整包驳回，
  改登记为「能力提取（坐标契约）」。

**这一步没过，后面所有 TODO 都无意义。**

## TODO 一览

| # | 事项 | 阻塞? |
| --- | --- | --- |
| TODO-0 | 核实 `/paper-reader/` 是否提供每页位图与块级 bbox（见上） | **是** |
| TODO-1 | R1 二选一：(a) 只取契约 / (b) 引 Python 旁路。默认 (a) | **是** |
| TODO-2 | 锚点存哪：倾向新增副表 `paper_anchor`（与转录不同生命周期） | 否 |
| TODO-3 | `supports` / `does_not_support` / `limitations` 必须有质检，否则**不上线** | 否 |
| TODO-4 | 构建身份的文本质量计数：算不出来的项**不显示 0** | 否 |
| TODO-5 | 与 `AssistantDrawer` 页码 chip 合并，**不要**一行两个可点目标 | 否 |
| TODO-6 | 若只保留「构建身份 + 文本质量计数」这一小块，可拆成极小包 | 否 |

## 文件

| 文件 | 职责 |
| --- | --- |
| `package.json` | 锁版依赖 `@ggboy123/dsh-paper-reader@1.3.1`（与 host-paper 一致） |
| `cordis.patch.yml` | `insert` 一条 `radar-paper-evidence`（**仅供评审参考，未接入**） |
| `src/index.js` | 占位 + TODO；`apply()` 直接抛错 |
| `src/upstream.js` | 锁版凭据 + 契约出处（`CONTRACT_SOURCE`） |
| `ATTRIBUTION.md` | 契约出处与「未摘取代码」声明 |

## 已知风险

- **R1** 上游无 npm 包、抽取层是 Python ⇒ 只能取契约或引旁路（见上）。
- **R2** 上游是否给 bbox **未核实** ⇒ 第一道闸门。
- **R3** iframe 同源已验证可注入（`frame-theme.js`），但 `markerLayer` 与上游浮层的
  z-index 遮挡关系**未测**。
- **R4** 许可证 MIT ✅（`LICENSE` 1070 B 实文已核）；本包**不摘代码**，只用字段名。
- **R5** 与 `dsh-radar-paper-union` 都改论文页，但**不改同一行**（检索来源 vs 锚点层）；
  评审时请合并看，避免两个骨架同时改 `ReaderFrame`。
