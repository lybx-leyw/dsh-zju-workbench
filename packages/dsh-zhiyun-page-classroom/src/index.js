// 「课堂」页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 与 dsh-zhiyun-page-me 一样是空壳，但**必须存在** —— 客户端 bundle 靠宿主 Loader 的
// `ctx.loader.entries()` 进启动图谱，没有宿主入口的包不会被扫描，`dsh.client` 声明读不到。
//
// 真正的服务托管在 dsh-zhiyun-host-openmaic（`ctx.zhiyunOpenMAIC`）；
// 这一页只负责把它嵌进内容区。
export const name = 'zhiyun-page-classroom';

/** 无宿主行为：起停上游服务是 host-openmaic 的事，这一页不碰进程。 */
export function apply() {}
