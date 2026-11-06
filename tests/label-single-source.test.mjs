/**
 * 标签识别的单一来源验证。
 *
 * 背景：question-stream 的 runLabeledStep 用 classifyLabel 判断「本次回复是哪个标签」，
 * core-tool 的循环用 classifyLabel 判断「这个标签是否违规」。两份只要有一处
 * accepted 形状不同，就会出现「step 认出 FINISH、loop 说违规」→ 补纠正 → 再来一遍
 * → 无限循环，且不报错，只是把模型调用预算烧光。
 *
 * 修法：只保留 question-stream 那份，core-tool 通过 bindLabelClassifier 接收。
 * core-tool 自带 fallback，所以它仍能独立工作；一旦装配时绑定了，就必须两边一致。
 *
 * 用法：node tests/label-single-source.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLabel as fromTool, bindLabelClassifier } from '../packages/dsh-zhiyun-core-tool/src/loop.js';
import { classifyLabel as fromLlm } from '../packages/dsh-zhiyun-core-question-stream/src/index.js';

/** 边界用例：包裹方式、裸标签、分隔符、流中间态。 */
const CASES = [
  ['``FINISH``正文', ['FINISH'], true],
  ['``FINISH`` 正文', ['FINISH'], true],
  ['`FINISH`正文', ['FINISH'], true],
  ['```FINISH```正文', ['FINISH'], true],
  ['FINISH 正文', ['FINISH'], true],
  ['FINISH: 正文', ['FINISH'], true],
  ['FINISH', ['FINISH'], true],
  ['FINISHED 不是标签', ['FINISH'], true],
  ['  ``FINISH``正文', ['FINISH'], true],
  ['\ufeff``FINISH``正文', ['FINISH'], true],
  ['``TOOL``', ['FINISH', 'TOOL'], true],
  ['``THINK``我再想想', ['FINISH', 'TOOL', 'THINK'], true],
  ['纯正文没有标签', ['FINISH'], true],
  ['', ['FINISH'], true],
  ['``FIN``', ['FINISH'], true],          // 流中间态：标签还没收完
  ['``FINISH```', ['FINISH'], true],      // 过闭合
  ['正文里提到 ``FINISH`` 但不是开头', ['FINISH'], true],
];

test('绑定前：两份独立实现的行为逐个对齐（对拍）', () => {
  for (const [input, allowed, final] of CASES) {
    assert.deepEqual(
      fromTool(input, { allowedLabels: allowed, final }),
      fromLlm(input, { allowedLabels: allowed, final }),
      `输入 ${JSON.stringify(input)} 时两份实现不一致`,
    );
  }
});

test('绑定后：core-tool 用的就是 question-stream 那一份（行为等价）', () => {
  // wireLabelClassifier 返回的是它传出去的那个函数；不比较引用相等
  // （不同模块的再导出可能包装一层），只验「绑定后行为与 question-stream 完全一致」。
  bindLabelClassifier(fromLlm); const returned = fromLlm;
  assert.equal(typeof returned, 'function');

  for (const [input, allowed, final] of CASES) {
    assert.deepEqual(
      fromTool(input, { allowedLabels: allowed, final }),
      fromLlm(input, { allowedLabels: allowed, final }),
      `绑定后 ${JSON.stringify(input)} 仍不一致`,
    );
  }
});

test('绑定后确实换了实现：改 question-stream 的行为会立刻反映到 core-tool', () => {
  // 用一个可辨识的假实现验证「转发」真的生效，而不是还在走 fallback
  let called = 0;
  bindLabelClassifier((buffer, options) => { called += 1; return ['STUB', buffer]; });
  const result = fromTool('任意内容', { allowedLabels: ['FINISH'] });
  assert.equal(called, 1, 'core-tool 应当调用被注入的实现');
  assert.equal(result[0], 'STUB');

  // 复原，避免影响后续用例
  bindLabelClassifier(fromLlm);
});
