# dsh-radar-section-deeplink

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 在第五十轮（2026-10-22）生成，**仅用于人工评审**。
> 它**不是**一个可用插件：`apply()` 会**直接抛错**。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
>
> 与其他候选骨架不同，本包**不当候选、也不主张被采纳**——它是**对照物**（contrast object），
> 作用是**把一条结论钉住**：跨节深链缺的是**壳的入口参数**，不是上游库。
> 就集成判定而言，它是「**既非全新、也非强化式集成**」——判据 1 与判据 3 同时不成立，故本轮**零 🟢**。

---

## 它回答什么问题

> 「笔记里的 `zy://section/9.20?t=201` 指向另一节，点下去只提示『本节里没法跳过去』。
> 这是本仓的缺陷吗？要不要接一个插件补上？」

**答案：不是缺陷，也不该用集成补。** 依据三条，全部可在当前代码上复核：

| # | 位置 | 事实 |
| --- | --- | --- |
| 1 | `packages/dsh-zhiyun-page-study/README.md:14` | 原文：「**另一节的链接留在原地并说明跳不过去**」—— 文档化的设计 |
| 2 | `tests/study.test.mjs:242` | 断言 `.kind === 'other-section'` —— 改行为会先红这条测试 |
| 3 | `packages/dsh-zhiyun-study-core/src/model.js:112` | `selectLesson()` 切节时把 `content` 等 13 个字段清 `null`；而学习页**视频栏读的就是** `state.content` |

⇒ 照它跳过去，用户看到的是**播放中的视频被掐断**，而不是"跳到那一节的那一句"。

## 能力在、入口不在（这才是真话）

| 环节 | 状态 | 位置 |
| --- | --- | --- |
| 解析 `zy://section/<课>/<节>?page=&t=` | ✅ 已有，且能报 `BAD_SECTION_LINK` | `dsh-zhiyun-notes/src/note.js:197-240` |
| 跨课载入（`loadCourse` → `selectLesson`） | ✅ 已有先例 | `dsh-zhiyun-study-core/src/model.js:350-363`（`loadRecent`） |
| `navigate(id)` 带参数 | ❌ 只收页面 id | `dsh-zhiyun-shell/src/client.jsx:48` |
| 第二个内容注册位 | ❌ 每页 `kind: 'single'` | `dsh-zhiyun-shell/src/client.jsx:143` |

**结论：缺的是入口，不是库。** 所以本包 `dependencies` 为空，`upstream` 为 `null`。

## 为什么不算 🟢（判据不成立）

| 强化式集成判据 | 结论 |
| --- | --- |
| ① 仍是同一个面板 | ❌ 换节 = 换掉当前节的全部内容，**视频被掐断** |
| ② 功能仍相似正交 | ✅ 成立（"链接指向哪"与"我在哪一节"确实正交） |
| ③ 底层多调了更优实现 | ❌ 不成立：本仓已有解析器，**接上游只是第二套解析器** |

## 若要真的做（给评审的选项，不是实现）

| 选项 | 形态 | 代价 |
| --- | --- | --- |
| (a) 就地切节 | 一个 `selectLesson` 调用就能实现 | ❌ **掐断播放**，不建议 |
| (b) 侧栏画中画 / 新标签 | 两节各持一份 `state.content` | 超出「同一个面板」；`selection` ticket 与 `hls` 实例都要按节拆分 |
| (c) 维持现状 | 把「另一节」换成可点链接，点了打开**侧栏**读那一节笔记 | 最低；但要先改 `tests/study.test.mjs:242` |

**TODO-0 是阻塞项，而且在壳里**（`dsh-zhiyun-shell`），**任何候选包都改不了它**。

## 元信息

| 项 | 值 |
| --- | --- |
| 类型 | **B**（无上游 DSH 依赖；零依赖） |
| 上游 | **无** |
| 许可证 | 不适用（零依赖、无摘取） |
| 文件 | `package.json` / `cordis.patch.yml` / `src/index.js` / `README.md` / `OWNERS` |
| 首次发现 | 2026-10-22（第五十轮 · A 组 · 跨节深链轴） |
| Owner | `shared` |
