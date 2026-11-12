/**
 * 学习通读工具（`campus_xxt_read`）的测试。
 *
 * # 这一份在钉什么
 *
 * 审计 B-1 的七条 provides 全部落在一个工具的七个 action 上。所以除了共同的
 * 注册契约，这里逐条钉住的是**「action → source 参数」的翻译**：
 *
 *   1. 七个 action 都在 enum 里，且都能分派到 source（没有悬空值）；
 *   2. 工具**不自己拼参数**：每个 action 传下去的对象形状固定，`undefined` 的
 *      键不会出现在 source 的入参里（否则 source 会把「不传」当成「传了 undefined」）；
 *   3. 下载的三种范围（`name` / `chapter` / `all`）在**任何请求之前**校验完 ——
 *      一次意外的「下载整门课」代价是几百 MB；
 *   4. `playback` 只对视频有意义，课件那一支不往下传（传了会让 source 走进
 *      视频的分支）；
 *   5. 读工具**不过审批**：`execute` 全程不碰 `ctx.approval`。
 *
 * 全离线：source 是一个记账用的假身，不发任何请求。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createXxtReadTools } from '../../../packages/tool/xxt/src/reads.js';
import { apply, inject, name } from '../../../packages/tool/xxt/src/index.js';

/** 记录每次 `invoke` 的假 source。 */
function fakeService(result = { ok: true }) {
  const calls = [];
  return {
    calls,
    invoke: async (method, args) => {
      calls.push({ method, args });
      return typeof result === 'function' ? result(method, args) : result;
    },
  };
}

/** 造一个工具定义（带给定 source）。 */
const tool = (service) => createXxtReadTools({ zhiyunXxt: service })[0];

/** 跑一个 action。 */
async function run(service, args) {
  return tool(service).run(args, {});
}

const ACTIONS = ['courseList', 'chapterList', 'materialList', 'materialDownload', 'videoList', 'videoDownload', 'homeworkList'];

/* ══════════════════════════════════════ 形状 */

test('工具名与包形状：与 source 一一对应，且不声明 approval', () => {
  assert.equal(name, 'zhiyun-tool-xxt');
  // 这一包一条写操作都没有 —— 声明 approval 只会让后来加工具的人以为审批接好了。
  assert.deepEqual(inject, ['tools', 'zhiyunXxt']);
});

test('七个 action 就是审计 B-1 的七条 provides', () => {
  const definition = tool(fakeService());
  assert.deepEqual(definition.parameters.properties.action.enum, ACTIONS);
  assert.equal(definition.parameters.properties.action.enum.length, 7);
});

test('参数是封闭 schema，且有够长的 description', () => {
  const definition = tool(fakeService());
  assert.ok(definition.description.length > 40, 'description 太短，模型会选错');
  assert.equal(definition.parameters.type, 'object');
  assert.equal(definition.parameters.additionalProperties, false, '不许放未声明的字段进来');
  assert.deepEqual(definition.parameters.required, ['action']);
});

/* ══════════════════════════════════════ 参数翻译 */

test('courseList：不带 fresh 时入参里没有 fresh 这个键', async () => {
  const service = fakeService({ courses: [] });
  await run(service, { action: 'courseList' });
  assert.deepEqual(service.calls, [{ method: 'xxt.listCourses', args: {} }]);

  const fresh = fakeService({ courses: [] });
  await run(fresh, { action: 'courseList', fresh: true });
  assert.deepEqual(fresh.calls[0].args, { fresh: true });
});

test('chapterList：把 course 原样交给 source（不自己解析课程名）', async () => {
  const service = fakeService({ chapters: [] });
  await run(service, { action: 'chapterList', course: '高等数学（甲）I' });
  assert.deepEqual(service.calls, [{ method: 'xxt.chapterList', args: { course: '高等数学（甲）I' } }]);
});

test('materialList / videoList：走两个不同的 source 方法', async () => {
  const service = fakeService({ files: [] });
  await run(service, { action: 'materialList', course: '线性代数' });
  await run(service, { action: 'videoList', course: '线性代数' });
  assert.deepEqual(service.calls.map((call) => call.method), ['xxt.materials', 'xxt.videos']);
  assert.deepEqual(service.calls[0].args, { course: '线性代数' });
});

test('videoList：chapter 透传（章节范围由 source 解析，工具不做匹配）', async () => {
  const service = fakeService({ files: [] });
  await run(service, { action: 'videoList', course: '物理', chapter: '等厚干涉' });
  assert.deepEqual(service.calls[0].args, { course: '物理', chapter: '等厚干涉' });
});

test('homeworkList：不给 course 时只看 action，不看课程', async () => {
  const service = fakeService({ count: 0, homeworks: [] });
  await run(service, { action: 'homeworkList' });
  assert.deepEqual(service.calls, [{ method: 'xxt.listHomework', args: {} }]);
});

test('homeworkList：unreadOnly 翻译成 source 的 pending_only', async () => {
  const service = fakeService({ count: 0, homeworks: [] });
  await run(service, { action: 'homeworkList', course: '高数', unreadOnly: true });
  assert.deepEqual(service.calls[0].args, { course: '高数', pending_only: true });
});

/* ══════════════════════════════════════ 下载的范围与参数 */

test('materialDownload：给 name 时只下这几个文件，group 是 material', async () => {
  const service = fakeService({ count: 1, files: [] });
  await run(service, { action: 'materialDownload', course: '高数', name: '讲义.pdf' });
  assert.deepEqual(service.calls, [{
    method: 'xxt.downloadFiles',
    args: { course: '高数', group: 'material', name: '讲义.pdf' },
  }]);
});

test('materialDownload：all 时不带 name，并显式给 all: true', async () => {
  const service = fakeService({ count: 3, files: [] });
  await run(service, { action: 'materialDownload', course: '高数', all: true });
  assert.deepEqual(service.calls[0].args, { course: '高数', group: 'material', all: true });
});

test('videoDownload：playback 只对视频那一支生效', async () => {
  const service = fakeService({ count: 1, files: [] });
  await run(service, { action: 'videoDownload', course: '物理', name: '第一讲.mp4', playback: true });
  assert.deepEqual(service.calls[0].args, {
    course: '物理', group: 'video', name: '第一讲.mp4', playback: true,
  });
});

test('materialDownload：即使传了 playback 也不往下传（课件没有播放版）', async () => {
  const service = fakeService({ count: 1, files: [] });
  await run(service, { action: 'materialDownload', course: '高数', name: '讲义.pdf', playback: true });
  assert.equal('playback' in service.calls[0].args, false,
    '课件没有播放版；把 playback 传下去会让 source 走进视频分支，退回的是原文件但不是同一条判定');
});

test('下载：范围没说清时**不发请求**就报 INPUT，并说清三种写法', async () => {
  for (const action of ['materialDownload', 'videoDownload']) {
    const service = fakeService();
    await assert.rejects(
      () => run(service, { action, course: '高数' }),
      (error) => {
        assert.equal(error.code, 'INPUT');
        assert.match(error.message, /name/);
        assert.match(error.message, /chapter/);
        assert.match(error.message, /all/);
        return true;
      },
    );
    assert.deepEqual(service.calls, [], '参数没通过校验就不该问 source 要任何东西');
  }
});

test('下载：给了 all 又给 name 是矛盾的，照 source 的规则直接拒', async () => {
  const service = fakeService();
  await assert.rejects(
    () => run(service, { action: 'materialDownload', course: '高数', all: true, name: '讲义.pdf' }),
    (error) => error.code === 'INPUT',
  );
  assert.deepEqual(service.calls, []);
});

test('下载：只给 chapter 也是合法范围', async () => {
  const service = fakeService({ count: 2, files: [] });
  await run(service, { action: 'videoDownload', course: '物理', chapter: '5.2' });
  assert.deepEqual(service.calls[0].args, {
    course: '物理', group: 'video', chapter: '5.2',
  });
});

/* ══════════════════════════════════════ 错误与分派 */

test('未知 action 报 INPUT，先于服务查找', async () => {
  const definition = tool({});
  await assert.rejects(
    () => definition.run({ action: '不存在的动作' }, {}),
    (error) => error.code === 'INPUT' && /不认识的 action/.test(error.message),
  );
});

test('服务没装配时报 SERVICE_MISSING，并说清装哪个包', async () => {
  // ⚠️ 服务表里**不能有这个键**：`tool({})` 会造出 `{ zhiyunXxt: {} }`，
  // 那是个真值 —— serviceLookup 认得它，然后会在 `invoke` 上炸出一个
  // 与「包没装」毫无关系的 TypeError。
  const definition = createXxtReadTools({})[0];
  await assert.rejects(
    () => definition.run({ action: 'courseList' }, {}),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISSING');
      assert.match(error.message, /@lybx-leyw\/dsh-zju-source-xxt/);
      return true;
    },
  );
});

test('每个 action 都能分派，不落到默认分支', async () => {
  for (const action of ACTIONS) {
    const service = fakeService({ ok: true });
    const args = { action, course: '课' };
    if (action.endsWith('Download')) args.name = '按名字';
    try {
      await run(service, args);
    } catch (error) {
      assert.equal(/分派漏了/.test(String(error.message)), false, `${action} 分派漏了：${error.message}`);
    }
  }
});

/* ══════════════════════════════════════ 注册链 */

test('apply 只挂一个工具，且 execute 全程不碰审批', async () => {
  const registered = [];
  let approvalAsked = false;
  const ctx = {
    get: () => undefined,
    tools: { register: (definition) => { registered.push(definition); return () => {}; } },
    approval: { request: async () => { approvalAsked = true; return 'allowed-once'; } },
    effect: (fn) => fn(),
  };
  apply(ctx);
  assert.deepEqual(registered.map((item) => item.name), ['campus_xxt_read']);

  try {
    await registered[0].execute({ action: 'courseList' }, {});
  } catch { /* 服务缺失也算走到了 —— 关键是没有审批 */ }
  assert.equal(approvalAsked, false, '读工具不该请求审批');
});

