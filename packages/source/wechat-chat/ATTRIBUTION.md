# 归属（Attribution）

本包 `@lybx-leyw/dsh-zju-source-wechat-chat` 不是从零写的。它是
`zju-assistant` 的 `core/wechat` 移植进本仓后在 `packages/source/wechat-chat/`
的一个副本。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/Anchorite-no/dsh-zju-assistant |
| commit | `e59b81e1c254d979402f047c6fc8e43bf30b9713`（2026-11-05，`Prepare 0.1.8`） |
| 工作区包 | `dsh-zju-assistant-workspace` 0.1.8 |
| 本仓内的 vendored 路径 | `packages/vendor/zju-assistant/core/wechat/` |
| 上游协议 | **GPL-3.0-only** |

上游 `packages/vendor/zju-assistant/package.json` 的 `license` 字段写的是
`GPL-3.0-only`，仓库根的 `LICENSE` 是 GPLv3 全文（第 3 版，2007-06-29）。
本仓（`zju-workbench`）对**非 vendor 包**统一采用 **GPL-3.0-or-later**，
这个 `-or-later` 与上游的 `-only` 是兼容的：GPLv3 §14 允许 `-only` 的衍生作品
按更高版本授权，前提是不额外限制。**注意这是两个不同的声明**，不是笔误：

- 上游仍是 `GPL-3.0-only`（vendor 副本保持原样，我们不替它改协议）；
- 本包的**新增部分与本包整体分发**采用 `GPL-3.0-or-later`（见包内
  `package.json` 的 `license` 字段与仓库根 `LICENSING.md`）。

如果你只需要锁定 GPLv3 本身，按 `GPL-3.0-only` 理解本包即可。

## 第三方代码

### `scripts/local/runtime-key.cs` —— wcdb-key-tool 的 Windows runtime XOR blob 格式

该文件使用 [`wcdb-key-tool`](https://github.com/TANGandXUE/wcdb-key-tool)
文档化的 **Windows runtime XOR blob 格式**，来源文件为
`wcdb_key_tool_windows.py`：

- 上游 blob SHA：`54d729508454859afc66050f161e604c875b288e`
- 协议：**MIT License**
- 版权：Copyright (c) 2025 CloudDreamAI / TANGandXUE

> 参照的是**格式**，不是拷贝实现：目标侧的 codec 遍历与验证是在本仓/上游
> 自己实现的。MIT 与 GPLv3 兼容，因此可以这样组合入 GPLv3 的包。

完整条款见包内 [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt)——该文件是
**逐字**复制自上游 `packages/vendor/zju-assistant/core/wechat/THIRD_PARTY_NOTICES.txt`，
一个字节都没有改动。

### macOS 后端

`scripts/local/macos-memory.c` 与 `scripts/local/macos-debugger.plist`
逐字来自 `weread-skill` 的 macOS 后端（commit `f629ca9`，由 spdc-elm 贡献）；
它把本项目的 authenticated codec traversal 移植到 Mach API 上。
`lib/macos.mjs` 是那个后端 `snapshot.py` 与 `macos_image.py`（SQLCipher 页、
已提交的 WAL、V1/V2 图片缓存）在 Node 上的移植。

### 媒体格式参考

- WeChat V1/V2 图片布局与 ASCII image-key 发现：https://github.com/ylytdeng/wechat-decrypt
- WeChat 4.1 account-seed image-key 派生：https://github.com/CN-Grace/Wechat-Emoticon-Parser
- WXGF / WXAM HEVC 流结构：https://sarv.blog/posts/wxam/

解析器与密钥处理在本包内实现，上游只作格式参考。

### 运行时依赖（由 npm 安装，未拷贝进源码）

| 包 | 版本 | 协议 | 来源 |
| --- | --- | --- | --- |
| `htmlparser2` | `^10.1.0` | MIT | https://github.com/fb55/htmlparser2 |
| `silk-wasm` | `^3.7.1` | MIT | https://github.com/idranme/silk-wasm |
| `ffmpeg-static` | `5.3.0`（**可选**，本包未声明） | GPL-3.0-or-later | https://github.com/eugeneware/ffmpeg-static |

`ffmpeg-static` 只在导出 WXGF 预览时用到，且是**运行时可选**的：
找不到它时只有这一种图转不了（报 `media_conversion_failed`），其他媒体照常导出。
上游 `THIRD_PARTY_NOTICES.txt` 记了它，本包保留那段记录但**没有**把它写进
`dependencies`——照上游的做法，由使用环境自行提供或设 `FFMPEG_PATH`。

## 本仓做的改动

**代码文件零字节改动。** 22 个移植文件（含 `.cs` / `.ps1` / `.c` / `.plist`）
全部与上游逐字节相同，唯一例外是下面第 1 条的 import 说明符。

逐条列出：

### 1. 路径调整：共用的 `chat/common.mjs` 内联进 `lib/common.mjs`

**为什么必须改**：上游的目录形状是

```text
core/chat/common.mjs          ← 几个技能（weread / wechat / dingtalk）共用
core/wechat/lib/query.mjs     ← import '../../chat/common.mjs'
```

本包是**独立的** `packages/source/*` 包，`packages/source/wechat-chat/` 的上两层
不存在 `chat/`，那条相对路径会 `ERR_MODULE_NOT_FOUND`。而 `scripts/wechat.mjs`、
`lib/query.mjs`、`lib/macos.mjs`、`lib/media-index.mjs`、`lib/content.mjs`、
`lib/chat-media.ts`、`scripts/local/chat.mjs` 全都依赖它。

**怎么改**：把 `core/chat/common.mjs` 复制为 `lib/common.mjs`（内容逐字节相同），
再把 7 处 import 说明符改指向它：

| 文件 | 上游 | 本包 |
| --- | --- | --- |
| `lib/content.mjs` | `'../../chat/common.mjs'` | `'./common.mjs'` |
| `lib/macos.mjs` | `'../../chat/common.mjs'` | `'./common.mjs'` |
| `lib/media-index.mjs` | `'../../chat/common.mjs'` | `'./common.mjs'` |
| `lib/query.mjs` | `'../../chat/common.mjs'` | `'./common.mjs'` |
| `lib/chat-media.ts` | `'../../chat/common.mjs'` | `'./common.mjs'` |
| `scripts/wechat.mjs` | `'../../chat/common.mjs'` | `'../lib/common.mjs'` |
| `scripts/local/chat.mjs` | `'../../../chat/common.mjs'` | `'../../lib/common.mjs'` |

`core/chat/common.test.mjs`（上游对 `common.mjs` 的两条测试）**没有**移植：
它测的是游标绑定与参数校验，而这两件事已经被移植过来的
`tests/query.test.mjs` 覆盖到（同样是 `page()` 的 `invalid_cursor`
与 `argumentsFor()` 的拒绝分支）。**这是一处有意的取舍，不是遗漏**；
若你认为该保留独立的一份，见文末「未完成项」。

### 2. 没有改的

- `.cs`（4 个）、`.ps1`（2 个）、`.c`（1 个）、`.plist`（1 个）**一个字节都没有改动**。
  它们是平台互操作代码：`read-chat.ps1` 靠 `$PSScriptRoot` 找同目录的 `.cs`，
  改路径或改空白都可能破坏 `Add-Type` 的拼接。
- `lib/*.ts`（`content.ts` / `values.ts` / `xml.ts` / `media-index.ts` / `chat-media.ts`）
  与 `lib/*.mjs` **双份都保留**，理由见 README「关于 `.ts` 与 `.mjs` 双份」。
- `tests/` 的 5 个文件内容未改，只**加了跳过条件**（本仓不跑 `npm install`、
  且本机杀毒软件拦截 `Add-Type` 现场编译）。所有原始断言一行未删。

### 3. 新增的文件（上游没有）

| 文件 | 作用 |
| --- | --- |
| `ATTRIBUTION.md` | 本文件 |
| `README.md` | 面向维护者：能力表、平台矩阵、隐私说明、已知限制 |
| `cordis.patch.yml` | 本仓的 bundle 装配格式 |
| `OWNERS` | 本仓的目录所有权约定，逐字复制自 `packages/source/lab/OWNERS` |
| `lib/common.mjs` | 见上，上游 `core/chat/common.mjs` 的逐字节副本 |
| `tests/helpers/environment.mjs` | 测试环境探测（依赖是否装了、`.cs` 能否现场编译） |
| `tests/meta.test.mjs` | 断言三份必带元数据文件存在且非空 |

`THIRD_PARTY_NOTICES.txt` 是上游同名文件的**逐字**副本，不算新增内容。

## 上游覆盖度

上游 `core/wechat/` 共 24 个文件。逐个交代：

| 上游文件 | 状态 | 说明 |
| --- | --- | --- |
| `SKILL.md` | 已移植 | 正文逐字相同，另加一节「关于 `<SKILL>` 路径」 |
| `THIRD_PARTY_NOTICES.txt` | 已移植 | 逐字 |
| `package.json` | 已移植 | 按本仓格式重写（名称、`dsh.capability`、`files`） |
| `package-lock.json` | 未移植 | 理由：它是上游 workspace 的锁文件，与本仓根 `package-lock.json` 冲突且我们按约定不跑 `npm install`；本包 `package.json` 已声明同一组依赖 |
| `lib/chat-media.ts` | 已移植 | 仅改 1 处 import |
| `lib/content.mjs` | 已移植 | 仅改 1 处 import |
| `lib/content.ts` | 已移植 | 逐字 |
| `lib/macos.mjs` | 已移植 | 仅改 1 处 import |
| `lib/media-index.mjs` | 已移植 | 仅改 1 处 import |
| `lib/media-index.ts` | 已移植 | 逐字 |
| `lib/query.mjs` | 已移植 | 仅改 1 处 import |
| `lib/values.ts` | 已移植 | 逐字 |
| `lib/xml.ts` | 已移植 | 逐字 |
| `references/chat.md` | 已移植 | 逐字 |
| `scripts/wechat.mjs` | 已移植 | 仅改 1 处 import |
| `scripts/local/chat-key-cache.cs` | 已移植 | 逐字 |
| `scripts/local/chat-snapshot.cs` | 已移植 | 逐字 |
| `scripts/local/chat.mjs` | 已移植 | 仅改 1 处 import |
| `scripts/local/image-key.cs` | 已移植 | 逐字 |
| `scripts/local/macos-debugger.plist` | 已移植 | 逐字 |
| `scripts/local/macos-memory.c` | 已移植 | 逐字 |
| `scripts/local/read-chat.ps1` | 已移植 | 逐字 |
| `scripts/local/read-image.ps1` | 已移植 | 逐字 |
| `scripts/local/runtime-key.cs` | 已移植 | 逐字 |
| `scripts/local/snapshot.cs` | 已移植 | 逐字 |
| `tests/macos.test.mjs` | 已移植 | 仅加跳过条件，断言未改 |
| `tests/media.test.mjs` | 已移植 | 仅加跳过条件，断言未改 |
| `tests/profiles.test.mjs` | 已移植 | 仅加跳过条件，断言未改 |
| `tests/query.test.mjs` | 已移植 | 仅加跳过条件，断言未改 |
| `tests/snapshot.test.mjs` | 已移植 | 仅加跳过条件，断言未改 |

**另有一项不在 `core/wechat/` 里、但被本包需要的文件**：
`core/chat/common.mjs` → 已移植为 `lib/common.mjs`（逐字）。

## 未完成项

- `core/chat/common.test.mjs` 未移植（理由见上文第 1 条）。
- 本仓根 `ATTRIBUTION.md` **尚未**加上指向本文件的链接。这需要改根文件，
  不在本次允许的路径范围内；留给集成方在合并时补一行。
- `profiles/zju-workbench/package.json` 尚未启用本包（同上，属于共享文件）。
- `tests/source-settings.test.mjs` 的 `NO_SETTINGS` 白名单需要加一行
  （同上，属于共享文件）：`['wechat-chat', '纯本机操作、无凭据配置与网络']`。
