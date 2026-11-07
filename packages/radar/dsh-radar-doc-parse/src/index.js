/**
 * dsh-radar-doc-parse —— 候选骨架（占位实现）。
 *
 * ⚠ 未评审 · 未接入 profile · 不可直接使用。
 *
 * ─────────────────────────────────────────────────────────────
 * 这是什么
 * ─────────────────────────────────────────────────────────────
 *
 *   **强化式集成**，不是新建一个面板。
 *
 *   现状：本仓的会话里把一份 `.docx` 课件拖进对话，模型只能看到一个文件名 ——
 *   宿主内建的 `read` 工具把 OOXML/OLE 当二进制拒读；本仓 `pdfjs-dist`
 *   只覆盖 PDF（`host-paper` 与 `page-notes` 各锁 6.4.299）。
 *   全仓 `grep mammoth\|word-extractor\|read-excel-file` = **0 命中**，
 *   `.docx/.xlsx` 只出现在两处**扩展名白名单**里：
 *     - `packages/dsh-zhiyun-core-lecture/src/tree.js:85,128`
 *     - `packages/dsh-zhiyun-host-classroom/src/upstream/mime.js:29-30`
 *   也就是说：**认得出，但读不了**。
 *
 *   本包补的就是这一环：注册一个 `read_document` model tool，
 *   把 DOCX/DOC/PPTX/XLSX 抽成文本或 Markdown，交回同一个对话。
 *
 * ─────────────────────────────────────────────────────────────
 * 三条判据在评审时的落点
 * ─────────────────────────────────────────────────────────────
 *
 *   ① 同一个面板 —— 能力落在**既有的「会话内读文件」动作**上。
 *      宿主原生上传管线已经在跑，`read_document` 只是给模型多一个读法；
 *      不新增侧栏入口、不新增页面。上游的「附件坞」（pill + library card）
 *      本包**不采用** —— 那是第二套布局主张。
 *
 *   ② 功能相似正交 —— PDF 链路（`pdfjs-dist`）完全不动。
 *      这里补的是**另外三种容器格式**的抽取。同一个能力维度（把文件变成
 *      可读文本）的**格式补齐**，不是重复实现 PDF。
 *      边界很清楚：`parse/pdf.js` **不由本包接管**。
 *
 *   ③ 底层更优 —— 三个库的选型理由见 `upstream.js` 的 `LOCKED_DEPS`。
 *      最硬的一条：`read-excel-file` 是为**规避 `xlsx@0.18.5` 的原型污染 CVE**
 *      而选的（上游注释原文）。本仓若自己挑，很可能直接 `npm i xlsx`。
 *
 * ─────────────────────────────────────────────────────────────
 * 已知缺陷（评审前必须解决）
 * ─────────────────────────────────────────────────────────────
 *
 *   (a) 上游 npm 包名被占 —— 见 `upstream.js` 顶部长注释。**不要**改成
 *       依赖 `dsh-files`，也不要 `npm i dsh-files` 去"验证一下"。
 *   (b) `word-extractor@1.0.4` 是 2021 年的版本，传递依赖 `saxes`/`yauzl`
 *       需查 advisory。若不可用，`.doc` 分支应先降级为「提示用户转存 docx」。
 *   (c) 抽取结果的**缓存与锚点**：若后续要把抽取文本索引进 `core-vault`，
 *       同一文件换版本后会得到不同文本 —— 锁版只能缓解，不能根治。
 *       评审时决定是否给抽取结果打 `(文件hash, 库版本)` 版本戳。
 */

import { LOCKED_DEPS, NPM_NAME_SQUATTED, UPSTREAM_REPOSITORY } from './upstream.js';

export const name = 'radar-doc-parse';

/**
 * 需要什么注入？
 *
 *   上游的 host 半边 `inject` 了 `tools`（注册 model tool）+ `fs`（读文件字节）。
 *   本包沿用同样的两条 —— 但要先和本仓 `dsh-zhiyun-core-tool` 核对
 *   工具注册的**槽位归属**，避免出现第二套 tools 注册路径。
 *
 *   TODO(评审 1): 确认 `inject` 究竟写 `['tools', 'fs']` 还是走
 *   `dsh-zhiyun-core-tool` 的注册 API。**在看清之前不要填**——
 *   填错了会像 r83 的 `plugin-manager` 一样和别的包抢同一个 cordis 槽位。
 */
export const inject = [];

export function apply(ctx, config) {
  void ctx;
  void config;

  // TODO(评审 2): 依赖安装。三个库都已确认在 npm 上有精确版本：
  //   mammoth@1.13.0 / read-excel-file@9.3.14 / word-extractor@1.0.4
  //   且 package.json 已写死。评审只需确认 workspace 能正确解析它们
  //   （三个库都是 CJS/ESM 双出，`read-excel-file/node` 是子路径导出）。
  //   注意：本包**不**依赖任何 `@deepseek-ai/*` —— 纯 Node 侧文本处理，
  //   所以它不会因宿主版本漂移而失效，这一点比一般 A 类骨架稳。

  // TODO(评审 3): 注册 model tool `read_document`。
  //   签名对齐上游（读自仓库 src/parse/index.ts 的对外形态）：
  //     read_document({ path, format?, sheet?, listOnly?, outputFormat? })
  //       → { text, format, truncated?, pages?/sheets? }
  //   本仓**当前没有任何同名工具**（`grep read_document` = 0 命中），
  //   所以不存在与既有工具抢名的问题；但注册后要同步更新
  //   `dsh-zhiyun-page-plugins` 的能力清单。

  // TODO(评审 4): 格式分派。按**文件头魔数**而不是扩展名判断：
  //   OOXML 是 zip（`PK\x03\x04`），`.doc` 是 OLE（`\xD0\xCF\x11\xE0`）。
  //   扩展名白名单（core-lecture/tree.js）只能用于「是否允许上传」，
  //   不能用于「用什么解析器」—— 一个改了后缀的 .docx 会让 mammoth 抛错。
  //
  //   分派表：
  //     docx  → mammoth.convertToMarkdown
  //     doc   → word-extractor
  //     xlsx  → read-excel-file/node（按 sheet 限行，显式报告截断）
  //     pptx  → jszip 解包后按 slide 拼文本（待定，见 upstream.js PPTX_DEP_NOTE）
  //     pdf   → **不由本包接管**，留空并回落宿主既有链路

  // TODO(评审 5): 体积与时延。上游默认 24 MB / 20 万字节输出上限 /
  //   120 s 超时。浙大课件动辄 50 MB+（尤其 PPTX 带图），这个上限需要
  //   按实际场景调，且**超限要明确告诉模型「被截断」**，
  //   否则模型会把半张表当成整张表（上游在 xlsx.ts 注释里专门提醒过这点）。

  // TODO(评审 6): 「同一个面板」的验收方式。
  //   判据①不能只写在 README 里，要有一条可执行断言：
  //   拖入 .docx 后，**仍在同一个对话**里得到摘要，且侧栏未新增入口。
  //   如果做不到（比如必须开新面板展示抽取结果），说明判据①不成立，
  //   应回退为 🟡 并重新评估。

  ctx.logger?.warn?.(
    `[${name}] 候选骨架未实现：需先按 ${UPSTREAM_REPOSITORY} 核对上游选型，` +
      `并注意 npm 上 ${NPM_NAME_SQUATTED.name}@${NPM_NAME_SQUATTED.publishedVersion} ` +
      `是他人占位包（${NPM_NAME_SQUATTED.author}），不是上游。`,
  );
}

/** 占位导出：让 lockfile 里的三个库能被静态审计走通，不触发 unused 警告。 */
export const lockedFormats = Object.fromEntries(
  Object.entries(LOCKED_DEPS).map(([pkg, meta]) => [meta.format, `${pkg}@${meta.version}`]),
);
