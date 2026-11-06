// dsh-zhiyun-core-classroom-vault 的验收测试。
//
// 覆盖三件事（其余交给人工）：
//   1. 端口实现度：host-classroom 声明的 7 个方法一个不少，且 apply() 提供
//      `zhiyunClassroomVault` 后 status() 报 ready；
//   2. CRUD 全链路（临时目录）：目录 → 课堂 → 场景 → 资产 → run → 快照 → KV → 删除；
//   3. 两条硬边界：并发写同一课堂不产生半截文件；损坏的 meta.json 读到降级不抛。
//
// 跑法：`node --test tests/classroom-vault.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-core-classroom-vault/', import.meta.url);
const INDEX_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'index.js')).href;
const plugin = await import(INDEX_URL);
const adapterModule = await import(pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'adapter.js')).href);

/** 最小 Cordis 假 ctx（照 tests/classroom-host.test.mjs 的写法）。 */
function makeCtx(profileDir) {
  const provided = new Map();
  const disposers = [];
  const logs = [];
  const ctx = {
    profileContext: profileDir === null ? undefined : { dir: profileDir },
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (service) => provided.get(service),
    provide: (service, value) => {
      provided.set(service, value);
      return () => provided.delete(service);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

async function withProfile(run) {
  const profileDir = await mkdtemp(join(tmpdir(), 'zyc-vault-'));
  try {
    const { ctx, provided, disposers } = makeCtx(profileDir);
    const dispose = plugin.apply(ctx, {});
    const service = provided.get('zhiyunClassroomVault');
    assert.ok(service, 'apply() 必须 provide zhiyunClassroomVault');
    await run({ service, profileDir, ctx, provided, disposers });
    dispose();
    await rm(profileDir, { recursive: true, force: true });
  } catch (error) {
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

const doc = (stageId, scenes) => ({
  stage: { id: stageId, name: `课程 ${stageId}` },
  scenes: scenes.map((scene, index) => ({
    id: scene.id,
    stageId,
    order: scene.order ?? index,
    type: scene.type ?? 'slide',
    content: scene.content ?? { title: scene.id },
  })),
  outline: { outlines: [{ id: 'o1' }] },
  stageMeta: { isPublic: false, generationComplete: true },
});

test('端口实现度：7/7，status 报 ready，数据根落在 profile/data/zhiyun-classroom', async () => {
  await withProfile(async ({ service, profileDir }) => {
    assert.deepEqual(service.ports().methods, [...adapterModule.ADAPTER_METHODS]);
    assert.deepEqual(service.ports().missing, []);
    assert.equal(service.ports().implemented, 7);

    const adapter = service.adapter;
    for (const method of adapterModule.ADAPTER_METHODS) {
      assert.equal(typeof adapter[method], 'function', `端口缺少 ${method}`);
    }
    assert.equal(adapter.kind, 'keyset');
    assert.equal(adapter.ready, true);

    const status = await service.status();
    assert.equal(status.state, 'ready');
    assert.equal(status.detail.root, join(profileDir, 'data', 'zhiyun-classroom'));
    assert.equal(status.detail.counts.classrooms, 0);
  });
});

test('CRUD 全链路：目录 → 课堂 → 场景 → 资产 → run → 快照 → KV → 删除', async () => {
  await withProfile(async ({ service, profileDir }) => {
    const root = join(profileDir, 'data', 'zhiyun-classroom');
    const stageId = 'stage-crud';

    // 文件树
    const folder = await service.folders.create({ name: '线性代数' });
    assert.equal(folder.name, '线性代数');
    assert.equal((await service.folders.list()).length, 1);
    await assert.rejects(() => service.folders.create({ name: '线性代数' }), /同名目录/);

    // 课堂
    const created = await service.classroom.create(doc(stageId, [{ id: 's1' }, { id: 's2' }]));
    assert.equal(created.sceneCount, 2);
    assert.equal(created.rev, 1);
    await service.folders.assign(stageId, folder.id);

    const metaFile = join(root, 'classroom', stageId, 'meta.json');
    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    assert.equal(meta.id, stageId);
    assert.equal(meta.folderId, folder.id);
    // create 写一次（rev=1），folders.assign 再写一次（rev=2）
    assert.equal(meta.rev, 2);
    assert.ok(meta.dslVersion);

    const sceneFiles = await readdir(join(root, 'classroom', stageId, 'scenes'));
    assert.deepEqual(sceneFiles.sort(), ['000000-s1.json', '000001-s2.json']);

    // 读回
    const loaded = await service.classroom.load(stageId);
    assert.equal(loaded.degraded, false);
    assert.deepEqual(loaded.scenes.map((scene) => scene.id), ['s1', 's2']);
    assert.deepEqual(loaded.outline, { outlines: [{ id: 'o1' }] });
    assert.equal(loaded.stageMeta.generationComplete, true);

    // 场景重排：旧文件名必须消失，不能留下两份
    await service.scenes.put(stageId, { id: 's1', order: 9, type: 'slide' });
    const afterReorder = await readdir(join(root, 'classroom', stageId, 'scenes'));
    assert.deepEqual(afterReorder.sort(), ['000001-s2.json', '000009-s1.json']);

    // 保存时删掉 s2
    await service.classroom.save(stageId, doc(stageId, [{ id: 's1', order: 0 }, { id: 's3', order: 1 }]));
    const loaded2 = await service.classroom.load(stageId);
    assert.deepEqual(loaded2.scenes.map((scene) => scene.id), ['s1', 's3']);

    // 资产：字节内容寻址 + 引用保护
    const asset = await service.assets.put({
      stageId, data: Buffer.from('hello-classroom'), mime: 'text/plain', meta: { name: 'a.txt' },
    });
    assert.equal(asset.byteSize, 15);
    assert.deepEqual(await service.assets.bytes(stageId, asset.id), Buffer.from('hello-classroom'));
    await service.assets.addRef({ stageId, scope: 'scene', sceneId: 's1', assetId: asset.id });
    await assert.rejects(() => service.assets.remove(stageId, asset.id), /仍被引用/);
    await service.assets.removeRef({ stageId, scope: 'scene', sceneId: 's1', assetId: asset.id });
    assert.equal(await service.assets.remove(stageId, asset.id), true);

    // run 记录：状态校验、事件 seq 单调、命令幂等
    await service.runs.put({ id: 'run-1', state: 'generating' });
    await assert.rejects(() => service.runs.put({ id: 'run-bad', state: 'nope' }), /未知的 run 状态/);
    const e1 = await service.runs.appendEvent('run-1', { type: 'scene', data: { id: 's1' } });
    const e2 = await service.runs.appendEvent('run-1', { type: 'scene', data: { id: 's2' } });
    assert.deepEqual([e1.seq, e2.seq], [1, 2]);
    assert.equal((await service.runs.get('run-1')).seq, 2);
    assert.equal((await service.runs.events('run-1')).length, 2);
    const c1 = await service.runs.putCommand('run-1', 'cmd-1', 'cancel', { ok: true });
    const c2 = await service.runs.putCommand('run-1', 'cmd-1', 'cancel', { ok: false });
    assert.deepEqual(c1.result, c2.result);
    await service.runs.putStep('run-1', 'step-1', { done: true });
    assert.equal((await service.runs.steps('run-1')).length, 1);

    // 快照：游标在末尾时追加；游标回退时截断游标之后的历史
    const snap1 = await service.snapshots.add(stageId, { index: 0, scenes: [{ id: 's1' }] });
    assert.equal(snap1.length, 1);
    const snap2 = await service.snapshots.add(stageId, { index: 1, scenes: [{ id: 's1' }, { id: 's3' }] });
    assert.equal(snap2.length, 2);
    const snap3 = await service.snapshots.add(stageId, { index: 0, scenes: [{ id: 's1' }], cursor: 0 });
    assert.equal(snap3.length, 2, '游标回退后只保留 0..cursor 再加一份');
    assert.equal((await service.snapshots.list(stageId)).length, 2);

    // KV：scope 分离
    await service.kv.set('theme', 'dark', 'device');
    await service.kv.set('profile', { name: 'zju' }, 'account');
    assert.equal(await service.kv.get('theme', 'device'), 'dark');
    assert.equal(await service.kv.get('theme', 'account'), null);
    assert.deepEqual(await service.kv.keys('', 'device'), ['theme']);
    await assert.rejects(() => service.kv.set('x', 1, 'Device'), /未知的 KV scope/);

    // 素材
    await service.materials.put({ sessionId: 'sess-1', id: 'm1', kind: 'source', title: '讲义' });
    assert.equal((await service.materials.list('sess-1')).length, 1);
    await assert.rejects(() => service.materials.put({ sessionId: 'sess-1', kind: 'nope' }), /未知的素材类型/);

    // 列表分页：3 个课堂一页 2 个
    await service.classroom.create(doc('stage-2', [{ id: 'x1' }]));
    await service.classroom.create(doc('stage-3', [{ id: 'x2' }]));
    const page1 = await service.classroom.list({ limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.next, '还有下一页时必须给游标');
    const page2 = await service.classroom.list({ limit: 2, before: page1.next });
    assert.equal(page1.items.length + page2.items.length, 3);

    // 删除
    assert.equal(await service.classroom.remove(stageId), true);
    assert.equal(await service.classroom.exists(stageId), false);
    // 不存在的课堂是 NOT_FOUND，不是"空课堂" —— 读失败绝不能被当成没有内容
    await assert.rejects(() => service.classroom.load(stageId), /课堂不存在/);
  });
});

test('并发写同一课堂：全部落盘后 meta.json 可解析，场景文件无半截', async () => {
  await withProfile(async ({ service, profileDir }) => {
    const root = join(profileDir, 'data', 'zhiyun-classroom');
    const stageId = 'stage-race';
    await service.classroom.create(doc(stageId, [{ id: 'base' }]));

    const writes = Array.from({ length: 12 }, (_, index) => service.classroom.save(
      stageId,
      doc(stageId, [{ id: 'base', order: 0 }, { id: `s-${index}`, order: 1 }]),
    ));
    const results = await Promise.all(writes);
    assert.equal(results.length, 12);

    // meta.json 永远是完整 JSON（rename 提交，不会读到半截）
    const raw = await readFile(join(root, 'classroom', stageId, 'meta.json'), 'utf8');
    const meta = JSON.parse(raw);
    assert.equal(meta.id, stageId);
    // create 1 次 + 并发 save 12 次 = 13
    assert.ok(meta.rev >= 13, `rev 应随每次写递增，实际 ${meta.rev}`);

    // 目录里每个场景文件都是完整 JSON，且没有残留临时文件
    const files = await readdir(join(root, 'classroom', stageId, 'scenes'));
    assert.ok(files.every((file) => !file.endsWith('.tmp')), `不应残留临时文件：${files.join(',')}`);
    for (const file of files) {
      const row = JSON.parse(await readFile(join(root, 'classroom', stageId, 'scenes', file), 'utf8'));
      assert.equal(row.stageId, stageId);
      assert.equal(typeof row.rev, 'number');
    }
    // 最后一次写赢：meta 的 sceneCount 与磁盘场景文件数一致
    assert.equal(meta.sceneCount, files.length);
  });
});

test('损坏的 meta.json：load 降级不抛，仍能读出场景', async () => {
  await withProfile(async ({ service, profileDir }) => {
    const root = join(profileDir, 'data', 'zhiyun-classroom');
    const stageId = 'stage-broken';
    await service.classroom.create(doc(stageId, [{ id: 's1' }]));

    await writeFile(join(root, 'classroom', stageId, 'meta.json'), '{ this is not json', 'utf8');

    const loaded = await service.classroom.load(stageId);
    assert.equal(loaded.degraded, true);
    assert.equal(loaded.meta, null);
    assert.equal(loaded.errors.length, 1);
    assert.equal(loaded.errors[0].code, 'E_CORRUPT');
    assert.deepEqual(loaded.scenes.map((scene) => scene.id), ['s1']);

    // 端口读同一份坏行也只是"没有这一行"，不抛
    assert.equal(await service.adapter.readOne('document_stages', 'local', stageId), null);

    // 列表照常工作（坏行被跳过，而不是让整页失败）
    const page = await service.classroom.list();
    assert.equal(page.items.length, 0);
  });
});

test('端口语义：rev 乐观锁、键集分页、伪事务提交', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zyc-port-'));
  try {
    let clock = 1000;
    const adapter = adapterModule.createLocalVaultAdapter({ rootDir: dir, now: () => clock++ });
    const owner = 'u1';

    const first = await adapter.upsert('document_folders', owner, { id: 'f1', name: 'A' });
    assert.equal(first.rev, 1);

    const rev = await adapter.updateIfRev('document_folders', owner, 'f1', 1, { name: 'B' });
    assert.equal(rev, 2);
    // 旧 rev 再写一次必须失败（上游 409 的来源）
    assert.equal(await adapter.updateIfRev('document_folders', owner, 'f1', 1, { name: 'C' }), null);
    // 别的 owner 读不到
    assert.equal(await adapter.readOne('document_folders', 'u2', 'f1'), null);

    for (const id of ['f2', 'f3', 'f4']) {
      await adapter.upsert('document_folders', owner, { id, name: id });
    }
    const page1 = await adapter.readPage('document_folders', owner, { limit: 2 });
    assert.equal(page1.rows.length, 2);
    const page2 = await adapter.readPage('document_folders', owner, { limit: 2, before: page1.next });
    assert.equal(page2.rows.length, 2);
    assert.equal(await adapter.count('document_folders', owner), 4);

    const txResult = await adapter.transaction(async (tx) => {
      await tx.upsert('document_folders', owner, { id: 'f5', name: 'E' });
      // 事务内读得到自己未提交的写
      assert.equal((await tx.readOne('document_folders', owner, 'f5')).name, 'E');
      return 'ok';
    });
    assert.equal(txResult, 'ok');
    assert.equal((await adapter.readOne('document_folders', owner, 'f5')).name, 'E');

    // 抛错时不提交
    await assert.rejects(() => adapter.transaction(async (tx) => {
      await tx.upsert('document_folders', owner, { id: 'f6', name: 'F' });
      throw new Error('boom');
    }), /boom/);
    assert.equal(await adapter.readOne('document_folders', owner, 'f6'), null);

    assert.equal(await adapter.remove('document_folders', owner, 'f5'), true);
    assert.equal(await adapter.remove('document_folders', owner, 'f5'), false);

    // 非法 id 不能写出目录外
    await assert.rejects(
      () => adapter.upsert('document_folders', owner, { id: '../../escape', name: 'x' }),
      /路径分隔符/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('没有 profileContext 时 apply 不抛，数据方法给出可读错误', async () => {
  const { ctx, provided } = makeCtx(null);
  const dispose = plugin.apply(ctx, {});
  const service = provided.get('zhiyunClassroomVault');
  assert.ok(service);
  await assert.rejects(() => service.classroom.load('x'), /没有数据根|适配器不可用/);
  dispose();
});

test('损坏的 stage-meta.json 不影响课堂读取', async () => {
  await withProfile(async ({ service, profileDir }) => {
    const root = join(profileDir, 'data', 'zhiyun-classroom');
    const stageId = 'stage-meta-broken';
    await service.classroom.create(doc(stageId, [{ id: 's1' }]));
    await mkdir(join(root, 'classroom', stageId), { recursive: true });
    await writeFile(join(root, 'classroom', stageId, 'stage-meta.json'), 'not-json', 'utf8');
    const loaded = await service.classroom.load(stageId);
    assert.equal(loaded.degraded, false);
    assert.equal(loaded.stageMeta, null);
    assert.equal(loaded.scenes.length, 1);
  });
});
