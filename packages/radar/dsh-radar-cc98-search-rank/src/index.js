/**
 * dsh-radar-cc98-search-rank —— 候选骨架（占位实现）。
 *
 * ⚠ 未评审 · 未接入 profile · 不可直接使用。
 *
 * 目标形态（**强化式集成**，不是新建一个搜索面板）：
 *
 *   本仓 `dsh-zhiyun-source-cc98/src/reads.js:175` 的 `search()` 目前是：
 *
 *     await this.api.get('/topic/search', { query: { keyword, from, size } })
 *     → rows.map(topicSummary)              // 原样透传服务端顺序
 *
 *   也就是说：**召回靠服务端，且不做任何本地排序**。而 CC98 官方搜索是**标题匹配**，
 *   连写中文（「考研经验」）会被服务端切错 —— 用户搜到的第一屏经常是 title 只沾一个字的帖子。
 *
 *   上游 `cc98-searchpro@0.1.0` 的检索层正好补这一段，且**全是纯函数**：
 *     queryPlan(keyword)           → { full, terms, variants[] }   // 整串 + 分词 + 二元切片，最多 4 路
 *     rank(topic, plan, body?)     → { tier, snippet, matched_terms, verification }
 *     compare(a, b, sort)          → 相关性 / 最新 / 阅读数
 *
 *   本包要做的只有三件事，全在**本仓包**里：
 *     1. 锁版引入上面两个模块（`src/upstream.js` 的 `UPSTREAM_MODULES`）；
 *     2. 在 `source-cc98` 的 `search()` 外加一层：同一份 `api`、同一份登录态，
 *        按 `plan.variants` 多打几次 `/topic/search`，合并去重后本地 `rank` + `compare`；
 *     3. 给每条结果附上 `tier` / `snippet` / `matched_terms`，**返回值形状保持向后兼容**
 *        （`{ keyword, topics, next_from, note }` 不变，新字段只增不改）。
 *
 * 三条判据在评审时的落点：
 *   ① 同一个面板 —— 仍是 `source-cc98.search()` 这一个动作，不新增页面、不新增侧栏入口
 *   ② 功能正交   —— 「按标题召回帖子」这件事不变，只是把「排序」从服务端顺序换成证据分级
 *   ③ 更优底层   — 上游多做了：查询变体（多路召回）、首帖正文核对（`checked`）、命中片段（`snippet`）
 *
 * ⚠ 与上游的一处**必须保留的差异**：上游会用 `searchText(readableText(...))` 把首帖 UBB
 *   投影成纯文本再匹配。本仓 r91 已实测「UBB 字面量会被原样透传」（见
 *   `dsh-radar-cc98-ubb-bridge` 的 TODO-7），所以若首帖里出现 `[b]粗体[/b]` 这类字面量，
 *   上游的投影会把它当正文参与匹配 → **可能召回纯靠字面量的假阳性**。
 *   评审时要么先接 UBB 桥的转义修复，要么在本兼容层里拒用 `readableText`、只对
 *   `contentType === 1`（已是 Markdown）的楼层做正文核对。**这一条未解决前不要上线。**
 */

import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION, UPSTREAM_MODULES } from './upstream.js'

export const name = 'radar-cc98-search-rank'

/**
 * 上游模块是纯函数，不需要 `ctx` 里的任何服务。若将来真的要在宿主侧包一层
 * 并在 `webServer` 上暴露调试路由，再补 `'webServer'`；现在**一个都不声明**，
 * 免得评审前就制造跨包耦合。
 */
export const inject = []

export function apply(ctx, config) {
  void ctx
  void config

  // TODO(评审 1): 依赖解析。npm 上没有 `cc98-searchpro`，`package.json` 里
  //   `"cc98-searchpro": "0.1.0"` **装不上**；须改为 release tarball URL
  //   （见 `src/upstream.js` 的 `UPSTREAM_DIST`）或 `github:...#v0.1.0`。
  ctx.logger?.warn?.(
    `[${name}] 候选骨架未实现：需先按 ${UPSTREAM_REPOSITORY} 的 v${UPSTREAM_VERSION} 产物锁版 ${UPSTREAM_PACKAGE}`,
  )

  // TODO(评审 2): 只 import 两个模块，**不要** import 上游入口
  //   `runtime/server.mjs` —— 那是 MCP stdio 服务，会拉起子进程并带进
  //   `@modelcontextprotocol/sdk` + `zod` 两棵依赖树。
  //      const { queryPlan, rank, compare } = await import(UPSTREAM_MODULES.rank)
  //      const { searchText } = await import(UPSTREAM_MODULES.text)
  //   两个模块都是 ESM 纯函数，Node 22 直接可用，不需要编译。

  // TODO(评审 3): 改的是**本仓包**，不是 radar 包
  //   `packages/dsh-zhiyun-source-cc98/src/reads.js` 的 `search()` 里：
  //     - `for (const v of plan.variants)` 调 `api.get('/topic/search', { keyword: v, ... })`
  //       → 与上游 `engine.ts` 不同：本仓**不要**加「每路变体各翻 1–3 页」的页数策略，
  //         现有 `size` 是调用方传的，翻页会破坏 `next_from` 的语义；
  //     - 合并去重按 topic id（服务端可能把同帖在不同变体里各返回一次）；
  //     - 排序交给 `compare(a, b, sort)`，`sort` 默认 `'relevance'`；
  //     - 首帖正文核对要**额外请求** `/Topic/{id}/post`（大写 T，别"顺手统一"成小写，
  //       CC98 会 404 —— 现有代码 `reads.js:203` 有同样的注释）。核对条数要有上限，
  //       并沿用本仓既有的请求节奏，不要照抄上游的 400 ms 串行间隔。

  // TODO(评审 4): 返回形状向后兼容。现有调用方（`src/index.js:107` 的默认参数表、
  //   `webServer` 的 `/api/zhiyun-cc98` 路由）只认 `{ keyword, topics, next_from, note }`。
  //   新字段一律**只增不改**：`topics[i].tier` / `.snippet` / `.matched_terms` / `.verification`。
  //   若某调用方对 `topics` 做严格结构校验，需同步（这是**本仓包**的改动，不属于本骨架）。

  // TODO(评审 5): UBB 字面量假阳性（见文件头 ⚠）。二选一：
  //   (a) 先接 `dsh-radar-cc98-ubb-bridge` 的 F-4 转义修复，再用上游 `readableText`；
  //   (b) 本兼容层只对 `contentType === 1` 走正文核对，`contentType === 0` 的楼层
  //       只做标题分级（`not_checked`）—— 保守但零假阳性。
  //   **评审默认取 (b)**，除非 (a) 已合入。

  // TODO(评审 6): 许可证与署名。上游 MIT（`LICENSE` 在 tarball 内），但它自己在
  //   `THIRD_PARTY_NOTICES.md` 里声明：`queryVariants` / `refine` / `rank` 的评分层级
  //   「来自本地兄弟项目 cc98-search」、「`ubb.ts` 来自 cc98-desktop」。
  //   引入后在 `ATTRIBUTION.md` 补：上游仓库 + tag + 上述二级来源声明原文。
  //   本骨架**未复制任何上游代码**，故当前无 ATTRIBUTION 需求。

  // TODO(评审 7): 上游的缓存与快照（`ttlMs` 15 分钟、最多 20 份、120 s 命中缓存）
  //   绑在 MCP 的 `search_id` / `results` 两段式协议上，**不要照搬**：
  //   本仓 `search()` 是单次 RPC，没有 `search_id`。若确实需要缓存，
  //   在本仓包内按 `keyword + sort` 做一个短 TTL 的 LRU，且**必须**按登录态失效。
}

/** 仅供占位：暴露锁定的上游坐标，评审时一眼能看到「锁的是谁、哪个版本」。 */
export const meta = {
  upstream: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  modules: UPSTREAM_MODULES,
}
