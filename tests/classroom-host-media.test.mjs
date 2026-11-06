// 批 2（素材 / 媒体 / 解析，17 条）的搬运测试。
//
// 每条 route 至少两例：一个入参校验分支（400/404/415/422）+ 一个正常分支；
// 端口缺失的降级分支单独钉住（`E_NOT_IMPLEMENTED` 抛 / 纯文本 404）。
//
// 断言只看 `httpStatus` 与 body 的关键字段，**不断言整个 body**
// （上游加字段不该让测试红 —— 挂载协议 §0「测试」）。
//
// 跑法：`node --test tests/classroom-host-media.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-host-classroom/', import.meta.url);
const MEDIA_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'services', 'media.js')).href;
const ERRORS_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'errors.js')).href;
const { mountMedia } = await import(MEDIA_URL);
const { ClassroomError } = await import(ERRORS_URL);

// ── 测试装置 ────────────────────────────────────────────────────────────────

/**
 * 内存版 vault：`kv` 用 Map，`materials` 用数组，`assets` 用 Map。
 *
 * 形状按 `packages/dsh-zhiyun-core-classroom-vault/src/index.js` 的方法签名来，
 * 少了哪个方法就少哪条降级分支 —— 这是刻意的（测降级时直接把那一层置 null）。
 */
function makeVault(options = {}) {
  const kv = new Map();
  const materials = [];
  const assets = new Map();

  const vault = {
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
    materials: {
      async put(input) {
        const row = { ...input, id: input.id };
        materials.push(row);
        return row;
      },
      async get(sessionId, id) {
        return materials.find((row) => row.sessionId === sessionId && row.id === id) ?? null;
      },
      async list(sessionId) {
        return materials.filter((row) => row.sessionId === sessionId);
      },
      async remove(sessionId, id) {
        const index = materials.findIndex((row) => row.sessionId === sessionId && row.id === id);
        if (index < 0) return false;
        materials.splice(index, 1);
        return true;
      },
    },
    assets: {
      async put(input) {
        const key = `${input.stageId}/${input.id}`;
        const entry = {
          stageId: input.stageId,
          id: input.id,
          mime: input.mime ?? 'application/octet-stream',
          meta: input.meta ?? {},
        };
        assets.set(key, { entry, data: Buffer.from(input.data) });
        return entry;
      },
      async get(stageId, assetId) {
        return assets.get(`${stageId}/${assetId}`)?.entry ?? null;
      },
      async bytes(stageId, assetId) {
        const hit = assets.get(`${stageId}/${assetId}`);
        if (!hit) {
          const error = new Error('asset not found');
          error.code = 'E_NOT_FOUND';
          throw error;
        }
        return hit.data;
      },
      async list(stageId) {
        return [...assets.values()]
          .filter((item) => item.entry.stageId === stageId)
          .map((item) => item.entry);
      },
      async remove(stageId, assetId) {
        return assets.delete(`${stageId}/${assetId}`);
      },
    },
  };

  if (options.noMaterials) delete vault.materials;
  if (options.noKv) delete vault.kv;
  if (options.noAssets) delete vault.assets;
  return { vault, kv, materials, assets };
}

/** 造一个挂了本批方法的假 service（`service.js` 的命名空间在真实调用里已存在）。 */
function mount({ ports = {}, dataDir = null, log, fetch } = {}) {
  const service = {
    async status() {
      return { state: 'ready' };
    },
    providers: { async list() { return { httpStatus: 200, body: {} }; } },
  };
  const logs = [];
  const deps = {
    ports,
    dataDir,
    providerConfig: { configured: false, get: () => undefined },
    log: log ?? {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    ...(fetch ? { fetch } : {}),
  };
  mountMedia(service, deps);
  return { service, logs };
}

/** 一条已上传的素材（直接写库，省掉一次 create）。 */
async function seedMaterial(harness, overrides = {}) {
  const record = {
    id: overrides.id ?? 'mat_0123456789abcdefghjkmnpqrs',
    ownerId: 'local',
    kind: 'source',
    mime: overrides.mime ?? 'text/plain',
    bytes: overrides.bytes ?? 5,
    originalName: overrides.originalName ?? 'notes.txt',
    displayName: overrides.displayName ?? null,
    folderId: overrides.folderId ?? null,
    derivedFrom: overrides.derivedFrom ?? null,
    status: overrides.status ?? 'ready',
    extraction: overrides.extraction ?? { status: 'idle' },
    createdAt: overrides.createdAt ?? Date.now(),
  };
  await harness.vault.kv.set(`material-library/${record.id}`, record);
  if (overrides.data !== undefined) {
    await harness.vault.assets.put({
      stageId: `material-${record.id}`,
      id: `material-${record.id}`,
      data: overrides.data,
      mime: record.mime,
    });
  }
  return record;
}

const has = (response, key) => Object.prototype.hasOwnProperty.call(response.body ?? {}, key);

// ── 0. 挂载 ────────────────────────────────────────────────────────────────

test('mountMedia 挂到 service.materials / service.media，且不覆盖既有命名空间', async () => {
  const { service } = mount();
  assert.equal(typeof service.materials.list, 'function');
  assert.equal(typeof service.materials.create, 'function');
  assert.equal(typeof service.media.asset, 'function');
  assert.equal(typeof service.media.parsePdf, 'function');
  // 既有方法还在（挂载协议：不整体替换）
  assert.equal(typeof service.status, 'function');
  assert.equal(typeof service.providers.list, 'function');
});

// ── 1. GET/POST /api/materials ─────────────────────────────────────────────

test('materials.list：没有持久层 → 纯文本 404；有 → 200 { materials }', async () => {
  const bare = mount();
  const notFound = await bare.service.materials.list(new URLSearchParams());
  assert.equal(notFound.httpStatus, 404);
  assert.equal(notFound.body, 'Not found');

  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  await seedMaterial(harness);
  const ok = await service.materials.list(new URLSearchParams());
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.materials.length, 1);
  assert.equal(ok.body.materials[0].materialId, 'mat_0123456789abcdefghjkmnpqrs');
  assert.equal(ok.body.materials[0].mediaKind, 'document');
});

test('materials.list：sessionId 空 → 400 MISSING_REQUIRED_FIELD；带 sessionId → 走会话范围', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.list(new URLSearchParams({ sessionId: '  ' }));
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const record = await seedMaterial(harness);
  await harness.vault.materials.put({
    ...record,
    sessionId: 'sess-1',
    extractionStatus: 'done',
  });
  const ok = await service.materials.list(new URLSearchParams({ sessionId: 'sess-1' }));
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.materials.length, 1);
  assert.equal(ok.body.materials[0].materialId, record.id);
});

test('materials.list：limit 非法 → 400 INVALID_REQUEST（真实行号分支）', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const response = await service.materials.list(new URLSearchParams({ sessionId: 'sess-1', limit: '0' }));
  assert.equal(response.httpStatus, 400);
  assert.match(response.body.error, /between 1 and 200/);
});

test('materials.create：415 不支持的 MIME；400 缺文件名；201 正常上传', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });

  const unsupported = await service.materials.create({
    buffer: Buffer.from('hello'),
    filename: 'x.exe',
    mimeType: 'application/x-msdownload',
  });
  assert.equal(unsupported.httpStatus, 415);
  assert.match(unsupported.body.error, /unsupported material mime type/);

  const noName = await service.materials.create({
    buffer: Buffer.from('hello'),
    mimeType: 'text/plain',
  });
  assert.equal(noName.httpStatus, 400);
  assert.equal(noName.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const empty = await service.materials.create({
    buffer: Buffer.alloc(0),
    filename: 'notes.txt',
    mimeType: 'text/plain',
  });
  assert.equal(empty.httpStatus, 400);
  assert.equal(empty.body.error, 'empty body');

  const created = await service.materials.create({
    buffer: Buffer.from('hello'),
    filename: 'notes.txt',
    mimeType: 'application/octet-stream',
    contentLength: 5,
  });
  assert.equal(created.httpStatus, 201);
  assert.match(created.body.materialId, /^mat_[0-9abcdefghjkmnpqrsstvwxyz]{26}$/);
  assert.equal(created.body.mime, 'text/plain', '通用 content-type 由扩展名补出来');
  assert.equal(created.body.bytes, 5);
  assert.ok(created.headers.get('x-request-id'), '上传响应必带 x-request-id');
});

test('materials.create：content-length 超限 → 413 且 body 带 maxBytes', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const response = await service.materials.create({
    buffer: Buffer.from('x'),
    filename: 'big.txt',
    mimeType: 'text/plain',
    contentLength: 50 * 1024 * 1024 + 1,
  });
  assert.equal(response.httpStatus, 413);
  assert.equal(response.body.maxBytes, 50 * 1024 * 1024);
});

// ── 2. GET/DELETE/PATCH /api/materials/[id] ────────────────────────────────

test('materials.get：id 不合语法 → 纯文本 404；合法 → 200 { material }', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.get('../../etc/passwd', {});
  assert.equal(bad.httpStatus, 404);
  assert.equal(bad.body, 'Not found');

  await seedMaterial(harness);
  const ok = await service.materials.get('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.material.materialId, 'mat_0123456789abcdefghjkmnpqrs');
});

test('materials.get：sessionId 空 → 400（与本仓 list 的同一条校验）', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const response = await service.materials.get('mat_0123456789abcdefghjkmnpqrs', new URLSearchParams({ sessionId: '' }));
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'MISSING_REQUIRED_FIELD');
});

test('materials.remove：缺素材 → 404；classic 源 → 200 { deleted:true }', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const missing = await service.materials.remove('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body, 'Not found');

  await seedMaterial(harness, { data: Buffer.from('hello') });
  const ok = await service.materials.remove('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.deleted, true);
  assert.equal(ok.body.materialId, 'mat_0123456789abcdefghjkmnpqrs');
  assert.equal((await harness.vault.kv.keys('material-library/')).length, 0, '元数据要真的删掉');
});

test('materials.remove：派生品 → 409 derivative', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  await seedMaterial(harness, { id: 'mat_aaaaa6789abcdefghjkmnpqrs', derivedFrom: 'mat_0123456789abcdefghjkmnpqrs' });
  const response = await service.materials.remove('mat_aaaaa6789abcdefghjkmnpqrs', {});
  assert.equal(response.httpStatus, 409);
  assert.equal(response.body.reason, 'derivative');
});

test('materials.rename（表外的 PATCH）：400 invalid_body；200 renamed；404 缺素材', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.rename('mat_0123456789abcdefghjkmnpqrs', {}, {});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.reason, 'invalid_body');

  await seedMaterial(harness);
  const ok = await service.materials.rename('mat_0123456789abcdefghjkmnpqrs', { name: '讲义' }, {});
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.status, 'renamed');
  assert.equal(ok.body.name, '讲义');

  const unchanged = await service.materials.rename('mat_0123456789abcdefghjkmnpqrs', { name: '讲义' }, {});
  assert.equal(unchanged.body.status, 'unchanged');

  const missing = await service.materials.rename('mat_zzzzz6789abcdefghjkmnpqrs', { name: 'x' }, {});
  assert.equal(missing.httpStatus, 404);
});

// ── 3. POST /api/materials/[id]/extraction ─────────────────────────────────

test('materials.extraction：缺素材 → 404；idle → 200 pending；再调 → 409', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const missing = await service.materials.extraction('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(missing.httpStatus, 404);

  await seedMaterial(harness, { extraction: { status: 'idle' } });
  const started = await service.materials.extraction('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(started.httpStatus, 200);
  assert.equal(started.body.material.extraction.status, 'pending');

  const again = await service.materials.extraction('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(again.httpStatus, 409);
  assert.match(again.body.error, /extraction is pending/);
});

// ── 4. GET /api/materials/[id]/original（二进制）───────────────────────────

test('materials.original：二进制 200 + Content-Disposition；字节缺失 → 503', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  await seedMaterial(harness, { data: Buffer.from('hello') });

  const ok = await service.materials.original('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.buffer.toString(), 'hello');
  assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(ok.headers.get('Content-Disposition'), /^attachment; filename="notes.txt"/);

  await seedMaterial(harness, { id: 'mat_bbbbb6789abcdefghjkmnpqrs', displayName: '讲义', mime: 'image/png' });
  const inline = await service.materials.original('mat_bbbbb6789abcdefghjkmnpqrs', {});
  assert.equal(inline.httpStatus, 503, '图片没有字节 → 上游 503 unavailable');
  assert.equal(inline.body.reason, 'unavailable');
});

test('materials.original：缺素材 → 纯文本 404', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const response = await service.materials.original('mat_0123456789abcdefghjkmnpqrs', {});
  assert.equal(response.httpStatus, 404);
  assert.equal(response.body, 'Not found');
});

// ── 5-6. materials/folders ─────────────────────────────────────────────────

test('materials.folders：无 materials 端口 → 404；有 → 200 { folders }', async () => {
  const bare = makeVault({ noMaterials: true });
  const without = mount({ ports: { vault: bare.vault } });
  const gated = await without.service.materials.folders.list(new URLSearchParams());
  assert.equal(gated.httpStatus, 404);
  assert.equal(gated.body, 'Not found');

  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const ok = await service.materials.folders.list(new URLSearchParams());
  assert.equal(ok.httpStatus, 200);
  assert.deepEqual(ok.body.folders, []);
});

test('materials.folders.create：400 缺 name；201 新建；同名 → 200 created:false', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.folders.create({}, {});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.reason, 'invalid_body');

  const created = await service.materials.folders.create({ name: '第一章' }, {});
  assert.equal(created.httpStatus, 201);
  assert.equal(created.body.created, true);
  assert.equal(created.body.folder.name, '第一章');

  const again = await service.materials.folders.create({ name: '第一章' }, {});
  assert.equal(again.httpStatus, 200);
  assert.equal(again.body.created, false);

  const tooLong = await service.materials.folders.create({ name: 'x'.repeat(41) }, {});
  assert.equal(tooLong.httpStatus, 400);
  assert.equal(tooLong.body.reason, 'name_tooLong');
});

test('materials.folders.update：404 缺文件夹；200 renamed；409 name_taken', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const missing = await service.materials.folders.update('nope', { name: 'x' }, {});
  assert.equal(missing.httpStatus, 404);

  const first = await service.materials.folders.create({ name: 'A' }, {});
  const second = await service.materials.folders.create({ name: 'B' }, {});
  const renamed = await service.materials.folders.update(first.body.folder.id, { name: 'A2' }, {});
  assert.equal(renamed.httpStatus, 200);
  assert.equal(renamed.body.status, 'renamed');

  const taken = await service.materials.folders.update(second.body.folder.id, { name: 'a2' }, {});
  assert.equal(taken.httpStatus, 409);
  assert.equal(taken.body.reason, 'name_taken');
});

test('materials.folders.remove：204，内容回到顶层；缺文件夹 → 404', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const folder = await service.materials.folders.create({ name: 'A' }, {});
  await seedMaterial(harness, { folderId: folder.body.folder.id });

  const ok = await service.materials.folders.remove(folder.body.folder.id, {});
  assert.equal(ok.httpStatus, 204);
  const kept = await harness.vault.kv.get('material-library/mat_0123456789abcdefghjkmnpqrs');
  assert.equal(kept.folderId, null);

  const missing = await service.materials.folders.remove(folder.body.folder.id, {});
  assert.equal(missing.httpStatus, 404);
});

// ── 7. GET /api/materials/library ──────────────────────────────────────────

test('materials.library：limit 非法 → 400 invalid_limit；正常 → materials + limits + nextBefore', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.library(new URLSearchParams({ limit: '999' }));
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.reason, 'invalid_limit');

  await seedMaterial(harness, { createdAt: 2 });
  await seedMaterial(harness, { id: 'mat_ccccc6789abcdefghjkmnpqrs', createdAt: 1 });
  const ok = await service.materials.library(new URLSearchParams({ limit: '1' }));
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.materials.length, 1);
  assert.equal(ok.body.nextBefore, 'mat_0123456789abcdefghjkmnpqrs');
  assert.equal(ok.body.limits.documentMaxBytes, 50 * 1024 * 1024);
  assert.equal(ok.body.limits.maxCount, 100);

  const noLimits = await service.materials.library(new URLSearchParams({ limits: '0' }));
  assert.equal(has(noLimits, 'limits'), false, 'limits=0 时不返回 limits');
});

// ── 8. POST /api/materials/move ────────────────────────────────────────────

test('materials.move：400 invalid_body；422 not_movable；200 moved；404 缺文件夹', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  const bad = await service.materials.move({ materialIds: [], folderId: null }, {});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.reason, 'invalid_body');

  const noFolder = await service.materials.move(
    { materialIds: ['mat_0123456789abcdefghjkmnpqrs'], folderId: 'ghost' },
    {},
  );
  assert.equal(noFolder.httpStatus, 404);

  const notMovable = await service.materials.move(
    { materialIds: ['mat_0123456789abcdefghjkmnpqrs'], folderId: null },
    {},
  );
  assert.equal(notMovable.httpStatus, 422);
  assert.equal(notMovable.body.reason, 'not_movable');

  const folder = await service.materials.folders.create({ name: 'A' }, {});
  await seedMaterial(harness);
  const moved = await service.materials.move(
    { materialIds: ['mat_0123456789abcdefghjkmnpqrs'], folderId: folder.body.folder.id },
    {},
  );
  assert.equal(moved.httpStatus, 200);
  assert.equal(moved.body.status, 'moved');
  assert.equal(moved.body.movedCount, 1);
});

// ── 9. GET /api/classroom-media/[classroomId]/[...path]（二进制）───────────

test('media.asset：400 非法 classroomId；400 路径穿越；404 非 media/audio；200 正常', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });

  const badId = await service.media.asset('bad id!', ['media', 'a.png']);
  assert.equal(badId.httpStatus, 400);
  assert.equal(badId.body.error, 'Invalid classroom ID');

  const traversal = await service.media.asset('class-1', ['media', '..', 'secret']);
  assert.equal(traversal.httpStatus, 400);
  assert.equal(traversal.body.error, 'Invalid path');

  const wrongDir = await service.media.asset('class-1', ['secret', 'a.png']);
  assert.equal(wrongDir.httpStatus, 404);
  assert.equal(wrongDir.body.error, 'Invalid path');

  await harness.vault.assets.put({
    stageId: 'class-1',
    id: 'asset-1',
    data: Buffer.from('png-bytes'),
    mime: 'image/png',
    meta: { name: 'slide.png' },
  });
  const ok = await service.media.asset('class-1', ['media', 'slide.png']);
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.mimeType, 'image/png');
  assert.equal(ok.buffer.toString(), 'png-bytes');
  assert.equal(ok.headers.get('Accept-Ranges'), 'bytes');
});

test('media.asset：Range 206 / 416，头部按上游', async () => {
  const harness = makeVault();
  const { service } = mount({ ports: { vault: harness.vault } });
  await harness.vault.assets.put({
    stageId: 'class-1',
    id: 'asset-1',
    data: Buffer.from('0123456789'),
    mime: 'audio/mpeg',
    meta: { name: 'voice.mp3' },
  });

  const partial = await service.media.asset('class-1', ['audio', 'voice.mp3'], { range: 'bytes=2-5' });
  assert.equal(partial.httpStatus, 206);
  assert.equal(partial.buffer.toString(), '2345');
  assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/10');

  const unsatisfiable = await service.media.asset('class-1', ['audio', 'voice.mp3'], { range: 'bytes=99-' });
  assert.equal(unsatisfiable.httpStatus, 416);
  assert.equal(unsatisfiable.headers.get('Content-Range'), 'bytes */10');

  const missing = await service.media.asset('class-1', ['audio', 'nope.mp3']);
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body.error, 'Not found');
});

// ── 10. POST /api/parse-pdf ────────────────────────────────────────────────

test('media.parsePdf：端口缺失 → 抛 E_NOT_IMPLEMENTED（带源行号）', async () => {
  const { service } = mount();
  await assert.rejects(
    () => service.media.parsePdf({ buffer: Buffer.from('pdf'), filename: 'a.pdf' }),
    (error) => {
      assert.ok(error instanceof ClassroomError);
      assert.equal(error.code, 'E_NOT_IMPLEMENTED');
      assert.match(error.detail.source, /app\/api\/parse-pdf\/route\.ts:\d+-\d+/);
      return true;
    },
  );
});

test('media.parsePdf：400 没有文件；200 data 带 metadata', async () => {
  const calls = [];
  const ports = {
    media: {
      async parsePdf(buffer, options) {
        calls.push({ length: buffer.byteLength, options });
        return { ok: true, provider: 'unpdf', text: 'hello', images: [], metadata: { pageCount: 2 } };
      },
    },
  };
  const { service } = mount({ ports });

  const bad = await service.media.parsePdf({});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const ok = await service.media.parsePdf({
    buffer: Buffer.from('%PDF-1.4'),
    filename: '讲义.pdf',
    mimeType: 'application/pdf',
  });
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.data.text, 'hello');
  assert.equal(ok.body.data.metadata.pageCount, 2);
  assert.equal(ok.body.data.metadata.fileName, '讲义.pdf');
  assert.equal(ok.body.data.metadata.fileSize, 8);
  assert.equal(has(ok.body.data, 'ok'), false, '端口的 ok 信封不进 body');
  assert.equal(calls.length, 1);
});

test('media.parsePdf：端口报错 → 500 PARSE_FAILED', async () => {
  const ports = {
    media: {
      async parsePdf() {
        return { ok: false, code: 'E_UPSTREAM_ERROR', message: 'mineru 502' };
      },
    },
  };
  const { service } = mount({ ports });
  const response = await service.media.parsePdf({ buffer: Buffer.from('x'), filename: 'a.pdf' });
  assert.equal(response.httpStatus, 500);
  assert.equal(response.body.errorCode, 'PARSE_FAILED');
  assert.equal(response.body.error, 'mineru 502');
});

// ── 11. POST /api/transcription ────────────────────────────────────────────

test('media.transcribe：端口缺失 → 抛 E_NOT_IMPLEMENTED；400 没有音频；200 { text }', async () => {
  const bare = mount();
  await assert.rejects(
    () => bare.service.media.transcribe({ buffer: Buffer.from('wav') }),
    (error) => error.code === 'E_NOT_IMPLEMENTED',
  );

  const seen = [];
  const ports = {
    media: {
      async asr(buffer, options) {
        seen.push({ length: buffer.byteLength, options });
        return { ok: true, provider: 'openai-whisper', text: '同学们好' };
      },
    },
  };
  const { service } = mount({ ports });

  const bad = await service.media.transcribe({});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error, 'Audio file is required');

  const ok = await service.media.transcribe(
    { buffer: Buffer.from('wav-bytes'), filename: 'a.wav' },
    { modelId: '  whisper-1  ', language: 'zh' },
  );
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.text, '同学们好');
  assert.equal(seen[0].options.model, 'whisper-1', 'modelId 要 trim');
  assert.equal(seen[0].options.language, 'zh');
});

// ── 12. POST /api/proxy-media（二进制 + 上游 HTTP）────────────────────────

test('media.proxy：400 缺 url；403 内网地址；200 二进制；502 上游 5xx', async () => {
  const { service } = mount();

  const bad = await service.media.proxy(undefined, {});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const blocked = await service.media.proxy('http://127.0.0.1:8080/secret', {});
  assert.equal(blocked.httpStatus, 403);
  assert.equal(blocked.body.errorCode, 'INVALID_URL');

  const okFetch = async () => new Response(Buffer.from('image-bytes'), {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': '11' },
  });
  const ok = await mount({ fetch: okFetch }).service.media.proxy('https://cdn.example.com/a.png', {});
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.mimeType, 'image/png');
  assert.equal(ok.buffer.toString(), 'image-bytes');
  assert.equal(ok.headers.get('Cache-Control'), 'private, max-age=3600');

  const failing = async () => new Response('boom', { status: 500 });
  const upstream = await mount({ fetch: failing }).service.media.proxy('https://cdn.example.com/a.png', {});
  assert.equal(upstream.httpStatus, 502);
  assert.equal(upstream.body.errorCode, 'UPSTREAM_ERROR');
});

test('media.proxy：重定向被重新校验（跳内网 → 403）', async () => {
  const fetchImpl = async (url) => (url === 'https://cdn.example.com/a.png'
    ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/x' } })
    : new Response('unexpected', { status: 200 }));
  const { service } = mount({ fetch: fetchImpl });
  const response = await service.media.proxy('https://cdn.example.com/a.png', {});
  assert.equal(response.httpStatus, 403);
  assert.equal(response.body.errorCode, 'INVALID_URL');
});

// ── 13. GET /api/comfyui-workflows ─────────────────────────────────────────

test('media.comfyuiWorkflows：dataDir 为 null → 空清单 200（上游「目录不存在」）', async () => {
  const { service } = mount({ dataDir: null });
  const response = await service.media.comfyuiWorkflows();
  assert.equal(response.httpStatus, 200);
  assert.deepEqual(response.body.workflows, []);
});

test('media.comfyuiWorkflows：有 public/ → 按名字排序，只认约定文件名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zyc-comfy-'));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, 'public', 'comfyui-portrait.json'), '{}');
  await writeFile(join(dir, 'public', 'my-workflow.json'), '{}');
  await writeFile(join(dir, 'public', 'readme.md'), '#');

  const { service } = mount({ dataDir: dir });
  const response = await service.media.comfyuiWorkflows();
  assert.equal(response.httpStatus, 200);
  assert.deepEqual(
    response.body.workflows.map((entry) => entry.id),
    ['my-workflow.json', 'comfyui-portrait.json'],
    '按显示名排序（My Workflow < Portrait）',
  );
  assert.equal(response.body.workflows[1].name, 'Portrait');
});

// ── 14. POST /api/generate/image ───────────────────────────────────────────

test('media.image：端口缺失 → 抛；400 缺 prompt；200 result', async () => {
  await assert.rejects(
    () => mount().service.media.image({ prompt: 'x' }),
    (error) => error.code === 'E_NOT_IMPLEMENTED'
      && /generate\/image\/route\.ts:\d+-\d+/.test(error.detail.source),
  );

  const ports = {
    media: {
      async image(prompt, options) {
        return { ok: true, url: 'https://cdn/x.png', width: options.width ?? 512, height: 512 };
      },
    },
  };
  const { service } = mount({ ports });

  const bad = await service.media.image({});
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error, 'Missing prompt');

  const ok = await service.media.image({ prompt: '一只猫', width: 768 });
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.result.width, 768);
  assert.equal(ok.body.result.url, 'https://cdn/x.png');
  assert.equal(has(ok.body.result, 'ok'), false);
});

test('media.image：provider 拒绝（SensitiveContent）→ 400 CONTENT_SENSITIVE', async () => {
  const ports = {
    media: {
      async image() {
        return { ok: false, code: 'E_UPSTREAM_ERROR', message: 'OutputImageSensitiveContentDetected' };
      },
    },
  };
  const { service } = mount({ ports });
  const response = await service.media.image({ prompt: 'x' });
  assert.equal(response.httpStatus, 400);
  assert.equal(response.body.errorCode, 'CONTENT_SENSITIVE');
});

// ── 15. POST /api/generate/tts ─────────────────────────────────────────────

test('media.tts：端口缺失 → 抛；400 缺字段；200 base64', async () => {
  await assert.rejects(
    () => mount().service.media.tts({ text: 'hi', audioId: 'a1' }),
    (error) => error.code === 'E_NOT_IMPLEMENTED',
  );

  const ports = {
    media: {
      async tts(text, options) {
        return { ok: true, bytes: Buffer.from('mp3-bytes'), format: 'mp3', voice: options.voice };
      },
    },
  };
  const { service } = mount({ ports });

  const bad = await service.media.tts({ text: 'hi' });
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const blankVoice = await service.media.tts({ text: 'hi', audioId: 'a1', ttsVoice: '   ' });
  assert.equal(blankVoice.httpStatus, 400);

  const ok = await service.media.tts({ text: 'hi', audioId: 'a1', ttsVoice: 'narrator' });
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.audioId, 'a1');
  assert.equal(ok.body.format, 'mp3');
  assert.equal(Buffer.from(ok.body.base64, 'base64').toString(), 'mp3-bytes');
});

// ── 16. POST /api/generate/video（端口无 video → 抛）──────────────────────

test('media.video：端口没有 video 方法 → 抛 E_NOT_IMPLEMENTED（不编结果）', async () => {
  const ports = {
    media: {
      async tts() {
        return { ok: true };
      },
    },
  };
  const { service } = mount({ ports });
  await assert.rejects(
    () => service.media.video({ prompt: '一只猫' }),
    (error) => error.code === 'E_NOT_IMPLEMENTED'
      && /generate\/video\/route\.ts:\d+-\d+/.test(error.detail.source),
  );
});

// ── 17. POST /api/generate/voice（端口无 voice → 抛）──────────────────────

test('media.voice：端口缺失 → 抛；400 缺 voiceId；400 缺 descriptor', async () => {
  await assert.rejects(
    () => mount().service.media.voice({ voiceId: 'v1', descriptor: { identity: 'x' } }),
    (error) => error.code === 'E_NOT_IMPLEMENTED'
      && /generate\/voice\/route\.ts:\d+-\d+/.test(error.detail.source),
  );

  const ports = {
    media: {
      async voice() {
        return { ok: true, voiceId: 'v1', registered: true };
      },
    },
  };
  const { service } = mount({ ports });

  const noVoiceId = await service.media.voice({});
  assert.equal(noVoiceId.httpStatus, 400);
  assert.equal(noVoiceId.body.error, 'voiceId is required');

  const noDesign = await service.media.voice({ voiceId: 'v1' });
  assert.equal(noDesign.httpStatus, 400);
  assert.match(noDesign.body.error, /descriptor or referenceAudioBase64/);

  const ok = await service.media.voice({ voiceId: 'v1', descriptor: { identity: '女声' } });
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.voiceId, 'v1');
  assert.equal(ok.body.registered, true);
});

// ── 端口缺失的统一降级：素材库那 6 条走纯文本 404 ─────────────────────────

test('vault 缺失时：library/folders/move 全部走上游「没有持久层」的纯文本 404', async () => {
  const { service } = mount();
  for (const response of [
    await service.materials.library(new URLSearchParams()),
    await service.materials.folders.list(new URLSearchParams()),
    await service.materials.move({ materialIds: ['x'], folderId: null }, {}),
    await service.materials.original('mat_0123456789abcdefghjkmnpqrs', {}),
  ]) {
    assert.equal(response.httpStatus, 404);
    assert.equal(response.body, 'Not found');
  }
});
