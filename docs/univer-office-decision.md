# Univer Office 的引入决策（调研记录）

给日后想动这块的人：**为什么是 `dsh-univer-office` 这个现成插件，而不是自己拿 Univer SDK 拼。**

## 结论

引入 [`dsh-univer-office`](https://github.com/dream-num/dsh-univer-office)（Apache-2.0，
npm `dsh-univer-office@0.3.7`）—— **Univer 官方为 DeepSeek Harness 出的办公插件**。

它是 Univer 官方 README 里点名列的案例：

> Univer Office for DeepSeek Harness | 面向 DeepSeek Harness 的办公插件，
> 支持关联内容、验证和用于 Agent 协作的独立 Worktree。

## 为什么不是自己拿 Univer SDK 拼

我先走错过一次：装了 `@univerjs/presets` + `preset-sheets-core` 自己搭，还实测了
「按本仓 esbuild 配置能否打包」（**能**，0 错误 0 警告，产物 17.79 MB）。
直到读 Univer 官方 README 才发现**已经有现成的 DSH 插件**。

那个探针不是白做的 —— 它证明了 Univer 能在本仓构建链里跑通。但结论是：
**有现成插件就别自己拼**。理由具体到能力上：

| 能力 | 自己拼开源 SDK | `dsh-univer-office` |
| --- | --- | --- |
| 表格 | `preset-sheets-core` | ✅ + 图表 / 透视表 / 迷你图 / 条件格式 |
| 文档 | `preset-docs-core` | ✅ |
| **幻灯片** | ❌ **npm 上没有 `preset-slides-core`** | ✅ 自带 Slide render machine |
| 导出 Office 文件 | 自己做 | ✅ `.xlsx` / `.docx` / `.pptx` |
| 版本化 / 预览 / 批准 / 丢弃 | 自己做 | ✅ 插件自带 |
| Agent 协作（worktree） | 自己做 | ✅ 插件自带 |

**开源 preset 里没有幻灯片**（`@univerjs/preset-slides-core` 在 npm 上 404），
而用户要 ppt。仅这一条就决定了自拼路线覆盖不全。

## 许可：一处需要知情的地方

`dsh-univer-office` 自身是 **Apache-2.0**，MIT/Apache 类的依赖也正常。但它依赖的
`@univerjs-pro/*` **全都没有 `license` 字段** —— 本机装到的是这 5 个：

| 依赖 | 版本 | license |
| --- | --- | --- |
| `@univerjs-pro/cli-assets` | 0.1.0 | **(无)** |
| `@univerjs-pro/exchange-node-binding` | 1.0.1 | **(无)** |
| `@univerjs-pro/exchange-node-binding-win32-x64-msvc` | 1.0.1 | **(无)** |
| `@univerjs-pro/engine-formula-rust-binding` | 1.0.1 | **(无)** |
| `@univerjs-pro/engine-formula-rust-binding-win32-x64-msvc` | 1.0.1 | **(无)** |

后两条是带 `os`/`cpu` 字段的平台专用包，换平台装到的会是别的后缀。

`@univerjs-pro/*` 是 Univer 的**商业产品线**（其 README 有「开源与 Pro」一节区分）。
没有 license 字段按惯例是"保留所有权利"。

**已由用户确认引入**，依据是：本项目**不商用**；且我们是把它作为
`package.json` 的**依赖**正常引入，**没有复制其源码**到本仓库 ——
[AGENTS.md](../../../docs/contributing/AGENTS.md) 第 3.3 节明确这类引入
「按原协议正常使用，不需要额外说明」。

⚠️ **若本项目将来要商用，这一条必须重新评估**（Pro 包可能需要商业授权）。
这是引入本插件唯一需要留意的点。

## 其他事实

- **未压缩 216 MB**，并带 `puppeteer-core`（可能下载 Chromium 做渲染）。
- 依赖 `libsql` —— **原生模块**，需要预编译二进制或本地编译。
- 需要 Node ≥ 22.19（本机 v24.11.1 ✅）。
- 9 个 peer 依赖 + 7 个 `dsh.client.inject` 目标，**已逐一核实本机宿主齐备**。

## 接入方式：一个**薄包装包**，patch 里 insert 上游原名

`dsh-client-modules` 的源码写明了客户端图谱的发现机制：

> scans the host Loader's entries for packages declaring `dsh.client`

也就是说：**只要包进了 Loader 的条目树、且声明了 `dsh.client`**，它的客户端半边
就会自动进启动图谱。已实测：`window.__DSH_BOOT__` 里出现 id 为 `dsh-univer-office`
的行，带齐它那 7 个 inject。

### 曾经想走的捷径，以及它为什么走不通

我最初打算**不建包装层**：把 `dsh-univer-office` 直接写进
`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，再把它装成 profile 的依赖。
**这条路会打死整个工作台。** 原因是 `scripts/profile.mjs:125` 的模板校验：

> `if (!sourceBundles.includes(bundle) …) throw new Error('profile 缺少 …，请检查自己的配置；初始化不会重写配置。')`

`sourceBundles` 只扫 `packages/dsh-zhiyun-*` 目录名。模板里一旦出现非本仓包，
**已有 profile 的升级路径**就会抛错 —— 而 `initialize()` 正在 `npm start` 的路径上，
所以表现不是「少了 Office 能力」，是**整个工作台起不来**。（全新 init 会照抄模板、
不触发这条校验，所以只在升级时炸 —— 更难发现。）

### 所以：建 `dsh-zhiyun-univer-office` 这个薄包装包

它在 `packages/` 下、名字在本仓前缀里 → 过得了上面那条校验。它只做四件事：
依赖载体、把自己 insert 进层栈、让上游以**自己的名字**进 Loader、版本核对。
实现与理由见 [packages/dsh-zhiyun-univer-office/README.md](../packages/dsh-zhiyun-univer-office/README.md)。

⚠️ **「插自己」那条不能少**：profile 的层栈从空条目列表开始拼，bundle 列在
`dsh.profile.bundles` 里不会被自动加载。漏了它，上游的客户端半边照样进图谱、
包装包的宿主半边却静默不跑（实测：状态路由 404、启动无日志）。

这与 `dsh-zhiyun-paper` 的情况不同：那个上游**只有宿主半边、没有客户端图谱声明**，
所以要包一层来提供自己的 UI。这里上游是完整的双半边 bundle，包装层只负责装配。

## 目录

本目录（`docs/`）只放这类**决策记录**，不放实现代码 —— 实现只在薄的包装层与依赖里。
