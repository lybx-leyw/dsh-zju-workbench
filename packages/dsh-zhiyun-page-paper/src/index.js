// 宿主半边是空壳，但**必须存在**：客户端插件的启动图谱由宿主 Loader 的
// `ctx.loader.entries()` 合成，没有宿主入口的包不会被扫描，`dsh.client` 声明永远读不到。
export const name = 'zhiyun-page-paper';
export function apply() {}
