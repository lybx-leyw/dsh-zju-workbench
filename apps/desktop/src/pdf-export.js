import path from 'node:path';
import {writeFile} from 'node:fs/promises';

/**
 * 桌面壳里唯一一处「打印成 PDF 并落盘」的能力。
 *
 * # 为什么一个处理器服务两种文档
 *
 * 讲义导出与题库导出都要做同一件事：用户在页面上按一下 → 弹保存对话框 →
 * `printToPDF` → 写文件。差别只有三处：对话框标题、默认文件名后缀、以及
 * 「文档还在不在」的判据选择器。为题库再抄一份处理器，等于把这段安全校验
 * （同源、主框架、忙碌互斥、路径净化）维护两遍，而这类校验一旦漂移，
 * 漏洞往往出在没人复看的那一份里。
 *
 * # 为什么不用文件名做判据
 *
 * 渲染进程传来的字符串只当**文件名片段**用（净化后拼到下载目录下），
 * 绝不当路径：`path.join` 之前先去掉分隔符与保留字符，避免 `..\\..\\` 这类
 * 相对路径把文件写到用户没选的地方。
 */

export const pdfOptions = {
  pageSize: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  generateTaggedPDF: true,
  generateDocumentOutline: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#66756d;text-align:center;width:100%"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margins: {top: .71, bottom: .71, left: .63, right: .63},
};

/** `lecturePdfOptions` 是旧名，保留导出以免已有的脚本/测试断掉。 */
export const lecturePdfOptions = pdfOptions;

/**
 * 支持的文档类型。
 *
 * `readySelector` 是「文档确实还在页面上」的证据：用户在保存对话框里停留时，
 * 页面完全可能已经把导出文档卸载了（离开页面、取消导出、重新渲染）。这时再
 * `printToPDF` 打印的是**整个应用界面**，用户会得到一份带侧栏和按钮的 PDF。
 */
export const PDF_DOCUMENTS = Object.freeze({
  lecture: Object.freeze({
    dialogTitle: '导出讲义与知识图谱',
    readySelector: '#zs-lecture-export .zs-pdf-lecture',
    fallbackName: '课堂讲义',
  }),
  quiz: Object.freeze({
    dialogTitle: '导出练习题 PDF',
    readySelector: '#zs-quiz-export .zs-pdf-body',
    fallbackName: '题库练习卷',
  }),
});

/** 文件名净化：去掉分隔符与 Windows 保留字符，截断到合理长度。 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\.pdf$/i, '')
    .slice(0, 180) + '.pdf';
}

/**
 * 造一个 IPC 处理器。`busy` 在闭包里，两种文档共用一个锁 ——
 * 同时跑两个 `printToPDF` 会让对话框与打印互相抢窗口焦点。
 */
export function createPdfExportHandler({getWindow, getHostUrl, dialog, downloads, write = writeFile}) {
  let busy = false;
  return async (event, filename, kind = 'lecture') => {
    const doc = PDF_DOCUMENTS[kind] ?? PDF_DOCUMENTS.lecture;
    const win = getWindow(), sender = event.sender;
    let expected;
    try { expected = new URL(getHostUrl()).origin; } catch { return {error: '页面尚未就绪'}; }
    const trusted = () => {
      try {
        return win && !win.isDestroyed() && sender === win.webContents
          && event.senderFrame === sender.mainFrame
          && new URL(sender.getURL()).origin === expected;
      } catch { return false; }
    };
    if (!trusted()) return {error: '仅允许从当前页面导出'};
    if (busy) return {error: '已有 PDF 正在导出'};
    if (typeof filename !== 'string' || filename.length > 220) return {error: '导出文件名无效'};
    const safe = sanitizeFilename(filename);
    busy = true;
    try {
      const selection = await dialog.showSaveDialog(win, {
        title: doc.dialogTitle,
        defaultPath: path.join(downloads(), safe),
        filters: [{name: 'PDF 文档', extensions: ['pdf']}],
        properties: ['showOverwriteConfirmation'],
      });
      if (selection.canceled || !selection.filePath) return {canceled: true};
      if (!trusted()) return {error: '页面已变化，请重新导出'};
      // 保存对话框可能开了很久：期间导出文档可能已被卸载。此处用选择器确认它还在，
      // 而不是无条件打印 —— 打印整个应用界面比报错更糟（用户会拿到一份带界面的 PDF）。
      const ready = await sender.executeJavaScript(`!!document.querySelector(${JSON.stringify(doc.readySelector)})`);
      if (!ready) return {error: '导出文档已关闭，请重新导出'};
      const bytes = await sender.printToPDF(pdfOptions);
      await write(selection.filePath, bytes);
      return {canceled: false, filePath: selection.filePath};
    } catch {
      return {error: 'PDF 未能保存，请检查保存位置后重试'};
    } finally {
      busy = false;
    }
  };
}

/** 讲义导出的旧入口：等价于 `createPdfExportHandler` 固定 `kind='lecture'`。 */
export function createLecturePdfHandler(options) {
  const handler = createPdfExportHandler(options);
  return (event, filename) => handler(event, filename, 'lecture');
}
