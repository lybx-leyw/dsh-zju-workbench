# ATTRIBUTION

本包为候选骨架，**尚无可运行的借鉴代码**。以下记录评审通过后写作时需遵守的归属。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | `@tomjerrygit/dsh-cost-guard` |
| 仓库 | https://github.com/TomJerryGit/dsh-cost-guard |
| 版本 | `0.1.0`（锁版） |
| 许可证 | **MIT** — `Copyright (c) 2026 TomJerryGit` |
| 核验日期 | 2026-11-11（仓内 `LICENSE` 首行 + npm `license` 字段，双处一致） |
| 核验提交 | `ec6df295`（`fix: remove BOM from market index`） |

## 计划借鉴的两处（均按 CONTRIBUTING 3.3 记账）

1. **token 形状归一**（上游 `index.js:184-188`）
   `inputMiss = uncachedInputTokens + cacheWriteTokens`；
   `inputHit = cacheReadTokens`；`output = outputTokens`；非有限数回落 0。
2. **按百万 token 折算单价**（上游 `index.js:134-136`）
   `(inputMiss*p_miss + inputHit*p_hit + output*p_out) / 1e6`，保留 6 位小数。

两处均为**短小算术**，本包将以「对照重写 + 注释指明出处」的方式落地，不复制上游文件结构。

## 明确不借用

上游的 HTTP 只读路由（`/cost-guard/*`）、`sidebar.panellist` 面板注册、设置页、
省钱模式与模型发现 —— 这些是上游作为独立侧边栏插件的自我实现，本包不接管。
