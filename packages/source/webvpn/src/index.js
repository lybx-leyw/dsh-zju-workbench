/**
 * 宿主入口 + 统一导出面。
 *
 * 一个文件同时承担两件事，是因为本包**既是 Loader 条目又是纯库**：
 *
 *   - 作为 Loader 条目：必须有 `export const name` 与 `apply`（哪怕 `apply` 是空的）——
 *     没有宿主入口的包不会被扫描，`dsh.bundle.patch` 读不到，别的包 import 它会失败。
 *   - 作为库：把协议与登录两块的导出集中在这里，调用方 `import { toWebvpnUrl } from
 *     '@lybx-leyw/dsh-zju-source-webvpn'` 一行搞定，不必知道内部文件划分。
 *
 * 子路径入口（`/protocol`、`/login`）仍然可用，给只想要一小块、或想在测试里
 * 单独打桩的调用方。
 */

export const name = 'zhiyun-source-webvpn';

/**
 * 纯库：不注册路由、不 provide 服务、不挂样式。
 *
 * 保留这个空函数是 Loader 的硬要求（它按 `apply` 判断这是不是一个插件）。
 */
export function apply() {}

export * from './protocol.js';
export * from './login.js';
export * from './doctor.js';
export * from './egress.js';
// 主机归属表：`egress.js` 内部已用它做三级判定，这里一并导出，
// 让探测脚本、诊断面板与将来的数据源包能直接查「这个站属于哪一侧」。
export { HOSTS, HOSTS_GENERATED_AT, HOSTS_VIA, classifyHost, needsCas } from './hosts.js';
export { WebvpnError } from './errors.js';
