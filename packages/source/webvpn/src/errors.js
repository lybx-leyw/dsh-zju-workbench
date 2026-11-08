/**
 * WebVPN 相关的错误类型。
 *
 * # 为什么这个包自带一份，而不是 import campus 的 `cas/errors.js`
 *
 * 独立成包的**全部意义**就是「别的数据源也能用」。一旦 `import` 了 campus 内部的
 * 相对路径（`../cas/errors.js`），依赖方向就反了 —— 两个包在加载顺序、构建产物、
 * 以及「单独停用其中一个」这三件事上被焊死。这正是 `ATTRIBUTION` 里
 * 「为什么把 classroom 的 CAS 那几份复制过来」一节描述过的同一个问题。
 *
 * 形状与 campus 的 `ClassroomError` **保持一致**（`code` / `message` / `details`
 * 三件套，`toJSON` 输出同样三个键），所以调用方按 `error.code` 判断的分支
 * 在新旧两处都成立。
 */
export class WebvpnError extends Error {
  /**
   * @param code - 机器可读的错误码（如 `WEBVPN_CREDENTIALS`）。
   * @param message - 用户能照做的一句话。
   * @param details - 安全元信息；**不要**塞响应体、URL 原文或凭据。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WebvpnError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}
