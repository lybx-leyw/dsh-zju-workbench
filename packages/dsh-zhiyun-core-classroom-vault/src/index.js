/**
 * `dsh-zhiyun-core-classroom-vault`：OpenMAIC 持久化层的本地文件实现。
 *
 * 源：ref/OpenMAIC/lib/persistence/（31 个文件，7.8k 行）
 *     ref/OpenMAIC/lib/store/（20 个文件，5.2k 行）
 *     ref/OpenMAIC/packages/@openmaic/storage/src/{document,asset,material,generation-runs}（47.6k）
 *
 * # 本包解决的是规范第 3 通道（`docs/architecture/classroom-port.md` §2）
 *
 * 「SQL 语义保留，driver 换成本仓约定」。`host-classroom/src/adapter.js` 当时只
 * 声明了 7 个端口方法，并指出本仓没有 `ctx.vault`。本包的做法是**第三种**：
 * 自带一个文件驱动的适配器（`src/adapter.js`），不新建宿主服务、不改
 * `zhiyunVault`、也不引 `pg`。数据根固定在
 * `<profile>/data/zhiyun-classroom/`（与 `host-classroom` 同一个根，见
 * `host-classroom/src/index.js:82`），所以宿主换掉空壳适配器只需要
 * `config.adapter = createLocalVaultAdapter({ rootDir })`。
 *
 * # 三条本仓惯例（照 `host-deeptutor` / `host-classroom`）
 *
 * 1. `apply()` **永不抛**：目录建不了、provide 撞名，都只让 `status().state`
 *    变差，不让整个 profile 起不来；
 * 2. 不 import 别的包的 `src/`：只依赖 `profileContext` 与 node 内置模块；
 * 3. 落盘只经 `src/adapter.js` 与 `src/store.js`，业务不散写 IO。
 *
 * # 服务形状
 *
 * ```
 * ctx.zhiyunClassroomVault.status()
 * ctx.zhiyunClassroomVault.classroom.{list,load,save,create,remove,exists,meta}
 * ctx.zhiyunClassroomVault.scenes.{list,get,put,remove}
 * ctx.zhiyunClassroomVault.folders.{list,get,create,rename,remove,assign}
 * ctx.zhiyunClassroomVault.runs.{put,get,list,patch,remove,appendEvent,events,putStep,steps,putCommand,command}
 * ctx.zhiyunClassroomVault.assets.{put,get,bytes,list,remove,addRef,removeRef,refs}
 * ctx.zhiyunClassroomVault.materials.{put,get,list,remove}
 * ctx.zhiyunClassroomVault.snapshots.{list,get,add,prune,clear}
 * ctx.zhiyunClassroomVault.kv.{get,set,remove,keys}
 * ```
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTER_METHODS, createLocalVaultAdapter } from './adapter.js';
import { createVaultStore, VaultError } from './store.js';

export const name = 'zhiyun-classroom-vault';

/**
 * 只硬依赖 `profileContext`（拿 profile 目录）。`logger` 之类都是可选，
 * 写进 inject 会让本插件在测试桩里一直 pending。
 */
export const inject = ['profileContext'];

export const SERVICE_NAME = 'zhiyunClassroomVault';
export const PACKAGE_VERSION = '0.1.0';

export { ADAPTER_METHODS, createLocalVaultAdapter, createVaultStore, VaultError };

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {string} [config.rootDir] 数据根，默认 `<profile>/data/zhiyun-classroom`
 * @param {string} [config.ownerId] owner 分区键，默认 `'local'`（单机单用户）
 * @param {number} [config.snapshotLimit] 快照历史上限，默认 20（上游同值）
 * @param {object} [config.adapter] 直接注入一个端口实现（测试 / 换后端）
 * @param {object} [config.logger]
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const logger = config.logger ?? {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-classroom-vault]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-classroom-vault]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-classroom-vault]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-classroom-vault]', ...args),
  };

  // 取不到 profileContext 也算"能起来"：root 为 null，服务照常 provide，
  // 任何需要落盘的方法在自己的错误里说明原因。
  let rootDir = null;
  try {
    rootDir = config.rootDir
      ?? (ctx?.profileContext?.dir ? join(ctx.profileContext.dir, 'data/zhiyun-classroom') : null);
  } catch (error) {
    logger.warn('解析数据目录失败，课堂持久层将以无数据根状态启动', error?.message ?? error);
  }

  let adapter;
  let adapterError = null;
  try {
    adapter = config.adapter ?? (rootDir ? createLocalVaultAdapter({ rootDir, logger }) : null);
  } catch (error) {
    adapterError = error;
    logger.error('课堂存储适配器构造失败', error?.message ?? error);
  }

  const store = rootDir && adapter
    ? createVaultStore({
      rootDir,
      adapter,
      ownerId: config.ownerId ?? 'local',
      logger,
      snapshotLimit: config.snapshotLimit ?? 20,
      lockWaitMs: config.lockWaitMs,
    })
    : null;

  // 目录创建失败不抛：盘满/权限问题应该表现为 status().state。
  let mkdirError = null;
  const ready = rootDir
    ? mkdir(rootDir, { recursive: true }).then(
      () => mkdir(join(rootDir, 'classroom'), { recursive: true }),
      (error) => { mkdirError = error; },
    ).then(() => mkdir(join(rootDir, 'runs'), { recursive: true }))
      .then(() => mkdir(join(rootDir, 'folders'), { recursive: true }))
      .then(() => mkdir(join(rootDir, 'materials'), { recursive: true }))
      .catch((error) => { mkdirError = error; })
    : Promise.resolve();

  /** 没有 store 时，每个方法都抛这一条 —— 绝不返回 undefined 让调用方猜。 */
  const guard = (run) => async (...args) => {
    if (!store) {
      throw new VaultError(
        'E_MISSING_SERVICE',
        adapterError ? `课堂存储适配器不可用：${adapterError.message}` : '课堂存储没有数据根（profileContext 缺失）',
        { root: rootDir },
      );
    }
    await ready;
    if (mkdirError) {
      throw new VaultError('E_IO', `课堂数据目录不可写：${mkdirError.message}`, { root: rootDir });
    }
    return run(...args);
  };

  const missingMethods = adapter
    ? ADAPTER_METHODS.filter((method) => typeof adapter[method] !== 'function')
    : [...ADAPTER_METHODS];

  const service = {
    version: PACKAGE_VERSION,
    rootDir,
    ownerId: config.ownerId ?? 'local',
    adapter: adapter ?? null,
    get store() { return store; },

    /** 端口实现度：路由/状态面板据此判断存储是否真的可用。 */
    ports() {
      return {
        methods: [...ADAPTER_METHODS],
        missing: missingMethods,
        implemented: ADAPTER_METHODS.length - missingMethods.length,
        total: ADAPTER_METHODS.length,
        kind: adapter?.kind ?? null,
        ready: Boolean(adapter?.ready),
      };
    },

    status: guard(async () => {
      const counts = { classrooms: 0, runs: 0, folders: 0 };
      try {
        counts.classrooms = await adapter.count('document_stages', store.ownerId);
        counts.runs = await adapter.count('generation_runs', store.ownerId);
        counts.folders = await adapter.count('document_folders', store.ownerId);
      } catch (error) {
        return {
          state: 'degraded',
          version: PACKAGE_VERSION,
          detail: { root: rootDir, reason: error?.message ?? String(error), ports: service.ports() },
        };
      }
      return {
        state: missingMethods.length === 0 ? 'ready' : 'degraded',
        version: PACKAGE_VERSION,
        detail: {
          root: rootDir,
          ownerId: store.ownerId,
          counts,
          ports: service.ports(),
          layout: 'classroom/<id>/{meta.json,stage-meta.json,outline.json,scenes/,assets/,snapshots/}',
        },
      };
    }),

    classroom: {
      list: guard((params) => store.classroom.list(params)),
      load: guard((id, params) => store.classroom.load(id, params)),
      save: guard((id, doc, params) => store.classroom.save(id, doc, params)),
      create: guard((doc) => store.classroom.create(doc)),
      remove: guard((id) => store.classroom.remove(id)),
      exists: guard((id) => store.classroom.exists(id)),
      meta: guard((id) => store.classroom.meta(id)),
    },

    scenes: {
      list: guard((stageId) => store.scenes.list(stageId)),
      get: guard((stageId, sceneId) => store.scenes.get(stageId, sceneId)),
      put: guard((stageId, scene) => store.scenes.put(stageId, scene)),
      remove: guard((stageId, sceneId) => store.scenes.remove(stageId, sceneId)),
    },

    folders: {
      list: guard(() => store.folders.list()),
      get: guard((id) => store.folders.get(id)),
      create: guard((input) => store.folders.create(input)),
      rename: guard((id, folderName) => store.folders.rename(id, folderName)),
      remove: guard((id) => store.folders.remove(id)),
      assign: guard((stageId, folderId) => store.folders.assign(stageId, folderId)),
    },

    runs: {
      put: guard((run) => store.runs.put(run)),
      get: guard((id) => store.runs.get(id)),
      list: guard((params) => store.runs.list(params)),
      patch: guard((id, patch) => store.runs.patch(id, patch)),
      remove: guard((id) => store.runs.remove(id)),
      appendEvent: guard((runId, event) => store.runs.appendEvent(runId, event)),
      events: guard((runId, params) => store.runs.events(runId, params)),
      putStep: guard((runId, stepId, output) => store.runs.putStep(runId, stepId, output)),
      steps: guard((runId) => store.runs.steps(runId)),
      putCommand: guard((runId, commandId, type, result) => store.runs.putCommand(runId, commandId, type, result)),
      command: guard((runId, commandId) => store.runs.command(runId, commandId)),
    },

    assets: {
      put: guard((input) => store.assets.put(input)),
      get: guard((stageId, assetId) => store.assets.get(stageId, assetId)),
      bytes: guard((stageId, assetId) => store.assets.bytes(stageId, assetId)),
      list: guard((stageId) => store.assets.list(stageId)),
      remove: guard((stageId, assetId) => store.assets.remove(stageId, assetId)),
      addRef: guard((input) => store.assets.addRef(input)),
      removeRef: guard((input) => store.assets.removeRef(input)),
      refs: guard((stageId) => store.assets.refs(stageId)),
    },

    materials: {
      put: guard((input) => store.materials.put(input)),
      get: guard((sessionId, materialId) => store.materials.get(sessionId, materialId)),
      list: guard((sessionId) => store.materials.list(sessionId)),
      remove: guard((sessionId, materialId) => store.materials.remove(sessionId, materialId)),
    },

    snapshots: {
      list: guard((stageId) => store.snapshots.list(stageId)),
      get: guard((stageId, seq) => store.snapshots.get(stageId, seq)),
      add: guard((stageId, snapshot) => store.snapshots.add(stageId, snapshot)),
      prune: guard((stageId, limit) => store.snapshots.prune(stageId, limit)),
      clear: guard((stageId) => store.snapshots.clear(stageId)),
    },

    kv: {
      get: guard((key, scope) => store.kv.get(key, scope)),
      set: guard((key, value, scope) => store.kv.set(key, value, scope)),
      remove: guard((key, scope) => store.kv.remove(key, scope)),
      keys: guard((prefix, scope) => store.kv.keys(prefix, scope)),
    },
  };

  let removeService = () => {};
  try {
    removeService = ctx.provide(SERVICE_NAME, service) ?? (() => {});
  } catch (error) {
    // 撞名就降级：服务没了，但工作台还活着（照 host-classroom 的取舍）。
    logger.error(`注册 ${SERVICE_NAME} 失败（服务名可能已被占用）`, error?.message ?? error);
  }

  ctx.on?.('dispose', () => {
    try {
      removeService();
    } catch (error) {
      logger.warn(`卸载时注销 ${SERVICE_NAME} 失败`, error?.message ?? error);
    }
  });

  return () => {
    try {
      removeService();
    } catch {
      // 卸载路径上失败不该挡住收尾。
    }
  };
}
