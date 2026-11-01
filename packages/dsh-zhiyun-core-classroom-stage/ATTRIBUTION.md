# ATTRIBUTION — dsh-zhiyun-core-classroom-stage

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **白板 / 舞台层**的移植，按上游 TS 重写
（文件头标 `// 源：…:<行范围>`），**不含逐字节副本**。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无** |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/errors.js`（带 code 的领域错误族） | `lib/whiteboard/runtime/types.ts`、`lib/whiteboard/legacy-shape.ts` |
| `src/viewport.js`（`viewportRatio` 归一化） | `lib/whiteboard/viewport.ts` |
| `src/shapes.js`（形状路径 / 直线包围盒） | `lib/action/engine.ts` |

## 改动

- SVG path 解析改用本仓已有的 `svg-pathdata`，与上游实现等价但不复制其代码。
- 上游 `legacy-shape` 的兼容错误文案保留语义，中文化。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照 `lib/whiteboard/` 与 `lib/action/engine.ts` 检查 `// 源：` 注释；
3. 跑 `node --test tests/classroom*.test.mjs`。
