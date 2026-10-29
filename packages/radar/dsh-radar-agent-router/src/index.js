/**
 * dsh-radar-agent-router · 入口占位
 *
 * ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件只打一行日志，不注册槽位 / RPC / 设置分节 / 路由。
 * 真正的挂载要等评审通过后，在 `apply()` 里：
 *
 *   1. `const upstream = await import('dsh-llm-agentrouter')`（锁版 2.6.1）；
 *   2. 调用上游 `apply(ctx, config)` —— 由上游自己去 `override: llm-pi-ai`、
 *      注册设置卡片、安装出站围栏；
 *   3. 本包**不**再自己声明 provider 路由：重复声明会让模型选择器里出现
 *      两个 AgentRouter 分组（上游 README「为什么是一条路由」整节就是讲这个）。
 *
 * 见 `src/upstream.js` 的 `UPSTREAM_OVERRIDES` —— 那是评审必须过的第一道关。
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION, loadUpstream } from './upstream.js';

export const name = 'dsh-radar-agent-router';

/**
 * Cordis 插件入口（占位）。
 *
 * @param ctx - 宿主上下文。骨架阶段**不碰**它，避免「装作已挂载」。
 */
export async function apply(ctx) {
  void ctx;
  const probe = await loadUpstream();
  console.info(
    `[${name}] candidate skeleton — 未挂载。upstream ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION} probe=${probe.reason}`,
  );
}

export default { name, apply };
