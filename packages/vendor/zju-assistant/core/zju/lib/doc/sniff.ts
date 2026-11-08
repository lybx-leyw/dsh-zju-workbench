/**
 * 按文件头判断真实格式：学校服务器常给错扩展名（老 Word 文件叫 .docx，下载下来没有扩展名）。
 * 返回真实的扩展名，和它归哪一类：PDF、三类 Office 文件（交给应用自带的 Office 引擎转）、网页、纯文本、图片，其余不认。
 */
import fs from "node:fs/promises";
import path from "node:path";

const TEXT = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".xml"]);
const HTML = new Set([".html", ".htm"]);
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"]);
const OLE = new Set([".doc", ".xls", ".ppt", ".pps", ".wps", ".et", ".dps"]);
/** 老格式的文件顶着新格式的扩展名时，按哪一种老格式算。 */
const OLE_FAMILY: Record<string, string> = { ".docx": ".doc", ".xlsx": ".xls", ".xlsm": ".xls", ".pptx": ".ppt" };
const WRITER = new Set([".doc", ".docx", ".odt"]), CALC = new Set([".xls", ".xlsx", ".xlsm", ".ods"]), IMPRESS = new Set([".ppt", ".pptx", ".pps", ".odp"]);
/** 引擎按扩展名认格式，这两种要换成它认识的写法。 */
const ENGINE_EXT: Record<string, string> = { ".xlsm": ".xlsx", ".pps": ".ppt" };

export type Kind = "pdf" | "writer" | "calc" | "impress" | "html" | "text" | "image" | "other";
export interface Sniffed { ext: string; kind: Kind }

const starts = (data: Buffer, bytes: number[]) => bytes.every((byte, at) => data[at] === byte);

/** 压缩包里装的是哪种文档：名字在包尾的目录里是明文，不用解压。 */
async function zipExt(file: string, size: number, head: Buffer, suffix: string): Promise<string> {
  if ([".docx", ".pptx", ".xlsx", ".xlsm"].includes(suffix)) return suffix;
  const odf = /mimetypeapplication\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)/.exec(head.toString("latin1"));
  if (odf) return odf[1] === "text" ? ".odt" : odf[1] === "spreadsheet" ? ".ods" : ".odp";
  const length = Math.min(size, 4 * 1024 * 1024), tail = Buffer.alloc(length);
  const handle = await fs.open(file, "r");
  try { await handle.read(tail, 0, length, size - length); } finally { await handle.close(); }
  const names = tail.toString("latin1");
  if (names.includes("word/document.xml")) return ".docx";
  if (names.includes("ppt/")) return ".pptx";
  if (names.includes("xl/")) return ".xlsx";
  return suffix;
}

function kindOf(ext: string): Kind {
  if (ext === ".pdf") return "pdf";
  if (WRITER.has(ext)) return "writer";
  if (CALC.has(ext)) return "calc";
  if (IMPRESS.has(ext)) return "impress";
  if (HTML.has(ext)) return "html";
  if (TEXT.has(ext)) return "text";
  if (IMAGES.has(ext)) return "image";
  return "other";
}

export async function sniff(file: string): Promise<Sniffed> {
  const suffix = path.extname(file).toLowerCase(), size = (await fs.stat(file)).size;
  const head = Buffer.alloc(Math.min(size, 512));
  const handle = await fs.open(file, "r");
  try { await handle.read(head, 0, head.length, 0); } finally { await handle.close(); }
  let ext = suffix;
  if (head.subarray(0, 4).toString("latin1") === "%PDF") ext = ".pdf";
  else if (starts(head, [0x50, 0x4b, 0x03, 0x04])) ext = await zipExt(file, size, head, suffix);
  else if (starts(head, [0xd0, 0xcf, 0x11, 0xe0])) ext = OLE.has(suffix) ? suffix : OLE_FAMILY[suffix] ?? ".doc";
  else if (!TEXT.has(suffix) && !HTML.has(suffix)) {
    const text = head.toString("latin1").replace(/^(\xef\xbb\xbf)?[ \t\r\n]*/, "").toLowerCase();
    if (text.startsWith("<!doctype html") || text.startsWith("<html")) ext = ".html";
    else if (starts(head, [0xff, 0xd8, 0xff])) ext = ".jpg";
    else if (starts(head, [0x89, 0x50, 0x4e, 0x47])) ext = ".png";
  }
  return { ext, kind: kindOf(ext) };
}

/** 交给引擎时文件该叫什么扩展名。 */
export const engineExt = (ext: string) => ENGINE_EXT[ext] ?? ext;
