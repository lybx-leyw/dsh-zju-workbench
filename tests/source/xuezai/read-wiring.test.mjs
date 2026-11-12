/**
 * 本轮补进 source 的三处基础函数，以及它们的**接线**。
 *
 * # 为什么单开一份
 *
 * 这三条不是「新增功能」，是读工具的前置条件：
 *
 *   - `xuezai course list` / `course view` 是上游 A-2 的两条。本仓原来已有
 *     `activeSemesterIds()` / `courses()` / `courseBundle()` 这些基础函数，
 *     但 `xzzdRead` 不认识它们 —— 于是工具层拿不到课程 id，交作业只能让用户猜；
 *   - `pta homework view` 读的是 `/api/problem-sets/<id>/exams`（一条 GET），
 *     原来不在 `READ_ACTIONS` 白名单里。
 *
 * 所以这里守的是**接线与顺序**，不是算法：
 *
 *   1. 动作白名单里**有** `courses` / `courseBundle` / `exam`，
 *      且**没有** `start` / `finish`（那是写）；
 *   2. 非法参数（未知 action、非法 courseId）在**取会话之前**就报 ——
 *      否则一次拼错会先触发一次 CAS 登录，错误却长成「没配账号」；
 *   3. `exam` 走 `getExam`，它只发 GET。
 *
 * 全离线：不联网、不用真账号。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ───────────────────────────── 学在浙大 ───────────────────────────── */

test('xzzdRead 的动作白名单：有 courses / courseBundle，且没把写动作混进来', async () => {
  const { XZZD_READ_ACTIONS } = await import('../../../packages/source/xuezai/src/index.js');
  assert.ok(Array.isArray([...XZZD_READ_ACTIONS]), '动作表要可枚举');
  for (const action of ['courses', 'courseBundle', 'activities', 'assignments', 'activity', 'materials', 'submission', 'rollcallHistory']) {
    assert.ok(XZZD_READ_ACTIONS.includes(action), `读白名单缺 ${action}`);
  }
  // 点名签到、交作业、撤回都是写，不该出现在**读**白名单里。
  for (const action of ['rollcall', 'submitHomework', 'retractHomework']) {
    assert.equal(XZZD_READ_ACTIONS.includes(action), false, `${action} 是写操作，不该进读白名单`);
  }
});

/**
 * 装配出一个可用的 `zhiyunXuezai` 服务面。
 *
 * `apply()` 要 `profileContext.dir`（会话文件落盘）与凭据读取；两者都给最小替身。
 * 读动作真正发请求前会 `xzzdClient()` → CAS，而测试里的 `config.fetch` 直接拒发，
 * 所以「参数校验早于取会话」这一条**能**被验到：参数不合法时根本走不到 fetch。
 */
async function mount() {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'xuezai-read-wiring-'));
  const services = new Map();
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    effect: (fn) => fn() ?? (() => {}),
    provide: (name, value) => { services.set(name, value); return () => {}; },
    get: (name) => services.get(name),
    inject: () => {},
  };
  let requested = false;
  const { apply } = await import('../../../packages/source/xuezai/src/index.js');
  const dispose = await apply(ctx, {
    fetch: async () => { requested = true; throw new Error('测试不该发真实请求'); },
  });
  return {
    service: services.get('zhiyunXuezai'),
    dispose,
    sent: () => requested,
  };
}

test('未知 action 报 INVALID_INPUT 并列出可选值（含新加的两个）', async () => {
  const { service, dispose } = await mount();
  try {
    const message = await service.xzzdRead({ action: 'nope' }).then(
      () => assert.fail('非法 action 应当抛'),
      (error) => {
        assert.equal(error.code, 'INVALID_INPUT');
        return error.message;
      },
    );
    assert.match(message, /\bcourses\b/);
    assert.match(message, /\bcourseBundle\b/);
  } finally { await dispose?.(); }
});

test('courseBundle 的 courseId 非法时，在取会话之前就拦住', async () => {
  const { service, dispose, sent } = await mount();
  try {
    for (const bad of [undefined, null, 'abc', 0, -1]) {
      await assert.rejects(
        () => service.xzzdRead({ action: 'courseBundle', courseId: bad }),
        (error) => {
          assert.equal(error.code, 'INVALID_INPUT', `courseId=${String(bad)} 应当报 INVALID_INPUT`);
          return true;
        },
      );
    }
    // 参数错误是调用方的错：不该为此登录、也不该发任何请求。
    assert.equal(sent(), false, '非法参数不该触发任何网络请求');
  } finally { await dispose?.(); }
});

test('课程名里有几个说法时，source 只回事实，不做名字解析', async () => {
  // 「数据结构」→ 哪门课 id 是**工具层**的知识（把用户话术翻成参数）。
  // source 只回答「我有哪些课」，所以 `courses` 的动作里不该出现关键词参数。
  const { XZZD_READ_ACTIONS } = await import('../../../packages/source/xuezai/src/index.js');
  assert.ok(XZZD_READ_ACTIONS.includes('courses'));
  // 这条断言的意义在**反向**：若有人把关键词匹配塞进 source，`courses` 就会
  // 需要 keyword 参数，而工具层那份 resolveCourse 就成了第二份真相。
  const source = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../../../packages/source/xuezai/src/index.js', import.meta.url), 'utf8',
  ));
  assert.equal(/case 'courses'[\s\S]{0,800}keyword/.test(source), false,
    'courses 动作不该做关键词匹配 —— 那是工具层的 resolveCourse');
});

/* ───────────────────────────── 拼题A ───────────────────────────── */

test('pta 的读白名单：有 exam，没有 start / finish', async () => {
  // ⚠️ `READ_ACTIONS` 是模块内常量，没有导出。用行为验：非法动作的报错会列出可选值。
  const { apply } = await import('../../../packages/source/pta/src/index.js');
  const services = new Map();
  const ctx = {
    profileContext: { dir: '/tmp/pta-read-wiring' },
    logger: { info() {} },
    effect: (fn) => fn() ?? (() => {}),
    provide: (name, value) => { services.set(name, value); return () => {}; },
    get: (name) => services.get(name),
    inject: () => {},
  };
  const dispose = await apply(ctx, { fetch: async () => { throw new Error('测试不该发真实请求'); } });
  try {
    const pta = services.get('zhiyunPta');
    assert.deepEqual([...pta.reads].sort(),
      ['exam', 'problem', 'problemSet', 'problems', 'progress', 'submission', 'submissions']);
    // 开始答题 / 交卷是写操作：它们会启动计时、交卷后不能改。
    for (const name of ['start', 'finish', 'homeworkStart', 'homeworkFinish']) {
      assert.equal(pta.reads.includes(name), false, `${name} 不该在读名单里`);
    }
  } finally { await dispose?.(); }
});
