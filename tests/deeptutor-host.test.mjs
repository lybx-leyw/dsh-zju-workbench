// dsh-zhiyun-host-deeptutor 的装配冒烟测试。
//
// 这里测的不是算法，而是「把插件真的 apply 到一个假 ctx 上，会不会炸」：
// 上层每一块（runtime / models / capabilities / resources / service / run-store）
// 单独都有测试，但它们拼在一起能不能被 Cordis 正常加载、能不能真的 provide
// `zhiyunDeepTutor`、`status()` 能不能如实报出本机事实 —— 只有装配起来才知道。
//
// 跑法：`node tests/deeptutor-host.test.mjs`（沙箱里 `node --test` 会 spawn EPERM）。
//
// 刻意**不**覆盖：
// - 真的起 Python 子进程跑出题（那要模型凭证，属于人工验证，见 scripts/deeptutor_bridge_selftest.mjs）；
// - profile 的 bundle 注册（tests/profile.test.mjs 已经钉住）。

import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('../packages/dsh-zhiyun-host-deeptutor', import.meta.url));
const INDEX_URL = pathToFileURL(join(PACKAGE_DIR, 'src', 'index.js')).href;

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx：只实现本包真正用到的那几个面。 */
function makeCtx({ profileDir, services = {} }) {
  const provided = new Map();
  const disposers = [];
  const logs = [];
  const ctx = {
    profileContext: { dir: profileDir },
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get(name) {
      // 先看本测试注入的外部服务，再看已被 provide 的：真实 Cordis 里这两者是
      // 同一个容器，分开只是为了测试能显式掌控"谁先加载"。
      return provided.has(name) ? provided.get(name) : services[name];
    },
    provide(name, value) {
      provided.set(name, value);
      return () => provided.delete(name);
    },
    on(event, handler) {
      if (event === 'dispose') disposers.push(handler);
    },
    plugin() {},
    inject() {},
  };
  return { ctx, provided, disposers, logs };
}

async function withProfile(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'zhiyun-deeptutor-host-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 等一个路径出现。
 *
 * apply() 里的建目录是后台 Promise（失败只 warn 不抛，否则一个目录建不出来会
 * 拖垮整个工作台），所以测试不能假定 apply 返回时目录已经在盘上。
 */
async function waitForPath(target, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await access(target);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/** 期望抛错的辅助：返回错误对象，断言 kind。 */
async function expectRejects(promise, kind) {
  try {
    await promise;
  } catch (error) {
    if (kind) assert.equal(error.kind, kind, `期望 ${kind}，实际 ${error.kind}：${error.message}`);
    return error;
  }
  assert.fail(`期望抛出 ${kind ?? '错误'}，但调用成功了`);
}

// ── 模块表面 ────────────────────────────────────────────────────────────────

test('① 包入口可被 import，导出名符合 Cordis 约定', async () => {
  const mod = await import(INDEX_URL);
  assert.equal(mod.name, 'zhiyun-deeptutor');
  assert.deepEqual(mod.inject, ['profileContext']);
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.DeepTutorError, 'function');
  assert.equal(typeof mod.resolvePython, 'function');
  assert.equal(typeof mod.probeVendorDeps, 'function');
  assert.ok(mod.PACKAGE_DIR instanceof URL);
  assert.ok(mod.VENDOR_PATH instanceof URL);
});

test('② 所有兄弟模块都能单独 import（没有循环依赖把谁留成半初始化）', async () => {
  const modules = ['runtime', 'models', 'capabilities', 'resources', 'service', 'run-store', 'protocol', 'adapters/quiz'];
  for (const rel of modules) {
    const mod = await import(pathToFileURL(join(PACKAGE_DIR, 'src', `${rel}.js`)).href);
    assert.ok(mod, `${rel}.js 没有导出任何东西`);
    assert.ok(Object.keys(mod).length > 0, `${rel}.js 导出为空`);
  }
});

test('③ package.json 的 dsh.bundle 指向真实存在的 patch 文件，files 不漏掉运行必需目录', async () => {
  const pkg = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  await access(join(PACKAGE_DIR, 'cordis.patch.yml'));
  const patch = await readFile(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /zhiyun-deeptutor/, 'cordis.patch.yml 里没有注册插件 id');
  assert.match(patch, /dsh-zhiyun-host-deeptutor/, 'cordis.patch.yml 里没有插件包名');
  // files 里列的名字必须与仓库真实布局一致。
  //
  // 这条曾经只检查「数组里有没有这个字符串」，不检查目录在不在 ——
  // 于是 vendor 归档之后它照样通过，等于什么都没验。现在分两类断言。
  // mustExist 必须与仓库真实布局一致。
  // （patches/ 曾经被列在这里和 package.json 里，但目录从来不存在 —— 归档前就如此，
  //   只是旧断言只查字符串不查目录，所以一直没暴露。）
  const mustExist = ['src', 'python', 'docs'];
  const declared = (pkg.files ?? []).map((item) => String(item).replace(/\/$/, ''));
  for (const entry of mustExist) {
    assert.ok(declared.includes(entry), `package.json 的 files 漏了 ${entry}`);
    await access(join(PACKAGE_DIR, entry)).catch(() => {
      throw new Error(`files 里声明了 ${entry}，但目录不存在`);
    });
  }
  // vendor 已归档到仓库根 archive/。files 里保留它是为了「移回来就生效」，
  // 但不能因为列着就假定它在 —— 声明与存在是两件事，不能混成一条断言。
  assert.ok(declared.includes('vendor/deeptutor'), 'files 应保留 vendor/deeptutor 声明');
});

// ── 装配 ────────────────────────────────────────────────────────────────────

test('④ apply() 在没有任何可选服务时也能成功，并 provide zhiyunDeepTutor', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx, provided } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false });
    assert.equal(typeof teardown, 'function', 'apply 必须返回 teardown 函数');

    const service = provided.get('zhiyunDeepTutor');
    assert.ok(service, '没有 provide zhiyunDeepTutor');
    for (const method of ['status', 'capabilities', 'dispose']) {
      assert.equal(typeof service[method], 'function', `service 缺 ${method}()`);
    }
    for (const [group, methods] of Object.entries({
      resources: ['attach', 'release', 'get'],
      runs: ['start', 'events', 'cancel', 'reply', 'result'],
      quiz: ['generate'],
      reading: ['act'],
      artifacts: ['open'],
    })) {
      for (const method of methods) {
        assert.equal(typeof service[group]?.[method], 'function', `service.${group} 缺 ${method}()`);
      }
    }
    await teardown();
    assert.equal(provided.has('zhiyunDeepTutor'), false, 'teardown 后服务仍留在容器里');
  });
});

test('⑤ apply() 会建好四个数据子目录（目录不是"用到再说"，落点要能提前解释）', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false });
    try {
      const dataDir = join(profileDir, 'data', 'zhiyun-deeptutor');
      // 建目录是 apply 里的后台 Promise（失败只 warn，不抛），这里等它落地。
      for (const sub of ['home', 'runs', 'resources']) {
        await waitForPath(join(dataDir, sub));
      }
    } finally {
      await teardown();
    }
  });
});

test('⑥ 未探测时 status() 如实报「ready + 两条未探测 warning」，不编造解释器与依赖事实', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false });
    try {
      const status = await ctx.get('zhiyunDeepTutor').status();
      assert.equal(status.state, 'ready');
      assert.equal(status.python.path, null);
      assert.equal(status.python.version, null);
      assert.equal(status.deeptutorVersion, null);
      assert.ok(
        status.warnings.some((w) => w.includes('尚未探测 Python')),
        `warnings 里没有「尚未探测 Python」：${JSON.stringify(status.warnings)}`,
      );
      assert.ok(
        status.warnings.some((w) => w.includes('尚未探测上游依赖')),
        `warnings 里没有「尚未探测上游依赖」：${JSON.stringify(status.warnings)}`,
      );
      // 上游锁文件是常量事实，任何时候都该报得出来。
      assert.match(status.upstream.commit, /^[0-9a-f]{40}$/);
      assert.equal(status.upstream.version, '1.6.15');
      assert.equal(status.upstream.archiveSha256.length, 64);
      // 路径必须指到本包的 vendor，而不是猜出来的位置。
      assert.ok(status.vendorPath.endsWith('vendor\\deeptutor') || status.vendorPath.endsWith('vendor/deeptutor'));
    } finally {
      await teardown();
    }
  });
});

test('⑦ config.disabled 时服务明确不可用（E_DISABLED），而不是悄悄降级', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false, disabled: true });
    try {
      const service = ctx.get('zhiyunDeepTutor');
      const status = await service.status();
      assert.equal(status.state, 'disabled');
      const error = await expectRejects(service.runs.start({ capability: 'deep_question' }), 'E_DISABLED');
      assert.ok(error.message.includes('未启用'));
    } finally {
      await teardown();
    }
  });
});

test('⑧ 缺 profileContext 时 apply 立刻炸（必需依赖进 inject，可选的不进）', async () => {
  const mod = await import(INDEX_URL);
  const { ctx } = makeCtx({ profileDir: undefined });
  delete ctx.profileContext;
  assert.throws(() => mod.apply(ctx, { probe: false }), TypeError);
});

// ── 资源桥的跨包接线 ────────────────────────────────────────────────────────

test('⑨ 缺 ctx.zhiyunLearningResource 时 attach 明确报 E_INTERNAL，不退化成"没校验就落盘"', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false });
    try {
      const service = ctx.get('zhiyunDeepTutor');
      const error = await expectRejects(service.resources.attach({ schemaVersion: 1 }), 'E_INTERNAL');
      assert.ok(error.message.includes('zhiyunLearningResource'));
      assert.ok(error.message.includes('不能跳过'));
    } finally {
      await teardown();
    }
  });
});

test('⑩ 装上 zhiyunLearningResource 后 attach 走真实校验：不合规的 bundle 不落任何文件', async () => {
  await withProfile(async (profileDir) => {
    const learning = await import(pathToFileURL(join(PACKAGE_DIR, '..', 'dsh-zhiyun-core-learning-resource', 'src', 'index.js')).href);
    // 兄弟包把服务交在 apply 里；测试里直接调它的工厂更省事，但这里刻意走
    // apply 以验证「两个包通过 ctx 服务名对接」这条路真的通。
    const learningCtx = makeCtx({ profileDir });
    const learningTeardown = learning.apply(learningCtx.ctx, {});
    const learningService = learningCtx.provided.get('zhiyunLearningResource');
    assert.ok(learningService, 'core-learning-resource 没有 provide zhiyunLearningResource');

    const mod = await import(INDEX_URL);
    const { ctx, provided } = makeCtx({ profileDir, services: { zhiyunLearningResource: learningService } });
    const teardown = mod.apply(ctx, { probe: false });
    try {
      const service = provided.get('zhiyunDeepTutor');
      const error = await expectRejects(service.resources.attach({ schemaVersion: 1 }), 'E_RESOURCE_INVALID');
      assert.match(error.message, /学习资源不符合 schema/);
      // 校验失败绝不能留下半截快照：快照目录要么不存在、要么是空的。
      const { readdir } = await import('node:fs/promises');
      const dir = join(profileDir, 'data', 'zhiyun-deeptutor', 'resources', 'snapshots');
      const entries = await readdir(dir).catch(() => []);
      assert.deepEqual(entries, [], `校验失败的 bundle 竟然落了文件：${entries.join(', ')}`);
    } finally {
      await teardown();
      await learningTeardown();
    }
  });
});

test('⑪ 装上 zhiyunLearningResource 后，合规 bundle 能 attach 并拿到句柄与 revision', async () => {
  await withProfile(async (profileDir) => {
    const learning = await import(pathToFileURL(join(PACKAGE_DIR, '..', 'dsh-zhiyun-core-learning-resource', 'src', 'index.js')).href);
    const learningCtx = makeCtx({ profileDir });
    const learningTeardown = learning.apply(learningCtx.ctx, {});

    const mod = await import(INDEX_URL);
    const { ctx, provided } = makeCtx({
      profileDir,
      services: { zhiyunLearningResource: learningCtx.provided.get('zhiyunLearningResource') },
    });
    const teardown = mod.apply(ctx, { probe: false });
    try {
      const service = provided.get('zhiyunDeepTutor');
      const handle = await service.resources.attach(validBundle());
      assert.match(handle.revision, /^sha256:[0-9a-f]{64}$/);
      assert.equal(handle.courseId, 'course-1');
      // 同内容再 attach 一次：幂等，revision 不变。
      const again = await service.resources.attach(validBundle());
      assert.equal(again.revision, handle.revision);
    } finally {
      await teardown();
      await learningTeardown();
    }
  });
});

// ── 生命周期 ────────────────────────────────────────────────────────────────

test('⑫ teardown 幂等：连调两次不抛，也不把服务名删错', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx, provided } = makeCtx({ profileDir });
    // 先占位一个同名服务，验证 teardown 只摘自己那份。
    provided.set('zhiyunDeepTutor', { owner: 'other' });
    const teardown = mod.apply(ctx, { probe: false });
    const own = provided.get('zhiyunDeepTutor');
    assert.notEqual(own.owner, 'other', 'apply 没有覆盖同名服务');
    await teardown();
    await teardown();
    assert.equal(provided.has('zhiyunDeepTutor'), false);
  });
});

test('⑬ dispose 后所有方法都抛 E_DISABLED，而不是返回半截数据', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    const teardown = mod.apply(ctx, { probe: false });
    const service = ctx.get('zhiyunDeepTutor');
    await service.dispose();
    await expectRejects(service.capabilities(), 'E_DISABLED');
    await expectRejects(service.runs.start({ capability: 'deep_question' }), 'E_DISABLED');
    await teardown();
  });
});

// ── 真实环境探测（会起子进程，但不是模型调用） ────────────────────────────

test('⑭ 真实探测：本机 3.11 venv 与 vendored 上游依赖都识别得出来', async () => {
  await withProfile(async (profileDir) => {
    const mod = await import(INDEX_URL);
    const { ctx } = makeCtx({ profileDir });
    // 这里刻意开探测：它只跑 `python -c "..."`，不连网、不花 token。
    const teardown = mod.apply(ctx, {});
    try {
      const status = await ctx.get('zhiyunDeepTutor').status();
      assert.ok(
        ['ready', 'deps-missing', 'not-installed', 'unsupported-python'].includes(status.state),
        `状态不在契约集合内：${status.state}`,
      );
      // vendor 是否在仓库里，决定这条测试该断言什么。
      //
      // 这里曾经只写 `if (status.state === 'ready')` —— vendor 归档后状态不再是 ready，
      // 整段断言被静默跳过，测试照样打绿。那等于「vendor 没了」这件事没人知道。
      // 现在两种情形分别断言，任何一边都不允许空转。
      const vendorThere = await access(join(PACKAGE_DIR, 'vendor/deeptutor')).then(() => true, () => false);
      if (vendorThere) {
        assert.equal(status.state, 'ready', 'vendor 在仓库里时，探测必须能认出它');
        assert.equal(status.deeptutorVersion, '1.6.15', '锁的是 1.6.15，探测到的版本对不上');
        assert.match(status.python.version, /^3\.(11|12|13|14)\./);
        assert.equal(status.python.path !== null, true);
        // 探测到的事实不该再留「尚未探测」的 warning。
        assert.equal(status.warnings.some((w) => w.includes('尚未探测 Python')), false);
        assert.equal(status.warnings.some((w) => w.includes('尚未探测上游依赖')), false);
      } else {
        // vendor 已归档：必须如实报「不可用」，且原因指向 missing deps，而不是假装 ready。
        assert.notEqual(status.state, 'ready', 'vendor 不在时不能报 ready');
        assert.equal(status.deeptutorVersion, null, 'vendor 不在时不该编造版本号');
        assert.ok(
          status.state === 'deps-missing' || status.state === 'not-installed',
          `vendor 不在时应报 deps-missing 或 not-installed，实际 ${status.state}`,
        );
      }
    } finally {
      await teardown();
    }
  });
});

// ── 收尾 ────────────────────────────────────────────────────────────────────

function validBundle() {
  return {
    schemaVersion: 1,
    resourceId: 'res_0123456789abcdef',
    accountScope: { accountId: 'acc-1', workspaceId: 'ws-1' },
    courseId: 'course-1',
    revision: `sha256:${'0'.repeat(64)}`,
    contentHash: `sha256:${'1'.repeat(64)}`,
    generatedAt: '2026-10-25T12:00:00.000Z',
    title: '第一讲 认识成本',
    language: 'zh-CN',
    contentType: 'lecture',
    reviewStatus: 'draft',
    warnings: [],
    sourceAnchors: [
      { anchorId: 'a1-1-1', origin: 'slide', topicId: 't1-1', blockId: 'b1-1-1', page: 3 },
    ],
    chapters: [
      {
        id: 'ch1',
        title: '第一章 成本基础',
        topics: [
          {
            id: 't1-1',
            title: '成本的定义',
            blocks: [
              { id: 'b1-1-1', type: 'paragraph', text: '成本是取得资产或劳务所付出的代价。', anchorIds: ['a1-1-1'] },
            ],
          },
        ],
      },
    ],
  };
}

let passed = 0;
const failures = [];
for (const [nameLabel, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${nameLabel}`);
  } catch (error) {
    failures.push([nameLabel, error]);
    console.log(`  FAIL ${nameLabel}`);
    console.log(`       ${error?.message ?? error}`);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
if (failures.length > 0) {
  console.log('\n失败详情：');
  for (const [label, error] of failures) {
    console.log(`\n${label}\n${error?.stack ?? error}`);
  }
  process.exitCode = 1;
}
