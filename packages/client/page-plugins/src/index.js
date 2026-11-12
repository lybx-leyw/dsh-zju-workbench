// 「插件依赖」页的宿主半边：本页没有宿主行为了。
//
// 依赖图的折叠（`runtime.js`）与 `/api/zw-plugins` 只读路由已搬到
// `@lybx-leyw/dsh-zju-core-plugin-graph` —— 一个页面包不该注册宿主路由，
// 而 `runtime.js` 本来就被宿主与客户端同时 import，属于「两端共用的纯逻辑」。
//
// Loader entry 仍必须存在：否则客户端 bundle 进不了启动图谱。
export const name = 'zw-page-plugins-host';

/** 无宿主行为：图的计算与路由由 core-plugin-graph 提供。 */
export function apply() {}
