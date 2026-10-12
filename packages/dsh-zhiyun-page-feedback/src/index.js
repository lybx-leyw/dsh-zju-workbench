// 「反馈」页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 与 dsh-zhiyun-page-me 一样是空壳，但**必须存在** —— 客户端 bundle 靠宿主 Loader 的
// `ctx.loader.entries()` 进启动图谱，没有宿主入口的包不会被扫描，`dsh.client` 声明读不到。
export const name = 'zhiyun-page-feedback';

/** 无宿主行为：这一页读的是仓库里那份只读数据，不落盘、不连网。 */
export function apply() {}
