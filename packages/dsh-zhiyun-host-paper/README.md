# dsh-zhiyun-host-paper

「论文阅读」的**宿主半边**：把上游 `@ggboy123/dsh-paper-reader` 锁版挂载进来，并补上它没有的一件事 —— 选中即译。

## 这个包是兼容层，不是阅读器

核心判断只有一句：上游的宿主半边（24 条 `/paper-reader/*` HTTP 路由 + 5 个 agent 工具 `list_papers` / `transcribe_pdf` / `search_paper` / `study_progress` / `study_update`）是可用资产，我们**原样锁版跑在下面**（`ctx.plugin(upstream, config)`，卸载走 `fiber.dispose()`）；本仓负责的是「怎么呈现给智云 Pro 的用户」。

上游的**客户端**插件（它的 `lib/client.js`）刻意不引入：它会抢 `sidebar.workspaces`、注册自己的 `shell.overlay` 与设置分组，与本仓外壳是两套布局主张。UI 壳由 `dsh-zhiyun-page-paper` 重写。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 挂载/拆卸：版本核对、子插件挂上游、注册自有路由、提供 `zhiyunPaper` 服务 |
| `src/upstream.js` | 锁版凭据（包名 + 精确版本），单一真源 |
| `src/routes.js` | 自有前缀 `/zhiyun-paper` 的两条路由：`/api/status`、`/api/translate` |
| `src/selection.js` | 选中翻译：路由延迟解析、LRU 缓存、在飞合并、超长截断、错误归一化 |
| `src/errors.js` | `PaperError` 与 `code → HTTP 状态码` 映射 |

## 锁版

`package.json` 里写**精确版本**（`1.3.1`，不是 `^1.3.1`）—— 上游是自渲染 HTML + 私有 HTTP 路由，小版本就可能改形状。光锁声明不够（lockfile、全局覆盖、`npm link` 都能改真实安装），所以运行时再核对一次，把结果暴露给 `/zhiyun-paper/api/status`。

**版本不符只警告，不拦启动**：整个 profile 里任何一条 bundle 抛错，起不来的是整个工作台。用户至少还能打开已有 PDF。`tests/paper.test.mjs` 断言「声明、预期、实际安装」三者一致，让锁版这件事有一条会红的测试。

## 数据与端点

- 文献库默认落在 `ctx.profileContext.dir/data/zhiyun-paper`（可用 `config.dataDir` 覆盖）。
- 整篇翻译与检索重排的**端点配置**由上游写 `$DSH_HOME/.dsh-paper-reader/`，刻意不放 dataDir（dataDir 可能被 git 或云盘同步出去）；界面入口在「个人 → 设置 → 论文阅读」。
- 选中翻译走本仓的窄 llm 接口（`ctx.zhiyunParser.llm`），**不用**上游的整篇翻译链路：粒度（单句 vs 整篇）、时机（毫秒 vs 分钟）都不同。

## 边界

- `inject: ['profileContext']` 是唯一硬依赖。`webServer` / `connection` 走 `ctx.inject`，`zhiyunParser` 走 `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending。
- 自有前缀必须是 `/zhiyun-paper`：宿主的 `webserver.register` 对同 `(kind, path)` 重复注册直接抛错，而 `/paper-reader` 已被上游占用。
