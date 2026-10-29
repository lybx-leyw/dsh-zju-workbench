/**
 * r4 内核 ↔ 产品引擎契约之间的适配层。
 *
 * `runR4(config)` 与 `generatePoints(input)` 不是同一套词汇，必须显式映射；
 * 猜一个「差不多」的对应关系，会让恢复语义、题数配额和落库时机同时出错。
 *
 * # 两个方向的错位
 *
 * 1. **入参**：产品用 `plan`（含 tasks/count/types/strategies），r4 用
 *    `pointIds/count/types/strategies/graph` 加一个整份 `state`。
 * 2. **回调**：r4 只回调 `onCheckpoint(整份state)`，**从不逐题回调**；
 *    它是「一批跑完，在 result.results[].questions 里交卷」的形状。
 *    而产品要求逐题 `onQuestion(question, checkpoint)` 落库。
 *    所以适配层必须在收尾时补发，且必须**按已有 questionIds 去重** ——
 *    否则恢复一次就把同一批题重复入库一次。
 */

import {runR4, VERSION as KERNEL_VERSION} from './kernel/run.mjs';

/** 产品侧断点版本。与内核内部的 `r4-demand-v3` 是两个不同层次，见 checkpoint.js。 */
export const CHECKPOINT_VERSION = 'point-quiz-r4-lab-demand-v3';

export const LAB_ENGINE = Object.freeze({
  id: 'r4-lab',
  label: 'r4 lab（实验）',
  description: '按需求缓构建考法树与题模，逐题独立作答与审核。',
  checkpointVersion: CHECKPOINT_VERSION,
  /** r4 自带引擎侧状态（compileCache / ledger），需要 engineState 参与恢复判定。 */
  native: true,
  /** r4 读课内讲义树，不能用于联网资料。 */
  source: 'course',
});

const fault = (code, message) => Object.assign(Error(message), {code});

/**
 * 产品 plan → r4 参数。
 *
 * `compositeCount` 产品侧没有来源（`plan` 只有 `ideaScope`），默认 0；
 * 需要综合题时由 config 显式打开，不猜魔数。
 */
export function toR4Config({plan, graph, runId, checkpoint, maxCalls, compositeCount = 0, purpose}) {
  const pointIds = [...new Set((plan.tasks ?? []).map(task => task.point?.id).filter(Boolean))];
  if (!pointIds.length) throw fault('INPUT', 'r4 lab 需要至少一个知识点');
  return {
    graph,
    pointIds,
    count: plan.count,
    compositeCount,
    types: plan.types?.length ? [...plan.types] : ['mcq'],
    strategies: plan.strategies?.length ? plan.strategies.map(row => row.id ?? row) : ['understand'],
    purpose: purpose ?? (plan.mode === 'exam' ? 'assessment' : 'practice'),
    // requestId 决定 r4 的幂等身份：同一个 runId 必须得到同一个计划。
    requestId: runId,
    state: checkpoint?.engineState?.lab ?? {},
    ...(Number.isInteger(maxCalls) ? {maxCalls} : {}),
  };
}

/**
 * 建一个 r4 引擎实例。
 *
 * `hosts` 只含**计算资源**：pool / graph / records。落库权留在 core-study，
 * 通过 `input.onCheckpoint / onQuestion` 完成 —— 与 `createTreeQuizRun` 同构。
 * 这条边界是刻意的：lab 写坏的最坏结果是「这一批失败」，而不是「题库写脏」。
 */
export function createLabRun(hosts = {}) {
  const lifetime = new AbortController();
  let disposed = false;
  return {
    get workers() { return hosts.pool?.snapshot ?? []; },
    dispose: () => { disposed = true; lifetime.abort(); },
    async generatePoints(input) {
      if (disposed) throw fault('CANCELLED', 'r4 lab 引擎已释放');
      const signal = AbortSignal.any([lifetime.signal, ...(input.signal ? [input.signal] : [])]);
      const call = hosts.pool ? request => hosts.pool.call(request) : input.call;
      if (typeof call !== 'function') throw fault('CONFIG', 'r4 lab 需要 worker 池或一个 call 实现');

      // 已落库的题 id：用来在补发 onQuestion 时去重，也让重复恢复不重复入库。
      const delivered = new Set((input.checkpoint?.tasks ?? []).flatMap(task => task.questionIds ?? []));
      const problems = [];
      // 产品的检查点由适配层自己维护：r4 的 onCheckpoint 给的是它内部的整份状态
      // （`{version, explorations, requests}`），把它直接上交会让产品的 tasks/questions
      // 全部消失。所以这里把 r4 状态收进 `engineState.lab`，产品字段原样保留。
      let productCheckpoint = patchCheckpoint(input.checkpoint, input.checkpoint?.engineState?.lab ?? {});
      // 产品任务骨架：恢复时沿用已有 tasks，首次运行时按计划题数建位次。
      // 不建位次的话 `recordQuestion` 找不到空位，进度统计也就永远是 0。
      if (!productCheckpoint.tasks.length) {
        productCheckpoint.tasks = (input.plan?.tasks ?? [{count: input.plan?.count ?? 1}]).map(task => ({
          questionIds: [], plannedCount: task.count ?? 1, state: 'pending', error: null,
        }));
      }

      // r4 的恢复状态取自已归位的 productCheckpoint，而不是原始入参：
      // 首次运行时入参没有 engineState.lab，恢复时它藏在产品检查点里。
      const config = toR4Config({...input, checkpoint: productCheckpoint});

      const result = await runR4({
        ...config,
        call,
        signal,
        concurrency: hosts.concurrency ?? hosts.pool?.concurrency ?? 2,
        onCheckpoint: async state => {
          productCheckpoint = patchCheckpoint(productCheckpoint, state);
          await input.onCheckpoint(productCheckpoint);
        },
        onProgress: event => input.onProgress?.(event),
      });

      for (const cell of result.results ?? []) {
        for (const question of cell.questions ?? []) {
          if (delivered.has(question.id)) continue;
          delivered.add(question.id);
          const banked = toBankQuestion(question, input, hosts);
          productCheckpoint = recordQuestion(productCheckpoint, banked);
          await input.onQuestion(banked, productCheckpoint);
        }
      }
      for (const cell of result.results ?? []) {
        if (cell.error) problems.push(cell.error);
        for (const pending of cell.pending ?? []) if (pending.reason) problems.push(pending.reason);
      }
      return {admitted: delivered.size - new Set((input.checkpoint?.tasks ?? []).flatMap(t => t.questionIds ?? [])).size, problems, checkpoint: productCheckpoint};
    },
  };
}

/**
 * 把 r4 的检查点挂到产品的 engineState.lab 上，其余字段原样保留。
 *
 * 不整体替换产品检查点：`tasks` / `questions` / `rectify` 归产品，
 * r4 只拥有 `engineState.lab`。混为一谈会让产品的进度统计读到一个 r4 形状的对象。
 */
export function patchCheckpoint(base, labState) {
  const next = structuredClone(base ?? {tasks: [], questions: {}});
  next.version = CHECKPOINT_VERSION;
  next.engineState = {...(next.engineState ?? {}), kernel: LAB_ENGINE.id, lab: labState ?? {}};
  return next;
}

/**
 * 把一道题记进产品检查点。
 *
 * # 为什么必须写 `tasks[].questionIds`
 *
 * 产品的进度统计（`checkpointCount`）、足额判定（`engineComplete`）和本适配层的
 * 去重，读的都是 `tasks[].questionIds`。适配层若只调 `onQuestion` 而不写它，
 * 会同时坏两件事：
 *
 * 1. 进度永远显示 0 道，`engineComplete` 永远为假；
 * 2. 下次恢复时去重集合是空的，**同一批题会被再发一遍**（实测复现过）。
 *
 * 位次按「累计题数 < 计划题数」找第一个空位，与 r3 的做法一致；
 * 找不到空位说明引擎交的题多于计划，按错误处理而不是静默丢弃。
 */
export function recordQuestion(checkpoint, question) {
  const next = structuredClone(checkpoint ?? {tasks: [], questions: {}});
  next.tasks ??= [];
  next.questions ??= {};
  const index = next.tasks.findIndex(task => (task.questionIds ?? []).length < (task.plannedCount ?? task.count ?? Infinity));
  const slot = index >= 0 ? next.tasks[index] : (next.tasks.push({questionIds: [], state: 'running'}), next.tasks.at(-1));
  slot.questionIds ??= [];
  if (!slot.questionIds.includes(question.id)) slot.questionIds.push(question.id);
  slot.state = 'completed';
  slot.error = null;
  next.questions[question.id] = question;
  return next;
}

/**
 * r4 题目 → 题库形状。
 *
 * 必须走 core-study 的 `bankQuestion`，不能在这里自造一份：它是把引擎原生题目
 * 规整成题库形状的唯一入口（补 pointKey / courseId / provenance / basis），
 * 自造一份就是本仓明令禁止的「同一件事两份实现」。
 * 未注入时（纯单测）退回一个最小形状，并在 provenance 里留下 `normalizer`
 * 标出「这条没有经过产品规整」。
 */
export function toBankQuestion(question, input, hosts) {
  const tasks = input.plan?.tasks ?? [];
  const index = tasks.findIndex(task => (task.point?.id && (question.coveredNodeIds ?? []).includes(task.point.id)) || task.point?.id === input.plan?.tasks?.[0]?.point?.id);
  const task = tasks[index >= 0 ? index : 0] ?? {point: {}, type: question.type, strategy: question.strategy};
  const provenance = {engine: LAB_ENGINE.id, kernel: KERNEL_VERSION, familyId: question.familyId, ideaId: question.ideaId, libraryKey: question.libraryKey, revision: question.revision};
  if (typeof hosts.bankQuestion === 'function') {
    const banked = hosts.bankQuestion(question, {...task, type: question.type, strategy: question.strategy}, provenance);
    return {...banked, coveredPointIds: question.coveredNodeIds ?? []};
  }
  return {
    ...question,
    type: question.type ?? task.type,
    strategy: question.strategy ?? task.strategy,
    pointId: task.point?.id,
    pointKey: undefined,
    status: 'proposed',
    reviewState: 'ready',
    choices: question.choices ?? [],
    attempts: [],
    provenance: {...provenance, normalizer: 'lab-minimal'},
    coveredPointIds: question.coveredNodeIds ?? [],
    createdAt: new Date().toISOString(),
  };
}
