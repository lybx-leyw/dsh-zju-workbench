// 宿主半边：这个包只校准浏览器里的导航宽度，宿主侧没有行为。
//
// 但文件**必须存在** —— 客户端 bundle 靠宿主 Loader 的 `ctx.loader.entries()`
// 进启动图谱，没有宿主入口的包不会被扫描，`dsh.client` 声明也就读不到。
export const name = 'zju-pages-default';

/** 无宿主行为。 */
export function apply() {}
