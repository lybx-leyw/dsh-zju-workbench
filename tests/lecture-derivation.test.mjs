import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewDerivation, withDerivation } from '../packages/dsh-zhiyun-core-lecture/src/derivation.js';
import { judgeWritten, REGISTER } from '../packages/dsh-zhiyun-core-lecture/src/register.js';

const skew = `于是合并后的势满足 Phi_{i+1} ≤ h + l1 + l2，而合并前的势为 Phi_i = h1 + h2 + h。由此得势的变化量 Phi_{i+1} - Phi_i ≤ l1 + l2 - h1 - h2。
采用势函数 Phi_i = h_1 + h_2 + h。合并后势能满足 Phi_{i+1} ≤ l_1 + l_2 + h。从而得到 Phi_{i+1} - Phi_i ≤ 2(l_1 + l_2)。`;

test('已写明的上界相减不一致时点名两边式子，一致的步骤不报', () => {
  const notes = reviewDerivation(skew);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /l1\+l2-h1-h2/);
  assert.match(notes[0], /2\(l1\+l2\)/);
  assert.equal(reviewDerivation('Phi_{i+1} ≤ l_1 + l_2 + h，Phi_i = h_1 + h_2 + h。Phi_{i+1} - Phi_i ≤ l_1 + l_2 - h_1 - h_2。').length, 0);
});

test('解析不了的公式不升级成草稿，正文保持原样', () => {
  assert.deepEqual(reviewDerivation('场强 $E=\\sigma/\\varepsilon_0$，随后 $E\\le E_0$。'), []);
  const verdict = withDerivation(judgeWritten({ source: '口述。', rewritten: '内存采用随机寻址。' }), '内存采用随机寻址。');
  assert.equal(verdict.register, REGISTER.written);
  const caught = withDerivation(judgeWritten({ source: '口述。', rewritten: skew, alreadyWritten: true }), skew);
  assert.equal(caught.register, REGISTER.draft);
  assert.match(caught.notes.join('\n'), /推导未通过复核/);
});
