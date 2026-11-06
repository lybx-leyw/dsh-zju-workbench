/**
 * 拼题A：题集 / 看题。
 *
 * # 这条链路的关键是「用产品自己的导入路径」
 *
 * 早先的探针手工建 `Transport`、手工把 Cookie 种进 jar，与产品的
 * `savePtaCookie()` 有三处偏差（少了 `Secure`、值含 `=` 时重组方式不同、
 * 单个坏 cookie 的处理不同）。结果探针报 `FORBIDDEN`，被当成账号问题 ——
 * 实际是探针自建了一条与产品不同的路。
 *
 * 现在两步都走 campus 路由的 POST 动作：
 *   - `?pta-cookie` —— 产品写 Cookie 的唯一入口（设置页也用它）；
 *   - `?pta-read`   —— 看题动作（题集详情 / 题目列表 / 题目 / 进度）。
 */

import { mount, memoryCredentials, routeOf, campusAction, campusGet } from './_base.mjs';

export const label = '拼题A';

/**
 * @param options.cookie - 用户粘贴的 Cookie 原文（cURL / 请求头 / 表格 / 裸串都可）。
 * @param options.dataDir - 落盘目录。
 * @returns 探针读数。
 */
export async function run({ cookie, dataDir }) {
  const creds = memoryCredentials();
  const { routes } = await mount('dsh-zhiyun-source-campus', {
    dataDir,
    credentials: creds.service,
  });
  const route = routeOf(routes, '/api/zhiyun-campus', 'webServer');

  // ① 用产品的导入路径落 Cookie（不要在探针里自己种）
  const saved = await campusAction(route, 'pta-cookie', { cookie });

  /**
   * ② 题集列表走 GET —— 产品的 `loadTodos()` 内部就是这么读的
   *    （`new PtaApi(transport).problemSets()`）。
   *    `?pta-read` 里**没有** problemSets 这个动作，只有看题的四个。
   */
  const listData = await campusGet(route);

  if (!listData?.todos?.pta?.ok) {
    const error = listData?.todos?.pta?.error ?? {};
    throw Object.assign(
      new Error(String(error.message ?? '拼题A 读取失败')),
      { code: error.code ?? 'PTA_FAILED' },
    );
  }

  const rows = listData.todos.pta.rows ?? [];
  const out = {
    cookieNames: saved?.names?.length ?? null,
    problemSets: rows.length,
  };

  // ③ 顺带验一次看题链路（只读，不开始考试）
  const first = rows[0];
  if (first?.id) {
    const problems = await campusAction(route, 'pta-read', {
      action: 'problems',
      problemSetId: first.id,
      limit: 5,
    });
    out.problems = problems?.result?.problems?.length ?? null;
    out.problemType = problems?.result?.typeLabel ?? null;
  }

  return out;
}
