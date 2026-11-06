// 批 3（智能体 / 会话 / 技能 / 对话）的搬运测试。
//
// 每条 route 至少一例：入参校验（400 分支）+ 正常分支；端口缺失时走的是上游
// 「没有持久层 / 没有 runtime」的那条分支，或者抛 E_NOT_IMPLEMENTED（变更类）。
//
// 断言只读 `httpStatus` 与 `body` 的关键字段 —— 上游加字段不该让这里变红。
//
// 跑法：`node --test tests/classroom-host-agent-runtime.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-host-classroom/', import.meta.url);
const moduleUrl = (rel) => pathToFileURL(join(fileURLToPath(PACKAGE_DIR), rel)).href;

const { mountAgentRuntime, queryWhiteboardVisibility, PENDING_VISIBILITY_KEY } =
  await import(moduleUrl('src/services/agent-runtime.js'));
const { createClassroomService, inspectShape } = await import(moduleUrl('src/service.js'));
const { createDegradedProviderConfig } = await import(moduleUrl('src/upstream/provider-config.js'));

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

// ── 测试装置 ────────────────────────────────────────────────────────────────

/**
 * 会话存储端口：上游 `AgentSessionStore` 的内存版（只实现本批用到的方法）。
 * 形状写在这里当"端口契约"的活文档 —— 编排层照这个补 `ports.agent.sessions`。
 */
function makeSessionStore() {
  const sessions = new Map();
  const eventsBySession = new Map();
  const messagesBySession = new Map();
  const ownerEvents = [];
  const store = {
    sessions,
    eventsBySession,
    messagesBySession,
    ownerEvents,
    async getSession(id) {
      return sessions.get(id) ?? null;
    },
    async listSessionsByOwner(ownerId) {
      return [...sessions.values()].filter((session) => session.ownerId === ownerId);
    },
    async createSession(input) {
      const id = `sess-${sessions.size + 1}`;
      const meta = { id, status: input.status ?? 'queued', ...input };
      sessions.set(id, meta);
      return meta;
    },
    async setManualSessionTitle(id, ownerId, title) {
      const meta = sessions.get(id);
      if (!meta || meta.ownerId !== ownerId) return null;
      meta.title = title;
      return meta;
    },
    async requestCancel(id) {
      const meta = sessions.get(id);
      if (meta) meta.status = 'cancelling';
    },
    async postUserMessage(id, message) {
      const list = messagesBySession.get(id) ?? [];
      list.push(message);
      messagesBySession.set(id, list);
      return { seq: list.length, delivery: 'queued' };
    },
    async listMessages(id) {
      return messagesBySession.get(id) ?? [];
    },
    async readEventsAfterForReplay(id, cursor, limit) {
      const all = (eventsBySession.get(id) ?? []).filter((event) => Number(event.id) > cursor);
      return { events: all.slice(0, limit), scanned: all.length };
    },
    async readMaxId() {
      return ownerEvents.length;
    },
    async readAfter(ownerId, cursor, limit) {
      return ownerEvents.filter((event) => Number(event.id) > cursor).slice(0, limit);
    },
    async readRetirement() {
      return null;
    },
    async softDeleteSession(id) {
      sessions.delete(id);
      return true;
    },
  };
  return store;
}

/** 一个只满足 `mountAgentRuntime` 需要的 service 形状。 */
function baseService() {
  return {
    async status() {
      return { state: 'ready', version: '0.1.0', detail: {} };
    },
    async generate() {
      throw new Error('service.js 的空壳');
    },
    runs: { async get() {}, async cancel() {} },
    classroom: {},
    export: {},
    providers: { async list() {}, async set() {} },
    // `agents.js` 已经挂上的两个方法：本文件**不许**覆盖它们。
    agents: {
      async list() {
        return { httpStatus: 200, body: { agents: [] }, headers: new Headers() };
      },
      async create() {
        return { httpStatus: 201, body: { agent: {} }, headers: new Headers() };
      },
    },
  };
}

function mountWith({ ports = {}, dataDir = null, service = baseService(), owner } = {}) {
  const deps = { ports, log: quiet, dataDir, providerConfig: createDegradedProviderConfig() };
  if (owner) deps.owner = owner;
  mountAgentRuntime(service, deps);
  return service;
}

/** 走 `createClassroomService` 的 `mounts` 接缝（编排层真实的装配路径）。 */
function mountThroughService(ports = {}, dataDir = null) {
  return createClassroomService({
    version: '0.1.0',
    providerConfig: createDegradedProviderConfig(),
    log: quiet,
    ports: {
      get vault() { return ports.vault ?? null; },
      get agent() { return ports.agent ?? null; },
      get export() { return ports.export ?? null; },
    },
    mounts: [mountAgentRuntime],
    dataDir,
  });
}

async function collect(stream) {
  const out = [];
  for await (const event of stream) out.push(event);
  return out;
}

/** 一个填好的 agent（`customAgentFieldsSchema` 的必填面）。 */
function agentFixture(id = 'my-agent') {
  return {
    id,
    name: '助教',
    role: 'assistant',
    persona: '你是一个助教。',
    avatar: '/a.png',
    color: '#123456',
    allowedActions: ['speak'],
    priority: 5,
  };
}

const OWNER = 'local';

// ── 装配 ────────────────────────────────────────────────────────────────────

test('mountAgentRuntime 挂上五组命名空间，且不覆盖 agents.js 的 list/create', () => {
  const service = mountThroughService();

  assert.deepEqual(inspectShape(service), [], '§4 的形状自检必须仍为空');
  assert.equal(typeof service.generate, 'function', 'generate 必须保持可调用');
  for (const name of ['get', 'put', 'remove', 'import']) {
    assert.equal(typeof service.agents[name], 'function', `缺少 agents.${name}`);
  }

  // agents.js 已挂的 list/create 必须原样保留（`Object.assign` 只补键、不替换对象）。
  const withAgents = mountWith();
  assert.equal(typeof withAgents.agents.list, 'function');
  assert.equal(typeof withAgents.agents.create, 'function');
  assert.equal(withAgents.agents.list.name, 'list', 'agents.js 的 list 不能被替换');
  assert.equal(typeof withAgents.agents.get, 'function');

  for (const name of ['list', 'create', 'get', 'update', 'remove', 'cancel', 'events', 'messages', 'send', 'status']) {
    assert.equal(typeof service.sessions[name], 'function', `缺少 sessions.${name}`);
  }
  for (const name of ['get', 'start', 'ownerEvents']) {
    assert.equal(typeof service.runtime[name], 'function', `缺少 runtime.${name}`);
  }
  for (const name of ['list', 'install', 'get', 'put', 'remove', 'view']) {
    assert.equal(typeof service.skills[name], 'function', `缺少 skills.${name}`);
  }
  for (const name of ['send', 'whiteboardVisibility']) {
    assert.equal(typeof service.chat[name], 'function', `缺少 chat.${name}`);
  }
});

// ── 1. agents/[id]（PUT / DELETE / 补的 GET）─────────────────────────────────

test('agents.put：没有持久层 → E_NOT_IMPLEMENTED（变更类不静默）', async () => {
  const service = mountWith();
  await assert.rejects(service.agents.put('my-agent', { agent: agentFixture() }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /agents\/\[id\]\/route\.ts:31-46/);
    return true;
  });
});

test('agents.put：内置 id 恒 403（先判路径，不查库）', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub() } } });
  const result = await service.agents.put('default-1', { agent: agentFixture('default-1') });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.error.code, 'BUILT_IN_AGENT_READ_ONLY');
});

test('agents.put：body 缺 { agent } → 400 INVALID_REQUEST', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub([agentFixture()]) } } });
  const result = await service.agents.put('my-agent', {});
  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.error.code, 'INVALID_REQUEST');
});

test('agents.put：正常更新 → 200 { agent }，id 用路径上的', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub([agentFixture()]) } } });
  const result = await service.agents.put('my-agent', {
    agent: { ...agentFixture('my-agent'), name: '新名字' },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.agent.id, 'my-agent');
  assert.equal(result.body.agent.name, '新名字');
});

test('agents.put：body 里的 id 与路径不一致 → 400 INVALID_AGENT', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub([agentFixture()]) } } });
  const result = await service.agents.put('my-agent', { agent: agentFixture('other') });
  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.error.code, 'INVALID_AGENT');
});

test('agents.remove：内置 403 / 不存在 404 / 存在 204', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub([agentFixture()]) } } });

  const builtIn = await service.agents.remove('default-2');
  assert.equal(builtIn.httpStatus, 403);

  const missing = await service.agents.remove('nope');
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.body.error.code, 'AGENT_NOT_FOUND');

  const removed = await service.agents.remove('my-agent');
  assert.equal(removed.httpStatus, 204);
});

test('agents.get：上游没有 GET handler，本方法读同一行（存在 200 / 不存在 404）', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub([agentFixture()]) } } });

  const found = await service.agents.get('my-agent');
  assert.equal(found.httpStatus, 200);
  assert.equal(found.body.agent.id, 'my-agent');

  const missing = await service.agents.get('ghost');
  assert.equal(missing.httpStatus, 404);
});

// ── 2. agents/import ────────────────────────────────────────────────────────

test('agents.import：超过 200 条 → 400（上限照 MAX_CUSTOM_AGENTS*2）', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub() } } });
  const agents = Array.from({ length: 201 }, (_, index) => agentFixture(`a-${index}`));
  const result = await service.agents.import({ agents });
  assert.equal(result.httpStatus, 400);
  assert.match(result.body.error.message, /at most 200/);
});

test('agents.import：内置跳过、非法跳过、合法的进 imported', async () => {
  const service = mountWith({ ports: { vault: { kv: kvStub() } } });
  const result = await service.agents.import({
    agents: [
      agentFixture('default-1'),
      { id: 'broken' },
      agentFixture('ok-1'),
    ],
  });

  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.imported.map((agent) => agent.id), ['ok-1']);
  assert.equal(result.body.skipped[0].reason, 'built-in');
  assert.match(result.body.skipped[1].reason, /^invalid:/);
});

test('agents.import：幂等 —— 第二次导入全部 skipped（reason: exists）', async () => {
  const kv = kvStub();
  const service = mountWith({ ports: { vault: { kv } } });
  await service.agents.import({ agents: [agentFixture('ok-1')] });
  const second = await service.agents.import({ agents: [agentFixture('ok-1')] });

  assert.deepEqual(second.body.imported, []);
  assert.equal(second.body.skipped[0].reason, 'exists');
});

// ── 3. agent/sessions（GET / POST）──────────────────────────────────────────

test('sessions.list：没有 runtime → 404 文本；有 → 200 数组', async () => {
  assert.equal((await mountWith().sessions.list()).httpStatus, 404);

  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'queued' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const result = await service.sessions.list();
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.map((session) => session.id), ['sess-1']);
});

test('sessions.create：非法 JSON / 缺 prompt / 缺 stageId / 坏 materialIds 四条 400', async () => {
  const service = mountWith({ ports: { agent: { sessions: makeSessionStore() } } });

  const badJson = await service.sessions.create('{not json');
  assert.equal(badJson.httpStatus, 400);
  assert.equal(badJson.body.errorCode, 'INVALID_REQUEST');

  const noPrompt = await service.sessions.create({});
  assert.equal(noPrompt.httpStatus, 400);
  assert.equal(noPrompt.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const noStage = await service.sessions.create({ existingCourse: true });
  assert.equal(noStage.httpStatus, 400);
  assert.match(noStage.body.error, /requires stageId/);

  const badMaterials = await service.sessions.create({ prompt: 'x', materialIds: [1] });
  assert.equal(badMaterials.httpStatus, 400);
  assert.match(badMaterials.body.error, /materialIds must be an array of strings/);
});

test('sessions.create：正常创建 → 202 meta；带开场材料 → status=queued', async () => {
  const store = makeSessionStore();
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const plain = await service.sessions.create({ prompt: '做一节关于勾股定理的课' });
  assert.equal(plain.httpStatus, 202);
  assert.equal(plain.body.id, 'sess-1');
  assert.equal(plain.body.status, 'queued');

  const withMaterial = await service.sessions.create({ prompt: '再来一节', materialIds: ['m-1'] });
  assert.equal(withMaterial.httpStatus, 202);
  assert.equal(withMaterial.body.status, 'queued');
  assert.equal(store.messagesBySession.get('sess-2')?.[0]?.text, '再来一节');
});

test('sessions.create：显式 skill 不在清单里 → 400 且列出已安装的', async () => {
  const store = makeSessionStore();
  const service = mountWith({ ports: { agent: { sessions: store } }, dataDir: null });

  const result = await service.sessions.create({ prompt: 'hi', skill: 'my-missing' });
  assert.equal(result.httpStatus, 400);
  assert.match(result.body.error, /unknown skill "my-missing"/);
});

test('sessions.get：别人的会话与自己不存在的会话是同一个 404', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-x', { id: 'sess-x', ownerId: 'someone-else', status: 'queued' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const other = await service.sessions.get('sess-x');
  const missing = await service.sessions.get('sess-y');
  assert.equal(other.httpStatus, 404);
  assert.equal(missing.httpStatus, 404);
  assert.equal(other.body, missing.body);
});

test('sessions.update：title 缺失 400 / 类型错 400 / 正常 200 { title }（120 上限）', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'queued' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const missing = await service.sessions.update('sess-1', {});
  assert.equal(missing.httpStatus, 400);
  assert.equal(missing.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const wrongType = await service.sessions.update('sess-1', { title: 42 });
  assert.equal(wrongType.httpStatus, 400);

  const ok = await service.sessions.update('sess-1', { title: ' 新的标题 ' });
  assert.equal(ok.httpStatus, 200);
  assert.deepEqual(ok.body, { title: '新的标题' });

  const long = await service.sessions.update('sess-1', { title: 'x'.repeat(200) });
  assert.equal(long.body.title.length, 120);
});

test('sessions.remove：上游没有 DELETE → E_NOT_IMPLEMENTED（不再编一个删除语义）', async () => {
  const service = mountWith({ ports: { agent: { sessions: makeSessionStore() } } });
  await assert.rejects(service.sessions.remove('sess-1'), (error) => {
    assert.equal(error.name, 'ClassroomError');
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /agent\/sessions\/\[id\]\/route\.ts/);
    return true;
  });
});

test('sessions.cancel：202 已请求 / 终态 409 / 没有 runtime 抛 E_NOT_IMPLEMENTED', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  store.sessions.set('sess-2', { id: 'sess-2', ownerId: OWNER, status: 'succeeded' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const accepted = await service.sessions.cancel('sess-1');
  assert.equal(accepted.httpStatus, 202);
  assert.equal(accepted.body.cancelRequested, true);

  const terminal = await service.sessions.cancel('sess-2');
  assert.equal(terminal.httpStatus, 409);
  assert.equal(terminal.body.code, 'SESSION_ALREADY_TERMINAL');

  await assert.rejects(mountWith().sessions.cancel('sess-1'), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    return true;
  });
});

// ── 6. agent/sessions/[id]/events（AsyncIterable）───────────────────────────

test('sessions.events：没有 runtime → 404（不是空流）', async () => {
  const result = await mountWith().sessions.events('sess-1');
  assert.equal(result.httpStatus, 404);
  assert.equal(typeof result[Symbol.asyncIterator], 'undefined');
});

test('sessions.events：先回放 backlog、发 caught_up，再进 live（phase 逐帧正确）', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  store.eventsBySession.set('sess-1', [
    { id: 1, type: 'user_message', ts: 1, data: { text: 'hi' } },
    { id: 2, type: 'assistant_text', ts: 2, data: { text: 'hello' } },
  ]);
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const stream = await service.sessions.events('sess-1', { maxPolls: 1, pollIntervalMs: 0 });
  const events = await collect(stream);

  assert.deepEqual(events.map((event) => event.type), ['user_message', 'assistant_text', 'caught_up']);
  assert.equal(events[0].phase, 'backlog');
  assert.equal(events[0].seq, 1);
  assert.equal(events[2].data.replayed, 2);
  assert.equal(events[2].data.fromEventId, '0');
});

test('sessions.events：Last-Event-ID 与 ?after= 两种续读都生效', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  store.eventsBySession.set('sess-1', [
    { id: 1, type: 'user_message', ts: 1, data: null },
    { id: 2, type: 'assistant_text', ts: 2, data: null },
  ]);
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const byHeader = await collect(
    await service.sessions.events('sess-1', {
      headers: { 'Last-Event-ID': '1' },
      maxPolls: 1,
      pollIntervalMs: 0,
    }),
  );
  assert.deepEqual(byHeader.map((event) => event.type), ['assistant_text', 'caught_up']);
  assert.equal(byHeader[1].data.fromEventId, '1');

  const byQuery = await collect(
    await service.sessions.events('sess-1', {
      query: { after: '1' },
      maxPolls: 1,
      pollIntervalMs: 0,
    }),
  );
  assert.deepEqual(byQuery.map((event) => event.type), ['assistant_text', 'caught_up']);
});

// ── 7. agent/sessions/[id]/messages ─────────────────────────────────────────

test('sessions.messages：上游没有 GET → 端口缺 listMessages 时 404', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  delete store.listMessages;
  const missing = await service.sessions.messages('sess-1');
  assert.equal(missing.httpStatus, 404);

  store.listMessages = async () => [{ seq: 1, text: 'hi' }];
  const found = await service.sessions.messages('sess-1');
  assert.equal(found.httpStatus, 200);
  assert.equal(found.body[0].text, 'hi');
});

test('sessions.send：空正文 400 / 非法 elementRefs 400 / 正常 202', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const empty = await service.sessions.send('sess-1', { text: '   ' });
  assert.equal(empty.httpStatus, 400);
  assert.equal(empty.body.errorCode, 'MISSING_REQUIRED_FIELD');

  const badRefs = await service.sessions.send('sess-1', { text: 'hi', elementRefs: [{ kind: 'x' }] });
  assert.equal(badRefs.httpStatus, 400);
  assert.match(badRefs.body.error, /elementRefs\[0\]\.kind/);

  const ok = await service.sessions.send('sess-1', {
    text: '帮我把第 3 页改一下',
    elementRefs: [
      {
        kind: 'slide-element',
        stageId: 'stage-1',
        sceneId: 'scene-1',
        elementId: 'el-1',
        elementType: 'text',
        label: '标题',
      },
    ],
  });
  assert.equal(ok.httpStatus, 202);
  assert.equal(ok.body.message.seq, 1);
  assert.equal(ok.body.elementRefsAccepted, true);
});

test('sessions.status：{ sessionId: status } 的稀疏映射', async () => {
  const store = makeSessionStore();
  store.sessions.set('sess-1', { id: 'sess-1', ownerId: OWNER, status: 'running' });
  store.sessions.set('sess-2', { id: 'sess-2', ownerId: 'other', status: 'queued' });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const result = await service.sessions.status();
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { 'sess-1': 'running' });
});

// ── 9. agent/runtime ────────────────────────────────────────────────────────

test('runtime.get：上游是状态探针（三布尔），没有 runtime 时全 false', async () => {
  const off = await mountWith().runtime.get();
  assert.equal(off.httpStatus, 200);
  assert.deepEqual(off.body, { enabled: false, runtimeEnabled: false, persistence: false });

  const on = await mountWith({ ports: { agent: { sessions: makeSessionStore() } } }).runtime.get();
  assert.deepEqual(on.body, { enabled: true, runtimeEnabled: true, persistence: true });
});

test('runtime.start：上游没有 POST → E_NOT_IMPLEMENTED（detail 指到那个 GET）', async () => {
  const service = mountWith({ ports: { agent: { sessions: makeSessionStore() } } });
  await assert.rejects(service.runtime.start({}), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /agent\/runtime\/route\.ts:27-35/);
    return true;
  });
});

test('runtime.start：端口声明了 startRuntime 就转发（不编一个实现）', async () => {
  const service = mountWith({
    ports: { agent: { sessions: makeSessionStore(), startRuntime: async (body) => ({ httpStatus: 202, body, headers: new Headers() }) } },
  });
  const result = await service.runtime.start({ ownerId: 'x' });
  assert.equal(result.httpStatus, 202);
});

// ── 10. agent/owner-events ──────────────────────────────────────────────────

test('runtime.ownerEvents：回放 owner 事件并 caught_up', async () => {
  const store = makeSessionStore();
  store.ownerEvents.push({ id: 1, type: 'session_created', ts: 1, data: { id: 'sess-1' } });
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const events = await collect(await service.runtime.ownerEvents({ maxPolls: 1, pollIntervalMs: 0 }));
  assert.deepEqual(events.map((event) => event.type), ['session_created', 'caught_up']);
  assert.equal(events[0].phase, 'backlog');
  assert.equal(events[1].data.replayed, 1);
});

test('runtime.ownerEvents：游标落后超过 1000 → resync_required(too_far_behind)', async () => {
  const store = makeSessionStore();
  for (let index = 1; index <= 1200; index += 1) {
    store.ownerEvents.push({ id: index, type: 'session_touched', ts: index, data: null });
  }
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const events = await collect(
    await service.runtime.ownerEvents({ after: 1, maxPolls: 0, pollIntervalMs: 0 }),
  );
  assert.equal(events[0].type, 'resync_required');
  assert.equal(events[0].data.reason, 'too_far_behind');
  assert.equal(events[0].data.currentEventId, '1200');
});

test('runtime.ownerEvents：没有 runtime → 404；owner 已退役 → 只一帧 owner_moved', async () => {
  assert.equal((await mountWith().runtime.ownerEvents()).httpStatus, 404);

  const store = makeSessionStore();
  store.readRetirement = async () => 'account-1';
  const service = mountWith({ ports: { agent: { sessions: store } } });

  const events = await collect(await service.runtime.ownerEvents());
  assert.deepEqual(events.map((event) => event.type), ['owner_moved']);
  assert.equal(events[0].data.action, 'reconnect');
});

// ── 11. agent/skills ────────────────────────────────────────────────────────

async function makeSkillsDir() {
  const dir = await mkdtemp(join(tmpdir(), 'zyc-agent-'));
  const skillDir = join(dir, 'skills', 'my-outline');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: my-outline\ntitle: 大纲约束\ndescription: 控制场景数量\n---\n\n正文\n',
    'utf8',
  );
  await writeFile(join(skillDir, 'outline-constraints.json'), '{"sceneCount":{"min":3}}', 'utf8');
  return dir;
}

test('skills.list：dataDir 为 null 走上游"目录不存在"分支 → 空清单 200', async () => {
  const result = await mountWith().skills.list();
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, []);
});

test('skills.list：读 dataDir/skills/*/SKILL.md，压成上游那 6 个字段', async () => {
  const dir = await makeSkillsDir();
  const result = await mountWith({ dataDir: dir }).skills.list();
  await rm(dir, { recursive: true, force: true });

  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, [
    {
      id: 'my-outline',
      name: 'my-outline',
      title: '大纲约束',
      description: '控制场景数量',
      hasConstraints: true,
      source: 'builtin',
    },
  ]);
});

test('skills.install：没有文件 400 / 超大 413 / 坏 frontmatter 400 invalid-upload', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({ dataDir: dir });

  const noFile = await service.skills.install({});
  assert.equal(noFile.httpStatus, 400);
  assert.equal(noFile.body, 'A skill file is required.');

  const huge = await service.skills.install({ buffer: Buffer.alloc(1_048_577), filename: 'SKILL.md' });
  assert.equal(huge.httpStatus, 413);

  const bad = await service.skills.install({ buffer: Buffer.from('no frontmatter'), filename: 'SKILL.md' });
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.error, 'invalid-upload');

  await rm(dir, { recursive: true, force: true });
});

test('skills.install：201 后 list 能看见（目录即一行），zip 上传抛 E_NOT_IMPLEMENTED', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({ dataDir: dir });

  const installed = await service.skills.install({
    buffer: Buffer.from(
      '---\nname: my-uploaded\ntitle: 上传的技能\ndescription: 一句话\n---\n\n步骤一\n',
    ),
    filename: 'SKILL.md',
  });
  assert.equal(installed.httpStatus, 201);
  assert.match(installed.body.id, /^usk_/);

  const listed = await service.skills.list();
  assert.ok(listed.body.some((skill) => skill.id === installed.body.id && skill.name === 'my-uploaded'));

  await assert.rejects(
    service.skills.install({ buffer: Buffer.from('PK'), filename: 'skill.zip' }),
    (error) => {
      assert.equal(error.code, 'E_NOT_IMPLEMENTED');
      assert.match(String(error.detail.source), /agent\/skills\/route\.ts:70-71/);
      return true;
    },
  );

  await rm(dir, { recursive: true, force: true });
});

test('skills.install：dataDir 为 null → E_NOT_IMPLEMENTED（变更类不静默）', async () => {
  await assert.rejects(
    mountWith().skills.install({ buffer: Buffer.from('x'), filename: 'SKILL.md' }),
    (error) => {
      assert.equal(error.code, 'E_NOT_IMPLEMENTED');
      return true;
    },
  );
});

test('skills.get：{ id, content } / 不存在 404 / 非法 id 404；put 恒抛', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({ dataDir: dir });

  const found = await service.skills.get('my-outline');
  assert.equal(found.httpStatus, 200);
  assert.equal(found.body.id, 'my-outline');
  assert.match(found.body.content, /正文/);

  assert.equal((await service.skills.get('ghost')).httpStatus, 404);
  assert.equal((await service.skills.get('../etc')).httpStatus, 404);

  await assert.rejects(service.skills.put('my-outline', {}), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    return true;
  });

  await rm(dir, { recursive: true, force: true });
});

test('skills.remove：非 usk_ 前缀 405 / usk_ 删除 204 / 不存在 404', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({ dataDir: dir });

  const builtin = await service.skills.remove('my-outline');
  assert.equal(builtin.httpStatus, 405);
  assert.equal(builtin.body, 'Built-in skills cannot be deleted.');

  const installed = await service.skills.install({
    buffer: Buffer.from('---\nname: my-tmp\ntitle: 临时\ndescription: 说明\n---\n\n正文\n'),
    filename: 'SKILL.md',
  });
  const removed = await service.skills.remove(installed.body.id);
  assert.equal(removed.httpStatus, 204);

  const again = await service.skills.remove(installed.body.id);
  assert.equal(again.httpStatus, 404);

  await rm(dir, { recursive: true, force: true });
});

test('skills.view：非法 id 400 / 不存在 404 / 存在但没 zip 构建器 → E_NOT_IMPLEMENTED', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({ dataDir: dir });

  assert.equal((await service.skills.view('bad id')).httpStatus, 400);
  assert.equal((await service.skills.view('ghost')).httpStatus, 404);

  await assert.rejects(service.skills.view('my-outline'), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /skills\/\[id\]\/route\.ts/);
    return true;
  });

  await rm(dir, { recursive: true, force: true });
});

test('skills.view：注入 ports.export.skillZip 后回二进制（{ buffer, mimeType }）', async () => {
  const dir = await makeSkillsDir();
  const service = mountWith({
    dataDir: dir,
    ports: { export: { skillZip: async () => Buffer.from('PK\u0003\u0004') } },
  });

  const result = await service.skills.view('my-outline');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.mimeType, 'application/zip');
  assert.ok(Buffer.isBuffer(result.buffer));

  await rm(dir, { recursive: true, force: true });
});

// ── 14. chat/pi ─────────────────────────────────────────────────────────────

function chatBody(overrides = {}) {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    storeState: { scenes: [] },
    config: { agentIds: ['default-1'], agentConfigs: [{ id: 'default-1', name: '老师' }] },
    ...overrides,
  };
}

test('chat.send：messages / storeState / config.agentIds 三条必填各一条 400', async () => {
  const service = mountWith();

  const noMessages = await service.chat.send(chatBody({ messages: undefined }));
  assert.equal(noMessages.httpStatus, 400);
  assert.match(noMessages.body.error, /messages/);

  const noState = await service.chat.send(chatBody({ storeState: undefined }));
  assert.equal(noState.httpStatus, 400);
  assert.match(noState.body.error, /storeState/);

  const noIds = await service.chat.send(chatBody({ config: { agentIds: null } }));
  assert.equal(noIds.httpStatus, 400);
  assert.match(noIds.body.error, /config\.agentIds/);

  // 上游 `req.json()` 解析失败落在最外层 catch → 500 INTERNAL_ERROR（不是 400）。
  const badJson = await service.chat.send('{oops');
  assert.equal(badJson.httpStatus, 500);
  assert.equal(badJson.body.errorCode, 'INTERNAL_ERROR');
});

test('chat.send：课件引用开关关闭时带引用 → 400；scenes 成员非对象 → 400', async () => {
  const service = mountWith();
  const saved = process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED;
  delete process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED;

  try {
    const refs = await service.chat.send(chatBody({ elementReference: { kind: 'slide-element' } }));
    assert.equal(refs.httpStatus, 400);
    assert.equal(refs.body.error, 'Courseware references are disabled');

    const scenes = await service.chat.send(chatBody({ storeState: { scenes: [null] } }));
    assert.equal(scenes.httpStatus, 400);
    assert.match(scenes.body.error, /storeState\.scenes members must be objects/);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED;
    else process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED = saved;
  }
});

test('chat.send：agentIds 形态非法 400 / 解析不到 agent 400', async () => {
  const service = mountWith();

  const blank = await service.chat.send(chatBody({ config: { agentIds: [' '] } }));
  assert.equal(blank.httpStatus, 400);
  assert.match(blank.body.error, /non-empty array of unique/);

  const unknown = await service.chat.send(
    chatBody({ config: { agentIds: ['nope'], agentConfigs: [{ id: 'default-1', name: '老师' }] } }),
  );
  assert.equal(unknown.httpStatus, 400);
  assert.match(unknown.body.error, /Unknown classroom agents/);
});

test('chat.send：正常 → AsyncIterable，每帧是 {type, data}；端口缺失时抛 E_NOT_IMPLEMENTED', async () => {
  const service = mountWith({
    ports: {
      agent: {
        async plan(brief) {
          return { brief };
        },
        run(plan) {
          assert.equal(plan.brief.kind, 'chat');
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'assistant_text', data: { text: '你好' } };
              yield { type: 'session_end', data: { status: 'succeeded' } };
            },
          };
        },
      },
    },
  });

  const events = await collect(await service.chat.send(chatBody()));
  assert.deepEqual(events.map((event) => event.type), ['assistant_text', 'session_end']);
  assert.deepEqual(events[0].data, { text: '你好' });

  await assert.rejects(mountWith().chat.send(chatBody()), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    assert.match(String(error.detail.source), /chat\/pi\/route\.ts:271-345/);
    return true;
  });
});

test('chat.send：run 抛错 → 转成一帧 error（上游写一帧再关流）', async () => {
  const service = mountWith({
    ports: {
      agent: {
        run() {
          return {
            async *[Symbol.asyncIterator]() {
              throw new Error('model exploded');
            },
          };
        },
      },
    },
  });

  const events = await collect(await service.chat.send(chatBody()));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.message, 'model exploded');
});

// ── 15. chat/pi/whiteboard-visibility ───────────────────────────────────────

test('chat.whiteboardVisibility：body 形状不对 400 / 没有待决查询 404', async () => {
  const service = mountWith();

  const bad = await service.chat.whiteboardVisibility({ queryId: 'q', visibility: 'open' });
  assert.equal(bad.httpStatus, 400);
  assert.equal(bad.body.errorCode, 'INVALID_REQUEST');

  const extra = await service.chat.whiteboardVisibility({
    queryId: 'q',
    stageId: 's',
    visibility: 'open',
    extra: 1,
  });
  assert.equal(extra.httpStatus, 400);

  const notPending = await service.chat.whiteboardVisibility({
    queryId: 'nope',
    stageId: 'stage-1',
    visibility: 'open',
  });
  assert.equal(notPending.httpStatus, 404);
  assert.match(notPending.body.error, /not pending here/);
});

test('chat.whiteboardVisibility：结案 204 并让挂起的查询解析成 open；超时默认 unknown', async () => {
  const service = mountWith();

  let queryId;
  const pending = queryWhiteboardVisibility({
    stageId: 'stage-1',
    learnerKey: OWNER,
    timeoutMs: 50,
    dispatch: async (id) => {
      queryId = id;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(globalThis[PENDING_VISIBILITY_KEY].has(queryId), '登记键要与上游同一个 Symbol.for');

  const settled = await service.chat.whiteboardVisibility({
    queryId,
    stageId: 'stage-1',
    visibility: 'closed',
  });
  assert.equal(settled.httpStatus, 204);
  assert.equal(await pending, 'closed');

  const timedOut = await queryWhiteboardVisibility({
    stageId: 'stage-1',
    learnerKey: OWNER,
    timeoutMs: 1,
    dispatch: async () => {},
  });
  assert.equal(timedOut, 'unknown');
});

test('chat.whiteboardVisibility：stageId 对不上不结案（404），查询仍在挂起', async () => {
  const service = mountWith();

  let queryId;
  const pending = queryWhiteboardVisibility({
    stageId: 'stage-1',
    learnerKey: OWNER,
    timeoutMs: 20,
    dispatch: async (id) => {
      queryId = id;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const mismatched = await service.chat.whiteboardVisibility({
    queryId,
    stageId: 'stage-2',
    visibility: 'open',
  });
  assert.equal(mismatched.httpStatus, 404);

  // 超时把它按 unknown 结案（上游默认值），不会一直是 pending。
  assert.equal(await pending, 'unknown');
});

// ── 端口缺失：查询类一律是上游那条 404 ──────────────────────────────────────

test('端口全缺：查询类回 404 文本，变更类抛 E_NOT_IMPLEMENTED（不编数据）', async () => {
  const service = mountWith();

  for (const call of [
    () => service.agents.get('a'),
    () => service.sessions.list(),
    () => service.sessions.get('s'),
    () => service.sessions.status(),
    () => service.runtime.ownerEvents(),
    () => service.skills.get('my-outline'),
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await call();
    assert.equal(result.httpStatus, 404, '查询类必须回上游的 404');
  }

  await assert.rejects(service.sessions.create({ prompt: 'hi' }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    return true;
  });
  await assert.rejects(service.agents.put('a', { agent: agentFixture() }), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    return true;
  });
});

// ── kv 桩（与 agents.js 的降级实现同一个键空间）─────────────────────────────

function kvStub(seed = []) {
  const data = new Map();
  for (const agent of seed) data.set(`agents/${agent.id}`, agent);
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}
