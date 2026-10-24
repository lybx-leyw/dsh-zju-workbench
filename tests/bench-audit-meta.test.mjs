import test from 'node:test';
import assert from 'node:assert/strict';
import { fold } from '../scripts/knowledge_tree_bench/shared/log-core.mjs';
import { audit } from '../scripts/knowledge_tree_bench/shared/audit.mjs';

test('元信息优先：作业即使标主线和例题，也不误报知识点漏收或孤例', () => {
  const records = [
    { kind: 'event', seq: 1, act: 'mark', subject: 1, data: { role: '主线', facets: ['作业', '例题'] } },
    { kind: 'event', seq: 2, act: 'mark', subject: 2, data: { role: '主线', facets: ['概念'] } },
    { kind: 'event', seq: 3, act: 'regroup', subject: 'n1', data: { blockIds: [2], tok: 10 } },
  ];
  const items = audit(fold(records)).items;
  assert.equal(items.find(i => i.name === '主线覆盖').status, 'pass');
  assert.equal(items.find(i => i.name === '依附有宿主').status, 'pass');
});
