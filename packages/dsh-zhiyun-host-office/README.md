# dsh-zhiyun-host-office

智云 Pro 的 **Office 接入层**：锁版引入
[`dsh-univer-office`](https://github.com/dream-num/dsh-univer-office)（Apache-2.0），
带来**表格 / 文档 / 幻灯片 / 多维表格 / 画布**的创建与编辑能力。

## 这个包做什么，不做什么

上游 `dsh-univer-office` 是一个**完整的双半边 DSH bundle**：

| 半边 | 提供 |
| --- | --- |
| 宿主 | `/univer-viewer` 路由 + **14 个 agent 工具** + Univer Service Provider |
| 客户端 | 向 7 个宿主 UI 包注入界面（chat / conversation / renderer / session / settings / settings-plugins / locale） |

所以本包**不提供 UI、不包插件外壳**，只做四件事：

1. **依赖载体** —— `dependencies` 把上游锁到精确版本（`0.3.7`，非 `^0.3.7`）；
2. **把自己 insert 进层栈** —— profile 的层栈从空条目列表开始拼，bundle 列在
   `dsh.profile.bundles` 里**并不会自动加载**；漏了这条，本包 `src/index.js`
   永远不会被 apply（表现是状态路由 404、启动无日志）；
3. **让上游以自己的名字进 Loader** —— `cordis.patch.yml` 里 insert 上游时用的是
   **`dsh-univer-office` 这个名字**，不是本包的名字；
4. **版本核对** —— 启动时比对「声明 / 代码预期 / 实际安装」，不一致就大声报告。

> 第 2 条是实测踩出来的：只写第 3 条时，上游的客户端半边照样进图谱、本包的
> 宿主半边却静默不跑 —— 一半在跑一半不跑，最难查的那种。回归测试见
> [验证](#验证)。

## 为什么 patch 里是两条 insert

两条各解决一个不同的问题，**缺一不可**：

- **插自己**（`name: 'dsh-zhiyun-host-office'`）—— 这是本包进层栈的**唯一**途径。
  profile 的层栈从空条目列表开始，每个 bundle 的 patch 依次往上追加
  （`dsh-app-boot` 的 profile 文档：「the tree is composed by applying each
  bundle's patch lists in `dsh.profile.bundles` order over an empty entry list」）。
- **插上游**（`name: 'dsh-univer-office'`，用**它自己的名字**）—— 客户端启动图谱按
  **Loader 行名**定位 package.json，再读它的 `dsh.client`
  （`dsh-client-modules` 的 `resolveMeta(loaderName, baseUrl)`）。上游的
  `dsh.client` 声明在**它自己的** package.json 里 —— 一旦行名换成我们的包，
  那 7 个 inject 与整个客户端半边就扫不到（表现是 univer 的界面侧完全不出现）。

这与 `dsh-zhiyun-host-paper` 的做法不同，原因是上游形态不同：

| | `dsh-zhiyun-host-paper` | 本包 |
| --- | --- | --- |
| 上游形态 | **只有宿主半边** | **双半边**（自带 `dsh.client`） |
| 谁提供 UI | 本仓的包自己写 | 上游自己 |
| patch 内容 | 只 insert 自己 | insert 自己 **+** 上游原名 |
| 上游挂载方式 | `ctx.plugin(上游)` 编程挂载 | Loader 行（`insert` 上游名） |

编程挂载在这里反而**更差**：它绕开「行名 → package.json」那条发现路径。

## 它带来什么能力（14 个 agent 工具）

| 工具 | 用途 |
| --- | --- |
| `univer_new` | 新建空的 `.univer` 文件（不覆盖已有文件） |
| `univer_import` | 导入 **xlsx / csv / tsv / docx / pptx** 为一个 Unit |
| `univer_export` | 导出成用户可用的文件格式（`.xlsx` / `.docx` / `.pptx`） |
| `univer_execute` | 执行 Univer Facade JavaScript 并提交改动 |
| `univer_inspect` | 结构化读取内容（Sheet 可指定 range） |
| `univer_lint` | 创建 / 编辑 / 计算 / 审查 Base 数据库 |
| `univer_screenshot` | 把 Sheet / Doc / **Slide** / Base / Board 渲染成 PNG 供视觉验证 |
| `univer_status` / `univer_unit` / `univer_worktree` / `univer_resources` / `univer_print_pdf` / `univer_compile_svg` | 状态、单元、工作树、资源、打印、SVG |

**agent 能直接操作 Office 文档**，这是本工作台引入它的主要理由 ——
比在页面里加一个编辑器更契合 DSH 的形态。

## 许可：一处需要知情的地方

上游自身 **Apache-2.0**，但它依赖的 `@univerjs-pro/*`（Univer 的**商业产品线**，
其 README 有「开源与 Pro」一节）**全都没有 `license` 字段** —— 本机装到的是这 5 个：

| 依赖 | 版本 | license |
| --- | --- | --- |
| `@univerjs-pro/cli-assets` | 0.1.0 | **(无)** |
| `@univerjs-pro/exchange-node-binding` | 1.0.1 | **(无)** |
| `@univerjs-pro/exchange-node-binding-win32-x64-msvc` | 1.0.1 | **(无)** |
| `@univerjs-pro/engine-formula-rust-binding` | 1.0.1 | **(无)** |
| `@univerjs-pro/engine-formula-rust-binding-win32-x64-msvc` | 1.0.1 | **(无)** |

后两条是带 `os`/`cpu` 字段的平台专用包，换平台装到的会是别的后缀。
没有 license 字段按 npm 惯例属「保留所有权利」。

**已由用户确认引入**，依据是：本项目**不商用**；且我们是把它作为 `package.json`
的依赖正常引入，**没有复制其源码**到本仓库 —— 见
[AGENTS.md 第 3.3 节](../../docs/contributing/AGENTS.md)。

⚠️ **若本项目将来要商用，这一条必须重新评估。**

完整调研（含「为什么不用开源 preset 自己拼」的对照）见
[docs/univer-office-decision.md](../../docs/univer-office-decision.md)。

## 其他事实

- 上游**未压缩 216 MB**，带 `puppeteer-core`（渲染用）与 `libsql`（原生模块）。
- 本包可被用户在「插件」页取消加载 —— 体积是可选择的代价，不是拒绝接入的理由。
- 需要 Node ≥ 22.19（本机 v24.11.1 ✅）。

## 状态查询

```
GET /zhiyun-univer-office   → { ok, status: { upstream: { expected, installed, ok } } }
```

宿主侧：`ctx.get('zhiyunUniverOffice').status()`。

## 验证

```bash
node --test tests/univer-office.test.mjs   # 锁版三者一致 + patch 形态 + 声明面 + 状态路由 + 上游 inject 目标
```

其中 patch 那条是**回归测试**：把「插自己」那条删掉它会红 —— 钉的就是上面那个
「一半在跑一半不跑」的缺陷。

## 目录

```
src/
  upstream.js   锁版凭据（单一真源）
  index.js      宿主半边：版本核对 + 状态路由（不拦启动）
cordis.patch.yml  两条 insert：**自己**（进层栈）+ **上游原名**（客户端半边）—— 理由见上
```
