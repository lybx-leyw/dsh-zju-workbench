# ZJU Workbench · DSH 工作台

把 DeepSeek Harness 改造成浙大自己的学习工作台：一个独立的 `zju-workbench` profile，加一层界面外壳，侧栏是「今天 / 论文 / 学习 / 题库 / 规划 / 笔记 / 插件 / 文档」，原生 DSH 工作区作为页面壳的首页承载会话；账号与数据在原生设置浮窗里。

产品是**插件生态**，不是一个单体应用：外壳只声明页框架与插槽、不认识具体页面；每个数据源、每个工具、每个页面都是独立包，依赖方向单向。想给 AI 加工具、想把某个数据源接进来、想重做某一页的交互，都可以只改一个包——不必碰其它部分。只要不违反 [OWNER 核心规则](docs/contributing/CONTRIBUTING.md#2-owner-机制)，就可以做想做的一切。

> **关于「智云」**：智云课堂（`classroom.zju.edu.cn`）只是本工作台接入的**数据源之一**（`packages/source/classroom/`，服务名 `zwClassroom`），和学在浙大、教务网、CC98、拼题A 平级。它不是产品名，产品名是 ZJU Workbench。

## 从这里开始

| 路径 | 说明 |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 仓库根的贡献入口，正文在 [docs/contributing/CONTRIBUTING.md](docs/contributing/CONTRIBUTING.md)：安装 Node/npm/Git、开发环境准备、Owner 机制、贡献方式 |
| [AGENTS.md](AGENTS.md) | 仓库根的 AI 约定入口，正文在 [docs/contributing/AGENTS.md](docs/contributing/AGENTS.md)：共享仓库、开工前检查、文件归属、第三方来源、提交与推送 |
| [docs/contributing/OWNERS](docs/contributing/OWNERS) | 协作材料目录的负责人声明 |
| [ATTRIBUTION.md](ATTRIBUTION.md) | 参考或移植第三方项目时的来源与许可说明 |
| [LICENSING.md](LICENSING.md) | **授权**：非 vendor 包默认 GPL-3.0-or-later，例外与上游 MIT 归属逐条列明 |
| [docs/dependency-graph.html](docs/dependency-graph.html) | 插件依赖图（静态存档；运行时的活图在「插件」页） |

## 快速开始

```bash
# 1. 宿主：按 runtime.lock.json 的 preferredHostVersion 装一份独立实例
npm install --prefix .runtime/dsh-<版本> @deepseek-ai/dsh@<版本>

# 2. 仓库依赖。**不要用 `npm install` 装工作区**（原因见 AGENTS.md）
npm ci
node scripts/link-workspace-packages.mjs   # 链接 workspace 包，离线，不碰锁文件

# 3. 构建客户端产物并启动
npm run build
npm start
```

`npm start` 会检查宿主版本、链接本仓插件、初始化 `zju-workbench` profile，并打印带访问令牌的地址。默认端口 3091，可用 `ZW_PORT` 或 `--port` 覆盖。`npm run dev` 是 `build` + `start` 的合称，**不会**持续监听源码变化。

数据默认落在 `.runtime/home/profiles/zju-workbench/`；`ZW_DSH_HOME` 可改数据根，`ZW_DSH_APP_DIR` 可指定宿主安装目录（只接受 `runtime.lock.json` 里登记过的版本）。

桌面壳是同一个 profile 的窗口入口，不安装宿主、不构建客户端：

```bash
npm --prefix apps/desktop install
npm run desktop
```

## 目录结构

```
packages/
  client/    浏览器侧：外壳、页面、共享 UI 原语
  core/      纯逻辑与宿主服务：解析、讲义、出题、笔记、知识库、课堂管线…
  source/    数据源：教务、学在浙大、智云课堂、CC98、拼题A、邮箱、网络代理…
  tool/      工具定义：把 source 的能力注册成 AI 可调用的 tool
  preset/    Agent preset：决定一次会话里装配哪些工具
  radar/     生态扫描的候选骨架（隔离区，不参与产品构建）
  vendor/    需要改动的上游副本（隔离区，各自走自己的协议）
profiles/    DSH profile 模板（产品装配层）
scripts/     构建、启动、校验与一次性工具
tests/       分层组织的测试（core / client / source / tool / repo / scripts）
```

`packages/` 下四个产品分组的职责是硬的，`tests/repo/` 里有守卫在盯：

| 分组 | 只做 | 不做 |
| --- | --- | --- |
| `core/` | 纯逻辑与宿主服务（`ctx.provide`、HTTP 路由） | **任何 UI**。不 import React，不出组件 |
| `client/page-*` | **只做 UI**：渲染、交互、样式 | 宿主路由、落盘、取数、凭据；也不认识其它 page |
| `source/` | 注册数据源、管理自己的凭据（在设置里注册分区）、把错误翻成能直接上屏的一句 | 工具层；不管下流怎么用 |
| `tool/` | 只注册工具（`ctx.tools.register`） | 不注入 preset（注入点在 `preset/*` 的 patch 里） |

两条推论，读代码时最常碰到：

- **页面之间零交互**：没有 `page-study` import `page-quiz` 这种事。跨页复用的组件走
  `ui-shared` 的组件契约（`publishComponent` / `usePublishedComponent`），对方没装配
  就渲染一句说明，而不是白屏。
- **下游不重做错误处理**：数据源返回的 `error` 已经是 `{ code, message }`，
  `message` 就是该给用户看的那句（含「去设置里配」的指引）。页面只透传，不建第二张码表。

### 命名约定

| 前缀 | 含义 | 例子 |
| --- | --- | --- |
| `@lybx-leyw/dsh-zju-*` | 本仓发布包名 | `@lybx-leyw/dsh-zju-core-parser` |
| `dsh-zhiyun-*` | **历史包名**，仅出现在退役登记表里 | `retiredBundles`（`scripts/profile.mjs`） |
| `zw` / `zw-` | 产品标识：服务名、路由、数据目录、DOM 作用域 | `ctx.zwParser`、`/api/zw-study`、`data/zw-classroom` |
| `zw-` / `zws-` / `zwp-` / `zwd-` / `zwc-` | CSS 类与自定义属性：外壳、学习页、论文页、文档页、课堂 | `--zw-accent`、`.zws-btn`、`.zwp-drawer` |
| `智云课堂` / `zhiyun`（CLI） | **数据源**与上游工具名，不改 | `packages/source/classroom/` |

退役登记表里的旧名**不要**跟着改名：它们的作用是认出老 profile 里还挂着的旧条目，改掉就等于关掉了迁移本身。

## 授权

**非 vendor 包默认以 GPL-3.0-or-later 授权**，全文见 [LICENSE](LICENSE)。

引用、修改或以任何形式分发这些包的一方需要遵守 GPLv3 —— 其中包括分发时
提供完整对应源码、衍生作品同样以 GPLv3 授权。

例外：

- `packages/core/parser` —— **MIT**（包内独立声明）
- `packages/vendor/*` —— 各自上游协议（`@lybx-leyw/dsh-pages` 与
  `@ggboy123/dsh-paper-reader` 均为 MIT）

部分包 vendored 了 MIT 协议的第三方代码（主要是 `core/classroom-*` 的
OpenMAIC 来源），这些归属记录在各自的 `ATTRIBUTION.md` 里，不影响按包划分的协议。
完整规则见 [LICENSING.md](LICENSING.md)。

## 数据源与工具

`packages/source/` 下每个包管一个**外部服务**的接入与凭据，`packages/tool/` 把它们的
能力注册成 AI 可调用的工具。两者分开的理由是：数据源不该关心谁能消费它（页面、脚本、
AI 都行），而工具层不该管凭据与网络。

| 数据源 | 包 | 服务名 |
| --- | --- | --- |
| 统一身份认证（CAS） | `source/login` | `zwCard` |
| 校园网 / WebVPN 选路 | `source/webvpn`、`source/http` | `zwEgress` |
| 智云课堂 | `source/classroom` | `zwClassroom` |
| 教务网（成绩 / 课表 / 考试） | `source/zdbk` | `zwZdbk` |
| 学在浙大 | `source/xuezai` | `zwXuezai` |
| 学习通 | `source/xxt` | `zwXxt` |
| CC98 | `source/cc98` | `zwCc98` |
| 拼题A | `source/pta` | `zwPta` |
| 研究生教务 / 二课 / 体艺 / 实验室 / 场馆 | `source/yjsy`、`sztz`、`tyys`、`lab`、`chalaoshi` | `zwYjsy` 等 |
| 邮箱 / 通知 / 电子书 / 微信读书 | `source/mail`、`notice`、`ebook`、`weread` | `zwMail` 等 |
| 分域网络代理 | `source/netproxy` | `zwNetProxy` |

`packages/source/netproxy/` 值得单独说：所有出口流量经一个本地中继，按你在
「设置 → 网络代理」里配置的域名规则分发到不同代理或直连（代理数量不设上限）。
它存在的理由是**环境变量表达不了分域路由** —— `NO_PROXY` 只能给一个绕开名单，
而这里需要「域 A 走代理 1、域 B 走代理 2、域 C 直连」。设计与配置形状见该包
[README](packages/source/netproxy/README.md)。

## 客户端只能用 `core/*` 的 `/browser` 子入口

`core/` 里既有纯函数，也有落盘与路由。一个包的**裸入口**往往 re-export 了带
`node:fs` / `node:crypto` 的模块 —— 客户端 `import` 它，esbuild 会把这些一起打进
浏览器产物。构建常常还是绿的（对 node 内置模块只警告），进页面才白屏。

所以有这类子入口的包必须显式分流：

| 包 | 裸入口 | `/browser` |
| --- | --- | --- |
| `core/planning` | 纯逻辑 + 文件存储 + 路由 | 只有纯函数 |
| `core/plugin-graph` | 图折叠 + `/api/zw-plugins` 路由 | 只有图折叠 |
| `core/vault` | 落盘 + PDF 字节流（**无** browser 入口，页面不直接用它） | — |

`tests/repo/page-isolation.test.mjs` 会**沿 import 链**检查：从 `client.jsx` 出发跟进同包内
的相对 import，链上任何一环出现裸入口就报错。

## 校验

```bash
npm run build              # 客户端产物
npm test                   # 全量测试
npm run check:css          # 跨包 CSS 竞争与 @media 顺序依赖
npm run test:host          # 在真实宿主里跑端到端（会起实例、抓截图）
node scripts/link-workspace-packages.mjs --check   # 工作区链接是否齐全
```

测试按包的分层放在 `tests/core/`、`tests/client/`、`tests/source/`、`tests/tool/`，
跨包守卫与仓库级不变量在 `tests/repo/`。
