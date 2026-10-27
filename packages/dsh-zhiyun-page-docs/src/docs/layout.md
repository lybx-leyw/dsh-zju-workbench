# 仓库目录结构

## 顶层

```text
.
├── packages/       # 插件包，工作台的全部功能都在这里
├── profiles/       # profile 组合：哪些包一起装成一个工作台
├── scripts/        # 构建、启动、检查、基准测试
├── tests/          # 单测，node --test tests/*.test.mjs
├── docs/           # 仓库文档（这一页的内容来源）
├── apps/           # 桌面壳（Electron，可选）
├── .runtime/       # 独立宿主 + 真实数据，不进仓库
└── artifacts/      # test:host 的报告与截图，不进仓库
```

## `packages/` 里怎么分包

包名一律带 `dsh-zhiyun-` 前缀，后半段说明它在链路里的位置：

| 前缀 | 职责 | 例子 |
| --- | --- | --- |
| `shell-` | 外壳本身：导航、插槽、共享原语 | `dsh-zhiyun-shell-workbench`、`dsh-zhiyun-shell-ui` |
| `source-` | 外部数据源：登录、抓取、缓存 | `dsh-zhiyun-source-zdbk`、`dsh-zhiyun-source-cc98` |
| `core-` | 领域逻辑：解析、索引、状态、出题 | `dsh-zhiyun-core-parser`、`dsh-zhiyun-core-notes` |
| `host-` | 宿主侧能力 | `dsh-zhiyun-host-office`、`dsh-zhiyun-host-paper` |
| `page-` | 界面上的**一页** | `dsh-zhiyun-page-docs`、`dsh-zhiyun-page-notes` |

一个包内部分两个半边：

```text
packages/dsh-zhiyun-page-docs/
├── src/index.js       # 宿主半边（Node）
├── src/client.jsx     # 浏览器半边（构建产物 lib/client.js 不进仓库）
├── src/style.css      # 自带样式
├── package.json       # 入口、exports、dsh 声明
├── cordis.patch.yml   # 让 profile 能插入本包
├── OWNERS             # 归属
└── README.md          # 取舍与踩坑
```

## `profiles/`

`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles` 是**装载清单**，
顺序即装载顺序。它决定"这个工作台由哪些包组成"，也是唯一能一键停用某个功能的地方。

新包要进这个数组才会被真正的宿主装载 —— 只放在 `packages/` 下等于没接。

## `scripts/` 里常用的几个

| 文件 | 干什么 |
| --- | --- |
| `build.mjs` | 用 esbuild 把每个浏览器半边打成 `lib/client.js` |
| `profile.mjs` | 初始化 profile、建软链、启动宿主 |
| `check-css-order.mjs` | 样式顺序检查（跨包冲突、媒体查询倒序、简写长写） |
| `test-host.mjs` | 在真实宿主里跑验收，产出 `artifacts/` 报告 |

## `docs/`

仓库文档放这里，但**只有 `docs/contributing/AGENTS.md` 会被 agent 自动读取** ——
所以根目录也放了一个 `AGENTS.md` 作入口指针。协作材料（CONTRIBUTING、AGENTS、
skills）统一放在 `docs/contributing/`。

## 不进仓库的东西

`.runtime/`（宿主与真实数据）、`artifacts/`（验收产物）、`packages/*/lib/`
（构建产物）、`.env` 类凭据文件、`.ref*/`（参考源码）。

`.runtime/home/` 保存的是**真实数据**，不要当缓存删掉。

---

> 依据仓库实际结构整理；`package.json` 的 `workspaces` 与 `README.md` 的包清单是权威。
