/**
 * 导出体积上限。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/limits.ts:1-240
 *
 * 数字与错误语义照搬：100 MB 只是提示，400 MB 是单文件的天花板（超过就自动改
 * 出 ZIP 变体），ZIP 自己的上限是 4 GiB。服务端没有"标签页内存"这一层，但 ceiling
 * 仍然有用：`<iframe srcdoc>` 的消费方拿到的是一整个字符串，V8 单字符串上限约
 * 512 MiB，400 MB 留了安全垫。
 */

/** 源：limits.ts:202 */
export const STANDALONE_HTML_SIZE_WARNING_BYTES = 100 * 1024 * 1024;

/** 源：limits.ts:217 */
export const STANDALONE_HTML_MAX_BYTES = 400 * 1024 * 1024;

/** 源：limits.ts:231-240 */
export class StandaloneHtmlTooLargeError extends Error {
  constructor(estimatedBytes, kind = 'single-file') {
    super(
      `Standalone export (${kind}) would be about ${Math.round(estimatedBytes / 1048576)} MB`,
    );
    this.name = 'StandaloneHtmlTooLargeError';
    this.estimatedBytes = estimatedBytes;
    this.kind = kind;
  }
}
