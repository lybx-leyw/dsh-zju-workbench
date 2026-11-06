/**
 * 「规划」页上三个**说错话**的 bug 的守卫。
 *
 * 共同点：它们都不让页面崩，也不丢数据 —— 只是把结果显示成另一件事，
 * 所以人工点一遍很容易以为"没问题"。每一节都对应一次真实故障：
 *
 *   1. `planned` 一名两用（数字 vs 数组）→ 成功被显示成"没有新条目"；
 *   2. `error` 是对象 → 页面显示 `[object Object]`；
 *   3. 分组键取 UTC、标签取上海时区 → 两个同名日期组。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../packages/dsh-zhiyun-page-planning/src/error.js';
import { URGENCY, dayKey, dayLabel, urgencyOf } from '../packages/dsh-zhiyun-page-planning/src/time.js';
import { createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/* ───────────────────────────────────────── 1. `planned` 一名两用 */

/**
 * 起一个真实的 handler，用假的 store / plan 服务。
 *
 * 这一节测的是**回包的形状**，所以必须走真正的 handler —— 早先那个 bug 就藏在
 * `{ ...result, ...snapshot }` 的展开顺序里，只测 `runPlan` 或只测 `snapshot`
 * 都看不出来。
 */
function makeHandler({ plan }) {
  const store = { entries: [], list() { return this.entries; }, absorb() { return { added: [], skipped: 0 }; } };
  return createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store,
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({
      xzzd: { ok: false, rows: [], error: null },
      pta: { ok: false, rows: [], error: null },
    }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan,
  });
}

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43120', 'x-zhiyun-planning': '1' },
      [Symbol.asyncIterator]: async function* iterator() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body));
      },
    };
    const res = {
      status: 0,
      body: '',
      writeHead(status) { this.status = status; },
      end(chunk) { this.body = chunk; resolve({ status: this.status, json: JSON.parse(chunk) }); },
    };
    handler(req, res);
  });
}

test('拆成功的回包里 planned 是数字，且与 plannedKeys 各占其位', async () => {
  const plan = {
    run: async () => ({ planned: 2, created: 24, dropped: 0, orphans: 0, model: 'm' }),
    list: () => ({ k1: { cards: [{}] }, k2: { cards: [] } }),
    plannedKeys: () => ['k1', 'k2'],
    forget() {},
  };
  const { status, json } = await call(makeHandler({ plan }), 'POST', '/?plan', {});

  assert.equal(status, 200);
  // 这条断言就是那次故障本身：数组盖掉数字之后，页面据此判断"没有新条目"
  assert.equal(typeof json.planned, 'number', `planned 必须是数字，实际是 ${JSON.stringify(json.planned)}`);
  assert.equal(json.planned, 2);
  assert.equal(json.created, 24);
  assert.deepEqual(json.plannedKeys, ['k1', 'k2'], '已拆过的键名单要单独一个字段');
  // 页面真的会拿它算这句文案
  assert.ok(json.planned > 0, '成功回包不能让页面判定成"没有新条目"');
});

test('GET 快照里也只有 plannedKeys，没有另一份 planned', async () => {
  const plan = {
    run: async () => ({}),
    list: () => ({}),
    plannedKeys: () => ['only-key'],
    forget() {},
  };
  const { json } = await call(makeHandler({ plan }), 'GET', '/?', undefined);
  assert.deepEqual(json.plannedKeys, ['only-key']);
  assert.equal('planned' in json, false, '快照里不该再有 planned —— 那是 ?plan 的结果字段');
});

/* ───────────────────────────────────────── 2. 错误对象不能被字符串化 */

test('宿主回的对象错误要显示成它的 message，不是 [object Object]', () => {
  const cases = [
    { error: { code: 'NO_LLM', message: '还没有可用的模型：请先在设置里配置 AI 服务' }, expect: '还没有可用的模型' },
    { error: { code: 'BAD_JSON', message: '模型输出不是合法 JSON：…' }, expect: '模型输出不是合法 JSON' },
    { error: { code: 'NO_CARDS', message: '模型没有产出可用的卡片' }, expect: '模型没有产出可用的卡片' },
  ];
  for (const { error, expect } of cases) {
    const text = errorText(error, 400);
    assert.ok(text.includes(expect), `应包含「${expect}」，实际：${text}`);
    assert.equal(text.includes('[object Object]'), false, '不得出现 [object Object]');
  }
});

test('字符串错误原样透出；什么都没有时退回状态码', () => {
  assert.equal(errorText('未知动作 plan', 400), '未知动作 plan');
  assert.equal(errorText({ code: 'NO_PENDING' }, 200), 'NO_PENDING', '只有 code 时用 code');
  assert.equal(errorText(undefined, 502), '设置接口返回 502');
  assert.equal(errorText(null, 500), '设置接口返回 500');
  assert.equal(errorText({}, 500), '设置接口返回 500', '空对象不能塌成 [object Object]');
});

/* ───────────────────────────────────────── 3. 分组键与标签同一时区 */

/** 上海时间 → 秒级时间戳。 */
const at = (iso) => Math.floor(Date.parse(iso) / 1000);

test('同一上海日的条目落到同一个分组键（跨 UTC 日界不再裂开）', () => {
  // 北京时间 10-19 的 00:30 / 07:00 / 09:00 在 UTC 里分属 10-18 与 10-19，
  // 早先的分组键（toISOString）因此把它们拆成两组，而标签两行都写「10月19日」
  const early = at('2026-10-19T00:30:00+08:00');
  const morning = at('2026-10-19T07:00:00+08:00');
  const later = at('2026-10-19T09:00:00+08:00');
  assert.equal(dayKey(early), '2026-10-19');
  assert.equal(dayKey(morning), dayKey(early), '同一上海日必须同键');
  assert.equal(dayKey(later), dayKey(early));

  // 相邻两天必须不同键 —— 否则就是"没分组"
  assert.equal(dayKey(at('2026-10-18T23:30:00+08:00')), '2026-10-18');
  assert.equal(dayKey(at('2026-10-20T00:00:00+08:00')), '2026-10-20');
});

test('分组键与标签必须一致：键相同的两条，标签也相同', () => {
  const samples = [
    '2026-10-18T23:30:00+08:00', '2026-10-19T00:30:00+08:00', '2026-10-19T07:00:00+08:00',
    '2026-10-19T12:00:00+08:00', '2026-10-19T23:59:00+08:00', '2026-10-20T00:00:00+08:00',
  ];
  const seen = new Map();
  for (const iso of samples) {
    const seconds = at(iso);
    const key = dayKey(seconds);
    const label = dayLabel(seconds);
    if (seen.has(key)) {
      assert.equal(seen.get(key), label, `同一个键 ${key} 出现了两个标签（键与标签时区不一致）`);
    } else {
      seen.set(key, label);
    }
  }
});

test('坏时间戳归到 unknown 一档，不抛错', () => {
  assert.equal(dayKey(NaN), 'unknown');
  assert.equal(dayKey(undefined), 'unknown');
  assert.equal(dayKey('不是数字'), 'unknown');
  assert.equal(dayLabel(NaN), '时间未知');
});

test('紧迫度分档与宿主一致（页面与宿主共用 time.js）', () => {
  const now = Date.parse('2026-10-18T12:00:00+08:00');
  assert.equal(urgencyOf(null, now), URGENCY.none);
  assert.equal(urgencyOf('不是日期', now), URGENCY.none);
  assert.equal(urgencyOf('2026-10-17T12:00:00+08:00', now), URGENCY.overdue);
  assert.equal(urgencyOf('2026-10-18T20:00:00+08:00', now), URGENCY.today);
  assert.equal(urgencyOf('2026-10-21T12:00:00+08:00', now), URGENCY.week);
  assert.equal(urgencyOf('2026-11-30T12:00:00+08:00', now), URGENCY.later);
});
