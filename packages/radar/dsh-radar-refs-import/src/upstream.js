/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 效法 `packages/dsh-radar-ics-export/src/upstream.js` 与
 * `packages/dsh-zhiyun-host-paper/src/upstream.js`：本包不直接 import 上游，
 * 而是留一个**窄接口**（`loadUpstream()` + 三个翻译函数），把所有
 * 「上游长什么样、有什么怪癖」的知识关在这一个文件里。
 *
 * 这样做的三个理由：
 *   ① 单测里能注入假解析器（不装上游也能跑通上层逻辑）；
 *   ② 上游换版本 / 换实现时只改这一个文件；
 *   ③ 上游的坑（多包同版本、按内容嗅探而非扩展名、不支持某些方言）
 *      只在这里消化，不散落到调用方。
 *
 * ⚠ 下面每个 `TODO` 都是**评审前必须由人拍板**的事，不是可以随手填的空。
 *   本轮已在沙箱里实跑过 `@citation-js/*@0.9.0`，实测结论写在各自 TODO 里
 *   （汇总见 README「实测」表）。
 *
 * ⚠ **刻意不引 `@citation-js/plugin-doi`**。它会自己发网络请求去 Crossref 取元数据，
 *   而 `@citation-js/core` 为此在模块图里静态带了 `sync-fetch-undici`（见 TODO-A）。
 *   本包的场景是「用户粘贴一段文本」，不需要联网；把 DOI 解析留给上游阅读器
 *   自己的 `typesafe` 检索链路，不在这里开第二个网络出口。
 */

/** 上游锁定凭据 —— 必须与 `package.json.dependencies` 逐字一致。 */
export const UPSTREAM_PACKAGES = Object.freeze({
  core: '@citation-js/core',
  bibtex: '@citation-js/plugin-bibtex',
  ris: '@citation-js/plugin-ris',
});

/**
 * 三个包**必须同版本**。
 *
 *   实测：`@citation-js/core@0.9.0` 配 `plugin-bibtex@0.8.4` → npm 直接
 *   `ETARGET`（0.8.4 不存在于该 scope 的当前发布线）；混装旧插件会触发
 *   `ERESOLVE peer dependency` 冲突，需要 `--legacy-peer-deps` 才装得上。
 *   → **要么三个都 0.9.0，要么都别动**。版本号只写在这里与 `package.json`，
 *     别处不再重复（否则会漂移）。
 */
export const UPSTREAM_VERSION = '0.9.0';

/** 供人工复核对照：仓库地址（三个 npm 包的 `repository.url` 同一个）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/citation-js/citation-js';

/** 许可证（GitHub `license.spdx_id` = MIT；npm 各包 `license` = MIT；`LICENSE.md` 首行 The MIT License）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游产出的统一中间格式：**CSL-JSON**（Citation Style Language 的 JSON 表示）。
 *
 *   这是本包选择 citation-js 的**理由本身**：BibTeX 与 RIS 是两种完全不同的语法
 *   （前者是 `@type{key, field={value}}` 的递归花括号，后者是 `TY - JOUR` 的
 *   标签行），但两者都能被折算成同一个 CSL-JSON 形状。我们只需要对接**一种**形状，
 *   而不是两种，也不必自己写两个手写解析器。
 *
 *   实测字段（`@citation-js/core` + bibtex + ris 三个 0.9.0，Node 22 沙箱实跑）：
 *
 *   ```js
 *   // BibTeX  @article{knuth1984, author={Knuth, Donald E.}, title={Literate Programming}, …}
 *   { type: 'article-journal', title: 'Literate Programming',
 *     author: [{ given: 'Donald E.', family: 'Knuth' }],
 *     issued: { 'date-parts': [[1984]] }, DOI: '10.1093/comjnl/27.2.97', page: '97-111' }
 *
 *   // RIS  TY  - JOUR / AU  - Zhang, San / TI  - … / PY  - 2021 / SP - 10 / EP - 20
 *   { type: 'article-journal', title: 'A Study of ZJU Courses',
 *     author: [{ family: 'Zhang', given: 'San' }],
 *     issued: { 'date-parts': [[2021]] }, DOI: '10.1000/test', page: '10-20' }
 *   ```
 */
export const UPSTREAM_SHAPE = 'CSL-JSON 条目数组（Cite#data）';

/**
 * TODO-A · 加载上游，并确认导出形态。
 *
 *   实测（`npm i @citation-js/core@0.9.0 @citation-js/plugin-bibtex@0.9.0
 *   @citation-js/plugin-ris@0.9.0`，沙箱实跑）：
 *
 *   - 入口是**具名导出 `Cite`**（`import { Cite } from '@citation-js/core'`），
 *     **不是**默认导出。插件是**副作用导入**（`import '@citation-js/plugin-bibtex'`），
 *     自身不导出任何要用的东西 —— 漏写一行 `import` 的后果是运行时
 *     `Error: This format is not supported or recognized`，而不是编译期报错。
 *     → `loadUpstream()` 必须**同时** `import` 三个包，少一个都不行。
 *   - 包形态：`main: lib/index.js`、`module: lib-mjs/index.js`、**无 `browser` 字段**。
 *     `lib-mjs/` 里 `grep` 不到任何 `node:` 内置模块 → 可进前端 bundle。
 *   - **体积（本包最主要的成本）**：core + plugin-bibtex + plugin-ris + 两个
 *     `@citation-js/{date,name}` + `moo` + `sync-fetch-undici` 合计
 *     **698,183 B（≈682 KB）unpacked**。若评审认为「为导入一段文本引入 682 KB」不划算，
 *     应改判 🔵（与 r53 `ics` 那次「76 KB 是否值得」同一类判断）。
 *   - `sync-fetch-undici` 被 `@citation-js/core/lib-mjs/util/fetchFile.js` **静态**
 *     引入，而 `util/` 又被主入口静态 re-export（`index.js` → `util/index.js`）。
 *     沙箱实测 `node: 'node'` 字样在 `lib-mjs/` 内 `grep` 不到，故**预计**可不配置
 *     polyfill 直接打包；**但这条必须在真实打包器里验一次**（TODO-A-1）。
 *
 *   @returns {Promise<{ Cite: Function, version: string }>}
 */
export async function loadUpstream() {
  // 占位：评审通过后实现。
  //   await import('@citation-js/plugin-bibtex');   // 副作用导入，别省
  //   await import('@citation-js/plugin-ris');
  //   const { Cite } = await import('@citation-js/core');
  //   return { Cite, version: UPSTREAM_VERSION };
  throw new Error('候选骨架：loadUpstream() 未实现（见 README，未评审）');
}

/**
 * TODO-A-1 · 打包验证（**评审前必做，不能靠推测**）。
 *
 *   `sync-fetch-undici` 是纯 JS（Node 18+ 的全局 `fetch` 封装），但它读的是
 *   **Node 专有的同步 API**（`Atomics.wait` + worker）。若它被打进前端 bundle
 *   且在**运行时被求值**，浏览器里会抛错 —— 而我们的导入流程只用
 *   `Cite#data`（纯解析），**永远不调用 `fetchFile`**。
 *
 *   所以要求：用与 `dsh-zhiyun-page-paper` 相同的打包器跑一次
 *   `import { Cite } from '@citation-js/core'` + 两个插件，确认
 *   ① 构建成功；② 产物体积（这是要写进评审结论的数字）；
 *   ③ 浏览器控制台无 `sync-fetch` 相关报错。
 *   **在拿到这三个结果之前，本包不得从 🟢 升为「已采纳」。**
 */

/**
 * TODO-B · 一段文本 → CSL-JSON 条目数组。
 *
 *   实测行为（三个包 0.9.0）：
 *
 *   - `new Cite(bibtexText)` / `new Cite(risText)` 都能直接吃**多条**；
 *     `Cite#data.length` 即条目数（实测 2 条 → `2`）。
 *   - **格式是按内容嗅探的，不看扩展名**：同一段文本无需告诉它「这是 BibTeX」。
 *     有利（用户从知网 / Google Scholar 复制的各式导出都能吃），
 *     也有害（**无法区分「用户粘错了格式」与「用户粘了一段普通中文」**）。
 *   - 解析失败时**抛错**，消息固定为 `This format is not supported or recognized`。
 *     实测中文散文、随机英文都落在这条 —— 这是唯一可用的失败信号，**必须原样上抛**，
 *     不许 catch 成「0 条」静默返回（「半份结果比没有结果更难发现」，与
 *     `page-planning/src/plans.js` 同一原则）。
 *   - **中文条目可以正常解析**：实测 `作者 = {王, 小明 and 李, 四}` →
 *     `[{family:'王',given:'小明'}, {family:'李',given:'四'}]`；`title` 与
 *     `container-title` 中文原样保留；`publisher/journal` 映射到 `container-title`。
 *
 *   @param {string} text  用户粘贴的原文（BibTeX 或 RIS）
 *   @returns {Promise<object[]>} CSL-JSON 条目数组（上游形状，未经本包裁剪）
 */
export async function parseReferences(text) {
  // 占位：评审通过后实现。
  //   const { Cite } = await loadUpstream();
  //   return new Cite(text).data;   // 抛错就让它抛，调用方负责呈现
  throw new Error('候选骨架：parseReferences() 未实现（见 README，未评审）');
}

/**
 * TODO-C · CSL-JSON 条目 → 本仓文献库的「一篇文章」该长什么样。
 *
 *   **这是本包与现有功能唯一的接缝**，也是最容易做错的一处。
 *
 *   现状（`dsh-zhiyun-page-paper/src/library.js` + `LibraryPanel.jsx`，本轮读码核实）：
 *   文献库的最小单位是 **`{ topic, name }`**，`name` 就是 PDF 文件名；
 *   导入路径**只有一条** —— `POST /paper-reader/api/library/upload`（原始 PDF 字节
 *   + `x-dpr-topic` / `x-dpr-name` 头）。**没有「元数据条目」这个概念。**
 *
 *   → 所以本包**不能**凭空造一个「文献条目」塞进库，那会是与上游数据模型打架。
 *     正确做法是**只做前半段**：把粘贴的文本解析成「N 条候选 + 各自的 PDF 定位信息」，
 *     再让用户逐条走**已有的**上传路径。具体见 `src/index.js` 的 TODO-3。
 *
 *   映射规则（**未定，须评审拍板**）：
 *   - `name`：上游按文件名认文章，中文 PDF 名常见「作者 - 标题.pdf」。
 *     建议 `<firstAuthorFamily> - <title>.pdf`，并**把 `.bib` 里的原始 key 保留在旁注里**
 *     （BibTeX 的 `@article{knuth1984}` 里的 `knuth1984` 是用户自己的记忆锚点）。
 *   - `topic`：**不自动新建**。默认落到用户当前选中的专题，UI 上让用户确认
 *     （`LibraryPanel.jsx` 已有 `uploadTopic` 这个下拉，复用即可，不要新造一个）。
 *   - `type`：CSL 的 `article-journal` / `paper-conference` 等**不映射到任何本仓字段** ——
 *     文献库没有类型概念，硬塞会变成第二套数据模型。
 *
 *   @param {object} entry     一条 CSL-JSON
 *   @returns {{ title: string, authors: string[], year: number|null, doi: string|null,
 *               page: string|null, suggestedName: string }} 仅供 UI 展示与命名，不落库
 */
export function toLibraryHint(entry) {
  throw new Error('候选骨架：toLibraryHint() 未实现（见 README，未评审）');
}

/**
 * TODO-D · 条数上限 —— **必须由人拍板**。
 *
 *   实测：解析本身很便宜（2 条瞬时完成），但**下游不便宜**：
 *   每条候选最终都可能触发一次 `library/upload`，而每次上传都是一个完整 PDF
 *   落盘 + 后续转录的起点。用户一次粘进 500 条 `.bib`（真实场景：从 Zotero
 *   导出的整个库），UI 会卡在「500 行待确认」上。
 *
 *   建议：**单次导入上限 50 条**，超出时**先展示前 50 条 + 明示总数**，
 *   绝不静默截断（「静默截断 = 用户以为导全了」）。
 */
export const MAX_IMPORT_ENTRIES = 50;
