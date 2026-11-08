/**
 * doc 模块（不用 Python 的这一版）：按文件头认格式、各种格式取文字、合成和取页、页码规则、找关键词。
 * Word 转换和图片处理用的是应用根目录 node_modules 里的 Office 引擎和 sharp；在应用的项目里跑（npm run test:core）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-doc-test-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { extractFile, toPdf, pdfPages, pdfFind } = await import("../lib/doc/index.ts");
const { parsePageRule } = await import("../lib/doc/pdf.ts");
const { sniff } = await import("../lib/doc/sniff.ts");
const sharp = (await import("sharp")).default;

const file = (name: string) => path.join(root, name);

/** 不压缩的 zip，够装一份最小的 docx。 */
function zip(entries: [string, string][]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (data: Buffer) => { let c = ~0; for (const byte of data) c = table[(c ^ byte) & 255]! ^ (c >>> 8); return ~c >>> 0; };
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), label = Buffer.from(name), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(label.length, 26);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc(data), 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(label.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, label, data); central.push(entry, label); offset += 30 + label.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
const docx = (paragraphs: string[]) => zip([
  ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ["word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`],
]);

/** 三页的 PDF：第一、三页有字，第二页是空的。 */
async function samplePdf(target: string): Promise<void> {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([300, 200]).drawText("Leftist heap merge: npl(X) = min(npl(left), npl(right)) + 1", { x: 10, y: 150, size: 9, font });
  document.addPage([300, 200]);
  document.addPage([300, 200]).drawText("Exercise 5.1 skew heap", { x: 10, y: 150, size: 9, font });
  fs.writeFileSync(target, await document.save());
}

test("按文件头认格式，不信扩展名", async () => {
  await samplePdf(file("其实是.docx"));
  assert.deepEqual(await sniff(file("其实是.docx")), { ext: ".pdf", kind: "pdf" });
  fs.writeFileSync(file("老师传的.doc"), docx(["x"]));
  assert.deepEqual(await sniff(file("老师传的.doc")), { ext: ".docx", kind: "writer" });
  fs.writeFileSync(file("download"), "﻿  <!DOCTYPE html><html><body>x</body></html>");
  assert.deepEqual(await sniff(file("download")), { ext: ".html", kind: "html" });
  fs.writeFileSync(file("老格式.pptx"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
  assert.deepEqual(await sniff(file("老格式.pptx")), { ext: ".ppt", kind: "impress" });
  fs.writeFileSync(file("笔记.md"), "<html> 开头的笔记也还是文本");
  assert.deepEqual(await sniff(file("笔记.md")), { ext: ".md", kind: "text" });
  fs.writeFileSync(file("旧的.wps"), "x");
  assert.equal((await sniff(file("旧的.wps"))).kind, "other");
});

test("页码规则：去重排序，写错、越界、倒序都报错", () => {
  assert.deepEqual(parsePageRule("3-5, 1，3", 10), [0, 2, 3, 4]);
  assert.deepEqual(parsePageRule("10", 10), [9]);
  for (const rule of ["5-3", "0", "11", "1-11", "a", "1-", "-2", "", " , "]) assert.throws(() => parsePageRule(rule, 10), /页码|没有给出/, rule);
});

test("取文字：纯文本（GBK）、网页、PDF、图片、不支持的格式", async () => {
  fs.writeFileSync(file("gbk.txt"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x20, 0x61]));
  const text = await extractFile(file("gbk.txt"));
  assert.deepEqual([text.status, text.format, text.text], ["text", "txt", "# gbk.txt\n\n中文 a"]);

  fs.writeFileSync(file("page.html"), "<html><head><style>p{}</style><script>var x = 1</script></head><body><h1>通知</h1><p>第一段  文字</p><table><tr><td>甲</td><td>乙</td></tr></table></body></html>");
  assert.equal((await extractFile(file("page.html"))).text, "# page.html\n\n通知\n第一段 文字\n甲 | 乙");

  await samplePdf(file("book.pdf"));
  const pdf = await extractFile(file("book.pdf"));
  assert.deepEqual([pdf.status, pdf.format, pdf.pageCount], ["text", "pdf", 2], "空的那一页不算");
  assert.match(pdf.text!, /## 第 1 页\n\nLeftist heap merge[\s\S]*## 第 3 页\n\nExercise 5\.1 skew heap/);
  assert.equal(fs.readFileSync(pdf.markdown!, "utf8").trimEnd(), pdf.text);

  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc5544" } }).jpeg().toFile(file("photo.jpg"));
  const image = await extractFile(file("photo.jpg"));
  assert.deepEqual([image.status, image.reason, image.pageCount], ["no_text", "图片，需要看图", 0]);

  fs.writeFileSync(file("old.rtf"), "{\\rtf1 hello}");
  const rtf = await extractFile(file("old.rtf"));
  assert.equal(rtf.status, "unsupported");
  assert.match(rtf.reason!, /另存为 docx/);

  fs.writeFileSync(file("empty.pdf"), "");
  await assert.rejects(() => extractFile(file("empty.pdf")), /0 字节/);
  await assert.rejects(() => extractFile(file("没有这个文件.pdf")), /文件不存在/);
});

test("Word 交给应用自带的 Office 引擎：中文取得到，扩展名不对的照真实格式读", async () => {
  fs.writeFileSync(file("讲义 一.docx"), docx(["优先队列：左式堆的合并", "npl(X) = min(npl(left), npl(right)) + 1"]));
  const word = await extractFile(file("讲义 一.docx"));
  assert.deepEqual([word.status, word.format, word.convertedVia, word.text], ["text", "docx", "libreoffice", "# 讲义 一.docx\n\n优先队列：左式堆的合并\nnpl(X) = min(npl(left), npl(right)) + 1"]);
  fs.copyFileSync(file("讲义 一.docx"), file("假装是老格式.doc"));
  const renamed = await extractFile(file("假装是老格式.doc"));
  assert.deepEqual([renamed.format, renamed.declaredFormat, renamed.status], ["docx", "doc", "text"]);
});

test("合成 PDF：照片按拍摄方向转正，图片、Word、PDF 按给的顺序排；取页；找关键词", async () => {
  await samplePdf(file("book.pdf"));
  fs.writeFileSync(file("作业说明.docx"), docx(["第二次作业"]));
  // 横着存、方向标记是 6 的照片：转正以后是竖的。
  await sharp({ create: { width: 160, height: 100, channels: 3, background: "#cc5544" } }).withMetadata({ orientation: 6 }).jpeg().toFile(file("第1页.jpg"));
  await sharp({ create: { width: 80, height: 30, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.3 } } }).png().toFile(file("截图.png"));

  const original = await toPdf([file("第1页.jpg"), file("截图.png")], "original", file("原图.pdf"));
  assert.deepEqual(original.inputs.map(input => [input.kind, input.pages]), [["image", 1], ["image", 1]]);
  const sizes = (await PDFDocument.load(fs.readFileSync(original.file))).getPages().map(page => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
  assert.deepEqual(sizes, [[72, 115], [58, 22]], "原图模式按 100 dpi 算页面；第一张转成了竖的");

  const merged = await toPdf([file("第1页.jpg"), file("截图.png"), file("作业说明.docx"), file("book.pdf")], "a4");
  assert.deepEqual([merged.pages, merged.inputs.map(input => `${input.kind}:${input.pages}`).join(" ")], [6, "image:1 image:1 word:1 pdf:3"]);
  assert.equal(path.basename(merged.file), "第1页等4个文件.pdf");
  const pages = (await PDFDocument.load(fs.readFileSync(merged.file))).getPages();
  assert.deepEqual([Math.round(pages[0]!.getWidth()), Math.round(pages[0]!.getHeight())], [595, 842], "图片放在 A4 页上");
  await assert.rejects(() => toPdf([file("第1页.jpg")], "a4", file("原图.pdf")), /输出文件已存在/);
  await assert.rejects(() => toPdf([file("gbk.txt")], "a4"), /只接受图片、PDF 和 Word 文件/);

  const part = await pdfPages(merged.file, "4,6", file("取页.pdf"));
  assert.deepEqual([part.pages, part.pageCount, part.totalPages], [[4, 6], 2, 6]);
  assert.equal((await PDFDocument.load(fs.readFileSync(part.file))).getPageCount(), 2);
  await assert.rejects(() => pdfPages(merged.file, "9"), /超出范围 1-6/);
  await assert.rejects(() => pdfPages(file("第1页.jpg"), "1"), /不是 PDF 文件/);

  const found = await pdfFind(file("book.pdf"), ["skew heap", "没有的词"]);
  assert.deepEqual([found.totalPages, found.textPages, found.matches["skew heap"], found.matches["没有的词"]], [3, 2, { count: 1, hits: [{ page: 3, snippet: "Exercise 5.1 skew heap" }] }, { count: 0, hits: [] }]);
});
