/**
 * 批 4：身份 / 配置 / 校验 / 导出 / PBL（27 条）——`mountPlatform(service, deps)`。
 *
 * 上游：`ref/OpenMAIC/app/api/{access-code,identity,folders,model-config,provider,
 * verify-model,verify-image-provider,verify-pdf-provider,verify-video-provider,
 * azure-voices,usage,persistence,export-video,quiz-grade,pbl}/**\/route.ts`
 *
 * # 挂载
 *
 * ```js
 * import { mountPlatform } from './services/platform.js';
 * createClassroomService({ …, mounts: [mountPlatform] });
 * ```
 *
 * 每个命名空间都用 `Object.assign(service.X ?? {}, …)` 追加，**不整体替换**。
 * 特别注意 `service.providers`：`list()` 是已实现的方法（`server-providers`），
 * 本批只往上**追加** `probe` / `verifyModel` / `verifyImage` / `verifyPdf` /
 * `verifyVideo` / `azureVoices`，`list()` 的实现原样保留；`set()` 这个空壳也保留
 * （本批没有能安全落地的实现，见 `modelConfig.put` 的注释）。
 *
 * # 端口面
 *
 * | 端口 | 方法 | 用在哪 |
 * |---|---|---|
 * | `ports.vault` | `kv.{get,set,remove,keys}` | `folders`（目录 + 归属）、`identity` 的降级存储 |
 * | `ports.identity` | `claim / bindLegacyImport` | `identity/*`（上游是 `pg` + owner cookie 合并） |
 * | `ports.modelConfig` | `view / apply / import` | `model-config`（上游是 owner 分区的工作区设置表 + revision） |
 * | `ports.providers` | `savedChatEndpoint / savedMediaConnection / verifyAliDocMind` | `verify-*` 的「按 id 测已保存 provider」分支 |
 * | `ports.agent` | `complete({system,prompt,model})` | `quiz-grade`（上游 `callLLM`） |
 * | `ports.pbl` | `grade / rubric / instructorTurn / openTask / simulatorTurn / updateTask` | `pbl/v2/*` |
 * | `ports.export` | `video(body, ctx)` | `export-video/render`（上游是独立渲染服务） |
 *
 * `deps.fetch` 是本批所有真实上游 HTTP 的出口（缺省 `globalThis.fetch`）：
 * `probe-models`、`verify-*`、`azure-voices`、`export-video` 全部走它，测试可替换。
 * `deps.env` 同理（缺省 `process.env`），只用于读 `RENDER_SERVICE_URL`、
 * `TRUST_PROXY_HEADERS`、`COOKIE_SECURE` 这三个部署配置。
 *
 * # 端口缺失时的行为（硬性，不许编数据）
 *
 * | 方法 | 缺端口时的返回 |
 * |---|---|
 * | `folders.*` | 纯文本 404（上游「没有持久层」分支，`folders/route.ts:55`） |
 * | `modelConfig.get / put / import` | 纯文本 404（同上，`model-config/route.ts:45/83`） |
 * | `persistence.*` | 404 `{error:{code:'PERSISTENCE_NOT_CONFIGURED'}}`（`dataDir` 为 null 时，`persistence/[...path]/route.ts:530`） |
 * | `identity.*` | 404 `PERSISTENCE_NOT_CONFIGURED`（`identity/claim/route.ts:41-48`） |
 * | `access.*` | 未配置 `accessCode` 时走上游「未启用访问码」分支（`{success:true,enabled:false,…}` / `{success:true,valid:true}`） |
 * | `providers.verify*` / `azureVoices` / `probe` | 不发假请求：没有 key 时走上游的 400/401 分支；「按 id 测已保存 provider」分支缺端口 → 抛 `E_NOT_IMPLEMENTED` |
 * | `quiz.grade` | 抛 `E_NOT_IMPLEMENTED`（带 `quiz-grade/route.ts:72-82`） |
 * | `pbl.*` | 抛 `E_NOT_IMPLEMENTED`（逐条带行号） |
 * | `video.*` | 未配 `RENDER_SERVICE_URL` → 501 `PROVIDER_DISABLED`（上游同分支） |
 *
 * # 删掉的 Next 专有声明
 *
 * `export const runtime = 'nodejs'`、`export const dynamic = 'force-dynamic'`、
 * `cookies()` / `cookies().set()`、`NextResponse.json` / `NextResponse.redirect`、
 * `req.formData()`、`AbortSignal.timeout` 之外的运行时钩子 —— 全部去掉。
 * `cookies()` 换成「从 `request.headers.cookie` 读 / 往响应头写 `Set-Cookie`」；
 * `req.json()` 换成入参直接收已解析的 body（解析失败的分支由 `body === undefined`
 * 表达，见每个方法的注释）。
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { ClassroomError, notImplemented } from '../errors.js';
import { FOLDER_COUNT_LIMIT, validateFolderName } from '../upstream/folder-name.js';
import { providerFetch, isRejectedRedirectError } from '../upstream/provider-fetch.js';
import { validateClientBaseUrl, validateUrlForSSRF } from '../upstream/ssrf-guard.js';
import { readUsageRecords } from '../upstream/usage-storage.js';
import {
  NOT_FOUND,
  binaryResponse,
  headerOf,
  jsonResponse,
  localOwner,
  plainResponse,
  searchParam,
  withOwner,
} from './support.js';

// ── 公共小工具 ──────────────────────────────────────────────────────────────

/**
 * 上游 `REQUEST_PROVIDERS_REFUSED`（源:lib/server/resolve-model.ts:91-92），逐字保留：
 * 它是 403 `PROVIDER_DISABLED` 的文案，客户端按这句话做提示。
 */
const REQUEST_PROVIDERS_REFUSED =
  'This server uses only the providers its configuration declares; a request cannot name its own model, key or endpoint.';

/** 上游 `MINERU_CLOUD_DEFAULT_BASE`（源:lib/pdf/constants.ts:8）。 */
const MINERU_CLOUD_DEFAULT_BASE = 'https://mineru.net/api/v4';

/**
 * 上游 `PDF_PROVIDERS` 里**没有** `baseUrl` 字段（`lib/pdf/constants.ts:14-52`），
 * 所以这张表只可能是空 —— 保留它是因为 `verifySavedPdfProvider` 的
 * 「endpoint 缺失 → 400」分支依赖这个查表动作。
 */
const PDF_PROVIDER_BASE_URLS = {};

/** 上游 `apiSuccess(data, status)`（`lib/server/api-response.ts:78`）。 */
function ok(data, httpStatus = 200, headers) {
  return jsonResponse({ success: true, ...data }, httpStatus, headers ?? new Headers());
}

/**
 * 上游 `apiError(code, status, error, details?, reason?)`
 * （`lib/server/api-response.ts:59-76`）：`details` / `reason` 为假值时不出现。
 */
function fail(httpStatus, code, error, headers, details, reason) {
  return jsonResponse(
    {
      success: false,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
      ...(reason ? { reason } : {}),
    },
    httpStatus,
    headers ?? new Headers(),
  );
}

/** 上游各 owner-scoped route 的 `{ error: { code, message } }` 信封。 */
function errorJson(httpStatus, code, message, headers) {
  return jsonResponse({ error: { code, message } }, httpStatus, headers ?? new Headers());
}

/** 端口一律**调用时**取（挂载时读一次会把「还没装」永久钉成 null）。 */
function portsOf(deps) {
  try {
    return deps?.ports ?? {};
  } catch {
    return {};
  }
}

function portOf(deps, name) {
  const ports = portsOf(deps);
  try {
    return ports[name] ?? deps?.[name] ?? null;
  } catch {
    return null;
  }
}

const vaultOf = (deps) => portOf(deps, 'vault');
const envOf = (deps) => {
  try {
    return deps?.env ?? process.env;
  } catch {
    return {};
  }
};

/** 上游 HTTP 的唯一出口：`deps.fetch` 缺省 `globalThis.fetch`。 */
function fetchOf(deps) {
  const injected = deps?.fetch;
  const impl = typeof injected === 'function' ? injected : globalThis.fetch;
  return (input, init) => impl(input, init);
}

function nowMs() {
  return Date.now();
}

/** 上游 `clientIdentity(req)` 的近似：可信代理头优先，否则 `unknown`。 */
function clientIdentityOf(request, env) {
  const headers = request?.headers;
  const forwarded = headerOf(headers, 'x-forwarded-for');
  if (forwarded) return String(forwarded).split(',', 1)[0].trim();
  const real = headerOf(headers, 'x-real-ip');
  if (real) return String(real).trim();
  void env;
  return 'unknown';
}

/** 上游 `isTrustedProxyIdentity()`：`TRUST_PROXY_HEADERS=true` 时才按客户端计数。 */
function trustProxyEnabled(env) {
  const raw = String(env?.TRUST_PROXY_HEADERS ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** 上游 `cookiesAreSecure()`：`COOKIE_SECURE=0` 是明文 HTTP 部署的退出开关。 */
function cookiesAreSecure(env) {
  return String(env?.COOKIE_SECURE ?? '').trim() !== '0';
}

/** 从 `cookie` 头里读一个值（`cookies().get(name)?.value` 的等价物）。 */
function cookieOf(request, name) {
  const raw = headerOf(request?.headers, 'cookie');
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function appendSetCookie(headers, cookie) {
  headers.append('Set-Cookie', cookie);
}

/** `AbortSignal.timeout` 的兜底（老 Node 没有静态方法时手搓）。 */
function timeoutSignal(ms) {
  if (typeof AbortSignal?.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

// ── access-code：HMAC 令牌（源:lib/server/access-token.ts:1-37，逐行照搬） ──

/** 上游 `ACCESS_TOKEN_MAX_AGE_SECONDS`（源:lib/server/access-token-shared.ts:21）。 */
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const ACCESS_TOKEN_MAX_AGE_MS = ACCESS_TOKEN_MAX_AGE_SECONDS * 1000;
const ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 5 * 60;
const ACCESS_TOKEN_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function isAccessTokenSignatureFormatValid(signature) {
  return ACCESS_TOKEN_SIGNATURE_PATTERN.test(signature);
}

/** 上游 `isAccessTokenTimestampValid`（源:access-token-shared.ts:76-100）。 */
function isAccessTokenTimestampValid(timestamp, now = nowMs()) {
  if (!/^\d+$/.test(timestamp)) return false;
  const value = Number(timestamp);
  if (!Number.isSafeInteger(value)) return false;
  if (now - value > ACCESS_TOKEN_MAX_AGE_MS) return false;
  if (value - now > ACCESS_TOKEN_CLOCK_SKEW_SECONDS * 1000) return false;
  return true;
}

function createAccessToken(accessCode) {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

function verifyAccessToken(token, accessCode, now = nowMs()) {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;
  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);
  if (!isAccessTokenTimestampValid(timestamp, now)) return false;
  if (!isAccessTokenSignatureFormatValid(signature)) return false;
  const expected = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

/**
 * 上游 `warnIfAccessCodeIsShort`（源:lib/server/access-code-warning.ts）。
 * 本包不静默：短码只在服务端日志里提一句，行为不变。
 */
function warnIfAccessCodeIsShort(accessCode, log) {
  if (accessCode.length < 12) {
    log.warn?.('ACCESS_CODE 很短：暴力破解成本很低，建议 16 位以上随机串');
  }
}

/**
 * 访问码尝试限流（源:lib/server/attempt-limiter.ts，行为面照搬）。
 *
 * 只有「可信代理身份」才计数：不可信时上游**恒放行且不存任何东西**
 * （共享配额只会变成一个 DoS 杠杆），所以这里 untrusted 直接返回 `{limited:false}`。
 */
function createAttemptLimiter() {
  const ATTEMPT_LIMIT_MAX_FAILURES = 10;
  const ATTEMPT_LIMIT_WINDOW_MS = 60_000;
  const ATTEMPT_LIMIT_MAX_IDENTITIES = 10_000;
  const failures = new Map();

  const prune = (timestamps, now) => timestamps.filter((ts) => now - ts < ATTEMPT_LIMIT_WINDOW_MS);

  return {
    /** 上游 `accessCodeAttemptLimiter.consume(identity, trusted)`。 */
    consume(identity, trusted, now = nowMs()) {
      if (!trusted) return { limited: false, retryAfterSeconds: 0 };
      const list = prune(failures.get(identity) ?? [], now);
      if (list.length >= ATTEMPT_LIMIT_MAX_FAILURES) {
        failures.set(identity, list);
        const oldest = list[0];
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((ATTEMPT_LIMIT_WINDOW_MS - (now - oldest)) / 1000),
        );
        return { limited: true, retryAfterSeconds };
      }
      // 预约：解析 body 之前就记一笔（上游同义：坏 body 也消耗一次机会）。
      list.push(now);
      if (failures.size > ATTEMPT_LIMIT_MAX_IDENTITIES) {
        const oldestKey = failures.keys().next().value;
        if (oldestKey !== undefined && oldestKey !== identity) failures.delete(oldestKey);
      }
      failures.set(identity, list);
      return { limited: false, retryAfterSeconds: 0 };
    },
    recordSuccess(identity, trusted) {
      if (!trusted) return;
      failures.delete(identity);
    },
  };
}

// ── provider 探测：模型列表（源:lib/server/model-fetch.ts） ────────────────

const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
];

const MODEL_FETCH_TIMEOUT_MS = 15_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 2 * MODEL_FETCH_TIMEOUT_MS;

/** 上游 `ModelFetchError`（源:model-fetch.ts:245-253）。 */
class ModelFetchError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ModelFetchError';
    this.status = status;
  }
}

function endsWithVersionSegment(url) {
  const last = url.split('/').pop() ?? '';
  if (!last.startsWith('v')) return false;
  const digits = last.slice(1);
  return digits.length > 0 && /^\d+$/.test(digits);
}

function stripCompatSuffix(baseUrl) {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) return baseUrl.slice(0, baseUrl.length - suffix.length);
  }
  return null;
}

/** 上游 `buildModelsUrlCandidates`（源:model-fetch.ts:90-122），逐行照搬。 */
function buildModelsUrlCandidates(baseUrl, opts = {}) {
  const override = opts.modelsUrlOverride?.trim();
  if (override) return [override];

  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is empty');

  const candidates = [];
  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith('/v1')) candidates.push(`${trimmed}/v1/models`);
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, '');
    if (root && root.includes('://')) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }
  return candidates.filter((url, i) => candidates.indexOf(url) === i);
}

/**
 * 上游 `fetchModels`（源:model-fetch.ts:137-184）。
 *
 * 差别只有一处：上游的 transport 是 undici 的 pinned dispatcher（DNS 钉定），
 * 本包不加依赖，用注入的 `deps.fetch` 直连 —— 与 `provider-fetch.js` 头注记的
 * 同一个安全面差额（URL 层校验仍在，连接层钉定没有）。
 */
async function fetchModels(baseUrl, apiKey, opts = {}) {
  const candidates = buildModelsUrlCandidates(baseUrl, opts);
  const doFetch = opts.fetchImpl;
  const deadline = Date.now() + MODEL_DISCOVERY_TIMEOUT_MS;
  let retried = false;

  for (const url of candidates) {
    let body = null;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const error = new Error('Model discovery timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      try {
        body = await fetchModelsCandidate(doFetch, url, apiKey, Math.min(MODEL_FETCH_TIMEOUT_MS, remaining));
        break;
      } catch (error) {
        if (
          retried ||
          Date.now() >= deadline ||
          !(error instanceof TypeError || (error && error.name === 'TimeoutError'))
        ) {
          throw error;
        }
        retried = true;
      }
    }
    if (body === null) continue;
    return (body.data ?? [])
      .map((m) => ({ id: m.id, ownedBy: m.owned_by }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  throw new ModelFetchError(404, `No /models endpoint found (tried: ${candidates.join(', ')})`);
}

async function fetchModelsCandidate(doFetch, url, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (isRejectedRedirectError(error)) {
        throw new ModelFetchError(302, 'Redirects are not allowed');
      }
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ModelFetchError(response.status, 'Redirects are not allowed');
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ModelFetchError(response.status, 'The model list response is not valid JSON');
      }
    }
    if (response.status === 404 || response.status === 405) return null;
    throw new ModelFetchError(response.status, `HTTP ${response.status}`);
  } catch (error) {
    if (error instanceof ModelFetchError) throw error;
    if (controller.signal.aborted) throw controller.signal.reason ?? error;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ── 媒体 provider 注册表（源:lib/media/{image,video}-providers.ts） ────────

/**
 * 两个注册表的**路由相关字段**（`requiresApiKey` / `defaultBaseUrl` / 有没有
 * 模型清单）。上游的 `name` / `icon` / 比例 / 时长这些只给 UI 用，本包不搬
 * （它们不参与任何一条 route 的判断）。`hasModels` 是 `models.length > 0` 的
 * 等价物 —— `MISSING_MODEL` 分支只判这一点。
 *
 * 各 provider 的 `test*Connectivity`（10 个 image + 6 个 video 适配器）没有
 * 逐个搬：本文件用一个统一的认证探测（见 `probeMediaProvider`），路径表见
 * `MEDIA_PROBE_PATHS`。文案沿用上游 `lib/media/probe-auth.ts` 的固定句式。
 */
const IMAGE_PROVIDERS = {
  seedream: { requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com', hasModels: true },
  'openai-image': { requiresApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1', hasModels: true },
  'qwen-image': { requiresApiKey: true, defaultBaseUrl: 'https://dashscope.aliyuncs.com', hasModels: true },
  'nano-banana': {
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    hasModels: true,
  },
  'minimax-image': { requiresApiKey: true, defaultBaseUrl: 'https://api.minimaxi.com', hasModels: true },
  'grok-image': { requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1', hasModels: true },
  'glm-image': {
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hasModels: true,
  },
  'comfyui-image': { requiresApiKey: false, defaultBaseUrl: 'http://localhost:8188', hasModels: false },
  lemonade: { requiresApiKey: false, defaultBaseUrl: 'http://localhost:13305/v1', hasModels: true },
  'openrouter-image': {
    requiresApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    hasModels: true,
  },
};

const VIDEO_PROVIDERS = {
  seedance: { requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com', hasModels: true },
  kling: { requiresApiKey: true, defaultBaseUrl: 'https://api-beijing.klingai.com', hasModels: true },
  'minimax-video': { requiresApiKey: true, defaultBaseUrl: 'https://api.minimaxi.com', hasModels: true },
  'grok-video': { requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1', hasModels: true },
  happyhorse: { requiresApiKey: true, defaultBaseUrl: 'https://dashscope.aliyuncs.com', hasModels: true },
  'openrouter-video': {
    requiresApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    hasModels: true,
  },
};

/** 各 provider 的探测路径（`GET ${base}${path}`）。空串 = 直接探 base URL。 */
const MEDIA_PROBE_PATHS = {
  'openai-image': '/models',
  'openrouter-image': '/key',
  'openrouter-video': '/key',
  'comfyui-image': '/system_stats',
  lemonade: '/models',
  kling: '/',
  'grok-video': '/models',
};

/** 上游 `connectivityHttpFailure`（源:lib/media/probe-auth.ts:18-32）。 */
function connectivityHttpFailure(providerName, status) {
  if (status >= 300 && status < 400) {
    return { success: false, message: `${providerName} connectivity error: Redirects are not allowed` };
  }
  if (status === 401 || status === 403) {
    return { success: false, message: `${providerName} auth failed (${status}), please check the API Key` };
  }
  return { success: false, message: `${providerName} returned HTTP ${status}` };
}

/** 上游 `connectivityTransportFailure`（源:lib/media/probe-auth.ts:35-49）。 */
function connectivityTransportFailure(providerName, error) {
  if (isRejectedRedirectError(error)) {
    return { success: false, message: `${providerName} connectivity error: Redirects are not allowed` };
  }
  return {
    success: false,
    message: `${providerName} connectivity error: cannot reach the provider, please check the Base URL`,
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').replace(/\/+$/, '');
}

/**
 * 认证探测（源:lib/media/probe-auth.ts:55-75 的 `probeAuth` 契约）：
 * 除 3xx / 401 / 403 之外的任何应答都算连通。
 *
 * 与上游的差额：每个适配器自己的探测 path 只搬了能读到的几个（见
 * `MEDIA_PROBE_PATHS`），其余统一用 `/models`。文案与判定完全同上游。
 */
async function probeMediaProvider({ providerName, baseUrl, apiKey, providerId, managed, doFetch }) {
  const base = normalizeBaseUrl(baseUrl);
  const path = MEDIA_PROBE_PATHS[providerId];
  const url = path === undefined ? `${base}/models` : path === '/' ? base : `${base}${path}`;
  let response;
  try {
    response = await providerFetch(
      url,
      {
        method: 'GET',
        redirect: 'manual',
        ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
        signal: timeoutSignal(10_000),
      },
      {
        allowLocalNetworks: managed ? true : undefined,
        rejectRedirects: true,
        fetch: doFetch,
      },
    );
  } catch (error) {
    return connectivityTransportFailure(providerName, error);
  }
  await response.body?.cancel?.().catch(() => undefined);
  if (
    (response.status >= 300 && response.status < 400) ||
    response.status === 401 ||
    response.status === 403
  ) {
    return connectivityHttpFailure(providerName, response.status);
  }
  return { success: true, message: `Connected to ${providerName}` };
}

const IMAGE_PROVIDER_NAMES = {
  seedream: 'Seedream',
  'openai-image': 'OpenAI Image',
  'qwen-image': 'Qwen Image',
  'nano-banana': 'Nano Banana',
  'minimax-image': 'MiniMax Image',
  'grok-image': 'Grok Image',
  'glm-image': 'GLM Image',
  'comfyui-image': 'ComfyUI',
  lemonade: 'Lemonade',
  'openrouter-image': 'OpenRouter',
};

const VIDEO_PROVIDER_NAMES = {
  seedance: 'Seedance',
  kling: 'Kling',
  'minimax-video': 'MiniMax Video',
  'grok-video': 'Grok Video',
  happyhorse: 'HappyHorse',
  'openrouter-video': 'OpenRouter',
};

// ── LLM 直连（上游 `callLLM` 的最小替代） ─────────────────────────────────

/** 带上游状态的传输错误（用于把 401/404/429 翻译成固定文案）。 */
class LlmHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
  }
}

/**
 * 发一条最小的 chat completion（OpenAI 兼容形状）。
 *
 * 上游走 `lib/ai/llm` 的统一封装（模型解析、provider 适配、重试、计量）。
 * 本包只保留 `verify-model` / `quiz-grade` 需要的**最小**面：一条消息、一次
 * 调用、失败带 HTTP 状态。没有模型名/baseUrl 时不发请求（走上游的 400/401
 * 分支），绝不自己编一个模型名。
 */
async function chatCompletion({ baseUrl, apiKey, model, system, prompt, maxTokens }, doFetch) {
  const base = normalizeBaseUrl(baseUrl);
  const response = await doFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal: timeoutSignal(60_000),
  });
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => undefined);
    throw new LlmHttpError(response.status, `HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => null);
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    '';
  return { text: String(text ?? '') };
}

// ── 目录存储（上游 `@openmaic/storage` 的 DocumentFolderStore，kv 版） ─────

const folderKey = (ownerId, id) => `folders/${ownerId}/${id}`;
const memberKey = (ownerId, stageId) => `folder-members/${ownerId}/${stageId}`;

/** 上游 `createFolderId()`（源:lib/server/folder-persistence.ts:30-32）。 */
function createFolderId() {
  return `folder-${randomBytes(9).toString('base64url')}`;
}

/** 上游 `FolderNameError`（源:lib/utils/folder-name-validation.ts:20-26）。 */
class FolderNameError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'FolderNameError';
    this.kind = kind;
  }
}

/**
 * 上游 `folderNameErrorResponse`（源:lib/server/folder-name-errors.ts:25-46）。
 * 返回 `null` = 不是目录名拒绝，调用方落到自己的 500 分支。
 */
function folderNameErrorResponse(error, headers) {
  if (error instanceof FolderNameError) {
    switch (error.kind) {
      case 'duplicate':
        return errorJson(409, 'FOLDER_NAME_DUPLICATE', 'a folder with this name already exists', headers);
      case 'limit':
        return errorJson(
          400,
          'FOLDER_COUNT_LIMIT',
          `folder count limit reached (${FOLDER_COUNT_LIMIT})`,
          headers,
        );
      case 'empty':
        return errorJson(400, 'FOLDER_NAME_EMPTY', 'folder name must not be empty', headers);
      case 'tooLong':
        return errorJson(400, 'FOLDER_NAME_TOO_LONG', 'folder name is too long', headers);
      default:
        return null;
    }
  }
  if (error && typeof error === 'object' && error.code === '23505') {
    return errorJson(409, 'FOLDER_NAME_DUPLICATE', 'a folder with this name already exists', headers);
  }
  return null;
}

/**
 * `DocumentFolderStore` 的 kv 实现：一个目录一条记录、一个归属一条记录。
 *
 * 与上游（`@openmaic/storage/document/pg.ts`）的对应：
 * - 表 `document_folders` → `folders/<ownerId>/<id>`；
 * - 表 `document_stage_folders` → `folder-members/<ownerId>/<stageId>`；
 * - `order` 上游由 SQL 分配（当前最大 +1），这里用 `列表长度`（同一语义：
 *   新目录排在最后；并发创建的 order 可能相同，已记在 ROUTES.md）。
 */
function folderStore(vault, ownerId) {
  const kv = vault.kv;
  const prefix = `folders/${ownerId}/`;

  async function listFolders() {
    const keys = await kv.keys(prefix);
    const folders = [];
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      const value = await kv.get(key);
      if (value) folders.push(value);
    }
    return folders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  }

  return {
    listFolders,

    /** 上游 `createFolder(id, name, limit, …)` 的显式版（`reused` 恒 false：kv 无唯一索引）。 */
    async createFolder(id, name) {
      const current = await listFolders();
      if (current.length >= FOLDER_COUNT_LIMIT) {
        throw new FolderNameError('Folder count limit reached', 'limit');
      }
      const now = nowMs();
      const folder = { id, name, order: current.length, createdAt: now, updatedAt: now };
      await kv.set(folderKey(ownerId, id), folder);
      return { folder, reused: false };
    },

    async renameFolder(id, name) {
      const existing = await kv.get(folderKey(ownerId, id));
      if (!existing) return null;
      const updated = { ...existing, name, updatedAt: nowMs() };
      await kv.set(folderKey(ownerId, id), updated);
      return updated;
    },

    /**
     * 上游 `deleteFolder(id, mode)`：`ungroup` 把课程变成未归组；`remove` 把
     * 被捕获的课程 id 交回调用方自己级联。两种都删掉归属记录（上游 SQL 同义：
     * 归属行随目录一起消失）。
     */
    async deleteFolder(id, mode) {
      const existing = await kv.get(folderKey(ownerId, id));
      if (!existing) return null;
      const memberKeys = await kv.keys(`folder-members/${ownerId}/`);
      const removedStageIds = [];
      for (const key of memberKeys) {
        // eslint-disable-next-line no-await-in-loop
        const folderId = await kv.get(key);
        if (folderId === id) {
          removedStageIds.push(key.slice(`folder-members/${ownerId}/`.length));
          // eslint-disable-next-line no-await-in-loop
          await kv.remove(key);
        }
      }
      await kv.remove(folderKey(ownerId, id));
      void mode;
      return { removedStageIds };
    },

    /** 上游 `setStageFolder(stageId, folderId)`：目录不属于本 owner 时 false。 */
    async setStageFolder(stageId, folderId) {
      if (folderId === null) {
        await kv.remove(memberKey(ownerId, stageId));
        return true;
      }
      const folder = await kv.get(folderKey(ownerId, folderId));
      if (!folder) return false;
      await kv.set(memberKey(ownerId, stageId), folderId);
      return true;
    },
  };
}

/** 上游 `folderResponse`：线上形状是「目录行 + 归属 owner」（`userKey`）。 */
function folderResponse(folder, userKey) {
  return { ...folder, userKey };
}

// ── usage 聚合（源:app/api/usage/route.ts:13-107，逐行照搬） ──────────────

function emptyBucket(key, kind, unit) {
  return {
    key,
    kind,
    unit,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    quantity: 0,
  };
}

const usageUnitOf = (r) => r.unit ?? 'token';

function addToBucket(bucket, r) {
  bucket.requests += 1;
  bucket.inputTokens += r.inputTokens;
  bucket.outputTokens += r.outputTokens;
  bucket.cacheReadTokens += r.cacheReadTokens;
  bucket.cacheCreationTokens += r.cacheCreationTokens;
  bucket.totalTokens += r.inputTokens + r.outputTokens;
  bucket.quantity += r.quantity ?? 0;
}

const usageDayKey = (createdAt) => new Date(createdAt).toISOString().slice(0, 10);

// ── 渲染服务（源:lib/server/render-service.ts） ───────────────────────────

const RENDER_OWNER_HEADER = 'x-openmaic-render-owner';
const RENDER_OWNER_BOUND_HEADER = 'x-openmaic-render-owner-bound';

/** 上游 `resolveRenderServiceUrl()`（源:render-service.ts:81-84）。 */
function resolveRenderServiceUrl(env) {
  const raw = String(env?.RENDER_SERVICE_URL ?? '').trim();
  return raw ? { url: raw.replace(/\/+$/, '') } : { error: 'not_configured' };
}

/** 上游 `isRenderOwnerBoundResponse`（源:render-service.ts:28-30）。 */
function isRenderOwnerBoundResponse(response) {
  return response.headers.get(RENDER_OWNER_BOUND_HEADER) === '1';
}

// ── 持久层路径（通用 KV 文件树） ──────────────────────────────────────────

/**
 * 路径规范化 + 穿越校验。
 *
 * 上游 `persistence/[...path]` 把路径原样交给 `@openmaic/storage` 的 HTTP
 * handler（它按路由模式匹配，不落文件系统），路由自己没有 `normalize`。本包
 * 落的是 `dataDir/persistence/` 真实文件树，所以**这里补一层**（安全加固，
 * 不是搬运）：逐段百分号解码 → 拒绝空段 / `.` / `..` / 含 `/` `\` 或 NUL 的段
 * → 解析后必须仍在根目录内（防御 `%2e%2e%2f` 之类的双解码把戏）。
 *
 * @returns {{ ok: true, segments: string[], file: string } | { ok: false, message: string }}
 */
function resolvePersistencePath(root, path) {
  const raw = Array.isArray(path) ? path.join('/') : String(path ?? '');
  if (!raw.trim()) return { ok: false, message: 'path is required' };
  const pieces = raw.split('/').filter((piece) => piece !== '');
  const segments = [];
  for (const piece of pieces) {
    let decoded;
    try {
      decoded = decodeURIComponent(piece);
    } catch {
      return { ok: false, message: 'path is not valid percent-encoding' };
    }
    if (decoded === '' || decoded === '.' || decoded === '..') {
      return { ok: false, message: 'path must not contain empty or relative segments' };
    }
    if (/[/\\\0]/.test(decoded)) {
      return { ok: false, message: 'path must not contain separators' };
    }
    segments.push(decoded);
  }
  if (segments.length === 0) return { ok: false, message: 'path is required' };
  const file = resolve(root, ...segments);
  const prefix = resolve(root) + sep;
  if (!file.startsWith(prefix)) {
    return { ok: false, message: 'path escapes the persistence root' };
  }
  return { ok: true, segments, file };
}

// ── 挂载 ───────────────────────────────────────────────────────────────────

/**
 * @param {object} service `createClassroomService` 的返回值
 * @param {object} deps `{ ports, log, dataDir, providerConfig, fetch?, env?, owner? }`
 */
export function mountPlatform(service, deps = {}) {
  const log = deps.log ?? {};
  const providerConfig = deps.providerConfig ?? {};
  const dataDir = deps.dataDir ?? null;
  const doFetch = fetchOf(deps);
  const env = envOf(deps);
  const ownerDeps = { ...deps, owner: deps.owner ?? localOwner };
  const limiter = createAttemptLimiter();

  const vault = () => vaultOf(deps);
  const kv = () => vault()?.kv ?? null;

  /** 上游 `isServerPersistenceConfigured()`：本包里 = kv 五件套齐全。 */
  const hasPersistence = () => {
    const store = kv();
    return Boolean(
      store && store.get && store.set && store.keys && typeof store.remove === 'function',
    );
  };

  /** 上游 `requestProvidersAllowed()`（源:lib/server/model-config/runtime.ts）。 */
  const requestProvidersAllowed = () => {
    const fn = providerConfig.requestProvidersAllowed;
    return typeof fn === 'function' ? Boolean(fn()) : true;
  };

  const accessCode = () => {
    let raw;
    try {
      raw = typeof providerConfig.get === 'function' ? providerConfig.get('accessCode') : undefined;
    } catch {
      raw = undefined;
    }
    return typeof raw === 'string' && raw.length > 0 ? raw : '';
  };

  // ── service.access（access-code/*） ─────────────────────────────────────

  const access = {
    /**
     * 源文件:app/api/access-code/status/route.ts:5-17（GET）。
     *
     * 上游读 `process.env.ACCESS_CODE`；本包读 `providerConfig.get('accessCode')`。
     * 未配置时上游返回 `{ success:true, enabled:false, authenticated:false }`
     * —— 这一条就是「未启用访问码」分支，逐字照抄。
     */
    async status(request) {
      const code = accessCode();
      const enabled = Boolean(code);

      let authenticated = false;
      if (enabled) {
        const token = cookieOf(request, 'openmaic_access');
        authenticated = Boolean(token) && verifyAccessToken(token, code);
      }

      return ok({ enabled, authenticated }, 200, new Headers());
    },

    /**
     * 源文件:app/api/access-code/verify/route.ts:21-83（POST）。
     *
     * `body` 是已解析的 JSON（解析失败传 `undefined`，等价上游 `catch` 分支）。
     * `request` 收 `{ headers, ownerId? }`：cookie 从 `headers.cookie` 读，成功时
     * 往响应头写 `Set-Cookie`（上游 `cookies().set(...)`，源:71-80）。
     */
    async verify(body, request) {
      const code = accessCode();
      if (!code) {
        // 上游 `if (!accessCode) return apiSuccess({ valid: true })`（源:23-25）。
        return ok({ valid: true }, 200, new Headers());
      }

      warnIfAccessCodeIsShort(code, log);
      const trusted = trustProxyEnabled(env);
      const identity = clientIdentityOf(request, env);
      const limit = limiter.consume(identity, trusted);
      if (limit.limited) {
        const headers = new Headers();
        headers.set('Retry-After', String(limit.retryAfterSeconds));
        return fail(429, 'RATE_LIMITED', 'Too many access-code attempts', headers);
      }

      // 预约在解析 body 之前（trusted 才有），所以坏 body 也消耗一次机会 —— 同上游。
      if (body === undefined) {
        return fail(400, 'INVALID_REQUEST', 'Invalid JSON body');
      }

      const candidate = readCandidateCode(body);
      if (candidate === null) {
        return fail(401, 'INVALID_REQUEST', 'Invalid access code');
      }

      // Constant-time comparison
      const a = Buffer.from(candidate);
      const b = Buffer.from(code);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return fail(401, 'INVALID_REQUEST', 'Invalid access code');
      }

      limiter.recordSuccess(identity, trusted);

      const token = createAccessToken(code);
      const headers = new Headers();
      appendSetCookie(
        headers,
        [
          `openmaic_access=${encodeURIComponent(token)}`,
          'HttpOnly',
          'SameSite=Lax',
          'Path=/',
          `Max-Age=${ACCESS_TOKEN_MAX_AGE_SECONDS}`,
          ...(cookiesAreSecure(env) ? ['Secure'] : []),
        ].join('; '),
      );

      return ok({ valid: true }, 200, headers);
    },
  };

  /** 上游 `readCandidateCode`（源:access-code/verify/route.ts:15-19）。 */
  function readCandidateCode(body) {
    if (typeof body !== 'object' || body === null) return null;
    const candidate = body.code;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }

  // ── service.identity（identity/*） ──────────────────────────────────────

  /** 上游 `isSameOriginJsonRequest`（源:lib/persistence/owner-claim-http.ts:33-57）。 */
  function isSameOriginJsonRequest(request) {
    const contentType = String(headerOf(request?.headers, 'content-type') ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') return false;
    const site = headerOf(request?.headers, 'sec-fetch-site');
    if (site !== null && site !== undefined) return String(site).trim().toLowerCase() === 'same-origin';
    const origin = headerOf(request?.headers, 'origin');
    if (origin === null || origin === undefined) return true;
    let originHost;
    try {
      originHost = new URL(String(origin)).host.toLowerCase();
    } catch {
      return false;
    }
    const hosts = [
      headerOf(request?.headers, 'host'),
      headerOf(request?.headers, 'x-forwarded-host'),
      safeUrlHost(request?.url),
    ]
      .filter((value) => typeof value === 'string' && value !== '')
      .map((value) => String(value).split(',', 1)[0].trim().toLowerCase());
    return hosts.includes(originHost);
  }

  function safeUrlHost(url) {
    try {
      return new URL(String(url)).host;
    } catch {
      return undefined;
    }
  }

  /** 上游 `CLAIM_REFUSAL_STATUS`（源:lib/persistence/owner-claim-http.ts:68-77）。 */
  const CLAIM_REFUSAL_STATUS = {
    INVALID_OWNER: 400,
    SAME_OWNER: 409,
    SOURCE_NOT_ANONYMOUS: 403,
    TARGET_ANONYMOUS: 403,
    ALREADY_CLAIMED_ELSEWHERE: 409,
    OWNER_BUSY: 503,
  };

  const BROWSER_ID_PATTERN = /^[0-9a-f]{32}$/;

  const identity = {
    /**
     * 源文件:app/api/identity/claim/route.ts:32-72（POST）。
     *
     * 上游把「匿名 owner 的工作搬到登录后的 owner」这件事实现在
     * `lib/persistence/owner-claims.ts`（`pg` 事务 + advisory lock），本包没有，
     * 所以下沉成 `ports.identity.claim(principal)`：
     *
     * ```js
     * ports.identity.claim({ ownerId, kind, pendingClaim })
     *   -> { ok: true, result: { status:'claimed', moved }, setCookies?: string[] }
     *    | { ok: false, refusal: 'OWNER_BUSY' | ..., message?, setCookies? }
     * ```
     *
     * 端口缺失 → 404 `PERSISTENCE_NOT_CONFIGURED`（上游 `DATABASE_URL` 未配的那条）。
     */
    async claim(request) {
      if (!isSameOriginJsonRequest(request)) {
        return errorJson(403, 'CROSS_ORIGIN_REFUSED', 'claims must be same-origin JSON requests');
      }
      const port = portOf(deps, 'identity');
      if (!port || typeof port.claim !== 'function') {
        return errorJson(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
      }
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const principal = {
          ownerId,
          kind: request?.principalKind ?? request?.kind ?? 'authenticated',
          pendingClaim: request?.pendingClaim,
          assurance: request?.assurance,
        };
        if (principal.kind === 'anonymous') {
          return errorJson(403, 'TARGET_ANONYMOUS', 'sign in before claiming anonymous work', headers);
        }
        if (!principal.pendingClaim) {
          return errorJson(
            409,
            'NO_PENDING_CLAIM',
            'this request presents no anonymous identity to claim',
            headers,
          );
        }
        const outcome = await port.claim(principal);
        for (const cookie of outcome?.setCookies ?? []) appendSetCookie(headers, cookie);
        headers.set('cache-control', 'no-store');
        if (outcome?.ok === false) {
          const code = outcome.refusal ?? 'INVALID_OWNER';
          const status = CLAIM_REFUSAL_STATUS[code] ?? 400;
          const response = errorJson(status, code, outcome.message ?? code, headers);
          if (code === 'OWNER_BUSY' && outcome.retryAfterSeconds) {
            response.headers.set('Retry-After', String(outcome.retryAfterSeconds));
          }
          return response;
        }
        return jsonResponse(outcome.result ?? { status: 'already-claimed' }, 200, headers);
      });
    },

    /**
     * 源文件:app/api/identity/legacy-import-binding/route.ts:43-85（POST）。
     *
     * 端口：`ports.identity.bindLegacyImport(ownerId, browserId) -> boolean`。
     * 端口缺失 → 404 `PERSISTENCE_NOT_CONFIGURED`（上游 `DATABASE_URL` 未配）。
     */
    async legacyBinding(body, request) {
      if (!isSameOriginJsonRequest(request)) {
        return errorJson(403, 'CROSS_ORIGIN_REFUSED', 'bindings must be same-origin JSON requests');
      }
      if (body === undefined) {
        return errorJson(400, 'INVALID_REQUEST', 'request body must be JSON');
      }
      const browserId = body === null ? undefined : body.browserId;
      if (typeof browserId !== 'string' || !BROWSER_ID_PATTERN.test(browserId)) {
        return errorJson(400, 'INVALID_REQUEST', 'browserId must be 32 lowercase hex characters');
      }
      const port = portOf(deps, 'identity');
      if (!port || typeof port.bindLegacyImport !== 'function') {
        return errorJson(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
      }
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        headers.set('cache-control', 'private, no-store');
        if (request?.assurance === 'minted') {
          return errorJson(
            409,
            'OWNER_NOT_ESTABLISHED',
            'the owner was created by this request; bind once the browser presents it',
            headers,
          );
        }
        const bound = await port.bindLegacyImport(ownerId, browserId);
        return jsonResponse({ bound: Boolean(bound) }, 200, headers);
      });
    },
  };

  // ── service.folders（folders/*） ───────────────────────────────────────

  const folders = {
    /** 源文件:app/api/folders/route.ts:54-71（GET）。 */
    async list(request) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const store = folderStore(vault(), ownerId);
          const rows = await store.listFolders();
          return jsonResponse(
            { folders: rows.map((folder) => folderResponse(folder, ownerId)) },
            200,
            headers,
          );
        } catch (error) {
          log.error?.(`[Folders] Failed to list [owner=${ownerId}]`, error?.message ?? error);
          return errorJson(500, 'FOLDER_LIST_FAILED', 'Failed to list folders', headers);
        }
      });
    },

    /**
     * 源文件:app/api/folders/route.ts:78-121（POST）。
     *
     * 校验在 owner 解析之前（上游注释：畸形 body 不该给一个不会继续的请求
     * 铸出新 owner 分区）。`body === undefined` = 上游 `req.json()` 抛。
     */
    async create(body, request) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      if (body === undefined) {
        return errorJson(400, 'INVALID_BODY', 'request body must be JSON');
      }
      const name = body === null ? undefined : body.name;
      if (typeof name !== 'string') {
        return errorJson(400, 'FOLDER_NAME_INVALID', 'name must be a string');
      }
      const trimmed = name.trim();
      const check = validateFolderName(trimmed);
      if (!check.ok) {
        return errorJson(
          400,
          check.kind === 'empty' ? 'FOLDER_NAME_EMPTY' : 'FOLDER_NAME_TOO_LONG',
          check.kind === 'empty' ? 'folder name must not be empty' : 'folder name is too long',
        );
      }

      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const store = folderStore(vault(), ownerId);
          const { folder } = await createFolderForOwner(store, trimmed, { reuseExisting: false });
          return jsonResponse({ folder: folderResponse(folder, ownerId) }, 200, headers);
        } catch (error) {
          const nameError = folderNameErrorResponse(error, headers);
          if (nameError) return nameError;
          log.error?.(`[Folders] Failed to create [owner=${ownerId}]`, error?.message ?? error);
          return errorJson(500, 'FOLDER_CREATE_FAILED', 'Failed to create folder', headers);
        }
      });
    },

    /**
     * **上游没有 GET `/api/folders/[id]`**（`route.ts` 只有 PATCH / DELETE）。
     * 批表第 6 条写了 GET，本包不编一个上游不存在的读接口，恒抛。
     */
    async get(id) {
      void id;
      throw notImplemented(
        'zhiyunClassroomStudio.folders.get',
        'app/api/folders/[id]/route.ts（上游只有 PATCH / DELETE，没有 GET）',
      );
    },

    /** 源文件:app/api/folders/[id]/route.ts:41-101（PATCH，改名）。 */
    async update(id, body, request) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      if (body === undefined) {
        return errorJson(400, 'INVALID_BODY', 'request body must be JSON');
      }
      const name = body === null ? undefined : body.name;
      if (typeof name !== 'string') {
        return errorJson(400, 'FOLDER_NAME_INVALID', 'name must be a string');
      }
      const trimmed = name.trim();
      const check = validateFolderName(trimmed);
      if (!check.ok) {
        return errorJson(
          400,
          check.kind === 'empty' ? 'FOLDER_NAME_EMPTY' : 'FOLDER_NAME_TOO_LONG',
          check.kind === 'empty' ? 'folder name must not be empty' : 'folder name is too long',
        );
      }

      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const store = folderStore(vault(), ownerId);
          const existing = await store.listFolders();
          const clash = existing.some(
            (folder) => folder.id !== id && folder.name.toLowerCase() === trimmed.toLowerCase(),
          );
          if (clash) {
            return errorJson(
              409,
              'FOLDER_NAME_DUPLICATE',
              'a folder with this name already exists',
              headers,
            );
          }
          const updated = await store.renameFolder(id, trimmed);
          if (!updated) return errorJson(404, 'FOLDER_NOT_FOUND', 'folder not found', headers);
          return jsonResponse({ folder: folderResponse(updated, ownerId) }, 200, headers);
        } catch (error) {
          const nameError = folderNameErrorResponse(error, headers);
          if (nameError) return nameError;
          log.error?.(
            `[Folders] Failed to rename [owner=${ownerId}, id=${id}]`,
            error?.message ?? error,
          );
          return errorJson(500, 'FOLDER_RENAME_FAILED', 'Failed to rename folder', headers);
        }
      });
    },

    /** 源文件:app/api/folders/[id]/route.ts:104-126（DELETE，`?mode=ungroup|remove`）。 */
    async remove(id, request) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      const modeParam = searchParam(request, 'mode');
      const mode = modeParam === 'remove' ? 'remove' : 'ungroup';

      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const store = folderStore(vault(), ownerId);
          const result = await store.deleteFolder(id, mode);
          if (!result) return errorJson(404, 'FOLDER_NOT_FOUND', 'folder not found', headers);
          return jsonResponse({ ok: true, removedStageIds: result.removedStageIds }, 200, headers);
        } catch (error) {
          log.error?.(
            `[Folders] Failed to delete [owner=${ownerId}, id=${id}]`,
            error?.message ?? error,
          );
          return errorJson(500, 'FOLDER_DELETE_FAILED', 'Failed to delete folder', headers);
        }
      });
    },

    members: {
      /**
       * **上游 `folders/members` 只有 POST**（一个 handler 同时表达「归入」与
       * 「取消归属」）。批表第 7 条写了 GET / POST / DELETE，`list` 没有可搬的
       * body → 恒抛。
       */
      async list() {
        throw notImplemented(
          'zhiyunClassroomStudio.folders.members.list',
          'app/api/folders/members/route.ts（上游只有 POST，没有列表接口）',
        );
      },

      /** 源文件:app/api/folders/members/route.ts:36-76（POST）。 */
      async add(body, request) {
        if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
        if (body === undefined) {
          return errorJson(400, 'INVALID_BODY', 'request body must be JSON');
        }
        const { stageId, folderId } = body ?? {};
        if (typeof stageId !== 'string' || stageId.length === 0) {
          return errorJson(400, 'MISSING_STAGE_ID', 'stageId must be a non-empty string');
        }
        if (folderId !== null && (typeof folderId !== 'string' || folderId.length === 0)) {
          return errorJson(400, 'INVALID_FOLDER_ID', 'folderId must be a non-empty string or null');
        }

        return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
          try {
            const store = folderStore(vault(), ownerId);
            const applied = await store.setStageFolder(stageId, folderId);
            if (!applied) return errorJson(404, 'FOLDER_NOT_FOUND', 'folder not found', headers);
            return jsonResponse({ ok: true }, 200, headers);
          } catch (error) {
            log.error?.(
              `[Folders] Failed to set membership [owner=${ownerId}, stage=${stageId}]`,
              error?.message ?? error,
            );
            return errorJson(
              500,
              'FOLDER_MEMBER_FAILED',
              'Failed to set folder membership',
              headers,
            );
          }
        });
      },

      /**
       * 「取消归属」在上游是**同一个 POST** 的 `folderId: null` 分支
       * （`members/route.ts:4-9` 的注释就写了：`folderId = null → unfile`）。
       * 所以这里不是新接口，是把那条已存在的分支给一个名字。
       */
      async remove(body, request) {
        const stageId = body === null || body === undefined ? undefined : body.stageId;
        return folders.members.add({ stageId, folderId: null }, request);
      },
    },
  };

  /** 上游 `createFolderForOwner`（源:lib/server/folder-persistence.ts:59-91）。 */
  async function createFolderForOwner(store, name, options) {
    const current = await store.listFolders();
    const existing = current.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (options.reuseExisting) return { folder: existing, reused: true };
      throw new FolderNameError('A folder with this name already exists', 'duplicate');
    }
    if (current.length >= FOLDER_COUNT_LIMIT) {
      throw new FolderNameError('Folder count limit reached', 'limit');
    }
    const created = await store.createFolder(createFolderId(), name);
    if (created.reused) {
      if (options.reuseExisting) return { folder: created.folder, reused: true };
      throw new FolderNameError('A folder with this name already exists', 'duplicate');
    }
    const persisted = (await store.listFolders()).find((folder) => folder.id === created.folder.id);
    if (!persisted) {
      throw new Error(`created folder ${JSON.stringify(created.folder.id)} is not readable in its owner scope`);
    }
    return { folder: persisted, reused: false };
  }

  // ── service.modelConfig（model-config/*） ──────────────────────────────

  const idSchema = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128;
  const assignmentOk = (value) =>
    (typeof value === 'string' && value.length >= 1) ||
    value === null ||
    (typeof value === 'object' && value !== null && !Array.isArray(value));

  /** 上游 `bodySchema.safeParse`（源:model-config/route.ts:52-80）的手写等价物。 */
  function parseModelConfigBody(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const keys = Object.keys(raw);
    if (keys.some((key) => key !== 'revision' && key !== 'change')) return null;
    const { revision, change } = raw;
    if (!(revision === null || (Number.isInteger(revision) && revision >= 0))) return null;
    if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
    const changeKeys = Object.keys(change);
    const noExtra = (allowed) => changeKeys.every((key) => allowed.includes(key));
    if (change.kind === 'slots') {
      if (!noExtra(['kind', 'set', 'clear'])) return null;
      if (change.set !== undefined) {
        if (!change.set || typeof change.set !== 'object' || Array.isArray(change.set)) return null;
        for (const [key, value] of Object.entries(change.set)) {
          if (!idSchema(key) || !assignmentOk(value)) return null;
        }
      }
      if (change.clear !== undefined) {
        if (!Array.isArray(change.clear) || !change.clear.every(idSchema)) return null;
      }
      return { revision, change };
    }
    if (change.kind === 'provider') {
      if (!noExtra(['kind', 'id', 'preset', 'apiKey', 'baseUrl', 'models'])) return null;
      if (!idSchema(change.id) || !idSchema(change.preset)) return null;
      if (change.apiKey !== undefined && typeof change.apiKey !== 'string') return null;
      if (
        change.baseUrl !== undefined &&
        change.baseUrl !== null &&
        !(typeof change.baseUrl === 'string' && change.baseUrl.length >= 1)
      ) {
        return null;
      }
      if (change.models !== undefined && change.models !== null) {
        if (!Array.isArray(change.models)) return null;
        if (!change.models.every((model) => typeof model === 'string' && model.length >= 1)) {
          return null;
        }
      }
      return { revision, change };
    }
    if (change.kind === 'remove-provider') {
      if (!noExtra(['kind', 'id'])) return null;
      if (!idSchema(change.id)) return null;
      return { revision, change };
    }
    return null;
  }

  /** 上游 `proposalSchema.safeParse`（源:model-config/import/route.ts:30-38）。 */
  function parseProposal(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const keys = Object.keys(raw);
    if (keys.some((key) => key !== 'providers' && key !== 'slots')) return null;
    if (raw.providers !== undefined) {
      if (!raw.providers || typeof raw.providers !== 'object' || Array.isArray(raw.providers)) {
        return null;
      }
      for (const key of Object.keys(raw.providers)) {
        if (!idSchema(key) || key.length > 64) return null;
      }
    }
    if (raw.slots !== undefined) {
      if (!raw.slots || typeof raw.slots !== 'object' || Array.isArray(raw.slots)) return null;
      for (const key of Object.keys(raw.slots)) {
        if (!idSchema(key)) return null;
      }
    }
    return raw;
  }

  const modelConfigPort = () => {
    const port = portOf(deps, 'modelConfig');
    return port && typeof port === 'object' ? port : null;
  };

  const modelConfig = {
    /**
     * 源文件:app/api/model-config/route.ts:44-50（GET）。
     *
     * 上游是 owner 分区的工作区设置表 + deployment 层的合并视图（1002 行的
     * `lib/server/model-config/settings.ts`），本包没有那一层，所以下沉成
     * `ports.modelConfig.view(ownerId) -> ModelSettingsView`；缺端口走上游
     * 「没有持久层」的纯文本 404（源:45）。
     */
    async get(request) {
      const port = modelConfigPort();
      if (!port || typeof port.view !== 'function') return plainResponse(404, NOT_FOUND);
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const view = await port.view(ownerId);
        return jsonResponse(view, 200, headers);
      });
    },

    /**
     * 源文件:app/api/model-config/route.ts:82-141（PUT）。
     *
     * 入参校验（zod `.strict()` 的三条 change）逐条照搬；写侧下沉成
     * `ports.modelConfig.apply(ownerId, { revision, change }) -> { view }`。
     */
    async put(body, request) {
      const port = modelConfigPort();
      if (!port || typeof port.apply !== 'function') return plainResponse(404, NOT_FOUND);
      if (body === undefined) {
        return jsonResponse(
          { error: { code: 'INVALID_REQUEST', message: 'Body must be JSON' } },
          400,
        );
      }
      const parsed = parseModelConfigBody(body);
      if (!parsed) {
        return jsonResponse(
          { error: { code: 'INVALID_REQUEST', message: 'Expected { revision, change }' } },
          400,
        );
      }
      const { revision, change } = parsed;

      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const result = await port.apply(ownerId, { revision, change });
          if (result?.conflict) {
            return errorJson(409, 'CONFLICT', 'The settings changed; reload them', headers);
          }
          if (result?.invalid) {
            return errorJson(400, 'INVALID_SETTINGS', result.message ?? 'Invalid settings', headers);
          }
          if (result?.errorCode) {
            return errorJson(
              result.errorCode === 'SLOT_LOCKED' ? 409 : 400,
              result.errorCode,
              result.message ?? result.errorCode,
              headers,
            );
          }
          return jsonResponse(result?.view ?? null, 200, headers);
        } catch (error) {
          if (error?.code === 'CONFLICT') {
            return errorJson(409, 'CONFLICT', 'The settings changed; reload them', headers);
          }
          if (error?.code === 'SLOT_LOCKED') {
            return errorJson(409, 'SLOT_LOCKED', error.message ?? 'slot locked', headers);
          }
          throw error;
        }
      });
    },

    /**
     * 源文件:app/api/model-config/import/route.ts:43-98（POST）。
     *
     * 端口：`ports.modelConfig.import(ownerId, proposal) -> { imported, skipped, view }`。
     * 上游的重试（`MAX_ATTEMPTS = 3`）在端口内部完成 —— 那是事务层的性质。
     */
    async import(body, request) {
      const port = modelConfigPort();
      if (!port || typeof port.import !== 'function') return plainResponse(404, NOT_FOUND);
      const proposal = parseProposal(body);
      if (!proposal) {
        return jsonResponse(
          { error: { code: 'INVALID_REQUEST', message: 'Expected { providers?, slots? }' } },
          400,
        );
      }
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        try {
          const result = await port.import(ownerId, proposal);
          return jsonResponse(
            { imported: result?.imported ?? [], skipped: result?.skipped ?? [], view: result?.view ?? null },
            200,
            headers,
          );
        } catch (error) {
          if (error?.code === 'CONFLICT') {
            return jsonResponse(
              { error: { code: 'CONFLICT', message: 'The settings kept changing; try again' } },
              409,
              headers,
            );
          }
          throw error;
        }
      });
    },
  };

  // ── service.providers（provider/probe-models + verify-* + azure-voices） ─

  /** 上游 `NON_CHAT_PATTERN`（源:provider/probe-models/route.ts:17）。 */
  const NON_CHAT_PATTERN = /(tts|asr|whisper|embedding|rerank|mineru|image|video|voxcpm|moderation)/i;

  const providersPort = () => {
    const port = portOf(deps, 'providers');
    return port && typeof port === 'object' ? port : null;
  };

  /** 上游 `savedProviderRef`（源:lib/server/model-config/saved-provider.ts）。 */
  function savedProviderRef(provider, model) {
    if (typeof provider === 'string' && provider.trim()) return provider.trim();
    if (provider && typeof provider === 'object') {
      if (typeof provider.id === 'string' && provider.id.trim()) {
        return typeof model === 'string' && model.trim() ? `${provider.id}:${model.trim()}` : provider.id.trim();
      }
    }
    return undefined;
  }

  const providerMethods = {
    /**
     * 源文件:app/api/provider/probe-models/route.ts:26-109（POST）。
     *
     * 上游的 `provider`（按已保存 provider 的 id 测）要读工作区设置表，本包走
     * `ports.providers.savedChatEndpoint(ref) -> { baseUrl, apiKey }`；缺端口时
     * 抛 `E_NOT_IMPLEMENTED`（源:39-50），不发一个「猜」的请求。
     */
    async probe(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Invalid JSON body');
      }
      try {
        let { baseUrl, apiKey, modelsUrl } = body;
        const saved = body.provider;
        if (saved !== undefined) {
          const ref = savedProviderRef(saved);
          if (!ref) return fail(400, 'MISSING_REQUIRED_FIELD', 'provider is required');
          const port = providersPort();
          if (!port || typeof port.savedChatEndpoint !== 'function') {
            throw notImplemented(
              'zhiyunClassroomStudio.providers.probe',
              'app/api/provider/probe-models/route.ts:39-50（按已保存 provider 探测需要工作区设置表）',
            );
          }
          ({ baseUrl, apiKey } = await port.savedChatEndpoint(ref, request));
          modelsUrl = undefined;
        } else if (!requestProvidersAllowed()) {
          return fail(403, 'PROVIDER_DISABLED', REQUEST_PROVIDERS_REFUSED);
        }

        if (!baseUrl) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'baseUrl is required');
        }

        const baseUrlError = await validateClientBaseUrl(baseUrl);
        if (baseUrlError) return fail(400, 'INVALID_REQUEST', baseUrlError);
        if (modelsUrl) {
          const ssrfError = await validateUrlForSSRF(modelsUrl);
          if (ssrfError) return fail(400, 'INVALID_REQUEST', ssrfError);
        }

        const models = await fetchModels(baseUrl, apiKey || '', {
          modelsUrlOverride: modelsUrl,
          fetchImpl: doFetch,
        });
        const chatModels = models.filter((m) => !NON_CHAT_PATTERN.test(m.id));

        return ok({
          models: chatModels.map((m) => ({ id: m.id, ownedBy: m.ownedBy })),
          total: models.length,
          filtered: models.length - chatModels.length,
        });
      } catch (error) {
        if (error instanceof ClassroomError) throw error;
        if (error instanceof ModelFetchError) {
          if (error.status >= 300 && error.status < 400) {
            return fail(403, 'REDIRECT_NOT_ALLOWED', 'Redirects are not allowed');
          }
          if (error.status === 401 || error.status === 403) {
            return fail(401, 'INVALID_REQUEST', 'API key is invalid or expired');
          }
          if (error.status === 404) {
            return fail(404, 'INVALID_REQUEST', 'This provider does not expose a model list');
          }
          if (error.status >= 200 && error.status < 300) {
            return fail(502, 'UPSTREAM_ERROR', 'The provider returned an invalid model list');
          }
          return fail(
            502,
            'UPSTREAM_ERROR',
            `The provider rejected the model list request (HTTP ${Math.floor(error.status / 100)}xx)`,
          );
        }
        log.warn?.('Model probe failed', error?.message ?? error);
        return fail(502, 'UPSTREAM_ERROR', 'Cannot connect to the provider, please check the Base URL');
      }
    },

    /**
     * 源文件:app/api/verify-model/route.ts:19-120（POST）。
     *
     * 上游 `resolveModel` + `callLLM`（模型槽解析、provider 适配、计量）在本包里
     * 只剩「一条最小 chat completion」：`startChat` 直接打 `${baseUrl}/chat/completions`。
     * 没有 key 时走上游「解析不出模型」的 401 分支，不发假请求。
     *
     * 入参：`body = { model, apiKey?, baseUrl?, providerType?, provider? }`，
     * `request` 收 `{ headers, ownerId?, url? }`。
     */
    async verifyModel(body, request) {
      let model;
      const credentialFailure = () => fail(401, 'INVALID_REQUEST', 'Owner credential rejected');
      // 上游先解析 owner，失败 401（源:20-22）。本包用 owner 端口表达。
      let resolvedOwner;
      try {
        resolvedOwner = await ownerDeps.owner.resolve(request ?? {});
      } catch {
        resolvedOwner = { ok: false };
      }
      if (resolvedOwner?.ok === false) return credentialFailure();

      try {
        if (!body || typeof body !== 'object') {
          // 上游 `req.json()` 抛会让 helper 直接落 500；这里按「畸形 body」处理。
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Model name is required');
        }
        const { apiKey, baseUrl, providerType } = body;
        model = body.model;

        if (typeof model !== 'string' || !model.trim()) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Model name is required');
        }

        // The settings test a saved provider by its id (`provider`, with `model`
        // its model id): the server's configuration supplies key and endpoint.
        let endpoint;
        let savedRef;
        savedRef = savedProviderRef(body.provider, model);
        if (savedRef) {
          const port = providersPort();
          if (!port || typeof port.savedChatEndpoint !== 'function') {
            throw notImplemented(
              'zhiyunClassroomStudio.providers.verifyModel',
              'app/api/verify-model/route.ts:39-51（按已保存 provider 验证需要工作区设置表）',
            );
          }
          endpoint = await port.savedChatEndpoint(savedRef, request);
          model = savedRef;
        } else {
          if (!apiKey) {
            // 上游 `resolveModel` 在既没有 client key 也没有 server 兜底时抛错 →
            // 401 `INVALID_REQUEST`（源:64-72）。这里不发请求。
            return fail(401, 'INVALID_REQUEST', 'API key is required to verify this model');
          }
          if (!baseUrl) {
            return fail(400, 'MISSING_REQUIRED_FIELD', 'baseUrl is required');
          }
          const ssrfError = await validateClientBaseUrl(baseUrl);
          if (ssrfError) return fail(400, 'INVALID_REQUEST', ssrfError);
          endpoint = { baseUrl, apiKey, model, providerType };
        }

        if (!endpoint?.model) return fail(400, 'MISSING_MODEL', 'Model name is required');

        const { text } = await chatCompletion(
          {
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: endpoint.model,
            prompt: 'Say "OK" if you can hear me.',
            maxTokens: 64,
          },
          doFetch,
        );

        return ok({ message: 'Connection successful', response: text });
      } catch (error) {
        if (error instanceof ClassroomError) throw error;
        log.error?.(`Model verification failed [model="${model ?? 'unknown'}"]`, error?.message ?? error);

        const status = error instanceof LlmHttpError ? error.status : undefined;
        let errorMessage;
        if (status === 401 || status === 403) {
          errorMessage = 'API key is invalid or expired';
        } else if (status === 404) {
          errorMessage = 'Model not found or API endpoint error';
        } else if (status === 429) {
          errorMessage = 'API rate limit exceeded, please try again later';
        } else if (status !== undefined) {
          errorMessage = `API request failed (HTTP ${Math.floor(status / 100)}xx)`;
        } else {
          errorMessage = 'Cannot connect to API server, please check the Base URL';
        }
        return fail(500, 'INTERNAL_ERROR', errorMessage);
      }
    },

    /** 源文件:app/api/verify-image-provider/route.ts:43-139（POST）。 */
    async verifyImage(body, request) {
      return verifyMediaProvider('image', body, request);
    },

    /** 源文件:app/api/verify-video-provider/route.ts:43-136（POST）。 */
    async verifyVideo(body, request) {
      return verifyMediaProvider('video', body, request);
    },

    /**
     * 源文件:app/api/verify-pdf-provider/route.ts:122-247（POST）。
     *
     * AliDocMind 走 SDK 签名（`@/lib/pdf/alidocmind-client`），本包没有 →
     * `ports.providers.verifyAliDocMind({ accessKeyId, accessKeySecret, endpoint })`
     * 缺了就抛（源:187-196）。
     */
    async verifyPdf(body, request) {
      let providerId;
      try {
        if (!body || typeof body !== 'object') {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Provider ID is required');
        }
        if (body.provider !== undefined) {
          const ref = savedProviderRef(body.provider);
          if (!ref) return fail(400, 'MISSING_REQUIRED_FIELD', 'Provider ID is required');
          providerId = ref;
          return await verifySavedPdfProvider(ref, request);
        }
        if (!requestProvidersAllowed()) {
          return fail(403, 'PROVIDER_DISABLED', REQUEST_PROVIDERS_REFUSED);
        }
        providerId = body.providerId;
        const { apiKey, baseUrl, accessKeyId, accessKeySecret } = body;

        if (!providerId) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Provider ID is required');
        }

        const managed = Boolean(providerConfig.isServerConfiguredProvider?.('pdf', providerId));

        if (providerId === 'alidocmind') {
          let ak;
          let sk;
          let endpoint;
          if (managed) {
            const serverCreds = providerConfig.resolveManagedAliDocMindCredentials?.();
            if (!serverCreds) {
              return fail(500, 'INTERNAL_ERROR', 'AliDocMind is not configured on the server');
            }
            ak = serverCreds.accessKeyId;
            sk = serverCreds.accessKeySecret;
            endpoint = serverCreds.baseUrl;
          } else {
            ak = accessKeyId || undefined;
            sk = accessKeySecret || undefined;
            endpoint = baseUrl || undefined;
            if (!ak || !sk) {
              return fail(
                400,
                'MISSING_REQUIRED_FIELD',
                'AccessKey ID and AccessKey Secret are required for AliDocMind',
              );
            }
            if (endpoint && !/^https:\/\/docmind-api\.[a-z0-9-]+\.aliyuncs\.com$/i.test(String(endpoint))) {
              // 上游 `resolveSafeClientAliDocMindEndpoint`：只允许官方 DocMind 主机。
              return fail(
                403,
                'INVALID_URL',
                'AliDocMind endpoint must be an official docmind-api host',
              );
            }
          }
          return await verifyAliDocMind({ accessKeyId: ak, accessKeySecret: sk, endpoint });
        }

        if (providerId === 'mineru-cloud') {
          const clientCloudBase = managed ? undefined : baseUrl || undefined;
          if (clientCloudBase) {
            const ssrfError = await validateClientBaseUrl(clientCloudBase);
            if (ssrfError) return fail(403, 'INVALID_URL', ssrfError);
          }
          const resolvedApiKey = providerConfig.resolvePDFApiKey?.(providerId, managed ? undefined : apiKey);
          if (!resolvedApiKey) {
            return fail(400, 'MISSING_REQUIRED_FIELD', 'API Key is required for MinerU Cloud');
          }
          const cloudBase = normalizeBaseUrl(
            providerConfig.resolvePDFBaseUrl?.(providerId, clientCloudBase) || MINERU_CLOUD_DEFAULT_BASE,
          );
          return await probeMinerUCloud(cloudBase, resolvedApiKey, managed);
        }

        // Self-hosted providers: verify by connecting to the base URL
        const clientBaseUrl = managed ? undefined : baseUrl || undefined;
        if (clientBaseUrl) {
          const ssrfError = await validateClientBaseUrl(clientBaseUrl);
          if (ssrfError) return fail(403, 'INVALID_URL', ssrfError);
        }
        const resolvedBaseUrl = providerConfig.resolvePDFBaseUrl?.(providerId, clientBaseUrl);
        if (!resolvedBaseUrl) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Base URL is required');
        }
        const resolvedApiKey = providerConfig.resolvePDFApiKey?.(providerId, managed ? undefined : apiKey);
        return await probeSelfHosted(resolvedBaseUrl, resolvedApiKey, managed);
      } catch (error) {
        if (error instanceof ClassroomError) throw error;
        log.error?.(
          `PDF provider verification failed [provider=${providerId ?? 'unknown'}]`,
          error?.message ?? error,
        );
        if (isRejectedRedirectError(error)) {
          return fail(403, 'REDIRECT_NOT_ALLOWED', 'Redirects are not allowed');
        }
        return fail(
          500,
          'INTERNAL_ERROR',
          'Cannot connect to server, please check the Base URL',
        );
      }
    },

    /**
     * 源文件:app/api/azure-voices/route.ts:25-87（**POST**，批表写的是 GET）。
     *
     * 上游唯一形态是 POST `{ apiKey, baseUrl }`；GET 版本不存在，所以本方法按
     * POST 搬，并在没有 key 时走上游的 400 `MISSING_API_KEY` 分支。
     */
    async azureVoices(body) {
      let baseUrl;
      if (!requestProvidersAllowed()) {
        return fail(403, 'PROVIDER_DISABLED', REQUEST_PROVIDERS_REFUSED);
      }
      try {
        if (!body || typeof body !== 'object') {
          return fail(400, 'MISSING_API_KEY', 'API Key is required');
        }
        const apiKey = body.apiKey;
        baseUrl = body.baseUrl;

        if (!apiKey) {
          return fail(400, 'MISSING_API_KEY', 'API Key is required');
        }
        if (!baseUrl) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'Base URL is required');
        }
        const ssrfError = await validateClientBaseUrl(baseUrl);
        if (ssrfError) return fail(403, 'INVALID_URL', ssrfError);

        const response = await providerFetch(
          `${baseUrl}/cognitiveservices/voices/list`,
          {
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': apiKey },
            signal: timeoutSignal(20_000),
          },
          { allowLocalNetworks: undefined, rejectRedirects: true, fetch: doFetch },
        );

        if (!response.ok) {
          await response.body?.cancel?.().catch(() => undefined);
          log.warn?.(`Azure voices request rejected [status=${response.status}]`);
          if (response.status === 401 || response.status === 403) {
            return fail(502, 'UPSTREAM_ERROR', 'Authentication failed, please check the API Key');
          }
          return fail(502, 'UPSTREAM_ERROR', 'Failed to fetch voices from Azure');
        }

        const voices = await response.json().catch(() => undefined);
        if (!Array.isArray(voices)) {
          log.warn?.('Azure voices response was not a voice list');
          return fail(502, 'UPSTREAM_ERROR', 'Failed to fetch voices from Azure');
        }
        return ok({ voices });
      } catch (error) {
        log.error?.(
          `Azure voices fetch failed [baseUrl="${baseUrl ?? 'unknown'}"]`,
          error?.message ?? error,
        );
        return fail(500, 'INTERNAL_ERROR', 'Failed to fetch voices from Azure');
      }
    },
  };

  /** 上游 `probeMinerUCloud`（源:verify-pdf-provider/route.ts:49-66）。 */
  async function probeMinerUCloud(cloudBase, apiKey, managed) {
    const response = await providerFetch(
      `${cloudBase.replace(/\/+$/, '')}/extract-results/batch/test-connection`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: timeoutSignal(10_000),
      },
      { allowLocalNetworks: managed ? true : undefined, rejectRedirects: true, fetch: doFetch },
    );
    await response.body?.cancel?.().catch(() => undefined);
    if (response.status === 401 || response.status === 403) {
      log.warn?.(`MinerU Cloud probe rejected credentials [status=${response.status}]`);
      return fail(500, 'INTERNAL_ERROR', 'Authentication failed, please check the API Key');
    }
    return ok({ message: 'Connection successful' });
  }

  /** 上游 `probeSelfHosted`（源:verify-pdf-provider/route.ts:69-80）。 */
  async function probeSelfHosted(baseUrl, apiKey, managed) {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await providerFetch(
      baseUrl,
      { headers, signal: timeoutSignal(10_000) },
      { allowLocalNetworks: managed ? true : undefined, rejectRedirects: true, fetch: doFetch },
    );
    await response.body?.cancel?.().catch(() => undefined);
    return ok({ message: 'Connection successful' });
  }

  async function verifyAliDocMind(credentials) {
    const port = providersPort();
    if (!port || typeof port.verifyAliDocMind !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.providers.verifyPdf',
        'app/api/verify-pdf-provider/route.ts:187-196（AliDocMind 走 SDK 签名，需要端口）',
      );
    }
    const result = await port.verifyAliDocMind(credentials);
    if (!result?.ok) {
      return fail(400, 'INVALID_CREDENTIALS', `Authentication failed: ${result?.error ?? 'unknown'}`);
    }
    return ok({ message: 'Connection successful' });
  }

  /** 上游 `verifySavedProvider` 的 PDF 版（源:verify-pdf-provider/route.ts:86-120）。 */
  async function verifySavedPdfProvider(ref, request) {
    const port = providersPort();
    if (!port || typeof port.savedMediaConnection !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.providers.verifyPdf',
        'app/api/verify-pdf-provider/route.ts:86-120（按已保存 provider 验证需要工作区设置表）',
      );
    }
    const connection = await port.savedMediaConnection('document', ref, request);
    const { providerId, apiKey, baseUrl, credentials, managed } = connection ?? {};
    if (providerId === 'alidocmind') {
      if (!credentials?.accessKeyId || !credentials.accessKeySecret) {
        return fail(400, 'MISSING_REQUIRED_FIELD', 'AliDocMind has no key pair configured');
      }
      return verifyAliDocMind({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        endpoint: baseUrl,
      });
    }
    if (providerId === 'mineru-cloud') {
      if (!apiKey) {
        return fail(400, 'MISSING_REQUIRED_FIELD', 'API Key is required for MinerU Cloud');
      }
      return probeMinerUCloud(baseUrl || MINERU_CLOUD_DEFAULT_BASE, apiKey, managed);
    }
    const endpoint = baseUrl || PDF_PROVIDER_BASE_URLS[providerId];
    if (!endpoint) return fail(400, 'MISSING_REQUIRED_FIELD', 'Base URL is required');
    return probeSelfHosted(endpoint, apiKey, managed);
  }

  /** `verify-image-provider` / `verify-video-provider` 的共用 body（两条 route 同构）。 */
  async function verifyMediaProvider(kind, body, request) {
    const isImage = kind === 'image';
    const registry = isImage ? IMAGE_PROVIDERS : VIDEO_PROVIDERS;
    const names = isImage ? IMAGE_PROVIDER_NAMES : VIDEO_PROVIDER_NAMES;
    const label = isImage ? 'image' : 'video';
    const headerProvider = isImage ? 'x-image-provider' : 'x-video-provider';
    const headerModel = isImage ? 'x-image-model' : 'x-video-model';
    const resolveServerProviderId = isImage
      ? providerConfig.resolveServerImageProviderId
      : providerConfig.resolveServerVideoProviderId;
    const resolveApiKey = isImage ? providerConfig.resolveImageApiKey : providerConfig.resolveVideoApiKey;
    const resolveBaseUrl = isImage
      ? providerConfig.resolveImageBaseUrl
      : providerConfig.resolveVideoBaseUrl;
    const resolveModel = isImage ? providerConfig.resolveImageModel : providerConfig.resolveVideoModel;

    try {
      if (body && typeof body === 'object' && body.provider !== undefined) {
        const ref = savedProviderRef(body.provider, body.model);
        if (!ref) return fail(400, 'MISSING_PROVIDER', `No ${label} provider named`);
        const port = providersPort();
        if (!port || typeof port.savedMediaConnection !== 'function') {
          throw notImplemented(
            `zhiyunClassroomStudio.providers.verify${isImage ? 'Image' : 'Video'}`,
            `app/api/verify-${label}-provider/route.ts:50-71（按已保存 provider 验证需要工作区设置表）`,
          );
        }
        const connection = await port.savedMediaConnection(kind, ref, request);
        const providerId = connection?.providerId;
        const config = registry[providerId];
        const result = await probeMediaProvider({
          providerName: names[providerId] ?? providerId ?? label,
          providerId,
          baseUrl: connection?.baseUrl ?? config?.defaultBaseUrl,
          apiKey: connection?.apiKey ?? '',
          managed: Boolean(connection?.managed),
          doFetch,
        });
        if (!result.success) return fail(500, 'UPSTREAM_ERROR', result.message);
        return ok({ message: result.message });
      }

      if (!requestProvidersAllowed()) {
        return fail(403, 'PROVIDER_DISABLED', REQUEST_PROVIDERS_REFUSED);
      }

      const providerId = String(headerOf(request?.headers, headerProvider) ?? '').trim() ||
        (typeof resolveServerProviderId === 'function' ? resolveServerProviderId() : '');
      if (!providerId) {
        return fail(400, 'MISSING_PROVIDER', `No ${label} provider configured`);
      }
      if (providerConfig.isServerProviderDisabled?.(label, providerId)) {
        return fail(403, 'PROVIDER_DISABLED', `This ${label} provider is disabled by the server`);
      }
      const clientModel = String(headerOf(request?.headers, headerModel) ?? '').trim() || undefined;
      const managed = Boolean(providerConfig.isServerConfiguredProvider?.(label, providerId));
      const clientApiKey = managed
        ? undefined
        : String(headerOf(request?.headers, 'x-api-key') ?? '').trim() || undefined;
      const clientBaseUrl = managed
        ? undefined
        : String(headerOf(request?.headers, 'x-base-url') ?? '').trim() || undefined;

      if (clientBaseUrl) {
        const ssrfError = await validateClientBaseUrl(clientBaseUrl);
        if (ssrfError) return fail(403, 'INVALID_URL', ssrfError);
      }

      const apiKey = typeof resolveApiKey === 'function' ? resolveApiKey(providerId, clientApiKey) : clientApiKey ?? '';
      const baseUrl = typeof resolveBaseUrl === 'function' ? resolveBaseUrl(providerId, clientBaseUrl) : clientBaseUrl;

      const config = registry[providerId];
      if (isImage) {
        if (config?.requiresApiKey && !apiKey) {
          return fail(400, 'MISSING_API_KEY', 'No API key configured');
        }
      } else if (!apiKey) {
        return fail(400, 'MISSING_API_KEY', 'No API key configured');
      }

      const model = typeof resolveModel === 'function' ? resolveModel(providerId, clientModel) : clientModel;
      if (!model && config?.hasModels) {
        if (isImage) {
          return fail(400, 'MISSING_MODEL', `No model configured for image provider: ${providerId}`);
        }
        return fail(400, 'MISSING_MODEL', `No model configured for ${label} provider: ${providerId}`);
      }

      const result = await probeMediaProvider({
        providerName: names[providerId] ?? providerId,
        providerId,
        baseUrl: baseUrl || config?.defaultBaseUrl,
        apiKey,
        managed,
        doFetch,
      });

      if (!result.success) return fail(500, 'UPSTREAM_ERROR', result.message);
      return ok({ message: result.message });
    } catch (error) {
      if (error instanceof ClassroomError) throw error;
      log.error?.(`${isImage ? 'Image' : 'Video'} provider verification failed`, error?.message ?? error);
      return fail(500, 'INTERNAL_ERROR', 'Connectivity test error');
    }
  }

  // ── service.usage（usage GET） ─────────────────────────────────────────

  const usage = {
    /**
     * 源文件:app/api/usage/route.ts:71-116（GET）。
     *
     * 上游读 `cwd/data/usage/*.jsonl`；本包读 `dataDir/usage/`（`dataDir` 为
     * null 时退回上游的 `cwd/data/usage` —— 即「没有数据目录」时上游那条路径）。
     * 目录不存在 → `readUsageRecords` 返回 `[]`（上游同分支）。
     */
    async get(q) {
      try {
        const monthsParam = searchParam(q, 'months');
        const months = monthsParam ? monthsParam.split(',').map((s) => s.trim()) : undefined;

        const records = await readUsageRecords({
          baseDir: dataDir ? join(dataDir, 'usage') : undefined,
          months,
        });

        const byModel = new Map();
        const byDay = new Map();
        const byKind = new Map();
        let totalRequests = 0;
        let totalLlmTokens = 0;

        for (const r of records) {
          totalRequests += 1;
          if (r.kind === 'llm') {
            totalLlmTokens += r.inputTokens + r.outputTokens;
          }

          const mk = r.modelString || r.modelId;
          if (!byModel.has(mk)) byModel.set(mk, emptyBucket(mk, r.kind, usageUnitOf(r)));
          addToBucket(byModel.get(mk), r);

          const dk = usageDayKey(r.createdAt);
          if (!byDay.has(dk)) byDay.set(dk, emptyBucket(dk, 'llm', 'token'));
          addToBucket(byDay.get(dk), r);

          if (!byKind.has(r.kind)) byKind.set(r.kind, emptyBucket(r.kind, r.kind, usageUnitOf(r)));
          addToBucket(byKind.get(r.kind), r);
        }

        return ok({
          totals: { requests: totalRequests, llmTokens: totalLlmTokens },
          byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
          byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
          byKind: [...byKind.values()],
        });
      } catch (error) {
        log.error?.('Usage aggregation failed', error?.message ?? error);
        return fail(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Failed to read usage');
      }
    },
  };

  // ── service.persistence（persistence/[...path]） ──────────────────────

  const persistenceRoot = () => (dataDir ? join(dataDir, 'persistence') : null);

  const persistence = {
    /**
     * 源文件:app/api/persistence/[...path]/route.ts:486-593（GET 走同一条
     * `handlePersistenceRequest`）。
     *
     * 上游是「通用持久层网关」，把路径交给 `@openmaic/storage` 的 HTTP
     * handler（documents / assets / runtime 三套契约，`pg` 后端）。本包把它落成
     * `dataDir/persistence/` 下的 **JSON 文件树**：一个路径一份文档。
     * `dataDir` 为 null 时走上游「没有持久层」分支
     * （`{ error: { code:'PERSISTENCE_NOT_CONFIGURED' } }`，404，源:530-532）。
     */
    async get(path) {
      const root = persistenceRoot();
      if (!root) {
        return errorJson(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
      }
      const resolved = resolvePersistencePath(root, path);
      if (!resolved.ok) return errorJson(400, 'INVALID_PATH', resolved.message);
      try {
        const text = await readFile(resolved.file, 'utf8');
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return errorJson(500, 'PERSISTENCE_READ_FAILED', 'stored value is not valid JSON');
        }
        return jsonResponse(body, 200);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          return errorJson(404, 'NOT_FOUND', 'no value stored at this path');
        }
        log.error?.(`persistence GET failed [path=${resolved.segments.join('/')}]`, error?.message ?? error);
        return errorJson(500, 'PERSISTENCE_READ_FAILED', 'persistence read failed');
      }
    },

    /**
     * 源文件:app/api/persistence/[...path]/route.ts:486-593（PUT）。
     *
     * 写入是**原子**的（临时文件 + rename），因为客户端把这份文件树当 KV 用，
     * 半截 JSON 比没有更糟。返回写入后的文档（上游由 storage handler 决定
     * 状态码与 body，本包固定 200 + 原样文档，已记在 ROUTES.md）。
     */
    async put(path, body) {
      const root = persistenceRoot();
      if (!root) {
        return errorJson(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
      }
      const resolved = resolvePersistencePath(root, path);
      if (!resolved.ok) return errorJson(400, 'INVALID_PATH', resolved.message);
      if (body === undefined) {
        return errorJson(400, 'VALIDATION_FAILED', 'request body must be JSON');
      }
      try {
        await mkdir(dirname(resolved.file), { recursive: true });
        const temp = `${resolved.file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(body), 'utf8');
        await rename(temp, resolved.file);
        return jsonResponse(body, 200);
      } catch (error) {
        log.error?.(`persistence PUT failed [path=${resolved.segments.join('/')}]`, error?.message ?? error);
        return errorJson(500, 'PERSISTENCE_WRITE_FAILED', 'persistence write failed');
      }
    },

    /** 源文件:app/api/persistence/[...path]/route.ts:486-593（DELETE）。 */
    async remove(path) {
      const root = persistenceRoot();
      if (!root) {
        return errorJson(404, 'PERSISTENCE_NOT_CONFIGURED', 'server persistence not configured');
      }
      const resolved = resolvePersistencePath(root, path);
      if (!resolved.ok) return errorJson(400, 'INVALID_PATH', resolved.message);
      try {
        await stat(resolved.file);
      } catch {
        return errorJson(404, 'NOT_FOUND', 'no value stored at this path');
      }
      try {
        await rm(resolved.file, { force: true });
        return jsonResponse({ ok: true }, 200);
      } catch (error) {
        log.error?.(
          `persistence DELETE failed [path=${resolved.segments.join('/')}]`,
          error?.message ?? error,
        );
        return errorJson(500, 'PERSISTENCE_WRITE_FAILED', 'persistence write failed');
      }
    },
  };

  // ── service.video（export-video/*） ───────────────────────────────────

  /** 上游 `MAX_UPLOAD_BYTES`（源:export-video/render/route.ts:18）。 */
  const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
  const SUBMIT_TIMEOUT_MS = 300_000;

  const exportPort = () => {
    const port = portOf(deps, 'export');
    return port && typeof port === 'object' ? port : null;
  };

  const video = {
    /**
     * 源文件:app/api/export-video/capability/route.ts:13-16（GET）。
     *
     * 上游 `getRenderServiceCapability()`（源:lib/server/render-service.ts:98-115）：
     * 未配 `RENDER_SERVICE_URL` → `{ enabled:false }`；配了但 `/health` 不通、
     * 或没带 owner-bound 标记 → 也是 `{ enabled:false }`（不抛）。
     */
    async capability() {
      const resolved = resolveRenderServiceUrl(env);
      if ('error' in resolved) return ok({ enabled: false });
      try {
        const response = await doFetch(`${resolved.url}/health`, {
          method: 'GET',
          signal: timeoutSignal(3000),
        });
        if (!response.ok || !isRenderOwnerBoundResponse(response)) return ok({ enabled: false });
        const body = await response.json().catch(() => null);
        return ok({
          enabled: true,
          ...(typeof body?.accepting === 'boolean' ? { accepting: body.accepting } : {}),
        });
      } catch (error) {
        log.info?.('Render service health check failed', error?.message ?? error);
        return ok({ enabled: false });
      }
    },

    /**
     * 源文件:app/api/export-video/render/route.ts:29-116（POST）。
     *
     * 入参：`{ buffer | body, contentType, contentLength?, ownerId? }`。上游把
     * multipart 的原始字节**原样**转发（不 `formData()`），这里同样不解析，
     * 只按字节数判 413（上游的 cap 是流式的，这里是全长判断，语义等价）。
     *
     * 端口优先：`ports.export.video(payload, ctx) -> { httpStatus, body }`；
     * 缺端口时用 `RENDER_SERVICE_URL` + `deps.fetch` 走真实 HTTP（与上游同路径）。
     */
    async render(body, request) {
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const port = exportPort();
        if (port && typeof port.video === 'function') {
          const result = await port.video({ ...body, ownerId });
          return jsonResponse(result?.body ?? result, result?.httpStatus ?? 202, headers);
        }

        const resolved = resolveRenderServiceUrl(env);
        if ('error' in resolved) {
          return fail(501, 'PROVIDER_DISABLED', 'Render service is not configured', headers);
        }

        const contentLength = Number(body?.contentLength ?? headers?.get?.('content-length') ?? 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
          return fail(413, 'INVALID_REQUEST', 'Export archive is too large', headers);
        }

        const contentType = String(body?.contentType ?? '');
        const payload = body?.buffer ?? body?.body ?? null;
        if (!contentType.includes('multipart/form-data') || !payload) {
          return fail(400, 'INVALID_REQUEST', 'Expected multipart/form-data', headers);
        }
        if (payload.length > MAX_UPLOAD_BYTES) {
          return fail(413, 'INVALID_REQUEST', 'Export archive is too large', headers);
        }

        try {
          const upstream = await doFetch(`${resolved.url}/owner-bound/render`, {
            method: 'POST',
            body: payload,
            headers: {
              'content-type': contentType,
              'x-openmaic-client': clientIdentityOf(request, env),
              [RENDER_OWNER_HEADER]: ownerId,
            },
            signal: timeoutSignal(SUBMIT_TIMEOUT_MS),
          });
          if (!isRenderOwnerBoundResponse(upstream)) {
            return fail(
              502,
              'UPSTREAM_ERROR',
              'Render service must be upgraded before accepting jobs',
              headers,
            );
          }
          const data = (await upstream.json().catch(() => ({}))) ?? {};
          if (!upstream.ok) {
            const detail = typeof data.error === 'string' ? data.error : upstream.statusText;
            const status = upstream.status === 429 ? 429 : upstream.status === 413 ? 413 : 502;
            const code =
              upstream.status === 429
                ? 'RATE_LIMITED'
                : upstream.status === 413
                  ? 'INVALID_REQUEST'
                  : 'UPSTREAM_ERROR';
            const reason =
              upstream.status === 429 &&
              (data.reason === 'queue_full' || data.reason === 'per_identity_limit')
                ? data.reason
                : undefined;
            return fail(status, code, 'Render service rejected the request', headers, detail, reason);
          }
          return ok({ jobId: data.jobId, pollIntervalMs: 3000 }, 202, headers);
        } catch (error) {
          log.error?.('Failed to submit render job', error?.message ?? error);
          return fail(
            502,
            'UPSTREAM_ERROR',
            'Failed to reach render service',
            headers,
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    },

    /**
     * 源文件:app/api/export-video/render/[jobId]/route.ts:18-53（GET）。
     *
     * 上游还有 DELETE（取消任务，源:56-92）；批表只列了 GET，本包按「取消」
     * 语义补 `video.cancel(jobId)`（同一份 handler 的第二个动词）。
     */
    async job(jobId, request) {
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const resolved = resolveRenderServiceUrl(env);
        if ('error' in resolved) {
          return fail(501, 'PROVIDER_DISABLED', 'Render service is not configured', headers);
        }
        try {
          const upstream = await doFetch(
            `${resolved.url}/owner-bound/render/${encodeURIComponent(jobId)}`,
            {
              method: 'GET',
              headers: { [RENDER_OWNER_HEADER]: ownerId },
              signal: timeoutSignal(15_000),
            },
          );
          if (!isRenderOwnerBoundResponse(upstream)) {
            return fail(
              502,
              'UPSTREAM_ERROR',
              'Render service must be upgraded before reading jobs',
              headers,
            );
          }
          const data = (await upstream.json().catch(() => ({}))) ?? {};
          if (!upstream.ok) {
            return fail(
              upstream.status === 404 ? 404 : 502,
              'UPSTREAM_ERROR',
              'Render job lookup failed',
              headers,
            );
          }
          return ok({ ...data, pollIntervalMs: 3000 }, 200, headers);
        } catch (error) {
          log.error?.(`Failed to poll render job ${jobId}`, error?.message ?? error);
          return fail(502, 'UPSTREAM_ERROR', 'Failed to reach render service', headers);
        }
      });
    },

    /** 源文件:app/api/export-video/render/[jobId]/route.ts:56-92（DELETE）。 */
    async cancel(jobId, request) {
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const resolved = resolveRenderServiceUrl(env);
        if ('error' in resolved) {
          return fail(501, 'PROVIDER_DISABLED', 'Render service is not configured', headers);
        }
        try {
          const upstream = await doFetch(
            `${resolved.url}/owner-bound/render/${encodeURIComponent(jobId)}`,
            {
              method: 'DELETE',
              headers: { [RENDER_OWNER_HEADER]: ownerId },
              signal: timeoutSignal(15_000),
            },
          );
          if (!isRenderOwnerBoundResponse(upstream)) {
            return fail(
              502,
              'UPSTREAM_ERROR',
              'Render service must be upgraded before cancelling jobs',
              headers,
            );
          }
          if (upstream.status === 404) {
            return fail(404, 'UPSTREAM_ERROR', 'Render job lookup failed', headers);
          }
          if (!upstream.ok) return fail(502, 'UPSTREAM_ERROR', 'Failed to cancel render job', headers);
          return ok({ cancelled: true }, 200, headers);
        } catch (error) {
          log.error?.(`Failed to cancel render job ${jobId}`, error?.message ?? error);
          return fail(502, 'UPSTREAM_ERROR', 'Failed to reach render service', headers);
        }
      });
    },

    /**
     * 源文件:app/api/export-video/render/[jobId]/download/route.ts:26-90（GET）。
     *
     * **二进制分支**：`{ httpStatus, buffer, mimeType, headers }`。
     * 上游的 `302`（预签名对象存储）原样透传：返回 `{ httpStatus:302, headers }`，
     * 不带 buffer（浏览器直接去存储下载）。
     */
    async download(jobId, request) {
      return withOwner(ownerDeps, request, async ({ ownerId, headers }) => {
        const resolved = resolveRenderServiceUrl(env);
        if ('error' in resolved) {
          return fail(501, 'PROVIDER_DISABLED', 'Render service is not configured', headers);
        }
        const controller = new AbortController();
        const headerTimeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const upstream = await doFetch(
            `${resolved.url}/owner-bound/render/${encodeURIComponent(jobId)}/download`,
            {
              method: 'GET',
              redirect: 'manual',
              headers: { [RENDER_OWNER_HEADER]: ownerId },
              signal: controller.signal,
            },
          );
          clearTimeout(headerTimeout);
          if (!isRenderOwnerBoundResponse(upstream)) {
            return fail(
              502,
              'UPSTREAM_ERROR',
              'Render service must be upgraded before downloading jobs',
              headers,
            );
          }

          // Presigned-URL artifact store: hand the redirect to the browser.
          if (upstream.status === 302 || upstream.status === 301) {
            const location = upstream.headers.get('location');
            if (location) {
              const redirectHeaders = new Headers(headers);
              redirectHeaders.set('location', location);
              return { httpStatus: 302, buffer: null, mimeType: null, headers: redirectHeaders };
            }
          }

          if (!upstream.ok || !upstream.body) {
            const status = upstream.status === 404 || upstream.status === 409 ? upstream.status : 502;
            return fail(status, 'UPSTREAM_ERROR', 'Render output not available', headers);
          }

          const buffer = Buffer.from(await upstream.arrayBuffer());
          const contentLength = upstream.headers.get('content-length');
          const binaryHeaders = new Headers(headers);
          binaryHeaders.set('Content-Type', 'video/mp4');
          if (contentLength) binaryHeaders.set('Content-Length', contentLength);
          binaryHeaders.set('Content-Disposition', `attachment; filename="${jobId}.mp4"`);
          binaryHeaders.set('Cache-Control', 'private, no-store');
          return binaryResponse(200, buffer, 'video/mp4', binaryHeaders);
        } catch (error) {
          clearTimeout(headerTimeout);
          log.error?.(`Failed to download render output ${jobId}`, error?.message ?? error);
          return fail(502, 'UPSTREAM_ERROR', 'Failed to reach render service', headers);
        }
      });
    },
  };

  // ── service.quiz（quiz-grade） ────────────────────────────────────────

  /** 上游 quiz-grade 的 LLM 出口：`ports.agent.complete` 优先，其次 `ports.media.complete`。 */
  const chatPort = () => {
    const agent = portOf(deps, 'agent');
    if (agent && typeof agent.complete === 'function') return agent;
    const media = portOf(deps, 'media');
    if (media && typeof media.complete === 'function') return media;
    return null;
  };

  const quiz = {
    /**
     * 源文件:app/api/quiz-grade/route.ts:29-117（POST）。
     *
     * 上游 `callLLM`（含模型槽解析、计量）在本包是 `ports.agent.complete`
     * （或 `ports.media.complete`）；缺端口抛 `E_NOT_IMPLEMENTED`（源:72-82）。
     * 提示词、JSON 解析、`50% 兜底` 三段逐行照搬。
     */
    async grade(body, request) {
      let questionSnippet;
      let resolvedPoints;
      try {
        if (!body || typeof body !== 'object') {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'question and userAnswer are required');
        }
        const { question, userAnswer, points, commentPrompt, language } = body;
        questionSnippet = question?.substring?.(0, 60);
        resolvedPoints = points;

        if (!question || !userAnswer) {
          return fail(400, 'MISSING_REQUIRED_FIELD', 'question and userAnswer are required');
        }

        if (!points || !Number.isFinite(points) || points <= 0) {
          return fail(400, 'INVALID_REQUEST', 'points must be a positive number');
        }

        const port = chatPort();
        if (!port) {
          throw notImplemented(
            'zhiyunClassroomStudio.quiz.grade',
            'app/api/quiz-grade/route.ts:72-82（上游 callLLM，需要 ports.agent.complete）',
          );
        }

        const isZh = language === 'zh-CN';

        const systemPrompt = isZh
          ? `你是一位专业的教育评估专家。请根据题目和学生答案进行评分并给出简短评语。
必须以如下 JSON 格式回复（不要包含其他内容）：
{"score": <0到${points}的整数>, "comment": "<一两句评语>"}`
          : `You are a professional educational assessor. Grade the student's answer and provide brief feedback.
You must reply in the following JSON format only (no other content):
{"score": <integer from 0 to ${points}>, "comment": "<one or two sentences of feedback>"}`;

        const userPrompt = isZh
          ? `题目：${question}
满分：${points}分
${commentPrompt ? `评分要点：${commentPrompt}\n` : ''}学生答案：${userAnswer}`
          : `Question: ${question}
Full marks: ${points} points
${commentPrompt ? `Grading guidance: ${commentPrompt}\n` : ''}Student answer: ${userAnswer}`;

        const result = await port.complete({
          system: systemPrompt,
          prompt: userPrompt,
          source: 'quiz-grade',
          request,
        });

        const text = String(result?.text ?? '').trim();
        let gradeResult;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          const parsed = JSON.parse(jsonMatch[0]);
          gradeResult = {
            score: Math.max(0, Math.min(points, Math.round(Number(parsed.score)))),
            comment: String(parsed.comment || ''),
          };
        } catch {
          gradeResult = {
            score: Math.round(points * 0.5),
            comment: isZh
              ? '已作答，请参考标准答案。'
              : 'Answer received. Please refer to the standard answer.',
          };
        }

        return ok({ ...gradeResult });
      } catch (error) {
        if (error instanceof ClassroomError) throw error;
        log.error?.(
          `Quiz grading failed [question="${questionSnippet ?? 'unknown'}...", points=${resolvedPoints ?? 'unknown'}]`,
          error?.message ?? error,
        );
        return fail(500, 'INTERNAL_ERROR', 'Failed to grade answer');
      }
    },
  };

  // ── service.pbl（pbl/v2/*） ────────────────────────────────────────────

  const pblPort = () => {
    const port = portOf(deps, 'pbl');
    return port && typeof port === 'object' ? port : null;
  };

  /**
   * 把 `ports.pbl` 的返回值统一成 `AsyncIterable<event>`。
   *
   * 事件形状 = 上游 SSE 帧的 `data` **加上** `type`（`lib/pbl/v2/api/sse.ts:185-188`
   * 的 `event: <type>` + `data: <除 type 外的字段>`）。所以这里的事件是**扁平**的
   * `{ type, ...payload }`，不是 `events.js` 的 `{type,data}` 包一层 —— 因为 PBL 的
   * 负载本身就是扁平的，包一层会让客户端多改一次取值。
   */
  function pblStream(events) {
    return (async function* emit() {
      // 端口可以回 `AsyncIterable`（真流）也可以回数组（一次性结果）。
      if (events && typeof events[Symbol.asyncIterator] === 'function') {
        for await (const event of events) yield event;
        return;
      }
      for (const event of events ?? []) yield event;
    })();
  }

  /** 端口方法缺失时的统一出口。 */
  function requirePblMethod(name, source) {
    const port = pblPort();
    if (!port || typeof port[name] !== 'function') {
      throw notImplemented(`zhiyunClassroomStudio.pbl.${name}`, source);
    }
    return port[name].bind(port);
  }

  const pbl = {
    /**
     * 源文件:app/api/pbl/v2/evaluate/route.ts:56-131（POST，SSE）。
     *
     * 上游三种 kind 各自跑一个 evaluator 流；本包走
     * `ports.pbl.evaluate(body, ctx)`（有则优先），否则用已存在的两个方法拼：
     * `rubric(project)` + `grade(submission, rubric)`，把结果包成一条
     * `project_patch`（`kind:'evaluation'`）+ `done` —— 事件类型与上游同名同形。
     */
    async evaluate(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
      }
      if (!body.project) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`project` is required.');
      }
      if (body.kind !== 'task' && body.kind !== 'milestone' && body.kind !== 'final') {
        return fail(400, 'INVALID_REQUEST', "`kind` must be 'task' | 'milestone' | 'final'.");
      }
      if (body.kind === 'task' && (!body.milestoneId || !body.microtaskId)) {
        return fail(
          400,
          'MISSING_REQUIRED_FIELD',
          "kind='task' requires both milestoneId and microtaskId.",
        );
      }
      if (body.kind === 'milestone' && !body.milestoneId) {
        return fail(400, 'MISSING_REQUIRED_FIELD', "kind='milestone' requires milestoneId.");
      }

      const port = pblPort();
      if (!port) {
        throw notImplemented(
          'zhiyunClassroomStudio.pbl.evaluate',
          'app/api/pbl/v2/evaluate/route.ts:93-131（上游 runTaskEvaluation / runMilestoneEvaluation / runFinalEvaluation）',
        );
      }
      if (typeof port.evaluate === 'function') {
        const stream = await port.evaluate(body, { request });
        return pblStream(stream);
      }
      if (typeof port.grade === 'function' && typeof port.rubric === 'function') {
        return pblStream(evaluateThroughGrade(port, body, request));
      }
      throw notImplemented(
        'zhiyunClassroomStudio.pbl.evaluate',
        'app/api/pbl/v2/evaluate/route.ts:93-131（ports.pbl 需要 evaluate 或 rubric+grade）',
      );
    },

    /**
     * 源文件:app/api/pbl/v2/instructor/route.ts:37-76（POST，SSE）。
     *
     * 端口：`ports.pbl.instructorTurn({ project, userMessage, phase, signal })`
     * —— 现有五个方法（plan/buildPlan/rubric/grade/briefing）里**没有**对话轮，
     * 所以缺这个方法是常态，缺了就抛（源:66-76）。
     */
    async instructor(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
      }
      if (!body.project) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`project` is required.');
      }
      if (typeof body.userMessage !== 'string' || body.userMessage.trim().length === 0) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`userMessage` is required.');
      }
      const turn = requirePblMethod(
        'instructorTurn',
        'app/api/pbl/v2/instructor/route.ts:66-76（上游 runInstructorTurn）',
      );
      const stream = await turn({
        project: body.project,
        userMessage: body.userMessage,
        phase: body.phase ?? 'instructing',
        signal: request?.signal,
      });
      return pblStream(stream);
    },

    /**
     * 源文件:app/api/pbl/v2/open-task/route.ts:39-94（POST，SSE）。
     *
     * 端口：`ports.pbl.openTask(body)` 优先；否则退到 `instructorTurn`
     * （`phase: 'greeting' | 'setup'`，`userMessage: ''`）—— 上游就是同一个
     * `runInstructorTurn`，只是 `userMessage` 为空（源:83-92）。
     */
    async openTask(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
      }
      if (!body.project) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`project` is required.');
      }
      if (body.phase !== 'greeting' && body.phase !== 'setup') {
        return fail(400, 'INVALID_REQUEST', "`phase` must be 'greeting' or 'setup'.");
      }
      const port = pblPort();
      if (port && typeof port.openTask === 'function') {
        const stream = await port.openTask(body, { request });
        return pblStream(stream);
      }
      if (port && typeof port.instructorTurn === 'function') {
        const stream = await port.instructorTurn({
          project: body.project,
          userMessage: '',
          phase: body.phase,
          priorQuizResults: body.priorQuizResults,
          signal: request?.signal,
        });
        return pblStream(stream);
      }
      throw notImplemented(
        'zhiyunClassroomStudio.pbl.openTask',
        'app/api/pbl/v2/open-task/route.ts:83-92（上游 runInstructorTurn，userMessage 为空）',
      );
    },

    /**
     * 源文件:app/api/pbl/v2/simulator/route.ts:38-73（POST，SSE）。
     *
     * 端口：`ports.pbl.simulatorTurn(...)`；缺了就抛（源:73）。
     */
    async simulator(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
      }
      if (!body.project) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`project` is required.');
      }
      const turn = requirePblMethod(
        'simulatorTurn',
        'app/api/pbl/v2/simulator/route.ts:73（上游 runSimulatorTurn）',
      );
      const stream = await turn({
        project: body.project,
        userMessage: body.userMessage ?? '',
        phase: body.phase === 'greeting' ? 'greeting' : 'instructing',
        signal: request?.signal,
      });
      return pblStream(stream);
    },

    /**
     * 源文件:app/api/pbl/v2/task/update/route.ts:46-160（POST，无 LLM）。
     *
     * 上游对 `project` **原地变更**再回 `apiSuccess({ project, … })`；五个动作的
     * 确定性状态机在 `lib/pbl/v2/operations/kernel/progress` 里（没搬）。端口：
     * `ports.pbl.updateTask(body) -> { project, … }`；缺了就抛（源:59-159）。
     */
    async updateTask(body, request) {
      if (!body || typeof body !== 'object') {
        return fail(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
      }
      if (!body.project) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`project` is required.');
      }
      if (body.action === 'start' && !body.microtaskId) {
        return fail(400, 'MISSING_REQUIRED_FIELD', '`microtaskId` is required for start.');
      }
      const update = requirePblMethod(
        'updateTask',
        'app/api/pbl/v2/task/update/route.ts:59-159（上游 progress kernel 的五个确定性动作）',
      );
      const result = await update(body, { request });
      if (result?.ok === false) {
        return fail(400, result.code ?? 'INVALID_REQUEST', result.message ?? 'Update refused.');
      }
      return ok({ ...(result ?? {}) });
    },
  };

  /** `evaluate` 的降级实现：rubric + grade → 一条 evaluation 补丁。 */
  async function* evaluateThroughGrade(port, body, request) {
    const rubric = port.rubric(body.project);
    const submission =
      body.kind === 'task'
        ? {
            kind: 'task',
            project: body.project,
            milestoneId: body.milestoneId,
            microtaskId: body.microtaskId,
            recentChatSummary: body.recentChatSummary,
          }
        : {
            kind: body.kind,
            project: body.project,
            milestoneId: body.milestoneId,
            recentChatSummary: body.recentChatSummary,
          };
    try {
      const graded = await port.grade(submission, rubric, { request });
      const evaluation = graded?.evaluation ?? graded;
      yield { type: 'project_patch', patch: { kind: 'evaluation', evaluation } };
    } catch (error) {
      yield {
        type: 'error',
        code: 'EVALUATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    yield { type: 'done' };
  }

  // ── 挂载（全部 Object.assign 追加，不替换任何既有实现） ────────────────

  service.access = Object.assign(service.access ?? {}, access);
  service.identity = Object.assign(service.identity ?? {}, identity);
  service.folders = Object.assign(service.folders ?? {}, folders);
  service.modelConfig = Object.assign(service.modelConfig ?? {}, modelConfig);
  // `providers` 已经有 `list()`（真实现）和 `set()`（空壳）：只追加，不动它们。
  service.providers = Object.assign(service.providers ?? {}, providerMethods);
  service.usage = Object.assign(service.usage ?? {}, usage);
  service.persistence = Object.assign(service.persistence ?? {}, persistence);
  service.video = Object.assign(service.video ?? {}, video);
  service.quiz = Object.assign(service.quiz ?? {}, quiz);
  service.pbl = Object.assign(service.pbl ?? {}, pbl);

  return service;
}
