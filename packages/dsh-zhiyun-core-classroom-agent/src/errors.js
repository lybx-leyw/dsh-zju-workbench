/**
 * 本包的错误类型。与仓库其它领域包同形（`code` + `message`），
 * 让页面按 `kind` 分支而不是靠字符串匹配。
 *
 * 源：本仓 `packages/dsh-zhiyun-core-lecture/src/errors.js` 的形状约定
 * （上游 OpenMAIC 没有对应文件 —— 编排层的错误是裸 `Error`，这里补上分类）。
 */

export const ERROR_KINDS = Object.freeze({
  CONFIG: 'CONFIG',
  DISPOSED: 'DISPOSED',
  ABORTED: 'ABORTED',
  UPSTREAM: 'UPSTREAM',
  INVALID_PLAN: 'INVALID_PLAN',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
});

export class ClassroomAgentError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ClassroomAgentError';
    this.code = code;
    this.kind = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** 上游能力还没接上时统一走这里（宿主 `status().state` 已经说明了原因）。 */
export function upstreamMissing(what, detail) {
  return new ClassroomAgentError(
    ERROR_KINDS.UPSTREAM,
    `${what} 需要 zhiyunClassroomStudio（宿主未提供或未实现）`,
    detail,
  );
}
