/**
 * ⚠️ **本文件与 `@lybx-leyw/dsh-zju-source-http/src/errors.js` 是逐字相同的两份实现。**
 *
 * 为什么值得指出：`cc98` / `xxt` / `campus` 都是从 `source-http` 引这一套
 * （`ClassroomError` 与 `shape`/`object`/`array` 三个守卫），而本包自带了一份 ——
 * 于是同一个错误类型在进程里有两个构造函数。`instanceof` 判定会因此失效，
 * 而 `error.code` 恰好两边一致，所以**不会立刻暴露**。
 *
 * # 现状（2026-11-12 更新）
 *
 * 本包**已经**依赖 `source-http` 了（合并下载器时加的：`package.json` 的
 * `dependencies` 与 `dsh.capability.requires` 都有它）。所以现在**可以**把
 * 本文件删掉、把 8 个 `from './errors.js'` 改成 `from '@lybx-leyw/dsh-zju-source-http'`。
 *
 * 之所以**这次没顺手做**：它和下载器合并是两件事 —— 下载器有 2 条测试覆盖
 * （`classroom-download.test.mjs`），而错误类型牵扯本目录 8 个模块的 import
 * 与所有 `instanceof ClassroomError` 的判定点。混在一起改，出问题时分不清是
 * 哪一处引起的。留作独立一步。
 */
export class ClassroomError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ClassroomError';
    this.code = code;
    // Details must be constructed from safe metadata, never raw response/body/URL.
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}
export function shape(label, field) {
  return new ClassroomError('API_SHAPE', `${label}返回结构异常：${field}`);
}
export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function array(value, label, field) {
  if (!Array.isArray(value)) throw shape(label, field);
  return value;
}
