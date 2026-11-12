/**
 * 文档处理的失败类型。
 *
 * # 为什么错误要有稳定的 `code`
 *
 * 这一层会被工具层（以及将来的页面）调用，调用方要按**失败的性质**决定怎么办：
 *
 * | code | 谁的问题 | 调用方该怎么办 |
 * |---|---|---|
 * | `INPUT` | 入参不对（文件不存在、页码越界、关键词为空） | 改参数，重试没用 |
 * | `UNSUPPORTED` | 这个格式本机读不了（老式 .doc、RTF、需要 LibreOffice） | 换格式另存，别重试 |
 * | `READ_FAILED` | 文件在、但解析失败（损坏、加密） | 换文件 |
 * | `CONFIG` | 没有可写的输出目录 | 补配置 |
 * | `TOO_LARGE` | 提取量超过上限 | 拆分文件 |
 *
 * 「没有文字」（扫描件、纯图片）**不是错误** —— 它是正常结果，写在返回值里
 * （`status: 'no_text'`）。把它做成异常会让调用方拿 `try/catch` 当流程控制，
 * 而扫描件是这类工具最常见的输入之一。
 */
export class DocError extends Error {
  /**
   * @param {string} code 见上表。
   * @param {string} message 给人看的一句话（中文，带可执行信息）。
   * @param {object} [details] 附加字段（file / page / rule…）。
   * @param {object} [options] 透传给 `Error`（`cause`）。
   */
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = 'DocError';
    this.code = code;
    this.details = details;
  }
}

/** 输入不合法。 */
export const inputError = (message, details) => new DocError('INPUT', message, details);
/** 格式不支持（本机没有对应的解析引擎）。 */
export const unsupported = (message, details) => new DocError('UNSUPPORTED', message, details);
/** 文件存在但解析失败。 */
export const readFailed = (message, details, cause) =>
  new DocError('READ_FAILED', message, details, cause === undefined ? {} : { cause });
/** 缺少可写的输出目录等配置。 */
export const configError = (message, details) => new DocError('CONFIG', message, details);
/** 提取量超过上限。 */
export const tooLarge = (message, details) => new DocError('TOO_LARGE', message, details);
