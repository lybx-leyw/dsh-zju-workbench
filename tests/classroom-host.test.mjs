// dsh-zhiyun-host-classroom 的装配冒烟测试。
//
// 这里测的不是算法，而是「把插件真的 apply 到一个假 ctx 上，会不会炸」：
// 本包的价值全在**形状**上 —— 21 个 route 搬成 10 个服务方法，L2/L3 照这份形状
// 并行开工。形状错了，下游全是白工。
//
// 刻意覆盖四类断言：
//   1. apply() 永不抛（含：没有 profileContext、provide 会抛、上游全缺）；
//   2. status() 可调且不抛，detail 里带着上游 health 的原始字段；
//   3. 真搬的两个 route（health → status、server-providers → providers.list）
//      在给定入参下返回结构与上游 JSON body 逐字段一致；
//   4. 没搬的方法抛 ClassroomError（带 code），而不是返回 undefined。
//
// 跑法：`node --test tests/classroom-host.test.mjs`
//
// 刻意**不**覆盖：真起 pg / 真调模型 —— 那要数据库和凭证，属于人工验证。

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-host-classroom/', import.meta.url);
// Windows 上 `URL.pathname` 是 "/C:/Users/..."，直接丢给 pathToFileURL 会拼成
// "file:///C:/C:/Users/..."（盘符重复），导入必然失败。
// 先用 fileURLToPath 转成真正的本地路径再拼。
const INDEX_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'index.js')).href;
const plugin = await import(INDEX_URL);

// ── 测试装置 ────────────────────────────────────────────────────────────────

/**
 * 最小 Cordis 假 ctx：只实现本包真正用到的那几个面。
 *
 * 照 `tests/deeptutor-host.test.mjs` 的写法 —— 那里已经踩过一次坑：
 * 真 Cordis 里 provide 与 get 是同一个容器，测试里分开，才能显式掌控"谁先加载"。
 */
function makeCtx({ profileDir = '/tmp/zyc-profile', services = {}, provideThrows = false } = {}) {
  const provided = new Map(Object.entries(services));
  const disposers = [];
  const logs = [];
  const ctx = {
    profileContext: profileDir === null ? undefined : { dir: profileDir },
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (serviceName) => provided.get(serviceName),
    provide: (serviceName, value) => {
      if (provideThrows) throw new Error(`service ${serviceName} already registered`);
      provided.set(serviceName, value);
      return () => provided.delete(serviceName);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

/** 在指定的环境变量下跑一段（跑完原样还原，避免污染同进程的其他测试）。 */
async function withEnv(vars, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** apply 一次并拿到服务（每次都是独立实例，env 变化要重新 apply 才生效）。 */
function mount(config) {
  const harness = makeCtx();
  const dispose = plugin.apply(harness.ctx, config);
  assert.equal(typeof dispose, 'function', 'apply() 必须返回 disposer');
  const service = harness.provided.get('zhiyunClassroomStudio');
  assert.ok(service, 'apply() 必须 provide zhiyunClassroomStudio');
  return { ...harness, service, dispose };
}

// ── 1. apply 永不抛 ────────────────────────────────────────────────────────

test('apply() 在空 ctx 上不抛，并声明了规范 §4 的全部形状', () => {
  const { service } = mount();

  // 规范 §4 的十条方法路径，逐条存在。
  for (const path of [
    'status', 'generate',
    'runs.get', 'runs.cancel',
    'classroom.load', 'classroom.save',
    'export.pptx', 'export.html',
    'providers.list', 'providers.set',
  ]) {
    const fn = path.split('.').reduce((cursor, key) => cursor?.[key], service);
    assert.equal(typeof fn, 'function', `缺少 zhiyunClassroomStudio.${path}`);
  }

  assert.deepEqual(plugin.inspectShape(service), [], '形状自检必须为空');
});

test('apply() 在没有 profileContext 时不抛（数据根缺失只降级）', () => {
  const harness = makeCtx({ profileDir: null });
  assert.doesNotThrow(() => plugin.apply(harness.ctx, {}));
  assert.ok(harness.provided.get('zhiyunClassroomStudio'), '没有数据根也要 provide');
});

test('apply() 在 provide 抛错时不抛（服务名被占用的最坏情况）', () => {
  const harness = makeCtx({ provideThrows: true });
  assert.doesNotThrow(() => plugin.apply(harness.ctx, {}));
  assert.ok(
    harness.logs.some(([level, ...rest]) => level === 'error' && rest.join(' ').includes('注册失败')),
    '注册失败必须留下 error 日志，不能静默',
  );
});

test('apply() 在注入的 providerConfig 是垃圾时不抛，退回降级实现', () => {
  assert.doesNotThrow(() => mount({ providerConfig: 42 }));
  assert.doesNotThrow(() => mount({ providerConfig: { getServerProviders: 'not-a-function' } }));
});

// ── 2. status() ────────────────────────────────────────────────────────────

test('status() 可调、不抛，返回 { state, version, detail } 且带 health 原始字段', async () => {
  const { service } = mount();

  const status = await service.status();

  assert.equal(status.state, 'ready');
  assert.equal(typeof status.version, 'string');
  assert.equal(typeof status.detail, 'object');

  // 上游 GET /api/health 的 body 字段（app/api/health/route.ts:8-15）一个不少。
  assert.equal(status.detail.status, 'ok');
  assert.equal(typeof status.detail.version, 'string');
  assert.equal(typeof status.detail.accessCodeConfigured, 'boolean');
  assert.deepEqual(status.detail.capabilities, {
    webSearch: false,
    imageGeneration: false,
    videoGeneration: false,
    tts: false,
  });
  assert.equal(typeof status.detail.generation.parallelSceneConcurrency, 'number');

  // 迁移进度必须自描述：页面不靠"试着调一下看看抛不抛"来判断。
  assert.equal(status.detail.implemented.status, true);
  assert.equal(status.detail.implemented.providersList, true);
  assert.equal(status.detail.implemented.generate, false);
  assert.equal(status.detail.providerConfig, 'placeholder');
});

test('status() 在能力位解析器抛错时降级为 degraded，而不是抛出来', async () => {
  const { service } = mount({
    resolveCapabilities: async () => { throw new Error('db down'); },
  });

  const status = await service.status();
  assert.equal(status.state, 'degraded');
  assert.equal(status.detail.error, 'db down');
});

test('status() 在组合层冲突时 state=partial 并如实写明占用者', async () => {
  // 源包的形状特征：acquireSso / transport（packages/dsh-zhiyun-source-classroom/src/index.js:82-101）
  const { service, logs } = mount();
  const harness = makeCtx({
    services: { zhiyunClassroomStudio: { acquireSso: async () => [], transport: {} } },
  });
  plugin.apply(harness.ctx, {});
  const conflicted = harness.provided.get('zhiyunClassroomStudio');

  const status = await conflicted.status();
  assert.equal(status.state, 'partial');
  assert.equal(status.detail.conflict.occupiedBy, 'dsh-zhiyun-source-classroom');
  assert.ok(service, '普通实例不受影响');
  assert.ok(
    harness.logs.some(([level]) => level === 'error'),
    '撞名必须留 error 日志（否则真机上静默覆盖别人）',
  );
  void logs;
});

// ── 3. 搬过来的两个 route ──────────────────────────────────────────────────

test('providers.list() 的结构与上游 GET /api/server-providers 的 body 逐字段一致', async () => {
  const { service } = mount();

  const { httpStatus, body } = await service.providers.list();

  assert.equal(httpStatus, 200);
  assert.equal(body.success, true);
  // 上游 body 的 8 个键（app/api/server-providers/route.ts:18-29）。
  assert.deepEqual(Object.keys(body), [
    'success', 'providers', 'tts', 'asr', 'pdf', 'image', 'video', 'webSearch', 'generation',
  ]);
  for (const section of ['providers', 'tts', 'asr', 'pdf', 'image', 'video', 'webSearch']) {
    assert.deepEqual(body[section], {}, `${section} 应是空对象（未注入装载器 = 没有配 provider）`);
  }
  assert.deepEqual(body.generation, { parallelSceneConcurrency: 0 });
});

test('providers.list() 把注入的装载器原样透出，不做二次加工', async () => {
  const injected = {
    getServerProviders: () => ({ deepseek: { models: ['deepseek-chat'] }, qwen: {} }),
    getServerTTSProviders: () => ({ 'qwen-tts': {}, 'browser-native-tts': { disabled: true } }),
    getServerASRProviders: () => ({ 'openai-whisper': {} }),
    getServerPDFProviders: () => ({ unpdf: {} }),
    getServerImageProviders: () => ({ 'openai-image': {} }),
    getServerVideoProviders: () => ({ seedance: {} }),
    getServerWebSearchProviders: () => ({ tavily: {} }),
    getParallelSceneConcurrency: () => 3,
  };
  const { service } = mount({ providerConfig: injected });

  const { httpStatus, body } = await service.providers.list();

  assert.equal(httpStatus, 200);
  assert.deepEqual(body.providers, { deepseek: { models: ['deepseek-chat'] }, qwen: {} });
  assert.deepEqual(body.tts, { 'qwen-tts': {}, 'browser-native-tts': { disabled: true } });
  assert.deepEqual(body.asr, { 'openai-whisper': {} });
  assert.deepEqual(body.pdf, { unpdf: {} });
  assert.deepEqual(body.image, { 'openai-image': {} });
  assert.deepEqual(body.video, { seedance: {} });
  assert.deepEqual(body.webSearch, { tavily: {} });
  assert.deepEqual(body.generation, { parallelSceneConcurrency: 3 });
});

test('providers.list() 在 getter 抛错时回 500 信封（上游 catch 分支原样保留）', async () => {
  const { service } = mount({
    providerConfig: {
      getServerProviders: () => { throw new Error('yaml unreadable'); },
    },
  });

  const { httpStatus, body } = await service.providers.list();

  assert.equal(httpStatus, 500);
  assert.equal(body.success, false);
  assert.equal(body.errorCode, 'INTERNAL_ERROR');
  // 上游就是把 Error.message 回给客户端（route.ts:35），未改。
  assert.equal(body.error, 'yaml unreadable');
});

test('status() 透出 health 的三项环境事实：ACCESS_CODE / 并发上限 / 版本', async () => {
  await withEnv({ ACCESS_CODE: 'zju-2026', PARALLEL_SCENE_CONCURRENCY: '4' }, async () => {
    const status = await mount().service.status();
    assert.equal(status.detail.accessCodeConfigured, true);
    assert.equal(status.detail.generation.parallelSceneConcurrency, 4);
  });
});

test('并发上限照上游规则钳到 [0, 10] 且非数字按 0 处理', async () => {
  for (const [raw, expected] of [['0', 0], ['-3', 0], ['abc', 0], ['7', 7], ['50', 10]]) {
    await withEnv({ PARALLEL_SCENE_CONCURRENCY: raw }, async () => {
      const status = await mount().service.status();
      assert.equal(
        status.detail.generation.parallelSceneConcurrency,
        expected,
        `PARALLEL_SCENE_CONCURRENCY=${raw} 应得 ${expected}`,
      );
    });
  }
});

// ── 4. 没搬的方法必须抛带 code 的领域错误 ──────────────────────────────────

test('未迁移的方法抛 ClassroomError(E_NOT_IMPLEMENTED)，detail.source 指到上游行号', async () => {
  const { service } = mount();

  // 仍然没有实现的（导出与 provider 写入）：这两组在 80 条 route 搬完之后
  // 依然由 L2 的 export 包 / 设置页提供，宿主这一侧保留抛错。
  const throws = [
    () => service.export.pptx('stage-1'),
    () => service.export.html('stage-1'),
    () => service.providers.set('llm', {}),
  ];

  for (const [index, call] of throws.entries()) {
    await assert.rejects(call, (error) => {
      assert.equal(error.name, 'ClassroomError', `第 ${index} 个调用应抛领域错误`);
      assert.equal(error.code, 'E_NOT_IMPLEMENTED');
      assert.equal(error.kind, 'E_NOT_IMPLEMENTED');
      assert.match(error.message, /尚未迁移/);
      assert.match(String(error.detail.source), /route\.ts|lib\//, '必须指到上游源位置');
      return true;
    });
  }

  // 查询类已经接上真实端口。与上游的差别只在**表达方式**：
  // 上游是 `if (!dbPool) return new Response('Not found', {status:404})`（HTTP 语义），
  // 而 §4 的 `classroom.load(id)` 是领域方法 —— 拿不到课堂就抛 `E_NOT_FOUND`，
  // 否则调用方（导出、播放页）会把一个 404 信封当成文档渲染成空白页。
  const notFound = [
    () => service.classroom.load('stage-1'),
  ];
  for (const [index, call] of notFound.entries()) {
    await assert.rejects(call, (error) => {
      assert.equal(error.name, 'ClassroomError', `第 ${index} 个查询应抛领域错误`);
      assert.equal(error.code, 'E_NOT_FOUND');
      return true;
    });
  }

  // `runs.*` 是 route 形状（没有 run 就是 404 文本），保持上游语义不变。
  for (const [index, call] of [() => service.runs.get('run-1'), () => service.runs.cancel('run-1')].entries()) {
    const result = await call();
    assert.equal(typeof result, 'object', `第 ${index} 个 run 查询应返回响应形状`);
    assert.equal(result.httpStatus, 404, `第 ${index} 个 run 查询应走上游「没有持久层」分支`);
  }
});

// ── 5. 卸载 ────────────────────────────────────────────────────────────────

test('disposer 注销服务，重复调用不抛', () => {
  const { provided, dispose } = mount();
  assert.ok(provided.get('zhiyunClassroomStudio'));

  dispose();
  assert.equal(provided.get('zhiyunClassroomStudio'), undefined);

  assert.doesNotThrow(() => dispose());
});

test('dispose 钩子也注销服务（宿主卸载路径两条都要能用）', () => {
  const { provided, disposers } = mount();
  assert.equal(disposers.length, 1);

  disposers[0]();
  assert.equal(provided.get('zhiyunClassroomStudio'), undefined);
});

// ── 6. 存储适配层空壳 ──────────────────────────────────────────────────────

test('adapter 空壳：七个端口方法都在，调用即抛 E_NOT_IMPLEMENTED', async () => {
  const { ADAPTER_METHODS, createVaultAdapter, inspectAdapter } = plugin;
  const adapter = createVaultAdapter();

  assert.deepEqual(inspectAdapter(adapter), []);
  assert.equal(adapter.ready, false);
  assert.deepEqual([...ADAPTER_METHODS].sort(), [
    'count', 'readOne', 'readPage', 'remove', 'transaction', 'updateIfRev', 'upsert',
  ]);

  await assert.rejects(adapter.readOne('materials', 'owner-1', 'mat-1'), (error) => {
    assert.equal(error.code, 'E_NOT_IMPLEMENTED');
    return true;
  });

  assert.deepEqual(inspectAdapter(null), [...ADAPTER_METHODS], '缺件要如实报出来');
});
