/**
 * `migratePersistedPaths` 的守卫。
 *
 * # 它守的是什么
 *
 * 产品改名（zhiyun → zw）只改了代码里的路径常量，**磁盘上的持久化状态里
 * 还写着旧前缀的绝对路径**。不改的话症状很具体：
 *
 * ```
 * working-directory: directory does not exist:
 *   ...\profiles\zhiyun-bench\data\zhiyun-paper\PsyC
 * ```
 *
 * 打开工作区直接报错，论文页左侧树空白。
 *
 * # 为什么这份测试要测「删记录」而不是只看「改路径」
 *
 * 我第一版实现是**无脑字符串替换**，结果把两条旧记录改成了新记录已有的路径，
 * 宿主拒绝启动：
 *
 * ```
 * workspace domain is inconsistent: path '...\zw-paper\TabPFN'
 *   is claimed by both workspace 'A' and workspace 'B'
 * ```
 *
 * 所以「改名后与已有路径撞车 → 删旧记录」是必须被钉住的行为，
 * 不是实现细节。
 *
 * 第二个坑：删了记录不清 `global.workspaceIds`，宿主报
 * `registry order references missing workspace`，照样起不来。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { migratePersistedPaths } = await import('../../scripts/profile.mjs');

/** 造一个临时 home，带 storages 结构。 */
async function home({ registry = null, sessions = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'zw-migrate-'));
  await mkdir(path.join(root, 'storages', 'session_projcache', 'sessions'), { recursive: true });
  if (registry) await writeFile(path.join(root, 'storages', 'workspace.json'), JSON.stringify(registry, null, 2));
  for (const [name, body] of Object.entries(sessions)) {
    await writeFile(path.join(root, 'storages', 'session_projcache', 'sessions', name), JSON.stringify(body, null, 2));
  }
  return root;
}

/** 读回注册表。 */
const readRegistry = async (root) => JSON.parse(await readFile(path.join(root, 'storages', 'workspace.json'), 'utf8'));

/** 注册表的最小形状：`tables.workspaces` 是记录表，`global.workspaceIds` 是顺序。 */
function registry(rows, order) {
  return {
    unit: { name: 'workspace', version: 1 },
    global: { initialized: true, workspaceIds: order ?? Object.keys(rows) },
    tables: { workspaces: rows },
  };
}

const STALE = 'C:\\proj\\.runtime\\home\\profiles\\zhiyun-bench\\data\\zhiyun-paper\\PsyC';
const FRESH = 'C:\\proj\\.runtime\\home\\profiles\\zju-workbench\\data\\zw-paper\\PsyC';

test('旧前缀的工作区路径被改到新前缀', async () => {
  const root = await home({ registry: registry({ w1: { path: STALE } }) });
  try {
    const result = await migratePersistedPaths(root);
    assert.equal(result.workspaces, 1, '应当改 1 条');
    const doc = await readRegistry(root);
    assert.equal(doc.tables.workspaces.w1.path, FRESH);
    assert.ok(!JSON.stringify(doc).includes('zhiyun'), '不该留旧前缀');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('改名后与已有路径撞车：删旧记录，不产生两条同路径', async () => {
  // 这是第一版实现的 bug：两条记录被改成同一个 path，宿主拒绝启动。
  const root = await home({
    registry: registry({
      old: { path: STALE },
      fresh: { path: FRESH },
    }),
  });
  try {
    const result = await migratePersistedPaths(root);
    const doc = await readRegistry(root);
    const paths = Object.values(doc.tables.workspaces).map((row) => row.path);
    assert.equal(paths.length, 1, '撞车时应当只留一条');
    assert.equal(paths[0], FRESH);
    assert.equal(doc.tables.workspaces.old, undefined, '删的是旧记录');
    assert.ok(doc.tables.workspaces.fresh, '新记录必须留下');
    assert.equal(result.removed, 1);
    // 重复路径是宿主拒绝启动的直接原因，这条断言是关键。
    assert.equal(new Set(paths).size, paths.length, '不允许出现重复路径');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('删记录后索引同步 —— 否则宿主报 references missing workspace', async () => {
  const root = await home({
    registry: registry({ old: { path: STALE }, fresh: { path: FRESH } }, ['old', 'fresh']),
  });
  try {
    await migratePersistedPaths(root);
    const doc = await readRegistry(root);
    const ids = doc.global.workspaceIds;
    const alive = Object.keys(doc.tables.workspaces);
    assert.deepEqual([...ids].sort(), [...alive].sort(), '索引必须与实际记录完全一致');
    assert.ok(!ids.includes('old'), '被删的 id 不能留在索引里');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('已全是新前缀时不写文件（不制造空改动）', async () => {
  const root = await home({ registry: registry({ w1: { path: FRESH } }) });
  try {
    const before = await readFile(path.join(root, 'storages', 'workspace.json'), 'utf8');
    const result = await migratePersistedPaths(root);
    const after = await readFile(path.join(root, 'storages', 'workspace.json'), 'utf8');
    assert.equal(result.workspaces, 0);
    assert.equal(result.removed, 0);
    assert.equal(after, before, '没有旧前缀时一个字节都不该动');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('会话文件的 cwd 也被改；不相关的会话不动', async () => {
  const root = await home({
    sessions: {
      'stale.json': { cwd: STALE, messages: [] },
      'clean.json': { cwd: FRESH, messages: [] },
    },
  });
  try {
    const result = await migratePersistedPaths(root);
    assert.equal(result.sessions, 1, '只有含旧前缀的那个该被改');
    const dir = path.join(root, 'storages', 'session_projcache', 'sessions');
    const stale = JSON.parse(await readFile(path.join(dir, 'stale.json'), 'utf8'));
    assert.equal(stale.cwd, FRESH);
    const clean = JSON.parse(await readFile(path.join(dir, 'clean.json'), 'utf8'));
    assert.equal(clean.cwd, FRESH, '本来干净的也不该变');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('坏掉的注册表不影响启动，只记一条提示', async () => {
  // 一份坏注册表如果被写回，整个产品起不来 —— 比「路径没迁」严重得多。
  const root = await home();
  try {
    await writeFile(path.join(root, 'storages', 'workspace.json'), '{ this is not json zhiyun-paper');
    const result = await migratePersistedPaths(root);
    assert.equal(result.workspaces, 0);
    assert.ok(result.notes.some((note) => /工作区注册表迁移跳过/.test(note)));
    // 原文件必须原样留着，不能被我们写成半截
    const raw = await readFile(path.join(root, 'storages', 'workspace.json'), 'utf8');
    assert.match(raw, /this is not json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('坏掉的单个会话跳过，好的一起改', async () => {
  const root = await home({ sessions: { 'good.json': { cwd: STALE } } });
  try {
    await writeFile(path.join(root, 'storages', 'session_projcache', 'sessions', 'bad.json'), '{broken zhiyun-paper');
    const result = await migratePersistedPaths(root);
    assert.equal(result.sessions, 1, '好的那个继续改');
    const dir = path.join(root, 'storages', 'session_projcache', 'sessions');
    const good = JSON.parse(await readFile(path.join(dir, 'good.json'), 'utf8'));
    assert.equal(good.cwd, FRESH);
    const bad = await readFile(path.join(dir, 'bad.json'), 'utf8');
    assert.match(bad, /broken/, '坏文件原样留着');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('storages 目录整个不存在时安静跳过', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zw-migrate-empty-'));
  try {
    const result = await migratePersistedPaths(root);
    assert.equal(result.workspaces, 0);
    assert.equal(result.sessions, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('认不出的字段原样保留', async () => {
  const root = await home({
    registry: {
      unit: { name: 'workspace', version: 1 },
      global: { initialized: true, workspaceIds: ['w1'], extra: { keep: 'me' } },
      tables: { workspaces: { w1: { path: STALE, name: '我的工作区', createdAt: 123 } } },
    },
  });
  try {
    await migratePersistedPaths(root);
    const doc = await readRegistry(root);
    assert.equal(doc.tables.workspaces.w1.name, '我的工作区', '别的字段不能丢');
    assert.equal(doc.tables.workspaces.w1.createdAt, 123);
    assert.deepEqual(doc.global.extra, { keep: 'me' });
    assert.equal(doc.unit.version, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
