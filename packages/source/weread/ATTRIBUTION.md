# 归属（Attribution）

本包 `@lybx-leyw/dsh-zju-source-weread` 不是从零写的。它是 `zju-assistant` 的
`core/weread/` 移植进本仓后的副本，落在 `packages/source/weread/`。

**形态是原样保留的**：上游 `core/weread/` 是一个**独立的 agent skill**（有 `SKILL.md` +
自己的 `package.json` + `tsconfig.json` + CLI 入口 `scripts/weread.ts`），不是 Cordis 插件。
本包照这个样子留着，**没有**改写成 `src/index.js` 形态的插件。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/Anchorite-no/dsh-zju-assistant |
| commit | `e59b81e1c254d979402f047c6fc8e43bf30b9713`（2026-11-05，`Prepare 0.1.8`） |
| 工作区包 | `dsh-zju-assistant-workspace` 0.1.8 |
| 本仓内的 vendored 路径 | `packages/vendor/zju-assistant/core/weread/` |
| 上游协议 | **GPL-3.0-only** |

上游 `packages/vendor/zju-assistant/package.json` 的 `license` 字段写的是
`GPL-3.0-only`，仓库根的 `LICENSE` 是 GPLv3 全文（第 3 版，2007-06-29）。
本仓（`zhiyun-pro-js`）对**非 vendor 包**统一采用 **GPL-3.0-or-later**，
这个 `-or-later` 与上游的 `-only` 是兼容的：GPLv3 §14 允许 `-only` 的衍生作品
按更高版本授权，前提是不额外限制。**注意这是两个不同的声明**，不是笔误：

- 上游仍是 `GPL-3.0-only`（vendor 副本保持原样，我们不替它改协议）；
- 本包的**新增部分与本包整体分发**采用 `GPL-3.0-or-later`（见包内
  `package.json` 的 `license` 字段与仓库根 `LICENSING.md`）。

如果你只需要锁定 GPLv3 本身，按 `GPL-3.0-only` 理解本包即可。

## 两份许可文件的关系（这是本包最容易被误解的地方）

包内有两份**性质完全不同**的许可文件，它们不冲突，各管各的：

| 文件 | 谁的 | 管什么 | 与 GPLv3 的关系 |
| --- | --- | --- | --- |
| `LICENSE-Tencent` | **腾讯** | 微信读书（WeChatReading）相关内容按 **Apache-2.0** 授权 | Apache-2.0 **与** GPLv3 兼容，可以组合 |
| `THIRD_PARTY_NOTICES.txt` | 第三方（`CloudDreamAI / TANGandXUE`） | 某个 **Windows runtime XOR blob 格式**的文档来源，**MIT** | MIT **与** GPLv3 兼容，可以组合 |

### `LICENSE-Tencent` 说的是什么

原文头三句（逐字，未改）：

```text
Tencent is pleased to support the open source community by making WeChatReading available.

Copyright (C) 2026 Tencent. All rights reserved.

WeChatReading is licensed under Apache-2.0. WeChatReading does not impose any additional restrictions beyond those specified in the license.
```

紧跟其后的是 Apache-2.0 的**全文条款**（第 1–9 节 + "END OF TERMS AND CONDITIONS"）。

**它约束的是「微信读书」相关内容**（本站点的公开内容与接口形态），不是本包的代码。
对本包而言，它的实际含义是：**再分发时必须保留这份声明，并按 Apache-2.0 第 4 条
把协议副本交给接收者**——这正是把 `LICENSE-Tencent` 放进 `files` 白名单的原因
（见 `tests/meta.test.mjs` 里那条断言）。

⚠️ **它不授予任何对腾讯商标、站点内容或个人数据的权利。** Apache-2.0 第 6 条
（Trademarks）明确不授予商标许可。文章正文的版权仍归原作者/公众号所有，
本包只做「取回 + 转换」，不主张任何权利。见 README「已知限制」。

### `THIRD_PARTY_NOTICES.txt` 说的是什么

上游这份文件一共 26 行，内容是：

```text
scripts/local/runtime-key.cs uses the Windows runtime XOR blob format documented by:
https://github.com/TANGandXUE/wcdb-key-tool/blob/main/wcdb_key_tool_windows.py
Source blob SHA: 54d729508454859afc66050f161e604c875b288e

The target-only codec traversal and verification are implemented locally.
```

其后是 **MIT 全文**与 `Copyright (c) 2025 CloudDreamAI / TANGandXUE`。

**⚠️ 这份文件与本包的实际代码对不上，必须如实说明：**

- 它提到的 `scripts/local/runtime-key.cs` **不在本包里**，也不在 `core/weread/` 里——
  那是**兄弟技能** `core/wechat/`（本机微信数据库）的文件；
- 本包的 `scripts/` 下只有 `weread.ts` 一个文件，`lib/` 里也没有任何读进程内存、
  解析 wcdb 的代码；
- 上游把同一份 `THIRD_PARTY_NOTICES.txt` 复制进了 `core/wechat/`（45 行，多了 macOS
  后端与媒体格式的来源）与 `core/weread/`（26 行，即上面这份）。

**判断**：这是**上游的如实搬运，不是本仓的错误**。上游在两个技能目录里各放一份
第三方声明，而 `core/weread/` 那份的内容事实上只对 `core/wechat/` 适用。
按「无损融合、逐字保留」的约定，本仓**原样保留**，不删、不改、不「修正」——
删掉它会丢掉 MIT 的署名义务（万一上游哪天把对应代码搬进 weread），
改动它则会让「与上游逐字节相同」这条可核对的保证失效。

**处理方式**：不改文件，但在本文件与 README 里写清它「记的不是本包的代码」。
这是一处**上游事实与文件内容的不一致**，属于已知限制；需要上游澄清。

## 本仓做的改动

**`lib/` 下的 15 个文件零字节改动。** 可用哈希核对（`tests/meta.test.mjs` 里有一条
断言直接把本包 `lib/` 与 `packages/vendor/zju-assistant/core/weread/lib/` 逐文件
做 SHA-256 比对）。

改动只发生在下面几类文件上：

### 1. 测试文件：只加跳过条件，断言一行未删未改

本仓按约定**不跑 `npm install`**，而上游的测试是在装好依赖的目录里跑的。于是：

| 文件 | 改了什么 |
| --- | --- |
| `tests/article.test.ts` | 顶层加 `missing([...])` 探测；4 条用例加 `{ skip }` |
| `tests/cli.test.ts` | 同上；4 条用例加 `{ skip }` |
| `tests/sources.test.ts` | 同上；6 条用例加 `{ skip }` |
| `tests/browser-runtime.test.ts` | 判据从「非 win32」扩成「非 win32 **或**没装 electron」；4 条加 `{ skip: reason }` |
| `tests/web.test.ts` | **未改**（不依赖任何网页库，靠 `setBrowser()` 打桩，7 条全过） |
| `tests/captcha-electron.test.mjs` | **未改**（11 条全过） |
| `tests/captcha-pta.test.mjs` | **未改**（4 条全过） |
| `tests/captcha-recognizer.test.mjs` | **未改**（5 条全过） |
| `tests/fixtures/*`（4 个） | **未改**（逐字节） |

**跳过的只是执行，不是覆盖。** 断言与原文件逐字相同；`skip` 理由里写清了
缺哪个依赖、为什么缺，`node --test` 会把它打印出来。详见 README「测试」。

### 2. `package.json`：按本仓格式重写

上游的 `name` 是 `weread-skill`、`private: true`，没有 `dsh` 字段。本仓需要：

- 改成 `@lybx-leyw/dsh-zju-source-weread`（本仓命名约定）；
- 加 `dsh.capability` 与 `dsh.bundle.patch`（本仓装配格式）；
- 加 `files` 白名单（含两份许可文件）；
- 加 `repository` 与 `license`（`tests/publish-guard.test.mjs` 要求）。

**保留未动**：`engines`（`node >= 24`）、`bin`（`weread` → `scripts/weread.ts`）、
`dependencies`（六项，版本范围逐字）、`optionalDependencies`（`electron 44.10.1`）、
`devDependencies`、以及 `scripts` 里的三条命令。

### 3. 新增的文件（上游没有）

| 文件 | 作用 |
| --- | --- |
| `README.md` | 面向维护者：能力表、Electron 依赖、**验证码行为性质**、已知限制 |
| `ATTRIBUTION.md` | 本文件 |
| `OWNERS` | 本仓的目录所有权约定，逐字复制自 `packages/source/lab/OWNERS` |
| `cordis.patch.yml` | 本仓的 bundle 装配格式（参照 `packages/source/lab/`） |
| `.gitignore` | 一行 `!lib/` —— 把本包的**源码目录**从根 `.gitignore` 的构建产物规则里捞回来 |
| `tests/meta.test.mjs` | 元数据守卫（两份许可 + README + ATTRIBUTION + `files` + `lib/` 未改） |
| `tests/helpers/environment.mjs` | 依赖探测，把「没装」变成 `skip` 而不是 `fail` |

`LICENSE-Tencent` 与 `THIRD_PARTY_NOTICES.txt` 是上游同名文件的**逐字**副本，不算新增内容。

### 4. 关于 `.gitignore` 里那一行

根 `.gitignore` 有 `packages/*/lib/`、`packages/*/*/lib/` 两条规则，本意是忽略
`npm run build` 生成的 `lib/client.js` 等**构建产物**。本包的 `lib/` 是
**上游移植过来的源码**，没有构建步骤会重新生成它。

症状是静默的：文件在磁盘上、测试跑得通，但 `git status` 里看不见，一提交就少整个
`lib/` —— 包直接不可用，且没有任何报错。本包用 `.gitignore` 里的 `!lib/` 反白名单化
（已用 `git check-ignore` 逐个验证：退出码 1 = 不被忽略）。

## 上游覆盖度

上游 `core/weread/` 共 **34 个文件**（含 `package-lock.json`）。逐个交代：

| 上游文件 | 状态 | 说明 |
| --- | --- | --- |
| `SKILL.md` | 已移植 | **逐字节相同**（46 行） |
| `LICENSE-Tencent` | 已移植 | **逐字节相同**（59 行） |
| `THIRD_PARTY_NOTICES.txt` | 已移植 | **逐字节相同**（26 行） |
| `package.json` | 已移植 | 按本仓格式重写（见上文第 2 条） |
| `package-lock.json` | **未移植** | 理由：它是上游 workspace 的锁文件（`"name": "weread-skill"`），与本仓根 `package-lock.json` 会冲突；本仓按约定不跑 `npm install`。本包 `package.json` 已声明同一组依赖与版本范围 |
| `tsconfig.json` | 已移植 | **逐字节相同**（15 行） |
| `lib/article.ts` | 已移植 | **逐字节相同**（100 行） |
| `lib/cli.ts` | 已移植 | **逐字节相同**（42 行） |
| `lib/config.ts` | 已移植 | **逐字节相同**（38 行） |
| `lib/errors.mjs` | 已移植 | **逐字节相同**（4 行） |
| `lib/sources.ts` | 已移植 | **逐字节相同**（131 行） |
| `lib/web.ts` | 已移植 | **逐字节相同**（103 行） |
| `lib/article/page.mjs` | 已移植 | **逐字节相同**（74 行） |
| `lib/browser/host.cjs` | 已移植 | **逐字节相同**（17 行） |
| `lib/browser/preload.cjs` | 已移植 | **逐字节相同**（6 行） |
| `lib/browser/runtime.ts` | 已移植 | **逐字节相同**（119 行） |
| `lib/browser/service.cjs` | 已移植 | **逐字节相同**（133 行） |
| `lib/captcha/electron.mjs` | 已移植 | **逐字节相同**（304 行） |
| `lib/captcha/index.mjs` | 已移植 | **逐字节相同**（87 行） |
| `lib/captcha/pta.mjs` | 已移植 | **逐字节相同**（79 行） |
| `lib/captcha/recognizer.mjs` | 已移植 | **逐字节相同**（58 行） |
| `references/runtime.md` | 已移植 | **逐字节相同**（57 行） |
| `scripts/weread.ts` | 已移植 | **逐字节相同**（13 行） |
| `tests/article.test.ts` | 已移植 | 仅加 skip 条件 |
| `tests/browser-runtime.test.ts` | 已移植 | 仅加 skip 条件（含「装没装 electron」） |
| `tests/captcha-electron.test.mjs` | 已移植 | **逐字节相同** |
| `tests/captcha-pta.test.mjs` | 已移植 | **逐字节相同** |
| `tests/captcha-recognizer.test.mjs` | 已移植 | **逐字节相同** |
| `tests/cli.test.ts` | 已移植 | 仅加 skip 条件 |
| `tests/sources.test.ts` | 已移植 | 仅加 skip 条件 |
| `tests/web.test.ts` | 已移植 | **逐字节相同** |
| `tests/fixtures/article-page.cjs` | 已移植 | **逐字节相同** |
| `tests/fixtures/captcha-frame.cjs` | 已移植 | **逐字节相同** |
| `tests/fixtures/hosted.cjs` | 已移植 | **逐字节相同** |
| `tests/fixtures/pta-slider.mjs` | 已移植 | **逐字节相同** |

统计（**已用 SHA-256 逐文件核对，可复现**）：

| 结果 | 数量 | 文件 |
| --- | --- | --- |
| **逐字节相同** | **29** | 含 `SKILL.md`、`LICENSE-Tencent`、`THIRD_PARTY_NOTICES.txt`、`tsconfig.json`、`lib/` 全部 15 个、`references/runtime.md`、`scripts/weread.ts`、`tests/` 4 个未改测试 + 4 个夹具 |
| **仅加 skip 条件** | **4** | `tests/article.test.ts`、`tests/browser-runtime.test.ts`、`tests/cli.test.ts`、`tests/sources.test.ts` |
| **按本仓格式重写** | **1** | `package.json`（见上文第 2 条；依赖/bin/engines 逐字保留） |
| **明确丢弃** | **1** | `package-lock.json`（不是代码，理由见上表） |
| **合计** | **34** | 与上游文件数一致 |

`lib/` 的**全部导出**也逐个交代，见下一节 —— 没有第三态。

### 上游 `lib/` 导出覆盖表

| 文件 | 上游导出 | 本仓对应物 |
| --- | --- | --- |
| `lib/errors.mjs` | `SkillError`（`code` / `details` / `publicResult()`） | 同名同形，逐字节 |
| `lib/config.ts` | `dataDir`、`outPath()`、`visionConfig()`、`SkillError`（re-export）、`VisionConfig`（type） | 全部保留，逐字节 |
| `lib/cli.ts` | `commands(write)` | 保留，逐字节 |
| `lib/sources.ts` | `Article`、`Account`、`Options`（type）、`list()`、`listTracked()`、`accounts()`、`read()`、`track()`、`newArticles()` | 全部保留，逐字节 |
| `lib/web.ts` | `login()`、`loginState()`、`logout()`、`bookIdOf()`、`webAccounts()`、`webArticles()` | 全部保留，逐字节 |
| `lib/article.ts` | `Document`（type）、`articleLink()`、`fetchArticle()`、`parseDocument()`、`exportMarkdown()` | 全部保留，逐字节 |
| `lib/article/page.mjs` | `readArticlePage()` | 保留，逐字节 |
| `lib/browser/runtime.ts` | `BrowserRuntime`（type）、`getBrowser()`、`closeBrowser()`、`setBrowser()`、`connectBrowser()`、`openBrowser()` | 全部保留，逐字节 |
| `lib/browser/service.cjs` | `createBrowserService()` | 保留，逐字节 |
| `lib/browser/host.cjs` | 无导出（Electron 主进程入口，副作用脚本） | 保留，逐字节 |
| `lib/browser/preload.cjs` | 无导出（`contextBridge` 挂 `wereadVerification`） | 保留，逐字节 |
| `lib/captcha/index.mjs` | `abortable()`、`verifyWeRead()`、`verifyPta()`、`verifyWeChat()` | 全部保留，逐字节 |
| `lib/captcha/electron.mjs` | `imageRect()`、`validateAnswer()`、`ElectronCaptcha`（class） | 全部保留，逐字节 |
| `lib/captcha/pta.mjs` | `matchPtaSlider()`、`PtaSliderRecognizer`（class） | 全部保留，逐字节 |
| `lib/captcha/recognizer.mjs` | `CaptchaRecognizer`（class） | 保留，逐字节 |

**没有丢弃任何导出。** 唯一没移植的文件是 `package-lock.json`（不是代码，理由见上表）。

## 未完成项

- 本仓根 `ATTRIBUTION.md` **尚未**加上指向本文件的链接。这需要改根文件，
  不在本次允许的路径范围内；留给集成方在合并时补一行。
- `profiles/zju-workbench/package.json` 尚未启用本包（同上，属于共享文件）。
- `tests/source-settings.test.mjs` 的 `NO_SETTINGS` 白名单需要加一行
  （同上，属于共享文件）：`['weread', '独立 agent skill、无设置分区；凭据走微信读书扫码']`。
- 上游 `core/chat/common.mjs` 与本包无关（本包不依赖它），**未移植**，这是正确的。
