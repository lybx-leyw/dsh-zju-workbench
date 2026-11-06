/**
 * `GET /api/server-providers` 的 handler body
 * （源文件:app/api/server-providers/route.ts:1-38）。
 *
 * 逐行照搬，唯一改动是把 7 个 getter + 并发上限变成工厂参数（它们在
 * `./provider-config.js` 里，装载器还没搬，见那个文件的头注），
 * 以及 `apiSuccess` / `apiError` 用的是去掉 `NextResponse` 的端口。
 *
 * 上游原文：
 *
 * ```ts
 * const log = createLogger('ServerProviders');
 *
 * export async function GET() {
 *   try {
 *     return apiSuccess({ providers: ..., generation: {...} });
 *   } catch (error) {
 *     log.error('Error fetching server providers:', error);
 *     return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
 *   }
 * }
 * ```
 *
 * 注意 `catch` 里那句：**把上游错误的 message 原样回给客户端**。这一条看着像信息泄漏，
 * 但它是上游的既有行为（这里只列 provider 元数据，message 通常就是"某某段读取失败"），
 * 规范不许我们"顺手优化"，所以保留。真要收紧，必须先改规范。
 */

import { apiError, apiSuccess } from './api-response.js';

/** 上游 `createLogger('ServerProviders')` 的最小替身（源文件:lib/logger.ts）。 */
function defaultLog() {
  return {
    error: (...args) => console.error('[ServerProviders]', ...args),
  };
}

/**
 * @param {object} providerConfig `./provider-config.js` 的 `createDegradedProviderConfig()`
 *   或 `mergeProviderConfig(...)` 的结果
 * @param {{ error: (...args: unknown[]) => void }} [log]
 */
export function createServerProvidersHandler(providerConfig, { log = defaultLog() } = {}) {
  const {
    getServerProviders,
    getServerTTSProviders,
    getServerASRProviders,
    getServerPDFProviders,
    getServerImageProviders,
    getServerVideoProviders,
    getServerWebSearchProviders,
    getParallelSceneConcurrency,
  } = providerConfig;

  return async function GET() {
    try {
      return apiSuccess({
        providers: getServerProviders(),
        tts: getServerTTSProviders(),
        asr: getServerASRProviders(),
        pdf: getServerPDFProviders(),
        image: getServerImageProviders(),
        video: getServerVideoProviders(),
        webSearch: getServerWebSearchProviders(),
        generation: {
          parallelSceneConcurrency: getParallelSceneConcurrency(),
        },
      });
    } catch (error) {
      log.error('Error fetching server providers:', error);
      return apiError(
        'INTERNAL_ERROR',
        500,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  };
}
