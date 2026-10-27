# dsh-radar-cc98-sdk —— 候选骨架

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
| 仓库 | [EviterLesRoses2/cc98-mcp](https://github.com/EviterLesRoses2/cc98-mcp) |
| 许可证 | **MIT** ✅（仓库根 `LICENSE` 1060 B 实文在库；`package.json` 亦写 `"license": "MIT"`） |
| 作者 | EviterLesRoses2 |
| Stars | ★4 |
| 创建 / 最近推送 | 2026-06-12 / **2026-06-12**（一次提交即成，此后未动） |
| 语言 | TypeScript（ESM），`tsc` 构建到 `dist/`，`engines.node >= 18` |
| 规模 | `src/` 共 6 个文件 ≈ **31 KB**（`index.ts` 11.8K / `webvpn.ts` 10.8K / `client.ts` 6.3K / `ubb.ts` 1.6K / `endpoints.ts` 1.5K） |
| 上游挂载形状 | **无** `dsh.bundle.patch`、无 `cordis.patch.yml`、无 `dsh.client` → **非 DSH 插件**，是 **stdio MCP server** |
| npm | **`cc98-mcp` 返回 404 —— 从未发布**（2026-10-18 核实）。⚠ 见下方第 1 条 |
| 运行时依赖 | `@modelcontextprotocol/sdk`、`zod`（均 MIT，无传递污染风险） |
| 对外工具 | 10 个，**全部只读**：`search_topics` / `get_posts` / `hot_topics` / `new_topics` / `list_boards` / `get_board_topics` / `get_user` / `get_image` / `download` / `status` |

## 类型与集成判定

- **类型**：**A · 原生 DSH 插件包**（按雷达口径：DSH 生态内的 Agent 工具/插件类项目，最高优先）
  　　　　⚠ 但上游**没有** `dsh.bundle.patch` —— 严格说它是 **MCP server**，不是 DSH 插件包。
  　　　　本包按 A 类模板出骨架（`dependencies` 锁版 + `src/upstream.js`），因为它是「可挂载的上游包」；
  　　　　若评审认为 MCP server 不算 A 类，**请直接改判 B 类**（那就该删 `dependencies` 与 `src/upstream.js`）。
- **集成方式**：**锁版引入 + 宿主侧服务化**（非 iframe 承载 —— 上游没有 UI）
- **与现有功能的关系**：**重复且可强化（存疑）** ⚠ —— 见下

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 | 结论 |
| --- | --- | --- |
| 仍是同一个面板 | 本骨架**不新增页面**，只注册宿主服务；但**本仓当前没有 CC98 面板**，只有在有消费方时这一条才成立 | ⚠ **条件成立** |
| 功能仍相似正交 | 与 `dsh-zhiyun-source-omni` 的 `cc98` 平台**几乎一一对应**（10 个读函数 vs 10 个工具） | ❌ **不满足「正交」** |
| 底层多调了更优质实现 | 唯一可核实的差异是 `cc98_get_image` 把**图片本体**返回给 AI；其余（WebVPN auto 降级）与 omni 已同形 | ⚠ **证据薄弱** |

> **本骨架自己的判定：按现行三条判据，本候选很可能应判 ⛔（重复且无增益）。**
> 之所以仍出骨架，是为了把「哪种重复算强化」这条**判据本身的分歧**摊到评审面前 ——
> 而不是因为本包「值得做」。**若评审不认「图片本体返回」是真实增益，请直接驳回并删除本目录。**

## 增强哪个现有功能（如果算强化的话）

`packages/dsh-zhiyun-source-omni` 的 `cc98` 平台（10 个读函数）。

| 本仓现状 | 上游补上的 | 是否「更优」 |
| --- | --- | --- |
| `cc98.hot` / `boards` / `boardTopics` / `topic` / `search` / `user` / `newTopics` / `notifications` / `messages` / `conversations` | 同名语义的 8 个工具（无 notifications/messages/conversations） | ❌ 同形，**无增益** |
| 返回结构化 JSON（含 UBB 原文 + 解析结果） | `cc98_get_posts` 把 UBB **清洗为纯文本**再给模型 | ⚠ 形态差异：纯净但**丢格式**；omni 保留 UBB 更利于渲染 |
| **无**「图片 → AI 可直接看」路径 | `cc98_get_image` 下载图片并**返回图片本体** | ✅ **可能是唯一真实增益** |
| WebVPN：`ZJU_NETWORK=auto`（先直连后走 WebVPN） | `CC98_WEBVPN_MODE=auto`（同一形状） | ❌ **无增益** |
| 写路径：两步确认的发帖/回帖 | 无（上游**故意只读**） | ❌ 上游缺此能力 |

## 接入边界（重要）

1. ⚠ **【首要待决】上游装不上。** npm `cc98-mcp` = 404。两条出路：
   - **(a) 改 git 依赖锁 commit**：`"cc98-mcp": "git+https://github.com/EviterLesRoses2/cc98-mcp.git#<sha>"`，
     `UPSTREAM_VERSION` 改写为 commit 短哈希。代价：需要 `prepare` 构建钩子（上游 `dist/` 未入库）。
   - **(b) 源码级移植**：只搬 `webvpn.ts` / `client.ts` / `ubb.ts` 三块（≈18 KB），
     保留版权与 MIT 声明，按 CONTRIBUTING 3.3 在包内写 `ATTRIBUTION.md`。
     **此时 `dependencies` 与 `src/upstream.js` 应删除**（本包退化为 B 类）。
   **未拍板前不得推进任何实现。**
2. ⚠ **「同一个面板」这一条目前无对象。** 本仓**没有** CC98 页面（`packages/dsh-zhiyun-page-*` 五页里没有论坛页）。
   若最终没有消费方，本包就是一个没人调用的服务 —— 应驳回。
   **若要做，先回答「论坛读数出现在哪一页」**，再回来看本包。
3. **同源第二条实现**：`Lucent-Snow/CC98-CLI`（MIT ★18，TS）是同域的 CLI/TUI 客户端，
   上游 `README` 明写其端点与 WebVPN 实现**参考了它**。**只取一条即可**，取哪条须写明理由。
4. **只读边界**：上游 10 个工具全只读，**保持只读**。不要在它之上补写能力 ——
   omni 已有两步确认的写路径，再造一个写入口是风险。
5. **下载落点**：`cc98_download` 默认写 `~/Downloads/cc98`，与本仓「数据落 profile 数据目录」不符，
   须改写到 profile 数据目录且**用户显式触发**。
6. **凭据**：四个环境变量**不得**落文件，须走本仓 `dsh-zhiyun-source-omni/src/core/keychain.ts` 的凭据库。
7. **不接入 profile。** 绝不写入 `profiles/zhiyun-bench/package.json`。

## 下一步

见 `src/index.js` 头部的 `TODO` 清单。**第 1 条（可安装性）与第 2 条（与 omni 划界）
未拍板前，不得推进任何实现。**

---

## 归属

- 本包由 `dsh-ecosystem-radar` 自动生成，`Owner: shared`（见 `OWNERS`）。
- 上游代码版权归 [EviterLesRoses2](https://github.com/EviterLesRoses2) 所有，许可证 **MIT**。
- 本包**未搬运上游源码**，仅声明锁版依赖。
