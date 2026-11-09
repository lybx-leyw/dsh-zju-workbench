// 「插件依赖」页的宿主半边：把宿主那棵 Cordis 树的依赖事实读出来（逻辑在 src/host.js）。
// Loader entry 也必须存在 —— 否则客户端 bundle 进不了启动图谱。
export const name = 'zhiyun-page-plugins';

export { apply, inject } from './host.js';
