// 生态雷达 · 骨架锁版一致性检查器的单测
//
// 覆盖两类东西：
//   1. 区间解析与相交判定（纯函数，不需要联网）
//   2. 对**真实仓库**跑结构层 / 声明层，确保 67 个骨架不会悄悄退化
//
// 联网层（DEP_MISSING / HOLDOUT_CLASH）不进单测——它们依赖 registry 与 npm 解析器，
// 结论随上游发版而变，属于「每天跑一次」而非「每次提交都跑」的检查。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSkeletons, checkStatic, peerBand, bandsOverlap, pkgName } from '../scripts/radar-baseline-check.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

test('peerBand: ^0.x 只覆盖同 minor（DSH 生态里 0.x 的 ^ 语义）', () => {
  assert.deepEqual(peerBand('^0.2.1-rc.2'), [[[0, 2, 1], [0, 3, 0]]])
  assert.deepEqual(peerBand('^0.1.7-rc.2'), [[[0, 1, 7], [0, 2, 0]]])
})

test('peerBand: || 是 OR，不是「取最大 hi」', () => {
  const b = peerBand('^0.1.1-rc.2 || ^0.1.2-rc.1')
  assert.equal(b.length, 2)
  // 两个分支都以 0.2.0 封顶 —— 这是 r80 前的实现漏掉的那一条
  for (const [, hi] of b) assert.deepEqual(hi, [0, 2, 0])
})

test('peerBand: >=a <b 是 AND', () => {
  assert.deepEqual(peerBand('>=0.2.1-0 <0.3.0-0'), [[[0, 2, 1], [0, 3, 0]]])
  assert.deepEqual(peerBand('>=0.1.0-rc.7 <0.2.2-0'), [[[0, 1, 0], [0, 2, 2]]])
})

test('peerBand: 预发布后缀不参与比较', () => {
  assert.deepEqual(peerBand('0.2.1-rc.2'), [[[0, 2, 1], [0, 2, 2]]])
})

test('peerBand: 无法解析返回 null（不上报，避免误报）', () => {
  assert.equal(peerBand('latest'), null)
  assert.equal(peerBand('>=0.2.1-0 <0.3.0-0 || next'), null)
  assert.equal(peerBand(undefined), null)
})

test('bandsOverlap: 与 npm 实装矩阵一致的 6 个已知案例', () => {
  const cases = [
    ['^0.1.1-rc.2 || ^0.1.2-rc.1', '^0.2.1-rc.2', false], // evolve-modes ⟂ llm-fallbacks
    ['^0.2.1-rc.2', '>=0.2.0-rc.2 <0.3.0', true],
    ['>=0.1.0-rc.7 <0.2.2-0', '>=0.1.5-rc.2 <0.3.0', true], // lowtide × auto-memory 区间确实相交
    ['^0.1.0-rc.5', '^0.1.0-rc.8', true],
    ['>=0.2.1-0 <0.3.0-0', '>=0.1.0-rc.7 <0.2.2-0', true],
    ['^0.1.7-rc.2', '>=0.2.0-rc.2 <0.3.0', false], // context ⟂ llm-fallbacks
  ]
  for (const [a, b, expected] of cases) {
    assert.equal(bandsOverlap(peerBand(a), peerBand(b)), expected, `${a} × ${b}`)
  }
})

test('pkgName: scoped 包不会被切成空串', () => {
  assert.equal(pkgName('@xiaoso/dsh-tool-plus@0.1.14'), '@xiaoso/dsh-tool-plus')
  assert.equal(pkgName('dsh-kb-rag@1.6.8'), 'dsh-kb-rag')
})

test('checkStatic: 真实仓库里的 67 个骨架全部通过结构与声明检查', async () => {
  const skeletons = await listSkeletons(ROOT)
  assert.ok(skeletons.length >= 60, `骨架数异常：${skeletons.length}`)
  const findings = checkStatic(skeletons)
  assert.deepEqual(findings, [], findings.map((f) => f.message).join('\n'))
})

test('checkStatic: 能抓出「不锁版」与「缺声明」', async () => {
  const fake = [{
    name: 'dsh-radar-fake',
    pkg: { dependencies: { 'left-pad': '^1.0.0' } },
    readme: '# fake\n\n一个普通说明。',
  }]
  const codes = checkStatic(fake).map((f) => f.code).sort()
  assert.deepEqual(codes, ['MISSING_DISCLAIMER', 'NOT_PINNED'])
})
