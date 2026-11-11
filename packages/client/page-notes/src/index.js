// 「笔记」页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 存储（落盘、路径安全、PDF 字节流、RPC 路由）已下沉到
// `@lybx-leyw/dsh-zju-core-vault` 的 `src/notes-host.js` —— 页面包管文件
// 会把 UI 层和数据层焊死，也让「停用这一页」不等于「停用这套存储」。
//
// 保留 Loader entry 是为了让客户端 bundle 进入启动图谱
// （见 dsh-client-modules 的 ClientModuleRegistry：没有宿主入口的包不会被扫描）。
export const name = 'zhiyun-page-notes-host';

/** 无宿主行为：存储由 core-vault 提供，页面内容全部在客户端。 */
export function apply() {}
