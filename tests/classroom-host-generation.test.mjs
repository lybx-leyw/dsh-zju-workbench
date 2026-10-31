// dsh-zhiyun-host-classroom 批 1（生成 / 运行 / 舞台，20 条 route）的行为测试。
//
// 测的是**形状与分支**，不是算法：
//   1. 每条 route 的入参校验分支（400 / 404 / 409）与正常分支各至少一例；
//   2. 端口缺失时的分支必须与上游「没有持久层」那一条**同答案**（不是自造错误）；
//   3. 流式接口返回 `AsyncIterable`，失败时返回响应对象（`isEventStream` 区分）。
//
// 所有端口都是**内存版**（`memoryVault` / `memoryGenerate` / `memoryStage`）：
// 不连 pg、不调模型 —— 那是人工验证。跑法：`node --test tests/classroom-host-generation.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-host-classroom/', import.meta.url);
const SRC = (name) => pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', name)).href;

const { createClassroomService, inspectShape } = await import(SRC('service.js'));
const { mountGeneration, isEventStream, openRunStreamsOf } = await import(
  SRC('services/generation.js')
);
const { createDegradedProviderConfig } = await import(SRC('upstream/provider-config.js'));

// ── 测试装置 ────────────────────────────────────────────────────────────────

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** 上游 run id 的格式（`run-` + 16），喂给 `isRunId`。 */
const RUN_A = 'run-aaaaaaaaaaaaaaaa';
const RUN_B = 'run-bbbbbbbbbbbbbbbb';
const STAGE_1 = 'stage-1';

function vError(code, message) {
  const error = new Error(message ?? code);
  error.code = code;
  return error;
}

/**
 * 内存版 `ctx.zhiyunClassroomVault`：方法与 `dsh-zhiyun-core-classroom-vault` 的
 * `classroom.*` / `runs.*` 同名同参（只实现本批用到的那几个）。
 */
function memoryVault({ ownerId = 'local' } = {}) {
  /** @type {Map<string, object>} */
  const stages = new Map();
  /** @type {Map<string, object>} */
  const runs = new Map();
  /** @type {Map<string, object[]>} */
  const events = new Map();
  /** @type {Map<string, Map<string, object>>} */
  const steps = new Map();
  /** @type {Map<string, object>} */
  const commands = new Map();

  const summaryOf = (doc) => ({
    id: doc.stage.id,
    name: doc.stage.name,
    description: doc.stage.description,
    sceneCount: (doc.scenes ?? []).length,
    createdAt: doc.stage.createdAt,
    updatedAt: doc.stage.updatedAt,
  });

  return {
    /** 直接塞一门课（测试用；等价于「这条 route 之前有人建过」）。 */
    seedStage({ id = STAGE_1, name = '线性代数', isPublic = false, owner = ownerId } = {}) {
      const now = Date.now();
      stages.set(id, {
        stage: { id, name, createdAt: now, updatedAt: now },
        stageMeta: {
          stageId: id,
          ownerId: owner,
          isPublic,
          publishedAt: isPublic ? now : null,
          generationComplete: false,
          deletedAt: null,
        },
        scenes: [],
        outline: { outlines: [], requirement: name, generationComplete: false },
      });
      return stages.get(id);
    },
    /** 直接塞一条 run。 */
    seedRun(run) {
      runs.set(run.id, { ownerId, seq: 0, createdAt: 1, updatedAt: 1, ...run });
      return runs.get(run.id);
    },
    seedEvents(runId, list) {
      events.set(runId, list.map((event, index) => ({
        runId,
        seq: index + 1,
        ts: 1000 + index,
        type: event.type,
        data: event.data ?? null,
      })));
    },
    get stageCount() {
      return stages.size;
    },

    classroom: {
      async list() {
        return { items: [...stages.values()].map(summaryOf), next: null };
      },
      async load(id) {
        const doc = stages.get(id);
        if (!doc) throw vError('E_NOT_FOUND', `课堂不存在：${id}`);
        return {
          id,
          stage: doc.stage,
          stageMeta: doc.stageMeta ?? null,
          meta: doc.stage,
          scenes: doc.scenes ?? [],
          outline: doc.outline ?? null,
          assets: [],
          assetRefs: [],
          degraded: false,
          errors: [],
        };
      },
      async meta(id) {
        return stages.get(id)?.stage ?? null;
      },
      async create(doc) {
        const id = doc.stage?.id ?? doc.id;
        if (stages.has(id)) throw vError('E_CONFLICT', `课堂已存在：${id}`);
        stages.set(id, {
          ...doc,
          stage: { ...(doc.stage ?? {}), id },
          stageMeta: doc.stageMeta ?? {
            stageId: id,
            ownerId,
            isPublic: false,
            publishedAt: null,
            generationComplete: false,
            deletedAt: null,
          },
        });
        return stages.get(id);
      },
      async save(id, doc) {
        const prev = stages.get(id);
        if (!prev) throw vError('E_NOT_FOUND', `课堂不存在：${id}`);
        stages.set(id, {
          ...prev,
          ...doc,
          stage: { ...(prev.stage ?? {}), ...(doc.stage ?? {}), id },
        });
        return stages.get(id);
      },
      async remove(id) {
        return stages.delete(id);
      },
    },

    runs: {
      async put(run) {
        runs.set(run.id, { ownerId, seq: 0, createdAt: 1, updatedAt: 1, ...run });
        return runs.get(run.id);
      },
      async get(id) {
        return runs.get(id) ?? null;
      },
      async list(params = {}) {
        const states = params.state
          ? new Set(Array.isArray(params.state) ? params.state : [params.state])
          : null;
        const rows = [...runs.values()];
        return states ? rows.filter((row) => states.has(row.state)) : rows;
      },
      async patch(id, patch = {}) {
        const current = runs.get(id);
        if (!current) throw vError('E_NOT_FOUND', `run 不存在：${id}`);
        runs.set(id, { ...current, ...patch, id });
        return runs.get(id);
      },
      async remove(id) {
        return runs.delete(id);
      },
      async appendEvent(runId, event = {}) {
        const run = runs.get(runId);
        if (!run) throw vError('E_NOT_FOUND', `run 不存在：${runId}`);
        const list = events.get(runId) ?? [];
        const row = {
          runId,
          seq: list.length + 1,
          ts: event.ts ?? 2000,
          type: String(event.type ?? 'event'),
          data: event.data ?? null,
        };
        list.push(row);
        events.set(runId, list);
        runs.set(runId, { ...run, seq: row.seq, updatedAt: Date.now() });
        return row;
      },
      async events(runId, params = {}) {
        const after = Number(params.after ?? 0);
        const limit = Number(params.limit ?? 200);
        return (events.get(runId) ?? []).filter((row) => row.seq > after).slice(0, limit);
      },
      async putStep(runId, stepId, output) {
        const map = steps.get(runId) ?? new Map();
        map.set(stepId, output);
        steps.set(runId, map);
        return { id: stepId, output };
      },
      async steps(runId) {
        return [...(steps.get(runId) ?? new Map()).entries()]
          .map(([id, output]) => ({ id, output }));
      },
      async putCommand(runId, commandId, type, result) {
        const key = `${runId}/${commandId}`;
        if (!commands.has(key)) commands.set(key, { type, result });
        return commands.get(key);
      },
      async command(runId, commandId) {
        return commands.get(`${runId}/${commandId}`) ?? null;
      },
    },
  };
}

/**
 * 内存版 `ctx.zhiyunClassroomGenerate`：签名照 `dsh-zhiyun-core-classroom-generate`
 * 的 `start / stream / get / list / cancel / resume`。
 */
function memoryGenerate({ runId = RUN_A } = {}) {
  const runs = new Map();
  return {
    started: [],
    async start(brief, opts = {}) {
      this.started.push({ brief, opts });
      const id = opts.runId ?? runId;
      runs.set(id, {
        runId: id,
        stageId: opts.stageId ?? null,
        status: 'running',
        startedAt: 1,
        endedAt: null,
        error: null,
        phases: [],
      });
      return { runId: id, stageId: opts.stageId ?? null, status: 'running' };
    },
    stream(id) {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'phase-start', ts: 1, data: { phase: 'outline' }, phase: 'live', runId: id };
        },
      };
    },
    get(id) {
      return runs.get(id) ?? null;
    },
    list() {
      return [...runs.values()];
    },
    async resume(id) {
      const record = runs.get(id);
      if (!record) throw vError('E_NOT_FOUND', `run 不存在：${id}`);
      return { runId: id, status: 'running' };
    },
    cancel() {
      return true;
    },
  };
}

/** 内存版 `ctx.zhiyunClassroomStage`（stage_meta 的写侧）。 */
function memoryStage(vault) {
  const writes = [];
  return {
    writes,
    async access(stageId) {
      const doc = vault.classroom && (await vault.classroom.load(stageId).catch(() => null));
      const meta = doc?.stageMeta;
      if (!meta) return null;
      return {
        stageId,
        ownerId: meta.ownerId,
        name: doc.stage.name,
        isPublic: meta.isPublic === true,
        publishedAt: meta.publishedAt ?? null,
        generationComplete: meta.generationComplete === true,
        source: 'document',
        deletedAt: meta.deletedAt ?? null,
      };
    },
    async setPublished(stageId, isPublic, publishedAt) {
      writes.push({ stageId, isPublic, publishedAt });
      return true;
    },
    async markComplete(stageId) {
      writes.push({ stageId, generationComplete: true });
      return true;
    },
  };
}

/** 一个只满足 `mountGeneration` 需要的 service 形状（不测 service.js 本体）。 */
function baseService() {
  return {
    async status() {
      return { state: 'ready', version: '0.1.0', detail: {} };
    },
    async generate() {
      throw new Error('service.js 的空壳');
    },
    runs: {
      async get() { throw new Error('stub'); },
      async cancel() { throw new Error('stub'); },
    },
    classroom: {},
    export: {},
    providers: { async list() {}, async set() {} },
  };
}

/** 直接挂载（端口全由测试给）。 */
function mountWith({ ports = {}, owner, providerConfig } = {}) {
  const service = baseService();
  mountGeneration(service, {
    ports,
    log: quiet,
    dataDir: '/tmp/zyc-test',
    providerConfig: providerConfig ?? createDegradedProviderConfig(),
    ...(owner ? { owner } : {}),
  });
  return service;
}

/** 走 `createClassroomService` 的 `mounts` 接缝（编排层真实的装配路径）。 */
function mountThroughService(ports = {}) {
  return createClassroomService({
    version: '0.1.0',
    providerConfig: createDegradedProviderConfig(),
    log: quiet,
    ports: {
      get vault() { return ports.vault ?? null; },
      get generate() { return ports.generate ?? null; },
      get stage() { return ports.stage ?? null; },
      get media() { return ports.media ?? null; },
    },
    mounts: [mountGeneration],
    dataDir: '/tmp/zyc-test',
  });
}

/** 一个带角色的 owner（publish 的角色判定要它）。 */
const publisherOwner = {
  async resolve() {
    return {
      ok: true,
      ownerId: 'local',
      kind: 'account',
      roles: ['course:publish'],
      headers: new Headers(),
    };
  },
};

async function collect(stream) {
  const out = [];
  for await (const event of stream) out.push(event);
  return out;
}

// ── 装配 ────────────────────────────────────────────────────────────────────

test('mountGeneration 通过 createClassroomService 的 mounts 挂上，且不破坏 §4 的形状', () => {
  const service = mountThroughService();
  assert.deepEqual(inspectShape(service), [], '形状自检必须仍为空');
  assert.equal(typeof service.generate.start, 'function');
  assert.equal(typeof service.generate.capabilities, 'function');
  assert.equal(typeof service.generate.job, 'function');
  assert.equal(typeof service.generate, 'function', 'generate 必须保持可调用');
  for (const name of [
    'list', 'start', 'get', 'cancel', 'confirmOutline', 'events', 'allEvents', 'holdOutline', 'retry',
  ]) {
    assert.equal(typeof service.runs[name], 'function', `缺少 runs.${name}`);
  }
  for (const name of [
    'list', 'create', 'get', 'put', 'patch', 'remove', 'freshness', 'markComplete', 'manifest',
    'publish', 'scenes', 'putScenes', 'status', 'unpublish', 'meta',
  ]) {
    assert.equal(typeof service.stages[name], 'function', `缺少 stages.${name}`);
  }
});

// ── 2. generate.capabilities ────────────────────────────────────────────────

test('generate.capabilities：没有 media 端口时 formats 为空（上游「一台 extractor 都没有」同答案）', async () => {
  const service = mountWith();
  const { httpStatus, body } = await service.generate.capabilities();

  assert.equal(httpStatus, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.capabilities, {
    webSearch: false, imageGeneration: false, videoGeneration: false, tts: false,
  });
  assert.deepEqual(body.materials.formats, []);
  assert.equal(body.materials.maxCount, 5);
  assert.equal(body.materials.maxTotalBytes, 150 * 1024 * 1024);
});

test('generate.capabilities：media 端口报哪几种可读，就只出那几种 format', async () => {
  const service = mountWith({
    ports: {
      media: { async extractableMimeTypes() { return ['application/pdf', 'image/png']; } },
    },
    providerConfig: { ...createDegradedProviderConfig(), getCapabilities: async () => ({ webSearch: true }) },
  });
  const { body } = await service.generate.capabilities();

  assert.deepEqual(body.materials.formats.map((format) => format.id), ['pdf', 'png']);
  assert.deepEqual(body.capabilities, { webSearch: true });
});

// ── 1. generate.start ──────────────────────────────────────────────────────

test('generate.start：缺 requirement 回 400 MISSING_REQUIRED_FIELD（上游 parseClassroomJobBody）', async () => {
  const service = mountWith({ ports: { generate: memoryGenerate() } });
  const { httpStatus, body } = await service.generate.start({});

  assert.equal(httpStatus, 400);
  assert.equal(body.success, false);
  assert.equal(body.errorCode, 'MISSING_REQUIRED_FIELD');
});

test('generate.start：pdfContent 是「移除的字段」，400 INVALID_REQUEST', async () => {
  const service = mountWith({ ports: { generate: memoryGenerate() } });
  const { httpStatus, body } = await service.generate.start({ requirement: 'x', pdfContent: '...' });

  assert.equal(httpStatus, 400);
  assert.equal(body.errorCode, 'INVALID_REQUEST');
  assert.match(body.error, /pdfContent is no longer accepted/);
});

test('generate.start：正常分支 202 + job 视图 + { runId, events }', async () => {
  const generate = memoryGenerate();
  const service = mountWith({ ports: { generate } });
  const result = await service.generate.start({ requirement: '讲讲特征值' }, { origin: 'https://x' });

  assert.equal(result.httpStatus, 202);
  assert.equal(result.body.success, true);
  assert.equal(result.body.jobId, RUN_A);
  assert.equal(result.body.status, 'queued');
  assert.equal(result.body.pollUrl, `https://x/api/generate-classroom/${RUN_A}`);
  assert.equal(result.runId, RUN_A);
  assert.ok(isEventStream(result.events), 'events 必须是 AsyncIterable');
  assert.equal(generate.started.length, 1, '必须真的接到 ports.generate.start');
  assert.equal(generate.started[0].brief.requirement, '讲讲特征值');
  assert.equal(generate.started[0].brief.outlineReview, 'auto');

  const events = await collect(result.events);
  assert.equal(events[0].type, 'phase-start');
});

test('generate.start：端口 generate 缺失 → 抛 E_NOT_IMPLEMENTED（不是 404）', async () => {
  const service = mountWith();
  await assert.rejects(() => service.generate.start({ requirement: 'x' }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /generate-classroom\/route\.ts:30-83/);
    return true;
  });
});

// ── 3. generate.job ────────────────────────────────────────────────────────

test('generate.job：id 不合规 400；不认识 404 INVALID_REQUEST', async () => {
  const service = mountWith({ ports: { generate: memoryGenerate() } });

  const bad = await service.generate.job('bad id!');
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'INVALID_REQUEST');

  const missing = await service.generate.job(RUN_B);
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body.error, 'Classroom generation job not found');
});

test('generate.job：正常分支回 job 视图（jobId 就是 runId）', async () => {
  const generate = memoryGenerate();
  const service = mountWith({ ports: { generate } });
  await service.generate.start({ requirement: 'x' });

  const { httpStatus, body } = await service.generate.job(RUN_A);
  assert.equal(httpStatus, 200);
  assert.equal(body.jobId, RUN_A);
  assert.equal(body.runId, RUN_A);
  assert.equal(body.runState, 'preparing');
  assert.equal(body.done, false);
});

// ── 4. runs.list / runs.start ──────────────────────────────────────────────

test('runs.list：没有 active=1 回 400（上游只列活跃 run）', async () => {
  const service = mountWith({ ports: { vault: memoryVault() } });
  const { httpStatus, body } = await service.runs.list();

  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'Only the active runs are listed: pass active=1');
});

test('runs.list：active=1 回活跃 run 与上限；已完成的 run 不出现', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', step: 'research' });
  vault.seedRun({ id: RUN_B, state: 'completed', step: null });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.runs.list({ active: '1' });
  assert.equal(httpStatus, 200);
  assert.deepEqual(body.runs.map((run) => run.id), [RUN_A]);
  assert.equal(body.limits.maxActive, 2);
  assert.equal(body.limits.maxWaiting, 10);
});

test('runs.list：没有 vault → 404 纯文本（上游无持久层分支）', async () => {
  const service = mountWith();
  const result = await service.runs.list({ active: '1' });
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body, 'Not found');
});

test('runs.start：body 不合法 400；正常 202 { run } + { runId, events }', async () => {
  const generate = memoryGenerate();
  const service = mountWith({ ports: { generate } });

  const bad = await service.runs.start({ materialIds: [] });
  assert.equal(bad.httpStatus, 400);
  assert.match(bad.body.error, /requirement/);

  const result = await service.runs.start({ requirement: '讲讲行列式' });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.body.run.id, RUN_A);
  assert.equal(result.body.run.state, 'preparing');
  assert.equal(result.runId, RUN_A);
  assert.ok(isEventStream(result.events));
  assert.equal(generate.started[0].brief.outlineReview, 'wait', '默认是 wait（上游默认值）');
});

test('runs.start：端口 generate 缺失 → 抛（上游这条没有无持久层分支）', async () => {
  const service = mountWith({ ports: { vault: memoryVault() } });
  await assert.rejects(() => service.runs.start({ requirement: 'x' }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /generation-runs\/route\.ts:43-81/);
    return true;
  });
});

// ── 6. runs.get / runs.cancel ──────────────────────────────────────────────

test('runs.get：不认识 / 不是 run id 都是 404 纯文本', async () => {
  const vault = memoryVault();
  const service = mountWith({ ports: { vault } });

  const unknown = await service.runs.get(RUN_B);
  assert.equal(unknown.httpStatus, 404);
  assert.equal(unknown.body, 'Not found');

  const malformed = await service.runs.get('stage-1');
  assert.equal(malformed.httpStatus, 404);
});

test('runs.get：回 run 快照 + 媒体状态 + failureSeq（日志细节由事件重算）', async () => {
  const vault = memoryVault();
  vault.seedRun({
    id: RUN_A,
    state: 'paused',
    step: 'outline',
    seq: 4,
    input: { materialIds: [] },
    progress: { scenesTotal: 2, scenesCompleted: 1 },
    error: { step: 'outline', message: 'boom' },
    stageId: STAGE_1,
  });
  vault.seedEvents(RUN_A, [
    { type: 'state', data: { state: 'generating' } },
    { type: 'step_failed', data: { step: 'outline', message: 'boom' } },
    { type: 'media', data: { elementId: 'el-1', status: 'failed' } },
  ]);
  await vault.runs.putStep(RUN_A, 'media:el-1', {
    mediaType: 'image',
    status: 'failed',
    message: 'provider down',
    errorCode: 'UPSTREAM_ERROR',
  });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.runs.get(RUN_A);
  assert.equal(httpStatus, 200);
  assert.equal(body.run.id, RUN_A);
  assert.equal(body.run.error.failureSeq, 2);
  assert.equal(body.run.media['el-1'].status, 'failed');
  assert.equal(body.run.media['el-1'].failureSeq, 3);
  assert.equal(body.run.media['el-1'].retryable, true);
  assert.equal(body.run.progress.scenesTotal, 2);
});

test('runs.cancel（DELETE）：有课的 run 回 409 RUN_STATE_CONFLICT', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', stageId: STAGE_1 });
  const service = mountWith({ ports: { vault, generate: memoryGenerate() } });

  const { httpStatus, body } = await service.runs.cancel(RUN_A);
  assert.equal(httpStatus, 409);
  assert.equal(body.errorCode, 'RUN_STATE_CONFLICT');
});

test('runs.cancel（DELETE）：没课 → ended；重复 discard 同答案', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', stageId: null });
  const service = mountWith({ ports: { vault, generate: memoryGenerate() } });

  const first = await service.runs.cancel(RUN_A);
  assert.equal(first.httpStatus, 200);
  assert.equal(first.body.success, true);
  assert.equal(first.body.state, 'ended');
  assert.equal((await vault.runs.get(RUN_A)).state, 'ended');

  const second = await service.runs.cancel(RUN_A);
  assert.equal(second.httpStatus, 200);
  assert.equal(second.body.state, 'ended');
});

test('runs.cancel：不认识的 run 回 404 纯文本', async () => {
  const service = mountWith({ ports: { vault: memoryVault(), generate: memoryGenerate() } });
  const result = await service.runs.cancel(RUN_B);
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body, 'Not found');
});

// ── 7. runs.confirmOutline ─────────────────────────────────────────────────

test('runs.confirmOutline：commandId 缺失 400；revision 不匹配 409', async () => {
  const vault = memoryVault();
  vault.seedRun({
    id: RUN_A,
    state: 'awaiting_outline_confirmation',
    outlineRevision: 2,
    outline: { outlines: [{ id: 'o1' }] },
    input: { materialIds: [], outlineReview: 'wait' },
  });
  const service = mountWith({ ports: { vault } });

  const bad = await service.runs.confirmOutline(RUN_A, { outlineRevision: 2 });
  assert.equal(bad.httpStatus, 400);
  assert.match(bad.body.error, /commandId/);

  const conflict = await service.runs.confirmOutline(RUN_A, { commandId: 'cmd-1', outlineRevision: 1 });
  assert.equal(conflict.httpStatus, 409);
  assert.match(conflict.body.error, /revision 2/);
});

test('runs.confirmOutline：正常分支把 run 推回 generating，并按 commandId 幂等', async () => {
  const vault = memoryVault();
  vault.seedRun({
    id: RUN_A,
    state: 'awaiting_outline_confirmation',
    outlineRevision: 1,
    outline: { outlines: [{ id: 'o1' }, { id: 'o2' }] },
    input: { materialIds: [], outlineReview: 'wait' },
    progress: { scenesTotal: 0, scenesCompleted: 0 },
  });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.runs.confirmOutline(RUN_A, {
    commandId: 'cmd-1',
    outlineRevision: 1,
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.state, 'generating');
  assert.equal(body.outlineRevision, 1);
  const run = await vault.runs.get(RUN_A);
  assert.equal(run.state, 'generating');
  assert.equal(run.progress.scenesTotal, 2);

  const again = await service.runs.confirmOutline(RUN_A, { commandId: 'cmd-1', outlineRevision: 1 });
  assert.deepEqual(again.body, body, '同一个 commandId 必须回第一次的结果');
  const seqAfter = (await vault.runs.get(RUN_A)).seq;
  assert.equal((await vault.runs.get(RUN_A)).seq, seqAfter, '重复命令不应再写事件');
});

test('runs.confirmOutline：编辑过的 outline 走一次 revision +1', async () => {
  const vault = memoryVault();
  vault.seedRun({
    id: RUN_A,
    state: 'awaiting_outline_confirmation',
    outlineRevision: 3,
    outline: { outlines: [{ id: 'o1' }] },
    input: { materialIds: [], outlineReview: 'wait' },
  });
  const service = mountWith({ ports: { vault } });

  const { body } = await service.runs.confirmOutline(RUN_A, {
    commandId: 'cmd-2',
    outlineRevision: 3,
    outlines: [{ id: 'o1', title: '改过' }, { id: 'o2', title: '新增' }],
  });
  assert.equal(body.outlineRevision, 4);
  const run = await vault.runs.get(RUN_A);
  assert.equal(run.outline.outlines.length, 2);
  assert.equal(run.progress.scenesTotal, 2);
});

// ── 9. runs.holdOutline ────────────────────────────────────────────────────

test('runs.holdOutline：commandId 缺失 400；auto run 409；countdown → wait', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'outlining', input: { materialIds: [], outlineReview: 'auto' } });
  vault.seedRun({ id: RUN_B, state: 'outlining', input: { materialIds: [], outlineReview: 'countdown' } });
  const service = mountWith({ ports: { vault } });

  const bad = await service.runs.holdOutline(RUN_A, {});
  assert.equal(bad.httpStatus, 400);

  const conflict = await service.runs.holdOutline(RUN_A, { commandId: 'h-1' });
  assert.equal(conflict.httpStatus, 409);
  assert.match(conflict.body.error, /confirms its own outline/);

  const held = await service.runs.holdOutline(RUN_B, { commandId: 'h-2' });
  assert.equal(held.httpStatus, 200);
  const run = await vault.runs.get(RUN_B);
  assert.equal(run.input.outlineReview, 'wait');
});

// ── 10. runs.retry ─────────────────────────────────────────────────────────

test('runs.retry：commandId 缺失 400；没暂停 409', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', step: 'research', input: { materialIds: [] } });
  const service = mountWith({ ports: { vault, generate: memoryGenerate() } });

  const bad = await service.runs.retry(RUN_A, {});
  assert.equal(bad.httpStatus, 400);

  const conflict = await service.runs.retry(RUN_A, { commandId: 'r-1' });
  assert.equal(conflict.httpStatus, 409);
  assert.match(conflict.body.error, /not paused/);
});

test('runs.retry：paused 的 run 从暂停的步骤回到对应 phase，并叫醒生成端口', async () => {
  const vault = memoryVault();
  vault.seedRun({
    id: RUN_A,
    state: 'paused',
    step: 'scene:0:content',
    input: { materialIds: [] },
    error: { step: 'scene:0:content', message: 'provider down' },
  });
  const generate = memoryGenerate();
  let resumed = null;
  generate.resume = async (id) => {
    resumed = id;
    return { runId: id, status: 'running' };
  };
  const service = mountWith({ ports: { vault, generate } });

  const { httpStatus, body } = await service.runs.retry(RUN_A, { commandId: 'r-2' });
  assert.equal(httpStatus, 200);
  assert.equal(body.state, 'generating', 'scene 步骤属于 generating phase');
  assert.equal((await vault.runs.get(RUN_A)).state, 'generating');
  assert.equal((await vault.runs.get(RUN_A)).error, null);
  assert.equal(resumed, RUN_A, '必须走 ports.generate.resume');
});

test('runs.retry：媒体重试在 generating 的 run 上也允许（不要求 paused）', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', step: 'agents', input: { materialIds: [] } });
  await vault.runs.putStep(RUN_A, 'media:el-1', { mediaType: 'image', status: 'failed', message: 'x' });
  const service = mountWith({ ports: { vault, generate: memoryGenerate() } });

  const { httpStatus, body } = await service.runs.retry(RUN_A, {
    commandId: 'r-3',
    media: { elementId: 'el-1' },
  });
  assert.equal(httpStatus, 200);
  assert.equal(body.state, 'generating');
  const steps = await vault.runs.steps(RUN_A);
  assert.equal(steps.find((step) => step.id === 'media:el-1').output.status, 'queued');
});

// ── 8. runs.events ─────────────────────────────────────────────────────────

test('runs.events：不认识的 run 回 404 纯文本（不是空流）', async () => {
  const service = mountWith({ ports: { vault: memoryVault() } });
  const result = await service.runs.events(RUN_B);

  assert.equal(isEventStream(result), false);
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body, 'Not found');
});

test('runs.events：终态 run 先补 backlog、再 caught_up，然后结束', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'completed', seq: 2 });
  vault.seedEvents(RUN_A, [
    { type: 'outline.item', data: { index: 0 } },
    { type: 'state', data: { state: 'completed' } },
  ]);
  const service = mountWith({ ports: { vault } });

  const stream = await service.runs.events(RUN_A);
  assert.ok(isEventStream(stream));
  const events = await collect(stream);

  assert.deepEqual(events.map((event) => event.type), ['outline.item', 'state', 'caught_up']);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].phase, 'backlog');
  assert.equal(events[0].runId, RUN_A);
  assert.equal(openRunStreamsOf('local'), 0, '流结束后必须释放槽位');
});

test('runs.events：after 之后的事件才算（Last-Event-ID / ?after=）', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'ended', seq: 3 });
  vault.seedEvents(RUN_A, [
    { type: 'a' }, { type: 'b' }, { type: 'c' },
  ]);
  const service = mountWith({ ports: { vault } });

  const events = await collect(await service.runs.events(RUN_A, { after: 2 }));
  assert.deepEqual(events.map((event) => event.type), ['c', 'caught_up']);
});

// ── 5. runs.allEvents ──────────────────────────────────────────────────────

test('runs.allEvents：先给一条 runs 快照帧', async () => {
  const vault = memoryVault();
  vault.seedRun({ id: RUN_A, state: 'generating', seq: 2 });
  vault.seedRun({ id: RUN_B, state: 'ended', seq: 5 });
  const service = mountWith({ ports: { vault } });

  const stream = await service.runs.allEvents({ maxPolls: 1, pollIntervalMs: 0 });
  assert.ok(isEventStream(stream));
  const events = await collect(stream);

  assert.equal(events[0].type, 'runs');
  assert.deepEqual(events[0].data.runs.map((run) => run.id), [RUN_A]);
  assert.equal(openRunStreamsOf('local'), 0);
});

test('runs.allEvents：没有 vault 时给一条空快照就结束（不编 run）', async () => {
  const service = mountWith();
  const events = await collect(await service.runs.allEvents({ maxPolls: 1 }));
  assert.deepEqual(events.map((event) => event.type), ['runs']);
  assert.deepEqual(events[0].data.runs, []);
});

// ── 11. stages.list / create ───────────────────────────────────────────────

test('stages.list：没有持久层 404 纯文本（上游 isServerPersistenceConfigured 那一行）', async () => {
  const service = mountWith();
  const result = await service.stages.list();
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body, 'Not found');
});

test('stages.list：回调用方的课程库', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, name: '线性代数' });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.list();
  assert.equal(httpStatus, 200);
  assert.deepEqual(body.stages.map((stage) => stage.id), [STAGE_1]);
  assert.equal(body.stages[0].name, '线性代数');
});

test('stages.list：注入 library provider 时用它给的可读集合', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({
    ports: { vault, stage: { async library() { return [{ id: 'stage-9', name: '公开课' }]; } } },
  });

  const { body } = await service.stages.list();
  assert.deepEqual(body.stages.map((stage) => stage.id), ['stage-9']);
});

test('stages.create：三条 400 分支（缺 name / 太长 / description 非字符串）', async () => {
  const service = mountWith({ ports: { vault: memoryVault() } });

  const missing = await service.stages.create({});
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const tooLong = await service.stages.create({ name: 'x'.repeat(121) });
  assert.equal(tooLong.httpStatus, 400);
  assert.match(tooLong.body.error, /120 character limit/);

  const badDescription = await service.stages.create({ name: 'ok', description: 42 });
  assert.equal(badDescription.httpStatus, 400);
  assert.match(badDescription.body.error, /description must be a string/);

  const notObject = await service.stages.create(null);
  assert.equal(notObject.httpStatus, 400);
});

test('stages.create：201 { stage: { sceneCount: 0 } }，id 是 stage- 家族', async () => {
  const vault = memoryVault();
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.create({ name: '  概率论  ', description: ' 一学期 ' });
  assert.equal(httpStatus, 201);
  assert.match(body.stage.id, /^stage-[A-Za-z0-9_-]+$/);
  assert.equal(body.stage.name, '概率论');
  assert.equal(body.stage.description, '一学期');
  assert.equal(body.stage.sceneCount, 0);
  assert.equal(vault.stageCount, 1);
});

// ── 12. stages.get / put / patch / remove ─────────────────────────────────

test('stages.get：不存在 404 纯文本；存在回整份文档（stage + scenes + outline）', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, name: '线性代数' });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.get('stage-nope');
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body, 'Not found');

  const { httpStatus, body } = await service.stages.get(STAGE_1);
  assert.equal(httpStatus, 200);
  assert.equal(body.stage.id, STAGE_1);
  assert.deepEqual(body.scenes, []);
  assert.equal(body.outline.requirement, '线性代数');
  assert.equal(body.stageMeta, undefined, '上游文档里没有 stageMeta，不能带出去');
});

test('stages.put：body 不合法 400；stage.id 与路径不一致 400；不存在 404；正常 200', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const bad = await service.stages.put(STAGE_1, { stage: {}, scenes: 'x' });
  assert.equal(bad.httpStatus, 400);
  assert.match(bad.body.error, /a stage document/);

  const mismatch = await service.stages.put(STAGE_1, { stage: { id: 'stage-2' }, scenes: [] });
  assert.equal(mismatch.httpStatus, 400);
  assert.match(mismatch.body.error, /does not match/);

  const missing = await service.stages.put('stage-nope', { stage: { id: 'stage-nope' }, scenes: [] });
  assert.equal(missing.httpStatus, 404);

  const saved = await service.stages.put(STAGE_1, { stage: { id: STAGE_1, name: '改名' }, scenes: [] });
  assert.equal(saved.httpStatus, 200);
  assert.deepEqual(saved.body, { success: true });
  assert.equal((await vault.classroom.load(STAGE_1)).stage.name, '改名');
});

test('stages.patch：name 为空 400；正常改回 { success: true, name }', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, name: '旧名' });
  const service = mountWith({ ports: { vault } });

  const bad = await service.stages.patch(STAGE_1, { name: '   ' });
  assert.equal(bad.httpStatus, 400);
  assert.match(bad.body.error, /non-empty string/);

  const { httpStatus, body } = await service.stages.patch(STAGE_1, { name: ' 新名 ' });
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, { success: true, name: '新名' });
  assert.equal((await vault.classroom.load(STAGE_1)).stage.name, '新名');
});

test('stages.remove：回 { ok: true } 并真的删掉', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.remove(STAGE_1);
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(vault.stageCount, 0);
});

// ── 15. stages.manifest / 13. freshness ───────────────────────────────────

test('stages.manifest：不存在 404；存在回 { rev, scenes: [{id, order, rev}] }', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.manifest('stage-nope');
  assert.equal(missing.httpStatus, 404);

  const { httpStatus, body } = await service.stages.manifest(STAGE_1);
  assert.equal(httpStatus, 200);
  assert.equal(typeof body.rev, 'number');
  assert.ok(body.rev > 0, 'rev 取自 updatedAt（端口没有触发器维护的 rev）');
  assert.deepEqual(body.scenes, []);
});

test('stages.freshness：不存在 404；存在先推一帧 stage_freshness，rev 变了再推', async () => {
  const vault = memoryVault();
  const seeded = vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.freshness('stage-nope');
  assert.equal(missing.httpStatus, 404);

  const stream = await service.stages.freshness(STAGE_1, { maxPolls: 1, pollIntervalMs: 0 });
  assert.ok(isEventStream(stream));
  const events = await collect(stream);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'stage_freshness');
  assert.equal(events[0].data.stageId, STAGE_1);
  assert.equal(events[0].data.rev, seeded.stage.updatedAt);
});

test('stages.freshness：rev 不动就不重复推帧', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const events = await collect(await service.stages.freshness(STAGE_1, { maxPolls: 3, pollIntervalMs: 0 }));
  assert.equal(events.length, 1, '首帧之后 rev 没动，只应有一帧');
});

// ── 14. stages.markComplete ───────────────────────────────────────────────

test('stages.markComplete：有 run 在生成 → 409 COURSE_GENERATING', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  vault.seedRun({ id: RUN_A, state: 'generating', stageId: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.markComplete(STAGE_1, {});
  assert.equal(httpStatus, 409);
  assert.equal(body.error.code, 'COURSE_GENERATING');
});

test('stages.markComplete：正常把 outline.generationComplete 置上，回 { ok: true }', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.markComplete(STAGE_1, {});
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal((await vault.classroom.load(STAGE_1)).outline.generationComplete, true);
});

test('stages.markComplete：不存在 404 { error: not_found }；不是 owner 403 forbidden', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, owner: 'someone-else' });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.markComplete('stage-nope', {});
  assert.equal(missing.httpStatus, 404);
  assert.deepEqual(missing.body, { error: 'not_found' });

  const foreign = await service.stages.markComplete(STAGE_1, {});
  assert.equal(foreign.httpStatus, 403);
  assert.deepEqual(foreign.body, { error: 'forbidden' });
});

// ── 18. stages.status / 20. stages.meta ───────────────────────────────────

test('stages.status：不认识 404 { error: not_found }；公开课回 isPublic / publishedAt', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, isPublic: true });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.status('stage-nope');
  assert.equal(missing.httpStatus, 404);
  assert.deepEqual(missing.body, { error: 'not_found' });

  const { httpStatus, body } = await service.stages.status(STAGE_1);
  assert.equal(httpStatus, 200);
  assert.equal(body.isPublic, true);
  assert.equal(typeof body.publishedAt, 'number');
  assert.equal(body.error, undefined, '这条 route 的 wire 只有 isPublic / publishedAt');
});

test('stages.meta：回 isOwner / isPublic / generationComplete / source，且永不带 ownerId', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const missing = await service.stages.meta('stage-nope');
  assert.equal(missing.httpStatus, 404);

  const { httpStatus, body } = await service.stages.meta(STAGE_1);
  assert.equal(httpStatus, 200);
  assert.equal(body.isOwner, true);
  assert.equal(body.isPublic, false);
  assert.equal(body.generationComplete, false);
  assert.equal(body.source, 'document');
  assert.equal('ownerId' in body, false);
});

// ── 16. stages.publish / 19. unpublish ────────────────────────────────────

test('stages.publish：没有持久层 404；有 vault 没 stage.setPublished 抛（变更类不静默）', async () => {
  const none = await mountWith().stages.publish(STAGE_1, {});
  assert.equal(none.httpStatus, 404);
  assert.equal(none.body, 'Not found');

  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });
  await assert.rejects(() => service.stages.publish(STAGE_1, {}), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /stage-meta/);
    return true;
  });
});

test('stages.publish：没有 course:publish 角色 401 login_required；有角色 200 并写库', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const stage = memoryStage(vault);
  const anonymous = mountWith({ ports: { vault, stage } });
  const denied = await anonymous.stages.publish(STAGE_1, {});
  assert.equal(denied.httpStatus, 401);
  assert.deepEqual(denied.body, { error: 'login_required' });

  const allowed = mountWith({ ports: { vault, stage }, owner: publisherOwner });
  const { httpStatus, body } = await allowed.stages.publish(STAGE_1, {});
  assert.equal(httpStatus, 200);
  assert.equal(body.success, true);
  assert.equal(typeof body.publishedAt, 'number');
  assert.equal(stage.writes.length, 1);
});

test('stages.unpublish：已公开的课回 { success: true }；未知 id 404', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1, isPublic: true });
  const stage = memoryStage(vault);
  const service = mountWith({ ports: { vault, stage }, owner: publisherOwner });

  const missing = await service.stages.unpublish('stage-nope', {});
  assert.equal(missing.httpStatus, 404);
  assert.deepEqual(missing.body, { error: 'not_found' });

  const { httpStatus, body } = await service.stages.unpublish(STAGE_1, {});
  assert.equal(httpStatus, 200);
  assert.deepEqual(body, { success: true });
  assert.deepEqual(stage.writes, [{ stageId: STAGE_1, isPublic: false, publishedAt: null }]);
});

// ── 17. stages.scenes / putScenes ─────────────────────────────────────────

test('stages.scenes：ids 为空 400 empty_scene_ids；超过上限 400 too_many_scene_ids', async () => {
  const vault = memoryVault();
  vault.seedStage({ id: STAGE_1 });
  const service = mountWith({ ports: { vault } });

  const empty = await service.stages.scenes(STAGE_1, { ids: ' , , ' });
  assert.equal(empty.httpStatus, 400);
  assert.equal(empty.body.error, 'empty_scene_ids');

  const tooMany = await service.stages.scenes(STAGE_1, {
    ids: Array.from({ length: 201 }, (_, index) => `s${index}`).join(','),
  });
  assert.equal(tooMany.httpStatus, 400);
  assert.equal(tooMany.body.error, 'too_many_scene_ids');
});

test('stages.scenes：只回被点名的场景，按文档顺序，重复 id 去重', async () => {
  const vault = memoryVault();
  const doc = vault.seedStage({ id: STAGE_1 });
  doc.scenes = [
    { id: 's1', order: 1, type: 'slide' },
    { id: 's2', order: 2, type: 'quiz' },
    { id: 's3', order: 3, type: 'slide' },
  ];
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.stages.scenes(STAGE_1, { ids: 's3,s1,s3' });
  assert.equal(httpStatus, 200);
  assert.deepEqual(body.scenes.map((scene) => scene.id), ['s1', 's3']);
});

test('stages.scenes：不认识 stage 404 纯文本', async () => {
  const vault = memoryVault();
  const service = mountWith({ ports: { vault } });
  const result = await service.stages.scenes('stage-nope', { ids: 's1' });
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body, 'Not found');
});

test('stages.putScenes：上游没有 POST，必须抛 E_NOT_IMPLEMENTED 并指到那个文件', async () => {
  const vault = memoryVault();
  const service = mountWith({ ports: { vault } });
  await assert.rejects(() => service.stages.putScenes(STAGE_1, { scenes: [] }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /stages\/\[id\]\/scenes\/route\.ts/);
    return true;
  });
});

// ── isRunId 的两种格式（上游 `run-` + 16，生成端口的 UUID）─────────────────

test('isRunId 兼容生成端口的 UUID（否则刚生成的 run 自己取不到）', async () => {
  const uuid = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
  const vault = memoryVault();
  vault.seedRun({ id: uuid, state: 'generating', seq: 0 });
  const service = mountWith({ ports: { vault } });

  const { httpStatus, body } = await service.runs.get(uuid);
  assert.equal(httpStatus, 200);
  assert.equal(body.run.id, uuid);
});
