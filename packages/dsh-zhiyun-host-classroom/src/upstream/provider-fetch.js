/**
 * Provider 专用传输（源文件:lib/server/audio-provider-fetch.ts:208-263、
 * lib/server/fetch-with-redirect-validation.ts、lib/server/media-provider-fetch.ts）。
 *
 * # 保留的语义（逐条对上游）
 *
 * 1. 每一跳都先过 SSRF 策略校验（`validateUrlForSSRFWithPolicy`），初始 URL 与
 *    每次重定向目标都查 —— 上游注释里的「redirect-to-internal SSRF (#398)」；
 * 2. 最多 `MAX_REDIRECT_HOPS = 5` 跳；
 * 3. `rejectRedirects: true` 时 3xx 直接抛 `RejectedRedirectError`（上游用
 *    `redirect:'error'`，undici 抛「unexpected redirect」；这里自己抛一个同类，
 *    并用同样的正则匹配 `isRejectedRedirectError`，所以 route 的 catch 分支不变）；
 * 4. `allowLocalNetworks: undefined` 表示「沿用进程级 `ALLOW_LOCAL_NETWORKS`」。
 *
 * # 没保留的语义（记在 ROUTES.md）
 *
 * 上游用 undici 的 `pinned-dispatcher` 把**连接地址**钉在校验过的 DNS 答案上，
 * 关掉「校验后二次解析」的窗口。本包不许新增依赖，所以只做 URL 层校验 +
 * 每跳复检，没有连接层钉定。这是本批唯一一处安全性弱于上游的地方。
 */

import {
  allowLocalNetworksEnabled,
  validateUrlForSSRFWithPolicy,
} from './ssrf-guard.js';

export const MAX_REDIRECT_HOPS = 5;

export class RejectedRedirectError extends Error {
  constructor(message = 'unexpected redirect') {
    super(message);
    this.name = 'RejectedRedirectError';
  }
}

/** 上游 `isRejectedRedirectError`（源:lib/utils/rejected-redirect.ts）。 */
export function isRejectedRedirectError(error) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === 'string' && /unexpected redirect/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

const DEFAULT_POLICY = Object.freeze({ allowLocalNetworks: undefined, rejectRedirects: false });
const MEDIA_PROVIDER_POLICY = Object.freeze({ allowLocalNetworks: undefined, rejectRedirects: true });
const MANAGED_MEDIA_PROVIDER_POLICY = Object.freeze({ allowLocalNetworks: true, rejectRedirects: true });

function allowLocalFor(policy) {
  return policy.allowLocalNetworks === undefined
    ? allowLocalNetworksEnabled()
    : policy.allowLocalNetworks;
}

/**
 * 发一个 provider 请求（源:audio-provider-fetch.ts:208-263）。
 *
 * @param {string|URL} input
 * @param {RequestInit} [init]
 * @param {{ allowLocalNetworks?: boolean, rejectRedirects?: boolean, fetch?: Function }} [policy]
 * @returns {Promise<Response>}
 */
export async function providerFetch(input, init = {}, policy = DEFAULT_POLICY) {
  const doFetch = policy.fetch ?? globalThis.fetch;
  const allowLocal = allowLocalFor(policy);
  let currentUrl = String(input);

  for (let hop = 0; ; hop += 1) {
    const blocked = await validateUrlForSSRFWithPolicy(currentUrl, { allowLocalNetworks: allowLocal });
    if (blocked) throw new Error(blocked);

    if (policy.rejectRedirects) {
      // 与上游 `redirect: 'error'` 等价：3xx 作为失败，不跟随。
      const response = await doFetch(currentUrl, { ...init, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel?.().catch(() => undefined);
        throw new RejectedRedirectError();
      }
      return response;
    }

    const response = await doFetch(currentUrl, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    await response.body?.cancel?.().catch(() => undefined);
    if (!location) return response;
    if (hop >= MAX_REDIRECT_HOPS) {
      throw new Error(`Provider request exceeded ${MAX_REDIRECT_HOPS} redirects`);
    }
    currentUrl = new URL(location, currentUrl).href;
  }
}

/** 上游 `mediaProviderFetch`（源:media-provider-fetch.ts:31-32）。 */
export function mediaProviderFetch(input, init) {
  return providerFetch(input, init, MEDIA_PROVIDER_POLICY);
}

/** 上游 `managedMediaProviderFetch`（源:34-35）。 */
export function managedMediaProviderFetch(input, init) {
  return providerFetch(input, init, MANAGED_MEDIA_PROVIDER_POLICY);
}

/** 上游 `withMediaProviderFetch`（源:67-69）。给适配器装上 pinned transport。 */
export function withMediaProviderFetch(config, managed) {
  return { ...config, fetchImpl: managed ? managedMediaProviderFetch : mediaProviderFetch };
}
