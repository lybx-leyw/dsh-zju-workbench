# ATTRIBUTION — dsh-zhiyun-core-classroom-export

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 导出层的移植，**不是**上游产物的副本：
`src/` 下的 JS 是逐函数对照上游 TS 重写的（每个文件头写了 `// 源：…:<行范围>`），
唯一的逐字节副本是 `vendor/pptxgen.cjs`。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0（本地快照 `ref/OpenMAIC/`，只读） |
| 许可证 | MIT（`ref/OpenMAIC/LICENSE`，Copyright (c) 2026 THU-MAIC） |
| 移植范围 | `lib/export/`（9.2k）、`lib/video-export/`（5k）、`lib/video-export-app/`（2.2k）的**纯编译部分**；`lib/sanitize/scene-content.ts`、`lib/utils/iframe.ts`、`lib/i18n/locales/*.json` 的相关条目 |

## 逐字节副本

| 路径 | 上游来源 | 许可证 | 改动 |
| --- | --- | --- | --- |
| `vendor/pptxgen.cjs` | `ref/OpenMAIC/packages/pptxgenjs/dist/pptxgen.cjs.js` = [pptxgenjs](https://github.com/gitbrent/PptxGenJS) `4.0.1` | MIT，Copyright (c) Brent Ely；包内含 Microsoft Corporation 的 MIT 许可片段（见文件头） | **仅改文件名**（`.cjs.js` → `.cjs`）。`package.json` 是 `type: module`，`.js` 会被当 ESM 解析，CJS 的 `module.exports` 会整个丢掉，`require` 只能拿到空对象 |

该 bundle 在运行时会 `require('jszip')`（pptxgenjs 自己的依赖，MIT）。本包不声明
`dependencies`，`jszip` 由仓库根 `node_modules` 提供（`package-lock.json` 已锁定）。

## 运行时用到的仓库既有依赖（未新增）

| 包 | 版本 | 许可证 | 用在哪 |
| --- | --- | --- | --- |
| `temml` | 0.14.0 | MIT | LaTeX → MathML（再经本包映射成 OMML）；动态 `import()`，失败返回 `null` |
| `svg-pathdata` | 8.0.0 | MIT | 幻灯片形状的 SVG path 展平成 pptxgenjs 的点集（`toAbs().normalizeHVZ().aToC()`） |
| `tinycolor2` | 1.6.0 | MIT | 颜色解析/混色（`createRequire` 取，取不到退化为 hex/rgb 解析） |

## 有意**未**引入的上游依赖

| 上游依赖 | 本包替代 | 原因 |
| --- | --- | --- |
| `mathml2omml` | `src/pptx/omml.js` 自写映射 | 不在仓库，且不新增依赖；`postProcessOmml` 仍逐行照搬上游 |
| `sanitize-html` | `src/standalone/sanitize.js`（同一份白名单 + 自带 AST） | 同上 |
| `parse-srcset` | `src/inline/srcset.js` | 同上 |
| `svg-arc-to-cubic-bezier` | `svg-pathdata` 的 `aToC()` | 仓库已有等价实现 |
| `uqr` + 手写 PNG | 调用方传 `qrDataUrl` | 同上；缺省时不画二维码 |
| `jsdom` / 浏览器 DOM | 字符串扫描 + AST | 服务端没有 DOM |
| `html2canvas` / 视频首帧抓取 | 只用现成 poster | Node 没有 canvas |

## 未搬运的部分

- **视频渲染**（Hyperframes 合成、Chrome 逐帧、ffmpeg 编码）：依赖浏览器与外部二进制，
  且 `lib/video-export-app/` 是 React 前端，属于页面包的产物。本包只交付时间轴/字幕
  与 `render(plan)` 委派口。
- **上游 React 播放器**（`public/vendor/standalone-player/player.min.js`）：构建产物，
  由页面包负责。本包 `src/standalone/player-runtime.js` 是**独立实现**的等价最简播放器
  （只参考了 `lib/standalone-player/*` 的数据契约与交互语义，未复制其代码），可被
  `playerAssets` 注入整体替换。
- **`appAttributionHeaders`**：那是 OpenMAIC 的产品署名，本仓不冒充上游产品。
