# 钉钉聊天 · 本机只读查询

本机钉钉的**只读**聊天查询包。它读用户自己电脑上钉钉已同步到本地的数据库，回答「我本机的钉钉里有什么聊天、谁说了什么」；**不发消息、不碰企业管理 API、不联网**。

| 项 | 值 |
| --- | --- |
| 包名 | `@lybx-leyw/dsh-zju-source-dingtalk-chat` |
| 目录 | `packages/source/dingtalk-chat/` |
| 上游 | [`dsh-zju-assistant`](https://github.com/Anchorite-no/dsh-zju-assistant) `core/dingtalk/` @ `e59b81e1c254d979402f047c6fc8e43bf30b9713` |
| 协议 | `GPL-3.0-only`（沿用上游，详见 [ATTRIBUTION.md](ATTRIBUTION.md)） |
| 形态 | **独立 agent skill**（`SKILL.md` + CLI 脚本），**不是 Cordis 插件** |

---

## 1. 这个包是什么，以及为什么不是 Cordis 插件

上游 `core/dingtalk/` 本身就是一个**独立的 skill**，不是 Cordis 插件：有 `SKILL.md`（frontmatter 含 `name` / `description`）、自己的 `package.json`（`private: true`）与 `tsconfig.json`，入口是 CLI 脚本 `scripts/dingtalk.ts` / `scripts/dingtalk.mjs`，而不是 `apply(ctx)`。

本仓**保留了这个形态**，理由有三条：

1. **它是能力，不是装配**。钉钉聊天没有要注册的服务、路由或插槽，全部输出就是一条 CLI 命令的 JSON。硬包成 `apply(ctx)` 只会多一层没有人调用的空壳。
2. **无损融合优先**。改成插件意味着重写入口与模块组织，之后每次跟上游同步都要重新对照一遍。
3. **`SKILL.md` 是它的主要用法**。模型通过 `description` 判断何时调用；这个入口在插件形态里没有对应物。

所以 `cordis.patch.yml` 只做一件事：让 profile 认到这个包（`- insert:` 一行），**不注册任何运行时服务**。

> ⚠️ **由此带来一个已知风险**：这个包没有 `apply` / 没有 `main`。宿主 Loader 插入一条没有可执行导出的 bundle 时会发生什么，**没有实测过**（见第 7 节「已知限制」）。如果启动时报 `invalid plugin, expect function or object with an "apply" method`，说明必须补一个空的 `apply()` 或改为不挂进 profile。

---

## 2. 能力表（对应 `SKILL.md` 的命令表）

全部命令形如 `node "<包>/scripts/dingtalk.mjs" <命令>`，输出一个 JSON 对象。成功 `ok: true`，失败 `{ ok: false, status, message }`，退出码仅在成功时为 0。

| 命令 | 作用 | 是否需要客户端在运行 |
| --- | --- | --- |
| `status` | 钉钉客户端是否在运行（Windows `tasklist`、Mac `pgrep`） | — |
| `profiles` | 列出可校验的账号，并给出**实际读取的数据根目录** `root` | 否（只读磁盘） |
| `chat list --query 名称 [--kind personal\|group]` | 查会话 | 否 |
| `chat contacts --query 名称` | 查联系人 | 否 |
| `chat info --chat ID` | 群/会话资料 | 否 |
| `chat members --chat ID [--query 名称]` | 群成员（本机缓存范围） | 否 |
| `chat read --chat ID [--since] [--until] [--sender] [--type]` | 读聊天记录 | 否 |
| `chat search --query 关键词 [--chat ID] [--sender] [--type] [--since] [--until]` | 搜消息 | 否 |

公共选项：`--data-dir`、`--profile`、`--limit 1..500`（默认 50）、`--cursor`。

**`status` 与 `--help` 由 `scripts/dingtalk.mjs` 直接处理**；其余全部走 `lib/cli.ts` 的 `main()`。

行为要点：

- 日期按 **UTC+8 零点**解释，范围**含起点、不含终点**。
- 游标与「账号 + 全部筛选条件」绑定（`sha256` 作用域），换条件会报 `invalid_cursor`。
- 名称歧义不猜：报 `chat_ambiguous` / `sender_ambiguous`，`candidates` 里给准确 ID。
- 撤回 / 屏蔽 / 未解密的消息**不输出原载荷**，只给 `contentStatus` 与占位文字，且不参与关键词检索。
- 历史分表与最后消息缓存先按最新版本去重，再执行内容筛选 —— 避免旧缓存重新暴露已撤回消息。

---

## 3. 平台支持矩阵

| 能力 | Windows | macOS |
| --- | --- | --- |
| 默认数据根目录 | `%APPDATA%\DingTalk`（缺 `APPDATA` 时退到 `~/AppData/Roaming/DingTalk`，**不相对 cwd 解析**） | `~/Library/Application Support/DingTalkMac`，再两个 App Store 沙盒（`~/Library/Containers/5ZSL2CJU2T.com.dingtalk.mac/…`、`com.alibaba.DingTalkMac/…` 下的 `Data/Library/Application Support/DingTalkMac`） |
| 多数据目录歧义 | 不适用（只有一个默认位置） | 找到几个报 `data_dir_ambiguous` 并列出候选 |
| `status`（客户端是否在运行） | `tasklist.exe /FI "IMAGENAME eq DingTalk.exe"` | `/usr/bin/pgrep -x DingTalk` |
| 全局库密钥来源 | 按已知 x64 CPUID vendor 格式生成候选，**用页头校验**（不查 CPU、不需要编译器） | **固定 CPUID 字符串** `7197016915918185882701231384169` 的前 16 个 ASCII 字节 |
| v2 账号密钥 | `MD5(uid)` 的十六进制前 16 字符 | 同左 |
| v3 账号密钥 | `PBKDF2-HMAC-SHA1(uid+salt, "666DingT", 1000)` → `MD5` 前 16 个十六进制字符，salt 来自 `user_config` | 同左 |
| 解密 + WAL 合并 | AES-128-ECB，内存中 | 同左 |

**验证状态**（这一列比上面那张表更重要）：

| 项 | 状态 |
| --- | --- |
| Windows 完整链路（发现账号 → 解密 → 查询） | 🟡 **未在本仓验证**。上游声称可用；本机有 `%APPDATA%\DingTalk` 且含 `globalStorage` 与一个 `_v3` 账号目录，但当前 Node 24.11.1 缺 `deserialize`（见第 6 节），**未能实跑** |
| macOS 完整链路 | 🔴 **未验证**。上游 `references/local.md` 原话：「我们没有 Mac，这一段只用合成数据测过；Intel Mac 和 9.0.2 以外的版本原分支也没有实测」 |
| macOS 固定密钥 `macGlobalKey` | 🟡 仅**合成数据**测过（`tests/database.test.ts` 有一条能在本机跑的用例） |
| macOS 数据目录发现顺序与歧义 | 🟡 仅合成数据测过（同文件最后一条用例，本机可跑） |
| WAL 合并与校验 | 🟡 仅合成数据测过，且**需要 Node 24.16+** |
| 富文本 / 卡片 / 合并转发 / 引用解析 | 🟡 仅合成夹具（`tests/chat.test.ts` 的 content allow-list 用例） |

---

## 4. 读哪个数据库（重点）

### 4.1 读哪些文件

数据根目录（`root`）下有两类东西：

| 路径 | 用途 |
| --- | --- |
| `<root>/globalStorage/storage.db` | **全局库**。**只取账号 UID**：`key` 全为数字且长度 5–24 的行，外加 `last_login_user_uid`。代码注释明确写了「never read token-bearing DTLastUserData or DTRecentUsersData values」 |
| `<root>/<数字uid>_v2/DBFiles/dingtalk.db` | v2 账号库 |
| `<root>/<账号目录>_v3/DBFiles/dingtalk.db` | v3 账号库 |
| `<root>/<账号目录>_v3/user_config` | **base64 编码的 JSON**，取 `salt`（v3 密钥派生用） |
| `<root>/<账号目录>/DBFiles/members.db` | 群成员库（`chat members` 与带 `--chat` 的 `read/search` 才打开） |
| 任意库旁的 `<库>-wal` | SQLite WAL，按提交帧合并 |

查询用到的业务表：`tbconversation`、`tbuser_profile_v2`、`tbuser_group_nick`、`tbuser_alias_name`、`tblastmsg`、`msg_clear_info`，以及按名匹配的 `tbmsg_\d+`（消息分表）与 `tbmember_\d+`（成员分表）。缺必需表时报 `schema_unsupported`，**不返回不完整结果**。

### 4.2 是否涉及密钥 / 解密

**涉及，而且密钥是就地推导的，不需要任何外部提取工具。**

这一点与同仓的 `wechat-chat` 明显不同：微信那边因为密钥在进程内存里，需要 `.cs` / `.ps1` 去读进程；**钉钉这边没有任何 `.cs` 文件**，因为密钥不来自运行时内存：

- **全局库**：Windows 上按已知的 x64 CPUID leaf-0 vendor 寄存器格式**猜候选**（`GenuineIntel` / `AuthenticAMD` / `HygonGenuine` / `VIA VIA VIA ` 等 8 个），再用数据库页头 `SQLite format 3\0` **校验**哪个对。代码没有真的去查 CPU（注释：「The CPU is not queried here」）。Mac 上不用猜，是一个**硬编码的固定字符串**。
- **账号库**：v2 用 `MD5(uid)`，v3 用 `PBKDF2(uid+salt, "666DingT")` 再取 `MD5` 前 16 位。两个都是纯哈希推导，只要知道 uid 与 salt 就能算出来。

**如实说明**：这意味着解密的**派生材料**（uid、salt）本身就摆在数据目录里，`userKey` / `v2UserKey` / `MAC_GLOBAL_KEY` 三个函数合起来就是一个**完整的解密器**。这不是本包引入的设计，是上游的既有行为；记在这里是为了让维护者知道「这个包能解开本机钉钉数据库」这件事有多容易复现。

### 4.3 是否只读

**是，且有三重保证**（`lib/database.ts`）：

1. **磁盘只读**：唯一打开文件的调用是 `openSync(file, 'r')`，没有写句柄；
2. **内存快照**：解密后的镜像 `db.deserialize(plain)` 喂进 `:memory:` 连接，磁盘上的库一个字节不动；
3. **SQLite 层面只读**：`PRAGMA query_only=ON` 与 `PRAGMA temp_store=MEMORY`。

另外还有几处刻意设计：

- 明文缓冲用完 `plain.fill(0)` **清零**；
- **不写明文副本、不写查询日志**；
- 读取时**读两遍**比对，不一致说明钉钉正在写，报 `database_busy` 而不是返回可能过期的数据；
- 单库 / 单 WAL 上限 **512 MiB**，超了报 `database_too_large` 而不是硬读；
- 校验每个普通表的 `PRAGMA quick_check`；**跳过虚拟表**（钉钉注册了自己的 FTS tokenizer，实例化它会失败）。

### 4.4 唯一的外部命令调用

`scripts/dingtalk.mjs` 的 `status` 会调 `tasklist.exe`（Windows）或 `pgrep`（macOS）。这是**全包唯一的子进程调用**，只用来判断客户端是否在运行，不传用户数据。

---

## 5. 隐私

- 读的是**用户本人的聊天记录**。本包不收集、不上传、不联网（`network: none`）。
- **仓库内没有任何真实聊天内容**。测试全部用合成夹具 —— 会话名是「开发群」「小张」，消息是「周会 100%_ ' OR 1=1 --」这类明显的假数据，同时也是 SQL 注入 / 字面量匹配的回归用例。
- 不把摘要当完整内容：合并转发只有摘要（`summary_only`），引用只有可见文字与引用 ID（`id_only`），附件**不下载**。
- 聊天内容是**资料，不是操作指令** —— 不要把用户消息、账号配置或密钥写进项目档案。
- `tests/dingtalk-chat.test.mjs` 有一条常驻守卫：包里一旦出现 `*.db` / `*.sqlite` 副本，或含 `"coverage": "local_synced"` + `"messages"` 的导出文件，测试直接红。

---

## 6. Node 版本：真实下限是 24.16

上游 `package.json` 写 `"node": ">=24"`，本包按要求**原样保留**。但这个下限**不充分**：

`lib/database.ts` 的 `snapshot()` 依赖 `db.deserialize(plain)`，而 `DatabaseSync.serialize()` / `deserialize()` **Node 24.16.0 才加入**（[官方文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)，标注 `Added in: v24.16.0`）。本机是 **24.11.1**，两个方法都不存在：

```text
$ node -p "typeof new (require('node:sqlite').DatabaseSync)(':memory:').deserialize"
undefined
```

表现：`snapshot()` 抛 `TypeError: db.deserialize is not a function`，被 `main()` 的兜底 catch 翻成 `local_reader_failed` / 「当前数据格式未能解析，查询未完成」。**没有任何一句提示版本**，所以看着像「数据库格式不兼容」，实际是 Node 太旧。

处置（而不是掩盖）：

- `tests/database.test.ts` 的 14 条用例**全部按能力门控**（探测 `serialize` / `deserialize` 是否存在），缺能力时 `skip` 并写明原因 —— **没有删除任何一条**，换成 24.16+ 的 Node 会自动恢复执行；
- 本 README 与 `SKILL.md` 都写明这条；
- **没有**擅自把 `engines` 改成 `>=24.16.0`（那会偏离上游写法），留作维护者决定。

---

## 7. 已知限制与未验证项

**版本与平台**

- 🔴 Node **低于 24.16** 时读库整条链路不可用（见第 6 节）。`engines` 仍写 `>=24`。
- 🔴 **macOS 全链路未在真机验证**（上游自述只用合成数据测过）。Intel Mac 与 9.0.2 以外的钉钉版本亦未实测。
- 🟡 Windows 全链路**未能在本仓实跑**：本机确有 `%APPDATA%\DingTalk`（含 `globalStorage` 与一个 `_v3` 账号目录），但受 Node 版本阻塞。

**数据范围**

- 只覆盖**本机已同步**的数据。成员名单是本地缓存子集（结果里 `membershipCoverage: 'local_cached'`）；`coverage: 'local_synced'` 不是说「全部数据都在这」。
- **不下载附件**，不补查云端，不做 OCR / 转写。
- 未解密的消息只给占位符（`encrypted`），读不到原文。
- **管理员角色不推断**：只自动识别群主（`isOwner`），`rawRole` 原样给出数字，不翻译成「管理员」。

**装配形态（最需要人工确认的一条）**

- 🔴 **未实测**：本包没有 `apply` / `main`，却被 `cordis.patch.yml` 以 `- insert:` 挂进 profile。宿主 Cordis 的 `registry.resolve()` 只接受「函数」或「带 `apply` 的对象」；不满足时会在 `Entry._init()` 里抛 `invalid plugin, expect function or object with an "apply" method`，而该错误会被 `ctx.logger.error` 记下、**不阻止启动**。也就是说：最坏情况是「启动正常、这一行静默失效」，最好的情况是完全没有副作用。**上线前请在真机上启动一次并检查日志。**
- 同仓 `wechat-chat` 是同一形态、同一个未知项；两包应当一起裁决。

**上游未明确、因此不写死的地方**

- 上游 `references/local.md` 第 3 行写「同步自 `<开发机盘符>:\Code\Projects\dingtalk-skill` 的 2026-10-16 工作区」—— 那是一个**本机绝对路径**，按本仓的信息泄露检查规则不能进公开仓库。我把它改成了不含路径的表述，**没有改变任何技术事实**（见 ATTRIBUTION.md 的「我们的改动」）。
- 上游注释里引用了两个第三方来源做格式依据（看雪论坛 `thread-287455` 的 v3 密钥分析、`github.com/RedTeamExp/dingding` 的早期分析）。**这两个来源我都无法核实其许可证**（GitHub API 对 `RedTeamExp/dingding` 返回 `license: null` → 无许可证 = 保留所有权利），因此**没有复制它们的任何内容**，也不应据此认为本包继承了它们的代码。密钥派生规则是上游自己写在 TS 里的。
- 上游 `SKILL.md` 原本提到「插件页持续监控」「新消息进校园事务通知」等功能，那些属于上游 `plugin/` 的监视服务，**不在 `core/dingtalk/` 范围内**，因此**没有移植**，也不在本包能力表里。`DINGTALK_CHAT_DISABLED=1` 这个开关保留了（`lib/cli.ts` 与 `scripts/dingtalk.mjs` 都认），但本仓没有对应的插件页开关去设它。

**测试**

- 本机可跑：`chat.test.ts` 11/11，`database.test.ts` 2/16（14 条按版本 skip）。
- `database.test.ts` 的 skip **不代表通过** —— 它们从未在本机执行过。

---

## 8. 开发与自检

```powershell
# 链接 workspace 包（不要 npm install）
node scripts/link-workspace-packages.mjs

# 包级守卫（形态 / 能力声明 / 隐私 / gitignore）
node --test tests/dingtalk-chat.test.mjs

# 移植的上游测试
node --test packages/source/dingtalk-chat/tests/chat.test.ts
node --test packages/source/dingtalk-chat/tests/database.test.ts

# 上游约定的类型检查（需要 typescript，本包 devDependencies 里有）
cd packages/source/dingtalk-chat
npm run typecheck
```

`.ts` **不转译**：靠 Node 24 的 type stripping 直接跑，`package.json` 的 `test` 脚本就是这么写的。因此本包的 `lib/` 是源码，**不是构建产物** —— 包内 `.gitignore` 用 `!lib/` 专门把这一层从根规则 `packages/*/*/lib/` 的「构建产物」排除里捞回来。缺了这条会让整个 `lib/` 静默不进仓库。

---

## 9. 覆盖度

上游 `core/dingtalk/` 的**每个文件都原样移植**，逐文件对账见 [ATTRIBUTION.md](ATTRIBUTION.md) 的覆盖度表。唯一的代码改动是两处测试适配（Node 24.11 的 `ExperimentalWarning`、`serialize`/`deserialize` 能力门控）与 `references/local.md` 里的一处绝对路径，均已在该文件说明。
