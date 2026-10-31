# ATTRIBUTION — dsh-zhiyun-classroom-renderer

本包的 `vendor/renderer/` 目录是**上游构建产物与字体样式的原样副本**，不含任何本地改动。
本仓新增的只有 `src/index.js`（宿主半边，仅元数据）、`src/client.jsx`（浏览器半边，
透出上游组件 + 一个最小渲染出口）、`src/style.css`（`.zyc-` 样式边界）、`package.json`。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游包 | `packages/@openmaic/renderer` |
| 上游版本 | `0.2.0` |
| 上游 commit | `0ae3215e965412b8ee536feaa5d98f75b7a70923` |
| 许可证 | MIT（全文见 `vendor/renderer/LICENSE`） |
| 版权 | Copyright (c) 2026 THU-MAIC |
| 本地落点 | `vendor/renderer/` = 上游 `packages/@openmaic/renderer/dist/` 全部内容 + `fonts.css` |

## 为什么是 vendor 而不是 fork

`docs/architecture/classroom-port.md` 第 3 节把 `@openmaic/renderer` 归为
**vendor + 客户端产物**，通道 4 又明确要求「只换壳（路由→插槽、全局布局→外壳），
**不重写渲染树**」。渲染树是本项目里判据 2（观感等价）唯一的落点，重写它等于
自己造一个「看起来像」的渲染器。

## 依赖边界

上游 `peerDependencies` 与 `dependencies` 原样保留为**真实依赖**（规范第 2 节通道 5：
第三方原样保留，禁止顺手换成自家实现）：

| 包 | 版本 | 处理 |
| --- | --- | --- |
| `react` / `react-dom` | 宿主提供 18.3.1 | **external**（`dsh.client.external`），由 `HOST_SEEDS` 提供 |
| `motion` | 12.35.2 | 打进 bundle |
| `echarts` | 6.0.0 | 打进 bundle |
| `shiki` | 3.23.0 | 打进 bundle |
| `katex` / `lucide-react` / `clsx` / `tailwind-merge` / `tinycolor2` | 上游实测版本 | 打进 bundle |
| `html-to-image` / `html2canvas-pro` | 上游实测版本 | 打进 bundle（snapshot 子路径使用） |
| `tailwindcss` | 4.x | 不在构建期引入：上游 dist 只发 Tailwind 4 类名，编译在样式装配层 |

上游 dist 里的 `@openmaic/dsl` 与 `@openmaic/geometry` 裸导入**未改写**，而是通过
`package.json` 的 `file:` 依赖指向本仓 L0 的两个 vendor 包（npm workspaces 会把它落成
`node_modules/@openmaic/*` 链接）。这样上游代码保持逐字节原样，解析交给包管理器。

## 字体（`fonts.css`）

上游 `fonts.css` 是生成的 `@font-face` 表，`src` 指向外部字体主机
`https://file.maic.chat/fonts/<name>.woff2`，woff2 **不随包分发**。这是**硬运行时依赖**：
字体主机不可达或被 CORS 拒绝时，浏览器会静默回落到系统字体（不报错，只是字形与
度量不同 —— 正好会让判据 2 的截图 diff 漂移）。需要自托管时改上游
`fonts.config.mjs` 的 `FONT_CDN_BASE_URL` 并重新生成，再替换本目录的副本。
