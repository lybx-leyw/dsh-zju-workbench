// 「规划」页的宿主半边：页面只在浏览器里渲染，宿主侧没有行为。
//
// 聚合与路由（四份数据源、`/_dsh/zhiyun-planning`、快照、AI 规划、pet 对话）
// 已整体下沉到 `@lybx-leyw/dsh-zju-core-planning` —— 页面包管服务器会把 UI 层和
// 数据层焊死，也让「停用这一页」不等于「停用这套数据」。
//
// 保留 Loader entry 是为了让客户端 bundle 进入启动图谱
// （见 dsh-client-modules 的 ClientModuleRegistry：没有宿主入口的包不会被扫描）。
export const name = 'zhiyun-page-planning-host';

/** 无宿主行为：数据聚合与路由由 core-planning 提供，页面内容全部在客户端。 */
export function apply() {}
