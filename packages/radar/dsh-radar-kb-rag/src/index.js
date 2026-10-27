/**
 * dsh-radar-kb-rag —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**
 * （`dsh-kb-rag`），只从 `./upstream.js` 取锁版凭据。`apply()` 直接抛错，
 * 目的与 `dsh-radar-knowledge-fold` 相同 —— 万一有人误挂，**立刻响**，
 * 而不是静默转成一个什么都不做的包。
 *
 * ── 这个包想做什么（强化式集成，不是新建功能）───────────────────────
 *
 * 论文阅读页（`packages/dsh-zhiyun-page-paper`）现在的检索能力，全部来自**锁版上游**
 * `@ggboy123/dsh-paper-reader` 的 `search_paper`：回答单位是「哪篇 PDF 的哪一页」。
 * 本仓只贡献了一个可选的「检索重排端点」配置（`SettingsSection.jsx:67`）。
 *
 * 学生真实的问题却是「我半年前在哪篇里看到过那个定义」——回答单位应是
 * **段落 / 图表 + 出处（章节 / 页码 / DOI）**，且要跨「已上传 PDF + 本地 Zotero 库」。
 *
 * 这件事不该自己写：混合检索（BM25 + 本地向量）+ 出处定位是一个成熟问题。
 * `dsh-kb-rag@1.6.8` 正好提供了它，且**只注册 model tool**（无页面、无侧栏），
 * 于是它接进来之后：
 *
 *   - 面板还是那个面板（回答仍出现在 `AssistantDrawer` 里）；
 *   - 功能还是那件事（检索论文原文），只是粒度从「篇」变成「段」；
 *   - 底层换成了更优的实现（混合召回 + 出处字段 + 本地推理，正文不外发）。
 *
 * 三条同时成立 ⇒ 属于「重复且可强化」，**不是**「重复且无增益」。
 *
 * ── 为什么 `apply()` 里要抛错，而不是「先空着」 ──────────────────
 *
 * 空着的 `apply()` 是**最危险的候选骨架**：它能被挂上去、能启动、看上去一切正常，
 * 而 TODO-0（缺 `subprocess` 就静默降级）恰恰是**上游自己**也不会报错的那种问题。
 * 如果再叠一层「本包也不报错」，评审就永远发现不了。
 * ⇒ 宁可 `apply()` 抛错，让 bundle 起不来（响的失败），也不要一个不响的壳。
 *
 * ── TODO 一览（全部是评审要先拍板的，不是「怎么写代码」）───────────
 *
 *   TODO-0【阻塞】宿主 profile 是否有 `subprocess` 服务？
 *         检查方式：跑一次 `dsh-kb-rag-install --profile zhiyun-bench --dry-run`
 *         看它准备写什么（本轮**未执行**，因为它会改 profile）。
 *         - 有 → 继续 TODO-1。
 *         - 没有 → **不要接这个包**；上游 `apply()` 会在 `console.error` 后 return，
 *           10 个工具全部不存在，而论文页照常打开、用户看不到任何异常。
 *
 *   TODO-1【阻塞】Python 运行时从哪来？
 *         引擎是 `spawn` 出去的 `kb_engine.py`；首次使用可能还要下 `bge-small` 模型
 *         （上游 `install.mjs` 默认注入 `--models`，失败切 `hf-mirror.com`）。
 *         本仓用户端是 Electron 桌面壳，Python 不一定在 PATH 上。
 *         候选方案：①要求用户自装；②随包带一份便携 Python（体积 +80 MB 量级）；
 *         ③把引擎换成纯 JS（等于自己重写，回到「该不该集成」的原点）。
 *
 *   TODO-2【阻塞】落盘位置。
 *         上游会写 `<workspace>/.kb-rag/state.json`（会话默认值）与一个 `kb.sqlite`。
 *         本仓既有约定是「笔记库只有 .md」（r40 结论）→ 先裁决：
 *         放工作区（会出现在用户的笔记目录里）还是放 profile 的 dataDir？
 *
 *   TODO-3 挂载形态：本包**只** `ctx.plugin(upstream)`，**不**消费上游的 `./client`。
 *         理由：论文页已经有一套文献库 UI，再来一套就是「一个面板两个入口」。
 *
 *   TODO-4 挂载后自检：`REQUIRED_SERVICES` 都在 → 挂；挂完后核对
 *         `UPSTREAM_TOOLS` 是否**真的**出现在 `tools` 表里，缺任意一个就报警
 *         （这是唯一能在「静默降级」发生时把问题**显形**的位置）。
 *
 *   TODO-5 子集暴露：`kb_clear` / `kb_dedup` 会改库，是否对用户侧隐藏？
 *         `kb_fetch` 会联网抓 PDF —— 与「本地优先」的既有叙述是否冲突？
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  REQUIRED_SERVICES,
  UPSTREAM_TOOLS,
} from './upstream.js';

export const name = 'radar-kb-rag';

/**
 * 上游需要的宿主服务。**声明在这里**，让 cordis 等它们就绪后再激活本包 ——
 * 否则本包会在 `subprocess` 注册之前执行（loader 用 `Promise.allSettled` 并发激活），
 * `ctx.get('subprocess')` 拿到 `undefined`。
 */
export const inject = REQUIRED_SERVICES;

/**
 * @param {import('@deepseek-ai/cordis').Context} _ctx
 */
export function apply(_ctx) {
  throw new Error(
    'dsh-radar-kb-rag 是候选骨架（未评审、未接入 profile、不可直接使用）：'
      + `请先裁决 TODO-0（宿主是否有 subprocess 服务）与 TODO-1（Python 运行时）。`
      + `上游 = ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}，将注册 ${UPSTREAM_TOOLS.length} 个工具。`,
  );
}
