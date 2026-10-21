/**
 * 学习通：Cookie 导入 → 课程列表。
 *
 * 它的信封形状与 cc98/zdbk 不同：method 在 `payload.method`，参数在 `payload.args`。
 * 凭证走产品自己的 `xxt.importCookie` 动作 —— 它负责按 `chaoxing.com` 的子域分片。
 */

import { mount, mountCampus, memoryCredentials, routeOf, rpcXxt } from './_base.mjs';

export const label = '学习通';

/**
 * @param options.cookie - 用户粘贴的 Cookie 原文。
 * @param options.dataDir - 落盘目录。
 * @returns 探针读数。
 */
export async function run({ cookie, dataDir }) {
  const creds = memoryCredentials();

  await mountCampus({ dataDir: `${dataDir}host/`, credentials: creds.service });

  const { routes } = await mount('dsh-zhiyun-source-xxt', {
    dataDir,
    credentials: creds.service,
  });
  const route = routeOf(routes, '/api/zhiyun-xxt');

  // 导入走产品的动作（它会按域分片种 cookie，自己不重复实现）
  await rpcXxt(route, 'xxt.importCookie', { cookie });

  const courses = await rpcXxt(route, 'xxt.courses', {});
  return {
    courses: Array.isArray(courses?.courses)
      ? courses.courses.length
      : (Array.isArray(courses) ? courses.length : null),
  };
}
