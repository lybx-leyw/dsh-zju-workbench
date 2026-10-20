# dsh-radar-dom-parse —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-20 · 第三十八轮），**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `parse()` / `executionToken()` 直接抛 `NOT_IMPLEMENTED`，
> TODO 未落实。**请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [cheeriojs/cheerio](https://github.com/cheeriojs/cheerio) |
| npm | `cheerio@1.2.0`（锁版，**不用 `^`**） |
| **入口** | **`cheerio/slim`** —— ⚠ 不是包根，原因见下「入口选择」 |
| 许可证 | **MIT** ✅（npm 元数据与仓库 `LICENSE` 一致） |
| 作者 | cheeriojs / Felix Böhm |
| Stars | ★30,523（2026-10-20 取，`html parser` 检索第 1 名） |
| 体积 | npm `unpackedSize` **1,011,246 B**；esbuild（minify/ESM/browser）实测 **`./slim` 199,966 B**、包根 384,451 B |
| 版本 | npm `latest` = `1.2.0`，本包锁 `1.2.0`（升版须重跑 TODO-6 夹具） |
| 语言 | TypeScript 源码，发布 ESM + CJS |
| `engines` | `node >= 20.18.1`；本仓根要求 `^22.19.0 \|\| >=24.0.0` → **兼容 ✅** |
| 形态 | **纯库**，不是 DSH 插件 —— 本包是 **B 类**（能力提取 + 封装） |
| 首次发现 | 2026-10-20（第三十八轮 · B 组派生 · 校园数据「抓取后解析层」轴） |

### 入口选择（这是本轮最重要的一条技术判断）

包根的 `dist/esm/index.js` **第 11 行静态 `import * as undici from 'undici'`**（实测确认），
只为 `fromURL()` 提供「按 URL 抓取」。`undici` 是 Node 专用实现，浏览器 bundle 里没有 ——
一个无条件的 Node-only 依赖会让本仓的客户端构建失败。

`cheerio/slim` 的导出面是 `load / html / xml`，`^import` 里**没有** `undici`。
本包本来也不需要 `fromURL()`（HTML 一律由 `dsh-zhiyun-classroom` 的 transport 取回，
解析层只接字符串），所以在 slim 上**能力等价、体积减半**，不是妥协。

> ⚠ 但 `npm i cheerio` 仍会把 `undici`（~2.1 MB）装进 `node_modules` —— 那是**安装体积**，
> 不进 bundle。评审时别把两者混为一谈。

---

## 集成方式：**强化式集成**（不是「全新」）

**与现有功能的关系：重复且可强化 ✅**

本包**不新增页面、不新增导航项、不改任何 UI**，只给「智云课堂」登录链路换一层实现。

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 登录框、登录结果都没变；改的是「节点登录」内部的表单提取 |
| ② 功能仍相似正交 | ✅ | 都回答「这一页里 `<input name=execution>` 的值是什么」 |
| ③ 底层多调了更优质实现 | ✅ | 见下「现有实现缺什么」 |

### 现有实现缺什么（2026-10-20 实测，非自述推断）

`packages/dsh-zhiyun-classroom/src/auth.js:27`：

```js
export function executionToken(html) {
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) { const a = attributes(tag); if (a.name === 'execution') return a.value; }
  return null;
}
```

把这段原样复制进夹具（**不改一行**），对同一批合法 HTML 跑：

| 夹具 | 本仓正则 | `cheerio/slim` | `linkedom` |
| --- | --- | --- | --- |
| `<input name="execution" value="e1s1"/>` | `"e1s1"` | `"e1s1"` | `"e1s1"` |
| `<input value="a>b" name="execution">` | **`undefined`** | `"a>b"` | `"a>b"` |
| `<input name="execution" value="abc&amp;def">` | `"abc&amp;def"` | `"abc&def"` | `"abc&def"` |
| `<input value="e2s1" type="hidden" name="execution">` | `"e2s1"` | `"e2s1"` | `"e2s1"` |
| `<input type="hidden" NAME="execution" value="e3s1">` | `"e3s1"` | `"e3s1"` | **`null`** |

断点在第 2 行：`executionToken()` 返回 `undefined` → `submitCasForm()` 抛
`AUTH_SHAPE: 登录页缺少 execution` → **登录直接失败**。根因是 `[^>]*` 用 `>` 界定标签边界，
而 `>` 在双引号属性值里是合法字符（HTML5 允许）。

第 3 行是**静默错值**：`&amp;` 原样进 `URLSearchParams`，上游收到双重转义。
CAS 的 execution 通常是 `e1s1` 形态，所以今天没炸 —— 属「今天不炸、改版就炸」。

第 5 行是**选 cheerio 而非 linkedom 的实证**：`linkedom` 的选择器对属性**名**大小写敏感
（`NAME=` 匹配不到 `[name=execution]`），cheerio 按 HTML 规范把小写化，能命中。

---

## 集成边界（评审必须逐条确认）

1. **只读不写**。本包不调 `$.html()` 回写 —— 回写会重排隐藏域、吞注释，
   对 CAS 页面属于「不该动的动了」。
2. **不发请求**。`fromURL()` 明确不用；抓取归 transport（那里才有 cookie jar、
   HTTPS 白名单、超时与取消）。解析层自开网络出口 = 登录链路上第二个出口。
3. **契约不变**。`executionToken()` 签名、返回 `string|null`、`AUTH_SHAPE` 抛错位置全部不变。
   ⚠ 唯一差异：现状在「有标签但无 value 属性」时返回 `undefined`，新实现返回 `null` ——
   调用点 `if (!execution)` 两者都能过，但这属于**返回类型收窄**，须写进 PR。
4. **不碰 `nextLocation()`** 的首要改造。它的 meta refresh 解析另算（TODO-3），
   且会带来「原来抛错、现在成功跳转」的行为变更，**不得**与 TODO-2 混一个 PR。

---

## 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| R-1 | **`auth.js` 是已上线代码**，替换内部实现属于回归风险最高的一类改动 | TODO-0：先跑 `npm run test:classroom`，再补夹具；不通过不回退到正则「凑答案」 |
| R-2 | **解析放在哪一端**：CAS 登录页由服务端 transport 取回，客户端没有这份 HTML → 本包实际只用得上**服务端**份额，客户端 bundle 里它可能是死代码 | 若最终只在宿主进程用，可 `devDependencies` 化或直接内联，不必进首屏 bundle —— **这会改变 TODO-5 的验收线** |
| R-3 | **体积**：`./slim` 未压缩 200 KB | TODO-5 复测 gzip；若只服务端用则放宽 |
| R-4 | 与在册 `dsh-radar-vault-parse`（markdown-it）语义重叠？ | **不重叠**：那个解决 Markdown（`[[双链]]`/`#标签`），本条解决 HTML（登录页表单）。两者都属「正则 → 结构化解析」，但**输入语言不同、失败面不同**，不可合并 |
| R-5 | 与 `dompurify`（本轮 🔵）关系？ | **不同问题**：sanitizer 是「把不可信 HTML 变安全」，解析器是「把 HTML 变可查询」。上了 cheerio **不等于**可以不做净化 |

---

## 目录

```text
packages/dsh-radar-dom-parse/
├── package.json       # 锁版 cheerio@1.2.0
├── cordis.patch.yml   # 只 insert 自己（B 类，无上游 Loader 行）
├── src/index.js       # 占位：provide radarDomParse，parse()/executionToken() 抛 NOT_IMPLEMENTED
├── src/upstream.js    # 锁版凭据 + 入口选择理由 + 上游不变量（单一真源）
├── OWNERS             # Owner: shared
└── README.md          # 本文件
```

## 为什么不做 A 类

本轮 A 组（原生 DSH 插件）**零命中**：`zju comment scraper javascript` 与
`html query selector language:typescript` 均 `total_count = 0`，其余命中全是库。
B 组「校园信息侧」已于 10-19 第三十三轮封板，本轮沿用「先读码找断环、再定向搜」，
找到的是**本仓自己的断环**，不是生态里的新插件 —— 所以候选天然是 B 类。
