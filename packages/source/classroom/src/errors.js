/**
 * ⚠️ **本文件与 `@lybx-leyw/dsh-zju-source-http/src/errors.js` 是逐字相同的两份实现。**
 *
 * 为什么值得指出：`cc98` / `xxt` / `campus` 都是从 `source-http` 引这一套
 * （`ClassroomError` 与 `shape`/`object`/`array` 三个守卫），而本包自带了一份 ——
 * 于是同一个错误类型在进程里有两个构造函数。`instanceof` 判定会因此失效，
 * 而 `error.code` 恰好两边一致，所以**不会立刻暴露**。
 *
 * 目前不改的理由：`classroom` 没有依赖 `source-http`（两者是平级的 tier-1 与 tier-0），
 * 改依赖要动 `package.json`、`dsh.capability.requires` 与本目录下 8 个模块的 import，
 * 而收益只是消除重复 —— 属于 source 层内部的整洁问题，不是分层违规。
 *
 * 要改的话：删掉本文件，把 8 个 `from './errors.js'` 改成
 * `from '@lybx-leyw/dsh-zju-source-http'`，并在 `package.json` 里加依赖。
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
