/**
 * 一份最小但**合法**的 PDF（两页、一张 Helvetica 字体）。
 *
 * 独立的 fixture 而不是写在某个测试文件里：`pdf-viewer.test.mjs` 也要用它，
 * 而 import 一个测试文件会连带执行它里面的 test()。
 *
 * 不引 pdf-lib：只为这个多一个依赖不值当，PDF 的对象表本身就够简单。
 * @returns {Buffer}
 */
export function minimalPdf() {
  const objs = [];
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n');
  objs.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n');
  const c1 = 'BT /F1 24 Tf 72 760 Td (Page 1) Tj ET\n';
  objs.push(`4 0 obj\n<< /Length ${c1.length} >>\nstream\n${c1}endstream\nendobj\n`);
  objs.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objs.push('6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n');
  const c2 = 'BT /F1 24 Tf 72 760 Td (Page 2) Tj ET\n';
  objs.push(`7 0 obj\n<< /Length ${c2.length} >>\nstream\n${c2}endstream\nendobj\n`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objs) { offsets.push(pdf.length); pdf += obj; }
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
