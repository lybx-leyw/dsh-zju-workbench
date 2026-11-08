import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
// 工具实现与注册动作都搬到了 `packages/tool/study`：
//   - `createStudyMaterialTools` 仍是纯函数，用来单测工具行为；
//   - 注册改由包的 `apply(ctx)` 承担，它从 `zhiyunStudy` 服务取 workbench。
import { createStudyMaterialTools } from '../packages/tool/study/src/tools.js';
import * as toolStudy from '../packages/tool/study/src/index.js';

test('real host registry accepts definitions and unregisters every tool', () => {
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools: () => () => {} });
  const registry = new ToolRuntime(ctx, { mode: 'native' });
  const definitions = createStudyMaterialTools({});
  const removers = definitions.map(tool => registry.register(tool));
  for (const tool of definitions) assert.equal(registry.get(tool.name)?.name, tool.name);
  removers.forEach(remove => remove());
  for (const tool of definitions) assert.equal(registry.get(tool.name), undefined);
});

test('optional host injection publishes schemas, executes canonical output and unloads cleanly', async () => {
  const ctx = new Context();
  let promptSchemas;
  ctx.provide('systemPrompt', { tools: callback => { promptSchemas = callback; return () => {}; } });
  // `ToolRuntime` 构造时自己就把 `tools` 服务 provide 出去了 —— 这里不能再 provide 一次
  // （会报 `service "tools" has been registered`）。只需补新包要的 `zhiyunStudy`。
  const registry = new ToolRuntime(ctx, { mode: 'native' });
  const f = fixture();
  ctx.provide('zhiyunStudy', f.workbench);
  const fiber = ctx.plugin(toolStudy);
  try {
    await fiber;
    assert.deepEqual(registry.schemas().map(tool => tool.name).sort(), Object.keys(f.tools).sort());
    assert.deepEqual(promptSchemas({}).schemas.map(tool => tool.name).sort(), Object.keys(f.tools).sort());
    const signal = new AbortController().signal;
    const catalog = await registry.execute({ callId: 'catalog-probe', name: 'study_catalog', arguments: {}, signal });
    assert.equal(catalog.isError, false);
    const value = JSON.parse(catalog.content[0].text);
    const topic = value.items.find(item => item.kind === 'lecture');
    const read = await registry.execute({ callId: 'read-probe', name: 'study_read', arguments: { courseId: 'c', subId: 's', materialId: topic.id }, signal });
    assert.equal(read.isError, false);
    assert.match(read.content[0].text, /a完整推导/);
  } finally { await fiber.dispose(); }
  for (const name of Object.keys(f.tools)) assert.equal(registry.get(name), undefined);
});

test('missing optional registry does not block its parent plugin', async () => {
  const ctx = new Context();
  let loaded = false;
  // 宿主没有 `tools` 服务：本包的 inject 不满足，应当**不激活且不抛**
  // —— 这正是「工具表是附加能力」的契约。
  ctx.provide('zhiyunStudy', {});
  const parent = ctx.plugin({ apply(scope) { scope.plugin(toolStudy); loaded = true; } });
  try { await parent; assert.equal(loaded, true); } finally { await parent.dispose(); }
});

function fixture() {
  let user = { id: 'a' };
  const rows = ['a', 'b'].map(accountId => ({ accountId, courseId: 'c', subId: 's', lecture: { generationVersion: 'architecture-v4', chapters: [{ title: '章节', topics: [{ title: `${accountId}主题`, passages: [{ text: `${accountId}完整推导` }], sourceBlockIndexes: [1] }] }] }, blocks: [{ index: 1, tag: { role: '支线', summary: '补充' }, text: `${accountId}支线全文` }] }));
  const workbench = { ready: Promise.resolve(), user: async () => { if (!user) throw Object.assign(new Error('需要登录'), { code: 'SESSION_EXPIRED' }); return user; }, knowledge: { listByAccount: async ({ accountId }) => rows.filter(r => r.accountId === accountId), get: async ({ accountId, courseId, subId }) => rows.find(r => r.accountId === accountId && r.courseId === courseId && r.subId === subId) } };
  return { tools: Object.fromEntries(createStudyMaterialTools(workbench).map(t => [t.name, t])), switchUser: value => { user = value; }, workbench };
}

test('catalog -> read keeps full topic, source and current-account isolation', async () => {
  const f = fixture();
  const catalog = await f.tools.study_catalog.execute({});
  assert.ok(catalog.items.length >= 2);
  assert.ok(!JSON.stringify(catalog).includes('b主题'));
  const topic = catalog.items.find(r => r.kind === 'lecture');
  assert.equal(topic.content, undefined);
  const read = await f.tools.study_read.execute({ courseId: 'c', subId: 's', materialId: topic.id });
  assert.match(JSON.stringify(read), /a完整推导/);
  const hits = await f.tools.study_search.execute({ query: '完整推导' });
  assert.ok(hits.items.length);
  f.switchUser({ id: 'b' });
  assert.ok(!JSON.stringify(await f.tools.study_catalog.execute({})).includes('a主题'));
  f.switchUser(null);
  await assert.rejects(f.tools.study_catalog.execute({}), { code: 'SESSION_EXPIRED' });
});

test('tools reject bad bounds and paths, honor cancellation, and fail closed on account switch', async () => {
  const f = fixture();
  await assert.rejects(f.tools.study_catalog.execute({ limit: 101 }), { code: 'INPUT' });
  await assert.rejects(f.tools.study_catalog.execute({ courseId: '../other' }), { code: 'INPUT' });
  await assert.rejects(f.tools.study_search.execute({ query: '' }), { code: 'INPUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.tools.study_catalog.execute({}, { signal: controller.signal }));
  const original = f.workbench.knowledge.listByAccount;
  f.workbench.knowledge.listByAccount = async args => { const rows = await original(args); f.switchUser({ id: 'b' }); return rows; };
  await assert.rejects(f.tools.study_catalog.execute({}), { code: 'ACCOUNT_BUSY' });
});

test('untrusted arguments fail closed even through the raw host registry', async () => {
  const f = fixture();
  for (const args of [null, [], 'invalid', { accountId: 'b' }, { filePath: '../private' }]) {
    await assert.rejects(f.tools.study_catalog.execute(args), { code: 'INPUT' });
  }
});

test('cancellation or disposal during final identity check cannot return data', async () => {
  for (const dispose of [false, true]) {
    const f = fixture();
    const controller = new AbortController();
    let checks = 0;
    f.workbench.user = async () => {
      if (++checks === 2) {
        if (dispose) f.workbench.closed = true;
        else controller.abort();
      }
      return { id: 'a' };
    };
    await assert.rejects(f.tools.study_catalog.execute({}, { signal: controller.signal }), dispose ? { code: 'DISPOSED' } : undefined);
  }
});

test('updated content invalidates a previously returned material id', async () => {
  const f = fixture();
  const topic = (await f.tools.study_catalog.execute({})).items.find(r => r.kind === 'lecture');
  const record = await f.workbench.knowledge.get({ accountId: 'a', courseId: 'c', subId: 's' });
  record.lecture.chapters[0].topics[0].passages[0].text = '更新后的内容';
  await assert.rejects(f.tools.study_read.execute({ courseId: 'c', subId: 's', materialId: topic.id }), { code: 'NOT_FOUND' });
});

test('canonical outputs render model-visible text and catalog pagination is explicit', async () => {
  const f = fixture();
  const result = await f.tools.study_catalog.execute({ limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.nextOffset, 1);
  assert.deepEqual(JSON.parse(f.tools.study_catalog.output.render({}, result)[0].text), result);
  assert.equal(f.tools.study_catalog.parameters.additionalProperties, false);
});
