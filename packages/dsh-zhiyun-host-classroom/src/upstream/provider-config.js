/**
 * 上游 `lib/server/provider-config.ts`（1137 行）的**局部**移植。
 *
 * # 这里为什么只有这么点
 *
 * 该文件是「服务端 provider 配置」的唯一事实来源：YAML（`server-providers.yml`）
 * + 环境变量的装载器，七个能力段的 getter，以及一堆 `resolve*ApiKey/BaseUrl/Model`。
 * 真正搬它需要连带 `lib/config/model-slots`、`lib/config/preset-ids`、
 * `lib/server/model-config/{runtime,model-authorization}`、`lib/web-search/constants`
 * —— 那是 L2 的模型配置层，不在 L1 这一批。
 *
 * 所以本文件只做两件事：
 *
 *  1. 原样搬**纯环境变量**的那一个函数（{@link getParallelSceneConcurrency}）；
 *  2. 给出七个 getter 的**降级默认实现**（{@link createDegradedProviderConfig}）。
 *
 * # 降级默认实现为什么不算"编数据"
 *
 * 上游 `getServer*Providers()` 在**没有任何 YAML 段、也没有任何 `*_API_KEY`** 时的返回值
 * 就是空对象：`loadEnvSection()` 从 `{}` 开始，什么都不满足条件就一个条目都不加
 * （源文件:lib/server/provider-config.ts:262-330）。因此「配置层没装」与
 * 「装了但没配」在**返回值上不可区分**，都是 `{}`。
 *
 * 也就是说：降级实现给出的是**上游在同样输入下的同一个答案**，不是假数据。
 * 唯一的差别是不读盘 —— 读盘（`server-providers.yml`）是下一步的事，
 * 而它读的正是本包该接管的那件事（见 ROUTES.md 的 `server-providers` 一行）。
 */

/**
 * 服务端配置的并行场景生成并发上限。
 *
 * 源文件:lib/server/provider-config.ts:1093-1097，逐行照搬（含注释）。
 *
 * Opt-in concurrency for parallel scene-content generation (#572).
 *
 * Returns the server-configured `PARALLEL_SCENE_CONCURRENCY`, clamped to
 * [0, 10]. `0` (the default) means the client keeps the original serial
 * generation loop; a value `> 1` enables the hybrid two-phase path. Kept
 * server-side because many deployments use API keys with low per-key
 * concurrency quotas, where a bursty default would surface as 429s.
 */
export function getParallelSceneConcurrency() {
  const raw = Number.parseInt(process.env.PARALLEL_SCENE_CONCURRENCY ?? '', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 10);
}

/**
 * 上游 `REQUEST_PROVIDERS_REFUSED`（源文件:lib/server/resolve-model.ts:91-92），逐字保留：
 * 它是 403 `PROVIDER_DISABLED` 的文案，客户端按这句话做提示。
 */
export const REQUEST_PROVIDERS_REFUSED =
  'This server uses only the providers its configuration declares; a request cannot name its own model, key or endpoint.';

/**
 * 七个 provider getter + 解析器的降级集合。
 *
 * 返回的对象**形状必须与上游同名导出完全一致**，因为 `server-providers` 的
 * handler body 是原样搬的，它只认这七个名字：
 *
 * | 方法 | 上游签名 | 源文件:行 |
 * |---|---|---|
 * | `getServerProviders` | `Record<id, { models?: string[] }>` | provider-config.ts:706 |
 * | `getServerTTSProviders` | `Record<id, { disabled?: boolean }>` | provider-config.ts:741 |
 * | `getServerASRProviders` | `Record<id, { disabled?: boolean }>` | provider-config.ts:871 |
 * | `getServerPDFProviders` | `Record<id, Record<string, never>>` | provider-config.ts:903 |
 * | `getServerImageProviders` | `Record<id, { disabled?: boolean; models?: string[] }>` | provider-config.ts:924 |
 * | `getServerVideoProviders` | `Record<id, { disabled?: boolean; models?: string[] }>` | provider-config.ts:974 |
 * | `getServerWebSearchProviders` | `Record<id, { disabled?: boolean }>` | provider-config.ts:1024 |
 *
 * 后三段（解析器）是本批新搬的 route（`azure-voices`、`verify-*`、`transcription`、
 * `parse-pdf`）需要的。降级语义与「配置层装了但一个 provider 都没配」同答案：
 *
 * - `isServerConfiguredProvider` → `false`（没有任何 server-owned provider）；
 * - `isServerProviderDisabled` → `false`（没有强制停用）；
 * - `resolve*ApiKey(id, client)` → `client ?? ''`（server 不覆盖，就用调用方的）；
 * - `resolve*BaseUrl(id, client)` → `client`（同上）；
 * - `resolve*Model(id, client)` → `client`（没有 server 端钉住的模型清单）；
 * - `resolveServer*ProviderId()` → `''`（没有默认 provider）；
 * - `requestProvidersAllowed()` → `true`（`allowUserKeys` 未设置时上游就是允许）；
 * - `resolveManagedAliDocMindCredentials()` → `null`（没有托管凭据）。
 *
 * `configured: false` 是给 `status()` 用的：调用方据此知道"空"是"没配"还是"没搬"。
 * 它**不**进 HTTP body（上游 body 里没有这个字段，加进去就是契约漂移）。
 */
export function createDegradedProviderConfig() {
  return {
    /** false = 本包还没有装载器；true = 由外部注入的真实实现 */
    configured: false,
    getServerProviders: () => ({}),
    getServerTTSProviders: () => ({}),
    getServerASRProviders: () => ({}),
    getServerPDFProviders: () => ({}),
    getServerImageProviders: () => ({}),
    getServerVideoProviders: () => ({}),
    getServerWebSearchProviders: () => ({}),
    // 并发上限是**纯环境变量**的，不依赖装载器，所以这里给真实现而不是降级。
    getParallelSceneConcurrency,

    // ── 本批新搬的 route 用到的解析器 ────────────────────────────────────
    isServerConfiguredProvider: () => false,
    isServerProviderDisabled: () => false,
    resolveServerTTSProviderId: () => '',
    resolveServerASRProviderId: () => '',
    resolveServerPDFProviderId: () => '',
    resolveServerImageProviderId: () => '',
    resolveServerVideoProviderId: () => '',
    resolveImageApiKey: (_providerId, clientApiKey) => clientApiKey ?? '',
    resolveImageBaseUrl: (_providerId, clientBaseUrl) => clientBaseUrl,
    resolveImageModel: (_providerId, clientModel) => clientModel,
    resolveVideoApiKey: (_providerId, clientApiKey) => clientApiKey ?? '',
    resolveVideoBaseUrl: (_providerId, clientBaseUrl) => clientBaseUrl,
    resolveVideoModel: (_providerId, clientModel) => clientModel,
    resolveASRApiKey: (_providerId, clientApiKey) => clientApiKey ?? '',
    resolveASRBaseUrl: (_providerId, clientBaseUrl) => clientBaseUrl,
    resolveASRModel: (_providerId, clientModel) => clientModel,
    resolvePDFApiKey: (_providerId, clientApiKey) => clientApiKey ?? '',
    resolvePDFBaseUrl: (_providerId, clientBaseUrl) => clientBaseUrl,
    resolveManagedAliDocMindCredentials: () => null,
    requestProvidersAllowed: () => true,
  };
}

/**
 * 把外部注入的部分实现补齐成完整集合。
 *
 * 允许注入**一部分**是有意的：`getServerProviders`（LLM 段）与
 * `getServerWebSearchProviders`（web-search 段）分别来自不同配置段，
 * 将来可能由两个包各供一半（L2 的模型配置 / L2 的 web 检索）。
 * 缺哪个就用哪个的降级实现，而不是整块失效。
 */
export function mergeProviderConfig(injected) {
  const base = createDegradedProviderConfig();
  if (!injected || typeof injected !== 'object') return base;
  const merged = { ...base, configured: true };
  for (const key of Object.keys(base)) {
    if (key === 'configured') continue;
    if (typeof injected[key] === 'function') merged[key] = injected[key];
  }
  return merged;
}
