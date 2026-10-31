# dsh-radar-cc98-search-rank

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本包只有占位代码与 TODO，不参与构建、不参与打包、不进 `profiles/*`。

## 结论先行：这是「**强化式集成**」，不是「全新功能」

本仓**已经有** CC98 搜索（`packages/dsh-zhiyun-source-cc98/src/reads.js:175` 的 `search()`），
但它只做一件事：

```js
const rows = asList(await this.api.get('/topic/search', { query: { keyword: text, from, size } }))
const topics = rows.map(topicSummary)   // 服务端顺序原样透传
```

**CC98 官方搜索是按标题匹配的**，而且对连写中文的切分不可靠。所以「搜得到」和「搜得准」
之间缺了一整段：**本地排序 + 正文核对 + 命中片段**。上游 `cc98-searchpro@0.1.0` 的检索层
正好就是这一段，并且是**纯函数**。

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 改的还是 `source-cc98.search()` 这一个动作，不新增页面/侧栏入口 |
| ② 功能仍相似正交 | ✅ | 「按标题召回帖子」不变；变的只是召回后的排序与证据 |
| ③ 底层多调了更优质实现 | ✅ | 上游多做三件事：查询变体多路召回、首帖正文核对（`checked`）、命中片段（`snippet`） |

## 上游锁定坐标

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/Vita0818/CC98-SearchPro> |
| 版本 | **`0.1.0`**（写死，不用 `^`） |
| tag | `v0.1.0`（2026-10-23T07:38:32Z） |
| tarball | `releases/download/v0.1.0/cc98-searchpro-0.1.0.tgz`（335,626 B） |
| 许可证 | MIT（tarball 内 `package/LICENSE`） |
| 形态 | **非** DSH 原生插件（无 `cordis.patch.yml`、无 `dsh.client`），是 Codex 插件 + MCP server |

**⚠ npm 上没有这个包**（`registry.npmjs.org/cc98-searchpro` → `Not found`）。
`package.json` 里那条 `"cc98-searchpro": "0.1.0"` **装不上**，评审时须改为上面的 tarball URL
或 `github:Vita0818/CC98-SearchPro#v0.1.0`。这是骨架的已知缺陷。

## 只借哪两个模块

tarball 里 `dist/` 已经是编译产物，直接 ESM import 即可，不需要 `tsc`：

| 模块 | 导出 | 是否纯函数 |
| --- | --- | --- |
| `dist/search/rank.js` | `queryPlan` / `rank` / `compare` / `timestamp` / `SCORES` | ✅ 无 `fetch` / 无 `fs` / 无全局状态 |
| `dist/text.js` | `readableText` / `searchText` / `snippet` | ✅ 同上（`dist/ubb.js` 为纯解析器） |

**不要** import 它的入口 `runtime/server.mjs` —— 那是 esbuild 打包的 MCP stdio 服务，
会拉起子进程并带进 `@modelcontextprotocol/sdk@1.32.1` + `zod@4.6.5` 两棵依赖树。

## 上游做了什么（设计要点，非源码）

- **召回**：整串 + 中文分词 + 汉字二元切片，最多 4 路变体打 `/topic/search`；精确标题不足 3 条时
  用「相关标题高频二元组」补一次召回 —— 补召回的词**只用于召回，不算证据**。
- **排序**：`exact-title 1000 > exact-content 900 > all-words-title 700 > all-words-content 500 > weak 100`，
  同档按时间/阅读数/ID 定序。**正文命中不能把标题命中降级**。
- **核对**：按预算读取候选首帖（`quick 5 / balanced 12 / deep 24`），把 `verification` 从
  `not_checked` 推到 `checked`，并给出 220 字命中片段（±65 字上下文）。
- **只读**：不含发帖/回帖/私信/点赞。

## 为什么不能整包挂载

| 上游形态 | DSH 需要 | 结论 |
| --- | --- | --- |
| MCP stdio server（`runtime/server.mjs`） | 宿主内的 cordis 插件 | 不起子进程，只 import 纯函数 |
| 自带 `search_id` / `results` 两段式 + 15 min 快照缓存 | 本仓 `search()` 是单次 RPC | 缓存策略不照搬 |
| 首帖 UBB → 纯文本（`readableText`） | 本仓 r91 已实测「UBB 字面量原样透传」 | **可能产生字面量假阳性**，见下方 ⚠ |

## ⚠ 上线阻塞项

1. **依赖解析**：npm 无此包，须锁 tarball（见上）。
2. **UBB 字面量假阳性**：上游把首帖 UBB 投影成纯文本再匹配；若楼层里出现 `[b]粗体[/b]`
   这类字面量，投影后会当正文参与匹配。评审默认取「保守方案」：
   `contentType === 1`（已是 Markdown）的楼层才做正文核对，`contentType === 0` 只做标题分级。
3. **返回形状**：`{ keyword, topics, next_from, note }` 必须保持不变，新字段只增不改。
4. **二级来源声明**：上游自述 `queryVariants` / `refine` / `rank` 的评分层级源自其兄弟项目
   `cc98-search`，`ubb.ts` 源自 `cc98-desktop`。正式接入时须在仓根 `ATTRIBUTION.md` 补录。

## 边界

- 本包**不含任何上游代码**，只有坐标、形态记录与 TODO。
- 不写测试、不接 profile、不参与构建（`build.mjs` / `profile.mjs` 只认 `dsh-zhiyun-` 前缀）。
- 真正要改的是 `packages/dsh-zhiyun-source-cc98/src/reads.js` —— 那是**本仓包**的改动，
  不属于 radar 骨架。
