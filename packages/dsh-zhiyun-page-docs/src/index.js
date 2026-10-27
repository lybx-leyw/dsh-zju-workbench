// 「文档」页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 与 dsh-zhiyun-page-me 一样是空壳，但**必须存在** —— 客户端 bundle 靠宿主 Loader 的
// `ctx.loader.entries()` 进启动图谱，没有宿主入口的包不会被扫描，`dsh.client` 声明读不到。
export const name = 'zhiyun-page-docs';

/**
 * 无宿主行为：这一页读的是**打包进本包的** markdown 正文（`src/docs/*.md`，构建时由
 * esbuild 的 text loader 变成字符串），既不读仓库 `docs/` 目录，也不落盘、不连网。
 *
 * 之所以内置副本而不是去读 `docs/`：宿主的客户端 bundle 在浏览器里跑，没有文件系统；
 * 而「文档页要能看见仓库里的 docs」这种跨边界的读法，在打包后只剩下一个相对路径，
 * 换台机器、换个工作目录就全部失效。内置的代价是改文档要改两处 —— 这一条的取舍与
 * 兜底写在包内 README 的「为什么不直接读 docs/」里。
 */
export function apply() {}
