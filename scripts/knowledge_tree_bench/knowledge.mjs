/**
 * 知识域：`zhiyunKnowledge` 的存储动作 + 检索。
 *
 * 基准需要它，因为**树与讲义是落盘的**：基准如果不经过这一层，就测不到
 * "写了之后读回来还是不是同一棵"、"版本失效会不会把讲义一起作废"。
 *
 * ⚠️ 它 `inject: ['storageDomain']` —— 那是宿主提供的域存储。基准不伪造它
 *    （伪造了就验不到"真的按宿主 schema 存"），而是由 `mount` 里显式传入。
 *    见 `index.mjs` 的 `createBench()`：那里接的是宿主真实的 storage。
 */

import { mount, serviceOf, apiOf, urlOf } from './_base.mjs';

/** 记录 schema（基准造数要用它的形状）。 */
export async function schemaModule() {
  return import(urlOf('dsh-zhiyun-core-knowledge', 'src/schema.js')).catch(() => null);
}

/**
 * 装配知识库。
 *
 * @param options.dataDir - 落盘目录。
 * @param options.storageDomain - 宿主域存储服务（**必须**：这个包硬依赖它）。
 */
export async function mountKnowledge({ dataDir, storageDomain } = {}) {
  if (!storageDomain) {
    throw Object.assign(
      new Error('知识库需要宿主 storageDomain（基准不伪造它：伪造了就验不到宿主 schema）'),
      { code: 'NO_STORAGE' },
    );
  }
  const mounted = await mount('dsh-zhiyun-core-knowledge', { dataDir, services: { storageDomain } });
  const service = serviceOf(mounted, 'zhiyunKnowledge');
  return { mounted, service, ...apiOf(service) };
}
