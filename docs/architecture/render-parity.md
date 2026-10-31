# 渲染层与导出层的「一致性」真凭据

本文件说明 `scripts/classroom-render-parity.mjs` 判什么、怎么判、哪些差异是合法的、
哪些是真缺陷。它是 `docs/architecture/classroom-port.md` §1 判据 2（观感等价）在
**渲染层与导出层**上的可执行版本：那边写「同一场景在两边渲染出的 DOM 文本一致」，
这里把它落成一条跑得起来、会红的命令。

```
node scripts/classroom-render-parity.mjs [--doc <path>] [--reference <path>] [--json]
```

- `--doc`：被测文档。产物（HTML/PPTX）由它生成。
- `--reference`：判分基准文档。缺省是 `fixtures/classroom-render-parity/classroom.json`，
  与 `--doc` 的缺省值同一份。
- 退出码：`0` = `identical`/`equivalent`，`1` = `divergent`/`broken`，`2` = 用法错误。

## 为什么需要两份输入

维度 1（双渲染）是「两套实现比同一份文档」，天然自洽。维度 2/3 是「产物比文档」：
如果只有一个输入，删掉一个场景后产物也会跟着少一页，**自比永远 identical**，闸门
就抓不到回归。所以产物一律拿 `--doc` 生成、拿 `--reference` 判分。两者相同（默认）
时，这两维退化成「导出是否把文档原样搬进产物」——仍有意义：漏字段、漏场景、
丢 LaTeX 都会红。

## 三个维度与判定规则

分级口径与 `scripts/classroom-golden-parity.mjs` 一致，取三维中最差一级：

| 级别 | 含义 |
|---|---|
| `identical` | 逐场景、逐行都对上（行序也一致） |
| `equivalent` | 文本齐全，但行序 / 段落边界 / 空白不同 |
| `divergent` | 缺场景、缺行、改字、页数不对、公式数不对 |
| `broken` | 文档读不开、渲染抛错、zip 解不开、清单 JSON 坏 |

### 1. render：上游 renderer vs vendor renderer

- 取 `--doc` 里 `type === 'slide'` 的场景，按 `order` 排序。
- 两侧分别用 `react-dom/server` 的 `renderToStaticMarkup` 渲染 `SlideCanvas`，
  props 完全相同（只有 `slide = scene.content.canvas`）。
  - 上游：`ref/OpenMAIC/packages/@openmaic/renderer/dist/index.js`
  - 我们：`packages/dsh-zhiyun-classroom-renderer/vendor/renderer/index.js`
- 抽文本：去 `<script>/<style>` → 去标签 → 解 HTML 实体 → 去零宽 → 压空白。
  `<style>` 必须去掉，因为 `SlideCanvas` 会把 `SLIDE_RENDERER_STYLES` 内联进产物。
- **主断言是文本多重集相等**（排序后逐项比），不是字符串相等。顺序差异落
  `equivalent`；缺字/多字落 `divergent`，并给出第一个不同行的前后文。
- 附带的硬信号：两侧 markup **逐字节相同**（当前 fixture 2/2）。这条比文本更严，
  但它只在「同一份 dist 被 vendor」时才成立；换成不同版本的 dist 后它会先红，
  提醒你去看文本多重集是否仍然 `identical`。
- 非 slide 场景不在这里比：上游 `@openmaic/renderer` 只导出幻灯片渲染面
  （`SlideCanvas` / `SlideElement` / effects），quiz / interactive / pbl 走播放器
  页面与 iframe，不是这个包的渲染树。它们由维度 2/3 兜住。

### 2. html：`ctx.zhiyunClassroomExport.html(doc)`

- `html(doc, { lang })` 产出完整单文件文档（`<!doctype html>` 开头），从里面取两样：
  1. **静态 DOM 文本**：去 script/style 后的可见文本；
  2. **内嵌清单 payload**：`<script id="openmaic-classroom">{…}</script>` 的 JSON。
- 判据：`--reference` 的每个场景（按「类型 + 序号」配对）的标题与正文，都必须能在
  上面两样里找到；场景缺失直接 `divergent`，并报它在文档里的下标。
- 逐场景还比一次多重集（文档场景的可见行 vs 清单里同场景的可见行），用来抓
  「场景在、字段被吞」这类问题。
- 场景齐全但顺序变了 → `equivalent`。

> **为什么把 payload 算进「可见文本」**：这份 HTML 是播放器壳，正文装在清单 JSON 里，
> 由内联的 player 脚本在浏览器里渲染。静态 DOM 里只有 `<noscript>` 提示与课堂标题
> （fixture 上是 3 行）。只看静态 DOM 会得出「一个场景都没有」的假结论；只看 payload
> 又测不出壳损坏。两者相加才等于「这个文件真正带着的内容」。

### 3. pptx：`ctx.zhiyunClassroomExport.pptx(doc)`

- 用 `node:zlib` + 手写中央目录读取（复用 `classroom-golden-parity.mjs` 的
  `readPptxStructure`，仓库不新增依赖），读 `ppt/slides/slideN.xml` 的 `<a:t>`。
- **页数判定**：`页数 = 可导出场景数`。可导出 = `slide` / `quiz` / `pbl` /
  带 `content.html` 的 `interactive`（与 `pptx/placeholders.js` 的 `pptxDeckScenes`
  同一条规则；没有 html 的互动页无从生成占位，会被跳过）。fixture 五类全可导出，
  所以就是 `5 页 = 5 个场景`。
- **每页文本**：`slide` 页要比对画布文本元素与表格单元格；`quiz` 页比标题 + 题干
  （最多 4 条）；`interactive` 页比标题；`pbl` 页比标题 + 目标 + 里程碑标题。
  判定用的是「该行在页内出现（整行命中，或去空白后作为子串命中）」，因为 PPTX 会
  把一段拆成多个 run。
- **OMML**：`<m:oMath>` 数必须等于该页 LaTeX 元素数（跳过的 LaTeX 只计数，不比字面量
  ——它不在 `<a:t>` 里）。fixture 是 1 个（第 1 页的 `6CO_2+6H_2O→…`）。
- 期望页比实际多/少 → `divergent` 并报两侧页数。
- 场景换序（页数不变、每页文本都在别的页上）→ `equivalent`；此时逐页配对会错位，
  所以整个 deck 的 OMML 总数再单独核对一次（少一个都算 `divergent`）。

## fixture：`fixtures/classroom-render-parity/classroom.json`

一份 5 场景的最小课堂，四类场景齐全，另加一张幻灯片让「多重集」真的有多场景可比：

| 序 | 场景 | 为什么在这个位置 |
|---|---|---|
| 0 | slide「光合作用总览」 | 富元素：标题、列表、柱状图、LaTeX。给双渲染与 OMML 用 |
| 1 | quiz「随堂检测」 | 两题 + 选项 + 题干里带 `</script>` 与注释，验证清洗不吞字 |
| 2 | interactive「光照强度实验」 | 自带 `<style>/<script>` 的小页面，验证 html 抽取不把脚本当正文 |
| 3 | pbl「设计一间温室」 | 项目/角色/两个里程碑，验证目标与里程碑进占位页 |
| 4 | slide「课堂小结」 | 表格 + 内联字符 + 文本里的零宽字符 `\u200b` |

判分基准数字（`node scripts/classroom-render-parity.mjs` 的当前输出）：

```
render  identical  2 张幻灯片 / 11 个文本节点 / markup 逐字节相同 2/2
html    identical  37937B / 5 个场景 / 覆盖 37/37 行（静态 DOM 3 行 + 清单 127 串）
pptx    identical  5 页 = 5 个可导出场景 / 28 个文本节点 / 覆盖 19/19 行 / 1 个 OMML
```

## 双渲染：怎么让两边用同一个 React

上游 dist 内部 `import 'react'` 解析到
`ref/OpenMAIC/node_modules/.pnpm/react@19.2.3/node_modules/react`（React 19），
vendor 解析到仓库根的 `node_modules/react`（React 18.3.1）。两个实例的
`ReactCurrentDispatcher` 不是同一个，渲染时直接
`TypeError: Cannot read properties of null (reading 'useContext')`。

处理方式（脚本 `alignReact()`，**不改上游 node_modules、不落临时文件**）：

1. `createRequire(仓库根/package.json).resolve('react')` 拿到「我们的」React 绝对路径；
   `createRequire(上游 dist 入口).resolve('react')` 拿到「上游会解析到的」路径。
2. 两者不同 → 用 `module.register()` 挂一个 **data: URL** 的 ESM loader，把
   `react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom`、
   `react-dom/server`（含 `.node`）、`react-dom/client` 全部 alias 到仓库根那几个文件
   （只 alias 仓库里实际存在的）。
3. **必须先挂 loader，再 `import('react-dom/server')`**：`register()` 只对之后的
   `import()` 生效。脚本里没有任何静态 `import 'react-dom/server'`，就是为了守住这一点。
4. 报告里的 `environment.react` 会写明两个原始路径、是否 alias、alias 到哪、
   alias 后的 `reactVersion`；JSON 里可复查。

复现某一侧的真实解析路径（不依赖本脚本）：

```
node -e 'const {createRequire}=require("node:module");
console.log(createRequire("/abs/repo/package.json").resolve("react"));
console.log(createRequire("/abs/repo/ref/OpenMAIC/packages/@openmaic/renderer/dist/index.js").resolve("react"));'
```

**已知风险（如实记录）**：alias 让上游 dist 跑在 React 18 上，而上游是按 React 19
编译的。本次 fixture（文本/表格/图片/图表/LaTeX/effects 壳）渲染结果与 vendor 逐字节
相同，说明用到的 API 面是 18/19 共有的；若将来上游 dist 用上 React 19 独有的 API
（`use`、`useOptimistic` 等），这里会先以 `broken`（渲染抛错）暴露，而不是静默错渲染。
届时正确解法是把本仓 React 升到 19，而不是在本脚本里做降级 shim。

另一处细节：`SlideCanvas` 里 `useLayoutEffect` 在 SSR 下会刷警告，脚本把
`console.error` 临时接管并只计数（`render.warnings`），不当作失败——它不影响
静态标记。

## 已知的合法差异（不影响「效果一致」）

逐条说明，**这些不该被判成 divergent**，脚本也按此实现：

| # | 差异 | 为什么不影响效果 | 脚本怎么处理 |
|---|---|---|---|
| 1 | class 名不同（`.slide-renderer-*` vs 我们的 `.zyc-*` 包裹层） | 类名只是样式作用域，视觉由 CSS 规则决定。维度 1 比的是**文本**与**标记字节**，不是选择器语义；包裹层不在比对范围内（两侧都直接渲染 `SlideCanvas`） | 只比文本多重集 + markup 字节 |
| 2 | 空白/换行/缩进不同（HTML 序列化、PPTX run 切分） | 排版由 `white-space`/段落属性决定，折叠空白不改变视觉 | 压空白后再比；空白差落 `equivalent` |
| 3 | `data-*` 属性（`data-indent`、`data-inline-math`、`data-element-id`） | 这些是渲染器的内部钩子，不产生可见文本 | 抽文本时整段丢弃标签，不参与比对 |
| 4 | 零宽字符（`\u200b` 等） | 不占宽、不可见；常被编辑器当光标锚点插入 | 归一化时删除，夹具里刻意放了 `课堂小\u200b结` |
| 5 | PPTX 里图表是**图片**（`chartImages`） | 图表标签在像素里，不是文字节点；视觉与 HTML 一致 | PPTX 维度只比文本元素与表格，图表标签不计 |
| 6 | quiz 占位页只放**题干**，不放选项与答案 | 选项/答案属于答题交互，deck 里刻意排除（防止答案随课件外流） | quiz 页期望 = 标题 + 题干 |
| 7 | 占位页出现本地化标签（`测验`、`互动页面`、`目标：`、`[Formula]`） | 播放器/deck 的界面文案，不是文档内容；不影响「文档里的字都在」 | 覆盖式判定：文档行必须在，额外标签不扣分 |
| 8 | `interactive` 页正文只在 HTML/在线页里，PPTX 只给标题与跳转 | 互动页是 iframe 应用，deck 里放不下可交互内容；这是上游同一取舍 | PPTX 只要求标题 |
| 9 | 标题/里程碑超宽被截断（带 `…`） | 上游同一截断策略（`Intl.Segmenter`），超出部分在在线页可见 | 行命中失败时退到「前 12 个非空白字符」前缀命中 |
| 10 | 场景 `id` 不写进 HTML 清单 | 清单按播放顺序存场景，id 是宿主内部字段；文本与结构都在 | 配对按「类型 + 序号」，不比 id |

## 真差异（不是上面那类，已确认是缺陷）

1. **幻灯片文本里的 HTML 实体被二次转义**（`standalone/sanitize.js:70 escapeText`）。
   文档里 `content: "<p>光 &amp; 水</p>"` 经 `html()` 后，清单中是
   `"<p>光 &amp;amp; 水</p>"`，播放器会显示 `光 &amp; 水` 而不是 `光 & 水`。
   实测位置：第 5 个场景（slide「课堂小结」）的
   `content.canvas.elements[id=takeaway].content`。
   这是 AST 重建路径没有先解实体、再按文本转义的后果；上游 `sanitize-html` 会先解后编。
   本仓不改 `packages/`，因此**夹具里改用字面 `&`**，让基线保持 `identical`；
   这是已知缺陷，修的是导出包，不是这台闸门。
2. **React 版本面**：上游 dist 是按 React 19 编译的，本仓是 18.3.1（见上节）。
   当前渲染面完全覆盖，属于「已隔离的风险」而非缺陷；一旦上游用上 19 独有 API
   就会以抛错形式暴露。

## 与 `classroom-golden-parity.mjs` 的分工

| | golden-parity | render-parity（本文件） |
|---|---|---|
| 输入 | 两份**已落盘**的产物目录 | 一份**文档** + 一个基准文档 |
| 是否真的渲染 | 否（只读 html/pptx 文本） | 是（上游 + vendor 各渲一遍） |
| 能否发现「两边都错」 | 不能（只比两份产物） | 能（产物要对得上文档） |
| 用途 | 产物对产物（回归/换版） | 实现对实现 + 产物对文档 |

两者互补：golden 管「同一份输入，产物有没有变」，本工具管「产物是不是这份文档、
vendor 是不是上游」。

## 自测

```
node --test tests/classroom-render-parity.test.mjs
```

7 例：基线 `identical`；删场景 → `divergent` 且点名第 4 个（pbl）；换序 → `equivalent`；改一个字 →
`divergent` 且给出「文档=… / 产物=…」片段；坏 JSON / 幻灯片没 canvas → `broken`；
用法错误 → 退出码 2；render 维度确实用了两套 dist 且 React 收敛到同一实例。
