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

const SRC = 'packages/core/study/src/quiz-engine-runtime.js';
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
  // ⚠️ 不能用 `indexOf('\nfunction bankQuestion(')` 当结尾锚点。
  // `runtimeState` 与 `bankQuestion` 之间还夹着两个顶层函数
  // （`resolvePointById`、`unresolvedQuestion`），切片会一路吞到它们，
  // 其中 `export function resolvePointById` 的 `export` 关键字会让
  // `new Function(...)` 直接抛 `SyntaxError: Unexpected token 'export'`。
  //
  // 也不能靠换行符归一化绕过：CRLF 与 LF 下都会越界（4026 / 3923 字符，
  // 而 `runtimeState` 本体只有约 1581 字符）。
  //
  // 正确做法是**按花括号配对找函数结束**，与排版无关。
  const end = braceEnd(source, start);
  const body = source.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function('fault', 'serial', `${body}; return runtimeState;`)(fault, serial);
}

/**
 * 从 `start`（指向 `function` 关键字）起，按花括号深度找函数体的结束位置。
 *
 * 只数 `{}`，但要跳过字符串与注释里的括号 —— 否则 `'{'` 这样的字面量会把
 * 深度算歪，切出来的片段照样是坏的。够用即可：本仓这几个函数里没有模板字符串
 * 嵌套花括号的复杂情况，遇到就如实报错而不是猜。
 *
 * @param source - 源码全文。
 * @param start - `function` 关键字的下标。
 * @returns 函数体右花括号之后一位的下标。
 */
function braceEnd(source, start) {
  let depth = 0;
  let seen = false;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (c === '{') { depth += 1; seen = true; continue; }
    if (c === '}') {
      depth -= 1;
      if (seen && depth === 0) {
        // 到这里正好闭合了最外层的函数体
        while (i + 1 < source.length && /\s/.test(source[i + 1])) {
          if (source[i + 1] === '\n') return i + 1;
          i += 1;
        }
        return i + 1;
      }
    }
  }
  throw new Error('花括号未闭合：找不到 runtimeState 的结束位置');
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
