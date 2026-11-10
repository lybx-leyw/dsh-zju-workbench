import { createRequire } from 'node:module'

/**
 * 测试环境探测。
 *
 * # 为什么需要它
 *
 * 上游 `core/weread/` 的测试是**在装好依赖的目录里**跑的（上游 `npm install` 过）。
 * 本仓按约定**不跑 `npm install`**，于是：
 *
 *   - `lib/article.ts` 顶部的 `import { parseHTML } from 'linkedom'` 之类会在
 *     **模块加载阶段**抛 `ERR_MODULE_NOT_FOUND`；
 *   - 那个异常发生在任何 `test()` 注册之前，`node --test` 会把整个文件记成
 *     **失败（not ok）**，而不是跳过。
 *
 * 这会把「环境没装」伪装成「代码坏了」—— 后来的人会去读 diff 找 bug，
 * 而真正要做的只是装依赖。所以测试文件在 import 之前先探测，
 * 缺依赖就带上原因整文件 skip，**断言一行不改**。
 *
 * 判据用 `require.resolve` 而不是 `import()`：只需知道「能不能解析到」，
 * 不需要真的把模块求值一遍（后者有副作用和成本）。
 */

const require = createRequire(import.meta.url)

/**
 * 某个裸模块说明符能否被解析到。
 *
 * 解析起点是本文件所在的 `tests/helpers/` —— 与 `lib/*.ts` 里的 import
 * 走同一套向上查找 `node_modules` 的规则，所以结论对它们同样成立。
 *
 * @param {string} name - 裸模块名（如 `'linkedom'`）。
 * @returns {boolean}
 */
export function resolvable(name) {
  try {
    require.resolve(name)
    return true
  } catch {
    return false
  }
}

/**
 * 一组依赖里哪些没装。
 *
 * @param {string[]} names - 要检查的裸模块名。
 * @returns {false | string} `false` 表示齐全；字符串是可直接放进
 *   `test(name, { skip })` 的跳过原因。
 */
export function missing(names) {
  const absent = names.filter(name => !resolvable(name))
  if (absent.length === 0) return false
  return `缺少依赖 ${absent.join(' / ')}（本仓按约定不跑 npm install；装好后即可运行，见 README「已知限制」）`
}
