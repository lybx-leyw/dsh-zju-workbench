# ATTRIBUTION — dsh-zhiyun-classroom-geometry

本包的 `vendor/geometry/` 目录是**上游构建产物的原样副本**，不含任何本地改动。
本仓只新增了两个文件：`src/index.js`（一行 re-export）与 `package.json`。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游包 | `packages/@openmaic/geometry` |
| 上游版本 | `0.1.0` |
| 上游 commit | `0ae3215e965412b8ee536feaa5d98f75b7a70923` |
| 许可证 | MIT（全文见 `vendor/geometry/LICENSE`） |
| 版权 | Copyright (c) 2026 THU-MAIC |
| 本地落点 | `vendor/geometry/` = 上游 `packages/@openmaic/geometry/dist/` 的完整拷贝（含 `.d.ts` / `.js.map`） |

## 为什么是 vendor 而不是 fork

`docs/architecture/classroom-port.md` 第 3 节把 `@openmaic/{dsl,geometry}` 归为
**vendor（不 fork 逻辑，只打包）**。本包 745 行纯函数（SVG path 命令解析、
输入/渲染两级预算、形状转文字的回退策略），没有 React、没有 IO、没有单例状态。

## 传递依赖

上游 `dist/` 直接 `import` 三个裸模块（本仓未 fork，故原样保留）：

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `svg-pathdata` | 8.0.0 | SVG path 命令流解析 |
| `entities` | 6.0.1 | 形状标签里的 HTML 实体解码 |
| `tinycolor2` | 1.6.0 | 颜色合法性校验 |

它们写在本包 `dependencies` 里（版本与上游 `node_modules` 实测一致），由 npm workspaces
提升解析；未做任何 shim。

## 升级流程

1. 在上游按 commit 重新构建 `dist/`；
2. 用新的 `dist/` 整体替换 `vendor/geometry/`；
3. 若上游新增/升级了传递依赖，同步 `package.json` 的 `dependencies` 并更新本文件；
4. 跑 `node --test tests/classroom-dsl-vendor.test.mjs`。
