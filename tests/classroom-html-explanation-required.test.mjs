import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSlideDeck } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-shell.js';

const base = {
  title: '标题', points: ['要点'], summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">图</text></svg>',
  formulas: [], explanation: '画布外讲解。',
};

test('a missing explanation says the field is missing, not that text is bad', () => {
  // 真实事故：模型整批漏写 explanation，报错只说 "expected nonempty plain text"，
  // 模型以为只是写短了，重画照旧漏。
  const { explanation, ...withoutExplanation } = base;
  assert.throws(
    () => validateSlideDeck({ slides: [withoutExplanation] }),
    (error) => {
      assert.match(error.message, /explanation: 缺少这个字段/);
      assert.match(error.message, /画布外的完整讲解/, '要说清这个字段是干什么的');
      assert.match(error.message, /不能省略/);
      return true;
    },
  );
});

test('a non-string explanation names the actual type', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, explanation: ['讲解'] }] }),
    /explanation: 必须是字符串，收到的是 数组/,
  );
});

test('an empty explanation is distinguished from a missing one', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, explanation: '   ' }] }),
    /explanation: 不能是空字符串/,
  );
});

test('a control character in explanation is called out explicitly', () => {
  assert.throws(
    () => validateSlideDeck({ slides: [{ ...base, explanation: '正常文字\u0002坏字符' }] }),
    /explanation: 含有不可见的控制字符/,
  );
});
