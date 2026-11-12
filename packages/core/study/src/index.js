// 学习领域核心的宿主半边：拥有「学习空间」工作区记录，并把学习工作台挂成
// 宿主服务 + /api/zw-study 端点（逻辑在 src/host.js，这里只做再导出）。
export const name = 'zw-study-core';

export { apply, inject } from './host.js';
