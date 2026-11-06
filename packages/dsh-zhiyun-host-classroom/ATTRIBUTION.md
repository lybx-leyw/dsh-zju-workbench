# ATTRIBUTION — dsh-zhiyun-host-classroom

本包把 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 的 `app/api/*` 路由**重写**成本仓的宿主服务
（不是路由层拷贝，也不含上游运行时代码）。上游应用本身的 vendor 见
[dsh-zhiyun-host-openmaic](../dsh-zhiyun-host-openmaic/ATTRIBUTION.md)。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无** |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/service.js` / `src/adapter.js` | `app/api/**/route.ts`（实测 20 个路由，清单见 `src/upstream/ROUTES.md`） |
| `src/events.js` | `app/api/generation-runs/[id]/events/route.ts`（SSE 语义） |
| `src/errors.js` | 上游统一的错误响应形状 |

## 改动

- 上游是 Next.js 的路由处理器；本仓改为 Cordis 插件提供的 HTTP 路由（`ctx.connection.fetch.register`）。
- **没有**移植上游的鉴权、账号体系、多用户隔离 —— 本仓单用户，作用域由 profile 决定。
- 上游的 React 页面不在本包；界面由 `dsh-zhiyun-page-classroom*` 系列重写。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照 `app/api/` 检查路由清单（`src/upstream/ROUTES.md` 需同步）；
3. 跑 `node --test tests/classroom*.test.mjs`。
