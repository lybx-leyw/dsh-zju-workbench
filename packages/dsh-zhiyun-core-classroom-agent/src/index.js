/**
 * Cordis 包装（薄）：从注入项取宿主服务与可选 llm，把编排能力挂成
 * `ctx.zhiyunClassroomAgent`。
 *
 * 与 `dsh-zhiyun-core-lecture/src/index.js` 同一形态：
 * - 算法在 `src/orchestrator.js` 与各搬运文件里，可脱离宿主单测；
 * - 本文件只做「取依赖 + provide + 卸载」；
 * - **模块顶层不 new 任何客户端**，网络/LLM 调用一律走注入（`config.llm`）。
 *
 * # apply() 永不因上游缺失而抛错
 *
 * 规范 §4 与 `host-deeptutor` 的约定：课堂还没搬完应该表现为 `status().state`，
 * 而不是让整个 profile 起不来。所以：`ctx` 缺失、`ctx.provide` 抛错、studio 没装，
 * 三种情况都只降级 + 记日志。
 */

import { createAgentService } from './orchestrator.js';
import { ClassroomAgentError } from './errors.js';

export const name = 'zhiyun-classroom-agent';

/** 规范 §4：领域包只 declare 它消费的宿主服务。 */
export const inject = ['zhiyunClassroomStudio'];

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {{ call?: Function, stream?: Function }} [config.llm] 窄 llm 接口（可选）
 * @param {object} [config.logger]
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const log = config.logger ?? {
    debug: (...args) => ctx?.logger?.debug?.('[zhiyun-classroom-agent]', ...args),
    info: (...args) => ctx?.logger?.info?.('[zhiyun-classroom-agent]', ...args),
    warn: (...args) => ctx?.logger?.warn?.('[zhiyun-classroom-agent]', ...args),
    error: (...args) => ctx?.logger?.error?.('[zhiyun-classroom-agent]', ...args),
  };

  let studio = null;
  try {
    studio = ctx?.zhiyunClassroomStudio ?? ctx?.get?.('zhiyunClassroomStudio') ?? null;
  } catch (error) {
    log.warn('读取 zhiyunClassroomStudio 失败（按缺失处理）', error?.message ?? error);
  }
  if (!studio) {
    log.warn('zhiyunClassroomStudio 尚未提供：课堂智能体以降级形态上线（status().state=degraded）');
  }

  let service;
  try {
    service = createAgentService({ studio, llm: config.llm ?? null, log });
  } catch (error) {
    // 构造本身不该失败；真失败了也要让 profile 活着，给一个只会报错的壳。
    log.error('课堂智能体服务构造失败', error?.message ?? error);
    service = {
      async plan() {
        throw new ClassroomAgentError('CONFIG', '课堂智能体服务未初始化');
      },
      run() {
        throw new ClassroomAgentError('CONFIG', '课堂智能体服务未初始化');
      },
      async cancel() {
        return false;
      },
      runs: { get: () => null, list: () => [] },
      async status() {
        return {
          state: 'degraded',
          version: '0.0.0',
          detail: { error: error?.message ?? String(error) },
        };
      },
    };
  }

  let removeService = () => {};
  try {
    removeService = ctx?.provide?.('zhiyunClassroomAgent', service) ?? (() => {});
  } catch (error) {
    log.error('zhiyunClassroomAgent 注册失败（服务名可能已被占用）', error?.message ?? error);
  }

  try {
    ctx?.on?.('dispose', () => {
      try {
        removeService();
      } catch (error) {
        log.warn('卸载时注销 zhiyunClassroomAgent 失败', error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  log.info(
    `课堂智能体就绪：studio=${studio ? 'injected' : 'missing'}，llm=${config.llm ? 'injected' : 'fallback'}`,
  );

  return () => {
    try {
      removeService();
    } catch (error) {
      log.warn('卸载课堂智能体时出错', error?.message ?? error);
    }
  };
}

export { createAgentService, parseAgentOutput, buildStoreState } from './orchestrator.js';
export { planScenes, resolveSceneOutline, SCENE_TYPES } from './scene.js';
export { buildDirectorPrompt, buildChildPrompt, buildUserPrompt } from './prompts.js';
export { getEffectiveActions, buildActionTools, normalizeActionItem } from './actions.js';
export { createDirectorRun, createAbortableSend } from './state-machine.js';
export { scheduleTurn, validateSchedule, selectFirstSpeaker } from './scheduling.js';
export { ClassroomAgentError, ERROR_KINDS } from './errors.js';
export { AGENT_PACKAGE_VERSION } from './orchestrator.js';
