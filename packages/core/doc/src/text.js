/**
 * `doc text`：把一份文档变成**按页编号的文字**，并把全文另存为 Markdown。
 *
 * # 返回值为什么是「状态」而不是「要么成功要么抛错」
 *
 * 这类工具最常见的输入之一就是**扫描件**（拍下来的讲义、扫描的教材）。它读不到文字
 * 不是失败 —— 是这份文件的正常结果。把它做成异常会让调用方用 `try/catch` 当流程
 * 控制，而模型看到的会是「工具出错了」，于是它去重试一个永远不会成的动作。
 * 所以：
 *
 * | status | 含义 | 调用方该怎么办 |
 * |---|---|---|
 * | `text` | 取到文字 | 直接用 |
 * | `no_text` | 文件里没有文字层（扫描件 / 纯图 / 空文件） | 要看内容就把页面渲染成图 |
 * | `unsupported` | 这个格式本机读不了 | 换格式另存 |
 *
 * 真正的失败（文件不存在、损坏、超限）仍然**抛** `DocError` —— 那不是文档的性质，
 * 是这次调用的错。
 *
 * # 为什么要把 Markdown 写到盘上
 *
 * 工具结果会进模型的上下文，一份 300 页的教材塞进去会把它挤爆。上游的做法是
 * **正文只内联前 2 万字**，全文落到一个文件里，并把路径一起返回 —— 模型需要更多时
 * 自己用读文件的工具去取。这个形状被完整保留（见 {@link INLINE_CHARS}）。
 *
 * @module @lybx-leyw/dsh-zju-core-doc/text
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { DocError, inputError, tooLarge } from './errors.js';
import { officePages } from './office.js';
import { pdfTexts } from './pdf.js';
import { sniff } from './sniff.js';

/** 内联进结果的字符数上限（再长的部分只给路径）。 */
export const INLINE_CHARS = 20_000;
/**
 * 取出来的总字节上限。
 *
 * 16 MiB 是上游的取值，理由值得保留：一份正常的文档不会超过它，而超过它多半意味着
 * **读错了东西**（例如把一个压缩包当成文本读、或页面里全是垃圾字符）。
 * 与其把 200 MB 垃圾塞进上下文，不如在这里停下并说清发生了什么。
 */
export const MAX_TEXT_BYTES = 16 * 1024 * 1024;

/**
 * 按 UTF-8 读文本，不行按 GB18030，都不行就用替换字符解码。
 *
 * 为什么要有第二条：国内学校给的 `.txt` / `.csv` 导出经常是 GBK。只认 UTF-8 时
 * 中文会变成一整片 `�`，而调用方看到的是「文件里就是这个内容」—— 那是假信息。
 * `TextDecoder('gb18030')` 是 Node 内置的（ICU），不需要额外依赖。
 *
 * @param {Buffer} data 文件字节。
 * @returns {string} 解码后的文本。
 */
export function decodeText(data) {
  for (const encoding of ['utf-8', 'gb18030']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(data);
    } catch {
      // 换下一种编码再试。
    }
  }
  // 两种都不是合法序列：用非致命模式解码，让认不出的字节变成 U+FFFD 而不是抛错。
  return new TextDecoder('utf-8').decode(data);
}

/** 块级标签：它们的结束意味着一个换行。 */
const BLOCK = new Set(['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'table']);
/** 表格格子：彼此之间用竖线隔开，否则两列会粘成一串。 */
const CELL = new Set(['td', 'th']);

/**
 * 网页正文。
 *
 * 不引 HTML 解析器：要的只是「块级标签断行、去掉脚本与样式、表格格子分开」。
 * 一个完整解析器会为一页广告横飞的网页造出几十万个节点，而结果是一样的。
 *
 * @param {string} html 网页源码。
 * @returns {string} 压过空白的正文。
 */
export function htmlText(html) {
  const parts = [];
  let skipDepth = 0;
  const tag = /<([^>]*)>/g;
  let last = 0;
  let match;
  while ((match = tag.exec(html)) !== null) {
    if (match.index > last) {
      const chunk = html.slice(last, match.index);
      if (skipDepth === 0 && chunk !== '') parts.push(decodeHtmlEntities(chunk));
    }
    last = tag.lastIndex;
    const body = match[1];
    if (body.startsWith('!') || body.startsWith('?')) continue;
    const closing = body.startsWith('/');
    const selfClosing = body.endsWith('/') || body.endsWith('/ ');
    const name = (closing ? body.slice(1) : body.replace(/\/\s*$/, ''))
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    if (name === '') continue;
    const skip = name === 'script' || name === 'style' || name === 'noscript' || name === 'template';
    if (skip) {
      if (closing) skipDepth = Math.max(0, skipDepth - 1);
      else if (!selfClosing) skipDepth += 1;
      continue;
    }
    if (skipDepth > 0) continue;
    if (BLOCK.has(name)) parts.push('\n');
    if (closing && CELL.has(name)) parts.push(' | ');
  }
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+/g, ' ').replace(/^[ |]+|[ |]+$/g, ''))
    .filter((line) => line !== '')
    .join('\n');
}

/** 网页里常见的命名实体 + 数字实体。 */
function decodeHtmlEntities(value) {
  if (!value.includes('&')) return value;
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ' };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/**
 * 按计划里的一页/一表/一张，加上总量校验。
 *
 * @param {{page: number, title?: string, text: string}[]} pages 各页。
 * @returns {{page: number, title?: string, text: string}[]} 原样返回（校验通过时）。
 * @throws {DocError} `TOO_LARGE` 超过上限。
 */
function guard(pages) {
  const bytes = pages.reduce((sum, page) => sum + Buffer.byteLength(page.text, 'utf8'), 0);
  if (bytes > MAX_TEXT_BYTES) {
    throw tooLarge(`提取的文字超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB（${bytes} 字节）`, { bytes });
  }
  return pages;
}

/**
 * 生成 Markdown 正文。
 *
 * 单页且无标题时**不加小标题** —— 给一段纯文本套上 `## 第 1 页` 只是噪音，而且模型
 * 很容易把那个人造标题当成文档内容引用出来。
 *
 * @param {string} name 文件名（作为一级标题）。
 * @param {{page: number, title?: string, text: string}[]} pages 各页。
 * @returns {string} Markdown。
 */
export function markdown(name, pages) {
  const multi = pages.length > 1;
  const body = pages
    .map((page) => {
      const heading = page.title !== undefined ? `工作表 ${page.title}` : `第 ${page.page} 页`;
      return multi || page.title !== undefined ? `## ${heading}\n\n${page.text}` : page.text;
    })
    .join('\n\n');
  return `# ${name}\n\n${body}\n`;
}

/**
 * 一个文件里的文字，按页给出。
 *
 * @param {string} file 绝对路径。
 * @returns {Promise<{status: 'text'|'no_text'|'unsupported', format: string,
 *   pages: {page: number, title?: string, text: string}[], reason: string|null,
 *   declaredFormat?: string, convertedVia?: string}>}
 */
export async function extract(file) {
  const declared = path.extname(file).toLowerCase();
  const stat = await fs.stat(file);
  if (stat.size === 0) {
    throw inputError('文档提取失败：文件为空（0 字节）', { file });
  }
  const { ext, kind } = await sniff(file);
  const format = ext.slice(1) || 'unknown';

  const done = (extracted) => (ext === declared
    ? extracted
    : { ...extracted, declaredFormat: declared.slice(1) || 'unknown' });
  const empty = (reason) => ({ status: 'no_text', format, pages: [], reason });

  if (kind === 'text') {
    const data = await fs.readFile(file);
    if (data.byteLength > MAX_TEXT_BYTES) throw tooLarge('文本文件超过 16 MiB', { bytes: data.byteLength });
    const text = decodeText(data);
    return done(text.trim() !== ''
      ? { status: 'text', format, pages: guard([{ page: 1, text }]), reason: null }
      : empty('文件为空'));
  }

  if (kind === 'html') {
    const text = htmlText(decodeText(await fs.readFile(file)));
    return done(text !== ''
      ? { status: 'text', format, pages: guard([{ page: 1, text }]), reason: null }
      : empty('网页没有正文文字'));
  }

  if (kind === 'pdf') {
    const texts = await pdfTexts(file);
    const pages = guard(texts.map((text, index) => ({ page: index + 1, text })).filter((page) => page.text !== ''));
    return done(pages.length > 0
      ? { status: 'text', format, pages, reason: null }
      : empty('没有可提取的文字，可能是扫描件；要看内容就把页面渲染成图来看'));
  }

  if (kind === 'image') {
    // 图片没有文字层。这里不做 OCR：OCR 要另一条依赖链，而「看图」本身是模型的能力。
    return done(empty('图片，需要看图'));
  }

  if (kind === 'writer' || kind === 'calc' || kind === 'impress') {
    const { pages, via } = await officePages(file, ext, pdfTexts);
    const emptyReason = kind === 'impress'
      ? '演示文稿没有可提取文字，可能由截图组成；要看内容就把页面渲染成图来看'
      : kind === 'calc'
        ? '表格里没有文字'
        : '文档没有可提取文字，可能只有图片';
    return done({
      ...(pages.length > 0
        ? { status: 'text', pages: guard(pages), reason: null }
        : empty(emptyReason)),
      format,
      convertedVia: via,
    });
  }

  // 老式二进制（.doc/.xls/.ppt）在上面走 office 分支并已被明确拒绝；
  // 走到这里的是 RTF、WPS 专有格式这类两边都不认的。
  const legacy = ['.rtf', '.wps', '.wpt', '.et', '.dps'].includes(ext);
  return done({
    status: 'unsupported',
    format,
    pages: [],
    reason: legacy
      ? `${ext} 这种格式读不了，请先在 Word 或 WPS 里另存为 docx / xlsx / pptx`
      : `暂不支持 ${ext || '无扩展名'} 文件`,
  });
}

/**
 * 本地文件 → 文字 + 一份落盘的 Markdown。
 *
 * @param {string} file 文件路径（可以是相对路径）。
 * @param {object} options
 * @param {string} options.outputDir 全文 Markdown 的落地目录。
 * @param {string} [options.source] 来源标识（例如下载链接）；只写进结果，不参与取字。
 * @returns {Promise<object>} 见 README 的返回形状。
 * @throws {DocError} `INPUT` 文件不存在/为空；`CONFIG` 输出目录不可写。
 */
export async function extractFile(file, options) {
  const outputDir = options?.outputDir;
  if (typeof outputDir !== 'string' || outputDir === '') {
    throw new DocError('CONFIG', '缺少 outputDir：本包只做变换，落盘位置必须由调用方给');
  }
  const absolute = path.resolve(file);
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) {
    throw inputError(`文件不存在：${absolute}`, { file: absolute });
  }

  const extracted = await extract(absolute);
  const name = path.basename(absolute);
  const text = markdown(name, extracted.pages).trimEnd();
  const dir = path.join(outputDir, hashKey(options?.source ?? absolute));
  let markdownPath;
  if (extracted.pages.length > 0) {
    await fs.mkdir(dir, { recursive: true });
    markdownPath = path.join(dir, `${name}.md`);
    await fs.writeFile(markdownPath, `${text}\n`, 'utf8');
  }

  const chars = extracted.pages.reduce((sum, page) => sum + page.text.length, 0);
  const truncated = text.length > INLINE_CHARS;
  return {
    file: absolute,
    ...(options?.source === undefined ? {} : { source: options.source }),
    format: extracted.format,
    ...(extracted.declaredFormat === undefined ? {} : { declaredFormat: extracted.declaredFormat }),
    status: extracted.status,
    pageCount: extracted.pages.length,
    chars,
    ...(extracted.convertedVia === undefined ? {} : { convertedVia: extracted.convertedVia }),
    ...(extracted.reason === null ? {} : { reason: extracted.reason }),
    ...(markdownPath === undefined ? {} : { markdown: markdownPath }),
    ...(extracted.pages.length > 0
      ? { text: truncated ? text.slice(0, INLINE_CHARS) : text }
      : {}),
    ...(truncated
      ? { truncated: true, note: `正文较长，这里只给前 ${INLINE_CHARS} 字，全文见 markdown 文件` }
      : {}),
  };
}

/**
 * 把一段标识（路径或链接）压成一个稳定的短目录名。
 *
 * 用哈希而不是原字符串：链接里有 `?a=1&b=2`、路径里有反斜杠和冒号，直接当目录名
 * 在 Windows 上会非法；而「同一个输入落到同一个目录」这件事必须成立，否则第二次
 * 提取同一份文件会到处生成新目录。
 *
 * @param {string} key 源标识。
 * @returns {string} 12 位十六进制。
 */
export function hashKey(key) {
  // 用 SHA-256 而不用更短的哈希：碰撞意味着两份不同文档的 Markdown 互相覆盖。
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}
