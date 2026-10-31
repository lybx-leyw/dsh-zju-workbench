# ATTRIBUTION — dsh-zhiyun-classroom-dsl

本包的 `vendor/dsl/` 目录是**上游构建产物的原样副本**，不含任何本地改动。
本仓只新增了两个文件：`src/index.js`（一行 re-export）与 `package.json`。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游包 | `packages/@openmaic/dsl` |
| 上游版本 | `0.12.0` |
| 上游 commit | `0ae3215e965412b8ee536feaa5d98f75b7a70923` |
| 许可证 | MIT（全文见 `vendor/dsl/LICENSE`） |
| 版权 | Copyright (c) 2026 THU-MAIC |
| 本地落点 | `vendor/dsl/` = 上游 `packages/@openmaic/dsl/dist/` 的完整拷贝（含 `.d.ts` / `.js.map` / `schema/*.json`） |

## 为什么是 vendor 而不是 fork

`docs/architecture/classroom-port.md` 第 3 节把 `@openmaic/{dsl,geometry}` 归为
**vendor（不 fork 逻辑，只打包）**：这个包是纯契约（类型、JSON Schema、纯校验函数、
迁移助手），零运行时依赖。重写它只会制造「看起来像」的漂移，而漂移在判据 1/2 上
表现为两侧场景序列与 DOM 文本对不上。

## 升级流程

1. 在上游按 commit 重新构建 `dist/`；
2. 用新的 `dist/` 整体替换 `vendor/dsl/`；
3. 更新本文件与 `src/index.js` 注释里的版本号；
4. 跑 `node --test tests/classroom-dsl-vendor.test.mjs`。
