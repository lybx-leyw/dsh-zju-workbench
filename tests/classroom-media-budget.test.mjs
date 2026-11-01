// 媒体端口与预算分配的回归测试。
//
// 这两块的性质相同：**接线错误不会报错，只会静默失效**。
//   - media 端口形状对不上 → 图片全失败、配音全跳过，而 run 仍报成功
//   - 预算贪心分配 → 后几份讲义 0 字，但仍记成"成功"
// 所以必须有测试盯着，不能靠人肉发现。

import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptMediaService } from '../packages/dsh-zhiyun-core-classroom-generate/src/media-port.js';
import {
  MATERIAL_TEXT_LIMIT,
  MAX_MATERIALS,
  allocateMaterialBudgets,
} from '../packages/dsh-zhiyun-core-classroom-generate/src/phases/material-analysis.js';

// ── 媒体端口适配 ──────────────────────────────────────────────────────────

/** 模拟仓内真实服务：tts(text, voice) / image(prompt, options) 返回信封。 */
function fakeMediaService() {
  return {
    async tts(text) {
      if (typeof text !== 'string') throw new Error('should be string');
      return { ok: true, format: 'mp3', bytes: Buffer.from('AUDIO') };
    },
    async image(prompt, options = {}) {
      if (typeof prompt !== 'string') throw new Error('image 需要字符串 prompt');
      return { ok: true, base64: Buffer.from(`IMG:${prompt}`).toString('base64'), width: 10, height: 10 };
    },
    async parsePdf() { return { ok: true, text: 'pdf' }; },
    async asr() { return { ok: true }; },
    async search() { return { ok: true, results: [] }; },
    async fetchPage() { return { ok: true }; },
  };
}

test('speech port maps to service.tts and unwraps the envelope', async () => {
  const port = adaptMediaService(fakeMediaService());
  assert.equal(typeof port.speech, 'function', '必须有 speech 端口（真实服务叫 tts）');
  const out = await port.speech({ text: '你好' });
  assert.ok(out.data instanceof Uint8Array);
  assert.equal(Buffer.from(out.data).toString(), 'AUDIO');
  assert.equal(out.mime, 'audio/mpeg', '格式 mp3 要映射成 audio/mpeg');
});

test('image port calls image(prompt) with a string, not the item object', async () => {
  const port = adaptMediaService(fakeMediaService());
  const out = await port.image({ prompt: '一只猫', aspectRatio: '16:9' });
  // 关键：base64 要被解成 bytes（原先 toBytes 只认 data/bytes，base64 直接丢）
  assert.ok(out.data instanceof Uint8Array);
  assert.equal(Buffer.from(out.data).toString(), 'IMG:一只猫');
  assert.equal(out.mime, 'image/png');
});

test('a {ok:false} envelope becomes a thrown error with its code', async () => {
  const port = adaptMediaService({
    ...fakeMediaService(),
    async image() { return { ok: false, code: 'MISSING_API_KEY', message: '没有 key' }; },
  });
  await assert.rejects(() => port.image({ prompt: 'x' }), (error) => {
    assert.equal(error.code, 'MISSING_API_KEY');
    return true;
  });
});

test('no video port is exposed when the service has no video capability', () => {
  const port = adaptMediaService(fakeMediaService());
  assert.equal(port.video, undefined, '没有视频能力就不要暴露端口（记 skipped 比每次抛错诚实）');
});

test('parsePdf is passed through (material-analysis depends on it)', () => {
  const port = adaptMediaService(fakeMediaService());
  assert.equal(typeof port.parsePdf, 'function', '适配层必须透传解析能力，否则所有带讲义的 run 全挂');
});

test('adaptMediaService returns null for a missing service', () => {
  assert.equal(adaptMediaService(null), null);
  assert.equal(adaptMediaService(undefined), null);
  assert.equal(adaptMediaService({}), null, '空对象没有可用能力，应视为无端口');
});

test('image with a url result returns the url (caller downloads with a cap)', async () => {
  const port = adaptMediaService({
    ...fakeMediaService(),
    async image() { return { ok: true, url: 'https://example.com/a.png' }; },
  });
  const out = await port.image({ prompt: 'x' });
  assert.equal(out, 'https://example.com/a.png');
});

// ── 预算分配 ──────────────────────────────────────────────────────────────

test('material limits match upstream (50k chars, 5 files)', () => {
  assert.equal(MATERIAL_TEXT_LIMIT, 50_000, '上游 MAX_PDF_CONTENT_CHARS = 50000');
  assert.equal(MAX_MATERIALS, 5, '上游 MAX_DOCUMENT_BUNDLE_FILES = 5');
});

test('budget allocation is fair: a huge first doc cannot starve the second', () => {
  // 第一份 100 万字，第二份 3 万字。贪心会让第二份拿到 0。
  const budgets = allocateMaterialBudgets([1_000_000, 30_000], 50_000);
  assert.ok(budgets[1] > 0, `第二份必须拿到预算，实际 ${budgets[1]}`);
  assert.ok(budgets[0] + budgets[1] <= 50_000, '总量不得超预算');
});

test('budget allocation gives every doc something when they all fit', () => {
  const lengths = [10_000, 10_000, 10_000];
  const budgets = allocateMaterialBudgets(lengths, 50_000);
  assert.deepEqual(budgets, [10_000, 10_000, 10_000], '都能放下时不该截断');
});

test('budget allocation never exceeds the cap and never goes negative', () => {
  const cases = [
    [[500_000, 500_000, 500_000, 500_000, 500_000], 50_000],
    [[1, 2, 3], 50_000],
    [[], 50_000],
    [[100], 50_000],
  ];
  for (const [lengths, cap] of cases) {
    const budgets = allocateMaterialBudgets(lengths, cap);
    assert.equal(budgets.length, lengths.length);
    for (const value of budgets) {
      assert.ok(value >= 0, `预算不能为负：${value}`);
      assert.ok(Number.isInteger(value), `预算必须是整数：${value}`);
    }
    const total = budgets.reduce((sum, v) => sum + v, 0);
    assert.ok(total <= cap, `总分配 ${total} 超过上限 ${cap}`);
  }
});

test('budget allocation respects per-doc length', () => {
  const budgets = allocateMaterialBudgets([100, 200], 50_000);
  assert.equal(budgets[0], 100, '不能分超过该份实际字数');
  assert.equal(budgets[1], 200);
});

test('five huge docs each get a non-trivial share', () => {
  const lengths = Array(5).fill(2_000_000);
  const budgets = allocateMaterialBudgets(lengths, 50_000);
  const total = budgets.reduce((sum, v) => sum + v, 0);
  assert.ok(total > 45_000, `应尽量用满预算，实际 ${total}`);
  for (const [i, value] of budgets.entries()) {
    assert.ok(value > 5_000, `第 ${i + 1} 份只拿到 ${value} 字，不公平`);
  }
});
