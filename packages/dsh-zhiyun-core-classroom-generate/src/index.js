// 源：ref/OpenMAIC/lib/server/generation/run/service.ts（run 生命周期与对外动作）
// 源：ref/OpenMAIC/app/api/generation-runs/route.ts（start / list）
// 源：ref/OpenMAIC/app/api/generation-runs/[id]/route.ts（get / cancel）
// 源：ref/OpenMAIC/app/api/generation-runs/[id]/retry/route.ts（resume）
// 源：ref/OpenMAIC/app/api/generation-runs/[id]/events/route.ts（stream）
// 源：ref/OpenMAIC/app/api/generate-classroom/route.ts（brief 入口）

/**
 * # 课堂生成管线（Cordis 插件）
 *
 * 挂载 `ctx.zhiyunClassroomGenerate`：
 *
 *   start(brief, opts) → { runId, stageId, status }
 *   stream(runId)      → AsyncIterable<event>   // 从头重放 + 之后实时
 *   cancel(runId)      → boolean
 *   resume(runId)      → { runId, status }      // 从已落盘的 checkpoint 续跑
 *   get(runId)         → run 快照（不含事件）
 *   list()             → run 快照数组
 *   status()           → 服务健康
 *
 * # 为什么 run 记录既在内存又在 vault
 *
 * 上游是「DB 里的 run 行 + 独立的 events 表」，进程重启后 run 仍然可见。
 * 本实现在内存里留 record（事件日志要跟着活进程走），同时把段产物通过
 * `vault.runs.putStep()` 落盘。于是：
 *   - 同进程内 `stream()` 能重放全部事件；
 *   - 进程重启后 `resume(runId)` 仍能从 steps 重建 outputs 接着跑（事件会丢，
 *     这正是上游「断线续读靠 events 表」与本实现的唯一实质差别，见 status().detail）。
 *
 * # 端口注入
 *
 * 管线本身（`pipeline.js`）不认识 Cordis。这里把服务翻译成 ports：
 *   agent  ← ctx.zhiyunClassroomAgent   （`plan(brief)` 决定场景序列）
 *   pbl    ← ctx.zhiyunClassroomPbl     （PBL 场景的项目内容）
 *   media  ← ctx.zhiyunClassroomMedia   （配音 / 配图）
 *   vault  ← ctx.zhiyunClassroomVault   （段产物、资产、最终 classroom 文档）
 *
 * 缺任何一个端口都不阻止 start：管线在需要它的那一段降级（`outline` 段没有 agent
 * 就走 `planScenes` 的确定性兜底），与上游「provider 缺失只影响对应能力」的语义一致。
 */

import { randomUUID } from 'node:crypto';

import { normalizeBrief, assertStageId } from './brief.js';
import { ClassroomGenerateError, describeError } from './errors.js';
import { createEventLog, PHASES, makeEvent } from './events.js';
import { resolveLlm } from './llm.js';
import { createHostLlmTransport } from './host-llm.js';
import { runPipeline } from './pipeline.js';

export const name = 'zhiyun-classroom-generate';

/** 规范 §4：领域包只 declare 它消费的宿主服务。 */
export const inject = [
  'zhiyunClassroomStudio',
  'zhiyunClassroomAgent',
  'zhiyunClassroomPbl',
  'zhiyunClassroomMedia',
  'zhiyunClassroomVault',
];

export const SERVICE_NAME = 'zhiyunClassroomGenerate';
export const PACKAGE_VERSION = '0.1.0';

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {{ call?: Function, stream?: Function }} [config.llm] 窄 llm 接口（宿主注入优先于 studio.providers）
 * @param {object} [config.logger]
 * @param {() => number} [config.now] 测试用时钟
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const log = config.logger ?? {
    debug: (...args) => ctx?.logger?.debug?.('[zhiyun-classroom-generate]', ...args),
    info: (...args) => ctx?.logger?.info?.('[zhiyun-classroom-generate]', ...args),
    warn: (...args) => ctx?.logger?.warn?.('[zhiyun-classroom-generate]', ...args),
    error: (...args) => ctx?.logger?.error?.('[zhiyun-classroom-generate]', ...args),
  };

  const pick = (serviceName) => {
    try {
      return ctx?.[serviceName] ?? ctx?.get?.(serviceName) ?? null;
    } catch (error) {
      log.warn(`读取 ${serviceName} 失败（按缺失处理）`, error?.message ?? error);
      return null;
    }
  };

  const studio = pick('zhiyunClassroomStudio');
  // 宿主 llm 是**首选**：本仓的解析/讲义/出题都走它，课堂生成也该走它。
  // 只有宿主没给的时候才退回 studio 的模型清单（那条路依赖课堂登录态）。
  // 取宿主 llm 要用 `ctx.get`：Cordis 里直接读属性会抛
  // `cannot get property "llm" without inject`（必须先声明依赖）。
  //
  // ⚠️ **不**把 `llm` 写进 `inject`：那会变成硬依赖，宿主没提供 llm 时
  //    整个课堂生成包会 pending —— 连「未接入」都报不出来。
  //    这里用 try 包住，取不到就当没有，让 resolveLlm 回落到 studio。
  //
  // 用 `ctx.get` 而不是 `pick()`：`pick()` 会吞掉异常并打 warn，
  // 而这条路径是「正常可能缺失」的，不该在日志里制造噪音。
  let hostSvc = null;
  try {
    hostSvc = ctx?.get?.('llm') ?? null;
  } catch {
    hostSvc = null;
  }
  const hostLlm = config.llm ?? createHostLlmTransport(hostSvc);
  const ports = {
    agent: pick('zhiyunClassroomAgent'),
    pbl: pick('zhiyunClassroomPbl'),
    media: pick('zhiyunClassroomMedia'),
    vault: pick('zhiyunClassroomVault'),
    now: typeof config.now === 'function' ? config.now : () => Date.now(),
  };

  for (const key of ['agent', 'pbl', 'media', 'vault']) {
    if (!ports[key]) log.warn(`zhiyunClassroom${key[0].toUpperCase()}${key.slice(1)} 尚未提供：对应段降级`);
  }
  if (!studio && !config.llm) {
    log.warn('既没有 zhiyunClassroomStudio 也没有注入 llm：生成会以 CONFIG 错误拒绝');
  }

  let service;
  try {
    service = createGenerateService({ studio, ports, llm: hostLlm, log });
  } catch (error) {
    // 构造本身不该失败；真失败了也要让 profile 活着。
    log.error('课堂生成服务构造失败', error?.message ?? error);
    service = createDegradedService(error);
  }

  let removeService = () => {};
  try {
    removeService = ctx?.provide?.(SERVICE_NAME, service) ?? (() => {});
  } catch (error) {
    log.error(`${SERVICE_NAME} 注册失败（服务名可能已被占用）`, error?.message ?? error);
  }

  try {
    ctx?.on?.('dispose', () => {
      try {
        service.dispose();
      } catch (error) {
        log.warn('卸载课堂生成服务时出错', error?.message ?? error);
      }
      try {
        removeService();
      } catch (error) {
        log.warn(`卸载时注销 ${SERVICE_NAME} 失败`, error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  log.info(`课堂生成就绪：vault=${ports.vault ? 'injected' : 'missing'}，llm=${hostLlm ? (config.llm ? 'injected' : 'from-host') : 'none'}`);

  return () => {
    try {
      service.dispose();
    } catch (error) {
      log.warn('卸载课堂生成服务时出错', error?.message ?? error);
    }
    try {
      removeService();
    } catch (error) {
      log.warn(`卸载时注销 ${SERVICE_NAME} 失败`, error?.message ?? error);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 本包的 run 状态 → vault `generation_runs.state`。
 *
 * vault 那张表有 CHECK 约束（`preparing / outlining / awaiting_outline_confirmation /
 * generating / paused / completed / ended`），不能把 `done` / `cancelled` 直接写进去。
 * `failed` 映射成 `paused` 而不是 `ended`：上游失败是「暂停在某步、可以续跑」，
 * 而 `ended` 表示这个 run 已经收尾不再推进（cancelled 才是）。
 */
const RUN_STATE_OF = Object.freeze({
  running: 'generating',
  done: 'completed',
  failed: 'paused',
  cancelled: 'ended',
});

/**
 * 生成服务本体。对外只暴露 7 个方法，run 记录在闭包里。
 *
 * @param {{ studio: object|null, ports: object, llm: object|null, log: object }} deps
 */
export function createGenerateService({ studio, ports, llm, log }) {
  /** @type {Map<string, object>} runId → record */
  const runs = new Map();
  let closed = false;

  const now = () => ports.now();

  /**
   * 一条 run 的初始记录。`outputs` 用 Map 而不是对象：段的顺序由 PHASES 定，
   * 用 Map 才能区分「值为 undefined」和「这段还没跑」。
   */
  function newRecord({ runId, brief, stageId }) {
    return {
      runId,
      stageId,
      brief,
      status: 'running',
      startedAt: now(),
      endedAt: null,
      error: null,
      controller: new AbortController(),
      outputs: new Map(),
      log: createEventLog(),
    };
  }

  /** 段产物 → vault 的 checkpoint。失败只 warn：落盘坏了不能让 run 直接崩。 */
  async function checkpoint(record, phase, output) {
    if (!ports.vault?.runs?.putStep) return;
    try {
      await ports.vault.runs.putStep(record.runId, phase, output);
    } catch (error) {
      log.warn(`run ${record.runId} 的 ${phase} 段落盘失败（继续跑）`, error?.message ?? error);
    }
  }

  /**
   * run 记录与事件落盘。
   *
   * # 为什么必须有这一步
   *
   * 端到端测试里踩到的真问题：本包只写 `runs.putStep`（段产物），从不写
   * `generation_runs` 行与事件表，于是宿主 `GET /api/generation-runs/[id]`
   * （走 `vault.runs.get`）在生成成功的那一刻依然是 404，SSE 也是空的 ——
   * 页面刷新后看不到自己刚起的那次生成。上游是「run 行 + events 表」双写，
   * 这里补齐同样的两条。
   *
   * 写失败只 warn：落盘不是生成的必要条件（同进程内 stream() 走内存日志）。
   */
  async function persistRun(record) {
    const runs = ports.vault?.runs;
    if (!runs) return;

    try {
      await runs.put({
        id: record.runId,
        stageId: record.stageId,
        state: RUN_STATE_OF[record.status] ?? 'generating',
        payload: { brief: record.brief, phases: [...PHASES] },
        error: record.error ?? null,
        createdAt: record.startedAt,
        updatedAt: record.endedAt ?? now(),
      });
    } catch (error) {
      log.warn(`run ${record.runId} 的记录落盘失败`, error?.message ?? error);
      return; // 行都没有，事件表更写不进去（appendEvent 要求行存在）
    }

    if (typeof runs.appendEvent !== 'function') return;
    for (const event of record.log.snapshot()) {
      try {
        await runs.appendEvent(record.runId, {
          ts: event.ts,
          type: event.kind,
          data: event,
        });
      } catch (error) {
        log.warn(`run ${record.runId} 的事件落盘失败（后续事件跳过）`, error?.message ?? error);
        break;
      }
    }
  }

  /**
   * 公开视图：不含 controller / log / outputs 这些内部件。
   *
   * ⚠️ 例外：run 结束后带上 `scenes`。
   *
   * 原本这里什么都不带，而 `run-done` 事件也只有摘要（sceneCount / skipped），
   * 于是**消费者拿不到真正的课件数据** —— 只能看到「生成了 N 页」，
   * 却拿不到那 N 页的元素与口播稿。AI 教学栏因此永远拿到空列表（报 EMPTY）。
   *
   * scenes 是这条管线的最终产物，和 status 一样属于「调用方必须能看到」的东西。
   * 只带它一个，其余内部件（controller/abort、log、每段的中间产物）仍不外露。
   */
  function snapshot(record) {
    if (!record) return null;
    const scenesOutput = record.outputs.get('scenes');
    return {
      runId: record.runId,
      stageId: record.stageId,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      error: record.error,
      // 正在跑哪一段 —— 轮询进度要显示它。没有它只能看到「哪些完成了」，
      // 于是整段 outline 期间界面都停在「正在规划」，看起来像卡住。
      phase: record.currentPhase ?? null,
      // 已完成产出的场景数（scenes 阶段整批结束时才有 outputs，所以中途靠这个）
      readyScenes: record.readyScenes ?? 0,
      phases: [...PHASES].map((phase) => ({
        phase,
        done: record.outputs.has(phase),
      })),
      ...(scenesOutput ? { scenes: scenesOutput.scenes ?? [], skipped: scenesOutput.skipped ?? [] } : {}),
    };
  }

  /** 把失败写成「一条 run-error + 关闭日志」，交给调用方决定是否 rethrow。 */
  function fail(record, error) {
    record.status = 'failed';
    record.error = describeError(error);
    record.endedAt = now();
    try {
      record.log.push(makeEvent({
        runId: record.runId,
        phase: 'outline',
        kind: 'run-error',
        payload: record.error,
        ts: now(),
      }));
    } catch { /* 日志都写不进去就只剩 record.error */ }
    try {
      record.log.close();
    } catch { /* 已关闭 */ }
  }

  /** 真正把管线跑起来（不 await，start/resume 立刻返回 runId）。 */
  function launch(record) {
    Promise.resolve()
      .then(async () => {
        // 模型槽解析放在异步里：解析失败要变成一条 run-error 事件，而不是让
        // start() 直接抛 —— 上游也是「run 建好之后才因为没模型失败」。
        const resolved = await resolveLlm({
          studio,
          llm,
          provider: record.provider,
          model: record.model,
        });
        // 先落一行 `generating`：宿主 GET /generation-runs/[id] 立刻能查到。
        await persistRun(record);
        await runPipeline({
          record,
          llm: resolved,
          ports,
          checkpoint: (phase, output) => checkpoint(record, phase, output),
        });
        // 跑完再写一次：状态从 generating 转 completed/ended/paused，事件补全。
        await persistRun(record);
      })
      .catch(async (error) => {
        // runPipeline 自己吞掉业务错误；能到这里的是「模型槽解析失败」或它内部崩了。
        log.warn(`run ${record.runId} 未能启动/异常终止：${error?.message ?? error}`);
        fail(record, error);
        await persistRun(record);
      });
  }

  const service = {
    version: PACKAGE_VERSION,

    /**
     * 起一次生成。
     *
     * @param {unknown} rawBrief 字符串或 `{ requirement, ... }`
     * @param {{ stageId?: string, provider?: string, model?: string, runId?: string }} [opts]
     */
    start(rawBrief, opts = {}) {
      assertOpen();

      const brief = normalizeBrief(rawBrief);
      const stageId = assertStageId(opts.stageId ?? defaultStageId(brief));
      const runId = opts.runId ?? randomUUID();

      if (runs.has(runId)) {
        throw new ClassroomGenerateError('E_CONFLICT', `runId 已存在：${runId}`, { runId });
      }

      const record = newRecord({ runId, brief, stageId });
      record.provider = opts.provider;
      record.model = opts.model;
      runs.set(runId, record);

      launch(record);
      return { runId, stageId, status: record.status };
    },

    /**
     * 事件流：先把历史事件重放一遍，再等新事件。
     * run 已经结束时迭代会在历史放完后自然结束（与上游 SSE 的「回放+关闭」一致）。
     */
    stream(runId) {
      assertOpen();
      const record = requireRun(runId, runs);
      return record.log.iterate();
    },

    /**
     * 取消。已经结束的 run 返回 false（幂等）。
     * 取消后当前段的产物**不会**落盘 —— 这是「落盘不脏」的那条线。
     */
    cancel(runId) {
      const record = runs.get(String(runId ?? ''));
      if (!record) return false;
      if (record.status !== 'running') return false;
      // 只有「真正把 running 转成取消」的那一次返回 true；重复调用返回 false。
      if (record.controller.signal.aborted) return false;
      record.controller.abort();
      return true;
    },

    /**
     * 从 checkpoint 续跑：已完成段跳过，从第一个缺失段继续。
     * 事件日志沿用（新的 phase-start 会接在旧事件后面），不重放已完成段的事件。
     */
    async resume(runId) {
      assertOpen();
      const record = requireRun(runId, runs);
      if (record.status === 'running') return { runId: record.runId, status: record.status };

      const outputs = new Map();
      if (ports.vault?.runs?.steps) {
        try {
          for (const row of await ports.vault.runs.steps(record.runId)) {
            if (row?.id && row.output !== undefined) outputs.set(String(row.id), row.output);
          }
        } catch (error) {
          log.warn(`run ${record.runId} 的 checkpoint 读取失败（按无 checkpoint 续跑）`, error?.message ?? error);
        }
      }

      record.outputs = outputs;
      record.controller = new AbortController();
      record.status = 'running';
      record.error = null;
      record.endedAt = null;
      record.log = createEventLog();

      launch(record);
      return { runId: record.runId, status: record.status };
    },

    /** run 快照。不存在返回 null（不抛，页面轮询不该因为一个过期 id 炸掉）。 */
    get(runId) {
      return snapshot(runs.get(String(runId ?? '')) ?? null);
    },

    /** 全部 run，按开始时间倒序。 */
    list() {
      return [...runs.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(snapshot);
    },

    /** 只读事件快照（调试 / 页面刷新后补历史用）。 */
    events(runId) {
      const record = runs.get(String(runId ?? ''));
      return record ? record.log.snapshot() : [];
    },

    async status() {
      return {
        state: ports.vault ? 'ok' : 'degraded',
        version: PACKAGE_VERSION,
        detail: {
          phases: [...PHASES],
          ports: {
            studio: Boolean(studio),
            agent: Boolean(ports.agent),
            pbl: Boolean(ports.pbl),
            media: Boolean(ports.media),
            vault: Boolean(ports.vault),
          },
          runs: runs.size,
          running: [...runs.values()].filter((r) => r.status === 'running').length,
          // 与上游的唯一实质差别：事件只在内存，进程重启后 resume 仍可用但历史事件丢失。
          eventLog: 'in-memory',
        },
      };
    },

    dispose() {
      closed = true;
      for (const record of runs.values()) {
        if (record.status === 'running') {
          try {
            record.controller.abort();
          } catch { /* 已 aborted */ }
        }
        try {
          record.log.close();
        } catch { /* 已关闭 */ }
      }
      runs.clear();
    },

    get closed() {
      return closed;
    },
  };

  function assertOpen() {
    if (closed) throw new ClassroomGenerateError('E_CLOSED', '课堂生成服务已卸载');
  }

  return service;
}

function requireRun(runId, runs) {
  const id = String(runId ?? '');
  const record = runs.get(id);
  if (!record) throw new ClassroomGenerateError('E_NOT_FOUND', `run 不存在：${id || '(空)'}`, { runId: id });
  return record;
}

/** 没给 stageId 时用「课堂 + 日期」，和上游 `generate-classroom` 的默认命名一致。 */
function defaultStageId(brief) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = String(brief?.topic ?? 'classroom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `classroom-${stamp}${slug ? `-${slug}` : ''}`;
}

function createDegradedService(error) {
  const fail = () => {
    throw new ClassroomGenerateError('CONFIG', `课堂生成服务未初始化：${error?.message ?? error}`);
  };
  return {
    version: '0.0.0',
    start: fail,
    stream: fail,
    cancel: () => false,
    resume: fail,
    get: () => null,
    list: () => [],
    events: () => [],
    async status() {
      return {
        state: 'degraded',
        version: '0.0.0',
        detail: { error: error?.message ?? String(error) },
      };
    },
    dispose() {},
    get closed() { return true; },
  };
}

export { normalizeBrief, assertStageId } from './brief.js';
export { ClassroomGenerateError, describeError, cancelled, ERROR_CODES } from './errors.js';
export { PHASES, EVENT_KINDS, makeEvent, createEventLog } from './events.js';
export { resolveLlm } from './llm.js';
export { runPipeline, firstPendingPhase } from './pipeline.js';
