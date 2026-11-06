/**
 * 导出层的错误类型。
 *
 * 源：本包自建（上游导出报错走 `toast` + `log`，服务端没有 toast）。
 *
 * 约定与宿主包一致：错误带 `code`，调用方据此分流（缺文档 / 缺媒体 / 超限 /
 * 未接线），而不是去匹配错误文案。
 */

export const ERROR_KINDS = {
  E_INPUT: 'E_INPUT',
  E_NOT_FOUND: 'E_NOT_FOUND',
  E_NO_STUDIO: 'E_NO_STUDIO',
  E_EMPTY: 'E_EMPTY',
  E_TOO_LARGE: 'E_TOO_LARGE',
  E_NOT_WIRED: 'E_NOT_WIRED',
};

export class ClassroomExportError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ClassroomExportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
