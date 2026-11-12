/**
 * PDF 的三件事：**逐页取文字**、**合成**、**取页**。
 *
 * # 为什么逐页取字不挂在 `core/classroom-media` 上
 *
 * 本仓已有一份 PDF 取字（`packages/core/classroom-media/src/pdf/parse.js`），但它
 * 调 `extractText(pdf, { mergePages: true })` —— 拿回来的是一整段字符串，**页边界在
 * 那一步就没了**。`doc pages` / `doc find` 全部建立在「第 N 页」这个单位上：
 *
 *   - `find` 要回答「关键词在第几页」；
 *   - `text` 要把结果按页编号写成 Markdown；
 *   - `pages` 要能把第 43-49 页原样切出来。
 *
 * 把 `mergePages` 改成 `false` 会改变 `parsePdf()` 的返回形状（`text: string` →
 * `string[]`），而它的调用方（`classroom-studio` 的 `media.parsePdf`、
 * `classroom-generate` 的 material-analysis）都按字符串用。所以**不动它**：
 * 那条链的语义是「把讲义拼成一段材料」，页边界对它是噪音。
 *
 * 本文件的 `pdfTexts()` 用同一个 pdf.js（`pdfjs-dist`）但**逐页**调用
 * `getTextContent()`，把页边界留在结果里。两份实现解决两个不同的问题，不是重复。
 *
 * # 为什么合成与取页用 pdf-lib
 *
 * pdf-lib 是纯 JS、无原生依赖，`copyPages` 会**只带走被引用到的字体与图片**
 * （这正是 `doc pages` 想要的：切 7 页出来不该把整本 40 MB 的字体子集带上）。
 *
 * @module @lybx-leyw/dsh-zju-core-doc/pdf
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PDFDocument } from 'pdf-lib';

import { inputError, readFailed } from './errors.js';
import { sniff } from './sniff.js';

/** 单次取字的页数上限：再多多半是拿错了文件。 */
export const MAX_PAGES = 5_000;

/* ── 取文字（pdf.js，逐页） ─────────────────────────────────────────────── */

/** @type {Promise<{lib: object, resources: (name: string) => string}>|undefined} */
let pdfjsPromise;

/**
 * 加载 pdf.js（延迟、只加载一次）。
 *
 * 用 `createRequire(...).resolve()` 而不是直接 `import('pdfjs-dist/legacy/build/pdf.mjs')`：
 * 后者的解析基准是**本文件**，而本包安装后位于 profile 的 `node_modules` 深层，
 * 与宿主那份 `pdfjs-dist` 不一定是同一个 —— 解析失败时给出的报错是
 * `ERR_MODULE_NOT_FOUND`，完全看不出「只是没装 pdf.js」。
 *
 * 取文字用不到 canvas，但 pdf.js 导入时会解析它并打印一条告警；把 `console.warn`
 * 短暂静音，免得它进到工具输出里干扰模型。
 *
 * @returns {Promise<{lib: object, resources: (name: string) => string}>}
 * @throws {DocError} `UNSUPPORTED` 本机没有 pdfjs-dist。
 */
function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    let entry;
    try {
      entry = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
    } catch (error) {
      throw readFailed('本机没有 pdfjs-dist，读不了 PDF 的文字层', { dependency: 'pdfjs-dist' }, error);
    }
    const root = path.join(path.dirname(entry), '..', '..');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const lib = await import(pathToFileURL(entry).href);
      // pdf.js 要求目录写法以正斜杠结尾，Windows 的反斜杠它会当成转义。
      const dir = (name) => `${path.join(root, name).split(path.sep).join('/')}/`;
      return { lib, resources: dir };
    } finally {
      console.warn = warn;
    }
  })();
  return pdfjsPromise;
}

/**
 * 逐页取文字层。**没有文字的页是空串**（不是被删掉）—— 调用方靠下标知道页号。
 *
 * @param {string|Uint8Array|Buffer} source 文件路径或文件字节。
 * @param {{maxPages?: number}} [options]
 * @returns {Promise<string[]>} 下标 0 是第 1 页。
 * @throws {DocError} `READ_FAILED` 打不开或解析失败。
 */
export async function pdfTexts(source, options = {}) {
  const maxPages = options.maxPages ?? MAX_PAGES;
  const { lib, resources } = await loadPdfjs();
  const data = typeof source === 'string'
    ? new Uint8Array(await fs.readFile(source))
    : new Uint8Array(source);

  const task = lib.getDocument({
    data,
    verbosity: 0,
    cMapUrl: resources('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: resources('standard_fonts'),
    // 用系统字体会让同一份 PDF 在不同机器上切出不同的字符宽度 → 取出来的文字
    // 断行位置漂移。取文字只要字形到字符的映射，不需要本机字体。
    useSystemFonts: false,
    isEvalSupported: false,
  });
  try {
    const document = await task.promise;
    if (document.numPages > maxPages) {
      throw readFailed(`PDF 有 ${document.numPages} 页，超过 ${maxPages} 页上限`, { pages: document.numPages });
    }
    const texts = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      texts.push(content.items
        .map((item) => (item.str === undefined ? '' : item.str + (item.hasEOL ? '\n' : '')))
        .join('')
        .trim());
    }
    return texts;
  } catch (error) {
    if (error?.name === 'DocError') throw error;
    throw readFailed(
      `读不了这个 PDF：${error instanceof Error ? error.message : String(error)}`,
      { file: typeof source === 'string' ? source : '(buffer)' },
      error,
    );
  } finally {
    await task.destroy();
  }
}

/**
 * 找关键词在哪几页，每页附一段前后文。
 *
 * 上下文取匹配位置前后 30 / 60 个字符并压掉换行 —— 给人看的是「这一页大概在讲什么」，
 * 不是完整的句子。多个关键词各算各的，互不干扰。
 *
 * 匹配是**区分大小写的精确子串**（与上游一致）：中文没有大小写问题，而英文里
 * 「Heap」出现在标题、「heap」出现在正文，混在一起会让「命中」失去意义。
 *
 * @param {string} file PDF 路径。
 * @param {string[]} keywords 非空关键词表。
 * @returns {Promise<{totalPages: number, textPages: number,
 *   matches: Record<string, {page: number, snippet: string}[]>}>}
 */
export async function findInPdf(file, keywords) {
  const words = keywords.filter((word) => typeof word === 'string' && word.trim() !== '');
  if (words.length === 0) throw inputError('至少要给一个关键词', { file });
  const texts = await pdfTexts(file);
  const matches = {};
  for (const keyword of words) {
    matches[keyword] = texts.flatMap((text, index) => {
      const at = text.indexOf(keyword);
      if (at < 0) return [];
      const snippet = text
        .slice(Math.max(0, at - 30), at + keyword.length + 60)
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
      return [{ page: index + 1, snippet }];
    });
  }
  return {
    totalPages: texts.length,
    textPages: texts.filter((text) => text !== '').length,
    matches,
  };
}

/* ── 页码规则 ──────────────────────────────────────────────────────────── */

/**
 * 解析「1,3-5」这样的页码规则，按页序去重排序，返回**从 0 起**的下标。
 *
 * 越界、倒序、写错一律报错，不静默取小/取大：切错页的代价是用户拿到一份
 * 「看起来对、内容不对」的 PDF，那种错误没人会发现。
 *
 * 全角逗号按半角处理，空格忽略 —— 中文输入法下这两种字符太容易混进来。
 *
 * @param {string} rule 形如 `1,3-5`、`43-49,390-391`。
 * @param {number} totalPages PDF 总页数。
 * @returns {number[]} 去重升序的 0 基下标。
 * @throws {DocError} `INPUT` 规则非法或越界。
 */
export function parsePageRule(rule, totalPages) {
  const pages = new Set();
  const normalized = String(rule ?? '').replaceAll(' ', '').replaceAll('，', ',');
  for (const part of normalized.split(',')) {
    if (part === '') continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (match === null) throw inputError(`页码规则无效：${part}（格式如 1,3-5）`, { page: part });
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (first > last) throw inputError(`页码范围 ${part} 须从小到大`, { page: part });
    if (first < 1 || last > totalPages) {
      throw inputError(`页码 ${part} 超出范围 1-${totalPages}`, { page: part, totalPages });
    }
    for (let page = first; page <= last; page += 1) pages.add(page - 1);
  }
  if (pages.size === 0) throw inputError('没有给出页码', { rule });
  return [...pages].sort((a, b) => a - b);
}

/* ── 读入 PDF ──────────────────────────────────────────────────────────── */

/**
 * 打开一个 PDF 用于页操作。
 *
 * @param {string} file 文件路径。
 * @returns {Promise<PDFDocument>}
 * @throws {DocError} `INPUT` 不是 PDF；`READ_FAILED` 打不开（损坏/加密）。
 */
async function loadPdf(file) {
  const { kind } = await sniff(file);
  if (kind !== 'pdf') throw inputError(`${path.basename(file)} 不是 PDF 文件`, { file });
  try {
    // `ignoreEncryption`：只读页结构就够了，加密的 PDF 常常仍能复制页
    // （设置的是权限密码而非打开密码）。打不开时下面统一报错，不在这里猜。
    return await PDFDocument.load(await fs.readFile(file), { ignoreEncryption: true });
  } catch (error) {
    throw readFailed(
      `读不了这个 PDF：${error instanceof Error ? error.message : String(error)}`,
      { file },
      error,
    );
  }
}

/** 文件存在且是普通文件；否则 `INPUT`。 */
export async function requireFile(file) {
  const absolute = path.resolve(String(file));
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) {
    throw inputError(`文件不存在：${absolute}`, { file: absolute });
  }
  return absolute;
}

/* ── 取页 ──────────────────────────────────────────────────────────────── */

/**
 * 取出指定页另存为新 PDF。
 *
 * `copyPages` 只把被选中的页**引用到的**字体与图片带过去，所以切出来的文件通常
 * 比原文件小得多 —— 这正是「只发课本里习题那几页」想要的。
 *
 * @param {string} file 源 PDF。
 * @param {string} rule 页码规则（从 1 起）。
 * @param {string} out 输出路径（调用方保证父目录存在、且不覆盖已有文件）。
 * @returns {Promise<{file: string, pages: number[], totalPages: number, bytes: number}>}
 */
export async function extractPages(file, rule, out) {
  const source = await loadPdf(file);
  const indexes = parsePageRule(rule, source.getPageCount());
  const part = await PDFDocument.create();
  for (const page of await part.copyPages(source, indexes)) part.addPage(page);
  const bytes = await part.save();
  await fs.writeFile(out, bytes);
  return {
    file: out,
    pages: indexes.map((index) => index + 1),
    totalPages: source.getPageCount(),
    bytes: bytes.byteLength,
  };
}

/* ── 合成 ──────────────────────────────────────────────────────────────── */

/** A4 的尺寸（点，1 pt = 1/72 英寸）。 */
export const A4 = Object.freeze({ width: 595.28, height: 841.89 });

/**
 * 「原图」模式按 100 dpi 换算页面尺寸。
 *
 * 100 dpi 是上游的取值：再高会让一张手机照片变成两三页 A4 那么大，而扫描件的
 * 有效分辨率也不支持更高的物理尺寸。
 */
const ORIGINAL_DPI = 100;

/**
 * 按 `size` 决定一张图片占多大页面。
 *
 * `a4`：等比缩放到 A4 内并居中（留白边），页面本身是 A4 —— 打印时不会歪。
 * `original`：保持 100 dpi 换算出来的实际尺寸，页面就那么大。小图**不放大**：
 * 放大一张 200×150 的截图只会得到一页糊的字，而原尺寸至少是清晰的。
 *
 * @param {number} width **视觉**宽度（已按 EXIF 方向转正后的宽）。
 * @param {number} height **视觉**高度。
 * @param {boolean} a4 是否 A4 模式。
 * @returns {{page: [number, number], draw: {x: number, y: number, width: number, height: number}}}
 *   `draw` 是**视觉**意义上的框（图片转正后占的区域）。
 */
export function fitImage(width, height, a4) {
  if (!a4) {
    const drawWidth = (width * 72) / ORIGINAL_DPI;
    const drawHeight = (height * 72) / ORIGINAL_DPI;
    return { page: [drawWidth, drawHeight], draw: { x: 0, y: 0, width: drawWidth, height: drawHeight } };
  }
  const scale = Math.min(A4.width / width, A4.height / height, 1);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    page: [A4.width, A4.height],
    draw: {
      x: (A4.width - drawWidth) / 2,
      y: (A4.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    },
  };
}

/**
 * 把「视觉框」换算成 pdf-lib 的绘制参数。
 *
 * pdf-lib 的 `drawImage` 先按 `width`/`height` 摆一张**未旋转**的图（左下角在
 * `x`,`y`），再把整张图绕 `x`,`y` 转 `rotate`。而我们要的是「转正以后占住视觉框」，
 * 所以两个量都要反推：
 *
 *   - 旋转 ±90° 时，绘制用的宽高要与视觉宽高**互换**；
 *   - 旋转后图片的包围盒会跑到 `x`,`y` 的左侧/下方，原点要相应补回一个边长，
 *     否则图会画到页面外（看起来像"图没了"，而不是"图转错了"）。
 *
 * @param {{x: number, y: number, width: number, height: number}} visual 转正后要占的框。
 * @param {number} quarterTurns 顺时针 90° 的个数：1 / -1 / 2 / 0。
 * @returns {{x: number, y: number, width: number, height: number, rotate?: {type: string, angle: number}}}
 */
export function placeRotated(visual, quarterTurns) {
  const swap = Math.abs(quarterTurns) % 2 === 1;
  const drawWidth = swap ? visual.height : visual.width;
  const drawHeight = swap ? visual.width : visual.height;
  // PDF 的角度以**逆时针**为正，而 EXIF 的 6 表示「要顺时针转 90° 才正」。
  const angle = -90 * quarterTurns;
  let x = visual.x;
  let y = visual.y;
  if (angle === 90) {
    x = visual.x + drawHeight;
  } else if (angle === -90) {
    y = visual.y + drawWidth;
  } else if (Math.abs(angle) === 180) {
    x = visual.x + drawWidth;
    y = visual.y + drawHeight;
  }
  return angle === 0
    ? { x, y, width: drawWidth, height: drawHeight }
    : { x, y, width: drawWidth, height: drawHeight, rotate: { type: 'degrees', angle } };
}

/**
 * 把一批「图片 / PDF / Word」按给定顺序合成一个 PDF。
 *
 * 每一类怎么进来：
 *
 * | 输入 | 处理 |
 * |---|---|
 * | PDF | `copyPages` 整份追加（页序不变） |
 * | 图片（JPEG / PNG） | 每张一页；JPEG 直接嵌入（不重编码），PNG 走 `embedPng`（保留透明） |
 * | Word / Excel / PPT | 先交给 Office 引擎转 PDF；**没有引擎时报 `UNSUPPORTED`** |
 *
 * 图片重编码是**有意省略**的：本仓没有 `sharp` 这条硬依赖，而为「转正一张照片」
 * 引一个原生图像库不划算。因此：
 *
 *   - EXIF 的**旋转**由 {@link readJpegOrientation} 读出后按 90° 的倍数应用；
 *   - 缩放交给 PDF 绘制阶段的 `width/height`（矢量意义上无损，只是嵌入的原始
 *     像素不变，文件会大一些）。
 *
 * @param {string} out 输出路径。
 * @param {'a4'|'original'} size 图片页的尺寸策略。
 * @param {string[]} inputs 输入文件（顺序即页序）。
 * @param {object} [hooks] 可注入的钩子（测试与「没有引擎」的真实路径都要用）。
 * @param {(file: string, ext: string) => Promise<{file: string, cleanup: () => Promise<void>}>} [hooks.convertOffice]
 * @returns {Promise<{file: string, pages: number, bytes: number,
 *   inputs: {file: string, kind: string, pages: number}[]}>}
 * @throws {DocError} `INPUT` 输入为空/不支持；`UNSUPPORTED` Word 没有引擎。
 */
export async function combinePdf(out, size, inputs, hooks = {}) {
  if (size !== 'a4' && size !== 'original') {
    throw inputError('size 只能是 a4 或 original', { size });
  }
  if (!Array.isArray(inputs) || inputs.length === 0) throw inputError('至少要给一个输入文件');

  const target = await PDFDocument.create();
  const parts = [];

  const appendPdf = async (file) => {
    const source = await loadPdf(file);
    for (const page of await target.copyPages(source, source.getPageIndices())) target.addPage(page);
  };

  for (const file of inputs) {
    const before = target.getPageCount();
    const { ext, kind } = await sniff(file);
    let partKind;
    if (kind === 'pdf') {
      partKind = 'pdf';
      await appendPdf(file);
    } else if (kind === 'image') {
      partKind = 'image';
      await addImagePage(target, file, ext, size === 'a4');
    } else if (kind === 'writer' || kind === 'calc' || kind === 'impress') {
      // 图片旁的「Word 也能进」是上游的原话，靠的是引擎；没有引擎就得如实拒绝，
      // 而不是把 .docx 当图片塞进去（那会产出一份打不开的 PDF）。
      const convert = hooks.convertOffice ?? (await import('./office.js')).convertWithEngine;
      partKind = { writer: 'word', calc: 'excel', impress: 'ppt' }[kind];
      const converted = await convert(file, ext, 'pdf');
      try {
        await appendPdf(converted.file);
      } finally {
        await converted.cleanup();
      }
    } else {
      throw inputError(
        `不支持 ${path.basename(file)}：只接受图片（JPEG/PNG）、PDF 和 Office 文档`,
        { file },
      );
    }
    parts.push({ file, kind: partKind, pages: target.getPageCount() - before });
  }

  const bytes = await target.save();
  await fs.writeFile(out, bytes);
  return { file: out, pages: target.getPageCount(), bytes: bytes.byteLength, inputs: parts };
}

/**
 * 一张图片放成一页。
 *
 * JPEG 用 `embedJpg`、PNG 用 `embedPng`（pdf-lib 直接解析这两种头，不需要解码像素），
 * 所以**图片字节不被重编码** —— 截图里的文字不会因为再压一遍 JPEG 而糊掉。
 *
 * @param {PDFDocument} target 目标文档。
 * @param {string} file 图片路径。
 * @param {string} ext 真实扩展名（`sniff()` 给的）。
 * @param {boolean} a4 是否 A4 模式。
 * @throws {DocError} `INPUT` 不是 JPEG/PNG。
 */
async function addImagePage(target, file, ext, a4) {
  const bytes = await fs.readFile(file);
  let embedded;
  if (ext === '.png') embedded = await target.embedPng(bytes);
  else if (ext === '.jpg' || ext === '.jpeg') embedded = await target.embedJpg(bytes);
  else {
    throw inputError(
      `图片只支持 JPEG 和 PNG，收到 ${ext}；其余格式请先另存为这两种`,
      { file, ext },
    );
  }

  // 原始像素的宽高（图片文件里存着的那一份，未按 EXIF 转正）。
  const rawWidth = embedded.width;
  const rawHeight = embedded.height;
  const quarterTurns = quarterTurnsOf(ext === '.png' ? 1 : readJpegOrientation(bytes));
  // 转正以后人眼看到的宽高：±90° 时两个数字互换。页面尺寸要按**转正后**的算，
  // 否则一张横着拍的作业会被塞进一页竖版 A4 的窄边里。
  const visual = Math.abs(quarterTurns) % 2 === 1
    ? { width: rawHeight, height: rawWidth }
    : { width: rawWidth, height: rawHeight };

  const { page, draw } = fitImage(visual.width, visual.height, a4);
  const pageRef = target.addPage(page);
  pageRef.drawImage(embedded, placeRotated(draw, quarterTurns));
}

/**
 * EXIF orientation → 顺时针 90° 的个数。
 *
 * 只处理**旋转**（1/3/6/8）：镜像（2/4/5/7）在作业照片里几乎不存在，而要做对镜像
 * 必须真的翻转像素（pdf-lib 的旋转做不出镜像），那需要一条图像解码链 —— 代价远
 * 大于收益。镜像的图仍会正常出现，只是保持文件里的样子。
 *
 * @param {number} orientation EXIF 方向标记（1-8）。
 * @returns {number} 0 / 1 / 2 / -1。
 */
export function quarterTurnsOf(orientation) {
  switch (orientation) {
    // 6 = 顺时针 90° 才正常 → 绘制时顺时针转 90°（quarterTurns = 1）。
    case 6: return 1;
    // 8 = 逆时针 90° 才正常。
    case 8: return -1;
    case 3: return 2;
    default: return 0;
  }
}

/**
 * 读 JPEG 的 EXIF 方向标记（1-8）。读不到时按 1（正常）处理。
 *
 * 只走 SOS 之前的那一段 APP1：EXIF 一定在文件头附近，扫到图像数据再停
 * —— 一张 8 MB 的照片不该为了 1 个字节被完整遍历。
 *
 * @param {Buffer} bytes JPEG 字节。
 * @returns {number} 1-8（默认 1）。
 */
export function readJpegOrientation(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return 1;
    const marker = bytes[at + 1];
    // 0xDA = 图像数据开始，之后没有 EXIF 了。
    if (marker === 0xda) return 1;
    // 无长度的独立标记（RSTn / SOI / EOI）。
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return 1;
    const isExif = marker === 0xe1
      && bytes.toString('latin1', at + 4, Math.min(at + 10, bytes.length)) === 'Exif\0\0';
    if (isExif) {
      const tiff = at + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const read16 = (offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
      const read32 = (offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = read16(ifd);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (read16(entry) !== 0x0112) continue;
        const value = read16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
      return 1;
    }
    at += 2 + length;
  }
  return 1;
}
