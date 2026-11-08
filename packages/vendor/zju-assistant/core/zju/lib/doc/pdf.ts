/**
 * PDF 的两件事，都用纯 JS 的库，不用 Python：
 *   取文字（逐页、按关键词找页）  pdf.js（pdfjs-dist，带中文 PDF 要的 cMap）
 *   合成、取页                     pdf-lib；图片先用 sharp 按拍摄方向转正、统一成能嵌进 PDF 的格式（sharp 是引擎的依赖，在应用根目录的 node_modules 里）
 * 渲染成图不在这里：要看页面长什么样，用应用自带的 Office 引擎的命令行（助手的说明里写了怎么用）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { BadResponse, ConfigError, ZjuError } from "../core/errors.ts";
import { convertOffice } from "./office.ts";
import { sniff } from "./sniff.ts";

interface TextItem { str?: string; hasEOL?: boolean }
interface PdfJs {
  getDocument(source: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(number: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }> }>; destroy(): Promise<void> };
}
let loaded: Promise<{ pdfjs: PdfJs; resources: (name: string) => string }> | undefined;

/** pdf.js 导入时会抱怨没有 canvas（那是渲染用的，取文字用不着），这三句不让它出现在命令的输出里。 */
function pdfjs() {
  return loaded ??= (async () => {
    const entry = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const root = path.join(path.dirname(entry), "..", "..");
    const warn = console.warn;
    console.warn = () => {};
    try {
      const module = await import(pathToFileURL(entry).href) as unknown as PdfJs;
      // pdf.js 要正斜杠结尾的目录。
      return { pdfjs: module, resources: (name: string) => path.join(root, name).split(path.sep).join("/") + "/" };
    } finally { console.warn = warn; }
  })();
}

/** 逐页取文字层；没有文字的页是空串。 */
export async function pdfTexts(file: string): Promise<string[]> {
  const { pdfjs: lib, resources } = await pdfjs();
  const data = new Uint8Array(await fs.readFile(file));
  const task = lib.getDocument({ data, verbosity: 0, cMapUrl: resources("cmaps"), cMapPacked: true, standardFontDataUrl: resources("standard_fonts"), useSystemFonts: false, isEvalSupported: false });
  try {
    const document = await task.promise, texts: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      texts.push(content.items.map(item => item.str === undefined ? "" : item.str + (item.hasEOL ? "\n" : "")).join("").trim());
    }
    return texts;
  } catch (error) {
    throw new BadResponse(`读不了这个 PDF：${error instanceof Error ? error.message : String(error)}`, { file });
  } finally { await task.destroy(); }
}

/** 找关键词在哪几页，每页附一段前后文。 */
export async function findInPdf(file: string, keywords: string[]) {
  const texts = await pdfTexts(file);
  const matches: Record<string, { page: number; snippet: string }[]> = {};
  for (const keyword of keywords) {
    matches[keyword] = texts.flatMap((text, index) => {
      const at = text.indexOf(keyword);
      return at < 0 ? [] : [{ page: index + 1, snippet: text.slice(Math.max(0, at - 30), at + keyword.length + 60).split(/\s+/).filter(Boolean).join(" ") }];
    });
  }
  return { totalPages: texts.length, textPages: texts.filter(text => text !== "").length, matches };
}

/** 「1,3-5」这样的页码规则，按页序去重排序，从 0 起。越界、倒序和写错的直接报错，免得取错页。 */
export function parsePageRule(rule: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of rule.replaceAll(" ", "").replaceAll("，", ",").split(",")) {
    if (!part) continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new ConfigError(`页码规则无效：${part}（格式如 1,3-5）`);
    const first = Number(match[1]), last = match[2] === undefined ? first : Number(match[2]);
    if (first > last) throw new ConfigError(`页码范围 ${part} 须从小到大`);
    if (first < 1 || last > totalPages) throw new ConfigError(`页码 ${part} 超出范围 1-${totalPages}`);
    for (let page = first; page <= last; page++) pages.add(page - 1);
  }
  if (!pages.size) throw new ConfigError("没有给出页码");
  return [...pages].sort((a, b) => a - b);
}

async function loadPdf(file: string): Promise<PDFDocument> {
  if ((await sniff(file)).kind !== "pdf") throw new ConfigError(`${path.basename(file)} 不是 PDF 文件`);
  try { return await PDFDocument.load(await fs.readFile(file), { ignoreEncryption: true }); }
  catch (error) { throw new BadResponse(`读不了这个 PDF：${error instanceof Error ? error.message : String(error)}`, { file }); }
}

/** 取出指定页另存为新 PDF；只带走这些页用到的字体和图片。 */
export async function extractPages(file: string, rule: string, out: string) {
  const source = await loadPdf(file), indexes = parsePageRule(rule, source.getPageCount());
  const part = await PDFDocument.create();
  for (const page of await part.copyPages(source, indexes)) part.addPage(page);
  await fs.writeFile(out, await part.save());
  return { out, pages: indexes.map(index => index + 1), totalPages: source.getPageCount(), bytes: (await fs.stat(out)).size };
}

/** A4 的大小（点）；图片最多留到 300 dpi 的 A4 那么大，再大只是让文件变大。原图模式按 100 dpi 算页面大小。 */
const A4 = { width: 595.28, height: 841.89 }, A4_PIXELS = { width: 2480, height: 3508 }, ORIGINAL_DPI = 100;

interface Sharp {
  rotate(): Sharp; flatten(options: { background: string }): Sharp; resize(options: Record<string, unknown>): Sharp;
  jpeg(options: { quality: number }): Sharp; png(): Sharp; metadata(): Promise<{ format?: string }>;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
}
async function sharp(): Promise<(file: string, options?: Record<string, unknown>) => Sharp> {
  try { return (await import("sharp") as unknown as { default: (file: string, options?: Record<string, unknown>) => Sharp }).default; }
  catch (cause) { throw new ZjuError("DEPENDENCY_MISSING", "找不到应用自带的图片库", { hint: "图片转 PDF 要在校园智能体应用里用", cause }); }
}

/** 一张图片放成一页：按拍摄方向转正，透明的地方垫白。照片存成 JPEG，截图这类存成 PNG（不糊字）。 */
async function addImage(target: PDFDocument, file: string, a4: boolean): Promise<void> {
  const open = await sharp();
  const format = (await open(file, { failOn: "none" }).metadata()).format;
  let image = open(file, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  if (a4) image = image.resize({ ...A4_PIXELS, fit: "inside", withoutEnlargement: true });
  const photo = format === "jpeg" || format === "heif";
  const { data, info } = await (photo ? image.jpeg({ quality: 90 }) : image.png()).toBuffer({ resolveWithObject: true });
  const embedded = photo ? await target.embedJpg(data) : await target.embedPng(data);
  if (!a4) {
    const width = info.width * 72 / ORIGINAL_DPI, height = info.height * 72 / ORIGINAL_DPI;
    target.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
    return;
  }
  const scale = Math.min(A4.width / info.width, A4.height / info.height), width = info.width * scale, height = info.height * scale;
  target.addPage([A4.width, A4.height]).drawImage(embedded, { x: (A4.width - width) / 2, y: (A4.height - height) / 2, width, height });
}

async function isImage(file: string): Promise<boolean> {
  try { return (await (await sharp())(file, { failOn: "none" }).metadata()).format !== undefined; }
  catch (error) { if (error instanceof ZjuError) throw error; return false; }
}

/** 图片、Word、PDF 按给出的顺序合成一个 PDF。 */
export async function combinePdf(out: string, size: string, inputs: string[]) {
  if (size !== "a4" && size !== "original") throw new ConfigError("size 只能是 a4 或 original");
  const target = await PDFDocument.create(), parts: { file: string; kind: string; pages: number }[] = [];
  const append = async (file: string) => {
    const source = await loadPdf(file);
    for (const page of await target.copyPages(source, source.getPageIndices())) target.addPage(page);
  };
  for (const file of inputs) {
    const before = target.getPageCount(), sniffed = await sniff(file);
    let kind: string;
    if (sniffed.kind === "pdf") { kind = "pdf"; await append(file); }
    else if (sniffed.kind === "writer") {
      kind = "word";
      const converted = await convertOffice(file, sniffed.ext, "pdf");
      try { await append(converted.file); } finally { await converted.cleanup(); }
    } else if (await isImage(file)) { kind = "image"; await addImage(target, file, size === "a4"); }
    else throw new ConfigError(`不支持 ${path.basename(file)}：只接受图片、PDF 和 Word 文件`);
    parts.push({ file, kind, pages: target.getPageCount() - before });
  }
  await fs.writeFile(out, await target.save());
  return { out, pages: target.getPageCount(), bytes: (await fs.stat(out)).size, inputs: parts };
}
