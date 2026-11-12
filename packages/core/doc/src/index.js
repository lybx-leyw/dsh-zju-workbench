/**
 * `@lybx-leyw/dsh-zju-core-doc` 的插件包装（薄）：把四条文档能力挂到 `ctx.zwDoc`。
 *
 * # 为什么这一层几乎不做事
 *
 * 四条能力的实现全在 `text.js` / `pdf.js` / `office.js` 里，它们**不碰 ctx**、
 * 不读配置、不自己决定落盘位置。插件层只负责三件事：
 *
 *   1. 把「输出目录」这个唯一的外部依赖解析出来（`config.outputDir` → profile 的
 *      `data/doc`）；
 *   2. 把游离的函数绑成一个服务对象；
 *   3. 在卸载时把这个服务摘掉。
 *
 * 这样测试可以完全不经过 Cordis（直接 `import { extractFile } from '.../text.js'`），
 * 而产品里拿到的服务与测试跑的是同一份代码。
 *
 * # 为什么落盘位置必须由外面给
 *
 * 上游把全文 Markdown 写到 `<data>/output/doc/<哈希>/`。本仓的 `<data>` 是 **profile
 * 的目录**（`ctx.profileContext.dir`），不是仓库根，也不是 `os.homedir()`：
 * 同一个 profile 的两次运行要落在同一处，用户才能找到上一次提取的全文。
 * 而「profile 在哪」只有集成层知道 —— 所以本包不猜，没有就抛 `CONFIG`。
 *
 * @module @lybx-leyw/dsh-zju-core-doc
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { DocError, inputError } from './errors.js';
import { loadOfficeEngine } from './office.js';
import {
  combinePdf,
  extractPages,
  findInPdf,
  parsePageRule,
  pdfTexts,
  requireFile,
} from './pdf.js';
import { extractFile } from './text.js';
import { sniff } from './sniff.js';

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'zw-doc';

/**
 * 只硬依赖 `profileContext`（拿 profile 目录做输出根）。
 *
 * # 为什么它必须在 inject 里
 *
 * Cordis 的**真实行为**（与 `core/notes` 头注记的是同一条）：没写进 `inject` 的服务，
 * 直读 `ctx.profileContext` 会抛 `cannot get property "profileContext" without inject`
 * —— 它不是 `undefined`，也没有「有就用、没有就算」的默认。
 *
 * 声明它的代价是「没有 profile 目录时不激活」。本包**可以**接受这个代价：它的全部
 * 产物都要落到 `<profile>/data/doc`，没有 profile 就没有落点。反过来，用
 * `ctx.get('profileContext')` 去「兼容没有 profile 的宿主」只是在骗自己 ——
 * 那种宿主里本包一行有用的事也做不了。
 *
 * `inject` 里没有 `storageDomain` / `tools` / `approval`：取字与合成不需要它们
 * （审批见上游工具层，落盘是本包自己写文件，不走存储域）。
 */
export const inject = ['profileContext'];

/** 文件名去掉扩展名。 */
const stem = (file) => path.basename(file, path.extname(file));

/** 路径是否已存在（文件或目录）。 */
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 默认输出目录：`<profile>/data/doc`。
 *
 * 走 `ctx.profileContext.dir`（`inject` 已声明，Cordis 保证它可用）。
 * 但外面仍包一层 try：加载器把它挂在极简 ctx 上时（测试、嵌入方），
 * 正确行为是抛 CONFIG（见 `apply`），而不是崩在属性访问上。
 *
 * @param {object} ctx Cordis 上下文。
 * @returns {string|undefined} 拿不到 profile 目录时 `undefined`。
 */
function defaultOutputDir(ctx) {
  let dir;
  try {
    dir = ctx?.profileContext?.dir;
  } catch {
    // 未声明 inject 的宿主服务在旧版 Cordis 上仍会抛；那等同于「没有」。
    return undefined;
  }
  return typeof dir === 'string' && dir !== '' ? path.join(dir, 'data', 'doc') : undefined;
}

/**
 * 占用一个**明确的**输出路径；已存在就报错。
 *
 * 不覆盖是硬规矩：输出同名但内容不同的文件，会让用户以为「上次的结果没变」，
 * 而真正发生的是它被悄悄替换了。
 *
 * @param {string} out 调用方给的路径。
 * @returns {Promise<string>} 绝对路径（父目录已建好）。
 * @throws {DocError} `INPUT` 文件已存在。
 */
async function reserveOutput(out) {
  const target = path.resolve(out);
  if (await exists(target)) throw inputError(`输出文件已存在：${target}`, { file: target });
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

/**
 * 在输出目录里挑一个**没被占用**的名字。
 *
 * `foo.pdf` 已存在时依次试 `foo (2).pdf`、`foo (3).pdf`…… 而不是覆盖，也不是直接
 * 失败：默认路径是**我们**选的，用户没有参与，所以自动挪开比让他来改文件名更合理。
 * 上限 1000 是为了防止某个目录堆了几千个同名文件时卡住。
 *
 * @param {string} dir 输出目录。
 * @param {string} fileName 期望的文件名。
 * @returns {Promise<string>} 可写路径。
 */
async function reserveGenerated(dir, fileName) {
  await fs.mkdir(dir, { recursive: true });
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  for (let index = 1; index <= 1000; index += 1) {
    const candidate = path.join(dir, index === 1 ? fileName : `${base} (${index})${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new DocError('CONFIG', `输出目录里同名文件太多：${fileName}`, { dir });
}

/**
 * 造四条能力的服务对象（不经过 Cordis，可直接被测试与集成层使用）。
 *
 * @param {object} options
 * @param {string} options.outputDir 全文 Markdown 的落地目录。
 * @returns {{text: Function, pdf: Function, pages: Function, find: Function}}
 * @throws {DocError} `CONFIG` 没有输出目录。
 */
export function createDocService({ outputDir }) {
  if (typeof outputDir !== 'string' || outputDir === '') {
    throw new DocError('CONFIG', '缺少 outputDir：本包只做变换，落盘位置必须由调用方给');
  }

  return {
    /**
     * 文档 → 文字（按页/表/张给出），全文另存 Markdown。
     *
     * @param {string} file 文件路径。
     * @param {{source?: string}} [opts] `source` 只是来源标注（例如下载链接）。
     */
    text: (file, opts = {}) => extractFile(file, { outputDir, ...opts }),

    /**
     * 图片 / PDF / Office 文档按顺序合成一个 PDF。
     *
     * @param {string[]} files 输入文件（顺序即页序）。
     * @param {{out?: string, size?: 'a4'|'original', name?: string}} [opts]
     */
    async pdf(files, opts = {}) {
      const inputs = [];
      for (const file of files ?? []) inputs.push(await requireFile(file));
      if (inputs.length === 0) throw inputError('至少要给一个输入文件');
      const out = opts.out !== undefined
        ? await reserveOutput(opts.out)
        : await reserveGenerated(outputDir, opts.name ?? `${stem(inputs[0])}.pdf`);
      return combinePdf(out, opts.size ?? 'a4', inputs);
    },

    /**
     * 从 PDF 取出指定页。
     *
     * 先取总页数再校验页码：越界要在**建输出文件之前**报出来，否则会留下一个
     * 0 页的空 PDF，而用户看到的是「成功但文件打不开」。
     *
     * @param {string} file 源 PDF。
     * @param {string} rule 页码规则（从 1 起，如 `43-49,390`）。
     * @param {{out?: string, name?: string}} [opts]
     */
    async pages(file, rule, opts = {}) {
      const input = await requireFile(file);
      // 先认格式：`pdf-lib` 对非 PDF 字节的报错是「Failed to parse PDF document」，
      // 那句话指向的是数据损坏，而这里真正发生的是**拿错了文件**。
      const { kind } = await sniff(input);
      if (kind !== 'pdf') throw inputError(`${path.basename(input)} 不是 PDF 文件`, { file: input });
      const totalPages = await pageCount(input);
      parsePageRule(rule, totalPages);
      const label = String(rule).replace(/[^\d,-]/g, '').slice(0, 60);
      const out = opts.out !== undefined
        ? await reserveOutput(opts.out)
        : await reserveGenerated(outputDir, opts.name ?? `${stem(input)}_第${label}页.pdf`);
      return extractPages(input, rule, out);
    },

    /**
     * 找关键词在 PDF 的哪几页，每页附一段上下文。
     *
     * @param {string} file PDF 路径。
     * @param {string[]} keywords 关键词（多个各算各的）。
     */
    async find(file, keywords) {
      const input = await requireFile(file);
      // 不是 PDF 时在**打开之前**就拒绝：`pdf.js` 对非 PDF 字节的报错是
      // 「Invalid PDF structure」，那是数据的问题，而这里其实是拿错了文件。
      const { kind } = await sniff(input);
      if (kind !== 'pdf') throw inputError(`${path.basename(input)} 不是 PDF 文件`, { file: input });
      return findInPdf(input, keywords);
    },
  };
}

/**
 * 一个 PDF 的页数（用于页码校验）。
 *
 * 读文字层太贵（要解压内容流、跑字体映射），而这里只要页数 —— 一条 pdf-lib 的
 * 页树就够。
 *
 * @param {string} file PDF 路径。
 * @returns {Promise<number>}
 */
async function pageCount(file) {
  const document = await PDFDocument.load(await fs.readFile(file), { ignoreEncryption: true });
  return document.getPageCount();
}

/**
 * 装载插件。
 *
 * @param {object} ctx Cordis 上下文。
 * @param {object} [config]
 * @param {string} [config.outputDir] 覆盖输出目录（默认 `<profile>/data/doc`）。
 * @returns {() => Promise<void>} 卸载函数。
 * @throws {DocError} `CONFIG` 既没有配置、也没有 profile 目录。
 */
export function apply(ctx, config = {}) {
  const outputDir = config.outputDir ?? defaultOutputDir(ctx);
  if (outputDir === undefined) {
    // 没有 profile 目录又没有显式配置时**不激活**：本包没有「不落盘也行」的降级
    // —— 取字的全文必须有个去处，否则 300 页的文档只能整份塞进上下文。
    // 抛 CONFIG 而不是静默退化：静默退回内存等于「这次能看、下次就没了」。
    throw new DocError('CONFIG', '本包需要一个输出目录：请在 profile 里配置 config.outputDir，'
      + '或确保 ctx.profileContext.dir 可用');
  }
  const service = createDocService({ outputDir });
  const remove = ctx.provide('zwDoc', service);
  return async () => {
    // 先摘服务再收资源：反过来的话，卸载途中还在飞的调用会拿到一个已经失效的服务，
    // 而它报出来的是「文档处理坏了」，不是「插件卸载了」。
    if (typeof remove === 'function') remove();
  };
}

/** 引擎是否可用（状态查询用；不触发任何转换）。 */
export async function engineStatus() {
  const engine = await loadOfficeEngine();
  return { available: engine !== null, engine: engine === null ? null : '@deepseek-ai/libreoffice-kit' };
}

export { DocError };
export { sniff, engineExt } from './sniff.js';
export { pdfTexts, findInPdf, parsePageRule, extractPages, combinePdf, fitImage, placeRotated, quarterTurnsOf, readJpegOrientation, A4 } from './pdf.js';
export { extractFile, extract, htmlText, decodeText, markdown, INLINE_CHARS } from './text.js';
export { officePages, loadOfficeEngine } from './office.js';
export { openZip } from './zip.js';
