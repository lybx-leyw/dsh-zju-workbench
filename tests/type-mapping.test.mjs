/**
 * 题型映射的回归测试。
 *
 * # 锁住的事故（2026-10-31 第七次真机失败）
 *
 * 两条链的题型词表不同：
 *   产品：mcq / trueFalse / cloze / shortAnswer      （question-bank、validateNativeQuestion）
 *   新链：choice / concept / fill_in_blank / short_answer（core-question / 上游 vendor）
 *
 * 当时有两个方向同时错了：
 *   ① 入参：拿上游词表 `fill_in_blank` 去查以产品词表为键的 TYPE_TO_CHAIN
 *      → 查不到 → 静默回落成 choice → 实际按选择题出题
 *   ② 出参：把上游词表 `fill_in_blank` 直接当产品词表返回
 *      → validateNativeQuestion 期望 cloze、收到 fill_in_blank → 全部拒收
 *
 * 用户看到的是「DeepTutor 返回了空题目或与请求题型不同的结果」，
 * 而模型其实正常工作（跑了 1 分 16 秒、缓存了 2 个批次）。
 *
 * 用法：node tests/type-mapping.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = 'packages/dsh-zhiyun-core-study/src/core-question-backend.js';
const source = fs.readFileSync(path.resolve(BACKEND), 'utf8');

/** 从源码里抽出两张表独立验证。 */
function loadTables() {
  const pick = name => {
    const m = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
    assert.ok(m, `找不到 ${name}`);
    // eslint-disable-next-line no-new-func
    return new Function(`return {${m[1]}};`)();
  };
  const TYPE_TO_CHAIN = pick('TYPE_TO_CHAIN');
  // CHAIN_TO_TYPE 在源码里是 Object.fromEntries 从 TYPE_TO_CHAIN 派生的，
  // 这里按同一规则重建，验证的是「派生规则正确」而不是「字面量存在」。
  const CHAIN_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_CHAIN).map(([k, v]) => [v, k]));
  return { TYPE_TO_CHAIN, CHAIN_TO_TYPE };
}

test('两张映射表互为逆映射', () => {
  const { TYPE_TO_CHAIN, CHAIN_TO_TYPE } = loadTables();
  for (const [product, chain] of Object.entries(TYPE_TO_CHAIN)) {
    assert.equal(CHAIN_TO_TYPE[chain], product,
      `${product} ↔ ${chain} 的反向映射不对：${CHAIN_TO_TYPE[chain]}`);
  }
});

test('四种产品题型都有对应的新链词表', () => {
  const { TYPE_TO_CHAIN } = loadTables();
  for (const t of ['mcq', 'trueFalse', 'cloze', 'shortAnswer']) {
    assert.ok(TYPE_TO_CHAIN[t], `产品题型 ${t} 缺少映射`);
  }
});

test('源码里入参映射不再只查 TYPE_TO_CHAIN（那会因为键不匹配静默回落）', () => {
  // 允许两种写法：先判断是否已是新链词表，或直接用 CHAIN_TO_TYPE 反查
  const hasDirectCheck = /Object\.values\(TYPE_TO_CHAIN\)\.includes\(/.test(source);
  const hasReverseLookup = /CHAIN_TO_TYPE\[/.test(source);
  assert.ok(hasDirectCheck || hasReverseLookup,
    '入参必须能识别「已经是新链词表」的情况，否则 fill_in_blank 会被当成未知值回落成 choice');
});

test('出参必须回产品词表，不能把上游词表直接返回', () => {
  // 断言：产出题目的 type 取自 productType（或等价的 CHAIN_TO_TYPE 反查）
  assert.match(source, /type:\s*productType/, '出参 type 必须用产品词表');
  // 反向证据：不该再出现「直接用 config.question_types[0] 当 type」的旧写法
  assert.ok(
    !/type:\s*chainType === 'choice' \? 'mcq' : config\.question_types/.test(source),
    '旧的出参映射（直接透传上游词表）必须已删除',
  );
});

test('新链题型参数传给 runDeepQuestion 时已是对应词表', () => {
  const idx = source.indexOf('await runDeepQuestion(');
  assert.ok(idx > 0);
  const call = source.slice(idx, idx + 400);
  assert.match(call, /type:\s*chainType/, 'runDeepQuestion 的 type 应该是新链词表（chainType）');
});
