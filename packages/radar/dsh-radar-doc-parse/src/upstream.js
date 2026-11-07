/**
 * 上游**锁版凭据**（单一真源）。
 *
 * 与其它 A 类骨架不同，本包的「上游」不是一个可挂载的 DSH 插件包，
 * 而是 `taxueseek/dsh-files` 使用的三个**底层解析库**。原因见下。
 *
 * ─────────────────────────────────────────────────────────────
 * 一、为什么不能写 `"dsh-files": "0.7.0"`
 * ─────────────────────────────────────────────────────────────
 *
 *   `https://registry.npmjs.org/dsh-files` 返回 **0.0.1**，
 *   作者 `dushaobindoudou`，description 写着
 *   "File manager panel for the dsh web GUI - name reserved; first release in development."
 *   tarball 里只有 `package.json` + `README.md`，**零代码**。
 *
 *   而上游仓库 `taxueseek/dsh-files` 的 `package.json` 里 `name` 恰恰就是
 *   `dsh-files`、`version` 已是 **0.7.0** —— 但它从未成功发布：
 *   `@taxueseek/dsh-files`、`@taxueseek/files`、`dsh-files-toolkit` 全部 404，
 *   `scope:taxueseek` 搜索结果为 0。
 *
 *   ⇒ 写 `"dsh-files": "0.7.0"` 会**装到陌生人的占位包**上（装不上，或装上空包）。
 *   ⇒ 这是本雷达第一条「npm 同名不同物」案例。r145 的判据是「npm 404 即封」，
 *      本轮把判据补全为：**先查存在性，再查同一人**（比对 tarball 内
 *      `package.json` 的 `repository.url` 与 upstream git 地址）。
 *
 * ─────────────────────────────────────────────────────────────
 * 二、为什么不复制上游的 `lib/client.js`
 * ─────────────────────────────────────────────────────────────
 *
 *   上游把客户端预打包成 `lib/client.js`（19 KB，未压缩）。复制它等于
 *   **搬运上游源码**，违反 skill 硬边界。同时它的 `dsh.client.inject`
 *   指向 `@deepseek-ai/dsh-client-ui-conversation`，属于宿主 UI 槽位，
 *   与本仓的 `dsh-zhiyun-shell-ui` 外壳是两套布局主张。
 *
 *   ⇒ 只锁**纯数据/纯文本层**的三个库，它们无 DOM、无宿主依赖，
 *      在 host 侧（Node）直接调用即可。
 *
 * ─────────────────────────────────────────────────────────────
 * 三、版本为什么写死
 * ─────────────────────────────────────────────────────────────
 *
 *   `mammoth` 的 Markdown 输出结构随大版本变化（标题层级、列表缩进、表格对齐），
 *   本仓若缓存/索引了抽取结果，一次 `^` 升级会让同一份课件抽出不同文本，
 *   进而让「同一文档的笔记锚点」漂移。`read-excel-file` 同理（Date 序列化口径）。
 *   ⇒ **精确版本**，且运行时再核对一次（见 `index.js`）。
 */

/** 上游 DSH 插件仓库（能力来源，非挂载对象）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/taxueseek/dsh-files';

/** 我们读过的上游版本（仅作溯源，**不作为 npm 依赖**）。 */
export const UPSTREAM_REPO_VERSION = '0.7.0';

/** 上游 LICENSE 原文核实：标准 29 行 MIT，`Copyright (c) 2026 taxueseek`，无附加条款。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 锁版引入的底层库。
 *
 * `usedFor` 记录「上游在哪个环节用它」——评审时按这一列逐条对应，
 * 不凭记忆判断「是不是同一个能力」。
 */
export const LOCKED_DEPS = Object.freeze({
  mammoth: {
    version: '1.13.0',
    license: 'BSD-2-Clause',
    format: 'docx',
    usedFor: 'DOCX → Markdown（保留标题/列表/表格结构，不是裸文本）',
    note: '纯 JS、维护活跃（1.13.0 于 2026-09-26 发布）。上游用它在 parseDocx() 里做 convertToMarkdown/extractRawText 双档。',
  },
  'read-excel-file': {
    version: '9.3.14',
    license: 'MIT',
    format: 'xlsx',
    usedFor: 'XLSX 单元格文本抽取（按 sheet 限行、显式报告截断）',
    note:
      '上游注释明写「replaces xlsx@0.18.5 which carries prototype-pollution CVEs」——' +
      '这是选它的**安全理由**，不是随手挑的。SheetJS 社区版的原型污染是本类项目常见坑。',
  },
  'word-extractor': {
    version: '1.0.4',
    license: 'MIT',
    format: 'doc',
    usedFor: '老 .doc（Word 97 二进制）文本抽取',
    note: '浙大办公文件仍大量存在 .doc。上游自述「.doc the built-in read rejects as binary」。1.0.4 为 2021 年版本，久未更新 —— 评审时需确认 `saxes`/`yauzl` 的传递依赖无 advisory。',
  },
});

/** 上游另有 PPTX 支持，走它自带的 `jszip` + XML 解析，不引入额外依赖。 */
export const PPTX_DEP_NOTE = 'jszip：上游自带；本骨架暂不锁版，评审时决定是复用本仓既有的 zip 实现还是引入。';

/**
 * 上游 `cordis.patch.yml` 的默认配置（读自仓库 HEAD），
 * 作为本包 `apply()` 的 config 默认值参考。**不是契约**，以评审时上游 HEAD 为准。
 */
export const UPSTREAM_DEFAULT_CONFIG = Object.freeze({
  maxFileBytes: 25165824,
  readLimit: 2000,
  sheetRowLimit: 200,
  maxSheets: 5,
  maxOutputChars: 24000,
  readTimeoutMs: 120000,
});

/** npm 上的占位包信息（用于运行时/评审时报警）。 */
export const NPM_NAME_SQUATTED = Object.freeze({
  name: 'dsh-files',
  publishedVersion: '0.0.1',
  author: 'dushaobindoudou',
  /** 判据：名字相同但 repository 指向别处 ⇒ 不是同一个包。 */
  expectedRepository: UPSTREAM_REPOSITORY,
});
