// 看课页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 但它**必须**作为 Loader entry 存在（与 page-me 等同一形状）：
// 客户端启动图谱由宿主 Loader 的条目合成，没有宿主入口的包不会被扫描，
// 它的 `dsh.client` 声明也就进不了图谱 —— 表现是页面包装了但那一页空白。
export const name = 'zhiyun-page-player';

/** 无宿主行为：页面内容全部在客户端。 */
export function apply() {}
