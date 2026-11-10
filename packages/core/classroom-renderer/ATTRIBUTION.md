# ATTRIBUTION — @lybx-leyw/dsh-zju-core-classroom-renderer

本包曾 vendor 上游 `@openmaic/renderer` 的编译产物，**2026-10-31 已改为本仓自研**；
`vendor/renderer/` 已删除。

> **2026-11 变动**：自研渲染组件 `slide.jsx` 连同它的样式一起搬到了
> `packages/client/ui-shared/src/classroom-slide.jsx` —— 它 `import React` 并产出
> DOM，按分层属于 UI 层，不该住在 `core`。本包现在只剩画布常量
> （`VIEWPORT_SIZE` / `VIEWPORT_RATIO`）。下面关于「自研 4 类元素」的记录
> 仍然有效，只是实现位置变了。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游包 | `packages/@openmaic/renderer` |
| 上游版本 | `0.2.0` |
| 上游 commit | `0ae3215e965412b8ee536feaa5d98f75b7a70923`（vendor 时的提交） |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无**（已于 2026-10-31 删除，246 文件 / 1.5 MB） |

## 现状

渲染器是**独立实现**的，只支持 4 类元素（`text` / `shape` / `image` / `latex`）。
这个分类不是随手定的 —— 生成侧 `core-classroom-generate/src/prompts.js` 的
`SCENE_SYSTEM.slide` 原话就是「只用 text / shape / image / latex 四类」。
实现现在在 `@lybx-leyw/dsh-zju-ui-shared`（`src/classroom-slide.jsx`）。

上游另外 7 类（chart / table / code / audio / video / snapshot / 任意 SVG path）
在整条链路里**没有任何生产者**，为它们维护 1.5 MB 编译产物没有回报。

## 沿用了上游的什么

**设计，不是代码**：画布坐标系（1000 × 0.5625）、元素字段命名、上面那 4 类的划分。
这些是接口约定层面的沿用；实现是本仓的 React 组件 + CSS + KaTeX。

上游 `fonts.css` 指向的外部字体主机 `https://file.maic.chat/fonts/` **不再依赖**。

## 与上游的差别（有意）

| 方面 | 上游 | 本仓 |
| --- | --- | --- |
| 元素类型 | 11 类 | 4 类（覆盖全部生产者） |
| 渲染依赖 | motion / echarts / shiki / tailwind | React + CSS + KaTeX |
| 字体 | 外部 CDN | 系统字体栈 |
| 体积 | 246 文件 / 1.5 MB | 单文件组件 |

## 升级策略

**不再跟随上游**。若将来需要上游的额外元素类型，应在新实现里补，而不是恢复 vendor。
