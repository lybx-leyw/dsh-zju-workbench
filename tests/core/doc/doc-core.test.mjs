/**
 * `packages/core/doc` 四条能力的离线用例。
 *
 * # 测试素材怎么来
 *
 * 全部**现场生成**，仓库里不留二进制夹具：
 *
 *   - PDF 用 `pdf-lib`（已是本包依赖）写，页与文字都受控；
 *   - docx / xlsx / pptx 用本文件里的 `zip()` 拼一个**最小 OOXML**（只有我们真读的
 *     那几个 XML 部件）—— 这比往仓库里塞一份 Word 文档更可靠：夹具一进仓库就
 *     没人知道它是谁做的、改没改过；
 *   - PNG 用 `node:zlib` 拼（`pdf-lib` 会真的解它的 IHDR 拿宽高）。
 *
 * # 反证记录
 *
 * 见 `PROOF.md`：每条关键断言都被「改坏实现」验证过会红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  DocError,
  createDocService,
  extract,
  extractFile,
  findInPdf,
  fitImage,
  htmlText,
  decodeText,
  combinePdf,
  parsePageRule,
  pdfTexts,
  quarterTurnsOf,
  sniff,
  openZip,
} from '../../../packages/core/doc/src/index.js';
import { placeRotated } from '../../../packages/core/doc/src/pdf.js';
import { docxPages, pptxPages, xlsxPages, officePages } from '../../../packages/core/doc/src/office.js';

/* ── 夹具 ──────────────────────────────────────────────────────────────── */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const at = (...parts) => path.join(root, ...parts);

/**
 * 不压缩的 zip（stored）。够装一份最小 OOXML —— 我们读的是 XML，压缩方式不影响
 * 被测逻辑，而 stored 让夹具自己就能被别人一眼看明白。
 *
 * @param {[string, string][]} entries 名字与内容。
 * @returns {Buffer} zip 字节。
 */
function zip(entries) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data) => {
    let c = ~0;
    for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const label = Buffer.from(name);
    const local = Buffer.alloc(30);
    const entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(label.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, label, data);
    central.push(entry, label);
    offset += 30 + label.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="xml" ContentType="application/xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

/** 一份最小 docx：段落 + 一张两行两列的表。 */
function docx(paragraphs, table = []) {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
    + (table.length === 0 ? '' : `<w:tbl>${table
      .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`)
      .join('')}</w:tbl>`);
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`],
  ]);
}

/** 一份最小 xlsx：两张工作表，第二张用共享字符串与数字。 */
function xlsx() {
  const sheet = (rows) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="成绩" sheetId="1" r:id="rId1"/><sheet name="名单" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://x/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<si><t>学号</t></si><si><t>张三</t></si><si><t>李四</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>成绩</t></is></c></row>'
      + '<row r="2"><c r="A2"><v>97</v></c><c r="C2" t="s"><v>1</v></c></row>',
    )],
    ['xl/worksheets/sheet2.xml', sheet('<row r="1"><c r="A1" t="s"><v>2</v></c></row>')],
  ]);
}

/** 一份最小 pptx：三张幻灯片，**故意让文件名顺序与展示顺序相反**。 */
function pptx() {
  const slide = (text) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>`
    + `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>';
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId2"/></p:sldIdLst>'
      + '</p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://x/slide" Target="slides/slide1.xml"/>'
      + '<Relationship Id="rId2" Type="http://x/slide" Target="slides/slide2.xml"/>'
      + '<Relationship Id="rId3" Type="http://x/slide" Target="slides/slide9.xml"/></Relationships>'],
    ['ppt/slides/slide1.xml', slide('第二张')],
    ['ppt/slides/slide2.xml', slide('第三张')],
    ['ppt/slides/slide9.xml', slide('第一张')],
  ]);
}

/** 一张纯色 PNG（`pdf-lib` 会解 IHDR 拿宽高）。 */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = y * (width * 3 + 1) + 1 + x * 3;
      raw[index] = 200;
      raw[index + 1] = 80;
      raw[index + 2] = 60;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 一张**带 EXIF orientation 的** JPEG。
 *
 * 手写最小 JPEG：SOI + APP1(Exif，只放 orientation 那一个 IFD 条目) + 一个
 * 1×1 的基线帧。`pdf-lib` 的 `embedJpg` 会按 SOF 读宽高，所以宽高必须与
 * 声明一致 —— 这里 160×100（横着存）。
 *
 * @param {number} orientation EXIF 方向标记。
 * @returns {Buffer} JPEG 字节。
 */
function jpegWithOrientation(orientation) {
  const exif = (() => {
    // 8 字节 TIFF 头 + 2 字节条目数 + 12 字节条目 + 4 字节「下一个 IFD = 0」。
    const tiff = Buffer.alloc(26);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(0x2a, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); // 1 个条目
    tiff.writeUInt16LE(0x0112, 10); // Orientation
    tiff.writeUInt16LE(3, 12); // SHORT
    tiff.writeUInt32LE(1, 14); // count
    tiff.writeUInt16LE(orientation, 18);
    tiff.writeUInt16LE(0, 20);
    tiff.writeUInt32LE(0, 22); // 下一个 IFD
    return tiff;
  })();
  const app1Body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(app1Body.length + 2, 0); return b; })(),
    app1Body,
  ]);
  // 量化表：全 1（最简，只为了让 DQT 段的长度正确）。
  const dqt = Buffer.concat([
    Buffer.from([0xff, 0xdb]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(67, 0); return b; })(),
    Buffer.from([0]),
    Buffer.alloc(64, 1),
  ]);
  // SOF0：8 位、单分量、宽高。
  const sof = (() => {
    const body = Buffer.alloc(15);
    body[0] = 8;
    body.writeUInt16BE(100, 1); // 高
    body.writeUInt16BE(160, 3); // 宽
    body[5] = 1; // 分量数
    body[6] = 1;
    body[7] = 0x11;
    body[8] = 0;
    return Buffer.concat([Buffer.from([0xff, 0xc0]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(body.length + 2, 0); return b; })(), body]);
  })();
  const sos = Buffer.concat([
    Buffer.from([0xff, 0xda]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(8, 0); return b; })(),
    Buffer.from([1, 1, 0, 0, 63, 0]),
    Buffer.from([0x00]),
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, dqt, sof, sos, eoi]);
}

/** 三页的 PDF：第 1、3 页有字，第 2 页是空的。 */
async function samplePdf(target) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([300, 200]).drawText('Leftist heap merge: npl(X)', { x: 10, y: 150, size: 9, font });
  document.addPage([300, 200]);
  document.addPage([300, 200]).drawText('Exercise 5.1 skew heap', { x: 10, y: 150, size: 9, font });
  fs.writeFileSync(target, await document.save());
}

/* ── 格式识别 ──────────────────────────────────────────────────────────── */

test('按文件头认格式，不信扩展名', async () => {
  await samplePdf(at('其实是.docx'));
  assert.deepEqual(await sniff(at('其实是.docx')), { ext: '.pdf', kind: 'pdf' });

  fs.writeFileSync(at('老师传的.doc'), docx(['x']));
  assert.deepEqual(await sniff(at('老师传的.doc')), { ext: '.docx', kind: 'writer' });

  fs.writeFileSync(at('download'), '\ufeff  <!DOCTYPE html><html><body>x</body></html>');
  assert.deepEqual(await sniff(at('download')), { ext: '.html', kind: 'html' });

  fs.writeFileSync(at('老格式.pptx'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
  assert.deepEqual(await sniff(at('老格式.pptx')), { ext: '.ppt', kind: 'impress' });

  fs.writeFileSync(at('笔记.md'), '<html> 开头的笔记也还是文本');
  assert.deepEqual(await sniff(at('笔记.md')), { ext: '.md', kind: 'text' });

  fs.writeFileSync(at('旧的.wps'), 'x');
  assert.equal((await sniff(at('旧的.wps'))).kind, 'other');

  // 不存在的文件必须是带名字的 INPUT，而不是 ENOENT。
  await assert.rejects(() => sniff(at('没有这个.pdf')), (error) => {
    assert.equal(error.code, 'INPUT');
    assert.match(error.message, /文件不存在/);
    return true;
  });
});

test('zip 解析：按名字取条目，缺条目返回 undefined（不抛）', () => {
  const archive = openZip(docx(['甲']));
  assert.ok(archive.has('word/document.xml'));
  assert.equal(archive.text('word/document.xml').includes('<w:t>甲</w:t>'), true);
  assert.equal(archive.text('word/不存在.xml'), undefined);
  assert.deepEqual(archive.match(/^word\//).length > 0, true);
});

/* ── Word / Excel / PPT 取字（无 Office 引擎的原生路径） ────────────────── */

test('docx：段落换行、表格格子用制表符分开', () => {
  const buffer = docx(['优先队列：左式堆的合并', 'npl(X) = min(npl(left), npl(right)) + 1'], [['甲', '乙'], ['丙', '丁']]);
  const { pages } = docxPages(buffer);
  assert.equal(pages.length, 1);
  assert.equal(
    pages[0].text,
    '优先队列：左式堆的合并\nnpl(X) = min(npl(left), npl(right)) + 1\n甲\t乙\n丙\t丁',
  );
});

test('docx：修订删除的旧文字不混进正文', () => {
  const buffer = zip([
    ['word/document.xml', '<w:document xmlns:w="http://x"><w:body>'
      + '<w:p><w:r><w:t>保留</w:t></w:r><w:del><w:r><w:delText>删掉的</w:delText></w:r></w:del></w:p>'
      + '</w:body></w:document>'],
  ]);
  assert.equal(docxPages(buffer).pages[0].text, '保留');
});

test('xlsx：共享字符串按索引取、空单元格保留列位置、一个工作表一页', () => {
  const { pages } = xlsxPages(xlsx());
  assert.deepEqual(pages.map((page) => page.page), [1, 2]);
  assert.deepEqual(pages.map((page) => page.title), ['成绩', '名单']);
  // A1=学号 B1=成绩；A2=97 且 C2=张三 —— B 列是空的，必须留出制表符。
  assert.equal(pages[0].text, '学号\t成绩\n97\t\t张三');
  assert.equal(pages[1].text, '李四');
});

test('pptx：按 presentation.xml 的顺序出页，不按文件名数字', () => {
  const { pages } = pptxPages(pptx());
  assert.deepEqual(pages.map((page) => page.text), ['第一张', '第二张', '第三张']);
});

test('Office 取字在**没有引擎**时走原生 XML，并如实标注 via', async () => {
  const file = at('讲义.docx');
  fs.writeFileSync(file, docx(['第二次作业']));
  const { pages, via } = await officePages(file, '.docx', pdfTexts);
  assert.deepEqual([via, pages], ['ooxml', [{ page: 1, text: '第二次作业' }]]);
});

test('老式二进制格式（.doc/.xls/.ppt）没有引擎时明确 UNSUPPORTED，不猜', async () => {
  for (const [ext, hint] of [['.doc', /另存为.*\.docx/], ['.xls', /另存为.*\.xlsx/], ['.ppt', /另存为.*\.pptx/]]) {
    const file = at(`old${ext}`);
    fs.writeFileSync(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
    await assert.rejects(() => officePages(file, ext, pdfTexts), (error) => {
      assert.equal(error.code, 'UNSUPPORTED');
      assert.match(error.message, hint);
      return true;
    });
  }
});

/* ── 纯文本与网页 ──────────────────────────────────────────────────────── */

test('文本解码：UTF-8 优先，GB18030 兜底', () => {
  assert.equal(decodeText(Buffer.from('中文 a', 'utf8')), '中文 a');
  // "中文 a" 的 GBK 编码。
  assert.equal(decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x20, 0x61])), '中文 a');
  // 两种都不合法的字节用替换字符收下，而不是抛错。
  assert.match(decodeText(Buffer.from([0xff, 0xfe, 0xff])), /\ufffd/);
});

test('网页正文：去脚本与样式、块级断行、表格格子用竖线分开', () => {
  const html = '<html><head><style>p{}</style><script>var x = 1</script></head>'
    + '<body><h1>通知</h1><p>第一段  文字</p><table><tr><td>甲</td><td>乙</td></tr></table></body></html>';
  assert.equal(htmlText(html), '通知\n第一段 文字\n甲 | 乙');
});

/* ── 取文字（端到端） ─────────────────────────────────────────────────── */

test('取文字：按页编号，空的页不算一页；全文写进 Markdown', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const extracted = await extractFile(file, { outputDir: at('out') });
  assert.deepEqual(
    [extracted.status, extracted.format, extracted.pageCount, extracted.chars > 0],
    ['text', 'pdf', 2, true],
  );
  assert.match(extracted.text, /## 第 1 页\n\nLeftist heap merge[\s\S]*## 第 3 页\n\nExercise 5\.1 skew heap/);
  const onDisk = fs.readFileSync(extracted.markdown, 'utf8').trimEnd();
  assert.equal(onDisk, extracted.text);
});

test('取文字：扫描件（无文字层）是 no_text 而不是异常', async () => {
  const document = await PDFDocument.create();
  document.addPage([100, 100]);
  const file = at('scan.pdf');
  fs.writeFileSync(file, await document.save());
  const extracted = await extract(file);
  assert.equal(extracted.status, 'no_text');
  assert.match(extracted.reason, /扫描件/);
  assert.deepEqual(extracted.pages, []);
});

test('取文字：图片是 no_text（需要看图），RTF 是 unsupported 并说清怎么办', async () => {
  fs.writeFileSync(at('shot.png'), png(8, 6));
  assert.deepEqual([(await extract(at('shot.png'))).status, (await extract(at('shot.png'))).reason], ['no_text', '图片，需要看图']);

  fs.writeFileSync(at('old.rtf'), '{\\rtf1 hello}');
  const rtf = await extract(at('old.rtf'));
  assert.equal(rtf.status, 'unsupported');
  assert.match(rtf.reason, /另存为 docx/);
});

test('取文字：0 字节与不存在的文件都是带名字的 INPUT', async () => {
  fs.writeFileSync(at('empty.pdf'), '');
  await assert.rejects(() => extract(at('empty.pdf')), (error) => {
    assert.equal(error.code, 'INPUT');
    assert.match(error.message, /0 字节/);
    return true;
  });
  await assert.rejects(() => extractFile(at('没有这个文件.pdf'), { outputDir: at('out') }), /文件不存在/);
});

test('取文字：docx 走原生路径并标出 via=ooxml', async () => {
  fs.writeFileSync(at('作业.docx'), docx(['第二次作业', '截止周五']));
  const extracted = await extractFile(at('作业.docx'), { outputDir: at('out') });
  assert.deepEqual(
    [extracted.status, extracted.format, extracted.convertedVia, extracted.pageCount],
    ['text', 'docx', 'ooxml', 1],
  );
  assert.match(extracted.text, /第二次作业\n截止周五/);
});

test('取文字：扩展名与真实格式不符时同时报 declaredFormat', async () => {
  fs.writeFileSync(at('假装是老格式.doc'), docx(['x']));
  const extracted = await extractFile(at('假装是老格式.doc'), { outputDir: at('out') });
  assert.deepEqual([extracted.format, extracted.declaredFormat], ['docx', 'doc']);
});

test('取文字：超过内联上限时给 truncated 与 markdown 路径', async () => {
  const file = at('long.txt');
  fs.writeFileSync(file, 'x'.repeat(30_000));
  const extracted = await extractFile(file, { outputDir: at('out') });
  assert.equal(extracted.truncated, true);
  assert.equal(extracted.text.length, 20_000);
  assert.match(extracted.note, /前 20000 字/);
  assert.ok(fs.existsSync(extracted.markdown));
});

test('取文字：没有 outputDir 直接 CONFIG（本包不自己决定落盘位置）', async () => {
  await assert.rejects(() => extractFile(at('book.pdf')), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

/* ── 页码规则 ──────────────────────────────────────────────────────────── */

test('页码规则：去重排序，写错、越界、倒序都报错', () => {
  assert.deepEqual(parsePageRule('3-5, 1，3', 10), [0, 2, 3, 4]);
  assert.deepEqual(parsePageRule('10', 10), [9]);
  for (const rule of ['5-3', '0', '11', '1-11', 'a', '1-', '-2', '', ' , ']) {
    assert.throws(() => parsePageRule(rule, 10), (error) => {
      assert.equal(error.code, 'INPUT', rule);
      return true;
    }, rule);
  }
});

/* ── 取页 ──────────────────────────────────────────────────────────────── */

test('取页：只带走被选中的页，页号按原顺序；越界与不是 PDF 都报错', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const service = createDocService({ outputDir: at('out') });

  const part = await service.pages(file, '3,1');
  assert.deepEqual([part.pages, part.totalPages], [[1, 3], 3]);
  assert.equal((await PDFDocument.load(fs.readFileSync(part.file))).getPageCount(), 2);

  await assert.rejects(() => service.pages(file, '9'), /超出范围 1-3/);
  await assert.rejects(() => service.pages(at('shot.png'), '1'), /不是 PDF 文件/);
});

test('取页：同名输出不覆盖，自动挪成 (2)', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const service = createDocService({ outputDir: at('out-pages') });
  const first = await service.pages(file, '1');
  const second = await service.pages(file, '1');
  assert.notEqual(first.file, second.file);
  assert.match(path.basename(second.file), /\(2\)\.pdf$/);
  assert.ok(fs.existsSync(first.file) && fs.existsSync(second.file));
});

test('取页：显式 out 已存在时报错而不是覆盖', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const service = createDocService({ outputDir: at('out') });
  const target = at('take.pdf');
  fs.writeFileSync(target, 'occupied');
  await assert.rejects(() => service.pages(file, '1', { out: target }), /输出文件已存在/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'occupied');
});

/* ── 找关键词 ──────────────────────────────────────────────────────────── */

test('找关键词：页码从 1 起，每页附上下文；查不到的词计数为 0', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const found = await findInPdf(file, ['skew heap', '没有的词']);
  assert.deepEqual([found.totalPages, found.textPages], [3, 2]);
  assert.deepEqual(found.matches['skew heap'], [{ page: 3, snippet: 'Exercise 5.1 skew heap' }]);
  assert.deepEqual(found.matches['没有的词'], []);
});

test('找关键词：空关键词表报 INPUT', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  await assert.rejects(() => findInPdf(file, []), /至少要给一个关键词/);
  await assert.rejects(() => findInPdf(file, ['  ']), /至少要给一个关键词/);
});

/* ── 合成 PDF ──────────────────────────────────────────────────────────── */

test('合成 PDF：图片按顺序排页，A4 模式把图缩小居中放在 A4 上', async () => {
  const wide = at('wide.png');
  fs.writeFileSync(wide, png(400, 100));
  const tall = at('tall.png');
  fs.writeFileSync(tall, png(100, 400));

  const out = at('merged.pdf');
  const merged = await combinePdf(out, 'a4', [wide, tall]);
  assert.deepEqual([merged.pages, merged.inputs.map((part) => `${part.kind}:${part.pages}`)], [2, ['image:1', 'image:1']]);

  const document = await PDFDocument.load(fs.readFileSync(out));
  const pages = document.getPages();
  assert.deepEqual(
    pages.map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]),
    [[595, 842], [595, 842]],
  );
});

test('合成 PDF：original 模式按 100 dpi 算页面，小图不放大', async () => {
  const image = at('small.png');
  fs.writeFileSync(image, png(80, 30));
  const out = at('original.pdf');
  await combinePdf(out, 'original', [image]);
  const page = (await PDFDocument.load(fs.readFileSync(out))).getPages()[0];
  // 80 px / 100 dpi * 72 = 57.6 pt；30 px → 21.6 pt。
  assert.deepEqual([Math.round(page.getWidth()), Math.round(page.getHeight())], [58, 22]);
});

test('合成 PDF：EXIF 方向 6 的照片按竖版出页（宽高互换）', async () => {
  const photo = at('rotated.jpg');
  fs.writeFileSync(photo, jpegWithOrientation(6));
  assert.equal(quarterTurnsOf(6), 1);
  const out = at('rotated.pdf');
  await combinePdf(out, 'original', [photo]);
  const page = (await PDFDocument.load(fs.readFileSync(out))).getPages()[0];
  // 文件里是 160×100（横），orientation 6 表示要转 90° → 视觉上 100×160。
  assert.deepEqual([Math.round(page.getWidth()), Math.round(page.getHeight())], [72, 115]);
});

test('合成 PDF：PDF 原页整份追加，页序不变', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const first = at('a.pdf');
  const second = at('b.pdf');
  await combinePdf(first, 'a4', [file]);
  await combinePdf(second, 'a4', [file, file]);
  assert.equal((await PDFDocument.load(fs.readFileSync(first))).getPageCount(), 3);
  const merged = await combinePdf(at('ab.pdf'), 'a4', [file, at('small.png')]);
  assert.deepEqual(merged.inputs.map((part) => part.kind), ['pdf', 'image']);
  assert.equal(merged.pages, 4);
});

test('合成 PDF：不支持的类型说清是什么；size 只认 a4/original', async () => {
  const text = at('note.txt');
  fs.writeFileSync(text, 'hi');
  await assert.rejects(() => combinePdf(at('x.pdf'), 'a4', [text]), /只接受图片/);
  await assert.rejects(() => combinePdf(at('x.pdf'), 'A4', [text]), /a4 或 original/);
  await assert.rejects(() => combinePdf(at('x.pdf'), 'a4', []), /至少要给一个输入文件/);
});

test('合成 PDF：Word 在本机没有引擎时报 UNSUPPORTED（不把 docx 当图片塞进去）', async () => {
  const file = at('说明.docx');
  fs.writeFileSync(file, docx(['第二次作业']));
  await assert.rejects(
    () => combinePdf(at('word.pdf'), 'a4', [file]),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED');
      assert.match(error.message, /libreoffice-kit/);
      return true;
    },
  );
});

test('合成 PDF：有引擎时 Word 被转成 PDF 再追加（钩子注入）', async () => {
  const file = at('说明.docx');
  fs.writeFileSync(file, docx(['第二次作业']));
  // 造一个「引擎」：把一份真 PDF 当作转换结果。
  const convertedPdf = at('converted.pdf');
  await samplePdf(convertedPdf);
  let cleaned = 0;
  const merged = await combinePdf(at('with-word.pdf'), 'a4', [file], {
    convertOffice: async () => ({ file: convertedPdf, cleanup: async () => { cleaned += 1; } }),
  });
  assert.deepEqual(merged.inputs.map((part) => `${part.kind}:${part.pages}`), ['word:3']);
  assert.equal(cleaned, 1, '临时目录必须被清掉');
});

/* ── 图片摆放的几何 ────────────────────────────────────────────────────── */

test('fitImage：A4 模式等比缩放并居中，不放大', () => {
  const big = fitImage(1240, 620, true);
  assert.deepEqual([Math.round(big.draw.width), Math.round(big.draw.height)], [595, 298]);
  assert.ok(Math.abs(big.draw.x - (595.28 - big.draw.width) / 2) < 1e-9);
  // 小图不放大：400×200 在 A4 上还是 400×200 pt。
  const small = fitImage(400, 200, true);
  assert.deepEqual([small.draw.width, small.draw.height], [400, 200]);
});

test('placeRotated：±90° 时绘制宽高互换，并把原点补回一个边长', () => {
  const visual = { x: 10, y: 20, width: 100, height: 50 };
  const normal = placeRotated(visual, 0);
  assert.deepEqual([normal.x, normal.y, normal.width, normal.height], [10, 20, 100, 50]);

  // 顺时针 90°（EXIF 6）：绘制用的宽高互换，图片的包围盒落在原点的**上方**，
  // 所以 y 要加上绘制宽度，否则图会画到视觉框下面去。
  const clockwise = placeRotated(visual, 1);
  assert.deepEqual(
    [clockwise.x, clockwise.y, clockwise.width, clockwise.height, clockwise.rotate],
    [10, 70, 50, 100, { type: 'degrees', angle: -90 }],
  );

  // 逆时针 90°（EXIF 8）：包围盒落在原点的**左侧**，x 要加一个边长。
  const counter = placeRotated(visual, -1);
  assert.deepEqual(
    [counter.x, counter.y, counter.width, counter.height, counter.rotate],
    [110, 20, 50, 100, { type: 'degrees', angle: 90 }],
  );

  const upsideDown = placeRotated(visual, 2);
  assert.deepEqual([upsideDown.x, upsideDown.y, upsideDown.width, upsideDown.height], [110, 70, 100, 50]);
});

test('readJpegOrientation：没有 EXIF 时按 1 处理，非 JPEG 也按 1', async () => {
  const { readJpegOrientation } = await import('../../../packages/core/doc/src/pdf.js');
  assert.equal(readJpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 1);
  assert.equal(readJpegOrientation(png(2, 2)), 1);
  assert.equal(readJpegOrientation(Buffer.alloc(0)), 1);
  assert.equal(readJpegOrientation(jpegWithOrientation(8)), 8);
  assert.equal(readJpegOrientation(jpegWithOrientation(1)), 1);
});

/* ── 服务与插件层 ──────────────────────────────────────────────────────── */

test('服务层：四个方法都在，且不碰 ctx', () => {
  const service = createDocService({ outputDir: at('out') });
  assert.deepEqual(Object.keys(service).sort(), ['find', 'pages', 'pdf', 'text']);
});

test('服务层：没有 outputDir 直接 CONFIG', () => {
  assert.throws(() => createDocService({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    // 这一句是给**调用方**看的：他该做的是传一个目录进来。
    assert.match(error.message, /落盘位置必须由调用方给/);
    return true;
  });
});

test('插件层：provide zhiyunDoc，卸载时摘掉；没有输出目录时抛 CONFIG', async () => {
  const provided = new Map();
  const ctx = {
    // `inject: ['profileContext']` —— 真实宿主由 Cordis 保证它已就绪。
    profileContext: { dir: at('profile') },
    provide: (name, value) => {
      provided.set(name, value);
      return () => provided.delete(name);
    },
  };
  const { apply, inject } = await import('../../../packages/core/doc/src/index.js');
  // `profileContext` 必须在 inject 里：不在的话直读会抛
  // `cannot get property "profileContext" without inject`（Cordis 真实行为）。
  assert.deepEqual(inject, ['profileContext']);

  const dispose = apply(ctx);
  assert.equal(typeof provided.get('zhiyunDoc')?.text, 'function');
  await dispose();
  assert.equal(provided.has('zhiyunDoc'), false);

  // 没有 profile 目录、也没有 config.outputDir：抛 CONFIG，不静默退化。
  //
  // ⚠️ 这条断言必须咬住**插件层自己**那句文案。服务层的 `createDocService` 也会
  //    在缺目录时抛 CONFIG —— 若这里只断言 code，插件层那道守卫被删掉也照样绿
  //    （反证时实测到过：那说明它测的不是插件层）。
  assert.throws(() => apply({ provide: () => () => {} }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /请在 profile 里配置 config\.outputDir/);
    return true;
  });

  // 显式配置可以顶替 profile 目录（离线用例与嵌入方走这条）。
  const custom = new Map();
  apply({ provide: (name, value) => { custom.set(name, value); return () => {}; } }, { outputDir: at('explicit') });
  assert.equal(typeof custom.get('zhiyunDoc')?.pdf, 'function');
});

test('插件层：profileContext 读起来抛错时按「没有目录」处理，不崩在属性访问上', async () => {
  const { apply } = await import('../../../packages/core/doc/src/index.js');
  // 极简 ctx（没有 profileContext）：→ CONFIG。
  assert.throws(() => apply({ provide: () => () => {} }), (error) => error.code === 'CONFIG');
  // 属性访问抛错（`without inject` 那种）：同样落到 CONFIG，而不是把 Cordis 的
  // 内部报错当成「文档处理坏了」。
  const ctx = {
    provide: () => () => {},
    get profileContext() {
      throw new Error('cannot get property "profileContext" without inject');
    },
  };
  assert.throws(() => apply(ctx), (error) => error.code === 'CONFIG');
});

test('错误类型：DocError 带稳定 code，且是 Error 实例', () => {
  const error = new DocError('INPUT', '坏了', { a: 1 });
  assert.equal(error instanceof Error, true);
  assert.deepEqual([error.name, error.code, error.details], ['DocError', 'INPUT', { a: 1 }]);
});

/* ── 逐页取字（pdf.js） ────────────────────────────────────────────────── */

test('pdfTexts：空页是空串（不是被删掉），下标即页号', async () => {
  const file = at('book.pdf');
  await samplePdf(file);
  const texts = await pdfTexts(file);
  assert.equal(texts.length, 3);
  assert.match(texts[0], /Leftist heap/);
  assert.equal(texts[1], '');
  assert.match(texts[2], /skew heap/);
});
