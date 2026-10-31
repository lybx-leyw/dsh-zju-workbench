// 课堂子系统的**跨包**端到端测试：一条链路走完 brief → 生成 → 落盘 → 读回 → 导出。
//
// 前面 13 个包的测试都是「单包 + 假邻居」，从来没有一次把真包串起来跑过。
// 这里串起来：vault / media / agent / pbl / export / stage / generate / host 全部
// `await import()` 真 `apply`，只把两样东西换成假的 —— 模型（llm）与 Cordis 容器。
//
// 判据是「链路通不通」，不是「产物像不像」（后者归 parity 工具）：
//   四段事件是否按序、vault 里是否真有文件、读回的文档是否有场景、
//   html 是否是完整文档、pptx 是否是 zip。
//
// 跑法：`node --test tests/classroom-e2e.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/** 本链路会出现的全部服务名（假容器的 `ctx[name]` getter 按这份清单装）。 */
const SERVICE_NAMES = [
  'zhiyunClassroomVault',
  'zhiyunClassroomMedia',
  'zhiyunClassroomAgent',
  'zhiyunClassroomPbl',
  'zhiyunClassroomExport',
  'zhiyunClassroomStage',
  'zhiyunClassroomGenerate',
  'zhiyunClassroomStudio',
];

/**
 * 假 Cordis 容器。
 *
 * 一处刻意的设计：`ctx[name]` 在服务**还没 provide 之前**返回一个 live facade
 * （每次取值转发到容器里当前的那个实例），`ctx.get(name)` 则如实返回 undefined。
 * 这不是为了掩盖问题 —— 真 Cordis 里 `inject` 会把 apply 推迟到依赖就位之后，
 * 所以 `generate` / `agent` / `pbl` 那种「apply 时抓一次 studio」的写法在真机上
 * 拿得到服务；假容器不推迟 apply，就得让 getter 也「晚绑定」，否则测出来的
 * 是假容器的时序，不是包的时序。`get()` 保持严格，用来断言「谁真的 provide 了」。
 */
function makeContainer({ dir }) {
  const services = new Map();
  const disposeHandlers = [];
  const logs = [];

  const facade = (name) => new Proxy({}, {
    get(_target, key) {
      const service = services.get(name);
      if (!service) return undefined;
      const value = service[key];
      return typeof value === 'function' ? value.bind(service) : value;
    },
  });

  const ctx = {
    profileContext: { dir },
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    provide(name, service) {
      services.set(name, service);
      return () => {
        if (services.get(name) === service) services.delete(name);
      };
    },
    get(name) {
      return services.get(name);
    },
    requestService(name) {
      const service = services.get(name);
      if (!service) throw new Error(`服务未提供：${name}`);
      return service;
    },
    on(event, handler) {
      if (event === 'dispose') disposeHandlers.push(handler);
    },
  };

  for (const name of SERVICE_NAMES) {
    Object.defineProperty(ctx, name, {
      enumerable: true,
      get: () => services.get(name) ?? facade(name),
    });
  }

  return { ctx, services, disposeHandlers, logs };
}

/** 假模型：outline 段回 4 条大纲，场景按 slide / quiz / interactive 各回最小合法内容。 */
function fakeLlm(calls = []) {
  return {
    async call(params = {}) {
      // 记录整段入参（不只 stage）：讲义链路要靠 prompt 里有没有讲义正文来判定。
      calls.push({ stage: params.stage, prompt: params.prompt, system: params.system });
      if (params.stage === 'outline') {
        return JSON.stringify({
          courseTitle: '二叉树入门',
          outlines: [
            { id: 'o1', type: 'slide', title: '导入', description: '为什么需要树', keyPoints: ['层级结构'] },
            { id: 'o2', type: 'slide', title: '定义', description: '递归定义', keyPoints: ['左右子树'] },
            { id: 'o3', type: 'quiz', title: '随堂检测', description: '', keyPoints: ['遍历'] },
            { id: 'o4', type: 'interactive', title: '动手画', description: '', keyPoints: ['构造'] },
          ],
        });
      }
      if (params.sceneType === 'quiz') {
        return JSON.stringify({
          speech: '做两道题',
          questions: [
            { id: 'q1', prompt: '中序遍历的顺序？', options: ['左根右', '根左右'], answer: 0 },
          ],
        });
      }
      if (params.sceneType === 'interactive') {
        return JSON.stringify({ speech: '试试看', html: '<div class="demo">二叉树</div>' });
      }
      return JSON.stringify({
        speech: `讲${params.sceneId ?? ''}`,
        elements: [
          { type: 'text', left: 40, top: 40, width: 600, height: 80, content: '二叉树' },
        ],
      });
    },
  };
}

/** 递归数文件（含子目录），并返回相对路径清单。 */
async function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

test('课堂链路：brief → 生成 → 落盘 → 读回 → 导出 HTML/PPTX', async (t) => {
  const profileDir = await mkdtemp(join(tmpdir(), 'zyc-e2e-'));
  const { ctx, services, disposeHandlers, logs } = makeContainer({ dir: profileDir });
  const disposers = [];

  t.after(async () => {
    // 逆序卸载；每个 disposer 都必须能安全调用（真机上卸载期抛错会挡住收尾）。
    for (const [name, dispose] of disposers.reverse()) {
      assert.doesNotThrow(() => dispose(), `${name} 的 disposer 抛错了`);
    }
    // `maxRetries`：vault 的原子写是「写临时文件再 rename」，run 结束时可能还有
    // 一次 rename 在路上；直接 rm 会撞 ENOTEMPTY（第一次跑就是这样红的）。
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // ── 1. 按依赖顺序 apply 全部包 ───────────────────────────────────────────
  //
  // host 排在 generate 之后：generate 的 inject 里有 zhiyunClassroomStudio，
  // 真 Cordis 会等 host 就位再 apply generate；vault / media 等只看 profileContext，
  // 先起得来。host 自己的 ports 是惰性 getter，所以它先于/后于领域包都能装配。
  const mount = async (packageName, config = {}) => {
    const url = pathToFileURL(join(fileURLToPath(ROOT), 'packages', packageName, 'src', 'index.js')).href;
    const plugin = await import(url);
    const dispose = plugin.apply(ctx, config);
    assert.equal(typeof dispose, 'function', `${packageName} 必须返回 disposer`);
    disposers.push([packageName, dispose]);
  };

  const llmCalls = [];
  const llm = fakeLlm(llmCalls);
  await mount('dsh-zhiyun-core-classroom-vault');
  await mount('dsh-zhiyun-core-classroom-media');
  await mount('dsh-zhiyun-core-classroom-agent', { llm });
  await mount('dsh-zhiyun-core-classroom-pbl', { llm });
  await mount('dsh-zhiyun-core-classroom-export');
  await mount('dsh-zhiyun-core-classroom-stage');
  await mount('dsh-zhiyun-core-classroom-generate', { llm });
  // 宿主的 providers.list() 走 providerConfig；空清单会让 generate 的 resolveLlm
  // 以 E_NO_LLM_PROVIDER 拒绝，所以这里注入一个「配了 openai」的装载器。
  await mount('dsh-zhiyun-host-classroom', {
    providerConfig: { getServerProviders: () => ({ openai: { models: ['gpt-4o'] } }) },
  });

  const servicesEach = [
    'zhiyunClassroomVault',
    'zhiyunClassroomMedia',
    'zhiyunClassroomAgent',
    'zhiyunClassroomPbl',
    'zhiyunClassroomExport',
    'zhiyunClassroomStage',
    'zhiyunClassroomGenerate',
    'zhiyunClassroomStudio',
  ];
  assert.deepEqual(
    servicesEach.filter((name) => !services.has(name)),
    [],
    `有包没把服务 provide 出来；日志：${JSON.stringify(logs.filter(([level]) => level === 'error')).slice(0, 400)}`,
  );

  const studio = ctx.requestService('zhiyunClassroomStudio');
  const vault = ctx.requestService('zhiyunClassroomVault');

  // ── 2. 生成（宿主入口，brief 走的是 route 信封 + 事件流）──────────────────
  const started = await studio.generate(
    { requirement: '讲一下二叉树' },
    { request: { ownerId: 'local' } },
  );
  assert.equal(started.httpStatus, 202, `生成没有受理：${JSON.stringify(started.body)}`);
  assert.equal(typeof started.runId, 'string');

  const events = [];
  for await (const event of started.events) events.push(event);

  assert.equal(
    events.at(-1)?.kind,
    'run-done',
    `run 没跑完：${JSON.stringify(events.at(-1)?.payload ?? null)}`,
  );
  assert.deepEqual(
    events.filter((event) => event.kind === 'phase-start').map((event) => event.phase),
    ['outline', 'scenes', 'media', 'finalize'],
  );

  const stageId = events.at(-1).payload.stageId;
  assert.ok(events.at(-1).payload.sceneCount >= 4, `场景数不足：${events.at(-1).payload.sceneCount}`);

  // ── 3. 落盘：vault 的布局是 classroom/<id>/meta.json ─────────────────────
  const metaPath = join(profileDir, 'data/zhiyun-classroom/classroom', stageId, 'meta.json');
  assert.equal((await stat(metaPath)).isFile(), true, `meta.json 没有落盘：${metaPath}`);

  // ── 4. 读回：既过宿主 route（stages.get），也过 vault 的文档读取 ──────────
  const read = await studio.stages.get(stageId, { request: { ownerId: 'local' } });
  assert.equal(read.httpStatus, 200);
  assert.ok(read.body.scenes.length >= 4, `宿主读回的场景不足：${read.body.scenes.length}`);

  const classroom = await vault.classroom.load(stageId);
  assert.ok(Array.isArray(classroom.scenes) && classroom.scenes.length >= 4);
  for (const scene of classroom.scenes) {
    assert.equal(typeof scene.id, 'string');
    assert.equal(typeof scene.type, 'string');
  }

  // ── 5. 导出：单文件 HTML + PPTX（zip 容器）────────────────────────────────
  const exporter = ctx.requestService('zhiyunClassroomExport');

  const html = await exporter.html(classroom);
  assert.match(html.slice(0, 16).toLowerCase(), /^<!doctype/);
  assert.ok(html.includes('<style'), 'HTML 没有内联样式');
  assert.equal(/\ssrc="https?:/i.test(html), false, 'HTML 里有外链 http 资源');

  const pptx = await exporter.pptx(classroom);
  assert.ok(Buffer.isBuffer(pptx), 'pptx 必须返回 Buffer');
  assert.equal(pptx.subarray(0, 4).toString('binary'), 'PK\x03\x04');

  // ── 6. 链路证据 ──────────────────────────────────────────────────────────
  const files = await walk(profileDir);
  t.diagnostic(
    `events=${events.length} scenes=${classroom.scenes.length} `
    + `html=${Buffer.byteLength(html)}B pptx=${pptx.length}B files=${files.length} `
    + `stageId=${stageId}`,
  );
  assert.ok(files.length > 0);

  // ── 7. 讲义：上传 → materialId → 再生成一次，大纲 prompt 里必须有讲义正文 ──
  //
  // 「传入讲义让 AI 照着讲」的唯一判据不是「上传接口返回 201」，而是
  // **模型收到的 prompt 里真的有讲义文字**。中间隔了三层（字节落盘 → unpdf 抽取 →
  // prompt 拼接），任何一层断了这里都会红。
  const lecture = await readFile(join(fileURLToPath(ROOT), 'fixtures', 'classroom-material', 'lecture-fourier.pdf'));
  const upload = await studio.materials.create({
    buffer: lecture,
    filename: 'lecture-fourier.pdf',
    mimeType: 'application/pdf',
    extract: true,
    ownerId: 'local',
  });
  const uploaded = upload.body ?? upload;
  assert.equal(upload.httpStatus, 201, `讲义上传失败：${JSON.stringify(uploaded).slice(0, 300)}`);
  assert.equal(typeof uploaded.materialId, 'string');

  const materialRun = await studio.generate(
    { requirement: '照着这份讲义讲傅里叶变换', materialIds: [uploaded.materialId] },
    { request: { ownerId: 'local' } },
  );
  assert.equal(
    materialRun.httpStatus,
    202,
    `带讲义的生成没有受理：${JSON.stringify(materialRun.body).slice(0, 300)}`,
  );

  const materialEvents = [];
  for await (const event of materialRun.events) materialEvents.push(event);

  assert.equal(
    materialEvents.at(-1)?.kind,
    'run-done',
    `带讲义的 run 没跑完：${JSON.stringify(materialEvents.at(-1)?.payload ?? null)}`,
  );
  assert.deepEqual(
    materialEvents.filter((event) => event.kind === 'phase-start').map((event) => event.phase),
    ['material-analysis', 'outline', 'scenes', 'media', 'finalize'],
    '讲义段必须在 outline 之前',
  );

  const outlinePrompt = llmCalls.filter((call) => call.stage === 'outline').at(-1)?.prompt ?? '';
  assert.match(outlinePrompt, /## 讲义（用户上传/, '大纲 prompt 里没有讲义一节');
  assert.match(
    outlinePrompt,
    /Convolution in time equals multiplication in frequency/,
    '讲义正文没有进 prompt',
  );
  t.diagnostic(`materialId=${uploaded.materialId} prompt=${outlinePrompt.length}B`);
});
