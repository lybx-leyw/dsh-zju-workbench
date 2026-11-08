// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:95-196（plan 入口签名）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/evaluator.ts:330-431（评分入口 runTaskEvaluation 的参数形状）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-prompts.ts:518-569（最终报告入口，briefing 对应）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-single-call.ts:477-578（结构化输出 + 重试）

/**
 * `ctx.zhiyunClassroomPbl` 的领域服务实现。
 *
 * 五个方法各自对应上游的一段能力：
 * - `plan`      ← Planner（多阶段推理，走注入 llm）
 * - `buildPlan` ← Planner 的确定性装配段（hydrate + 归一化 + 完成门，零 LLM）
 * - `rubric`    ← eval/pbl-v2-planner 的评审量规（零 LLM）
 * - `grade`     ← Evaluator（task 级评分，走注入 llm；无 llm 时本地降级）
 * - `briefing`  ← Hero / 简报的确定性渲染（零 LLM）
 */

import { PblError } from './errors.js';
import { planProject } from './planner.js';
import { buildPlan as buildPlanProject } from './project.js';
import { buildRubric } from './rubric.js';
import { gradeSubmission } from './grade.js';
import { buildBriefing } from './briefing.js';

export const PBL_PACKAGE_VERSION = '0.1.0';

/**
 * @param {object} [config]
 * @param {object|null} [config.studio] 宿主 `zhiyunClassroomStudio`（可缺失）
 * @param {{call?:Function}|null} [config.llm] 窄 llm
 * @param {object} [config.log]
 */
export function createPblService(config = {}) {
  const { studio = null, llm = null } = config;
  const log = config.log ?? {};
  let closed = false;

  const ensureOpen = () => {
    if (closed) throw new PblError('DISPOSED', 'PBL 服务已关闭');
  };

  const service = {
    version: PBL_PACKAGE_VERSION,

    /** PBL v2 Planner（多阶段：骨架 → 逐阶段拆解 → 完成门）。 */
    async plan(brief, opts = {}) {
      ensureOpen();
      return planProject(brief, opts, { llm, log });
    },

    /** 程序化建项目（零 LLM；与 plan 共用同一条 hydration 路径）。 */
    buildPlan(spec = {}, opts = {}) {
      ensureOpen();
      return buildPlanProject(spec, opts);
    },

    /** 评分量规（12 维恒定 + 随项目派生的阶段判据）。 */
    rubric(plan) {
      ensureOpen();
      return buildRubric(plan);
    },

    /** 按量规评一份提交物。 */
    async grade(submission, rubric, opts = {}) {
      ensureOpen();
      return gradeSubmission(submission, rubric, opts, { llm, log });
    },

    /** 学习者可见的项目简报（确定性，零 LLM）。 */
    briefing(plan, opts = {}) {
      ensureOpen();
      return buildBriefing(plan, opts);
    },

    async status() {
      return {
        state: llm ? 'ready' : 'degraded',
        version: PBL_PACKAGE_VERSION,
        detail: {
          studio: studio ? 'injected' : 'missing',
          llm: llm ? 'injected' : 'missing',
          methods: ['plan', 'buildPlan', 'rubric', 'grade', 'briefing'],
          closed,
        },
      };
    },

    dispose() {
      closed = true;
    },

    get closed() {
      return closed;
    },
  };

  return service;
}
