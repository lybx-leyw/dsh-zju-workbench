// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:44-55（PlannerV2Error 的 kind + partial 语义）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:106-112,788-793（校验失败时带 partial 抛错）

/**
 * PBL 领域错误。
 *
 * 上游用 `PlannerV2Error(message, partial)` 一个类承担「planner 失败」的
 * 全部语义；本仓的领域包统一用 `kind` + `detail`，让调用方能按种类分支
 * （失败重试 / 降级 / 展示），而不是去 `instanceof` 一个上游类名。
 */
export const ERROR_KINDS = Object.freeze([
  /** 没有注入窄 llm，或注入的形状不对 */
  'CONFIG',
  /** llm 调用本身失败（网络 / provider / 空响应） */
  'LLM',
  /** 响应不是可用的 JSON */
  'PARSE',
  /** 结构化但不过完成门（缺里程碑 / 缺微任务 / 场景骨架不完整） */
  'PLAN_INVALID',
  /** rubric 形状不合法（缺 dimensions / 版本不符） */
  'RUBRIC',
  /** 评分输入与 rubric / plan 对不上（找不到 microtask 等） */
  'GRADE',
  /** 服务已关闭 */
  'DISPOSED',
]);

export class PblError extends Error {
  /**
   * @param {string} kind
   * @param {string} message
   * @param {object} [detail] 附加事实（gaps / project / partial 等）
   */
  constructor(kind, message, detail = {}) {
    super(message, detail.cause ? { cause: detail.cause } : undefined);
    this.name = 'PblError';
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'CONFIG';
    this.detail = detail;
    /** 上游 `PlannerV2Error.partial` 的同义词：失败时已构造出的半成品项目。 */
    this.partial = detail.project ?? null;
  }
}
