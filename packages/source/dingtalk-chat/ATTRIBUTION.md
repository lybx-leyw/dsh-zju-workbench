# 归属（Attribution）

本包 `@lybx-leyw/dsh-zju-source-dingtalk-chat` 不是从零写的。它是
[`dsh-zju-assistant`](https://github.com/Anchorite-no/dsh-zju-assistant) 的
`core/dingtalk/` **整目录移植**进本仓后的产物。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/Anchorite-no/dsh-zju-assistant |
| commit | `e59b81e1c254d979402f047c6fc8e43bf30b9713`（2026-11-05，`Prepare 0.1.8`） |
| 工作区包 | `dsh-zju-assistant-workspace` 0.1.8 |
| 本仓内的 vendored 路径 | `packages/vendor/zju-assistant/core/dingtalk/` |
| 上游 skill 自身的包名 | `dingtalk-skill` 0.1.0（`private: true`，从未发布） |
| 上游协议 | **GPL-3.0-only** |

上游 `packages/vendor/zju-assistant/package.json` 的 `license` 字段是
`GPL-3.0-only`，仓库根的 `LICENSE` 是 GPLv3 全文（第 3 版，2007-06-29）。
本包的 `license` 沿用 `GPL-3.0-only` —— **与本仓多数包的 `GPL-3.0-or-later`
不同**，这是刻意的：本包是实质性移植，不是「只参考了思路」，沿用上游声明最保守。

> ⚠️ **需要维护者裁决**：`docs/contributing/AGENTS.md`「第三方来源」一节写着
> 「GPL / AGPL 之类的传染性协议不得用于本项目」。这条与**已经存在的**
> `packages/vendor/zju-assistant/`（GPL-3.0-only，整仓 vendor 了很久）本来就冲突。
> 本包的处置是「如实标注来源与协议」，不替上游改协议，也不假装它是 MIT。
> 如果结论是「GPL 内容不能留在本仓」，那要处理的是整个 vendor 与它的移植，
> 不是这一个包。

## 覆盖度对账（上游 `core/dingtalk/` 逐文件）

上游该目录共 **16 个文件**（含 `package-lock.json`）。**没有一个被丢弃。**

| 上游文件 | 行数 | 本仓对应物 | 改动 |
| --- | --- | --- | --- |
| `SKILL.md` | 27 | `SKILL.md` | **改写**为贴合本仓的说明（加了 Node 24.16 提示、结果可信边界、隐私段）；`name` 由 `dingtalk` 改为 `dingtalk-chat`，`description` 重写并补「纯本机、不联网」 |
| `package.json` | 22 | `package.json` | **改写**：包名换成本仓命名、加 `dsh.capability` / `dsh.bundle` / `files` / `repository` / `license`；**`bin` / `engines` / `devDependencies` / `scripts` 原样保留** |
| `package-lock.json` | — | **不移植** | 它是上游 `dingtalk-skill` 自己的锁文件（只锁 `@types/node` + `typescript` + `undici-types`）。本仓是 workspace，锁文件由根统一管理，包内再放一份会与根冲突 |
| `tsconfig.json` | 23 | `tsconfig.json` | 原样 |
| `.gitignore` | 3 | `.gitignore` | 保留上游的 `node_modules/` `*.db*` `*.sqlite*`，**追加 `!lib/`** —— 根 `.gitignore` 的 `packages/*/*/lib/` 会把本包的手写源码当构建产物静默忽略 |
| `lib/chat.ts` | 321 | `lib/chat.ts` | 原样 |
| `lib/cli.ts` | 166 | `lib/cli.ts` | 原样 |
| `lib/content.ts` | 103 | `lib/content.ts` | 原样 |
| `lib/database.ts` | 370 | `lib/database.ts` | 原样 |
| `lib/errors.ts` | 12 | `lib/errors.ts` | 原样 |
| `lib/values.ts` | 123 | `lib/values.ts` | 原样 |
| `references/local.md` | 17 | `references/local.md` | 仅改第 3 行的一处**本机绝对路径**（见下） |
| `scripts/dingtalk.ts` | 10 | `scripts/dingtalk.ts` | 原样 |
| `scripts/dingtalk.mjs` | 48 | `scripts/dingtalk.mjs` | 原样 |
| `tests/chat.test.ts` | 161 | `tests/chat.test.ts` | 一条断言适配 Node 24.11 的 `ExperimentalWarning`（见下） |
| `tests/database.test.ts` | 356 | `tests/database.test.ts` | 14 条用例按 `serialize`/`deserialize` 能力**门控**（见下） |

## 导出一览（逐个列出，均有对应物）

上游 `lib/*.ts` 导出的每个符号都随文件原样进来了，因此**没有「本仓没有对应物」的导出**。

| 模块 | 导出 | 本仓对应物 |
| --- | --- | --- |
| `errors.ts` | `class SkillError`（`status` / `details` / `result()`） | 同名同形 |
| `values.ts` | `type Value` / `Row` / `JsonObject` / `Key`；`isObject`、`get`、`truthy`、`or`、`str`、`int`、`eqNum`、`toBig`、`casefold`、`contains`、`compare`、`compareKeys`、`strip`、`codePoints`、`parseJson`、`stringify`、`pythonJson` | 全部同名同形 |
| `content.ts` | `MESSAGE_TYPES`、`interface Attachment`、`interface Content`、`parseContent` | 全部同名同形 |
| `database.ts` | `interface Profile`、`interface Meta`、`macGlobalKey`、`userKey`、`v2UserKey`、`checksum`、`mergeWal`、`setReader`、`snapshot`、`setGlobalKeyProvider`、`macRoot`、`dataRoot`、`discover`、`selectProfile` | 全部同名同形 |
| `chat.ts` | `dateMs`、`iso`、`type Record`、`resolve`、`interface Query`、`interface Paging`、`class ChatReader` | 全部同名同形 |
| `cli.ts` | `interface Args`、`parseArgs`、`validate`、`run`、`main` | 全部同名同形 |

## 我们的改动（全部在上表已标出，此处给理由）

### 1. 两处测试适配 —— 不改实现，只让测试说真话

**`tests/chat.test.ts` 的 stderr 断言。** 上游断言 `result.stderr === ''`，本意是「本程序不往 stderr 写东西」。但 `node:sqlite` 在 Node 24.11 上仍在打：

```text
(node:19516) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

那是 **Node 自己**写的，不是本程序。直接断言空串会把宿主的行为算到我们头上，于是「代码没问题、Node 版本旧一点」时红掉 —— 错误的归因。改为先剔除 Node 自带告警行，再断言剩下的确实为空。**断言强度没有降低**：异常文本、SQL、聊天载荷仍然不许出现在 stderr。

**`tests/database.test.ts` 的 14 条门控。** `lib/database.ts` 的 `snapshot()` 依赖 `DatabaseSync.deserialize()`，而 `serialize` / `deserialize` **Node 24.16.0 才加入**（官方文档标注 `Added in: v24.16.0`）。本机 24.11.1 两者都不存在，14 条用例**一条也跑不了**。

处置：加一个 `NEEDS_IMAGE_API` 判据（探测方法是否存在，不比较版本号 —— 宿主可能以 Electron 的 Node 跑），缺能力时 `skip` 并写明原因。**一条都没删**；换成 24.16+ 会自动恢复执行。注意：**skip 不等于通过**，这 14 条从未在本机执行过。

### 2. `references/local.md` 的绝对路径

上游第 3 行原文写的是「同步自 `<开发机盘符>:\\Code\\Projects\\dingtalk-skill` 的 2026-10-16 工作区」。

那个 `<盘符>:\\Code\\Projects\\...` 是**开发机绝对路径**，按本仓「推送前检查」规则（`docs/contributing/AGENTS.md`）不应进入公开仓库。改为不含路径的等价表述，**技术事实一条没动**（同步日期、Python→Node 的改写历史、密钥校验策略都保留）。

### 3. `SKILL.md` 的 name

上游 `name: dingtalk`，本包改为 `dingtalk-chat`：与包名 `...-source-dingtalk-chat` 一致，也避免与将来可能出现的「钉钉企业 API」类 skill 撞名。**frontmatter 两个字段都在**，`description` 里明确写了「只读」「不联网」。

### 4. 没有移植的东西（明确丢弃）

**没有从 `core/dingtalk/` 丢弃任何文件。** 以下是**不在该目录范围内**、因此本来就不属于本包的东西：

| 上游位置 | 是什么 | 处置 |
| --- | --- | --- |
| `plugin/host/chat-watch.mjs` | 持续监控服务（定时检查、新消息进「校园事务」通知、`CHAT_PLUGINS` 映射、`DINGTALK_DATA_DIR` 注入） | **不属于 `core/dingtalk/`**，是上游插件层的功能。本仓没有对应插件层，未移植。`SKILL.md` 里相应段落已删（原文描述的「插件页持续监控」在本仓不存在，留着就是虚假声明） |
| `plugin/**` 的客户端设置页 | 聊天数据位置选择、监控间隔、AI 整理 | 同上，未移植 |
| `core/chat/` | 多平台共用层 | 不在 `core/dingtalk/` 内，未移植；本包的 `lib/` 自包含 |

`DINGTALK_CHAT_DISABLED=1` 这个开关**保留**了（`lib/cli.ts:149` 与 `scripts/dingtalk.mjs:12` 都认），因为它是 `core/dingtalk/` 自己的代码；只是本仓目前没有插件页去设置它。

## 第三方来源（上游注释里引用的）

上游 `lib/database.ts` 的头部注释把两个外部来源列为**格式依据**：

| 来源 | 用途 | 许可证 |
| --- | --- | --- |
| `bbs.kanxue.com/thread-287455.htm`（看雪，v3 密钥分析） | 钉钉 v3 全局库密钥格式 | **未核实** |
| `github.com/RedTeamExp/dingding` | 早期钉钉本地库分析 | **无许可证**（GitHub API 返回 `license: null` → 保留所有权利） |
| `sqlite.org/fileformat2.html#walformat` | SQLite WAL 格式 | 公有领域（SQLite 官方文档） |

**没有复制上述任何一个来源的代码。** 密钥派生规则（`MD5(uid)`、`PBKDF2(uid+salt, "666DingT")`、Mac 固定 CPUID 串）是上游自己写在 TS 里的；WAL 合并是按 SQLite 公开格式规范实现的。这里记录来源，是因为上游注释把它们当作**判断依据**，删掉会让后来者不知道这些常量为什么是这些值。

`RedTeamExp/dingding` 无许可证这一点需要特别注意：**不得**因为它出现在上游注释里就认为可以从中取代码。
