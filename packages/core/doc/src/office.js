/**
 * Office 文档取字：**不装 LibreOffice**，直接读 OOXML / ODF 里的 XML。
 *
 * # 上游怎么做的，本仓为什么不照抄
 *
 * 上游 `core/zju/lib/doc/office.ts` 把 Word/Excel/PPT 交给
 * `@deepseek-ai/libreoffice-kit`（DSH 桌面端自带的无头 LibreOffice）转成 PDF 或纯文本。
 * 那个包**不在本仓依赖里**，`require.resolve('@deepseek-ai/libreoffice-kit')`
 * 在本机实测 `MODULE_NOT_FOUND`；而任务书明确「必须装新依赖就停下来报告」。
 *
 * 所以这里走另一条路：docx / xlsx / pptx（以及 ODF 的 odt / ods / odp）本质上是
 * **装着 XML 的 ZIP**，取文字只需要读几个部件 —— 这是纯 JS 能做、且不需要任何新依赖的。
 * 老式二进制格式（.doc / .xls / .ppt / .wps / .et / .dps，OLE 复合文档）没法这么读，
 * 它们**如实报 `UNSUPPORTED`** 并说清要怎么办，而不是猜出一段乱码。
 *
 * # 引擎仍在，只是可选
 *
 * {@link loadOfficeEngine} 会在运行时尝试加载 `@deepseek-ai/libreoffice-kit`。
 * 在装了它的环境（桌面端）里：
 *
 *   - 老式二进制格式可以转；
 *   - `doc pdf` 能把 Word 按版面变成 PDF 页。
 *
 * 没装时就退回本文件的原生 XML 路径。这样「现在能跑」与「将来装了引擎自动更强」
 * 是同一份代码，不需要谁回来改。
 *
 * # 为什么不假装成功
 *
 * 版面、图片、脚注、批注、公式都不在文字里 —— 这是**取文字**而不是**还原文档**。
 * 上游用引擎转 PDF 时会带上版面，所以本仓的 docx 结果是「更干净但更素」的那一份；
 * 这一点写在 README 的已知差异里，不藏在实现里。
 *
 * @module @lybx-leyw/dsh-zju-core-doc/office
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readFailed, unsupported } from './errors.js';
import { engineExt } from './sniff.js';
import { openZip } from './zip.js';

/** 提取出来的单页/单表文字上限（防止一个畸形 XML 撑爆内存）。 */
const MAX_PART_CHARS = 32 * 1024 * 1024;

/**
 * 极简 XML 扫描：把一个部件里的**文本节点**按结构拼成行。
 *
 * 不引 XML 解析器的理由：OOXML / ODF 的部件是机器生成的、格式良好，而我们要的只有
 * 「哪些字符是正文、哪里该断行」。一个完整的 DOM 会为 40 MB 的 `document.xml`
 * 造出上百万个对象，只为了最后拼一段字符串。
 *
 * 所有**文本节点**都算正文，`skip` 里的子树除外 —— 这一层不做「哪个标签里是文字」
 * 的白名单：`w:t` / `a:t` / `text:p` 之外，ODF 的 `text:line-break` 之类也是
 * 真实的换行信息，靠跳过标签来挑字会漏。要排除的是**非正文**（批注、修订删除、
 * 二进制），那正是 `skip` 的职责。
 *
 * 表格里的换行单独处理：一个单元格内部常常还套着 `<w:p>`，若那里也断行，一行表格
 * 会被拆成「甲」和「乙」两行，列关系就没了。所以进了单元格以后段落结束只留一个
 * 空格，真正分行的是**行结束**（`tr` / `table-row`）。
 *
 * @param {string} xml 部件正文。
 * @param {object} options
 * @param {Set<string>} options.line 这些标签的**结束**意味着换行（表格行内的除外）。
 * @param {Set<string>} options.row 这些标签的结束意味着换行（行内任何层级都算）。
 * @param {Set<string>} options.tab 这些标签代表一个制表符。
 * @param {Set<string>} options.cell 这些标签的结束代表单元格分隔（制表符）。
 * @param {Set<string>} options.skip 这些标签的整棵子树都不要（修订删除、二进制）。
 * @returns {string} 拼好的正文。
 * @throws {DocError} `READ_FAILED` 部件超过取字上限。
 */
function xmlText(xml, { line, row, tab, cell, skip }) {
  const parts = [];
  let depthSkip = 0;
  /** 当前嵌在几层单元格里（0 = 不在表格里）。 */
  let depthCell = 0;
  let length = 0;

  // 一次扫描同时处理标签与文本：`<...>` 之外的都是文本节点。
  // 用扫描而不是 DOM：40 MB 的 document.xml 造 DOM 会多出上百万个对象，
  // 而这里最终只要一段字符串。
  const tag = /<([^>]*)>/g;
  let last = 0;
  let match;
  while ((match = tag.exec(xml)) !== null) {
    if (match.index > last) {
      const chunk = xml.slice(last, match.index);
      if (depthSkip === 0 && chunk !== '') {
        parts.push(decodeEntities(chunk));
        length += chunk.length;
        if (length > MAX_PART_CHARS) throw readFailed('文档的 XML 部件超过取字上限');
      }
    }
    last = tag.lastIndex;

    const body = match[1];
    // 注释、处理指令、CDATA 声明不是元素；CDATA 的内容在下面的文本分支里，
    // 这里只需不把它当标签解析。
    if (body.startsWith('!') || body.startsWith('?')) continue;
    const closing = body.startsWith('/');
    const selfClosing = body.endsWith('/');
    const rawName = closing ? body.slice(1) : body.replace(/\/$/, '');
    const name = localName(rawName);
    if (name === '') continue;

    if (closing) {
      if (depthSkip > 0) {
        if (skip.has(name)) depthSkip -= 1;
        continue;
      }
      if (row.has(name)) parts.push('\n');
      else if (cell.has(name)) {
        depthCell = Math.max(0, depthCell - 1);
        parts.push('\t');
      } else if (line.has(name)) {
        // 单元格里的段落结束只留空格：真正分列的是 `\t`、分行的是行结束。
        parts.push(depthCell > 0 ? ' ' : '\n');
      }
      continue;
    }

    if (depthSkip > 0) {
      if (skip.has(name) && !selfClosing) depthSkip += 1;
      continue;
    }
    if (skip.has(name)) {
      if (!selfClosing) depthSkip += 1;
      continue;
    }
    if (cell.has(name) && !selfClosing) depthCell += 1;
    if (selfClosing) {
      if (tab.has(name)) parts.push('\t');
      else if (row.has(name)) parts.push('\n');
      else if (line.has(name)) parts.push(depthCell > 0 ? ' ' : '\n');
      continue;
    }
    if (tab.has(name)) parts.push('\t');
  }

  return parts.join('');
}

/** `w:p` → `p`（去掉命名空间前缀：同一个标签在不同文档里前缀可能不同）。 */
function localName(name) {
  const colon = name.indexOf(':');
  return (colon < 0 ? name : name.slice(colon + 1)).trim();
}

/** 五个预定义实体 + 数字实体。OOXML 只会用这些。 */
function decodeEntities(value) {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    switch (body) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return whole;
    }
  });
}

/**
 * 把拼好的正文收成「没有空行、行尾无空格」的样子。
 *
 * 空格出现在制表符之前时要一并去掉：单元格里的段落结束会留一个空格（见
 * {@link xmlText}），它紧挨着分隔用的制表符，留着就成了「甲 \t乙」—— 看起来像
 * 排版噪音，而下游按制表符切列时还会多出一个尾随空格。
 */
function tidy(text) {
  return text
    // 制表符 / 换行 / 行尾之前的空格没有意义。
    .replace(/[ \u3000]+(?=\t|\n|$)/g, '')
    .split('\n')
    .map((line) => line.replace(/\t{2,}/g, '\t').replace(/\t+$/g, ''))
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

/* ── Word：word/document.xml ─────────────────────────────────────────────── */

const DOCX = {
  // `p` 是段落（单元格内只留空格），`tr` 是表格行（真正的换行）。
  line: new Set(['p']),
  row: new Set(['tr']),
  tab: new Set(['tab', 'ptab']),
  cell: new Set(['tc']),
  // `delText` 是修订模式下被删掉的文字、`instrText` 是域代码、`binData` 是内嵌二进制、
  // `Fallback` 是兼容性回退块（里面是给老版本的重复内容）—— 它们都不是正文。
  skip: new Set(['instrText', 'delText', 'binData', 'Fallback']),
};

/**
 * `.docx` 的正文。
 *
 * 段落结束换行，表格单元格之间用制表符、行结束换行 —— 与 LibreOffice 导出纯文本
 * 的形态一致，所以「同一份文档两种路径」读出来的行结构是同一个。
 *
 * @param {Buffer} buffer 文件字节。
 * @returns {{pages: {page: number, text: string}[]}} 一页（Word 没有页边界，见下）。
 */
function docxPages(buffer) {
  const zip = openZip(buffer);
  const xml = zip.text('word/document.xml');
  if (xml === undefined) throw readFailed('这不是一个 Word 文档：缺少 word/document.xml');
  const text = tidy(xmlText(xml, DOCX));
  // `w:lastRenderedPageBreak` 能标出「上次排版时分页在哪」，但它取决于打开过它的
  // 排版引擎、且经常一个都没有。用它当页边界会让同一份文件在不同机器上给出
  // 不同的页数 —— 所以 Word 一律按一页报，页的概念交给 PDF。
  return { pages: text ? [{ page: 1, text }] : [] };
}

/* ── Excel：sharedStrings.xml + worksheets/sheetN.xml ───────────────────── */

/** 读 `xl/sharedStrings.xml` 里的字符串表（xlsx 的单元格默认只存索引）。 */
function sharedStrings(zip) {
  const xml = zip.text('xl/sharedStrings.xml');
  if (xml === undefined) return [];
  const out = [];
  // 每个 `<si>` 是一个字符串；富文本会被拆成多个 `<t>`，要拼回去。
  for (const block of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    out.push(decodeEntities((block.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((run) => decodeEntities(run.replace(/<[^>]*>/g, '')))
      .join('')));
  }
  return out;
}

/** `<sheet name="Sheet1" sheetId="1" r:id="rId1"/>` 的列表。 */
function sheetList(xml) {
  const out = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /name="([^"]*)"/.exec(match[0])?.[1] ?? '';
    const rid = /r:id="([^"]*)"/.exec(match[0])?.[1] ?? '';
    out.push({ name: decodeEntities(name), rid });
  }
  return out;
}

/** `xl/_rels/workbook.xml.rels`：`rId1 → worksheets/sheet1.xml`。 */
function sheetTargets(zip) {
  const xml = zip.text('xl/_rels/workbook.xml.rels');
  const map = new Map();
  if (xml === undefined) return map;
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = /Id="([^"]*)"/.exec(match[0])?.[1];
    const target = /Target="([^"]*)"/.exec(match[0])?.[1];
    if (id && target) map.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''));
  }
  return map;
}

/**
 * 一张工作表 → TSV 文本。空单元格保留位置（用制表符），否则列会错位。
 *
 * @param {string} xml 工作表部件。
 * @param {string[]} strings 共享字符串表。
 * @returns {string} 行以换行分隔、列以制表符分隔。
 */
function sheetText(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    let expected = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      // `<c r="C3">` 的列号：C → 3。缺 `r` 时按出现顺序。
      const column = ref ? columnIndex(ref) : expected;
      while (cells.length < column - 1) cells.push('');
      const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      let value = '';
      if (type === 's') {
        const index = Number.parseInt(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '', 10);
        value = Number.isFinite(index) ? (strings[index] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = decodeEntities((inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((run) => run.replace(/<[^>]*>/g, ''))
          .join(''));
      } else {
        value = decodeEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      cells[column - 1] = value;
      expected = column;
    }
    const line = cells.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t').replace(/\t+$/g, '');
    if (line.trim() !== '') rows.push(line);
  }
  return rows.join('\n');
}

/** `A` → 1，`AB` → 28。 */
function columnIndex(letters) {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

/** `.xlsx` 的正文：每个工作表一页（页号 = 工作表顺序）。 */
function xlsxPages(buffer) {
  const zip = openZip(buffer);
  const workbook = zip.text('xl/workbook.xml');
  if (workbook === undefined) throw readFailed('这不是一个 Excel 工作簿：缺少 xl/workbook.xml');
  const strings = sharedStrings(zip);
  const targets = sheetTargets(zip);
  const pages = [];
  for (const [index, sheet] of sheetList(workbook).entries()) {
    const relative = targets.get(sheet.rid) ?? `worksheets/sheet${index + 1}.xml`;
    const xml = zip.text(`xl/${relative}`) ?? zip.text(`xl/worksheets/sheet${index + 1}.xml`);
    const text = xml === undefined ? '' : sheetText(xml, strings).trim();
    if (text !== '') pages.push({ page: pages.length + 1, title: sheet.name, text });
  }
  return { pages };
}

/* ── PowerPoint：ppt/slides/slideN.xml ───────────────────────────────────── */

const PPTX = {
  line: new Set(['p']),
  row: new Set([]),
  tab: new Set([]),
  cell: new Set([]),
  // 备注页（`notesSlide`）不在 slideN.xml 里；这里要排除的是**修订删除**与
  // 内嵌二进制。`a:t` 之外的文字（图表标签、SmartArt）也是正文，保留。
  skip: new Set(['delText', 'binData', 'Fallback']),
};

/**
 * `.pptx` 的正文：每张幻灯片一页。
 *
 * 幻灯片的**顺序**不能靠文件名数字排序（`slide10` 会排在 `slide2` 前面）。真正的
 * 顺序在 `ppt/presentation.xml` 的 `sldIdLst` 里，通过 rels 映射到文件名。
 * 拿不到映射时退回数字排序 —— 单页数少于 10 的文稿两者一致，超过 10 页时会乱序，
 * 所以只在结构确实缺失（非标准生成器）时才走那条。
 *
 * @param {Buffer} buffer 文件字节。
 * @returns {{pages: {page: number, title: string, text: string}[]}}
 */
function pptxPages(buffer) {
  const zip = openZip(buffer);
  const presentation = zip.text('ppt/presentation.xml');
  if (presentation === undefined) throw readFailed('这不是一个 PowerPoint 文稿：缺少 ppt/presentation.xml');
  const rels = zip.text('ppt/_rels/presentation.xml.rels') ?? '';
  const targets = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = /Id="([^"]*)"/.exec(match[0])?.[1];
    const target = /Target="([^"]*)"/.exec(match[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?ppt\//, '').replace(/^\.\.\//, ''));
  }
  const ordered = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\/?>/g)) {
    const rid = /r:id="([^"]*)"/.exec(match[0])?.[1];
    const target = rid ? targets.get(rid) : undefined;
    if (target !== undefined) ordered.push(`ppt/${target}`);
  }
  const slides = ordered.length > 0
    ? ordered
    : zip.match(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => {
      const number = (name) => Number.parseInt(name.match(/(\d+)\.xml$/)?.[1] ?? '0', 10);
      return number(a) - number(b);
    });

  const pages = [];
  for (const name of slides) {
    const xml = zip.text(name);
    if (xml === undefined) continue;
    const text = tidy(xmlText(xml, PPTX));
    if (text !== '') pages.push({ page: pages.length + 1, text });
  }
  return { pages };
}

/* ── ODF：content.xml（odt / ods / odp 同一份结构） ─────────────────────── */

const ODF = {
  // ODF 的段落 `text:p` 在单元格里同样常见，规则与 docx 一致：
  // 单元格内只留空格，真正的换行是表格行 `table:table-row`。
  line: new Set(['p', 'h']),
  row: new Set(['table-row']),
  tab: new Set(['tab']),
  cell: new Set(['table-cell']),
  // `note` 是脚注/尾注的正文（不属于读者看到的这一页），`tracked-changes` 是
  // 修订记录（同一段文字可能出现两次：旧版与新版）。
  skip: new Set(['note', 'tracked-changes']),
};

/**
 * `.odt` / `.ods` / `.odp` 的正文。
 *
 * 三种 ODF 的正文都在 `content.xml` 里，标签集也一致（文字是 `text:p`，表格是
 * `table:table-row` / `table:table-cell`）。所以它们共用一条路径，只在「一个文件
 * 算几页」上不同：文字文档一页，表格按工作表、演示按幻灯片拆 —— 但 ODF 的
 * 表与页在 `content.xml` 里没有清晰分层，本包按**一个文件一页**报，把结构差异
 * 留在文字里的制表符与空行上。
 *
 * @param {Buffer} buffer 文件字节。
 * @returns {{pages: {page: number, text: string}[]}}
 */
function odfPages(buffer) {
  const zip = openZip(buffer);
  const xml = zip.text('content.xml');
  if (xml === undefined) throw readFailed('这不是一个 OpenDocument 文件：缺少 content.xml');
  const text = tidy(xmlText(xml, ODF));
  return { pages: text ? [{ page: 1, text }] : [] };
}

/* ── 引擎（可选） ──────────────────────────────────────────────────────── */

/**
 * 试着拿到 DSH 自带的 Office 引擎。
 *
 * @returns {Promise<{createConverter: Function}|null>} 没有就返回 `null`。
 */
export async function loadOfficeEngine() {
  try {
    return await import('@deepseek-ai/libreoffice-kit');
  } catch {
    // 没有引擎不是异常：docx/xlsx/pptx 走上面的 XML 路径，老式格式会明确报 UNSUPPORTED。
    return null;
  }
}

/** 引擎转换的临时目录前缀（用完删掉）。 */
const TMP_PREFIX = 'zju-doc-';

/**
 * 用引擎把文件转成 PDF 或纯文本。
 *
 * 输入先拷进临时目录、换成引擎**认识**的扩展名再转：引擎按扩展名认格式，而用户给
 * 的文件常常顶着错的扩展名（`.docx` 里其实是 97-2003 的 `.doc`）。
 *
 * @param {string} file 源文件。
 * @param {string} ext 真实扩展名（`sniff()` 给的）。
 * @param {'pdf'|'txt'} target 目标格式。
 * @returns {Promise<{file: string, cleanup: () => Promise<void>}>}
 * @throws {DocError} `UNSUPPORTED` 没有引擎；`READ_FAILED` 引擎转换失败。
 */
export async function convertWithEngine(file, ext, target) {
  const engine = await loadOfficeEngine();
  if (engine === null) {
    throw unsupported(
      `这台机器上没有 Office 引擎（@deepseek-ai/libreoffice-kit），${ext} 转 ${target.toUpperCase()} 需要它`,
      { file, ext, target },
    );
  }
  const work = await fs.mkdtemp(path.join(os.tmpdir(), TMP_PREFIX));
  const cleanup = () => fs.rm(work, { recursive: true, force: true });
  try {
    const input = path.join(work, `input${engineExt(ext)}`);
    const output = path.join(work, `output.${target}`);
    await fs.copyFile(file, input);
    const converter = await engine.createConverter({ timeoutMs: 180_000 });
    try {
      await converter.convert({ inputPath: input, outputPath: output });
    } finally {
      await converter.dispose();
    }
    return { file: output, cleanup };
  } catch (error) {
    await cleanup();
    throw readFailed(`文档转换失败：${error instanceof Error ? error.message : String(error)}`, { file, ext }, error);
  }
}

/* ── 对外入口 ──────────────────────────────────────────────────────────── */

/**
 * 从 Office 文件取文字，按页/表/张给出。
 *
 * 两条路：
 *
 *   1. **有引擎**（桌面端）：Word 导出纯文本（不按版面断行，最干净），表格与演示
 *      先转 PDF 再逐页取字 —— 与上游 `office.ts` 完全一致，页也真的准确。
 *   2. **没引擎**（本仓当前）：直接读 OOXML / ODF 的 XML，零依赖。页的概念在
 *      Word / ODF 里退化为一页，在 Excel / PPT 里是工作表 / 幻灯片。
 *
 * @param {string} file 文件路径。
 * @param {string} ext 真实扩展名。
 * @param {(file: string) => Promise<string[]>} pdfTexts 逐页取 PDF 文字（由 pdf.js 提供）。
 * @returns {Promise<{pages: {page: number, title?: string, text: string}[], via: string}>}
 */
export async function officePages(file, ext, pdfTexts) {
  const engine = await loadOfficeEngine();
  if (engine !== null) {
    if (ext === '.doc' || ext === '.docx' || ext === '.odt') {
      const converted = await convertWithEngine(file, ext, 'txt');
      try {
        const raw = await fs.readFile(converted.file, 'utf8');
        // 引擎导出的纯文本是回车换行，有的只有回车。
        const text = tidy(raw.split(/\r\n?/).join('\n'));
        return { pages: text ? [{ page: 1, text }] : [], via: 'libreoffice' };
      } finally {
        await converted.cleanup();
      }
    }
    const converted = await convertWithEngine(file, ext, 'pdf');
    try {
      const texts = await pdfTexts(converted.file);
      return {
        pages: texts.map((text, index) => ({ page: index + 1, text })).filter((page) => page.text !== ''),
        via: 'libreoffice',
      };
    } finally {
      await converted.cleanup();
    }
  }

  const buffer = await fs.readFile(file);
  if (ext === '.docx') return { ...docxPages(buffer), via: 'ooxml' };
  if (ext === '.xlsx' || ext === '.xlsm') return { ...xlsxPages(buffer), via: 'ooxml' };
  if (ext === '.pptx') return { ...pptxPages(buffer), via: 'ooxml' };
  if (ext === '.odt' || ext === '.ods' || ext === '.odp') return { ...odfPages(buffer), via: 'odf' };
  // 老式二进制格式（OLE 复合文档）没有 XML 可读 —— 说清楚要怎么办，不猜。
  throw unsupported(
    `${ext} 是 1997-2003 的老式二进制格式，需要 Office 引擎才能读；请先用 Word / WPS 另存为 `
    + `${ext === '.xls' ? '.xlsx' : ext === '.ppt' || ext === '.pps' ? '.pptx' : '.docx'}`,
    { file, ext },
  );
}

export { docxPages, xlsxPages, pptxPages, odfPages, xmlText };
