/**
 * 「题库」页的宿主半边。
 *
 * 这一页没有自己的服务端行为：领域状态（取数、出题任务、题库持久化）都在
 * `dsh-zhiyun-core-study` 提供的 `zhiyunStudyController` 里，页面只负责渲染。
 * 但入口文件必须存在 —— 宿主 Loader 先扫到本包，才会把 `dsh.client` 列进模块表。
 */
export const name = 'zhiyun-page-quiz';

/** 无宿主行为：页面内容全部在客户端。 */
export function apply() {}
