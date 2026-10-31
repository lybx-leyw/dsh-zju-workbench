/**
 * 讲义 PDF 的旧入口 —— **实现已搬到 `pdf-export.js`**。
 *
 * 题库也要导出一份 PDF，两件事的差别只有对话框标题与「文档还在不在」的判据选择器；
 * 安全校验（同源、主框架、忙碌互斥、文件名净化）没有任何理由存在两份 ——
 * 两份一旦漂移，漏洞往往落在没人复看的那一份里。
 *
 * 这个文件只为保持既有 import 路径可用（`main.js`、`tests/lecture-pdf.test.mjs`）。
 * 新代码请直接用 `pdf-export.js` 的 `createPdfExportHandler` / `PDF_DOCUMENTS`。
 */
export {
  PDF_DOCUMENTS,
  createLecturePdfHandler,
  createPdfExportHandler,
  lecturePdfOptions,
  pdfOptions,
} from './pdf-export.js';
