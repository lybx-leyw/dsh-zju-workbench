// 源：ref/OpenMAIC/lib/whiteboard/runtime/types.ts:98-162（带 code 的领域错误族）
// 源：ref/OpenMAIC/lib/whiteboard/legacy-shape.ts:1-12（形状兼容性错误文案）
/**
 * 舞台动作的错误面。
 *
 * 上游把「白板运行时」的非法变更做成一族带 `code` 的 Error
 * （元素不存在 / 类型不匹配 / 代码行不存在 / 行 id 冲突 / 无可变更），
 * 由 `lib/runtime` 的 HTTP 边界转成状态码。这里保留 `code` 这一层，
 * 丢掉 HTTP —— 舞台是本仓进程内服务，调用方直接读 `error.code`。
 *
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/types.ts:98-162
 * 源：ref/OpenMAIC/lib/whiteboard/legacy-shape.ts:1-12
 */

/** 舞台侧的错误码表。改名字就等于换契约，页面与测试都按这里的字符串判定。 */
export const STAGE_ERROR_CODES = Object.freeze({
  /** 动作类型不在 {@link STAGE_ACTION_TYPES} 里（含拼写错误）。 */
  UNKNOWN_ACTION: 'E_UNKNOWN_ACTION',
  /** 动作不是对象，或缺少 `type`。 */
  INVALID_ACTION: 'E_INVALID_ACTION',
  /** `seq` 不是非负安全整数。 */
  SEQ_INVALID: 'E_SEQ_INVALID',
  /** `seq` 已经写过 —— 账本只接受每个序号一次。 */
  SEQ_DUPLICATE: 'E_SEQ_DUPLICATE',
  /** `seq` 跳号：账本要求严格递增、逐条 +1。 */
  SEQ_OUT_OF_ORDER: 'E_SEQ_OUT_OF_ORDER',
  /** 单个 run 的记录数到了上限，得先 `reset()`。 */
  LEDGER_FULL: 'E_LEDGER_FULL',
  /** 旧版 `wb_draw_shape` 带了 Native 扩展（rotate/path/viewBox/stroke），或形状名不在白名单。 */
  LEGACY_SHAPE: 'E_LEGACY_SHAPE',
  /** 形状的 SVG path / 尺寸没过几何内核的校验。 */
  SHAPE_GEOMETRY: 'E_SHAPE_GEOMETRY',
});

/**
 * 舞台动作错误。`code` 取自 {@link STAGE_ERROR_CODES}，`detail` 放原始几何错误等附加信息。
 */
export class StageActionError extends Error {
  /**
   * @param {string} code 见 {@link STAGE_ERROR_CODES}
   * @param {string} message 给人看的说明
   * @param {unknown} [detail] 机器可读的附加信息
   */
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'StageActionError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 宽松判定：跨包传过来的错误可能被序列化过，instanceof 会失效，因此也认 `code` 前缀。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isStageActionError(error) {
  if (error instanceof StageActionError) return true;
  return Boolean(
    error
    && typeof error === 'object'
    && typeof error.code === 'string'
    && error.code.startsWith('E_'),
  );
}
