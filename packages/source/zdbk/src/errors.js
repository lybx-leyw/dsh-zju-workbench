/**
 * 本包自己的错误类型。
 *
 * # 为什么单独一个文件
 *
 * `ZdbkError` 原来定义在 `index.js` 里，而 `index.js` 是**唯一**碰 cordis 的文件。
 * 读取层（`reads.js`）需要抛它，但反向 import `index.js` 会形成循环
 * （`index.js` → `reads.js` → `index.js`），在 ESM 里它「有时能跑」——
 * 取决于两个模块谁先求值 —— 这类问题只在某些入口顺序下才炸，不值得留着。
 *
 * 所以把它挪到这里：`index.js` 原样再导出一次（`ZdbkError` / `fault` 的
 * 对外身份不变），读取层从这里取。
 *
 * # 与 `ClassroomError` 的分工
 *
 * | 谁抛 | 抛什么 | 为什么 |
 * | --- | --- | --- |
 * | `ZdbkClient` / `Transport`（共享层） | `ClassroomError` | 码表在共享层，跨包统一 |
 * | 读取层的参数校验、选课页缺失 | `ZdbkError` | 本包自己的语义 |
 *
 * 两者形状一致（`code` + `message` + `details`），路由与 `toError` 都只读这两个字段，
 * 所以调用方不必区分。**写入面**（`selection select/reorder/drop`）按 D17 归
 * `packages/tool/campus-write`，那边应当有自己的 `WriteGateClosed` 一类错误，
 * 不要复用这里的码。
 */

/**
 * 本包的统一错误形状。
 *
 * 与 omni 的 `ToolError` 不同：这里只有 code + message，不带层层嵌套的原始响应。
 * 错误信息是给用户看的，不是给日志看的。（与 campus 的 `CampusError` 同一口径。）
 */
export class ZdbkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ZdbkError';
    this.code = code;
    this.details = details;
  }
}

/** 造一个 ZdbkError。 */
export const fault = (code, message, details) => new ZdbkError(code, message, details);
