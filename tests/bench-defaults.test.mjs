/**
 * 默认配置的契约测试。
 *
 * 用户应当**只填 API Key** 就能跑 DeepSeek。其余三个字段（接口 / 模型 / 视觉模型）
 * 留空时由 `resolveConfig` 补全。
 *
 * 一条重要边界：**接口不是 DeepSeek 时不猜模型名**。给别家塞 `deepseek-flash`
 * 会造成"模型不存在"，而用户看到的是自己填的接口 —— 排查方向会被完全带偏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEEPSEEK, resolveConfig, prefill, isDeepSeek } from '../scripts/knowledge_tree_bench/defaults.mjs';

test('① 只填 Key：接口与模型全部补成 DeepSeek 默认', () => {
  const c = resolveConfig({ apiKey: 'sk-x' });
  assert.equal(c.baseUrl, DEEPSEEK.baseUrl);
  assert.equal(c.model, DEEPSEEK.model);
  assert.equal(c.visionModel, DEEPSEEK.model, '视觉留空时应当跟随对话模型');
  assert.deepEqual(c.defaulted, { baseUrl: true, model: true, visionModel: true });
});

test('② 空字符串 / 纯空格都算"没填"', () => {
  for (const blank of ['', '   ', '\t', null, undefined]) {
    const c = resolveConfig({ apiKey: 'sk-x', baseUrl: blank, model: blank, visionModel: blank });
    assert.equal(c.baseUrl, DEEPSEEK.baseUrl, `baseUrl=${JSON.stringify(blank)}`);
    assert.equal(c.model, DEEPSEEK.model, `model=${JSON.stringify(blank)}`);
  }
});

test('③ 接口是别家且没填模型：**不猜**模型名，留空交给调用方报错', () => {
  const c = resolveConfig({ apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1' });
  assert.equal(c.baseUrl, 'https://api.openai.com/v1');
  assert.equal(c.model, '', '别家的模型名不能猜');
  assert.equal(c.defaulted.model, false);
});

test('④ 接口是别家且填了模型：视觉跟随它', () => {
  const c = resolveConfig({ apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
  assert.equal(c.model, 'gpt-4o');
  assert.equal(c.visionModel, 'gpt-4o');
});

test('⑤ 用户自己填的模型不被覆盖（哪怕不是默认那个）', () => {
  const c = resolveConfig({ apiKey: 'sk-x', model: 'deepseek-v4-pro' });
  assert.equal(c.model, 'deepseek-v4-pro');
  assert.equal(c.defaulted.model, false);
  assert.equal(c.visionModel, 'deepseek-v4-pro', '视觉仍跟随用户填的模型');
});

test('⑥ 单独填视觉模型时，对话模型仍补默认', () => {
  const c = resolveConfig({ apiKey: 'sk-x', visionModel: 'my-vision' });
  assert.equal(c.model, DEEPSEEK.model);
  assert.equal(c.visionModel, 'my-vision');
  assert.equal(c.defaulted.visionModel, false);
});

test('⑦ isDeepSeek：只认真正的 deepseek.com 域', () => {
  assert.equal(isDeepSeek('https://api.deepseek.com'), true);
  assert.equal(isDeepSeek('https://api.deepseek.com/v1'), true);
  assert.equal(isDeepSeek('http://api.deepseek.com/'), true);
  assert.equal(isDeepSeek('  https://api.deepseek.com  '), true);
  // 以下**不该**被认成 DeepSeek —— 用子串匹配就会错
  assert.equal(isDeepSeek('https://api.openai.com/v1'), false);
  assert.equal(isDeepSeek('https://mydeepseek.com'), false);
  assert.equal(isDeepSeek('https://deepseek.com.evil.test'), false);
  assert.equal(isDeepSeek(''), false);
  assert.equal(isDeepSeek(null), false);
});

test('⑧ prefill() 就是"用户什么都没填"的结果', () => {
  const p = prefill();
  assert.equal(p.baseUrl, DEEPSEEK.baseUrl);
  assert.equal(p.model, DEEPSEEK.model);
  assert.equal(p.apiKey, undefined, 'prefill 不含凭证');
});

test('⑨ 原始字段被保留（不丢调用方传的其它配置）', () => {
  const c = resolveConfig({ apiKey: 'sk-x', sectionKey: 'abc', splitLine: 900, concurrency: 5 });
  assert.equal(c.sectionKey, 'abc');
  assert.equal(c.splitLine, 900);
  assert.equal(c.concurrency, 5);
});
