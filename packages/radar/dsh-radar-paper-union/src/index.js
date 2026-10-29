/**
 * dsh-radar-paper-union —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**
 * （`dsh-ai-library`），只从 `./upstream.js` 取锁版凭据。`apply()` 直接抛错，
 * 目的与 `dsh-radar-kb-rag` 相同 —— 万一有人误挂，**立刻响**，
 * 而不是静默转成一个什么都不做的包。
 *
 * ── 这个包想做什么（强化式集成，不是新建功能）───────────────────────
 *
 * 论文页的检索半径目前有**两段**，缺第三段：
 *
 *   | 段 | 问法 | 回答单位 | 谁在实现 |
 *   | --- | --- | --- | --- |
 *   | ① 单篇内 | 「这个定义在这篇第几页」 | 页 | 锁版上游 `@ggboy123/dsh-paper-reader` 的 `search_paper` |
 *   | ② 文献库内 | 「我上传的这批里哪篇说过」 | 段落 | r57 的 `dsh-radar-kb-rag`（骨架） |
 *   | ③ **全网** | 「这个方向最新做到哪了 / 有没有人做过」 | **论文条目 + DOI + PDF 链接** | **缺** ← 本包 |
 *
 * 第三段不是「再做一个搜索框」：它回答的问题**必须**在① ②都答不了的时候才被问出
 * （用户手里还没有那篇论文）。这是「功能相似正交」，不是「重复」。
 *
 * 上游 `lib/paper.js` 正好提供了这一段：纯 Node、无依赖、5 个真实可用的免 key 源，
 * 返回统一的 `{items, errors, usedSources}`。**但它有三个必须先修的毛病**（见 `upstream.js`
 * 的 a/b/c 三条），原样转发等于把「更优底层」这句话变成空话。
 *
 * ⇒ 三条判据：
 *   ① 仍是同一个面板 —— 本包**不注册 slot**，只在论文页已有的检索抽屉里多一个来源；
 *   ② 功能仍相似正交 —— 半径不同（全网 vs 单篇 vs 库内），不是同一件事的第二实现；
 *   ③ 底层多调了更优质实现 —— 本仓 `grep -rniE 'arxiv|crossref|openalex' packages/dsh-zhiyun-*/src`
 *      只有 1 处注释命中，**零实现**。
 *
 * ── 为什么 `apply()` 里要抛错，而不是「先空着」─────────────────────
 *
 * 空着的 `apply()` 是**最危险的候选骨架**：能挂上、能启动、看上去一切正常。
 * 而 TODO-0（把 5 源当成 10 源）恰恰是**代码不会报错**的那种问题 ——
 * 它只会让用户觉得「这个方向 arXiv 上没有论文」。宁可响，不许静默。
 *
 * ── TODO 一览（全部是评审要先拍板的，不是「怎么写代码」）───────────
 *
 *   TODO-0【阻塞】接受「5 源」这个事实，还是自己补到 10 源？
 *         上游 `AUTO_SET` 只并发 5 个（`openaire/inspire/zenodo/hal/datacite` 是死代码）。
 *         - 接受 → UI 文案里**不许**写「十源」，写「5 源」。
 *         - 补齐 → 等于改写上游这一段，回到「该不该集成」的原点；且 5 个源里有 2 个
 *           （`hal` / `inspire`）本身就是窄领域库，对学生场景增益有限。
 *
 *   TODO-1【阻塞】arXiv 这一源要不要留？
 *         实测：多词查询会「超时」或「200 空」，中文恒 0。对本仓的目标用户（浙大学生、中文提问）
 *         它**大概率是负资产**（每次白等 20 s）。候选：①直接踢出 `auto`；
 *         ②保留但把查询改造成 `all:w1 AND all:w2`（实测可用）并给 8 s 独立超时。
 *         **不要**照抄 `all:"整句"`。
 *
 *   TODO-2【阻塞】相关性重排由谁做？
 *         上游按源轮转，无 relevance。若原样渲染，中文查询首条可能是无关论文。
 *         候选：①本仓已有的 `llm` 服务做一次小重排（成本可测）；
 *         ②按 `source` 加权 + 标题与查询的词重叠打分（零成本、可解释）；
 *         ③给用户「按源分组」展示，不做全局排序（最诚实）。
 *
 *   TODO-3 结果落地：`items` 里带 `pdfUrl` / `doi`，下一页应是**本仓已有的**「下载入库」链路
 *         （`dsh-zhiyun-host-paper` 的转录 + r57 的 kb-rag 语料），**不是**再存一份到
 *         上游的 `ai-library/items/`。落盘位置遵循本仓约定（数据目录，不是笔记目录）。
 *
 *   TODO-4 挂载形态：**只** `import('dsh-ai-library/lib/paper.js')`，**绝不**用上游的
 *         `dsh.bundle.patch`（那会挂整包：第二个面板 + `/install` 装包 + `/update` git pull）。
 *         本包自己的 `cordis.patch.yml` 只 insert 本包。
 *
 *   TODO-5 降级：上游模块 import 失败（版本没装 / 被覆盖）→ **不抛**，把来源标成「不可用」，
 *         其余检索入口照常。理由同 `dsh-zhiyun-host-paper/src/index.js` 的注释：
 *         一条 bundle 抛错会让**整个工作台**起不来。
 *
 *   TODO-6 锁版核对：运行时比对 `UPSTREAM_VERSION` 与 `require('dsh-ai-library/package.json').version`，
 *         不一致时报警（不拦启动）。仓库 tag 是 `0.3.54`，**不是**核对基准。
 */

export const name = 'radar-paper-union';

/** 只硬依赖 `tools`（注册 model tool）。`llm` 若用于重排则走 `ctx.inject` 惰性取。 */
export const inject = ['tools'];

export async function apply() {
  throw new Error(
    'dsh-radar-paper-union 是候选骨架，未评审、不可挂载。' +
      '评审通过后请按 README 的 TODO 顺序实现（先 TODO-0/1/2 拍板，再写代码）。',
  );
}
