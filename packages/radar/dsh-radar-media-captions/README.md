# dsh-radar-media-captions

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 也**没有**被任何 `dsh-zhiyun-*` 包依赖，因此**不会**在运行时生效。
> `src/index.js` 里四个函数**全部 `throw`**，`src/upstream.js` 的 `loadUpstream()`
> 直接返回失败 —— 这是故意的，不是没写完。
>
> 本包是 **B 类**（其他 JS 项目），**不含** `cordis.patch.yml`：上游是**库**不是 DSH 插件，
> 接入点在宿主页面内部，挂哪里由人工评审决定。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 类型 | **B 类 · 其他 JS 项目**（TypeScript 写的字幕格式解析器，纯 ESM 库） |
| 上游 | [`vidstack/captions`](https://github.com/vidstack/captions) ★149 |
| npm 包名 | **`media-captions`**（⚠ **不是** `vidstack-captions`，后者 404） |
| 锁定版本 | **`media-captions@1.0.4`**（精确版本，非 `^`；理由见下） |
| 许可证 | **MIT** ✅（GitHub metadata 与 npm `license` 两处一致） |
| 作者 | Rahim Alwer（vidstack） |
| 体积 | `unpackedSize` **162,428 B**（≈159 KB），**运行时依赖为 0** |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | **「字幕」页**（`dsh-zhiyun-page-study/src/study-workspace.jsx` 的 `字幕` tab）与**「终稿」的原文层**（`dsh-zhiyun-study-core/src/workbench.js`） |

### 为什么必须写死 `1.0.4`（这不是偏好，是事实）

2026-10-20 实测 `registry.npmjs.org/media-captions`：

| `dist-tags` | 版本 | 发布时间 | `type` | unpacked |
| --- | --- | --- | --- | --- |
| `latest` | `0.0.18` | **2023-06-15** | （无 `type`） | 215,660 B |
| `next` | `1.0.4` | **2024-07-29** | `module` | 162,428 B |

装不带版本的 `media-captions`，npm 会给 **2023 年那个 `0.0.18`**（其 `exports` 里还带
`deno` / `node` / `test` 条件，更绕）。**写死 `1.0.4` 是唯一能拿到 2024 版的办法。**

⚠ 这也意味着本包依赖的是一个 **`next` 标签**上的版本。若评审不接受「装非 `latest` 的稳定版」，
本候选应降级为 🟡（只剩 `0.0.18`）。

## 这条 🟢 到底买到了什么（**评审必读，别误读**）

本仓**没有任何字幕解析器**：字幕是智云 API 返回的 JSON（`{BeginSec, EndSec, Text, TransText}`），
`dsh-zhiyun-classroom/src/models.js` 只做字段映射，**没有「cue 树」这个概念**。
上游带来的是**标准格式层**（VTT / SRT / SSA → cue 树，含 `region` / `voice` / `align` 等 cue settings）。

**但它不解决本仓真正的缺口。** 上游**不提供**：

| 上游不提供 | 本仓的缺口在哪 |
| --- | --- |
| **中文断句** | `workbench.js:325` / `:399` 用 `join("")` 拼正文 → 相邻字幕无任何分隔 |
| **标点恢复** | `parser/src/core.js:57 buildCleanSentences()` 不做任何标点处理 |
| **浙云 JSON 信道** | 上游只认 VTT/SRT/SSA **文件文本**，不认 `{BeginSec,…}` |

> **一句话**：上游管「边界在哪」，本仓缺「边界之间怎么连」。
> **接上游 ≠ 断句做完了** —— 断句规则仍然要本仓自己写（`TODO-2`），
> 而且必须**先定验收标准**再动手（参照 2026-10-19 第三十轮：先定判据，再选底层）。

## 强化式集成的三条判据

| 判据 | 回应 |
| --- | --- |
| **① 仍是同一个面板** | ✅ 不新增导航项。「字幕」页是 `contentTabs` 第 5 项，照旧；`video-panel.jsx` 的 `TranscriptLine` 照旧；`zy://section?…&t=` 时间链照旧。变的只是同一页里**那串文本的切分与双语呈现** |
| **② 功能仍相似正交** | ✅ 上游做「字幕格式 ↔ cue 结构」，本仓缺「cue 结构 → 可读句子」。同一域的不同问题，不重叠 |
| **③ 底层多调了更优质实现** | ✅ **但强度中等**。本仓完全没有「cue 树」这一层；上游补上了标准格式层。它增益的是**格式标准化**，不是**可读性** |

## 四个 TODO（评审通过后由人实现，顺序不可换）

| # | 内容 | 依赖上游吗 | 风险 |
| --- | --- | --- | --- |
| TODO-1 | 信道适配：浙云 JSON → cue，**必须补往返单测** | 是 | `startMs` 取整口径（`Math.round(BeginSec*1000)`） |
| TODO-2 | 中文断句：定义「什么样的 cue 序列算一句」 | **否** | **没有验收标准就不能开工** |
| TODO-3 | 双语轨渲染（`english` 字段） | **否** | 低 —— 数据早就在，**可独立先做** |
| TODO-4 | 替换 `join("")` | 否 | **会改 `finalVersion`** → 已有课堂全显示「需要重新整理」 |

## 风险

- **R-1（版本语义）**：`1.0.4` 站在 `next` 标签上。评审需明确接受，否则降 🟡。
- **R-2（`TODO-4` 是产品决策）**：`workbench.js:64` 的 `finalVersion` 对 `record.sentences` 取 digest，
  改拼接方式会让**所有已落盘课堂**失效。在拍板之前**不要**动这一行。
- **R-3（导出名未验证）**：`src/upstream.js` 的 `UPSTREAM_EXPECTED_EXPORTS` 是据 `index.d.ts`
  **抄来的，没有运行时验证**（骨架不装依赖）。评审第一步应先跑
  `npm i media-captions@1.0.4 && node -e "import('media-captions').then(m=>console.log(Object.keys(m)))"`。
- **R-4（上游 ≠ 需求）**：上游描述里的「rollup captions via VTT regions」是**滚动字幕**（直播场景），
  与本仓「课堂回放的分句阅读」不是一回事，**不要**因为它有 region 就以为它懂断句。

## 上游来源记录

本包**不搬运**上游任何源码，只锁版 `import` 其公开入口。若评审后决定借鉴上游的 cue 模型
（而不是直接 import），须按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md) 补
`ATTRIBUTION.md` 并在根 `ATTRIBUTION.md` 指向本包。
