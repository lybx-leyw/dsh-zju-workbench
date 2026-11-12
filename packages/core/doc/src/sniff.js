/**
 * 按**文件头**判断真实格式，不信任扩展名。
 *
 * # 为什么必须这么做
 *
 * 学校服务器给的文件扩展名经常是错的：教务网的附件叫 `.docx` 其实是老式 OLE 的
 * `.doc`，浏览器下载下来干脆没有扩展名，压缩包里装的是 PDF 却叫 `.bin`。
 * 扩展名只用来做**兜底猜测**，真正的判据是文件头几个字节。
 *
 * 上游 `core/zju/lib/doc/sniff.ts` 的做法（zip 尾部目录里找 `word/document.xml`
 * 这类明文条目来判断 OOXML 家族）被完整保留：它不需要解压，读 4 MB 尾部就够，
 * 而 Office 文件动辄几十 MB —— 解压一遍只为认格式是不可接受的成本。
 *
 * @module @lybx-leyw/dsh-zju-core-doc/sniff
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { inputError } from './errors.js';

/** 纯文本类：按 UTF-8 / GB18030 解码，不做结构解析。 */
const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml']);
const HTML = new Set(['.html', '.htm']);
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic']);
/** 老式 OLE 复合文档（Word 97 / Excel 97 / PowerPoint 97 及 WPS 的同代格式）。 */
const OLE = new Set(['.doc', '.xls', '.ppt', '.pps', '.wps', '.et', '.dps']);
/**
 * 老格式文件顶着新格式扩展名时的归类。
 *
 * 只在前 4 字节是 OLE 魔数、而扩展名又写着新格式时才用 —— 例如「另存为
 * docx 但导出成了 97-2003 格式」的常见事故。
 */
const OLE_FAMILY = { '.docx': '.doc', '.xlsx': '.xls', '.xlsm': '.xls', '.pptx': '.ppt' };

const WRITER = new Set(['.doc', '.docx', '.odt']);
const CALC = new Set(['.xls', '.xlsx', '.xlsm', '.ods']);
const IMPRESS = new Set(['.ppt', '.pptx', '.pps', '.odp']);

/**
 * 交给 LibreOffice 引擎时文件该叫什么扩展名。
 *
 * 引擎**按扩展名认格式**，而 `xlsm`（含宏的工作簿）与 `pps`（放映格式）它不认这两个
 * 写法，要换成同族的普通扩展名。
 */
const ENGINE_EXT = { '.xlsm': '.xlsx', '.pps': '.ppt' };

/**
 * 格式归类。
 *
 * 三个 Office 类（`writer` / `calc` / `impress`）分开，是因为**取文字的方式不同**：
 * 文字文档直接导出纯文本最干净（不按版面断行），而表格与演示要先转 PDF 再逐页取字
 * （它们的语义单位是工作表与幻灯片，不是连续段落）。
 *
 * @typedef {'pdf'|'writer'|'calc'|'impress'|'html'|'text'|'image'|'other'} Kind
 */

const starts = (data, bytes) => bytes.every((byte, at) => data[at] === byte);

/**
 * 压缩包里装的是哪种文档。
 *
 * 判断顺序：先看扩展名是不是已知的 OOXML（`docx`/`pptx`/`xlsx`/`xlsm`），
 * 再看 `mimetype` 条目（ODF 的规矩是它必须是**第一个**条目且不压缩，所以前 512
 * 字节就够），最后读包尾的中央目录找 `word/`、`ppt/`、`xl/` 前缀。
 *
 * @param {string} file 文件路径。
 * @param {number} size 文件字节数。
 * @param {Buffer} head 文件头（已读前 512 字节）。
 * @param {string} suffix 原扩展名（小写，含点）。
 * @returns {Promise<string>} 真实扩展名。
 */
async function zipExt(file, size, head, suffix) {
  if (['.docx', '.pptx', '.xlsx', '.xlsm'].includes(suffix)) return suffix;
  const odf = /mimetypeapplication\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)/.exec(
    head.toString('latin1'),
  );
  if (odf) {
    if (odf[1] === 'text') return '.odt';
    return odf[1] === 'spreadsheet' ? '.ods' : '.odp';
  }
  // 尾部目录里的名字是明文：不解压也能看出这个包里装的是 Word 还是 PPT。
  const length = Math.min(size, 4 * 1024 * 1024);
  const tail = Buffer.alloc(length);
  const handle = await fs.open(file, 'r');
  try {
    await handle.read(tail, 0, length, size - length);
  } finally {
    await handle.close();
  }
  const names = tail.toString('latin1');
  if (names.includes('word/document.xml')) return '.docx';
  if (names.includes('ppt/')) return '.pptx';
  if (names.includes('xl/')) return '.xlsx';
  return suffix;
}

/** @param {string} ext @returns {Kind} */
function kindOf(ext) {
  if (ext === '.pdf') return 'pdf';
  if (WRITER.has(ext)) return 'writer';
  if (CALC.has(ext)) return 'calc';
  if (IMPRESS.has(ext)) return 'impress';
  if (HTML.has(ext)) return 'html';
  if (TEXT.has(ext)) return 'text';
  if (IMAGES.has(ext)) return 'image';
  return 'other';
}

/**
 * 读文件头，判断真实格式。
 *
 * @param {string} file 文件路径（相对路径按 `process.cwd()` 解析）。
 * @returns {Promise<{ext: string, kind: Kind}>} 真实扩展名（含点、小写）与归类。
 * @throws {DocError} `INPUT` 文件不存在或不是普通文件。
 */
export async function sniff(file) {
  const suffix = path.extname(file).toLowerCase();
  const stat = await fs.stat(file).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) {
    throw inputError(`文件不存在：${path.resolve(file)}`, { file: path.resolve(file) });
  }
  const size = stat.size;
  const head = Buffer.alloc(Math.min(size, 512));
  if (head.length > 0) {
    const handle = await fs.open(file, 'r');
    try {
      await handle.read(head, 0, head.length, 0);
    } finally {
      await handle.close();
    }
  }

  let ext = suffix;
  if (head.subarray(0, 4).toString('latin1') === '%PDF') ext = '.pdf';
  else if (starts(head, [0x50, 0x4b, 0x03, 0x04])) ext = await zipExt(file, size, head, suffix);
  else if (starts(head, [0xd0, 0xcf, 0x11, 0xe0])) ext = OLE.has(suffix) ? suffix : (OLE_FAMILY[suffix] ?? '.doc');
  else if (!TEXT.has(suffix) && !HTML.has(suffix)) {
    // 没扩展名、或扩展名不可信时，再看一眼内容像不像网页 / JPEG / PNG。
    const text = head.toString('latin1').replace(/^(\xef\xbb\xbf)?[ \t\r\n]*/, '').toLowerCase();
    if (text.startsWith('<!doctype html') || text.startsWith('<html')) ext = '.html';
    else if (starts(head, [0xff, 0xd8, 0xff])) ext = '.jpg';
    else if (starts(head, [0x89, 0x50, 0x4e, 0x47])) ext = '.png';
  }
  return { ext, kind: kindOf(ext) };
}

/**
 * 交给 Office 引擎时用的扩展名（`xlsm`→`xlsx`、`pps`→`ppt`）。
 *
 * @param {string} ext 真实扩展名。
 * @returns {string} 引擎认得的扩展名。
 */
export const engineExt = (ext) => ENGINE_EXT[ext] ?? ext;

export { TEXT as TEXT_EXTENSIONS, IMAGES as IMAGE_EXTENSIONS };
