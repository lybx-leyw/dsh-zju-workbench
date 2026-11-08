/**
 * 文档转文字和 PDF 处理：本地文件或链接 → 文字；图片、Word、PDF 合成一个 PDF；取出指定页；找关键词所在页。
 * 供所有模块下载到的 PDF、Word、PPT、Excel 等使用。
 *
 * 2026-10-12 起不用 Python：PDF 的文字用 pdf.js 取，合成和取页用 pdf-lib（pdf.ts）；Word、Excel、PPT 先交给应用自带的
 * Office 引擎转一下再读（office.ts）。原来的 render、images、check、setup 四条命令去掉了：看页面长什么样，
 * 用那个引擎的命令行把页面渲染成图（助手的说明里写了），不在这里再包一层。RTF、WPS 引擎不认，不再支持。
 * 链接下载：*.zju.edu.cn 与 cc98.org 经 WebVPN，教务网附件使用教务网会话，其余直连。
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "parse5";
import { paths } from "../core/paths.ts";
import { BadResponse, ConfigError, ZjuError } from "../core/errors.ts";
import { log } from "../core/output.ts";
import type { HttpResponse } from "../core/http.ts";
import type { ModuleRequirements } from "../core/module.ts";
import { openContext } from "../webvpn/transport.ts";
import { unwrapUrl } from "../webvpn/client.ts";
import { openZdbk, ZDBK_HOST } from "../zdbk/client.ts";
import { convertOffice } from "./office.ts";
import { combinePdf, extractPages, findInPdf, pdfTexts } from "./pdf.ts";
import { sniff } from "./sniff.ts";

const INLINE_CHARS = 20_000;
/** 取出来的文字最多这么多字节，再多多半是读错了。 */
const MAX_TEXT = 16 * 1024 * 1024;
const CAMPUS = ["zju.edu.cn", "cc98.org"];

interface Page { page: number; title?: string; text: string }
interface Extracted { status: "text" | "no_text" | "unsupported" | "error"; format: string; pages: Page[]; reason: string | null; convertedVia?: string; declaredFormat?: string }

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

const result = (status: Extracted["status"], format: string, pages: Page[] = [], reason: string | null = null): Extracted => ({ status, format, pages, reason });

function guard(pages: Page[]): Page[] {
  if (pages.reduce((sum, page) => sum + Buffer.byteLength(page.text, "utf8"), 0) > MAX_TEXT) throw new BadResponse("提取的文字超过 16 MiB");
  return pages;
}

/** 纯文本：先按 UTF-8，不行按 GB18030，都不行就把认不出的字换掉。 */
async function readText(file: string): Promise<string> {
  const data = await fs.readFile(file);
  if (data.length > MAX_TEXT) throw new BadResponse("文本文件超过 16 MiB");
  for (const encoding of ["utf-8", "gb18030"]) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(data); } catch { /* 换下一种 */ }
  }
  return new TextDecoder("utf-8").decode(data);
}

const BLOCK = new Set(["p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"]);
interface HtmlNode { nodeName: string; value?: string; childNodes?: HtmlNode[]; content?: HtmlNode }

/** 网页的正文：去掉脚本和样式，块级标签换行，表格的格子用竖线隔开。 */
function htmlText(source: string): string {
  const parts: string[] = [];
  const walk = (node: HtmlNode) => {
    if (node.nodeName === "script" || node.nodeName === "style") return;
    if (node.nodeName === "#text") { parts.push(node.value ?? ""); return; }
    if (BLOCK.has(node.nodeName)) parts.push("\n");
    for (const child of node.content?.childNodes ?? node.childNodes ?? []) walk(child);
    if (node.nodeName === "td" || node.nodeName === "th") parts.push(" | ");
  };
  walk(parse(source) as unknown as HtmlNode);
  return parts.join("").split("\n").map(line => line.replace(/[ \t\u3000]+/g, " ").replace(/^[ |]+|[ |]+$/g, "")).filter(Boolean).join("\n");
}

/** 先让引擎把 Office 文件转成 PDF，再逐页取文字。 */
async function officePages(file: string, ext: string): Promise<Page[]> {
  const converted = await convertOffice(file, ext, "pdf");
  try { return (await pdfTexts(converted.file)).map((text, index) => ({ page: index + 1, text })).filter(page => page.text); }
  finally { await converted.cleanup(); }
}

/** 一个文件里的文字，按页给出。 */
async function extract(file: string): Promise<Extracted> {
  const declared = path.extname(file).toLowerCase(), { ext, kind } = await sniff(file);
  const format = ext.slice(1) || "unknown";
  const done = (extracted: Extracted): Extracted => ext === declared ? extracted : { ...extracted, declaredFormat: declared.slice(1) || "unknown" };
  if (kind === "text") {
    const text = await readText(file);
    return done(text.trim() ? result("text", format, [{ page: 1, text }]) : result("no_text", format, [], "文件为空"));
  }
  if (kind === "html") {
    const text = htmlText(await readText(file));
    return done(text ? result("text", format, [{ page: 1, text }]) : result("no_text", format, [], "网页没有正文文字"));
  }
  if (kind === "pdf") {
    const pages = guard((await pdfTexts(file)).map((text, index) => ({ page: index + 1, text })).filter(page => page.text));
    return done(pages.length ? result("text", format, pages) : result("no_text", format, [], "没有可提取的文字，可能是扫描件；要看内容就把页面渲染成图来看"));
  }
  if (kind === "writer") {
    // 文字文档直接让引擎导出纯文本，比从 PDF 里取干净（不按版面断行）。
    const converted = await convertOffice(file, ext, "txt");
    try {
      // 引擎导出的纯文本是回车换行，有的只有回车。
      const text = (await readText(converted.file)).split(/\r\n?/).join("\n").trim();
      const extracted = text ? result("text", format, guard([{ page: 1, text }])) : result("no_text", format, [], "文档没有可提取文字，可能只有图片");
      return done({ ...extracted, convertedVia: "libreoffice" });
    } finally { await converted.cleanup(); }
  }
  if (kind === "calc" || kind === "impress") {
    const pages = guard(await officePages(file, ext));
    const empty = kind === "impress" ? "演示文稿没有可提取文字，可能由截图组成；要看内容就把页面渲染成图来看" : "表格里没有文字";
    return done({ ...(pages.length ? result("text", format, pages) : result("no_text", format, [], empty)), convertedVia: "libreoffice" });
  }
  if (kind === "image") return done(result("no_text", format, [], "图片，需要看图"));
  const legacy = [".rtf", ".wps", ".wpt", ".et", ".dps"].includes(ext);
  return done(result("unsupported", format, [], legacy ? `${ext} 这种格式读不了，请先在 Word 或 WPS 里另存为 docx / xlsx / pptx` : `暂不支持 ${ext || "无扩展名"} 文件`));
}

function outputDir(key: string): string {
  return path.join(paths.output(), "doc", crypto.createHash("sha256").update(key).digest("hex").slice(0, 12));
}

function markdown(name: string, result: Extracted): string {
  const multi = result.pages.length > 1;
  const body = result.pages.map(p => multi || p.title ? `## ${p.title ? `工作表 ${p.title}` : `第 ${p.page} 页`}\n\n${p.text}` : p.text).join("\n\n");
  return `# ${name}\n\n${body}\n`;
}

/** 本地文件转文字；全文另存 Markdown，结果内联前 2 万字 */
export async function extractFile(file: string, source?: string) {
  const absolute = path.resolve(file);
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (!stat?.isFile()) throw new ConfigError(`文件不存在：${absolute}`);
  if (stat.size === 0) throw new BadResponse("文档提取失败：文件为空（0 字节），源文件可能已不存在", { file: absolute });
  const extracted = await extract(absolute);
  const name = path.basename(absolute);
  const text = markdown(name, extracted).trimEnd();
  const dir = outputDir(source ?? absolute);
  await fs.mkdir(dir, { recursive: true });
  const md = path.join(dir, `${name}.md`);
  if (extracted.pages.length) await fs.writeFile(md, text + "\n", "utf8");
  const chars = extracted.pages.reduce((sum, p) => sum + p.text.length, 0);
  return {
    file: absolute, ...(source ? { source } : {}), format: extracted.format, ...(extracted.declaredFormat ? { declaredFormat: extracted.declaredFormat } : {}), status: extracted.status,
    pageCount: extracted.pages.length, chars, ...(extracted.convertedVia ? { convertedVia: extracted.convertedVia } : {}),
    ...(extracted.reason ? { reason: extracted.reason } : {}),
    ...(extracted.pages.length ? { markdown: md, text: text.length > INLINE_CHARS ? text.slice(0, INLINE_CHARS) : text } : {}),
    ...(text.length > INLINE_CHARS ? { truncated: true, note: `正文较长，这里只给前 ${INLINE_CHARS} 字，全文见 markdown 文件` } : {}),
  };
}

const TYPES: [RegExp, string][] = [
  [/pdf/, ".pdf"], [/wordprocessingml/, ".docx"], [/msword/, ".doc"], [/spreadsheetml/, ".xlsx"], [/ms-excel/, ".xls"],
  [/presentationml/, ".pptx"], [/ms-powerpoint/, ".ppt"], [/html/, ".html"], [/text\/plain/, ".txt"], [/csv/, ".csv"],
];

function decodeName(raw: string): string {
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* 保留原值 */ }
  // 服务器常把 UTF-8 或 GBK 文件名按字节放进头部，Node 按 latin1 读出
  if (/[\u0080-ÿ]/.test(name) && !/[^\u0000-ÿ]/.test(name)) {
    const bytes = Buffer.from(name, "latin1");
    const utf8 = bytes.toString("utf8");
    name = utf8.includes("�") ? new TextDecoder("gb18030").decode(bytes) : utf8;
  }
  return name;
}

function filenameOf(res: HttpResponse, url: URL): string {
  const cd = String(res.headers["content-disposition"] ?? "");
  const star = cd.match(/filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/)?.[1];
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/)?.[1];
  let name = star ? decodeName(star) : plain ? decodeName(plain) : decodeName(path.posix.basename(url.pathname));
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(-120) || "download";
  if (!path.extname(name) || /\.(htm|html|aspx|jsp|php)$/i.test(name) && !/html/.test(res.contentType)) {
    const ext = TYPES.find(([re]) => re.test(res.contentType.toLowerCase()))?.[1];
    if (ext) name = name.replace(/\.(htm|html|aspx|jsp|php)$/i, "") + ext;
  }
  return name;
}

async function download(url: URL): Promise<HttpResponse> {
  const host = url.hostname.toLowerCase();
  if (host === ZDBK_HOST) {
    const z = await openZdbk();
    try { return await z.get(url.href); } finally { z.close(); }
  }
  const campus = CAMPUS.some(h => host === h || host.endsWith("." + h));
  const requirements: ModuleRequirements = { name: "doc", title: "文档下载", hosts: campus ? CAMPUS : [], auth: "none", network: campus ? "campus" : "public", writes: false };
  const ctx = await openContext(requirements, { timeout: 60_000 });
  try { return await ctx.fetchFollow(url.href); } finally { ctx.close(); }
}

/** 下载链接指向的文件并转文字 */
export async function extractUrl(link: string) {
  let url: URL;
  try { url = new URL(link); } catch { throw new ConfigError("链接不是有效 URL"); }
  if (!/^https?:$/.test(url.protocol)) throw new ConfigError("只支持 HTTP(S) 链接");
  const res = await download(url);
  if (res.status !== 200) throw new ZjuError(res.status === 404 || res.status === 403 ? "REMOTE_REJECTED" : "BAD_RESPONSE", `下载失败 HTTP ${res.status}`, { detail: { url: link } });
  if (!res.raw.length) throw new ZjuError("REMOTE_REJECTED", "下载内容为空，源文件可能已不存在", { detail: { url: link } });
  const finalUrl = new URL(unwrapUrl(res.url));
  if (finalUrl.hostname === "webvpn.zju.edu.cn" && /\/login/.test(finalUrl.pathname)) throw new ZjuError("AUTH_EXPIRED", "WebVPN 要求重新登录", { hint: "zju webvpn session login" });
  const dir = outputDir(link);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, filenameOf(res, url));
  await fs.writeFile(file, res.raw);
  log(`已下载 ${path.basename(file)}（${res.raw.length} 字节）`);
  return extractFile(file, link);
}

async function inputFile(file: string): Promise<string> {
  const absolute = path.resolve(file);
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (!stat?.isFile()) throw new ConfigError(`文件不存在：${absolute}`);
  return absolute;
}

/** 明确给出的输出路径不覆盖已有文件；省略时按输入存到 data/output/doc/<哈希>/ */
async function outputFile(out: string | undefined, key: string, name: string, inputs: string[]): Promise<string> {
  let target: string;
  if (out) {
    target = path.resolve(out);
    if (await exists(target)) throw new ConfigError(`输出文件已存在：${target}`);
  } else target = path.join(outputDir(key), name);
  if (inputs.includes(target)) throw new ConfigError("输出文件不能与输入相同");
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

const stem = (file: string) => path.basename(file, path.extname(file));

/** 图片、Word、PDF 按给出的顺序合成一个 PDF；图片按拍摄方向转正，默认居中放在 A4 页上 */
export async function toPdf(files: string[], size: string, out?: string) {
  if (!files.length) throw new ConfigError("需要 --file");
  const inputs = await Promise.all(files.map(inputFile));
  const name = inputs.length > 1 ? `${stem(inputs[0]!)}等${inputs.length}个文件.pdf` : `${stem(inputs[0]!)}.pdf`;
  const target = await outputFile(out, JSON.stringify(["pdf", size, ...inputs]), name, inputs);
  const r = await combinePdf(target, size, inputs);
  return { file: r.out, pages: r.pages, bytes: r.bytes, inputs: r.inputs };
}

/** 从 PDF 取出指定页另存为新 PDF */
export async function pdfPages(file: string, pages: string, out?: string) {
  const input = await inputFile(file);
  const label = pages.replace(/[^\d,-]/g, "").slice(0, 60);
  const target = await outputFile(out, JSON.stringify(["pages", input, pages]), `${stem(input)}_第${label}页.pdf`, [input]);
  const r = await extractPages(input, pages, target);
  return { file: r.out, pages: r.pages, pageCount: r.pages.length, totalPages: r.totalPages, bytes: r.bytes };
}

/** 找关键词在 PDF 的哪几页，每页附一段上下文；每个关键词最多列 50 页 */
export async function pdfFind(file: string, keywords: string[]) {
  if (!keywords.length) throw new ConfigError("需要 --keyword");
  const input = await inputFile(file);
  if ((await sniff(input)).kind !== "pdf") throw new ConfigError(`${path.basename(input)} 不是 PDF 文件`);
  const r = await findInPdf(input, keywords);
  const matches = Object.fromEntries(Object.entries(r.matches).map(([keyword, hits]) => [keyword, { count: hits.length, hits: hits.slice(0, 50) }]));
  return { file: input, totalPages: r.totalPages, textPages: r.textPages, matches, ...(r.textPages ? {} : { note: "没有文字层，可能是扫描件；要找内容只能把页面渲染成图来看" }) };
}
