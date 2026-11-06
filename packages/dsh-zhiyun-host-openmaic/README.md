# dsh-zhiyun-host-openmaic

OpenMAIC（[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)）的上游服务宿主。

## 它是什么

一个**进程托管者**，不是渲染组件。它在工作台宿主进程旁边拉起 OpenMAIC 自己的
Next.js 服务（外加它自己的 PostgreSQL），并把就绪地址、状态与版本经
`ctx.zhiyunOpenMAIC` 交给页面。

页面侧是 `dsh-zhiyun-page-classroom`：一个占满内容区的同源 iframe。

## 为什么是「托管整个站点」而不是「移植代码」

上游从 1.2.0 起是 **server-first** 的：课堂生成跑在服务端进程里（关掉标签页
也继续跑），播放引擎、多智能体对话、PPTX / MP4 导出全部挂在它自己的 `/api/*`
路由与 SSE 上。

这意味着「功能无损」与「把组件搬进本仓的 React 插件」是互斥的：任何只搬
`components/` 的做法都只保住了外观 —— 界面画得出来，点下去每个按钮都 404。

所以这里的选择是**原样托管**：源码逐字节 vendor 进来，起它自己的进程，
用 iframe 嵌整站。UI 与上游一致这件事因此不是「对齐」出来的，是同一份代码
渲染出来的。

这与 `dsh-zhiyun-host-deeptutor` 是同一套取舍。

## 安装

```bash
# 1) 拉上游源码（按 upstream.lock.json 校验归档哈希与树摘要）
npm run vendor:fetch -- --only openmaic

# 2) 装依赖（postinstall 会把上游工作区包一起构建）
cd packages/dsh-zhiyun-host-openmaic/vendor/openmaic
pnpm install --frozen-lockfile

# 3) 构建生产产物
#
# ⚠️ ALLOWED_FRAME_ANCESTORS 必须在**构建时**就给：上游在 next.config.ts 的
#    headers() 里读它，而 headers() 在构建期求值、把 CSP 写死进
#    .next/routes-manifest.json。运行时再设是无效的（实测会一直白屏，
#    报 "Framing ... violates ... frame-ancestors self"）。
ALLOWED_FRAME_ANCESTORS="http://127.0.0.1:3091 http://localhost:3091" pnpm build
```

> **为什么需要这个变量**：上游默认发 `frame-ancestors self` + `X-Frame-Options:
> SAMEORIGIN`，拒绝任何跨源嵌入。我们的工作台与它不同端口，属于跨源。配了白名单后
> 上游会自己去掉 `X-Frame-Options`（该头无法表达白名单）。
> 工作台端口改了的话（`ZHIYUN_PORT`），这里要跟着改。

## 运行前提

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node | ≥ 22.19 | 上游 `engines` 的硬性要求 |
| pnpm | 10.28.0 | 上游 `packageManager` 锁的版本 |
| PostgreSQL | ≥ 16 | **没有它会直接退出**，不会降级 |

连接串走 `OPENMAIC_DATABASE_URL`（或宿主 `config.databaseUrl`）：

```bash
OPENMAIC_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/openmaic
```

## 状态语义

`status()` 报的 `state` 分开表达**安装问题**与**配置问题**，因为修法完全不同：

| state | 含义 | 修法 |
| --- | --- | --- |
| `not-vendored` | 源码快照缺失 | `npm run vendor:fetch -- --only openmaic` |
| `missing-deps` | 依赖没装 | `pnpm install --frozen-lockfile` |
| `no-database` | 没有 PostgreSQL 连接串 | 设置 `OPENMAIC_DATABASE_URL` |
| `failed` | 未构建 / 启动失败 / 进程退出 | 看日志里的 `[upstream]` 行 |
| `running` | 就绪，`url` 可嵌 | — |

## 安全

上游在**没有 `ACCESS_CODE`** 时，任何能访问端口的人都可以编辑、删除整个库。
本包默认把上游绑在 `127.0.0.1`（`HOSTNAME` 与端口探测都只走回环），因此
局域网内不可达。**若要对外暴露，必须先设 `ACCESS_CODE`**（≥16 位随机值）。

## 许可

上游根协议 MIT。但其自带 `packages/mathml2omml` 是 LGPL-3.0-or-later，
不适用根 MIT —— 分发整份源码时该包仍受 LGPL 约束，详见包的 `ATTRIBUTION.md`。
