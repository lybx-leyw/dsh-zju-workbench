/**
 * dsh-radar-mneme —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 占位文件：只标注适配点与 TODO，不写业务逻辑，不 import 上游本身
 * （`@modusensus/dsh-mneme`），只从 `./upstream.js` 取锁版凭据。
 * `apply()` 直接抛错 —— 万一有人误挂，**立刻响**，而不是静默变成一个空壳。
 *
 * ── 想做什么（强化式集成，不是新建功能）───────────────────────────
 *
 * 「我的」页现在有一块记忆台账（`packages/radar/dsh-radar-me-memory`，
 * 锁版 `dsh-auto-memory@0.9.0`），语义是「这个学生做过什么、学到哪」的**只读流水**。
 * 学生真正要的是**下学期还能被叫出来**：半年前在哪个章节推过同一个公式、
 *
 * 「我的」页那句话，复习时到底该怎么答。
 *
 * 这件事的三个难点（都不是本项目要自己重写的）：
 *
 *   1. **中文召回**：`LIKE '%词%'` 对「rust 异步 tokio」这种散词组合几乎全丢；
 *      BM25 的默认空格分词对中文等于没有。上游用 **ASCII 原样 + CJK 滑窗 bigram** 解决
 *      （`dsh-mneme/src/search/bm25.js`，K1=1.5 / b=0.75，IDF 归一化到 [0,1] 以便与向量分合流）。
 *   2. **召回阈值**：固定 `0.65` 对「entity:/attr:」查询过严、对 4 字查询过松。
 *      上游给了查询自适应的 `adaptiveThreshold()`（短查询收紧到 0.7、长查询放宽到 0.6、
 *      head-gap > 0.3 时放宽到 0.5），是纯函数、可单独裁决。
 *   3. **实体轴**：把「同一个老师 / 同一门课 / 同一个概念」当成一条召回边，
 *      上游有 `findEntitiesMentionedIn` + `idx_relations_memory`。
 *
 * 接入后的形态：
 *
 *   - 面板还是「我的」页那块台账（**不新增页面、不新增导航项**）；
 *   - 功能还是「把过去的记录找回」，只是从「字面子串」变成「词法 + 实体 + 语义」；
 *   - 底层换成了更优实现（三路召回融合 + 自适应阈值 + 本地 512 维 embedding，正文不外发）。
 *
 * 三条同时成立 ⇒ 「重复且可强化」，**不是**「重复且无增益」。
 *
 * ── 为什么 `apply()` 抛错 ────────────────────────────────────────────
 *
 * 上游对缺失的 peer 服务是**静默不注册**（不是抛错）。如果再叠一层「本包也不报错」，
 * 评审就永远看不到「工具面少了 10 个」这件事。⇒ 宁可让 bundle 起不来。
 *
 * ── TODO（全部是评审要先拍板的，不是「怎么写代码」）──────────────────
 *
 *   TODO-0【阻塞】`dsh-better-sidebar` 这个硬依赖要不要接受？
 *         上游 `dsh.client.inject = ["slots","locale"]`，`sidebar.right.pane.tab` 槽
 *         由 better-sidebar 提供。本仓 `packages/` 下**没有任何包**声明它。
 *         - 接受 → 先登记 `omdsh-dev/DSH-better-sidebar`（registry 里判 🔵 同层替换），
 *                  再评估「为一个记忆面板引入整套右栏底座」的成本；
 *         - 不接受 → 只能退到 `conversation.session.header.actions` 单槽，削弱功能一半。
 *   TODO-1【阻塞】体积 7.4 MiB / 396 文件进 workspace 是否可接受？
 *         本仓 `node_modules` 已很大；且上游 `@huggingface/transformers` + `onnxruntime-node`
 *         + `sharp` 的本地推理闭包实测约 393 MB（上游 README 自述），未随 npm 包分发但
 *         首次启用本地嵌入时会下载。
 *   TODO-2【阻塞】**不得与本包 patch 同挂**：上游自带 `cordis.patch.yml`，
 *         若 profile 同时列上游与 `dsh-radar-mneme`，`insert` 会重复 → 面板双份。
 *         需在 `apply()` 里检测 `ctx.registry.has('dsh-mneme')` 后走「只加薄壳」路径。
 *   TODO-3 把 `UPSTREAM_TOOLS` 从 README 声明换成**实取**（解包后 dump `ctx.tools` 名单），
 *         确认 10 个名的真实拼写；`READ ONLY` 的那几个（`memory_search`/`memory_list`）
 *         才允许暴露给「我的」页，写类工具（`memory_save`/`memory_forget`）须二次确认。
 *   TODO-4 记忆里可能有个人隐私（作息、成绩、健康）。上游有「敏感度」字段，但
 *         **本仓的台账展示必须默认按敏感度过滤**，且不得写进 `docs/` 或任何导出物。
 *   TODO-5 存储路径默认 `~/.dsh/memory`，与本仓「所有数据在学生自己的机器上、可删」的
 *         承诺一致 —— 但在 `我的` 页要给一个**一键清空 + 导出**入口，否则等于把学生数据
 *         锁进一个看不见的 SQLite。
 *   TODO-6 许可证：MIT ✅，可集成。但上游 README 注明「Node 24+（`node:sqlite`）」，
 *         宿主 runtime 版本须先核对（`runtime.lock.json`），不满足则**整包直接不可用**。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  REQUIRED_SERVICES,
  REQUIRED_SLOT_KEYS,
  UPSTREAM_TOOLS,
} from './upstream.js';

export const name = 'radar-mneme';

/**
 * 上游需要的宿主服务。**声明在这里**，让 cordis 等它们就绪后再激活本包 ——
 * 否则本包会在服务注册之前执行（loader 用 `Promise.allSettled` 并发激活），
 * `ctx.get('@deepseek-ai/dsh-tools')` 拿到 `undefined`。
 */
export const inject = REQUIRED_SERVICES;

/**
 * @param {import('@deepseek-ai/cordis').Context} _ctx
 */
export function apply(_ctx) {
  throw new Error(
    'dsh-radar-mneme 是候选骨架（未评审、未接入 profile、不可直接使用）：'
      + '请先裁决 TODO-0（是否接受 dsh-better-sidebar 底座）与 TODO-1（7.4 MiB + 393 MB 推理闭包）。'
      + `上游 = ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}，需 ${REQUIRED_SLOT_KEYS.length} 个宿主槽位、`
      + `将注册 ${UPSTREAM_TOOLS.length} 个工具。`,
  );
}
