/**
 * 全文润色的**格式重试契约**。
 *
 * 背景：`mergeReorganization` 的校验是硬约束（原稿块全覆盖、例题结构不丢…），
 * 一条不满足就整份拒绝。这是对的 —— 但它拒的是**格式偏差**，不是内容错。
 * 真实模型输出几千行协议文本时，漏一行 `#!section`、少写一个块头都是常态。
 *
 * 早先 `polish` 只调一次 `merge`，一次不过就整份作废，用户看到 `FORMAT`
 * 却不知道错在哪一行、也没机会让模型改。这是产品侧的缺口。
 *
 * 现在：第一次失败 → 把**具体拒绝原因**喂回模型重发一次 → 仍失败才退回。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPolishVariable, POLISH_ITEM_NAMES } from '../packages/dsh-zhiyun-core-lecture/src/polish.js';
import { exportReorganization, mergeReorganization } from '../packages/dsh-zhiyun-core-lecture/src/agent-text.js';

const lecture = () => ({
  title: '讲义',
  chapters: [{
    title: '基本概念',
    topics: [{
      title: '随机试验',
      blocks: [
        { kind: { wire: 'elaboration', label: '讲解' }, title: '定义', text: '随机试验指结果事先不能确定的试验。', sourceBlockIndexes: [1] },
      ],
    }],
  }],
});
const record = () => ({
  blocks: [{ index: 1, page: 7, tag: { role: '主线', summary: '随机试验' }, startMs: 1000 }],
  outline: [{ title: '基本概念', from: 1, to: 1 }],
});

test('① 重试提示里必须带**具体原因**（不带原因等于让模型再猜一次）', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  const plain = buildPolishVariable(text);
  const retry = buildPolishVariable(text, { retryReason: '课节标识改变' });

  assert.ok(retry.length > plain.length, '重试提示应当更长（多了原因段）');
  assert.match(retry, /课节标识改变/, '必须原样带上拒绝原因');
  assert.match(retry, /协议行必须逐行原样保留/, '必须提醒它别删协议行');
  assert.ok(retry.includes(text.trim()), '原稿全文仍然完整包含在内');
});

test('② 不接受原因时行为不变（向后兼容）', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  const plain = buildPolishVariable(text);
  assert.match(plain, /【待润色的讲义全文】/);
  assert.ok(plain.includes(text.trim()));
});

test('③ 硬约束一条都不放松：漏 #!section 仍然拒绝', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  const broken = text.split('\n').filter((l) => !l.startsWith('#!section')).join('\n');
  assert.throws(
    () => mergeReorganization(lecture(), broken, record(), 'bench'),
    (e) => e.code === 'FORMAT' && /课节标识改变/.test(e.message),
  );
});

test('④ 硬约束一条都不放松：漏块头仍然拒绝（会报"遗漏"）', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  const broken = text.split('\n').filter((l) => !l.startsWith('>>> BLOCK')).join('\n');
  assert.throws(
    () => mergeReorganization(lecture(), broken, record(), 'bench'),
    (e) => e.code === 'FORMAT',
  );
});

test('⑤ 正确的文本仍能合回（重试路径不影响正常路径）', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  /* ⚠️ `mergeReorganization` 返回的是 `{ lecture, updated, coverage }` ——
   * 章在 `merged.lecture.chapters`，不是 `merged.chapters`。 */
  const merged = mergeReorganization(lecture(), text, record(), 'bench');
  assert.ok(merged.lecture, '应当返回 lecture');
  assert.ok(merged.lecture.chapters.length >= 1);
});

test('⑥ 允许的改写不被误判（改标题 / 改正文 / 加围栏 / 加前后缀）', () => {
  const text = exportReorganization(lecture(), 'bench', record());
  const variants = [
    text.replace('| 随机试验 |', '| 随机试验的定义 |'),
    text.replace('随机试验指结果事先不能确定的试验。', '随机试验：结果事先不能确定的试验。'),
    '```\n' + text + '\n```',
    '好的，润色完成：\n\n' + text + '\n\n以上。',
  ];
  for (const [i, variant] of variants.entries()) {
    assert.doesNotThrow(
      () => mergeReorganization(lecture(), variant, record(), 'bench'),
      `第 ${i + 1} 种允许的改写不该被拒绝`,
    );
  }
});

test('⑦ 润色清单仍是 6 项（重试不改变对外契约）', () => {
  assert.equal(POLISH_ITEM_NAMES.length, 6);
});
