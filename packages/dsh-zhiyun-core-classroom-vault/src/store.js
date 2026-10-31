/**
 * 领域层：classroom / run / 素材资产 / 文件树 / 快照 / KV 的读写语义。
 *
 * 源：ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:600-760（saveDocument 的 diff 语义）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:466-520（listDocuments 键集分页）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/document/adapter.ts:28-70（split/reassemble）
 *     ref/OpenMAIC/lib/persistence/generation-runs.ts:1-104（run 四张表）
 *     ref/OpenMAIC/lib/persistence/stage-meta.ts:8-45（stage_meta）
 *     ref/OpenMAIC/lib/persistence/owner-assets.ts:1-80（principal 分区语义）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/asset/pg.ts:194-248（asset_entries / refs）
 *     ref/OpenMAIC/lib/store/snapshot.ts:38-120（快照游标与 20 条上限）
 *     ref/OpenMAIC/lib/store/kv-persist.ts:1-60（KV scope 不得混用）
 *
 * 这一层只做**语义**：校验、主键拼接、diff、游标。落盘一律经 `adapter`，
 * 二进制与目录级操作（blob、整课堂删除）才直接碰文件系统 —— 与规范第 3 通道
 * 「适配层单独一个文件，不许在业务里散写 IO」的边界一致。
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic, writeJsonAtomic, readJson, listDir, withKeyLock, withFileLock } from './fs.js';
import { dirs, assertSegment, sceneFileName, parseSceneFileName } from './paths.js';

/** DSL 版本戳的位置（上游 `DSL_VERSION_KEY`）：写在 meta.json 根上。 */
export const DSL_VERSION_KEY = 'dslVersion';
export const DSL_VERSION = '1.0.0';

/** 上游 `generation_runs_state_known` 的 CHECK 约束。 */
export const RUN_STATES = Object.freeze([
  'preparing', 'outlining', 'awaiting_outline_confirmation',
  'generating', 'paused', 'completed', 'ended',
]);

/** 上游 `agent_session_materials_kind_known` / `..._extraction_status_known`。 */
export const MATERIAL_KINDS = Object.freeze(['source', 'extraction', 'transcript', 'audio-track', 'image', 'web']);
export const MATERIAL_EXTRACTION_STATUS = Object.freeze(['idle', 'pending', 'running', 'done', 'failed']);

/** 上游 `document_asset_refs.scope` 的 CHECK 约束。 */
export const ASSET_REF_SCOPES = Object.freeze(['stage', 'scene']);

/** `kv/types.ts` 的两个 scope；`device` 永不出本机。 */
export const KV_SCOPES = Object.freeze(['account', 'device']);

export class VaultError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * @param {object} options
 * @param {string} options.rootDir
 * @param {object} options.adapter 见 `adapter.js`
 * @param {string} [options.ownerId] 单机单用户下的 owner 分区键
 */
export function createVaultStore(options) {
  const { rootDir, adapter } = options;
  const ownerId = options.ownerId ?? 'local';
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? null;
  const snapshotLimit = options.snapshotLimit ?? 20;
  const warn = (message, error) => logger?.warn?.(`[classroom-vault] ${message}`, error?.message ?? error ?? '');

  const stageKey = (id) => `stage:${assertSegment(id, 'classroom id')}`;

  // ── classroom ────────────────────────────────────────────────────────────

  const classroom = {
    /** 键集分页的课堂列表；只读 meta.json，不解码场景。 */
    async list(params = {}) {
      const page = await adapter.readPage('document_stages', ownerId, {
        limit: params.limit,
        before: params.before,
      });
      return {
        items: page.rows.map(summaryOf),
        next: page.next,
      };
    },

    /**
     * 读一份课堂。**损坏的 meta.json 不抛**：返回 `degraded: true` 与错误清单，
     * 场景/资产能读到多少给多少 —— 页面据此显示「部分内容损坏」，而不是白屏。
     */
    async load(id, params = {}) {
      const stageId = assertSegment(id, 'classroom id');
      const errors = [];
      const metaFile = join(dirs.classroomOne(rootDir, stageId), 'meta.json');
      const parsed = await readJson(metaFile);
      let meta = null;
      if (!parsed.ok) {
        if (parsed.code === 'ENOENT') {
          // 「读不到」不能当成「是空的」：课堂不存在就明确报 NOT_FOUND，
          // 否则页面会拿一份空文档覆盖一个只是暂时读不到的课堂。
          const dirExists = await stat(dirs.classroomOne(rootDir, stageId)).then(() => true, () => false);
          if (!dirExists) {
            throw new VaultError('E_NOT_FOUND', `课堂不存在：${stageId}`, { id: stageId });
          }
          errors.push({ file: metaFile, code: 'E_MISSING_META', message: '课堂目录存在但 meta.json 缺失' });
        } else if (parsed.code === 'E_CORRUPT') {
          errors.push({ file: metaFile, code: 'E_CORRUPT', message: 'meta.json 不是合法 JSON' });
        } else if (parsed.code === 'E_IO') {
          errors.push({ file: metaFile, code: 'E_IO', message: parsed.error?.message });
        }
      } else if (!parsed.value || typeof parsed.value !== 'object') {
        errors.push({ file: metaFile, code: 'E_CORRUPT', message: 'meta.json 不是对象' });
      } else if (parsed.value.ownerId !== undefined && parsed.value.ownerId !== ownerId) {
        errors.push({ file: metaFile, code: 'E_FORBIDDEN', message: '课堂属于另一个 owner' });
      } else {
        meta = parsed.value;
      }

      const scenes = (await adapter.scan('document_scenes', ownerId))
        .filter((scene) => scene.stageId === stageId)
        .sort((a, b) => Number(a.order) - Number(b.order));
      const outlineRow = await adapter.readOne('document_outlines', ownerId, stageId);
      const stageMeta = await adapter.readOne('stage_meta', ownerId, stageId);
      const assets = await assetsOf(stageId);
      const refs = (await adapter.scan('document_asset_refs', ownerId))
        .filter((row) => row.stageId === stageId);

      return {
        id: stageId,
        meta,
        stage: meta,
        stageMeta: stageMeta ?? null,
        scenes,
        outline: outlineRow?.outline ?? null,
        assets,
        assetRefs: refs,
        degraded: errors.length > 0,
        errors,
      };
    },

    async meta(id) {
      return adapter.readOne('document_stages', ownerId, id);
    },

    async exists(id) {
      try {
        await stat(join(dirs.classroomOne(rootDir, assertSegment(id, 'classroom id')), 'meta.json'));
        return true;
      } catch {
        return false;
      }
    },

    /** 新建：id 可给可不给；已存在则拒绝（create 与 save 的语义差别就在这）。 */
    async create(doc = {}) {
      const stageId = doc.id ?? doc.stage?.id ?? randomUUID();
      if (await classroom.exists(stageId)) {
        throw new VaultError('E_CONFLICT', `课堂已存在：${stageId}`, { id: stageId });
      }
      return classroom.save(stageId, { ...doc, stage: { ...(doc.stage ?? {}), id: stageId } });
    },

    /**
     * 整份保存（上游 `saveDocument` 的 diff 语义：只写变化的子项）。
     *
     * 写入顺序刻意是「场景 → outline → meta → 删多余场景」：
     * 读者只可能看到旧的 meta（旧场景集）或新的 meta（新场景集），
     * 中间态里场景集合永远是旧集合的超集，不会引用到已删的文件。
     */
    async save(id, doc = {}, params = {}) {
      const stageId = assertSegment(id ?? doc.stage?.id, 'classroom id');
      return withKeyLock(stageKey(stageId), () => withFileLock(
        join(dirs.classroomOne(rootDir, stageId), '.write'),
        async () => {
          const existing = await adapter.readOne('document_stages', ownerId, stageId);
          if (params.expectedRev !== undefined && params.expectedRev !== null) {
            const currentRev = Number(existing?.rev ?? 0);
            if (currentRev !== Number(params.expectedRev)) {
              throw new VaultError('E_CONFLICT', `课堂已被别处修改（期望 rev ${params.expectedRev}，实际 ${currentRev}）`,
                { id: stageId, expectedRev: Number(params.expectedRev), actualRev: currentRev });
            }
          }

          const scenes = normalizeScenes(stageId, doc.scenes ?? []);
          for (const scene of scenes) {
            await adapter.upsert('document_scenes', ownerId, scene);
          }

          if (doc.outline !== undefined) {
            await adapter.upsert('document_outlines', ownerId, { id: stageId, outline: doc.outline });
          }
          if (doc.stageMeta !== undefined) {
            await adapter.upsert('stage_meta', ownerId, { ...doc.stageMeta, id: stageId, stageId });
          }

          const stage = {
            ...(existing ?? {}),
            ...(doc.stage ?? {}),
            id: stageId,
            name: doc.stage?.name ?? existing?.name ?? stageId,
            folderId: doc.stage?.folderId ?? existing?.folderId ?? null,
            sceneCount: scenes.length,
            dslVersion: doc[DSL_VERSION_KEY] ?? existing?.[DSL_VERSION_KEY] ?? DSL_VERSION,
            createdAt: existing?.createdAt ?? now(),
            updatedAt: now(),
          };
          // 主键字段不允许被 doc.stage 覆盖成别的值。
          stage.id = stageId;
          delete stage.rev;
          delete stage.ownerId;
          const stored = await adapter.upsert('document_stages', ownerId, stage);

          // 删掉不再存在的场景（在上面的写入之后，保证读者不会看到悬空引用）。
          const keep = new Set(scenes.map((scene) => scene.id));
          const stale = (await adapter.scan('document_scenes', ownerId))
            .filter((scene) => scene.stageId === stageId && !keep.has(scene.id));
          for (const scene of stale) {
            await adapter.remove('document_scenes', ownerId, `${stageId}/${scene.id}`);
          }

          return { id: stageId, rev: stored.rev, sceneCount: scenes.length, removed: stale.length };
        },
        { waitMs: options.lockWaitMs ?? 5000 },
      ));
    },

    /** 删除整个课堂目录（含场景、资产、快照）。上游是 `ON DELETE CASCADE`。 */
    async remove(id) {
      const stageId = assertSegment(id, 'classroom id');
      return withKeyLock(stageKey(stageId), async () => {
        if (!(await classroom.exists(stageId))) return false;
        await rm(dirs.classroomOne(rootDir, stageId), { recursive: true, force: true });
        return true;
      });
    },
  };

  // ── scene（单独读写，供编辑器逐页保存）──────────────────────────────────

  const scenes = {
    async list(stageId) {
      return (await adapter.scan('document_scenes', ownerId))
        .filter((scene) => scene.stageId === assertSegment(stageId, 'stageId'))
        .sort((a, b) => Number(a.order) - Number(b.order));
    },

    async get(stageId, sceneId) {
      return adapter.readOne('document_scenes', ownerId,
        `${assertSegment(stageId, 'stageId')}/${assertSegment(sceneId, 'sceneId')}`);
    },

    async put(stageId, scene) {
      const row = normalizeScenes(assertSegment(stageId, 'stageId'), [scene])[0];
      return adapter.upsert('document_scenes', ownerId, row);
    },

    async remove(stageId, sceneId) {
      return adapter.remove('document_scenes', ownerId,
        `${assertSegment(stageId, 'stageId')}/${assertSegment(sceneId, 'sceneId')}`);
    },
  };

  // ── 文件树（document_folders）────────────────────────────────────────────

  const folders = {
    async list() {
      const rows = await adapter.scan('document_folders', ownerId);
      return rows.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    },

    async get(id) {
      return adapter.readOne('document_folders', ownerId, id);
    },

    /** 建目录。上游是「同一事务里判重 + 插入」：这里靠 owner 级串行锁表达。 */
    async create(input = {}) {
      const name = normalizeFolderName(input.name);
      return withKeyLock(`folders:${ownerId}`, async () => {
        const all = await adapter.scan('document_folders', ownerId);
        const normalizedName = name.toLowerCase();
        if (all.some((folder) => folder.normalizedName === normalizedName)) {
          throw new VaultError('E_CONFLICT', `同名目录已存在：${name}`, { name });
        }
        const order = all.reduce((max, folder) => Math.max(max, Number(folder.order ?? 0)), 0) + 1;
        return adapter.upsert('document_folders', ownerId, {
          id: input.id ?? randomUUID(),
          name,
          normalizedName,
          order,
          createdAt: now(),
          updatedAt: now(),
        });
      });
    },

    async rename(id, name) {
      const normalizedName = normalizeFolderName(name).toLowerCase();
      const current = await adapter.readOne('document_folders', ownerId, id);
      if (!current) throw new VaultError('E_NOT_FOUND', `目录不存在：${id}`, { id });
      return adapter.upsert('document_folders', ownerId, {
        ...current, name, normalizedName, updatedAt: now(),
      });
    },

    /** 删目录：课堂不跟着删（上游文件夹与课堂是松引用），只把 folderId 清空。 */
    async remove(id) {
      const removed = await adapter.remove('document_folders', ownerId, id);
      if (!removed) return false;
      const affected = (await adapter.scan('document_stages', ownerId))
        .filter((stage) => stage.folderId === id);
      for (const stage of affected) {
        await adapter.upsert('document_stages', ownerId, { ...stage, folderId: null, updatedAt: now() });
      }
      return true;
    },

    /** 把课堂挪进/挪出目录（`null` = 未归档）。 */
    async assign(stageId, folderId) {
      const stage = await adapter.readOne('document_stages', ownerId, stageId);
      if (!stage) throw new VaultError('E_NOT_FOUND', `课堂不存在：${stageId}`, { id: stageId });
      if (folderId !== null && !(await adapter.readOne('document_folders', ownerId, folderId))) {
        throw new VaultError('E_NOT_FOUND', `目录不存在：${folderId}`, { id: folderId });
      }
      return adapter.upsert('document_stages', ownerId, { ...stage, folderId, updatedAt: now() });
    },
  };

  // ── generation runs（四张表）─────────────────────────────────────────────

  const runs = {
    async put(run = {}) {
      const id = assertSegment(run.id ?? randomUUID(), 'runId');
      if (run.state !== undefined && !RUN_STATES.includes(run.state)) {
        throw new VaultError('E_INVALID_INPUT', `未知的 run 状态：${String(run.state)}`, { state: run.state });
      }
      return adapter.upsert('generation_runs', ownerId, {
        ...run,
        id,
        state: run.state ?? 'preparing',
        seq: Number(run.seq ?? 0),
        createdAt: run.createdAt ?? now(),
        updatedAt: now(),
      });
    },

    async get(id) {
      return adapter.readOne('generation_runs', ownerId, id);
    },

    async list(params = {}) {
      let rows = await adapter.scan('generation_runs', ownerId);
      if (params.state) {
        const states = Array.isArray(params.state) ? params.state : [params.state];
        rows = rows.filter((row) => states.includes(row.state));
      }
      const limit = Math.min(Number(params.limit ?? 50) || 50, 500);
      return rows.slice(0, limit);
    },

    async patch(id, patch = {}) {
      const current = await adapter.readOne('generation_runs', ownerId, id);
      if (!current) throw new VaultError('E_NOT_FOUND', `run 不存在：${id}`, { id });
      if (patch.state !== undefined && !RUN_STATES.includes(patch.state)) {
        throw new VaultError('E_INVALID_INPUT', `未知的 run 状态：${String(patch.state)}`, { state: patch.state });
      }
      return adapter.upsert('generation_runs', ownerId, { ...current, ...patch, id, updatedAt: now() });
    },

    async remove(id) {
      const runId = assertSegment(id, 'runId');
      return withKeyLock(`run:${runId}`, async () => {
        if (!(await adapter.readOne('generation_runs', ownerId, runId))) return false;
        await rm(dirs.runOne(rootDir, runId), { recursive: true, force: true });
        return true;
      });
    },

    /** 追加事件：`seq` 由存储分配（上游 `run row 的 seq 是最后分配的那个`）。 */
    async appendEvent(runId, event = {}) {
      const id = assertSegment(runId, 'runId');
      return withKeyLock(`run:${id}`, async () => {
        const run = await adapter.readOne('generation_runs', ownerId, id);
        if (!run) throw new VaultError('E_NOT_FOUND', `run 不存在：${id}`, { id });
        const seq = Number(run.seq ?? 0) + 1;
        const row = await adapter.upsert('generation_run_events', ownerId, {
          runId: id,
          id: String(seq),
          seq,
          ts: Number(event.ts ?? now()),
          type: String(event.type ?? 'event'),
          data: event.data ?? null,
        });
        await adapter.upsert('generation_runs', ownerId, { ...run, seq, updatedAt: now() });
        return row;
      });
    },

    async events(runId, params = {}) {
      const after = Number(params.after ?? 0);
      const limit = Math.min(Number(params.limit ?? 200) || 200, 1000);
      return (await adapter.scan('generation_run_events', ownerId))
        .filter((row) => row.runId === runId && Number(row.seq) > after)
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .slice(0, limit);
    },

    async putStep(runId, stepId, output) {
      return adapter.upsert('generation_run_steps', ownerId, {
        runId: assertSegment(runId, 'runId'),
        id: assertSegment(stepId, 'stepId'),
        output: output ?? null,
        completedAt: now(),
      });
    },

    async steps(runId) {
      return (await adapter.scan('generation_run_steps', ownerId))
        .filter((row) => row.runId === runId)
        .sort((a, b) => Number(a.completedAt ?? 0) - Number(b.completedAt ?? 0));
    },

    /** 幂等命令：重复的 commandId 返回第一次的结果（上游 `generation_run_commands`）。 */
    async putCommand(runId, commandId, type, result) {
      const id = assertSegment(runId, 'runId');
      const command = assertSegment(commandId, 'commandId');
      return withKeyLock(`run:${id}`, async () => {
        const existing = await adapter.readOne('generation_run_commands', ownerId, `${id}/${command}`);
        if (existing) return existing;
        return adapter.upsert('generation_run_commands', ownerId, {
          runId: id, id: command, type: String(type ?? 'command'), result: result ?? null, createdAt: now(),
        });
      });
    },

    async command(runId, commandId) {
      return adapter.readOne('generation_run_commands', ownerId,
        `${assertSegment(runId, 'runId')}/${assertSegment(commandId, 'commandId')}`);
    },
  };

  // ── 素材 / 资产（asset_entries + asset_blobs + document_asset_refs）──────

  async function assetsOf(stageId) {
    return (await adapter.scan('asset_entries', ownerId))
      .filter((row) => row.stageId === stageId)
      .map(({ ownerId: _owner, ...entry }) => entry);
  }

  const assets = {
    /**
     * 落一份资产：字节进内容寻址的 blob，元数据进 entry。
     * `data` 接受 Buffer / Uint8Array / string；同名内容只存一份。
     */
    async put(input = {}) {
      const stageId = assertSegment(input.stageId, 'stageId');
      const bytes = toBuffer(input.data);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const blobPath = join(dirs.assetBlobs(rootDir, stageId), contentHash);
      const blobExists = await readFile(blobPath).then(() => true, () => false);
      if (!blobExists) await writeFileAtomic(blobPath, bytes);
      const entry = await adapter.upsert('asset_entries', ownerId, {
        stageId,
        id: input.id ?? randomUUID(),
        contentHash,
        byteSize: bytes.byteLength,
        mime: input.mime ?? 'application/octet-stream',
        meta: input.meta ?? {},
        revision: 1,
        createdAt: now(),
      });
      return { ...entry, ownerId: undefined };
    },

    async get(stageId, assetId) {
      return adapter.readOne('asset_entries', ownerId,
        `${assertSegment(stageId, 'stageId')}/${assertSegment(assetId, 'assetId')}`);
    },

    async bytes(stageId, assetId) {
      const entry = await assets.get(stageId, assetId);
      if (!entry) throw new VaultError('E_NOT_FOUND', `资产不存在：${assetId}`, { id: assetId });
      return readFile(join(dirs.assetBlobs(rootDir, stageId), entry.contentHash));
    },

    async list(stageId) {
      return assetsOf(stageId);
    },

    /**
     * 删除资产。被 `document_asset_refs` 引用的资产**不许删**（上游
     * `AssetRootedError` 的同一条纪律：否则正在用的媒体会静默消失）。
     */
    async remove(stageId, assetId) {
      const id = `${assertSegment(stageId, 'stageId')}/${assertSegment(assetId, 'assetId')}`;
      const entry = await adapter.readOne('asset_entries', ownerId, id);
      if (!entry) return false;
      const refs = (await adapter.scan('document_asset_refs', ownerId))
        .filter((row) => row.stageId === stageId && row.assetId === assetId);
      if (refs.length > 0) {
        throw new VaultError('E_REFERENCED', `资产仍被引用，不能删除：${assetId}`,
          { id: assetId, refs: refs.length });
      }
      await adapter.remove('asset_entries', ownerId, id);
      const stillUsed = (await adapter.scan('asset_entries', ownerId))
        .some((row) => row.stageId === stageId && row.contentHash === entry.contentHash);
      if (!stillUsed) await rm(join(dirs.assetBlobs(rootDir, stageId), entry.contentHash), { force: true });
      return true;
    },

    async addRef(input = {}) {
      const scope = String(input.scope ?? 'scene');
      if (!ASSET_REF_SCOPES.includes(scope)) {
        throw new VaultError('E_INVALID_INPUT', `未知的引用 scope：${scope}`, { scope });
      }
      return adapter.upsert('document_asset_refs', ownerId, {
        stageId: assertSegment(input.stageId, 'stageId'),
        scope,
        sceneId: assertSegment(input.sceneId ?? input.stageId, 'sceneId'),
        assetId: assertSegment(input.assetId, 'assetId'),
      });
    },

    async removeRef(input = {}) {
      return adapter.remove('document_asset_refs', ownerId,
        `${assertSegment(input.stageId, 'stageId')}/${assertSegment(input.scope ?? 'scene', 'scope')}`
        + `/${assertSegment(input.sceneId ?? input.stageId, 'sceneId')}/${assertSegment(input.assetId, 'assetId')}`);
    },

    async refs(stageId) {
      return (await adapter.scan('document_asset_refs', ownerId))
        .filter((row) => row.stageId === stageId);
    },
  };

  // ── 会话素材（agent_session_materials）─────────────────────────────────

  const materials = {
    async put(input = {}) {
      const sessionId = assertSegment(input.sessionId, 'sessionId');
      const kind = String(input.kind ?? 'source');
      if (!MATERIAL_KINDS.includes(kind)) {
        throw new VaultError('E_INVALID_INPUT', `未知的素材类型：${kind}`, { kind });
      }
      const status = String(input.extractionStatus ?? 'done');
      if (!MATERIAL_EXTRACTION_STATUS.includes(status)) {
        throw new VaultError('E_INVALID_INPUT', `未知的提取状态：${status}`, { extractionStatus: status });
      }
      return adapter.upsert('agent_session_materials', ownerId, {
        ...input,
        sessionId,
        id: input.id ?? randomUUID(),
        kind,
        extractionStatus: status,
        textChars: Number(input.textChars ?? 0),
        extractionAttempts: Number(input.extractionAttempts ?? 0),
        createdAt: input.createdAt ?? now(),
        updatedAt: now(),
      });
    },

    async get(sessionId, materialId) {
      return adapter.readOne('agent_session_materials', ownerId,
        `${assertSegment(sessionId, 'sessionId')}/${assertSegment(materialId, 'materialId')}`);
    },

    async list(sessionId) {
      return (await adapter.scan('agent_session_materials', ownerId))
        .filter((row) => row.sessionId === sessionId);
    },

    async remove(sessionId, materialId) {
      return adapter.remove('agent_session_materials', ownerId,
        `${assertSegment(sessionId, 'sessionId')}/${assertSegment(materialId, 'materialId')}`);
    },
  };

  // ── 快照（lib/store/snapshot.ts 的 undo/redo 历史）───────────────────────

  const snapshots = {
    async list(stageId) {
      const dir = dirs.snapshots(rootDir, assertSegment(stageId, 'stageId'));
      const entries = [];
      for (const entry of await listDir(dir)) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const parsed = await readJson(join(dir, entry.name));
        if (parsed.ok && parsed.value && typeof parsed.value === 'object') entries.push(parsed.value);
      }
      return entries.sort((a, b) => Number(a.seq) - Number(b.seq));
    },

    async get(stageId, seq) {
      const path = join(dirs.snapshots(rootDir, assertSegment(stageId, 'stageId')), `${Number(seq)}.json`);
      const parsed = await readJson(path);
      return parsed.ok ? parsed.value : null;
    },

    /**
     * 加一份快照。照上游：游标不在末尾时先删掉游标之后的历史；
     * 超过上限（默认 20）删最老的一份。
     *
     * 未落：上游还会把倒数第二份快照的 `index` 改成当前场景（PPTist 的翻页焦点
     * 修正，`lib/store/snapshot.ts:74-81`）—— 那是 UI 焦点语义，不在持久层做。
     */
    async add(stageId, snapshot = {}) {
      const id = assertSegment(stageId, 'stageId');
      return withKeyLock(`snapshots:${id}`, async () => {
        const all = await snapshots.list(id);
        const cursor = snapshot.cursor === undefined ? all.length - 1 : Number(snapshot.cursor);
        if (cursor >= 0 && cursor < all.length - 1) {
          for (const stale of all.slice(cursor + 1)) {
            await rm(join(dirs.snapshots(rootDir, id), `${Number(stale.seq)}.json`), { force: true });
          }
        }
        let kept = cursor >= 0 ? all.slice(0, cursor + 1) : [];
        while (kept.length >= snapshotLimit) {
          const oldest = kept.shift();
          await rm(join(dirs.snapshots(rootDir, id), `${Number(oldest.seq)}.json`), { force: true });
        }
        const seq = all.reduce((max, item) => Math.max(max, Number(item.seq ?? 0)), 0) + 1;
        const row = {
          seq,
          index: Number(snapshot.index ?? 0),
          scenes: snapshot.scenes ?? [],
          createdAt: now(),
        };
        await writeJsonAtomic(join(dirs.snapshots(rootDir, id), `${seq}.json`), row);
        return { cursor: kept.length, length: kept.length + 1, snapshot: row };
      });
    },

    async prune(stageId, limit = snapshotLimit) {
      const id = assertSegment(stageId, 'stageId');
      return withKeyLock(`snapshots:${id}`, async () => {
        const all = await snapshots.list(id);
        const excess = all.length - limit;
        for (const stale of all.slice(0, Math.max(0, excess))) {
          await rm(join(dirs.snapshots(rootDir, id), `${Number(stale.seq)}.json`), { force: true });
        }
        return Math.max(0, excess);
      });
    },

    async clear(stageId) {
      const id = assertSegment(stageId, 'stageId');
      const dir = dirs.snapshots(rootDir, id);
      const all = await snapshots.list(id);
      for (const row of all) await rm(join(dir, `${Number(row.seq)}.json`), { force: true });
      return all.length;
    },
  };

  // ── KV（zustand persist 的小键值；scope 固定两值）────────────────────────

  const kv = {
    async get(key, scope = 'account') {
      const file = kvPath(key, scope);
      const parsed = await readJson(file);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return null;
      return parsed.value.value ?? null;
    },

    async set(key, value, scope = 'account') {
      const file = kvPath(key, scope);
      await writeJsonAtomic(file, { key: String(key), scope: assertScope(scope), value, updatedAt: now() });
      return true;
    },

    async remove(key, scope = 'account') {
      const file = kvPath(key, scope);
      const existed = await readFile(file).then(() => true, () => false);
      if (existed) await rm(file, { force: true });
      return existed;
    },

    async keys(prefix = '', scope = 'account') {
      const dir = dirs.kv(rootDir, assertScope(scope));
      const out = [];
      for (const entry of await listDir(dir)) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const parsed = await readJson(join(dir, entry.name));
        if (!parsed.ok || typeof parsed.value?.key !== 'string') continue;
        if (parsed.value.key.startsWith(prefix)) out.push(parsed.value.key);
      }
      return out.sort();
    },
  };

  function kvPath(key, scope) {
    const text = String(key ?? '');
    if (text.length === 0) throw new VaultError('E_INVALID_INPUT', 'KV key 不能为空');
    const hash = createHash('sha256').update(text).digest('hex');
    return join(dirs.kv(rootDir, assertScope(scope)), `${hash}.json`);
  }

  function assertScope(scope) {
    if (!KV_SCOPES.includes(scope)) {
      throw new VaultError('E_INVALID_INPUT', `未知的 KV scope：${String(scope)}`, { scope });
    }
    return scope;
  }

  return { ownerId, rootDir, adapter, classroom, scenes, folders, runs, assets, materials, snapshots, kv };
}

/** 课堂摘要（上游 `DocumentSummary`）：列表页不解码场景内容。 */
function summaryOf(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    folderId: row.folderId ?? undefined,
    sceneCount: Number(row.sceneCount ?? 0),
    dslVersion: row[DSL_VERSION_KEY],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rev: row.rev,
  };
}

/** 场景归一化：`order` 必须是有限数字，`id`/`stageId` 必须一致。 */
function normalizeScenes(stageId, list) {
  if (!Array.isArray(list)) {
    throw new VaultError('E_INVALID_INPUT', 'scenes 必须是数组', { field: 'scenes' });
  }
  const seen = new Set();
  return list.map((scene, index) => {
    if (!scene || typeof scene !== 'object') {
      throw new VaultError('E_INVALID_INPUT', `第 ${index} 个场景不是对象`, { field: `scenes[${index}]` });
    }
    const id = assertSegment(scene.id, 'sceneId');
    if (seen.has(id)) {
      throw new VaultError('E_INVALID_INPUT', `场景 id 重复：${id}`, { field: 'scenes', id });
    }
    seen.add(id);
    if (scene.stageId !== undefined && scene.stageId !== stageId) {
      throw new VaultError('E_INVALID_INPUT', `场景 ${id} 的 stageId 与课堂不一致`, { id, stageId });
    }
    const order = Number(scene.order ?? index);
    if (!Number.isFinite(order)) {
      throw new VaultError('E_INVALID_INPUT', `场景 ${id} 的 order 不是数字`, { id });
    }
    return { ...scene, id, stageId, order };
  });
}

function normalizeFolderName(name) {
  const text = String(name ?? '').trim();
  if (text.length === 0) throw new VaultError('E_INVALID_INPUT', '目录名不能为空', { field: 'name' });
  if (/[/\\\0]/.test(text)) throw new VaultError('E_INVALID_INPUT', '目录名不能包含路径分隔符', { field: 'name' });
  return text;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  throw new VaultError('E_INVALID_INPUT', 'assets.put 需要 Buffer / Uint8Array / string', { field: 'data' });
}

export { sceneFileName, parseSceneFileName };
