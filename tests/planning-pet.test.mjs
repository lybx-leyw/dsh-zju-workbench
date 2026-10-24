/**
 * pet 对话协议的测试。
 *
 * # 这里守的是什么
 *
 * 对话最容易出的不是"不回复"，而是**回复得很好但记错了**。所以重点在三条：
 *
 *   1. `create` 必须带得出 draft，否则要退成 `ask` —— 不能假装成功；
 *   2. 不管模型怎么说，`create` **都不直接写库**（这条由路由测试守）；
 *   3. 动作/字段认不出来时**降级而不抛错** —— 对话中途崩溃比答错更糟。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONS, MAX_HISTORY, MAX_MESSAGE, createPetPrompt, normalizeReply, trimHistory,
} from '../packages/dsh-zhiyun-page-planning/src/pet.js';
import { dateTable } from '../packages/dsh-zhiyun-page-planning/src/time.js';

const calendar = dateTable(Date.parse('2026-10-21T12:00:00+08:00'), { days: 14 });

/* ────────────────────────────────────── 提示词 */

test('提示词必须给「今天」和逐日对照表（否则模型算不出下周三）', () => {
  const prompt = createPetPrompt({
    today: '2026-10-21', weekday: '周三', calendar, pending: [],
  });
  assert.match(prompt, /2026-10-21/);
  assert.match(prompt, /周三/);
  assert.match(prompt, /Asia\/Shanghai/);
  assert.match(prompt, /2026-10-28/, '下周对应日期要在表里');
});

test('提示词必须交代三种动作各自什么时候用', () => {
  const prompt = createPetPrompt({ today: '2026-10-21', weekday: '周三', calendar, pending: [] });
  for (const action of ACTIONS) {
    assert.match(prompt, new RegExp(`\`${action}\``), `提示词要解释 ${action}`);
  }
});

test('提示词要举「什么算 ask、什么算 create」的例子（这是最容易错的地方）', () => {
  const prompt = createPetPrompt({ today: '2026-10-21', weekday: '周三', calendar, pending: [] });
  assert.match(prompt, /下周有个作业/, '要给"信息不足"的例子');
  assert.match(prompt, /下周三交第三章作业/, '要给"信息够了"的例子');
});

test('提示词要禁止凭学期进度猜日期', () => {
  const prompt = createPetPrompt({ today: '2026-10-21', weekday: '周三', calendar, pending: [] });
  assert.match(prompt, /绝对禁止/);
  assert.match(prompt, /推测/);
});

test('没有待办时明确说"没有"，不要留空（留空模型会自己编）', () => {
  const prompt = createPetPrompt({ today: '2026-10-21', weekday: '周三', calendar, pending: [] });
  assert.match(prompt, /目前没有未完成的事/);
});

test('有待办时要列出来（用户会问"我今天有什么事"）', () => {
  const prompt = createPetPrompt({
    today: '2026-10-21',
    weekday: '周三',
    calendar,
    pending: [{ title: '交第三章作业', due: '2026-10-28T15:59:00.000Z' }],
  });
  assert.match(prompt, /交第三章作业/);
  assert.match(prompt, /2026-10-28/);
});

test('待办最多只列 20 条（防止提示词膨胀）', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ title: `事${i}`, due: null }));
  const prompt = createPetPrompt({ today: '2026-10-21', weekday: '周三', calendar, pending: many });
  assert.match(prompt, /事19/);
  assert.equal(prompt.includes('事20'), false, '第 21 条起不该出现');
});

test('没日期的事要标明"没定日期"', () => {
  const prompt = createPetPrompt({
    today: '2026-10-21', weekday: '周三', calendar, pending: [{ title: '随便记的', due: null }],
  });
  assert.match(prompt, /随便记的（没定日期）/);
});

/* ────────────────────────────────────── 回包校验 */

test('create + 完整 draft：原样通过', () => {
  const reply = normalizeReply({
    say: '记下了：周三前交第三章作业',
    action: 'create',
    draft: { title: '交第三章作业', detail: '', due: '2026-10-28T15:59:00.000Z', repeat: null },
  });
  assert.equal(reply.action, 'create');
  assert.equal(reply.say, '记下了：周三前交第三章作业');
  assert.equal(reply.draft.title, '交第三章作业');
  assert.equal(reply.draft.due, '2026-10-28T15:59:00.000Z');
  assert.deepEqual(reply.notes, []);
});

test('**create 但没给 draft → 必须退成 ask，不能假装成功**', () => {
  const reply = normalizeReply({ say: '好的', action: 'create', draft: null });
  assert.equal(reply.action, 'ask', '没有 draft 就不能算 create');
  assert.equal(reply.draft, null);
  assert.ok(reply.notes.length > 0);
  // 回话要换成能引导用户继续说的，而不是原来的"好的"
  assert.match(reply.say, /没听明白|再说/);
});

test('create 但 draft 没标题 → 同样退成 ask', () => {
  const reply = normalizeReply({ say: '好的', action: 'create', draft: { due: null } });
  assert.equal(reply.action, 'ask');
  assert.equal(reply.draft, null);
});

test('ask / chat 带 draft → 忽略草案，并记一条 note', () => {
  for (const action of ['ask', 'chat']) {
    const reply = normalizeReply({
      say: '嗯', action, draft: { title: 'x', detail: '', due: null, repeat: null },
    });
    assert.equal(reply.action, action);
    assert.equal(reply.draft, null, `${action} 不该产出草案`);
    assert.ok(reply.notes.length > 0);
  }
});

test('动作认不出来 → 降级成 chat，不抛错', () => {
  const reply = normalizeReply({ say: '在的', action: 'think' });
  assert.equal(reply.action, 'chat');
  assert.ok(reply.notes.some((line) => /动作不认识/.test(line)));
});

test('动作缺失 → 降级成 chat', () => {
  const reply = normalizeReply({ say: '在的' });
  assert.equal(reply.action, 'chat');
});

test('没有 say → BAD_SHAPE（总要回一句人话）', () => {
  assert.throws(() => normalizeReply({ action: 'chat' }), (error) => error.code === 'BAD_SHAPE');
  assert.throws(() => normalizeReply({ say: '   ', action: 'chat' }), (e) => e.code === 'BAD_SHAPE');
});

test('非对象 → BAD_SHAPE', () => {
  for (const bad of [null, 'text', 42, []]) {
    assert.throws(() => normalizeReply(bad), (error) => error.code === 'BAD_SHAPE');
  }
});

/* ────────────────────────────────────── 草案降级 */

test('due 解析不了 → 留空并记 note（不编日期）', () => {
  const reply = normalizeReply({
    say: '记下了', action: 'create', draft: { title: '交作业', due: '下周三' },
  });
  assert.equal(reply.draft.due, null);
  assert.ok(reply.notes.some((line) => /时间没看懂/.test(line)));
});

test('due 为 null 是正常情况，不产生 note', () => {
  const reply = normalizeReply({
    say: '记下了', action: 'create', draft: { title: '随便记一条', due: null },
  });
  assert.equal(reply.draft.due, null);
  assert.deepEqual(reply.notes, [], '没定时间不是错误');
});

test('重复规则合法 → 保留', () => {
  const reply = normalizeReply({
    say: '好', action: 'create',
    draft: { title: '交作业', due: '2026-10-28T15:59:00.000Z', repeat: { every: 1, unit: 'week', anchor: 'due' } },
  });
  assert.deepEqual(reply.draft.repeat, { every: 1, unit: 'week', anchor: 'due' });
});

test('重复规则不合法 → 丢掉并记 note', () => {
  const reply = normalizeReply({
    say: '好', action: 'create',
    draft: { title: 'x', due: '2026-10-28T15:59:00.000Z', repeat: { every: 1, unit: 'year' } },
  });
  assert.equal(reply.draft.repeat, null);
  assert.ok(reply.notes.some((line) => /重复规则没看懂/.test(line)));
});

test('按截止日重复但没有 due → 退化成不重复', () => {
  const reply = normalizeReply({
    say: '好', action: 'create',
    draft: { title: '每周交作业', due: null, repeat: { every: 1, unit: 'week', anchor: 'due' } },
  });
  assert.equal(reply.draft.repeat, null);
  assert.ok(reply.notes.some((line) => /没有开始时间/.test(line)));
});

test('按完成日重复、没有 due → 允许保留', () => {
  const reply = normalizeReply({
    say: '好', action: 'create',
    draft: { title: '每三天复习', due: null, repeat: { every: 3, unit: 'day', anchor: 'done' } },
  });
  assert.deepEqual(reply.draft.repeat, { every: 3, unit: 'day', anchor: 'done' });
  assert.deepEqual(reply.notes, []);
});

/* ────────────────────────────────────── 历史裁剪 */

test('历史超过上限时保留最近的', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `第${i}句`,
  }));
  const trimmed = trimHistory(history, 6);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[trimmed.length - 1].text, '第19句', '最后一句必须在');
});

test('裁剪后首条必须是 user（有些模型对首条是 assistant 会困惑）', () => {
  const history = [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'b' },
    { role: 'user', text: 'c' },
    { role: 'assistant', text: 'd' },
  ];
  const trimmed = trimHistory(history, 3);
  assert.equal(trimmed[0].role, 'user', '不能以 assistant 开头');
});

test('空历史 / 非法输入 → 空数组，不抛', () => {
  assert.deepEqual(trimHistory(null), []);
  assert.deepEqual(trimHistory(undefined), []);
  assert.deepEqual(trimHistory('x'), []);
  assert.deepEqual(trimHistory([]), []);
});

test('历史里的空文本条目被过滤掉', () => {
  const trimmed = trimHistory([
    { role: 'user', text: '有用' },
    { role: 'assistant', text: '   ' },
    { role: 'user', text: '' },
  ]);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].text, '有用');
});

test('单条历史文本超长要截断（防止塞进一整篇文章）', () => {
  const trimmed = trimHistory([{ role: 'user', text: 'x'.repeat(3000) }]);
  assert.equal(trimmed[0].text.length, MAX_MESSAGE);
});

test('角色只有 user / assistant 两种，其它一律当 assistant', () => {
  const trimmed = trimHistory([{ role: 'system', text: 'x' }]);
  assert.equal(trimmed[0].role, 'assistant');
});

/* ────────────────────────────────────── 常量 */

test('常量合理', () => {
  assert.equal(MAX_HISTORY, 8);
  assert.ok(MAX_MESSAGE >= 500);
  assert.deepEqual([...ACTIONS], ['ask', 'create', 'chat']);
});
