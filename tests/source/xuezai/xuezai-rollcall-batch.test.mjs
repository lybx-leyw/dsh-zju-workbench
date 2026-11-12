/**
 * 学在浙大**批量签到**的测试（上游 `xuezai rollcall all`，coverage-gaps 的 W-5）。
 *
 * # 这一组要钉住什么
 *
 * 批量签到最容易写错、也最容易「假通过」的地方是**两路并发 + 任一路成功即
 * 停止另一路** —— 那是一个关于**时机**的性质，用「最终结果对不对」根本测不出来：
 * 顺序实现也能得到同一个结果，只是慢一点。所以这里的断言看的是**中止信号
 * 什么时候被触发**，以及**被中止的那一路有没有真的停下来**。
 *
 * 另外两条：
 *
 * 1. **单次与批量是两个动作**。本仓的 `rollcall` 要调用方给 id，批量的
 *    `rollcallAll` 自己列列表。把它们混成一个的后果是：看起来有批量能力，
 *    实际只签得到调用方点名的那一个。
 * 2. **签不上一个不影响其余**。点名的价值在「能签的都签上」，不是「全或无」。
 *
 * 全部离线：`reader` 是假的，`answer` 是假的，`wait` 是同步的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answered, createRollcallBatch, numberUnavailable, radarRollcalls,
} from '../../../packages/source/xuezai/src/rollcall-batch.js';

/**
 * 造一个假 reader。
 *
 * @param rows - `/api/radar/rollcalls` 会回的点名行。
 * @param options.onCall - 每次读列表时调用（可以让不同轮次回不同内容）。
 * @returns 假 reader（记录 `json` 调用）。
 */
function fakeReader(rows, { onCall } = {}) {
  const calls = [];
  let round = 0;
  return {
    calls,
    async json(url, options) {
      calls.push({ url, options });
      round += 1;
      const next = onCall ? onCall(round) : rows;
      return { rollcalls: next };
    },
  };
}

/**
 * 造一个假的单点应答复用体。
 *
 * @param options.behave - `(id) => 'ok' | 'fail' | 'throw'`。
 * @returns 假动作（记录每次 prepare / execute）。
 */
function fakeAnswer(behave = () => 'ok') {
  const calls = [];
  return {
    calls,
    async prepare(args) {
      const id = Number(args?.rollcall?.id);
      calls.push({ kind: 'prepare', id });
      if (behave(id) === 'fail') {
        // 在 prepare 阶段就拒（比如不在点名范围内）
        throw Object.assign(new Error(`点名 ${id} 不在范围内`), { code: 'REJECTED' });
      }
      return `签到：${args?.rollcall?.title ?? id}`;
    },
    async execute() {
      const id = calls.at(-1)?.id;
      if (behave(id) === 'throw') throw new Error('应答被拒');
      return { ok: true };
    },
    async cancel() {},
  };
}

/** 只要有行就算雷达点名（除非明确 `is_number: true`）。 */
const radarRow = (id, course, extra = {}) => ({
  rollcall_id: id, course_title: course, is_radar: true, status: 'not_on_call', ...extra,
});

/* ─────────────────────── 前置：radarRollcalls ─────────────────────── */

test('radarRollcalls：走 /api/radar/rollcalls，形状不对要如实报', async () => {
  const reader = fakeReader([radarRow(1, '数据结构')]);
  const rows = await radarRollcalls(reader);
  assert.equal(rows.length, 1);
  assert.match(reader.calls[0].url, /\/api\/radar\/rollcalls$/);

  // 少了 rollcalls 数组 → 必须抛，不能当成「没有点名」。
  // 当成空列表的后果是「批量签到说签完了，而其实一个都没看见」。
  await assert.rejects(
    () => radarRollcalls({ async json() { return {}; } }),
    (error) => {
      assert.equal(error.code, 'API_SHAPE');
      assert.match(error.message, /rollcalls/);
      return true;
    },
  );
});

test('answered：只看 status / status_name 的那两个值，不看 HTTP 200', () => {
  assert.equal(answered({ status: 'on_call' }), true);
  assert.equal(answered({ status_name: 'on_call_fine' }), true);
  assert.equal(answered({ status: 'not_on_call' }), false);
  assert.equal(answered({}), false);
  assert.equal(answered(null), false);
});

/* ─────────────────────── Prepare 语义 ─────────────────────── */

test('Prepare 只读列表、不发写请求，且说清「可能一次签多个」', async () => {
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法')]);
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  const summary = await batch.prepare({});
  assert.match(summary, /批量签到/, '要说是批量');
  assert.match(summary, /可能一次签多个/, '用户得知道这一批准可能签好几个');
  assert.match(summary, /数据结构/);
  assert.match(summary, /算法/);
  assert.match(summary, /2 个待签/);

  assert.equal(answer.calls.length, 0, '**Prepare 绝不能发应答请求**');
  assert.equal(reader.calls.length, 1, 'Prepare 只读一次列表');
});

test('Prepare：已签过的不进待签列表，但要如实说有几个不动', async () => {
  const reader = fakeReader([
    radarRow(1, '数据结构', { status: 'on_call' }),
    radarRow(2, '算法'),
  ]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  const summary = await batch.prepare({});
  assert.match(summary, /算法/);
  assert.match(summary, /已签过的 1 个不动/);
  assert.doesNotMatch(summary, /可能一次签多个点名）：数据结构/, '已签的不该出现在待签里');
});

test('Prepare：没有待签时如实说，不编造', async () => {
  const reader = fakeReader([radarRow(1, '数据结构', { status: 'on_call' })]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  const summary = await batch.prepare({});
  assert.match(summary, /没有待签的点名/);
});

test('Prepare：course 是**筛选器**，只签名字含它的那些', async () => {
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法')]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  const summary = await batch.prepare({ course: '数据' });
  assert.match(summary, /数据结构/);
  assert.doesNotMatch(summary, /算法/);
  assert.match(summary, /按课程「数据」筛过/);
});

test('Prepare：passes / waitMs 要校验，非法值不许放过', async () => {
  const batch = () => createRollcallBatch(fakeReader([]), { rollcall: fakeAnswer(), wait: async () => {} });
  await assert.rejects(() => batch().prepare({ passes: 0 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => batch().prepare({ passes: 1.5 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => batch().prepare({ waitMs: -1 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => batch().prepare({ course: '  ' }), (e) => e.code === 'INVALID_ARGUMENT');
});

/* ─────────────────────── Execute：批量应答 ─────────────────────── */

test('Execute：把**所有**待签的逐个签掉（不是只签第一个）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法'), radarRow(3, '操作系统')]);
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  await batch.prepare({});
  const result = await batch.execute();

  assert.equal(answer.calls.filter((c) => c.kind === 'prepare').length, 3, '三个都要试');
  assert.match(result, /已签 3 个/);
  assert.match(result, /数据结构/);
  assert.match(result, /算法/);
  assert.match(result, /操作系统/);
});

test('Execute：一个签不上不影响其余（要的是「能签的都签上」）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法'), radarRow(3, '操作系统')]);
  // 中间那个在 prepare 阶段就被拒
  const answer = fakeAnswer((id) => (id === 2 ? 'fail' : 'ok'));
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  await batch.prepare({});
  const result = await batch.execute();

  assert.match(result, /已签 2 个/);
  assert.match(result, /1 个没签上/);
  assert.match(result, /算法/, '要指名是哪一门没签上');
  assert.match(result, /不在范围内/, '要转述平台/实现给的原因');
});

test('Execute：已签过的不重复提交（answered 的过滤是真的在起作用）', async () => {
  const reader = fakeReader([
    radarRow(1, '数据结构', { status: 'on_call' }),
    radarRow(2, '算法'),
  ]);
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  await batch.prepare({});
  await batch.execute();

  const preparedIds = answer.calls.filter((c) => c.kind === 'prepare').map((c) => c.id);
  assert.deepEqual(preparedIds, [2], '只该签没签过的那个');
});

/* ─────────────── 两路并发：任一路成功即中止另一路 ─────────────── */

test('两路并发：不 opt-in 时**不**停兄弟路（默认要把待签的签完）', async () => {
  // 这条守的是默认值。上游是「任一路成功即 abort 另一路」，但那会漏签：
  // 若同时有多个雷达点名，第一路签上就停，剩下的就没签。
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法')]);
  const seen = [];
  const radar = async ({ rows, onSuccess }) => {
    for (const row of rows) {
      seen.push(row.rollcall_id);
      onSuccess?.({ signed: [String(row.course_title)] });
    }
    return { status: 'signed', signed: rows.map((r) => r.course_title), failures: [] };
  };
  const batch = createRollcallBatch(reader, {
    rollcall: fakeAnswer(),
    executors: { radar, number: numberUnavailable },
    wait: async () => {},
  });

  await batch.prepare({});
  await batch.execute();
  assert.deepEqual(seen, [1, 2], '默认要把两个都签，不能第一个成功就停');
});

test('两路并发：opt-in stopAtFirst 时，第一路成功后**兄弟路看到中止信号**', async () => {
  // 这条是最容易假通过的一条：只看「结果对不对」的话，顺序实现也通过。
  // 所以这里断言的是**另一个执行器内部观察到的 signal.aborted**。
  const reader = fakeReader([radarRow(1, '数据结构'), { rollcall_id: 9, course_title: '数字点名', is_number: true }]);

  let numberSawAbort = null;
  /** 慢一点的数字那一路：等到被叫停为止。 */
  const number = async ({ signal }) => {
    // 等一小会儿，让雷达那一路先成功。
    await new Promise((resolve) => setTimeout(resolve, 5));
    numberSawAbort = signal?.aborted ?? false;
    return { status: 'not-signed', message: '数字那路被叫停了', signed: [] };
  };
  const radar = async ({ rows, onSuccess }) => {
    onSuccess?.({ signed: [rows[0].course_title] });
    return { status: 'signed', signed: rows.map((r) => r.course_title), failures: [] };
  };

  const batch = createRollcallBatch(reader, {
    rollcall: fakeAnswer(),
    executors: { radar, number },
    wait: async () => {},
  });

  await batch.prepare({});
  await batch.execute(); // 默认 stopAtFirst=false → 兄弟路不该被中止
  assert.equal(numberSawAbort, false, '默认不该中止兄弟路');

  // 再来一次，这次 opt-in
  const reader2 = fakeReader([radarRow(1, '数据结构'), { rollcall_id: 9, course_title: '数字点名', is_number: true }]);
  let sawAbort = null;
  const batch2 = createRollcallBatch(reader2, {
    rollcall: fakeAnswer(),
    executors: {
      radar: async ({ rows, onSuccess }) => {
        onSuccess?.({ signed: [rows[0].course_title] });
        return { status: 'signed', signed: rows.map((r) => r.course_title), failures: [] };
      },
      number: async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        sawAbort = signal?.aborted ?? false;
        return { status: 'not-signed', message: '被叫停', signed: [] };
      },
    },
    wait: async () => {},
  });
  await batch2.prepare({ stopAtFirst: true });
  await batch2.execute();
  assert.equal(sawAbort, true, 'opt-in 之后兄弟路必须看到中止信号');
});

test('两路并发：外部中止会打断两路（不是只断一路）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构'), { rollcall_id: 9, course_title: '数字点名', is_number: true }]);
  const controller = new AbortController();
  const observed = [];
  const lane = (kind) => async ({ signal }) => {
    // 等到被中止
    await new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      signal?.addEventListener('abort', resolve, { once: true });
      setTimeout(resolve, 50);
    });
    observed.push({ kind, aborted: signal?.aborted ?? false });
    return { status: 'not-signed', message: '中止', signed: [] };
  };

  const batch = createRollcallBatch(reader, {
    rollcall: fakeAnswer(),
    executors: { radar: lane('radar'), number: lane('number') },
    wait: async () => {},
  });
  await batch.prepare({});
  // 立刻中止
  setTimeout(() => controller.abort(), 2);
  await batch.execute(controller.signal).catch(() => {});
  assert.equal(observed.length, 2, '两路都要醒过来');
  assert.ok(observed.every((one) => one.aborted), '两路都必须看到中止信号');
});

/* ─────────────────────── 多轮扫描 ─────────────────────── */

test('多轮：每轮重新读列表，第二轮新出现的点名也能签上', async () => {
  // 点名是陆续发起的。只看第一轮就会漏掉后来出现的那个。
  //
  // ⚠️ 读列表的次数要算上 **Prepare 那一次**：Prepare 为了让用户在批准前看清
  // 「会签哪些」，已经读过一次了。所以 `passes: 2` 之后总数是 1 + 2 = 3。
  // 夹具按「第几次读」决定内容时，必须把 Prepare 算进第 1 次。
  let reads = 0;
  const reader = {
    async json() {
      reads += 1;
      // 第 1 次（Prepare）与第 2 次（第 1 轮）：只有数据结构，还没签
      if (reads <= 2) return { rollcalls: [radarRow(1, '数据结构')] };
      // 第 3 次（第 2 轮）：数据结构已签，且新出现算法
      return { rollcalls: [radarRow(1, '数据结构', { status: 'on_call' }), radarRow(2, '算法')] };
    },
  };
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  await batch.prepare({ passes: 2 });
  const result = await batch.execute();
  assert.equal(reads, 3, 'Prepare 一次 + 两轮各一次');
  assert.match(result, /已签 2 个/, '两轮里各签一个');
  assert.match(result, /数据结构/);
  assert.match(result, /算法/);
  assert.match(result, /扫了 2 轮/);
});

test('多轮：签上的不会在第二轮重复提交', async () => {
  let reads = 0;
  const reader = {
    async json() {
      reads += 1;
      // 第 1 次（Prepare）与第 2 次（第 1 轮）：待签
      if (reads <= 2) return { rollcalls: [radarRow(1, '数据结构')] };
      // 第 3 次（第 2 轮）：平台已经把它标成已签
      return { rollcalls: [radarRow(1, '数据结构', { status: 'on_call' })] };
    },
  };
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });
  await batch.prepare({ passes: 2 });
  const result = await batch.execute();

  const preparedIds = answer.calls.filter((c) => c.kind === 'prepare').map((c) => c.id);
  assert.deepEqual(preparedIds, [1], '同一个点名只提交一次');
  assert.match(result, /已签 1 个/);
  assert.doesNotMatch(result, /已签 2 个/, '不该把第二轮看到的「已签」也数成这次签的');
});

/* ─────────────────────── 数字那一路 ─────────────────────── */

test('数字点名：如实说签不了，并说清为什么（不假装处理了）', async () => {
  const reader = fakeReader([{ rollcall_id: 9, course_title: '数字点名', is_number: true }]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  const summary = await batch.prepare({});
  assert.match(summary, /数字点名/);

  const result = await batch.execute();
  assert.match(result, /数字点名签不了/, '要报出来，不能让用户以为签完了');
  assert.match(result, /W-5/, '要指向还没做的部分');
});

test('numberUnavailable：没有数字点名时不谎报问题', async () => {
  const result = await numberUnavailable({ rows: [] });
  assert.equal(result.status, 'not-signed');
  assert.match(result.message, /没有数字点名/);
  assert.deepEqual(result.signed, []);
});

/* ─────────────────────── 三段契约 ─────────────────────── */

test('三段契约：审批被拒后能**立刻**重试（不 WRITE_BUSY）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构')]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });

  await batch.prepare({});
  await batch.cancel(); // 模拟审批被拒：工具层调 cancel 撤销会话
  const summary = await batch.prepare({});
  assert.ok(typeof summary === 'string', '撤销后必须能立刻重新准备');
});

test('两段式：没 Prepare 直接 Execute 报 NEED_PREPARE', async () => {
  const batch = createRollcallBatch(fakeReader([]), { rollcall: fakeAnswer(), wait: async () => {} });
  await assert.rejects(() => batch.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE');
    return true;
  });
});

test('并发 Prepare 被拒（防止 A 批准 B 执行）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构')]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  await batch.prepare({});
  await assert.rejects(() => batch.prepare({}), (error) => {
    assert.equal(error.code, 'WRITE_BUSY');
    return true;
  });
});

test('Execute 之后会话清空，可以马上再来一次', async () => {
  const reader = fakeReader([radarRow(1, '数据结构')]);
  const batch = createRollcallBatch(reader, { rollcall: fakeAnswer(), wait: async () => {} });
  await batch.prepare({});
  await batch.execute();
  const summary = await batch.prepare({});
  assert.ok(typeof summary === 'string');
});

/* ─────────────────── 与单次 `rollcall` 的分工（注释里那条判据） ─────────────────── */

test('批量与单次是两个动作：批量自己列列表，不需要调用方给点名 id', async () => {
  // 这条是「本仓 rollcall 是单次语义、signinAll 是轮询/列举语义」那条判据的
  // 可执行版本。若哪天有人把批量「简化」成给 rollcall 传空参数，这条会红：
  // 因为批量必须自己调 /api/radar/rollcalls，而单次从不调它。
  const reader = fakeReader([radarRow(1, '数据结构'), radarRow(2, '算法')]);
  const answer = fakeAnswer();
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  await batch.prepare({});       // ← 没有任何「点名 id」入参
  await batch.execute();

  assert.ok(reader.calls.length >= 1, '批量必须自己去列当前点名');
  assert.match(reader.calls[0].url, /radar\/rollcalls/, '列的是**当前**点名，不是历史');
  assert.equal(answer.calls.filter((c) => c.kind === 'prepare').length, 2, '两个都签');
});
