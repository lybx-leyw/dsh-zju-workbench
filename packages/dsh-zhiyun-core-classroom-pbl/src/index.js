// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:95-196（Planner 入口）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:330-573（Instructor 角色 / 里程碑 / 微任务 / 完成门）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/evaluator.ts:259-324（评分落库的字段口径）
// 源：ref/OpenMAIC/eval/pbl-v2-planner/runner.ts:95-110（量规维度入口）
// 源：ref/OpenMAIC/lib/pbl/v2/types.ts:1-160（项目 / 提交物 / 评估的对外形状）

/**
 * Cordis 包装（薄）：取宿主服务与可选 llm，把 PBL 能力挂成
 * `ctx.zhiyunClassroomPbl`。
 *
 * 与 `dsh-zhiyun-core-classroom-agent` / `dsh-zhiyun-core-lecture` 同一形态：
 * - 算法在 `planner.js` / `project.js` / `rubric.js` / `grade.js` / `briefing.js`，
 *   全部可脱离宿主单测；
 * - 本文件只做「取依赖 + provide + 卸载」；
 * - **模块顶层不 new 任何客户端**，LLM 调用一律走注入（`config.llm`）。
 *
 * # apply() 永不因上游缺失而抛错
 *
 * 规范 §4：课堂子系统没搬完应该表现为 `status().state`，而不是让整个
 * profile 起不来。`ctx` 缺失、`provide` 抛错、studio 没装、llm 没配，
 * 四种情况都只降级 + 记日志。
 *
 * # 为什么 inject 只有 studio
 *
 * `llm` 是可选增强（没有模型时仍有 `buildPlan` / `rubric` / `briefing`
 * 三条零调用路径），写进 inject 会让本包在上游未配置模型时一直 pending。
 * 这条规矩与 `host-classroom` / `host-deeptutor` 的原话一致。
 */

import { createPblService, PBL_PACKAGE_VERSION } from './service.js';
import { PblError, ERROR_KINDS } from './errors.js';

export const name = 'zhiyun-classroom-pbl';

/** 规范 §4：领域包只 declare 它消费的宿主服务。 */
export const inject = ['zhiyunClassroomStudio'];

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {{ call?: Function }} [config.llm] 窄 llm 接口（可选）
 * @param {object} [config.logger]
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const log = config.logger ?? {
    debug: (...args) => ctx?.logger?.debug?.('[zhiyun-classroom-pbl]', ...args),
    info: (...args) => ctx?.logger?.info?.('[zhiyun-classroom-pbl]', ...args),
    warn: (...args) => ctx?.logger?.warn?.('[zhiyun-classroom-pbl]', ...args),
    error: (...args) => ctx?.logger?.error?.('[zhiyun-classroom-pbl]', ...args),
  };

  let studio = null;
  try {
    studio = ctx?.zhiyunClassroomStudio ?? ctx?.get?.('zhiyunClassroomStudio') ?? null;
  } catch (error) {
    log.warn('读取 zhiyunClassroomStudio 失败（按缺失处理）', error?.message ?? error);
  }
  if (!studio) {
    log.warn('zhiyunClassroomStudio 尚未提供：PBL 服务以降级形态上线（status().state=degraded）');
  }

  let service;
  try {
    service = createPblService({ studio, llm: config.llm ?? null, log });
  } catch (error) {
    // 构造本身不该失败；真失败了也要让 profile 活着，给一个只会报错的壳。
    log.error('PBL 服务构造失败', error?.message ?? error);
    service = createDegradedService(error);
  }

  let removeService = () => {};
  try {
    removeService = ctx?.provide?.('zhiyunClassroomPbl', service) ?? (() => {});
  } catch (error) {
    log.error('zhiyunClassroomPbl 注册失败（服务名可能已被占用）', error?.message ?? error);
  }

  try {
    ctx?.on?.('dispose', () => {
      try {
        removeService();
      } catch (error) {
        log.warn('卸载时注销 zhiyunClassroomPbl 失败', error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  log.info(
    `PBL 就绪：studio=${studio ? 'injected' : 'missing'}，llm=${config.llm ? 'injected' : 'fallback'}`,
  );

  return () => {
    try {
      service.dispose();
    } catch (error) {
      log.warn('卸载 PBL 服务时出错', error?.message ?? error);
    }
    try {
      removeService();
    } catch (error) {
      log.warn('卸载时注销 zhiyunClassroomPbl 失败', error?.message ?? error);
    }
  };
}

function createDegradedService(error) {
  const fail = () => {
    throw new PblError('CONFIG', `PBL 服务未初始化：${error?.message ?? error}`);
  };
  return {
    version: '0.0.0',
    plan: fail,
    buildPlan: fail,
    rubric: fail,
    grade: fail,
    briefing: fail,
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

export { createPblService, PBL_PACKAGE_VERSION } from './service.js';
export { PblError, ERROR_KINDS };
export { planProject, normalizeBrief, parseJsonResponse, skeletonGaps, microtaskGaps } from './planner.js';
export {
  buildPlan,
  emptyProject,
  hydrateProject,
  normalizeProjectRuntime,
  normalizeScenario,
  normalizeSynthesisChecks,
  plannerCompletionGaps,
  deliverablesOf,
  totalMicrotasks,
  findMilestoneAndTask,
  newId,
  SCENARIO_SCHEMA_VERSION,
  MAX_SYNTHESIS_STAGES,
  PBL_SIMULATOR_AGENT_ID,
} from './project.js';
export {
  buildRubric,
  inspectRubric,
  RUBRIC_VERSION,
  RUBRIC_DIMENSION_KEYS,
} from './rubric.js';
export { gradeSubmission, parseEvaluationTail, normalizeScore, normalizeStars } from './grade.js';
export { buildBriefing, formatScenarioTranscript } from './briefing.js';
export { computeInitialAssessment, detectExplicitProficiency, scoreToTier } from './proficiency.js';

export const PACKAGE_VERSION = PBL_PACKAGE_VERSION;
