# dsh-zhiyun-core-classroom-export

智云 Pro「互动课堂」的**导出层**。把 OpenMAIC 的 `lib/export`（9.2k）、
`lib/video-export`（5k）、`lib/video-export-app`（2.2k）搬成一个 Cordis 插件。

```
ctx.zhiyunClassroomExport.pptx(classroom, opts?)  → Buffer（.pptx，PK\x03\x04 开头）
ctx.zhiyunClassroomExport.html(classroom, opts?)  → string（完整文档，可直接进 <iframe srcdoc>）
ctx.zhiyunClassroomExport.zip(classroom, opts?)   → Buffer（classroom.html + 媒体 + README）
ctx.zhiyunClassroomExport.video(classroom, opts?) → 时间轴 + 字幕计划（注入渲染器才出片）
ctx.zhiyunClassroomExport.status()                → { state, version, detail }
```

`classroom` 可以是 `{ id }` / `'<id>'`（走 `zhiyunClassroomStudio.classroom.load(id)`），
也可以是 `{ stage, scenes, assets? }` 文档本体（页面包手上常有，省一次往返）。
所有方法都 `async`；`pptx()` / `html()` / `zip()` 还支持 `{ report: true }`，此时返回
`{ buffer|html, fileName, byteSize, slideCount|unresolvedMedia|entries, … }` 而不是裸产物
（给"体积超限 / 丢弃清单"用）。

## 四条纪律

1. **`inject: ['zhiyunClassroomStudio']` 只声明硬依赖**（`classroom-port.md` §4）：
   业务包只认服务，不认实现。
2. **`apply()` 永不抛**。宿主缺席、`provide` 撞名、日志桩不全 —— 一律降级，不白屏；
   缺宿主表现为 `status().state === 'degraded'` 与方法调用时的 `E_NO_STUDIO`。
3. **产物是成品，不是分片**。`html()` 从 `<!doctype html>` 到 `</html>` 已经拼好；
   `pptx()` / `zip()` 是 `Buffer`，不返回 Blob 也不返回待 `join` 的数组。
4. **不 import 别的包的 `src/`**（规范 §1 判据 3）。PPTX / HTML / ZIP 三条链路全部自带。

## 文件 → 上游源

| 本包文件 | 上游源（`ref/OpenMAIC/`） |
|---|---|
| `src/index.js` | 无（宿主接缝；方法名对齐 `classroom-port.md` §4 的 `export.pptx` / `export.html`） |
| `src/doc.js` | `lib/export/use-export-pptx.ts:1418-1425`（viewport → 比例）、`:557-560`（版式） |
| `src/manifest.js` | `lib/export/use-export-classroom.ts:174-330`、`classroom-zip-types.ts:11-154`、`:38-70`、`classroom-zip-utils.ts` |
| `src/assets.js` | `use-export-classroom.ts:118-215`、`build-standalone-html.ts:192-305`、`classroom-zip-utils.ts:1-465` |
| `src/pbl.js` | `lib/export/pbl-briefing.ts:1-54`、`lib/pbl/legacy/read.ts:206-223` |
| `src/video.js` | `lib/video-export/subtitles.ts:1-60`、`ir.ts:1-429`、`passes/timeline.ts:96-140`、`lib/choreography/timing.ts:113-130`、`lib/export/narration.ts:266-282` |
| `src/pptx/deck.js` | `lib/export/use-export-pptx.ts:530-1309`（`buildPptxBlob` 全文） |
| `src/pptx/placeholders.js` | `lib/export/pptx-scene-placeholders.ts:1-655` |
| `src/pptx/omml.js` | `lib/export/latex-to-omml.ts:1-91`（MathML→OMML 的 `postProcessOmml` 逐行照搬；映射表自写） |
| `src/pptx/rich-text.js` | `lib/export/pptx-rich-text.ts:1-141` |
| `src/pptx/html-parser.js` | `lib/export/html-parser/{types,lexer,parser,format,stringify}.ts`（himalaya 移植） |
| `src/pptx/svg-path.js` | `lib/export/svg-path-parser.ts:1-160`、`svg2base64.ts:1-58` |
| `src/pptx/geometry.js` | `packages/@openmaic/renderer/src/utils/element.ts:1-134`、`lib/utils/element.ts:190-193` |
| `src/pptx/colors.js` | `use-export-pptx.ts:62-74`（`formatColor`）等 |
| `src/pptx/i18n.js` | `lib/i18n/locales/{en-US,zh-CN}.json` 的 `export.placeholder.*` / `export.htmlPlayer.*` |
| `src/standalone/build.js` | `lib/export/standalone-html/build-standalone-html.ts:633-851`、`:58-63`、`:604-631`、`use-export-html.ts:22-50` |
| `src/standalone/assemble.js` | `standalone-html/assemble.ts:1-275` |
| `src/standalone/prepare-manifest.js` | `standalone-html/prepare-manifest.ts:1-531` |
| `src/standalone/contract.js` | `standalone-html/contract.ts:1-133` |
| `src/standalone/limits.js` | `standalone-html/limits.ts:1-240` |
| `src/standalone/order-scenes.js` | `standalone-html/order-scenes.ts:1-14` |
| `src/standalone/sanitize.js` | `lib/sanitize/scene-content.ts:1-260`、`standalone-html/rich-text.ts:1-212` |
| `src/standalone/iframe.js` | `lib/utils/iframe.ts:14-47`（STORAGE_SHIM） |
| `src/standalone/player.js` / `player-runtime.js` / `player.css` | 参考（只读）`lib/standalone-player/*`；**不是**上游 React 产物，见「已知降级」 |
| `src/inline/*` | `lib/export/inline-assets.ts:1-858`、`css-asset-parser.ts:1-379`、`html-asset-inventory.ts:1-335`、`parse-srcset.d.ts:1-10` |
| `src/zip/stored-zip.js` | `standalone-html/stored-zip.ts:1-183` |
| `vendor/pptxgen.cjs` | `packages/pptxgenjs/dist/pptxgen.cjs.js` 4.0.1（MIT，逐字节副本，仅改文件名，见 `ATTRIBUTION.md`） |
| `src/errors.js` | 自建（上游报错走 `toast`，服务端没有 toast） |

## 需要宿主提供什么

| 需要 | 用在哪 | 缺了会怎样 |
|---|---|---|
| `zhiyunClassroomStudio.classroom.load(id)` | 只传 id 时取课堂文档 | `E_NO_STUDIO` / `E_NOT_FOUND`；直传 `{stage,scenes}` 不需要 |
| **媒体字节 `assets`**：`ref → data:` 或 `ref → { bytes, mimeType }` | PPTX 内嵌图片/视频、HTML 内联、ZIP 落盘、视频源 | 拿不到的引用按上游口径**丢弃**并记进 `report.unresolvedMedia`；不报错、不占位 |
| `fetch`（可选） | `buildClassroomManifest` 展开互动页的 `@import` / 外链资产 | 默认用全局 `fetch`；离线环境里失败的记进 `report.inlineFailures` |
| `baseUrl`（可选） | 互动页里相对路径的基准 | 相对资源抓不到，同上记失败 |
| `playerAssets`（可选） | 用自己的播放器产物替换内置最小播放器 | 默认 `builtin`（`html()` 报告里会写明 `player: 'builtin'`） |
| `render(plan)`（可选，视频） | 宿主侧 ffmpeg + headless Chromium 渲染 | 只返回计划；`rendered: false`，`requires: ['ffmpeg','headless-chromium']` |

**不需要**临时目录：三条链路全在内存里（ZIP 是 stored 格式，手写 CRC-32）。
**不需要** ffmpeg / 浏览器：那是 `video()` 的 `render` 委派口，不是本包的活。
**不需要** PNG 编码器：占位页的二维码本包不画（见下）。

## 已知降级（评审时请逐条对照）

| 项 | 上游做法 | 本包做法 | 影响 |
|---|---|---|---|
| 视频渲染 | Hyperframes 合成 → Chrome 逐帧 → ffmpeg | 只交**纯编译**部分：与上游同构的时间轴 IR、同样的朗读估算与字幕推导、SRT/VTT 序列化，外加 `render` 委派口 | 不注入渲染器就出不了 mp4，且**不假装成功** |
| 内置播放器 | `public/vendor/standalone-player/player.min.js`（React，页面包编译） | 自带一份等价最简 IIFE（幻灯片文本/形状/图片/图表/表格/公式/视频、互动页 iframe、测验、PBL 简报、翻页与键盘） | 观感与交互细节弱于上游；`playerAssets` 注入即可整体替换 |
| MathML→OMML | `mathml2omml` npm 包 | 自写映射（`mrow/msup/msub/msubsup/mfrac/msqrt/mroot/mtable/mover/munder/munderover`，未知标签解包） | 罕见结构（`menclose`、`mmultiscripts`）会退化成线性文本 |
| LaTeX→OMML | 同上的 `temml` 两步 | 同（`temml` 已在仓库 node_modules），失败返回 `null` | 无 |
| 二维码 | `uqr` + 手写 PNG | 不生成、也不接 `qrDataUrl`（`deck.js` 里恒传 `undefined`） | 在线课堂占位页只有一个热点框与 URL 文本，没有可扫的图 |
| `sanitize-html` | npm 包 | 同一份白名单在自带 AST 上实现 | 行为等价，属性顺序可能不同 |
| `parse-srcset` | npm 包 | 自写解析 | 语法边界（带逗号的 data: URI）按 srcset 规范处理 |
| `svg-arc-to-cubic-bezier` | npm 包 | `svg-pathdata` 的 `aToC()`（已在仓库） | 无 |
| 视频首帧 | `<video>` + canvas 抓 poster | 只用现成 poster | 没有 poster 的视频在 PPT 里显示默认播放键 |
| `jsdom` / 浏览器 DOM | 有 | 无：全部字符串扫描 + AST | 无 |

## 依赖边界

- **`pptxgenjs` 走 vendor**：`vendor/pptxgen.cjs` 是 `ref/OpenMAIC/packages/pptxgenjs/dist/pptxgen.cjs.js`
  4.0.1 的逐字节副本（仅改扩展名，见 `ATTRIBUTION.md`）。`type: module` 下 `.js` 会被当 ESM，
  CJS 的 `module.exports` 会丢，必须 `.cjs`。
- **零新增 npm 依赖**：`temml@0.14.0`、`svg-pathdata@8.0.0`、`tinycolor2@1.6.0` 用仓库已装的
  版本（均为 MIT，随 `package-lock.json` 锁定）。`tinycolor2` 经 `createRequire` 取，取不到时
  退化到 hex/rgb 解析。
- 本包**没有** `dependencies` 字段，也没有浏览器半边：它只在宿主进程里跑。

## 测试

```
node --test tests/classroom-export.test.mjs
```

fixture 是上游 `tests/fixtures/standalone-html-classroom.ts` 的 JS 版
（`tests/fixtures/classroom-standalone.mjs`）：一场景一类型、**故意乱序存放**、标题里带
`<Light> & "Life"`、测验题干里带 `</script><!--`、互动页脚本里带转义过的 `</script>`、
一张有字节的图 + 一张只有 URL 的图。

断言的是结构与内容，不是"看起来像"：

- `html()`：`<!doctype html>` 开头、`</html>` 结尾、`<style>` 内联、`src|href|poster` 里
  没有一个 `http(s)`、远程图被丢弃且**从清单里消失**、场景按 `order` 重排成
  slide→interactive→quiz→pbl、`<ul><li><p>` 在清洗后逐字节保留、每个 `<script>` 都能被
  `new Function` 解析（srcdoc 里没有构建期转译）；
- `pptx()`：`PK\x03\x04` 开头、`JSZip` 能解开、含 `ppt/presentation.xml` 与
  `[Content_Types].xml`、4 张页（1 真页 + 3 占位页）、首页含富文本、`<m:oMath>` 与
  `Cambria Math`、旁白进了演讲者备注；
- `zip()`：`classroom.html` + `README.txt` + `images/image-1.png`，页面 CSP 换成
  `img-src 'self' data: blob:`；
- `video()`：时间轴累加、`1` 条字幕、`WEBVTT` 头、`estimated-duration` 诊断；
- 插件形状：`apply()` 不抛、`dispose` 能注销、缺宿主报 `E_NO_STUDIO`、按 id 加载、
  `provide` 抛错不炸。
