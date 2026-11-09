/**
 * 校验失败时的错误信息必须**可操作**。
 *
 * 真实事故：模型某页写了 5 个重点（上限 3），校验只回了 `Invalid slide deck:
 * slides[0].points` —— 既没说「多了几个」，也没说是哪几条。模型重画三次，
 * 三次都是同一个错，整章报废。
 *
 * 这类"错误说了等于没说"的问题不会让测试变红，只会让真实运行的修复循环空转，
 * 所以专门钉在这里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSlideDeck } from '../packages/core/classroom-generate/src/html-slide-shell.js';

const svg = '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>';
const make = (overrides = {}) => ({ title: '一页', points: ['要点一'], summary: '总结',
  visualHtml: svg, formulas: [], explanation: '画布外讲解，足够长。', ...overrides });

test('too many points names the count, lists them, and says where the rest goes', () => {
  const deck = { slides: [make({ points: ['要点一', '要点二', '要点三', '要点四', '要点五'] })] };
  try {
    validateSlideDeck(deck);
    assert.fail('应当拒绝 5 条要点');
  } catch (error) {
    const message = error.message;
    assert.match(message, /有 5 条，最多 3 条/, '必须报出实际条数');
    assert.match(message, /要点一/, '必须列出内容，模型才知道删哪些');
    assert.match(message, /explanation/, '必须指出剩余内容放哪里');
  }
});

test('an over-long point names which index and how long it is', () => {
  const tooLong = '这是一条明显超过三十六个字符上限、必须拆开的要点文本内容'.repeat(2);
  const deck = { slides: [make({ points: ['短', tooLong] })] };
  try {
    validateSlideDeck(deck);
    assert.fail('应当拒绝超长要点');
  } catch (error) {
    assert.match(error.message, /points\[1\]/, '必须指出是第几条');
    assert.match(error.message, /max 36/, '必须报出上限');
    assert.match(error.message, /got \d+/, '必须报出实际长度');
  }
});

test('too many formulas says to split the page', () => {
  const formulas = Array.from({ length: 5 }, (_, i) => ({ html: `x = ${i}` }));
  const deck = { slides: [make({ formulas })] };
  try {
    validateSlideDeck(deck);
    assert.fail('应当拒绝 5 条公式');
  } catch (error) {
    assert.match(error.message, /有 5 条，最多 4 条/);
    assert.match(error.message, /下一页/, '必须给出处置办法');
  }
});

test('points that are not an array say what shape is expected', () => {
  try {
    validateSlideDeck({ slides: [make({ points: '要点一' })] });
    assert.fail('应当拒绝非数组 points');
  } catch (error) {
    assert.match(error.message, /必须是字符串数组/);
  }
});

test('formulas that are not an array say to write an empty array', () => {
  try {
    validateSlideDeck({ slides: [make({ formulas: null })] });
    assert.fail('应当拒绝 null formulas');
  } catch (error) {
    assert.match(error.message, /没有公式就写 \[\]/);
  }
});
