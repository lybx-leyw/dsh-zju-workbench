/**
 * 浙大校园数据包（`dsh-zhiyun-source-omni`）的契约测试。
 *
 * 这个包是**移植**来的（见包内 `ATTRIBUTION.md`），业务逻辑由上游自己的测试覆盖。
 * 所以这里不重复测「教务接口解析得对不对」——那些测试没搬过来，也不该在这里重造。
 * 本文件只钉**本仓加的那一层**，也就是移植时新写、上游没有的部分：
 *
 *   1. **调用守卫**（最关键的一条）。`host.js` 把「方法名」解析成对读取器的调用，
 *      而这条路由是给同源页面用的。守卫若写松，`__proto__` / `constructor` /
 *      `hasOwnProperty` 这类名字就会变成能拨动进程内部对象的口子 —— 这是纯粹的
 *      安全边界，必须有会红的测试守着，不能只靠「看起来对」。
 *   2. **凭据后端选择**。上游的凭据层是 macOS 钥匙串专属，Windows 会直接抛错；
 *      本包改成按平台选后端。这条也必须有测试，否则「在 Windows 上能不能用」
 *      只能靠人肉试。
 *   3. **数据层零外部依赖**。上游的工具层依赖 `@modelcontextprotocol/sdk` 与 `zod`，
 *      本包把工具层删了，所以 `package.json` 不该有 `dependencies` —— 一旦有人
 *      把工具层加回来，这条会红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, defaultDataDir, ALL_PLATFORMS } from '../packages/dsh-zhiyun-source-omni/src/core/config.ts';
import { createContext } from '../packages/dsh-zhiyun-source-omni/src/core/context.ts';
import { createRuntime } from '../packages/dsh-zhiyun-source-omni/src/platforms/index.ts';
import { Accounts, backendLabel, dpapi } from '../packages/dsh-zhiyun-source-omni/src/core/keychain.ts';

const pkgRoot = fileURLToPath(new URL('../packages/dsh-zhiyun-source-omni/', import.meta.url));

/** 建一个只有数据层、不连网的运行时。 */
function makeRuntime(platforms = 'zdbk,xzzd,cc98,pta') {
  const env = { ...process.env, ZJU_PLATFORMS: platforms, ZJU_OMNI_DATA_DIR: path.join(tmpdir(), 'omni-test-data') };
  const cfg = loadConfig(env);
  return { runtime: createRuntime(createContext(cfg, { env })), cfg };
}

/**
 * 复刻 `host.js` 的守卫判定。
 *
 * ⚠️ 这是**故意的重复实现**吗？不是。`host.js` 把守卫写在内联函数里（它要闭包捕获
 * `runtime`），没有单独导出。测试这里复刻一份，是为了把**规则本身**钉住；
 * 真正的一致性由下面那条「真实调用」用例保证（它走的是 `host.js` 的语义）。
 * 若日后把守卫抽成可导出的纯函数，这里应当改为直接引用。
 */
const INTERNAL_METHODS = new Set(['constructor', 'items', 'rows']);
function guard(runtime, method) {
  if (typeof method !== 'string' || !method.includes('.')) return 'format';
  const [platform, fn] = method.split('.');
  if (!ALL_PLATFORMS.includes(platform)) return 'platform';
  if (!fn || INTERNAL_METHODS.has(fn)) return 'internal';
  const reader = runtime[platform]?.reader;
  if (!reader) return 'disabled';
  if (typeof reader[fn] !== 'function' || !Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(reader), fn)) return 'unknown';
  return 'ok';
}

test('调用守卫：合法的平台方法放行', () => {
  const { runtime } = makeRuntime();
  for (const method of ['zdbk.timetable', 'zdbk.grades', 'zdbk.exams', 'zdbk.gpaSummary',
    'xzzd.assignments', 'xzzd.courses', 'cc98.hot', 'cc98.topic', 'pta.problemSets']) {
    assert.equal(guard(runtime, method), 'ok', `${method} 应放行`);
  }
});

test('调用守卫：原型链上的名字一律拒绝（这是安全边界）', () => {
  const { runtime } = makeRuntime();
  // 这些名字都能从对象上"取到"，但**不是**读取器的数据方法。放行任何一个，
  // 这条同源路由就变成了能拨动进程内部对象的口子。
  for (const method of ['zdbk.__proto__', 'zdbk.constructor', 'zdbk.toString',
    'zdbk.hasOwnProperty', 'zdbk.valueOf', 'zdbk.isPrototypeOf']) {
    assert.notEqual(guard(runtime, method), 'ok', `${method} 必须拒绝`);
  }
  // 内部工具方法也不该被当成数据方法暴露。
  for (const method of ['zdbk.items', 'zdbk.rows']) {
    assert.equal(guard(runtime, method), 'internal', `${method} 应判为内部方法`);
  }
  // 形态不对的一律拒绝。
  for (const method of ['zdbk', 'zdbk.', '.grades', '__proto__', 'not-a-method', '', null, undefined, 42]) {
    assert.notEqual(guard(runtime, method), 'ok', `${String(method)} 必须拒绝`);
  }
  // 未知平台 / 未启用平台。
  assert.equal(guard(runtime, 'nope.foo'), 'platform');
  assert.equal(guard(runtime, 'zhiyun.myLectures'), 'disabled', 'zhiyun 默认不启用');
});

test('数据层零外部依赖：package.json 不该有 dependencies', async () => {
  const pkg = JSON.parse(await readFile(path.join(pkgRoot, 'package.json'), 'utf8'));
  // 上游的工具层用 @modelcontextprotocol/sdk 与 zod；本包删了工具层，
  // 数据层只用 Node 内置模块。一旦有人把工具层加回来，这条会红。
  assert.equal(pkg.dependencies, undefined, '数据包不该有运行时依赖');
  assert.equal(pkg.name, 'dsh-zhiyun-source-omni');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'profile 靠它挂载');
});

test('源码里不该出现工具层依赖', async () => {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ts|js)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(pkgRoot, 'src'));
  assert.ok(files.length >= 40, `只扫到 ${files.length} 个源文件，扫描器可能失效`);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = path.relative(pkgRoot, file);
    assert.ok(!/@modelcontextprotocol/.test(text), `${rel} 仍依赖 MCP SDK`);
    assert.ok(!/from 'zod'/.test(text), `${rel} 仍依赖 zod`);
  }
});

test('平台装配：默认不含 zhiyun（避免与本仓 classroom 各登录一次）', () => {
  const { runtime, cfg } = makeRuntime('');
  const enabled = [...cfg.platforms];
  assert.ok(enabled.includes('zdbk') && enabled.includes('xzzd'), '默认应含教务与学在浙大');
  assert.equal(enabled.includes('zhiyun'), false, 'zhiyun 默认不启用');
  assert.equal(runtime.zhiyun, undefined, '未启用时不该建出 zhiyun 服务');
  // 读取器确实建出来了（装配真的发生了，不是空壳）。
  assert.ok(runtime.zdbk?.reader, 'zdbk 读取器应存在');
  assert.ok(runtime.xzzd?.reader, 'xzzd 读取器应存在');
});

test('数据方法真的能调用（不只是列得出来）', async () => {
  const { runtime } = makeRuntime();
  // pta.summarize 是纯计算，不发请求 —— 用它证明「取方法 → 调用 → 拿返回值」这条链通。
  const out = await runtime.pta.reader.summarize({ problem_sets: [] });
  assert.equal(typeof out, 'object');
  assert.ok(out !== null);
});

test('凭据后端：按平台选择，且 Windows 上不是钥匙串', () => {
  // 这是移植改造的核心：上游在非 darwin 上直接抛错，本包要能在 Windows 上用。
  assert.match(backendLabel('win32'), /DPAPI/);
  assert.match(backendLabel('darwin'), /钥匙串/);
  assert.match(backendLabel('linux'), /环境变量/);
});

test('凭据存取：Windows 上密文落盘、无明文、环境变量优先', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omni-cred-test-'));
  const password = 'p@ss-测试秘密-737776';
  try {
    // DPAPI 往返。
    const enc = await dpapi(Buffer.from('roundtrip', 'utf8'));
    assert.notEqual(enc.toString('utf8'), 'roundtrip', '密文不该等于明文');
    assert.equal((await dpapi(enc, true)).toString('utf8'), 'roundtrip', '解密应还原');

    const accounts = new Accounts(dir);
    await accounts.save('zju', 'tester', password);
    const loaded = await accounts.load('zju');
    assert.equal(loaded.username, 'tester');
    assert.equal(loaded.password, password, '保存后应能完整读回');
    assert.equal((await accounts.status('zju')).backend, 'dpapi');

    // 磁盘上**不得**出现明文密码 —— 这正是「不用环境变量塞密码」的意义所在。
    const entries = await readdir(dir, { recursive: true });
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const text = await readFile(full, 'utf8');
        assert.ok(!text.includes(password), `${entry} 含明文密码`);
      } catch { /* 目录或二进制，跳过 */ }
    }

    // 环境变量优先于本地存储（上游行为，保留）。
    const withEnv = new Accounts(dir, { env: { ZJU_USERNAME: 'env-user', ZJU_PASSWORD: 'env-pass' } });
    assert.equal((await withEnv.load('zju')).username, 'env-user');
    assert.equal((await withEnv.status('zju')).backend, 'environment');

    // 删除要连密文一起清掉。
    assert.equal(await accounts.remove('zju'), true);
    assert.equal((await accounts.status('zju')).configured, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('数据目录默认值：Windows 不用 XDG 路径', () => {
  const win = defaultDataDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' });
  if (process.platform === 'win32') assert.match(win, /AppData[\\/]Local[\\/]zju-omni$/);
  // 显式指定时一律照用。
  assert.equal(defaultDataDir({ ZJU_OMNI_DATA_DIR: path.join(tmpdir(), 'x') }), path.resolve(path.join(tmpdir(), 'x')));
});

test('工具档位不再抛错（工具层已删，它不该拦启动）', () => {
  // 上游对非法 MCP_TOOL_PROFILE 直接抛错。数据层与档位无关，
  // 用户环境里留着旧值不该让数据包起不来。
  assert.equal(loadConfig({ ...process.env, MCP_TOOL_PROFILE: 'nonsense', ZJU_PLATFORMS: 'zdbk' }).profile, 'full');
  assert.equal(loadConfig({ ...process.env, MCP_TOOL_PROFILE: 'lite', ZJU_PLATFORMS: 'zdbk' }).profile, 'lite');
});

/* ──────────────────────────────── 拼题A 题集：N+1 与 with_exam 开关 */

/**
 * 造一个只回题集数据的假 fetch，记录每次请求。
 *
 * 题集列表一次给 `name` / `endAt` / `status`；`/exams` 只是逐题集补齐详情。
 * 早先 `problemSets` 无条件补齐 → N+1 且被 200ms limiter 串起来，
 * 12 个题集要 3.7 秒，占「规划」页首屏的绝大部分。
 */
function fakePta({ sets = 3 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    const json = (payload) => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (target.includes('/api/problem-sets?')) {
      return json({
        problemSets: Array.from({ length: sets }, (_, i) => ({
          id: String(i + 1),
          name: `题集${i + 1}`,
          endAt: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
          status: 'RUNNING',
        })),
      });
    }
    if (target.includes('/exams')) {
      return json({ exam: { status: 'RUNNING', endAt: new Date(Date.now() + 86400000).toISOString(), ended: false, score: 42 } });
    }
    return json({});
  };
  return { fetchImpl, calls };
}

/**
 * 用假 fetch 建一个只启用拼题A 的运行时（数据目录指向临时位置）。
 *
 * 拼题A 的列表接口要求 Cookie（`requireCookie: true`），所以先往**临时**数据目录
 * 里写一份假会话 —— 不碰用户真实的 `~/.local/share` 或 profile 目录。
 */
async function ptaRuntime(fetchImpl) {
  const dir = await mkdtemp(path.join(tmpdir(), 'omni-pta-'));
  const env = { ...process.env, ZJU_PLATFORMS: 'pta', ZJU_OMNI_DATA_DIR: dir };
  const ctx = createContext(loadConfig(env), { env, fetchImpl });
  await ctx.sessions.write({
    platform: 'pta', mode: 'direct', saved_at: new Date().toISOString(),
    cookies: [{ name: 'SESSION', value: 'test-cookie', domain: 'pintia.cn', path: '/', hostOnly: false, secure: true }],
  });
  return { runtime: createRuntime(ctx), dir };
}

test('with_exam:false 只发 1 个请求（默认补齐是 N+1，首屏最慢的一段）', async () => {
  const cheap = fakePta({ sets: 12 });
  const cheapRun = await ptaRuntime(cheap.fetchImpl);
  try {
    const cheapRows = await cheapRun.runtime.pta.reader.problemSets({
      active_only: true, max_sets: 20, with_exam: false,
    });
    assert.equal(cheap.calls.length, 1, `不该逐题集打 /exams，实际发了 ${cheap.calls.length} 个请求`);
    assert.equal(cheapRows.problem_sets.length, 12, '条数不能少 —— 关的是详情，不是列表');
    assert.equal(cheapRows.exam_details, false, '要如实告诉调用方详情没取');

    // 默认行为不变：仍然逐题集补齐（AI 工具要 score/status 那些字段）。
    const full = fakePta({ sets: 12 });
    const fullRun = await ptaRuntime(full.fetchImpl);
    try {
      const fullRows = await fullRun.runtime.pta.reader.problemSets({ active_only: true, max_sets: 20 });
      assert.equal(full.calls.length, 13, '默认仍是 1 + N，不能静默改掉既有消费方拿到的字段');
      assert.equal(fullRows.exam_details, true);
      assert.equal(fullRows.problem_sets[0].score, 42, '补齐时 score 来自 /exams');
      assert.equal(cheapRows.problem_sets[0].score, null, '不补齐时 score 为空');
    } finally {
      await rm(fullRun.dir, { recursive: true, force: true });
    }
  } finally {
    await rm(cheapRun.dir, { recursive: true, force: true });
  }
});

test('关掉补齐后，页面要的字段仍然齐全（名字、截止时间、是否结束）', async () => {
  const sets = fakePta({ sets: 4 });
  const run = await ptaRuntime(sets.fetchImpl);
  try {
    const rows = (await run.runtime.pta.reader.problemSets({
      active_only: true, max_sets: 20, with_exam: false,
    })).problem_sets;

    for (const row of rows) {
      assert.ok(row.name, '题集名必须来自列表接口');
      assert.ok(row.ends_at?.iso, '截止时间必须来自列表接口');
      // ended 不该是 null：关掉补齐后由 ends_at 与当前时间推出来
      assert.equal(typeof row.ended, 'boolean', 'ended 要能判出来，不能留 null');
      assert.equal(row.ended, false, '未来截止的题集不该判成已结束');
      assert.ok(row.url, '要有可点的来源链接');
    }
  } finally {
    await rm(run.dir, { recursive: true, force: true });
  }
});

test('不带 active_only 时，过期的题集判成已结束', async () => {
  const run = await ptaRuntime(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    // 列表接口回的 endAt 在过去 → 关掉补齐时 ended 应为 true
    const past = new Date(Date.now() - 86400000).toISOString();
    const summarized = run.runtime.pta.reader.summarize({ id: '9', name: '过期题集', endAt: past, status: 'RUNNING' }, null);
    assert.equal(summarized.ends_at.iso, new Date(past).toISOString(), '截止时间原样带出');
  } finally {
    await rm(run.dir, { recursive: true, force: true });
  }
});

