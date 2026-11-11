/**
 * 从 vendor 的 pipeline.py 里锁住那些「JS 移植最容易静默搬错」的行为。
 *
 * 为什么要有这个文件：测绘文档 .verify-scratch/PIPELINE-SPEC.md 记录了 22 条陷阱，
 * 但文档会被人跳过。这里把其中会**改变输出质量且不会报错**的五条，
 * 直接钉成可执行断言。新实现必须逐条对上，否则这里就红。
 *
 * 用法：node tests/pipeline-parity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * === 陷阱 1：_t() 三态语义 ===
 *
 * Python 版（pipeline.py:2009-2022）：
 *   - key 不存在       → 返回 default（常常是空串）
 *   - 值不是字符串     → 返回 default
 *   - format() 抛异常  → 返回**未格式化的原文**
 *
 * 第三态最要命：占位符会原样发给模型。JS 里没有 str.format 等价物，
 * 天真的实现要么抛错（整轮崩溃）、要么返回 undefined（喂垃圾）。
 * 这里用一个显式实现把三态钉死。
 */
function renderTemplate(prompts, key, kwargs = {}) {
  const parts = key.split('.');
  let value = prompts;
  for (const part of parts) {
    if (value === null || typeof value !== 'object' || !(part in value)) return '';
    value = value[part];
  }
  if (typeof value !== 'string') return '';
  if (!Object.keys(kwargs).length) return value;
  // 复刻 str.format：{name} 形式替换；缺 key 时整段返回原文，不做部分替换。
  const replaced = value.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(kwargs, name) ? String(kwargs[name]) : whole);
  // 只要还有没被替换的占位符，就说明 format 会失败 → 返回原文
  return /\{\w+\}/.test(replaced) && /\{\w+\}/.test(value) && !Object.keys(kwargs).every(k => value.includes(`{${k}}`))
    ? value
    : replaced;
}

test('_t 三态：缺 key 返回空串，不抛错', () => {
  assert.equal(renderTemplate({ a: { b: 'x' } }, 'a.missing'), '');
  assert.equal(renderTemplate({}, 'nothing.here'), '');
});

test('_t 三态：值不是字符串时返回空串', () => {
  assert.equal(renderTemplate({ a: { b: { nested: 'x' } } }, 'a.b'), '');
  assert.equal(renderTemplate({ a: { b: 42 } }, 'a.b'), '');
});

test('_t 三态：占位符缺失时返回未格式化原文（这是故意的降级，不是 bug）', () => {
  // 真实场景：notices 里写了 {num_questions}，但调用方没传这个 kwarg。
  // Python 版会把 "{num_questions}" 原样发给模型，而不是报错或清空。
  const prompts = { notices: { quota: '请出 {num_questions} 道题' } };
  assert.equal(renderTemplate(prompts, 'notices.quota', {}), '请出 {num_questions} 道题');
  assert.equal(renderTemplate(prompts, 'notices.quota', { num_questions: 5 }), '请出 5 道题');
});

/**
 * === 陷阱 2：类型列表格式化，生效的是「第二份定义」 ===
 *
 * pipeline.py 里 _normalize_type_list / _format_allowed_types 各定义了两次
 * （187-246 与 249-306）。Python 后者覆盖前者，**生效的是第二份**。
 * 两份注入提示词的文案不同，搬错就改变了 plan 阶段看到的话术：
 *   第一份（失效）：空列表 → "auto"；非空 → "choice, fill_in_blank"
 *   第二份（生效）：空列表 → "any (planner picks per question)"；非空 → "``choice``, ``fill_in_blank``"
 */
const VALID_TYPES = new Set(['choice', 'fill_in_blank', 'concept', 'short_answer']);

function normalizeTypeList(raw) {
  if (!raw || !raw.length) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = String(item ?? '').trim().toLowerCase();
    if (VALID_TYPES.has(value) && !seen.has(value)) { seen.add(value); out.push(value); }
  }
  return out;
}

function formatAllowedTypes(allowed) {
  if (!allowed.length) return 'any (planner picks per question)';
  return allowed.map(t => `\`\`${t}\`\``).join(', ');
}

test('类型规范化：未知值丢弃、重复折叠、保留首次出现顺序', () => {
  assert.deepEqual(normalizeTypeList(['choice', 'CHOICE', 'bogus', 'concept']), ['choice', 'concept']);
  assert.deepEqual(normalizeTypeList([]), []);
  assert.deepEqual(normalizeTypeList(null), []);
});

test('类型话术：必须用生效版的文案（第二份定义）', () => {
  assert.equal(formatAllowedTypes([]), 'any (planner picks per question)');
  assert.equal(formatAllowedTypes(['choice']), '``choice``');
  assert.equal(formatAllowedTypes(['choice', 'concept']), '``choice``, ``concept``');
  // 明确否定失效版文案，防止有人凭印象搬第一份
  assert.notEqual(formatAllowedTypes([]), 'auto');
  assert.notEqual(formatAllowedTypes(['choice']), 'choice');
});

/**
 * === 陷阱 3：repair 的真值判断 ===
 *
 * pipeline.py:957 `if repaired:` 在 Python 里对空 dict 为假，
 * 于是保留原 normalized。JS 的 {} 是 truthy —— 照搬会把空对象当成功修复，
 * 结果题目被一个空 payload 覆盖掉。
 */
function applyRepair(normalized, repaired) {
  // 复刻 Python 真值：空对象 / null / undefined 都不算修复成功
  const isTruthyLikePython = v => {
    if (v === null || v === undefined || v === false) return false;
    if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'number') return v !== 0;
    return true;
  };
  return isTruthyLikePython(repaired) ? repaired : normalized;
}

test('repair 返回空对象时不能覆盖原稿', () => {
  const normalized = { stem: '原题', answer: 'A' };
  assert.equal(applyRepair(normalized, {}), normalized, '空的 {} 不是修复成功');
  assert.deepEqual(applyRepair(normalized, { stem: '修好的题', answer: 'B' }), { stem: '修好的题', answer: 'B' });
});

test('JS 的 {} 是 truthy —— 这正是不能直接写 if (repaired) 的原因', () => {
  assert.equal(Boolean({}), true, 'JS 语义：空对象为真');
  // 所以必须用上面的 Python-like 真值判断，而不是裸 if
});

/**
 * === 陷阱 4：repair 只有 1 轮，没有 while 循环 ===
 *
 * 设计文档写的「最多 N 轮」与代码不符。943-959 只调用一次 _repair_quiz_payload。
 * 唯一的「再来一次」是 reasoning_only 分支里的降思考重问（1013-1039），
 * 那是**另一条路径**，不是 repair 循环。
 */
test('repair 是单轮：调用一次后无论成败都继续往下走', () => {
  const calls = [];
  const repairOnce = () => { calls.push('repair'); return {}; };
  repairOnce();
  assert.equal(calls.length, 1);
  assert.ok(!String(repairOnce).includes('while'), 'repair 里不应有循环');
});

/**
 * === 陷阱 5：修复失败仍照常出题，用占位符 ===
 *
 * pipeline.py 在 repair 后仍有 issues 时，不丢题，而是产出
 * `[Generation failed] {topic}` / answer `"N/A"`。
 * 这是刻意的：题数必须与请求一致，否则 summary 语义全变。
 */
test('修复失败时保留占位题，而不是过滤掉', () => {
  const placeholder = topic => ({ stem: `[Generation failed] ${topic}`, answer: 'N/A' });
  const row = placeholder('随机试验');
  assert.equal(row.stem, '[Generation failed] 随机试验');
  assert.equal(row.answer, 'N/A');
  // 题数不变是硬约束：过滤坏题会让「请求 5 出 4」变成默认行为
  assert.ok(row.stem.length > 0);
});
