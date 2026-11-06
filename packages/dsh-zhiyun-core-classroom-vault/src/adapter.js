/**
 * 存储端口（规范第 3 通道）的**本地文件实现**。
 *
 * 源：ref/OpenMAIC/lib/persistence/*.ts（400+ 处 SQL 的语义来源）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:200-262（document_* 表）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/asset/pg.ts:194-248（asset_* 表）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/material/pg.ts:58-88（agent_session_materials）
 *     ref/OpenMAIC/lib/persistence/generation-runs.ts:44-104（generation_run_* 表）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:262-300（rev 触发器语义）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:466-520（readPage 的 ORDER BY）
 *
 * `dsh-zhiyun-host-classroom/src/adapter.js` 只声明了端口；本文件是它的第一个
 * **真实现**：`kind: 'keyset'`、`ready: true`、7 个方法一个不少。
 *
 * 与 PostgreSQL 版本的差异（三条都是文件系统的硬限制，不是偷懒）：
 *
 * 1. **事务不是真事务**。`transaction()` 在进程内串行、把写操作先攒在 overlay 里，
 *    成功后才按顺序逐文件提交；提交到一半失败**不会回滚**已落盘的文件。
 *    上游 `BEGIN … COMMIT` 的多表一致性写因此降级成"顺序提交 + 单文件原子"。
 * 2. **rev 由本层维护**，不靠数据库触发器。语义保持一致：每次写 +1，
 *    `updateIfRev` 传入的 rev 不等于当前值就返回 `null`（业务翻译成 409）。
 * 3. **owner 分区是字段校验，不是目录分区**。本仓是单机单用户桌面应用，
 *    数据根已经是 per-profile 的；跨用户读仍然读不到 —— 每行都带 `ownerId`，
 *    读写在比对失败时按"没有这一行"处理。
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readJson, writeJsonAtomic, listDir, withKeyLock,
} from './fs.js';
import {
  VaultPathError, normalizeTable, rowPath, listIds, splitId, assertSegment,
  dirs, sceneFileName, parseSceneFileName,
} from './paths.js';

/** 端口方法清单（与 `host-classroom/src/adapter.js` 逐字一致）。 */
export const ADAPTER_METHODS = Object.freeze([
  'readOne',
  'readPage',
  'upsert',
  'updateIfRev',
  'remove',
  'count',
  'transaction',
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/**
 * 建一个本地文件适配器。
 *
 * @param {object} deps
 * @param {string} deps.rootDir 存储根（`<profile>/data/zhiyun-classroom`）
 * @param {() => number} [deps.now] 时钟（测试可注入）
 * @param {{warn: Function, debug?: Function}} [deps.logger]
 * @param {number} [deps.pageSize] 默认页大小
 */
export function createLocalVaultAdapter(deps = {}) {
  const { rootDir, now = () => Date.now(), logger = null } = deps;
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new VaultPathError('createLocalVaultAdapter 需要 rootDir');
  }
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const warn = (message, error) => logger?.warn?.(`[classroom-vault] ${message}`, error?.message ?? error ?? '');

  /**
   * 读一行。损坏的 JSON **不抛**：返回 `degraded: true`，由调用方（`classroom.load`）
   * 决定是降级展示还是重建。这是本包最重要的一条边界 —— 一个坏的 meta.json
   * 不该让整个课堂列表打不开。
   */
  async function readRow(table, ownerId, id) {
    const name = normalizeTable(table);
    let path;
    try {
      path = await readPathFor(name, id);
    } catch (error) {
      if (error instanceof VaultPathError) return { row: null, error };
      throw error;
    }
    if (!path) return { row: null, error: null };
    const result = await readJson(path);
    if (!result.ok) {
      if (result.code === 'E_CORRUPT') {
        warn(`存储行损坏，按不存在处理：${path}`);
        return { row: null, error: result, degraded: true };
      }
      if (result.code === 'E_IO') {
        warn(`存储行读取失败，按不存在处理：${path}`, result.error);
        return { row: null, error: result };
      }
      return { row: null, error: null };
    }
    const row = result.value;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      warn(`存储行不是对象，按不存在处理：${path}`);
      return { row: null, error: { code: 'E_CORRUPT' }, degraded: true };
    }
    // owner 是强制的：不匹配就是"没有这一行"，绝不把别人的行交出去。
    if (row.ownerId !== undefined && row.ownerId !== ownerId) return { row: null, error: null };
    return { row, error: null };
  }

  /** 场景的文件名带 order，读之前要先按 id 找到它（order 可能被改过）。 */
  async function readPathFor(table, id) {
    if (table !== 'document_scenes') return rowPath(rootDir, table, id);
    const [stageId, sceneId] = splitId(table, id);
    for (const entry of await listDir(dirs.scenes(rootDir, stageId))) {
      if (!entry.isFile()) continue;
      const parsed = parseSceneFileName(entry.name);
      if (parsed && parsed.id === sceneId) return join(dirs.scenes(rootDir, stageId), entry.name);
    }
    return null;
  }

  /** 写一行（不做 rev 计算，供 upsert 与事务提交共用）。 */
  async function writeRow(table, ownerId, row) {
    const name = normalizeTable(table);
    const id = idOf(name, row);
    const path = name === 'document_scenes'
      ? join(dirs.scenes(rootDir, row.stageId), sceneFileName(row.order, row.id))
      : rowPath(rootDir, name, id);
    await writeJsonAtomic(path, row);
    return { path, row };
  }

  /** 幂等写：同一 (table, owner, id) 覆盖，rev +1，时间戳只在创建时定格。 */
  async function upsertNow(table, ownerId, input) {
    const name = normalizeTable(table);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VaultPathError(`upsert(${name}) 需要一行对象`);
    }
    const id = idOf(name, input);
    const existing = await readRow(name, ownerId, id);
    const previous = existing.row ?? {};
    const createdAt = typeof previous.createdAt === 'number' ? previous.createdAt : Number(input.createdAt ?? now());
    const row = {
      ...previous,
      ...input,
      ownerId,
      rev: Number(previous.rev ?? 0) + 1,
      createdAt,
      updatedAt: Number(input.updatedAt ?? now()),
    };
    // 复合主键的父键永远与 id 一致，不允许行内容与路径打架。
    if (name === 'document_scenes') row.stageId = splitId(name, id)[0];

    const written = await writeRow(name, ownerId, row);
    // 场景的 order 变了 → 旧文件名要删，否则同一 id 会留下两份。
    if (name === 'document_scenes' && existing.row) {
      const previousPath = join(dirs.scenes(rootDir, row.stageId),
        sceneFileName(existing.row.order, existing.row.id));
      if (previousPath !== written.path) await rm(previousPath, { force: true });
    }
    return written.row;
  }

  const port = {
    kind: 'keyset',
    ready: true,
    backend: 'files',
    rootDir,

    async readOne(table, ownerId, id) {
      assertOwner(ownerId);
      const result = await readRow(table, ownerId, id);
      return result.row;
    },

    /**
     * 键集分页：`ORDER BY updated_at DESC, id DESC LIMIT n`。
     * `before` 是本页最后一行的游标（`{ updatedAt, id }` 或 `next` 原样回传）。
     */
    async readPage(table, ownerId, options = {}) {
      assertOwner(ownerId);
      const limit = clampLimit(options.limit ?? pageSize);
      const cursor = decodeCursor(options.before);
      const name = normalizeTable(table);
      const rows = await scanNow(table, ownerId);
      const filtered = cursor
        ? rows.filter((row) => isAfterCursor(row, cursor, name))
        : rows;
      const page = filtered.slice(0, limit);
      const last = page[page.length - 1];
      return {
        rows: page,
        next: last && filtered.length > limit
          ? { updatedAt: last.updatedAt, id: idOf(normalizeTable(table), last) }
          : null,
      };
    },

    async upsert(table, ownerId, row) {
      assertOwner(ownerId);
      const name = normalizeTable(table);
      const id = idOf(name, row);
      return withKeyLock(`row:${name}:${ownerId}:${id}`, () => upsertNow(name, ownerId, row));
    },

    /**
     * 乐观锁：rev 不匹配返回 `null`（**不是**重试）。
     * 上游靠 `WHERE rev=$3` 的 0 行更新表达同一件事，业务把它翻译成 409。
     */
    async updateIfRev(table, ownerId, id, rev, patch) {
      assertOwner(ownerId);
      const name = normalizeTable(table);
      return withKeyLock(`row:${name}:${ownerId}:${id}`, async () => {
        const existing = await readRow(name, ownerId, id);
        if (!existing.row) return null;
        if (Number(existing.row.rev) !== Number(rev)) return null;
        const stored = await upsertNow(name, ownerId, { ...existing.row, ...patch, id });
        return stored.rev;
      });
    },

    /** 删除一行（上游 `DELETE ... WHERE owner_id=$1 AND id=$2`）。 */
    async remove(table, ownerId, id) {
      assertOwner(ownerId);
      const name = normalizeTable(table);
      return withKeyLock(`row:${name}:${ownerId}:${id}`, async () => {
        const existing = await readRow(name, ownerId, id);
        if (!existing.row) return false;
        const path = name === 'document_scenes'
          ? join(dirs.scenes(rootDir, existing.row.stageId), sceneFileName(existing.row.order, existing.row.id))
          : rowPath(rootDir, name, id);
        await rm(path, { force: true });
        return true;
      });
    },

    /** 配额检查用的计数（`SELECT COUNT(*) WHERE owner_id=$1`）。 */
    async count(table, ownerId) {
      assertOwner(ownerId);
      return (await scanNow(table, ownerId)).length;
    },

    /**
     * 伪事务：排他串行 + 写操作暂存 + 顺序提交。
     *
     * `work(tx)` 拿到的 `tx` 形状与端口相同，但读会先看 overlay（读到本事务
     * 尚未提交的写），提交在 `work` 正常返回后进行。**没有回滚**：提交阶段
     * 某个文件写失败时，之前的文件已经落盘 —— 调用方必须把 `transaction`
     * 当作"顺序提交 + 单文件原子"，而不是 PostgreSQL 的 `BEGIN … COMMIT`。
     */
    async transaction(work) {
      if (typeof work !== 'function') throw new VaultPathError('transaction 需要一个函数');
      return withKeyLock(`tx:${rootDir}`, async () => {
        /** @type {Map<string, { removed: boolean, table: string, ownerId: string, id: string, row?: object }>} */
        const overlay = new Map();
        const key = (table, id) => `${normalizeTable(table)}\u0000${id}`;

        const txRead = async (table, ownerId, id) => {
          assertOwner(ownerId);
          const pending = overlay.get(key(table, id));
          if (pending) {
            if (pending.removed) return null;
            return pending.row.ownerId === ownerId ? pending.row : null;
          }
          return readRow(table, ownerId, id).then((result) => result.row);
        };

        const tx = {
          ...port,
          readOne: txRead,
          async readPage(table, ownerId, options = {}) {
            // overlay 读进来太容易写出"半页"语义，所以分页明确**不合并**未提交写：
            // 事务里要列表就自己用 readOne / scan。
            return port.readPage(table, ownerId, options);
          },
          async upsert(table, ownerId, row) {
            assertOwner(ownerId);
            const name = normalizeTable(table);
            const id = idOf(name, row);
            const previous = (await txRead(name, ownerId, id)) ?? {};
            const stored = {
              ...previous,
              ...row,
              ownerId,
              rev: Number(previous.rev ?? 0) + 1,
              createdAt: typeof previous.createdAt === 'number' ? previous.createdAt : Number(row.createdAt ?? now()),
              updatedAt: Number(row.updatedAt ?? now()),
            };
            if (name === 'document_scenes') stored.stageId = splitId(name, id)[0];
            overlay.set(key(name, id), { removed: false, table: name, ownerId, id, row: stored });
            return stored;
          },
          async updateIfRev(table, ownerId, id, rev, patch) {
            const current = await txRead(table, ownerId, id);
            if (!current || Number(current.rev) !== Number(rev)) return null;
            const stored = await tx.upsert(table, ownerId, { ...current, ...patch, id });
            return stored.rev;
          },
          async remove(table, ownerId, id) {
            assertOwner(ownerId);
            const current = await txRead(table, ownerId, id);
            if (!current) return false;
            overlay.set(key(table, id), { removed: true, table: normalizeTable(table), ownerId, id });
            return true;
          },
          async count(table, ownerId) {
            return (await scanNow(table, ownerId)).length;
          },
          async transaction() {
            throw new VaultPathError('不支持嵌套事务');
          },
        };

        const result = await work(tx);
        for (const entry of overlay.values()) {
          if (entry.removed) {
            await port.remove(entry.table, entry.ownerId, entry.id);
          } else {
            // 直接写：rev 已在 overlay 里算好，再 upsert 会重复 +1。
            await removeStaleScene(entry);
            await writeRow(entry.table, entry.ownerId, entry.row);
          }
        }
        return result;
      });
    },

    /**
     * 端口外的扫描辅助（**业务不得依赖**）：返回整张表，已排序。
     * 分页给外面用 `readPage`；内部做 diff（比如保存时算要删哪些场景）需要全量。
     */
    async scan(table, ownerId) {
      assertOwner(ownerId);
      return scanNow(table, ownerId);
    },
  };

  async function removeStaleScene(entry) {
    if (entry.table !== 'document_scenes') return;
    const previous = await readRow(entry.table, entry.ownerId, entry.id);
    if (!previous.row) return;
    const before = join(dirs.scenes(rootDir, previous.row.stageId),
      sceneFileName(previous.row.order, previous.row.id));
    const after = join(dirs.scenes(rootDir, entry.row.stageId),
      sceneFileName(entry.row.order, entry.row.id));
    if (before !== after) await rm(before, { force: true });
  }

  /** 全表扫描 + owner 过滤 + `updated_at DESC, id DESC` 排序。 */
  async function scanNow(table, ownerId) {
    const name = normalizeTable(table);
    const ids = await listIds(rootDir, name);
    const rows = [];
    for (const id of ids) {
      const result = await readRow(name, ownerId, id);
      if (result.row) rows.push(result.row);
    }
    rows.sort((a, b) => {
      const diff = Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0);
      if (diff !== 0) return diff;
      return String(idOf(name, b)).localeCompare(String(idOf(name, a)));
    });
    return rows;
  }

  return port;
}

/** 一行对象的主键。复合表在行里自带各段，拼成 `<父>/<子>`。 */
function idOf(table, row) {
  const name = normalizeTable(table);
  switch (name) {
    case 'document_scenes':
      return `${assertSegment(row.stageId, 'stageId')}/${assertSegment(row.id, 'sceneId')}`;
    case 'asset_entries':
      return `${assertSegment(row.stageId, 'stageId')}/${assertSegment(row.id, 'assetId')}`;
    case 'document_asset_refs':
      return `${assertSegment(row.stageId, 'stageId')}/${assertSegment(row.scope, 'scope')}`
        + `/${assertSegment(row.sceneId, 'sceneId')}/${assertSegment(row.assetId, 'assetId')}`;
    case 'generation_run_steps':
    case 'generation_run_events':
    case 'generation_run_commands':
      return `${assertSegment(row.runId, 'runId')}/${assertSegment(row.id, 'id')}`;
    case 'agent_session_materials':
      return `${assertSegment(row.sessionId, 'sessionId')}/${assertSegment(row.id, 'id')}`;
    default:
      return assertSegment(row.id, 'id');
  }
}

function assertOwner(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    throw new VaultPathError('ownerId 是必填位置参数（上游每个 store 都以 owner_id 为前缀）');
  }
}

function clampLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(numeric), MAX_PAGE_SIZE);
}

function decodeCursor(before) {
  if (before === undefined || before === null) return null;
  if (typeof before === 'object' && typeof before.id === 'string') {
    return { updatedAt: Number(before.updatedAt ?? 0), id: before.id };
  }
  if (typeof before === 'string') {
    const index = before.lastIndexOf(':');
    if (index <= 0) return null;
    return { updatedAt: Number(before.slice(0, index)), id: before.slice(index + 1) };
  }
  return null;
}

function isAfterCursor(row, cursor, table) {
  const updatedAt = Number(row.updatedAt ?? 0);
  const id = String(idOf(table, row));
  if (updatedAt < cursor.updatedAt) return true;
  if (updatedAt > cursor.updatedAt) return false;
  return id < cursor.id;
}

