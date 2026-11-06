// 批 4（身份 / 配置 / 校验 / 导出 / PBL，27 条）的搬运测试。
//
// 每条 route 至少一例：入参校验分支（400/403/404）+ 正常分支；
// 端口缺失的降级分支单独钉住（纯文本 404 / `PERSISTENCE_NOT_CONFIGURED` /
// `E_NOT_IMPLEMENTED` 抛）。上游 SSE 的三条按 `AsyncIterable` 收。
//
// 断言只看 `httpStatus` 与 body 的关键字段，**不断言整个 body**
// （上游加字段不该让测试红 —— 挂载协议 §0「测试」）。
//
// 所有「真实上游 HTTP」都用注入的 `deps.fetch`（假 fetch），不打网络：
// base URL 一律用字面量公网 IP（`8.8.8.8`），因为 `ssrf-guard` 对域名会做
// DNS 解析，测试里既不该依赖 DNS、也不该因为离线而红。
//
// 跑法：`node --test tests/classroom-host-platform.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-host-classroom/', import.meta.url);
const PLATFORM_URL = pathToFileURL(
  join(fileURLToPath(PACKAGE_DIR), 'src', 'services', 'platform.js'),
).href;
const SERVICE_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'service.js')).href;
const PROVIDER_CONFIG_URL = pathToFileURL(
  join(fileURLToPath(PACKAGE_DIR), 'src', 'upstream', 'provider-config.js'),
).href;
const ERRORS_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'errors.js')).href;

const { mountPlatform } = await import(PLATFORM_URL);
const { createClassroomService } = await import(SERVICE_URL);
const { createDegradedProviderConfig } = await import(PROVIDER_CONFIG_URL);
const { ClassroomError } = await import(ERRORS_URL);

// ── 测试装置 ────────────────────────────────────────────────────────────────

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/** 内存版 kv（形状同 `packages/dsh-zhiyun-core-classroom-vault`）。 */
function makeVault() {
  const kv = new Map();
  return {
    kv: {
      async get(key) {
        return kv.has(key) ? structuredClone(kv.get(key)) : null;
      },
      async set(key, value) {
        kv.set(key, structuredClone(value));
        return true;
      },
      async remove(key) {
        return kv.delete(key);
      },
      async keys(prefix = '') {
        return [...kv.keys()].filter((key) => key.startsWith(prefix)).sort();
      },
    },
    raw: kv,
  };
}

/** 记录调用并按键返回假响应的小 fetch。 */
function makeFetch(handler) {
  const calls = [];
  const impl = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { impl, calls };
}

function jsonResponseOf(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * 造一个挂了本批的服务。
 *
 * `providerConfig` 默认是降级集合（七个 getter 全 `{}`、`requestProvidersAllowed` 恒 true），
 * 需要时按字段覆盖 —— 这是上游 `mergeProviderConfig` 允许的部分注入同义。
 */
function makeService({
  ports = {},
  vault = null,
  dataDir = null,
  fetch: fetchImpl,
  env = {},
  owner,
  providerConfig: overrides = {},
} = {}) {
  const providerConfig = {
    ...createDegradedProviderConfig(),
    get: () => undefined,
    ...overrides,
  };
  const allPorts = vault ? { vault, ...ports } : ports;
  const service = createClassroomService({
    providerConfig,
    log: silentLog,
    ports: allPorts,
    dataDir,
    mounts: [mountPlatform],
  });
  // 本批用到的两个额外注入面不在 `createClassroomService` 的签名里，直接补到
  // `mountPlatform` 的 deps 上 —— 测试里绕开装配层，单测本批的语义。
  const deps = {
    ports: allPorts,
    log: silentLog,
    dataDir,
    providerConfig,
    fetch: fetchImpl,
    env,
    owner,
  };
  mountPlatform(service, deps);
  return { service, deps, providerConfig };
}

function apiRequest(extra = {}) {
  return { headers: new Headers({ 'content-type': 'application/json' }), url: 'http://host/api', ...extra };
}

// ── 1 / 2. access-code ─────────────────────────────────────────────────────

test('access.status: 未配置访问码 → { success:true, enabled:false, authenticated:false }', async () => {
  const { service } = makeService();
  const response = await service.access.status({});
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.authenticated, false);
});

test('access.status: 配了访问码但没 cookie → enabled:true, authenticated:false', async () => {
  const { service } = makeService({
    providerConfig: { get: (key) => (key === 'accessCode' ? 'secret-code' : undefined) },
  });
  const response = await service.access.status({});
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.authenticated, false);
});

test('access.verify: 未配置 → { success:true, valid:true }（上游未启用分支）', async () => {
  const { service } = makeService();
  const response = await service.access.verify({ code: 'anything' }, apiRequest());
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.valid, true);
});

test('access.verify: 错误访问码 401，正确访问码 200 且下发 Set-Cookie', async () => {
  const { service } = makeService({
    providerConfig: { get: (key) => (key === 'accessCode' ? 'secret-code' : undefined) },
    env: { COOKIE_SECURE: '0' },
  });
  const wrong = await service.access.verify({ code: 'nope' }, apiRequest());
  assert.equal(wrong.httpStatus, 401);
  assert.equal(wrong.body.errorCode, 'INVALID_REQUEST');

  const right = await service.access.verify({ code: 'secret-code' }, apiRequest());
  assert.equal(right.httpStatus, 200);
  assert.equal(right.body.valid, true);
  const cookie = right.headers.get('set-cookie');
  assert.match(cookie, /openmaic_access=/);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /Secure/); // COOKIE_SECURE=0 时不明文丢 cookie
});

// ── 3 / 4. identity ────────────────────────────────────────────────────────

test('identity.claim: 跨站请求 403 CROSS_ORIGIN_REFUSED', async () => {
  const { service } = makeService();
  const request = { headers: new Headers({ 'content-type': 'text/plain' }) };
  const response = await service.identity.claim(request);
  assert.equal(response.httpStatus, 403);
  assert.equal(response.body.error.code, 'CROSS_ORIGIN_REFUSED');
});

test('identity.claim: 无 identity 端口 → 404 PERSISTENCE_NOT_CONFIGURED', async () => {
  const { service } = makeService();
  const response = await service.identity.claim(apiRequest());
  assert.equal(response.httpStatus, 404);
  assert.equal(response.body.error.code, 'PERSISTENCE_NOT_CONFIGURED');
});

test('identity.claim: 有端口且带 pendingClaim → 200 { status:"claimed" }', async () => {
  const { service } = makeService({
    ports: {
      identity: {
        async claim() {
          return { ok: true, result: { status: 'claimed', moved: { documents: 2 } }, setCookies: [] };
        },
      },
    },
  });
  const response = await service.identity.claim(
    apiRequest({ pendingClaim: { fromOwnerId: 'anon' }, kind: 'authenticated' }),
  );
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.status, 'claimed');
});

test('identity.claim: 没有 pendingClaim → 409 NO_PENDING_CLAIM', async () => {
  const { service } = makeService({
    ports: { identity: { async claim() { return { ok: true, result: {} }; } } },
  });
  const response = await service.identity.claim(apiRequest({ kind: 'authenticated' }));
  assert.equal(response.httpStatus, 409);
  assert.equal(response.body.error.code, 'NO_PENDING_CLAIM');
});

test('identity.legacyBinding: 畸形 browserId 400，正常绑定 200 { bound }', async () => {
  const { service } = makeService({
    ports: { identity: { async bindLegacyImport() { return true; } } },
  });
  const bad = await service.identity.legacyBinding({ browserId: 'ABC' }, apiRequest());
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error.code, 'INVALID_REQUEST');

  const good = await service.identity.legacyBinding(
    { browserId: 'a'.repeat(32) },
    apiRequest({ assurance: 'cookie' }),
  );
  assert.equal(good.httpStatus, 200);
  assert.equal(good.body.bound, true);
});

// ── 5 / 6. folders ─────────────────────────────────────────────────────────

test('folders.list: 没有持久层 → 纯文本 404；有 kv → 空清单', async () => {
  const without = makeService();
  const notFound = await without.service.folders.list(apiRequest());
  assert.equal(notFound.httpStatus, 404);
  assert.equal(notFound.body, 'Not found');

  const withVault = makeService({ vault: makeVault() });
  const listed = await withVault.service.folders.list(apiRequest());
  assert.equal(listed.httpStatus, 200);
  assert.deepEqual(listed.body.folders, []);
});

test('folders.create: 空名 400 FOLDER_NAME_EMPTY，正常创建带 userKey', async () => {
  const { service } = makeService({ vault: makeVault() });
  const empty = await service.folders.create({ name: '   ' }, apiRequest());
  assert.equal(empty.httpStatus, 400);
  assert.equal(empty.body.error.code, 'FOLDER_NAME_EMPTY');

  const created = await service.folders.create({ name: '第一单元' }, apiRequest());
  assert.equal(created.httpStatus, 200);
  assert.equal(created.body.folder.name, '第一单元');
  assert.equal(created.body.folder.userKey, 'local');
  assert.match(created.body.folder.id, /^folder-/);
});

test('folders.create: 同名（大小写不敏感）409 FOLDER_NAME_DUPLICATE', async () => {
  const { service } = makeService({ vault: makeVault() });
  await service.folders.create({ name: 'Unit A' }, apiRequest());
  const duplicate = await service.folders.create({ name: 'unit a' }, apiRequest());
  assert.equal(duplicate.httpStatus, 409);
  assert.equal(duplicate.body.error.code, 'FOLDER_NAME_DUPLICATE');
});

test('folders.update: 改名 200；未知 id 404', async () => {
  const { service } = makeService({ vault: makeVault() });
  const { body } = await service.folders.create({ name: 'Old' }, apiRequest());
  const renamed = await service.folders.update(body.folder.id, { name: 'New' }, apiRequest());
  assert.equal(renamed.httpStatus, 200);
  assert.equal(renamed.body.folder.name, 'New');

  const missing = await service.folders.update('folder-nope', { name: 'X' }, apiRequest());
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body.error.code, 'FOLDER_NOT_FOUND');
});

test('folders.remove: mode=remove 返回被捕获的课程 id', async () => {
  const { service } = makeService({ vault: makeVault() });
  const { body } = await service.folders.create({ name: 'F' }, apiRequest());
  const folderId = body.folder.id;
  const added = await service.folders.members.add({ stageId: 'stage-1', folderId }, apiRequest());
  assert.equal(added.httpStatus, 200);

  const removed = await service.folders.remove(folderId, apiRequest({ query: { mode: 'remove' } }));
  assert.equal(removed.httpStatus, 200);
  assert.deepEqual(removed.body.removedStageIds, ['stage-1']);
});

test('folders.get: 上游没有 GET /api/folders/[id] → 抛 E_NOT_IMPLEMENTED', async () => {
  const { service } = makeService({ vault: makeVault() });
  await assert.rejects(
    () => service.folders.get('folder-x'),
    (error) => error instanceof ClassroomError && error.kind === 'E_NOT_IMPLEMENTED',
  );
});

test('folders.members: 缺 stageId 400；add/remove 都落到同一个 POST 语义', async () => {
  const { service } = makeService({ vault: makeVault() });
  const bad = await service.folders.members.add({ folderId: null }, apiRequest());
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error.code, 'MISSING_STAGE_ID');

  const { body } = await service.folders.create({ name: 'F' }, apiRequest());
  const filed = await service.folders.members.add(
    { stageId: 'stage-9', folderId: body.folder.id },
    apiRequest(),
  );
  assert.equal(filed.body.ok, true);

  const unfiled = await service.folders.members.remove({ stageId: 'stage-9' }, apiRequest());
  assert.equal(unfiled.body.ok, true);

  await assert.rejects(
    () => service.folders.members.list(),
    (error) => error instanceof ClassroomError && error.kind === 'E_NOT_IMPLEMENTED',
  );
});

// ── 7 / 8 / 9. model-config ────────────────────────────────────────────────

test('modelConfig.get: 没有设置端口 → 纯文本 404；有端口 → 视图', async () => {
  const without = makeService();
  const notFound = await without.service.modelConfig.get(apiRequest());
  assert.equal(notFound.httpStatus, 404);
  assert.equal(notFound.body, 'Not found');

  const withPort = makeService({
    ports: { modelConfig: { async view() { return { revision: 3, providers: [], slots: [] }; } } },
  });
  const view = await withPort.service.modelConfig.get(apiRequest());
  assert.equal(view.httpStatus, 200);
  assert.equal(view.body.revision, 3);
});

test('modelConfig.put: 畸形 body 400（Expected { revision, change }）', async () => {
  const { service } = makeService({
    ports: { modelConfig: { async apply() { return { view: {} }; } } },
  });
  const response = await service.modelConfig.put({ revision: 0, change: { kind: 'nope' } }, apiRequest());
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.error.code, 'INVALID_REQUEST');
});

test('modelConfig.put: revision 过期 409 CONFLICT；正常写入 200', async () => {
  const conflict = makeService({
    ports: { modelConfig: { async apply() { return { conflict: true }; } } },
  });
  const conflictResponse = await conflict.service.modelConfig.put(
    { revision: 1, change: { kind: 'slots', clear: ['scene'] } },
    apiRequest(),
  );
  assert.equal(conflictResponse.httpStatus, 409);
  assert.equal(conflictResponse.body.error.code, 'CONFLICT');

  const okService = makeService({
    ports: { modelConfig: { async apply() { return { view: { revision: 2 } }; } } },
  });
  const written = await okService.service.modelConfig.put(
    { revision: 1, change: { kind: 'remove-provider', id: 'p1' } },
    apiRequest(),
  );
  assert.equal(written.httpStatus, 200);
  assert.equal(written.body.revision, 2);
});

test('modelConfig.import: 畸形 body 400；正常返回 imported / skipped / view', async () => {
  const { service } = makeService({
    ports: {
      modelConfig: {
        async import() {
          return { imported: ['p1'], skipped: [], view: { revision: 1 } };
        },
      },
    },
  });
  const bad = await service.modelConfig.import({ extra: true }, apiRequest());
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error.code, 'INVALID_REQUEST');

  const imported = await service.modelConfig.import({ providers: { p1: {} } }, apiRequest());
  assert.equal(imported.httpStatus, 200);
  assert.deepEqual(imported.body.imported, ['p1']);
});

// ── 10. provider/probe-models ──────────────────────────────────────────────

test('providers.probe: 非对象 body 400 INVALID_REQUEST', async () => {
  const { service } = makeService();
  const response = await service.providers.probe(null);
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'INVALID_REQUEST');
});

test('providers.probe: 缺 baseUrl 400；有 baseUrl 时过滤非 chat 模型', async () => {
  const { service } = makeService();
  const missing = await service.providers.probe({ apiKey: 'k' });
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const fetch = makeFetch(() =>
    jsonResponseOf({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3' }, { id: 'whisper-1' }] }),
  );
  const probed = makeService({ fetch: fetch.impl });
  const response = await probed.service.providers.probe({
    baseUrl: 'https://8.8.8.8/v1',
    apiKey: 'k',
  });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.total, 3);
  assert.equal(response.body.filtered, 2);
  assert.deepEqual(response.body.models.map((m) => m.id), ['gpt-4o']);
});

test('providers.probe: 上游 401 → 401 API key is invalid or expired', async () => {
  const fetch = makeFetch(() => new Response('nope', { status: 401 }));
  const { service } = makeService({ fetch: fetch.impl });
  const response = await service.providers.probe({ baseUrl: 'https://8.8.8.8/v1', apiKey: 'bad' });
  assert.equal(response.httpStatus, 401);
  assert.equal(response.body.error, 'API key is invalid or expired');
});

// ── 11. verify-model ───────────────────────────────────────────────────────

test('providers.verifyModel: 缺 model 400；没有 key 401（上游解析不出模型分支）', async () => {
  const { service } = makeService();
  const missing = await service.providers.verifyModel({}, apiRequest());
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const noKey = await service.providers.verifyModel({ model: 'gpt-4o' }, apiRequest());
  assert.equal(noKey.httpStatus, 401);
  assert.equal(noKey.body.errorCode, 'INVALID_REQUEST');
});

test('providers.verifyModel: 有 key + baseUrl → 真发 chat/completions，回 Connection successful', async () => {
  const fetch = makeFetch(() => jsonResponseOf({ choices: [{ message: { content: 'OK' } }] }));
  const { service } = makeService({ fetch: fetch.impl });
  const response = await service.providers.verifyModel(
    { model: 'gpt-4o', apiKey: 'sk-x', baseUrl: 'https://8.8.8.8/v1' },
    apiRequest(),
  );
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.message, 'Connection successful');
  assert.equal(response.body.response, 'OK');
  assert.match(fetch.calls[0].url, /\/chat\/completions$/);
});

test('providers.verifyModel: 上游 429 → 500 + 固定文案（不回上游 body）', async () => {
  const fetch = makeFetch(() => new Response('slow down', { status: 429 }));
  const { service } = makeService({ fetch: fetch.impl });
  const response = await service.providers.verifyModel(
    { model: 'gpt-4o', apiKey: 'sk-x', baseUrl: 'https://8.8.8.8/v1' },
    apiRequest(),
  );
  assert.equal(response.httpStatus, 500);
  assert.match(response.body.error, /rate limit/i);
});

// ── 12 / 13. verify-image-provider / verify-video-provider ────────────────

test('providers.verifyImage: 没有 provider 400 MISSING_PROVIDER', async () => {
  const { service } = makeService();
  const response = await service.providers.verifyImage({}, apiRequest());
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'MISSING_PROVIDER');
});

test('providers.verifyImage: 有 provider 无 key 400 MISSING_API_KEY', async () => {
  const { service } = makeService();
  const response = await service.providers.verifyImage(
    {},
    apiRequest({ headers: new Headers({ 'x-image-provider': 'openai-image' }) }),
  );
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'MISSING_API_KEY');
});

test('providers.verifyImage: provider + key + model → 探活成功', async () => {
  const fetch = makeFetch(() => new Response('{}', { status: 200 }));
  const { service } = makeService({ fetch: fetch.impl });
  const response = await service.providers.verifyImage(
    {},
    apiRequest({
      headers: new Headers({
        'x-image-provider': 'openai-image',
        'x-image-model': 'gpt-image-1',
        'x-api-key': 'sk-x',
        'x-base-url': 'https://8.8.8.8/v1',
      }),
    }),
  );
  assert.equal(response.httpStatus, 200);
  assert.match(response.body.message, /Connected to/);
  assert.equal(fetch.calls.length, 1);
});

test('providers.verifyVideo: 无 provider 400；有 key 无 model 400 MISSING_MODEL', async () => {
  const { service } = makeService();
  const missing = await service.providers.verifyVideo({}, apiRequest());
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_PROVIDER');

  const noModel = await service.providers.verifyVideo(
    {},
    apiRequest({
      headers: new Headers({
        'x-video-provider': 'kling',
        'x-api-key': 'sk-x',
        'x-base-url': 'https://8.8.8.8/v1',
      }),
    }),
  );
  assert.equal(noModel.httpStatus, 400);
  assert.equal(noModel.body.errorCode, 'MISSING_MODEL');
});

// ── 14. verify-pdf-provider ───────────────────────────────────────────────

test('providers.verifyPdf: 缺 providerId 400 MISSING_REQUIRED_FIELD', async () => {
  const { service } = makeService();
  const response = await service.providers.verifyPdf({}, apiRequest());
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'MISSING_REQUIRED_FIELD');
});

test('providers.verifyPdf: mineru-cloud 缺 key 400；自托管 baseUrl 探活 200', async () => {
  const { service } = makeService();
  const noKey = await service.providers.verifyPdf({ providerId: 'mineru-cloud' }, apiRequest());
  assert.equal(noKey.httpStatus, 400);
  assert.match(noKey.body.error, /MinerU Cloud/);

  const fetch = makeFetch(() => new Response('', { status: 404 }));
  const okService = makeService({ fetch: fetch.impl });
  const probed = await okService.service.providers.verifyPdf(
    { providerId: 'mineru', baseUrl: 'https://8.8.8.8' },
    apiRequest(),
  );
  assert.equal(probed.httpStatus, 200);
  assert.equal(probed.body.message, 'Connection successful');
});

test('providers.verifyPdf: 客户端 baseUrl 带 query 403 INVALID_URL', async () => {
  const { service } = makeService();
  const response = await service.providers.verifyPdf(
    { providerId: 'mineru', baseUrl: 'https://8.8.8.8?x=1' },
    apiRequest(),
  );
  assert.equal(response.httpStatus, 403);
  assert.equal(response.body.errorCode, 'INVALID_URL');
});

// ── 15. azure-voices ──────────────────────────────────────────────────────

test('providers.azureVoices: 缺 key 400；有 key 时透出 voices 数组', async () => {
  const { service } = makeService();
  const noKey = await service.providers.azureVoices({ baseUrl: 'https://8.8.8.8' });
  assert.equal(noKey.httpStatus, 400);
  assert.equal(noKey.body.errorCode, 'MISSING_API_KEY');

  const fetch = makeFetch(() => jsonResponseOf([{ ShortName: 'zh-CN-XiaoxiaoNeural' }]));
  const okService = makeService({ fetch: fetch.impl });
  const response = await okService.service.providers.azureVoices({
    apiKey: 'k',
    baseUrl: 'https://8.8.8.8',
  });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.voices.length, 1);
});

// ── 16. usage ─────────────────────────────────────────────────────────────

test('usage.get: 读 dataDir/usage/*.jsonl 并聚合（目录不存在 → 空数组分支）', async () => {
  const missing = makeService();
  const empty = await missing.service.usage.get({});
  assert.equal(empty.httpStatus, 200);
  assert.equal(empty.body.totals.requests, 0);

  const dataDir = await mkdtemp(join(tmpdir(), 'zyc-usage-'));
  await mkdir(join(dataDir, 'usage'), { recursive: true });
  const rows = [
    { kind: 'llm', modelId: 'gpt-4o', inputTokens: 10, outputTokens: 5, createdAt: 1730000000000 },
    { kind: 'image', modelId: 'seedream', quantity: 1, createdAt: 1730000000000 },
  ];
  await writeFile(
    join(dataDir, 'usage', '2026-10.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n'),
    'utf8',
  );

  const { service } = makeService({ dataDir });
  const response = await service.usage.get({});
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.totals.requests, 2);
  assert.equal(response.body.totals.llmTokens, 15);
  assert.equal(response.body.byKind.length, 2);
});

// ── 17. persistence ───────────────────────────────────────────────────────

test('persistence: dataDir 为 null → 404 PERSISTENCE_NOT_CONFIGURED（三动词都走这条）', async () => {
  const { service } = makeService();
  for (const response of [
    await service.persistence.get('a/b'),
    await service.persistence.put('a/b', { x: 1 }),
    await service.persistence.remove('a/b'),
  ]) {
    assert.equal(response.httpStatus, 404);
    assert.equal(response.body.error.code, 'PERSISTENCE_NOT_CONFIGURED');
  }
});

test('persistence: get / put / remove 往返（dataDir/persistence/ 下的 JSON 文件）', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'zyc-kv-'));
  const { service } = makeService({ dataDir });

  const written = await service.persistence.put('documents/stage-1', { id: 'stage-1' });
  assert.equal(written.httpStatus, 200);

  const read = await service.persistence.get(['documents', 'stage-1']);
  assert.equal(read.httpStatus, 200);
  assert.equal(read.body.id, 'stage-1');

  const missing = await service.persistence.get('documents/nope');
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const removed = await service.persistence.remove('documents/stage-1');
  assert.equal(removed.httpStatus, 200);
  assert.equal(removed.body.ok, true);
});

test('persistence: 路径穿越（.. / 编码斜杠）400 INVALID_PATH', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'zyc-kv-'));
  const { service } = makeService({ dataDir });

  const relative = await service.persistence.get('../../etc/passwd');
  assert.equal(relative.httpStatus, 400);
  assert.equal(relative.body.error.code, 'INVALID_PATH');

  const encoded = await service.persistence.put('a/%2e%2e%2fescape', { x: 1 });
  assert.equal(encoded.httpStatus, 400);
  assert.equal(encoded.body.error.code, 'INVALID_PATH');
});

// ── 18 ~ 21. export-video ────────────────────────────────────────────────

test('video.capability: 未配 RENDER_SERVICE_URL → enabled:false（不抛）', async () => {
  const { service } = makeService();
  const response = await service.video.capability();
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.enabled, false);
});

test('video.capability: 健康且带 owner-bound 标记 → enabled:true + accepting', async () => {
  const fetch = makeFetch(
    () =>
      jsonResponseOf({ accepting: true }, 200, {
        'x-openmaic-render-owner-bound': '1',
      }),
  );
  const { service } = makeService({
    fetch: fetch.impl,
    env: { RENDER_SERVICE_URL: 'http://render-service:9000' },
  });
  const response = await service.video.capability();
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.accepting, true);
});

test('video.render: 未配服务 501；正常提交 202 { jobId }', async () => {
  const unconfigured = makeService();
  const refused = await unconfigured.service.video.render(
    { contentType: 'multipart/form-data; boundary=x', buffer: Buffer.from('z') },
    apiRequest(),
  );
  assert.equal(refused.httpStatus, 501);
  assert.equal(refused.body.errorCode, 'PROVIDER_DISABLED');

  const fetch = makeFetch(() =>
    jsonResponseOf({ jobId: 'job-1' }, 202, { 'x-openmaic-render-owner-bound': '1' }),
  );
  const { service } = makeService({
    fetch: fetch.impl,
    env: { RENDER_SERVICE_URL: 'http://render-service:9000' },
  });
  const submitted = await service.video.render(
    { contentType: 'multipart/form-data; boundary=x', buffer: Buffer.from('z') },
    apiRequest(),
  );
  assert.equal(submitted.httpStatus, 202);
  assert.equal(submitted.body.jobId, 'job-1');
  assert.equal(submitted.body.pollIntervalMs, 3000);
});

test('video.render: 非 multipart 400 INVALID_REQUEST', async () => {
  const { service } = makeService({ env: { RENDER_SERVICE_URL: 'http://render-service:9000' } });
  const response = await service.video.render({ contentType: 'text/plain', buffer: Buffer.from('x') }, apiRequest());
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'INVALID_REQUEST');
});

test('video.job: 上游 404 → 404；正常回 job 状态', async () => {
  const notFoundFetch = makeFetch(
    () => new Response('{}', { status: 404, headers: { 'x-openmaic-render-owner-bound': '1' } }),
  );
  const missing = makeService({
    fetch: notFoundFetch.impl,
    env: { RENDER_SERVICE_URL: 'http://render-service:9000' },
  });
  const notFound = await missing.service.video.job('job-x', apiRequest());
  assert.equal(notFound.httpStatus, 404);

  const fetch = makeFetch(() =>
    jsonResponseOf({ status: 'done' }, 200, { 'x-openmaic-render-owner-bound': '1' }),
  );
  const { service } = makeService({
    fetch: fetch.impl,
    env: { RENDER_SERVICE_URL: 'http://render-service:9000' },
  });
  const response = await service.video.job('job-1', apiRequest());
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.status, 'done');
});

test('video.download: 二进制分支 { httpStatus, buffer, mimeType }', async () => {
  const fetch = makeFetch(
    () =>
      new Response(Buffer.from('mp4-bytes'), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '9',
          'x-openmaic-render-owner-bound': '1',
        },
      }),
  );
  const { service } = makeService({
    fetch: fetch.impl,
    env: { RENDER_SERVICE_URL: 'http://render-service:9000' },
  });
  const response = await service.video.download('job-1', apiRequest());
  assert.equal(response.httpStatus, 200);
  assert.equal(response.mimeType, 'video/mp4');
  assert.equal(response.buffer.toString(), 'mp4-bytes');
  assert.match(response.headers.get('content-disposition'), /job-1\.mp4/);
});

// ── 22. quiz-grade ────────────────────────────────────────────────────────

test('quiz.grade: 缺字段 400；points 非正数 400', async () => {
  const { service } = makeService();
  const missing = await service.quiz.grade({ question: 'q' });
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const badPoints = await service.quiz.grade({ question: 'q', userAnswer: 'a', points: 0 });
  assert.equal(badPoints.httpStatus, 400);
  assert.equal(badPoints.body.errorCode, 'INVALID_REQUEST');
});

test('quiz.grade: 无 agent 端口 → 抛 E_NOT_IMPLEMENTED（带行号）', async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.quiz.grade({ question: 'q', userAnswer: 'a', points: 10 }),
    (error) =>
      error instanceof ClassroomError
      && error.kind === 'E_NOT_IMPLEMENTED'
      && /quiz-grade\/route\.ts:72-82/.test(error.detail.source),
  );
});

test('quiz.grade: LLM 回 JSON → score 夹在 [0, points]，comment 原样', async () => {
  const { service } = makeService({
    ports: {
      agent: {
        async complete() {
          return { text: '```json\n{"score": 99, "comment": "不错"}\n```' };
        },
      },
    },
  });
  const response = await service.quiz.grade({ question: 'q', userAnswer: 'a', points: 10 });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.score, 10);
  assert.equal(response.body.comment, '不错');
});

test('quiz.grade: LLM 回非 JSON → 半分兜底（上游同分支）', async () => {
  const { service } = makeService({
    ports: { agent: { async complete() { return { text: '不知道' }; } } },
  });
  const response = await service.quiz.grade({ question: 'q', userAnswer: 'a', points: 10 });
  assert.equal(response.body.score, 5);
});

// ── 23 ~ 27. pbl/v2/* ────────────────────────────────────────────────────

test('pbl.evaluate: 缺 project 400；kind 非法 400', async () => {
  const { service } = makeService();
  const missing = await service.pbl.evaluate({ kind: 'task' });
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const badKind = await service.pbl.evaluate({ project: {}, kind: 'nope' });
  assert.equal(badKind.httpStatus, 400);
  assert.equal(badKind.body.errorCode, 'INVALID_REQUEST');
});

test('pbl.evaluate: 没有 pbl 端口 → 抛 E_NOT_IMPLEMENTED', async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.pbl.evaluate({ project: {}, kind: 'final' }),
    (error) => error instanceof ClassroomError && error.kind === 'E_NOT_IMPLEMENTED',
  );
});

test('pbl.evaluate: rubric + grade 端口 → AsyncIterable 产出 evaluation 补丁 + done', async () => {
  const { service } = makeService({
    ports: {
      pbl: {
        rubric() {
          return { dimensions: [] };
        },
        async grade() {
          return { evaluation: { score: 88 } };
        },
      },
    },
  });
  const stream = await service.pbl.evaluate({ project: { id: 'p' }, kind: 'final' });
  const events = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(events.map((e) => e.type), ['project_patch', 'done']);
  assert.equal(events[0].patch.kind, 'evaluation');
  assert.equal(events[0].patch.evaluation.score, 88);
});

test('pbl.instructor: 缺 userMessage 400；有 instructorTurn 端口 → 流式事件', async () => {
  const { service } = makeService({
    ports: {
      pbl: {
        async *instructorTurn() {
          yield { type: 'token', delta: 'hi' };
          yield { type: 'done' };
        },
      },
    },
  });
  const bad = await service.pbl.instructor({ project: {} });
  assert.equal(bad.httpStatus, 400);

  const stream = await service.pbl.instructor({ project: {}, userMessage: '你好' });
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events[0].delta, 'hi');
});

test('pbl.instructor / simulator / updateTask: 端口缺方法 → 抛 E_NOT_IMPLEMENTED（带行号）', async () => {
  const { service } = makeService({ ports: { pbl: { plan() {} } } });
  await assert.rejects(
    () => service.pbl.instructor({ project: {}, userMessage: 'x' }),
    (error) => /pbl\/v2\/instructor\/route\.ts:66-76/.test(error.detail.source),
  );
  await assert.rejects(
    () => service.pbl.simulator({ project: {} }),
    (error) => /pbl\/v2\/simulator\/route\.ts:73/.test(error.detail.source),
  );
  await assert.rejects(
    () => service.pbl.updateTask({ project: {}, action: 'start', microtaskId: 'm1' }),
    (error) => /pbl\/v2\/task\/update\/route\.ts:59-159/.test(error.detail.source),
  );
});

test('pbl.openTask: 缺 phase 400；退到 instructorTurn（userMessage 为空）', async () => {
  const seen = [];
  const { service } = makeService({
    ports: {
      pbl: {
        async *instructorTurn(args) {
          seen.push(args);
          yield { type: 'done' };
        },
      },
    },
  });
  const bad = await service.pbl.openTask({ project: {} });
  assert.equal(bad.httpStatus, 400);

  const stream = await service.pbl.openTask({ project: { id: 'p' }, phase: 'greeting' });
  for await (const _event of stream) void _event;
  assert.equal(seen[0].userMessage, '');
  assert.equal(seen[0].phase, 'greeting');
});

test('pbl.updateTask: 有端口 → apiSuccess 包住端口结果', async () => {
  const { service } = makeService({
    ports: {
      pbl: {
        async updateTask(body) {
          return { project: { ...body.project, started: true }, activatedMicrotaskId: 'm2' };
        },
      },
    },
  });
  const response = await service.pbl.updateTask({ project: { id: 'p' }, action: 'continue_handover' });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.activatedMicrotaskId, 'm2');
});

// ── 挂载纪律：不替换既有实现 ──────────────────────────────────────────────

test('mountPlatform: providers.list 原实现保留，只追加方法', async () => {
  const { service } = makeService();
  assert.equal(typeof service.providers.list, 'function');
  assert.equal(typeof service.providers.set, 'function');
  for (const name of ['probe', 'verifyModel', 'verifyImage', 'verifyPdf', 'verifyVideo', 'azureVoices']) {
    assert.equal(typeof service.providers[name], 'function', `providers.${name} 缺失`);
  }
  const listed = await service.providers.list();
  assert.equal(listed.httpStatus, 200);
  assert.equal(listed.body.success, true);
});
