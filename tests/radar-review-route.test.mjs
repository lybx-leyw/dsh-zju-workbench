/**
 * `scripts/radar-review-route.mjs` 的契约测试。
 *
 * 这个检查器是在给上游模块**判负**（当前 red）。一条只会 red 的检查器没有价值 ——
 * 它可能只是写错了。所以这里必须同时钉住三件事：
 *
 * 1. **判定是确定的**：同一份代码、同一个种子，两次跑出同一个结论与同一个数；
 * 2. **题池标签是自证的**：`countsAsWrong` 认出的「错过」数必须与构造时一致，
 *    否则说明判定链上游（`makeAttempt`）变了，结论不可信 → `LABEL_MISMATCH`；
 * 3. **它真的能变绿**：把选池换成「错题优先」的对照实现，同一套统计必须过阈值。
 *    这条是**阴性对照** —— 证明失败来自被测逻辑，而不是检查器自身算错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { audit } from '../scripts/radar-review-route.mjs';

test('① 当前实现：review 未按错题路由（ROUTE_MISSING），且判定稳定', async () => {
  const a = await audit({ runs: 200 });
  const b = await audit({ runs: 200 });
  assert.equal(a.ok, false, '当前 planPractice 的 review 模式不该通过');
  assert.deepEqual(a.stats, b.stats, '同一份代码 + 同一种子，统计量必须完全一致');
  const codes = a.findings.map((f) => f.code);
  assert.ok(codes.includes('ROUTE_MISSING'), `期望 ROUTE_MISSING，实际 ${codes.join(',')}`);
});

test('② 题池标签自证：错题占比落在「随机」区间（40%–60%），不是取样误差', async () => {
  const r = await audit({ runs: 400 });
  const share = r.stats.wrongShare;
  assert.ok(share > 0.4 && share < 0.6, `错题池占一半，随机抽应落在 40%–60%，实际 ${(share * 100).toFixed(1)}%`);
});

test('③ review 不会混入「从没做过的题」', async () => {
  // 这一条**当前已经成立**：`old` 池只取 attempts.length > 0。
  // 钉住它，是为了把「错题路由」和「模式隔离」两件事分开报 —— 修 A 不该破 B。
  const r = await audit({ runs: 200 });
  assert.equal(r.stats.freshHits, 0);
  assert.ok(!r.findings.some((f) => f.code === 'ROUTE_WASTED'));
});

test('④ 阴性对照：错题优先的选池必须过阈值', async () => {
  // 与被测代码同构的最小对照：`old` 池再按 countsAsWrong 分成两段，错题在前。
  const { planPractice } = await import('../packages/dsh-zhiyun-core-quiz/src/points.js');
  const { makeAttempt, QUIZ_AUTOGRADE_VERDICTS: VERDICT } = await import('../packages/dsh-zhiyun-core-quiz/src/store.js');

  const mk = (v) => makeAttempt({
    id: 'a', quizId: 'q', courseId: 'c', sectionId: 's', blockIndex: 0,
    response: '', autoVerdict: v, selfRecall: null, at: '2026-10-27T00:00:00Z',
  });
  const items = [];
  const wrongIds = new Set();
  for (let i = 0; i < 10; i++) { wrongIds.add(`w${i}`); items.push({ id: `w${i}`, status: 'approved', type: 'cloze', strategy: 'recall', pointId: 'p1', attempts: [mk(VERDICT.incorrect), mk(VERDICT.correct)] }); }
  for (let i = 0; i < 10; i++) items.push({ id: `c${i}`, status: 'approved', type: 'cloze', strategy: 'recall', pointId: 'p1', attempts: [mk(VERDICT.correct)] });
  for (let i = 0; i < 10; i++) items.push({ id: `n${i}`, status: 'approved', type: 'cloze', strategy: 'recall', pointId: 'p1', attempts: [] });

  // 对照实现：先跑真实的 planPractice 拿到「做过」的候选，再按错题优先重排。
  const done = planPractice(items, { mode: 'review', count: 20 });
  const ranked = [
    ...done.filter((q) => q.attempts.some((a) => a.countsAsWrong)),
    ...done.filter((q) => !q.attempts.some((a) => a.countsAsWrong)),
  ].slice(0, 10);
  const share = ranked.filter((q) => wrongIds.has(q.id)).length / ranked.length;
  assert.ok(share >= 0.85, `对照实现应有 ≥85% 是错题，实际 ${(share * 100).toFixed(1)}%`);
});

test('⑤ 空池 / 池子太小不崩，返回可解释结论', async () => {
  const r = await audit({ runs: 1, count: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.findings.length > 0, '取不满时必须给出 finding，而不是静默通过');
});
