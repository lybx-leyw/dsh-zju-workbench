// 大纲工程护栏的回归测试。
//
// 上游 `steps/outline.ts` 有三个数字，各自防一类真实事故：
//   - MAX_OUTLINE_SCENES = 100   → 模型跑飞时无限生成、无限计费
//   - 512 KiB 上限               → 跑飞的响应把堆撑爆
//   - 重试 2 次                  → 一次瞬时 429 = 整堂课报废
//
// 本仓原先三个都没有。这个文件把它们钉住。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OUTLINE_RETRIES,
  MAX_OUTLINE_SCENES,
  MAX_OUTLINE_STREAM_BYTES,
  produceOutline,
} from '../../../packages/core/classroom-generate/src/phases/outline.js';
import { parseOutlineResponse } from '../../../packages/core/classroom-generate/src/scene.js';

const brief = {
  requirement: '讲 BST',
  topic: 'BST',
  description: '',
  goals: [],
  scenes: [],
  interactive: false,
  assess: false,
  project: false,
  languageDirective: '',
};

function outlineJson(count) {
  return JSON.stringify({
    languageDirective: '中文',
    courseTitle: 'T',
    outlines: Array.from({ length: count }, (_, i) => ({
      id: `scene_${i + 1}`,
      type: 'slide',
      title: `页 ${i + 1}`,
      keyPoints: ['p'],
      order: i + 1,
    })),
  });
}

// ── 常量与上游一致 ────────────────────────────────────────────────────────

test('guard constants match upstream', () => {
  assert.equal(MAX_OUTLINE_SCENES, 100, '上游 outline-schema.ts:20');
  assert.equal(MAX_OUTLINE_STREAM_BYTES, 512 * 1024, '上游 steps/outline.ts:61');
  assert.equal(MAX_OUTLINE_RETRIES, 2, '上游 steps/outline.ts:57');
});

// ── 场景数上限 ────────────────────────────────────────────────────────────

test('outline scenes are capped at MAX_OUTLINE_SCENES', () => {
  const parsed = parseOutlineResponse(outlineJson(150), { maxScenes: MAX_OUTLINE_SCENES });
  assert.equal(parsed.outlines.length, MAX_OUTLINE_SCENES);
});

test('an outline under the cap is untouched', () => {
  const parsed = parseOutlineResponse(outlineJson(8), { maxScenes: MAX_OUTLINE_SCENES });
  assert.equal(parsed.outlines.length, 8);
});

test('duplicate outline ids are made unique', () => {
  const raw = JSON.stringify({
    languageDirective: '',
    outlines: [
      { id: 'dup', type: 'slide', title: 'A', keyPoints: ['a'] },
      { id: 'dup', type: 'slide', title: 'B', keyPoints: ['b'] },
      { id: 'dup', type: 'slide', title: 'C', keyPoints: ['c'] },
    ],
  });
  const parsed = parseOutlineResponse(raw, {});
  const ids = parsed.outlines.map((o) => o.id);
  assert.equal(new Set(ids).size, 3, `id 必须唯一，实际 ${ids.join(',')}`);
});

// ── 重试 ──────────────────────────────────────────────────────────────────

test('a transient failure is retried and eventually succeeds', async () => {
  let calls = 0;
  const llm = {
    providerId: 'test',
    model: 'm',
    async call() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('429 rate limited'), { code: 'E_UPSTREAM_ERROR' });
      return outlineJson(3);
    },
  };
  const events = [];
  const result = await produceOutline({
    brief,
    llm,
    agent: null,
    emit: (_phase, type, payload) => events.push({ type, payload }),
  });
  assert.equal(calls, 2, '第一次失败后应重试一次');
  assert.equal(result.outlines.length, 3);
  assert.ok(events.some((e) => e.payload?.status === 'retry'), '应发出 retry 事件');
});

test('unparseable output is retried', async () => {
  let calls = 0;
  const llm = {
    providerId: 'test',
    model: 'm',
    async call() {
      calls += 1;
      return calls === 1 ? '这不是 JSON' : outlineJson(2);
    },
  };
  const result = await produceOutline({ brief, llm, agent: null, emit: () => {} });
  assert.equal(calls, 2);
  assert.equal(result.outlines.length, 2);
});

test('it gives up after MAX_OUTLINE_RETRIES attempts and falls back', async () => {
  let calls = 0;
  const llm = {
    providerId: 'test',
    model: 'm',
    async call() {
      calls += 1;
      throw Object.assign(new Error('always fails'), { code: 'E_UPSTREAM_ERROR' });
    },
  };
  // 兜底走 agent.plan；这里给 null，走 brief 推出的最小大纲
  const result = await produceOutline({ brief, llm, agent: null, emit: () => {} });
  assert.equal(calls, MAX_OUTLINE_RETRIES + 1, `应尝试 ${MAX_OUTLINE_RETRIES + 1} 次`);
  assert.ok(Array.isArray(result.outlines), '必须给出确定性兜底大纲');
});

// ── 超大响应 ──────────────────────────────────────────────────────────────

test('an oversized response is clamped rather than crashing', async () => {
  // 造一个远超 512 KiB 的"大纲"（大量无效场景，只为撑大体积）
  const pad = 'x'.repeat(400);
  const huge = `[${Array.from({ length: 3000 }, (_, i) => `{"id":"s${i}","type":"slide","title":"${pad}","keyPoints":["y"]}`).join(',')}]`;
  assert.ok(Buffer.byteLength(huge, 'utf8') > MAX_OUTLINE_STREAM_BYTES, '测试数据本身要够大');

  const llm = {
    providerId: 'test',
    model: 'm',
    async call() { return huge; },
  };
  const result = await produceOutline({ brief, llm, agent: null, emit: () => {} });
  // 关键：不崩、且场景数受上限约束
  assert.ok(result.outlines.length <= MAX_OUTLINE_SCENES);
});
