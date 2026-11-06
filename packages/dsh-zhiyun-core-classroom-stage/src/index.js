// 源：ref/OpenMAIC/lib/whiteboard/runtime/store.ts:172-307（append / read / 冲突语义）
// 源：ref/OpenMAIC/lib/action/engine.ts:180-292（execute 总表）
/**
 * 智云 Pro「课堂舞台」的宿主半边（L2 领域包）。
 *
 * 把 OpenMAIC 的舞台执行侧搬成 `ctx.zhiyunClassroomStage`：
 *
 *   dispatch(action)  写一条动作进有序账本（seq 严格递增，逐条 +1）
 *   ledger(runId)     读账本 + 折叠出的终态（可直接拿去重放）
 *   reset(runId)      丢掉一个 run 的账本
 *
 * # 为什么不照搬上游的 `ActionEngine`
 *
 * 上游的 `ActionEngine.execute()` 是**直接改 zustand store**、`await delay()`
 * 的副作用机器（`lib/action/engine.ts:216-292`）；它的「可回放」建立在前端把
 * 动作重跑一遍之上，终态依赖时钟与浏览器。搬到宿主进程后那样做有两个问题：
 *
 *   1. 服务端没有 DOM，`useCanvasStore` 不存在；
 *   2. 「同一份账本重放出同一终态」这件事将无法被测试证明。
 *
 * 所以这里只保留**动作的记账**与**纯函数折叠**（`src/ledger.js`）。动作如何
 * 落到像素，交给客户端 `<ClassroomStage>` 按时间轴（`src/timeline.js`）播放。
 *
 * # 三条硬约定（与 `host-classroom` / `host-deeptutor` 一致）
 *
 * 1. `apply()` 永不因上游缺失或注册冲突而抛错；
 * 2. 判断都推迟到方法被调用时；
 * 3. 业务包只调 `ctx.zhiyunClassroomStage`，不 import 本包 `src/`（`exports`
 *    里的子路径只供测试与客户端产物使用）。
 *
 * 源：ref/OpenMAIC/lib/action/engine.ts:180-292
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/store.ts:172-307
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/fold.ts:170-216
 */

import { STAGE_ERROR_CODES, StageActionError } from './errors.js';
import {
  STAGE_ACTION_TYPES,
  STAGE_EXECUTED_TYPES,
  STAGE_PASSTHROUGH_TYPES,
  assertActionPayload,
  deepFreeze,
  emptyStageState,
  foldRecords,
  isStageActionType,
} from './ledger.js';

export const name = 'zhiyun-classroom-stage';

/** 不依赖任何上游服务：账本在内存里，谁都能先启动。 */
export const inject = [];

/** 本包版本。 */
export const PACKAGE_VERSION = '0.1.0';

/** `dispatch` 没给 runId 时落的默认 run。 */
export const DEFAULT_RUN_ID = 'default';

/**
 * 深拷贝动作负载：账本里的记录必须与调用方后续的修改脱钩
 * （调用方常常复用同一个对象反复 dispatch）。
 *
 * @param {object} action
 * @returns {object}
 */
function clonePayload(action) {
  const { seq: _seq, runId: _runId, ...rest } = action;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(rest);
    } catch {
      // 含函数/符号等不可克隆值时退回 JSON —— 动作负载本来就该是 JSON。
    }
  }
  return JSON.parse(JSON.stringify(rest));
}

/**
 * 创建一个独立的账本服务。
 *
 * @param {object} [options]
 * @param {string} [options.defaultRunId]
 * @param {number} [options.maxRecordsPerRun] 单个 run 的记录上限（防止泄漏）
 * @param {() => number} [options.now] 记录时间戳用的时钟（测试可注入）
 * @returns {object} `ctx.zhiyunClassroomStage` 的形状
 */
export function createStageService(options = {}) {
  const defaultRunId = options.defaultRunId ?? DEFAULT_RUN_ID;
  const maxRecordsPerRun = Number.isSafeInteger(options.maxRecordsPerRun) && options.maxRecordsPerRun > 0
    ? options.maxRecordsPerRun
    : 10_000;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  /** @type {Map<string, {records: object[], nextSeq: number, seen: Set<number>, createdAt: number}>} */
  const runs = new Map();

  function runOf(runId, create) {
    const key = typeof runId === 'string' && runId.length > 0 ? runId : defaultRunId;
    let run = runs.get(key);
    if (!run && create) {
      run = { records: [], nextSeq: 0, seen: new Set(), createdAt: now() };
      runs.set(key, run);
    }
    return { key, run };
  }

  /**
   * 写入一条动作。
   *
   * `seq` 可以显式给（跨进程传输时用来校验顺序），也可以省略由账本分配。
   * 两种都必须满足：**严格等于 nextSeq**，且**从未出现过**。
   *
   * @param {object} action 动作负载，`type` 必须在 {@link STAGE_ACTION_TYPES} 里
   * @param {{runId?: string}} [dispatchOptions]
   * @returns {object} 落库的记录（已冻结）
   * @throws {StageActionError} `E_INVALID_ACTION` / `E_UNKNOWN_ACTION` /
   *   `E_SEQ_INVALID` / `E_SEQ_DUPLICATE` / `E_SEQ_OUT_OF_ORDER` /
   *   `E_LEGACY_SHAPE` / `E_SHAPE_GEOMETRY`
   */
  function dispatch(action, dispatchOptions = {}) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new StageActionError(
        STAGE_ERROR_CODES.INVALID_ACTION,
        'dispatch(action) 需要一个动作对象',
      );
    }
    if (typeof action.type !== 'string' || !isStageActionType(action.type)) {
      throw new StageActionError(
        STAGE_ERROR_CODES.UNKNOWN_ACTION,
        `未知的动作类型 ${JSON.stringify(action.type)}；已知类型：${STAGE_ACTION_TYPES.join(', ')}`,
        { type: action.type ?? null },
      );
    }

    const requestedRunId = dispatchOptions.runId ?? action.runId;
    const { key, run } = runOf(requestedRunId, true);

    const rawSeq = action.seq;
    let seq;
    if (rawSeq === undefined || rawSeq === null) {
      seq = run.nextSeq;
    } else if (!Number.isSafeInteger(rawSeq) || rawSeq < 0) {
      throw new StageActionError(
        STAGE_ERROR_CODES.SEQ_INVALID,
        `seq 必须是非负安全整数，收到 ${JSON.stringify(rawSeq)}`,
        { seq: rawSeq },
      );
    } else if (run.seen.has(rawSeq)) {
      throw new StageActionError(
        STAGE_ERROR_CODES.SEQ_DUPLICATE,
        `seq ${rawSeq} 已在 run ${key} 的账本里出现过（账本不接受重复序号）`,
        { seq: rawSeq, runId: key },
      );
    } else if (rawSeq !== run.nextSeq) {
      throw new StageActionError(
        STAGE_ERROR_CODES.SEQ_OUT_OF_ORDER,
        `seq 必须严格递增：期望 ${run.nextSeq}，收到 ${rawSeq}`,
        { seq: rawSeq, expected: run.nextSeq, runId: key },
      );
    } else {
      seq = rawSeq;
    }

    if (run.records.length >= maxRecordsPerRun) {
      throw new StageActionError(
        STAGE_ERROR_CODES.LEDGER_FULL,
        `run ${key} 的账本已达上限 ${maxRecordsPerRun} 条，请先 reset()`,
        { runId: key, maxRecordsPerRun },
      );
    }

    // 负载校验在**追加之前**：账本里不允许出现「写入时合法、重放时画不出来」的记录。
    assertActionPayload(action);

    const payload = clonePayload(action);
    const record = deepFreeze({
      seq,
      id: typeof action.id === 'string' && action.id.length > 0
        ? action.id
        : `stage:${key}:${seq}`,
      runId: key,
      type: action.type,
      payload,
      at: now(),
    });

    run.records.push(record);
    run.seen.add(seq);
    run.nextSeq = seq + 1;
    return record;
  }

  /**
   * 读账本。返回的记录本身就是重放输入：
   * `foldRecords(ledger(runId).records)` 与 `ledger(runId).state` 必须深相等。
   *
   * @param {string} [runId]
   * @returns {{runId: string, records: object[], lastSeq: number|null, state: object}}
   */
  function ledger(runId) {
    const { key, run } = runOf(runId, false);
    if (!run) {
      return deepFreeze({
        runId: key,
        records: [],
        lastSeq: null,
        state: emptyStageState(),
      });
    }
    const records = Object.freeze([...run.records]);
    return deepFreeze({
      runId: key,
      records,
      lastSeq: records.length > 0 ? records[records.length - 1].seq : null,
      state: foldRecords(records),
    });
  }

  /**
   * 清掉一个 run 的账本（不动别的 run）。返回被清掉的条数。
   *
   * @param {string} [runId]
   * @returns {{runId: string, removed: number}}
   */
  function reset(runId) {
    const { key, run } = runOf(runId, false);
    const removed = run ? run.records.length : 0;
    runs.delete(key);
    return { runId: key, removed };
  }

  /**
   * 只读快照，给状态面板/诊断用。
   *
   * @returns {{runs: Array<{runId: string, records: number, lastSeq: number|null}>, actionTypes: number}}
   */
  function status() {
    return {
      runs: [...runs.entries()].map(([runId, run]) => ({
        runId,
        records: run.records.length,
        lastSeq: run.records.length > 0 ? run.records[run.records.length - 1].seq : null,
      })),
      actionTypes: STAGE_ACTION_TYPES.length,
    };
  }

  return Object.freeze({
    dispatch,
    ledger,
    reset,
    status,
    /** 落地的动作类型数（15）/ 账本认得的全部类型数（22）。 */
    coverage: Object.freeze({
      executed: STAGE_EXECUTED_TYPES.length,
      passthrough: STAGE_PASSTHROUGH_TYPES.length,
      total: STAGE_ACTION_TYPES.length,
      executedTypes: STAGE_EXECUTED_TYPES,
      passthroughTypes: STAGE_PASSTHROUGH_TYPES,
    }),
  });
}

/**
 * Cordis 插件入口。
 *
 * @param {object} ctx
 * @param {object} [config]
 * @param {string} [config.defaultRunId]
 * @param {number} [config.maxRecordsPerRun]
 * @param {object} [config.logger]
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const log = config.logger ?? {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-classroom-stage]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-classroom-stage]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-classroom-stage]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-classroom-stage]', ...args),
  };

  let service;
  try {
    service = createStageService(config);
  } catch (error) {
    // 构造失败也要 provide 一个能说话的服务，否则契约凭空缺一项。
    log.error('舞台账本构造失败，退回空实现', error?.message ?? error);
    service = createStageService({});
  }

  let removeService = () => {};
  try {
    removeService = ctx.provide('zhiyunClassroomStage', service) ?? (() => {});
  } catch (error) {
    log.error('zhiyunClassroomStage 注册失败（服务名可能已被占用）', error?.message ?? error);
  }

  try {
    ctx.on?.('dispose', () => {
      try {
        removeService();
      } catch (error) {
        log.warn('卸载时注销 zhiyunClassroomStage 失败', error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  log.info(
    `课堂舞台就绪：动作类型 ${STAGE_EXECUTED_TYPES.length}/${STAGE_ACTION_TYPES.length} 落地，`
    + `${STAGE_PASSTHROUGH_TYPES.length} 种依赖浏览器/音频/iframe 只记账`,
  );

  return () => {
    try {
      removeService();
    } catch (error) {
      log.warn('卸载课堂舞台时出错', error?.message ?? error);
    }
  };
}

export { STAGE_ERROR_CODES, StageActionError, isStageActionError } from './errors.js';
export {
  STAGE_ACTION_TYPES,
  STAGE_EXECUTED_TYPES,
  STAGE_PASSTHROUGH_TYPES,
  applyRecord,
  emptyStageState,
  foldRecords,
  getLikelyLatexMath,
  isExecutedActionType,
  isStageActionType,
} from './ledger.js';
