/**
 * PERSIST 错误必须带真实原因。
 *
 * # 锁住的问题（2026-10-31 真机）
 *
 * `runtimeState.change` 原来的写法是：
 *   catch(cause){throw fault('PERSIST','题目或断点保存失败');}
 *
 * `cause` 被完全丢弃。于是界面上只有一句「题目或断点保存失败」，
 * 而真实原因（schema 不合格？磁盘满？不可克隆？）无从得知 ——
 * 排查只能从头猜，而题其实已经生成好了。
 *
 * 现在要求：message 里带 detail，且 error.cause 保留原始错误。
 *
 * 用法：node tests/persist-diagnosability.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js';
const source = fs.readFileSync(path.resolve(SRC), 'utf8');

/** 把 runtimeState 抽出来跑（它只依赖 fault 与 serial）。 */
function loadRuntimeState() {
  const fault = (code, message) => Object.assign(Error(message), { code });
  const serial = () => {
    let chain = Promise.resolve();
    return work => { chain = chain.then(work, work); return chain; };
  };
  const start = source.indexOf('function runtimeState(input){');
  assert.ok(start > 0, '找不到 runtimeState');
  const end = source.indexOf('\nfunction bankQuestion(', start);
  const body = source.slice(start, end > 0 ? end : undefined);
  // eslint-disable-next-line no-new-func
  return new Function('fault', 'serial', `${body}; return runtimeState;`)(fault, serial);
}

test('保存失败时，message 里必须带原始原因', async () => {
  const runtimeState = loadRuntimeState();
  const state = runtimeState({
    checkpoint: { version: 'v1', planKey: 'k', phase: 'p', currentTask: null, rewrites: {}, tasks: [] },
    onQuestion: async () => {
      // 模拟 schema 校验失败
      throw Object.assign(Error('题库格式无效'), { code: 'INVALID_RECORD' });
    },
    onCheckpoint: async () => {},
  });

  let caught = null;
  try {
    await state.change(async next => {
      next.tasks.push({ questionIds: ['q1'], state: 'completed', drafts: null, cursor: 0, attempts: 0, error: null });
      return { id: 'q1' };
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, '必须要抛错');
  assert.equal(caught.code, 'PERSIST', '错误码仍是 PERSIST（上层按它分流）');
  assert.match(caught.message, /题库格式无效/,
    `message 必须包含真实原因，否则界面上只有一句「保存失败」。实际：${caught.message}`);
  assert.ok(caught.cause, '原始错误必须保留在 cause 上，便于日志追溯');
  assert.equal(caught.cause.code, 'INVALID_RECORD');
});

test('checkpoint 写入失败时同样要带原因', async () => {
  const runtimeState = loadRuntimeState();
  const state = runtimeState({
    checkpoint: { version: 'v1', planKey: 'k', phase: 'p', currentTask: null, rewrites: {}, tasks: [] },
    onQuestion: async () => {},
    onCheckpoint: async () => { throw Error('磁盘空间不足'); },
  });

  let caught = null;
  try {
    // 返回 null → 走 onCheckpoint 分支
    await state.change(async next => { next.phase = 'x'; return null; });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.code, 'PERSIST');
  assert.match(caught.message, /磁盘空间不足/, '真实原因必须上屏');
});

test('保存成功时不抛错，且 saved 被推进', async () => {
  const runtimeState = loadRuntimeState();
  const saved = [];
  const state = runtimeState({
    checkpoint: { version: 'v1', planKey: 'k', phase: 'p', currentTask: null, rewrites: {}, tasks: [] },
    onQuestion: async (_q, next) => { saved.push(next.phase); },
    onCheckpoint: async () => {},
  });

  await state.change(async next => { next.phase = 'saving'; return { id: 'q1' }; });
  assert.deepEqual(saved, ['saving']);
  assert.equal(state.saved.phase, 'saving', '成功后 saved 必须更新');
});
