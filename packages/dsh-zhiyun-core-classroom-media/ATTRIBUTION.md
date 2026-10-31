# ATTRIBUTION — dsh-zhiyun-core-classroom-media

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **媒体车道**的移植，另有**一份第三方库的
逐字节副本**（`vendor/unpdf/`）。两者来源不同，分开说明。

## 一、OpenMAIC（重写，非副本）

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/index.js`（TTS / 配图服务封装） | `lib/audio/tts-selection.ts`、`lib/media/*` |
| `src/image.js` | `lib/server/generation/run/media.ts` 的图片分支 |
| `src/parse-pdf.js` | `lib/server/classroom-materials.ts` 的材料抽取口径 |

**改动**：音频/图片的生成走本仓宿主提供的服务，不连上游的 provider 配置；
材料解析改用下面的 `unpdf`（上游用的是另一套 PDF 栈）。

## 二、`vendor/unpdf/`（逐字节副本）

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/unjs/unpdf |
| 版本 | `1.9.1`（与本包 `optionalDependencies` 声明一致） |
| 许可证 | **MIT**（`vendor/unpdf/LICENSE`，Copyright (c) 2023-PRESENT Johann Schopplich） |
| 本地落点 | `vendor/unpdf/` = 上游 npm 包 `dist/` 的完整拷贝（161 个文件） |
| 改动 | **无**（逐字节） |

### 为什么 vendor 而不是 npm 依赖

本仓需要一个**不依赖原生模块**的 PDF 文本抽取。`unpdf` 的 `dist/` 是纯 JS（内含 pdfjs 的
worker），vendor 进来可以避免在宿主进程里跑 `postinstall`，也让离线部署不必访问 npm。

⚠ 它是 `optionalDependencies`：缺它时材料解析会以 `E_MATERIAL_UNAVAILABLE` 失败，
而不是让整个课堂域装不上。

### 升级流程

1. 从 npm 取新版本 tarball，替换 `vendor/unpdf/`（保留其 LICENSE）；
2. 同步 `package.json` 的 `optionalDependencies` 版本；
3. 更新本文件；
4. 跑 `node --test tests/classroom-media-budget.test.mjs`。
