/**
 * `GET /api/health` 的 handler body（源文件:app/api/health/route.ts:1-16）。
 *
 * # 迁移方式：原样搬
 *
 * 上游：
 *
 * ```ts
 * import { apiSuccess } from '@/lib/server/api-response';
 * import { resolveServerGenerationCapabilities } from '@/lib/server/generation-capabilities';
 * import { getParallelSceneConcurrency } from '@/lib/server/provider-config';
 *
 * const version = process.env.npm_package_version || '0.1.0';
 *
 * export async function GET() {
 *   return apiSuccess({ status: 'ok', version, ... });
 * }
 * ```
 *
 * 这里只做了规范第 2 通道要求的那两件事：
 *
 *  1. 去掉 `NextResponse`（由 `api-success` 的端口承担，见 `./api-response.js`）；
 *  2. 把三个 import 变成**工厂参数** —— 不是"抽一层方便测试"，而是因为它们分属三个
 *     还没搬完的模块（model-config 链路），L1 这一批只能先给降级实现。
 *
 * body 的字面内容、字段顺序、那句行内注释，全部保留。
 */

import { apiSuccess } from './api-response.js';

/**
 * 上游 `resolveServerGenerationCapabilities()` 的**降级**版本。
 *
 * 源文件:lib/server/generation-capabilities.ts:36-46。上游的实现是逐槽位
 * `resolveMediaSlot()`，槽位解析要读 workspace 的 web settings（`pg`），
 * 所以它属于「需适配」而不是「直接搬」，本批不搬。
 *
 * 降级答案为什么是"四个 false"：槽位解析不出来时上游的 `available()`
 * 就是 `catch { return false }`（源文件:generation-capabilities.ts:13-21），
 * 没有任何 provider 配置时四个槽位全都解析不出来 —— 与这里**同答案**。
 * 也就是说 `false` 不是编的，是「没配置」在上游语义下的正确取值。
 *
 * @returns {Promise<{ webSearch: boolean, imageGeneration: boolean, videoGeneration: boolean, tts: boolean }>}
 */
export async function degradedGenerationCapabilities() {
  return { webSearch: false, imageGeneration: false, videoGeneration: false, tts: false };
}

/**
 * 造出 health 的 handler。
 *
 * @param {object} deps
 * @param {() => Promise<object>} [deps.resolveServerGenerationCapabilities]
 * @param {() => number} [deps.getParallelSceneConcurrency]
 */
export function createHealthHandler({
  resolveServerGenerationCapabilities = degradedGenerationCapabilities,
  getParallelSceneConcurrency,
} = {}) {
  const version = process.env.npm_package_version || '0.1.0';

  return async function GET() {
    return apiSuccess({
      status: 'ok',
      version,
      accessCodeConfigured: Boolean(process.env.ACCESS_CODE),
      capabilities: await resolveServerGenerationCapabilities(),
      // How many scenes the browser may generate at once (PARALLEL_SCENE_CONCURRENCY).
      generation: { parallelSceneConcurrency: getParallelSceneConcurrency() },
    });
  };
}
