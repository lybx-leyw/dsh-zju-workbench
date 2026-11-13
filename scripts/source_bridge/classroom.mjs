/**
 * 智云课堂：CAS → 课程列表。
 *
 * 这个包**没有** `connection` 数据路由（它的对外面是 `provide('zwClassroom')`
 * 的服务对象），所以这里走服务方法 —— 仍然是产品自己的入口，不是内部类。
 */

import { mount, mountCampus, memoryCredentials } from './_base.mjs';

export const label = '智云课堂';

/**
 * @param options.account - `{ username, password }`（浙大一卡通）。
 * @param options.dataDir - 落盘目录。
 * @param options.card - 已 import 的 card 模块。
 * @returns 探针读数。
 */
export async function run({ account, dataDir, card }) {
  const creds = memoryCredentials();

  await mountCampus({ dataDir: `${dataDir}host/`, credentials: creds.service });

  const { ctx, services } = await mount('@lybx-leyw/dsh-zju-source-classroom', {
    dataDir,
    credentials: creds.service,
  });
  await card.writeCard(ctx, account);

  // 与 `ctx.get('zwClassroom')` 完全等价 —— 别的包就是这么取它的
  const source = services.get('zwClassroom');
  if (!source) {
    throw Object.assign(new Error('classroom 没有 provide zwClassroom'), { code: 'NO_SERVICE' });
  }

  await source.login(account);
  const courses = await source.listCourses();
  return {
    courses: courses?.items?.length ?? null,
    complete: courses?.meta?.complete ?? null,
  };
}
