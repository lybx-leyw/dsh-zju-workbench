/**
 * 教务系统：CAS（**带** service）→ 成绩 / GPA / 课表。
 *
 * 走 `zdbk.*` 信封路由。注意教务的 CAS 必须带 `service`，与学在浙大相反 ——
 * 这也是拆包时没有复用 campus 登录链的原因。
 */

import { mount, mountCampus, memoryCredentials, routeOf, rpcEnvelope } from './_base.mjs';

export const label = '教务系统';

/**
 * @param options.account - `{ username, password }`（浙大一卡通）。
 * @param options.dataDir - 落盘目录。
 * @param options.card - 已 import 的 card 模块。
 * @returns 探针读数。
 */
export async function run({ account, dataDir, card }) {
  const creds = memoryCredentials();

  // zdbk 用 sharedFetch(ctx) 借 campus 的出口
  await mountCampus({ dataDir: `${dataDir}host/`, credentials: creds.service });

  const { ctx, routes } = await mount('dsh-zhiyun-source-zdbk', {
    dataDir,
    credentials: creds.service,
  });
  await card.writeCard(ctx, account);

  const route = routeOf(routes, '/api/zhiyun-zdbk');

  // 成绩是必读项：它同时验证「CAS 带 service 登录」与「业务接口鉴权」两段
  const grades = await rpcEnvelope(route, 'zdbk.grades', {});

  // 课表是**可选**项：学期未排课时它可能回空/null，那不算失败。
  // 早先把它当必过项，结果寒暑假跑一次就红一片 —— 那是报告噪音。
  const timetable = await rpcEnvelope(route, 'zdbk.timetable', {}).catch(() => null);

  return {
    grades: Array.isArray(grades?.grades) ? grades.grades.length : null,
    gpa: grades?.summary?.gpa_5 ?? null,
    timetable: Array.isArray(timetable?.sessions) ? timetable.sessions.length : null,
  };
}
