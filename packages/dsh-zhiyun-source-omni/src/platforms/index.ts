/**
 * 平台装配：按配置启用哪些平台，并为每个平台建好「客户端 + 读取器」。
 *
 * # 与上游的差别（移植改造点）
 *
 * 上游这里同时装配 MCP 工具（`xzzdTools(runtime.xzzd)` 之类），把结果塞进
 * `runtime.tools` 交给 `app.ts` 注册成 AI 可调用的工具。
 *
 * 本仓**不要工具层**：这是一个**数据包**，对外只暴露数据读取能力
 * （`runtime.zdbk.reader.timetable(...)` 这种）。谁来消费 —— 页面、AI 工具、
 * 脚本 —— 由调用方决定，本包不预设。理由：工具层是「面向某个具体客户端」的
 * 适配，把它钉在这里，将来接页面时就要绕开它；而数据层本身与消费方无关。
 *
 * 所以本文件只做装配，不产出 tools。上游的 `platforms/<平台>/tools.ts` 已随移植删除。
 */

import type { PlatformId } from '../core/config.ts';
import type { AppContext } from '../core/context.ts';
import type { SessionClient } from '../core/session.ts';
import { createXzzd, type XzzdServices } from './xzzd/index.ts';
import { createZdbk, type ZdbkServices } from './zdbk/index.ts';
import { createCc98, type Cc98Services } from './cc98/index.ts';
import { createPta, type PtaServices } from './pta/index.ts';
import { createXxt, type XxtServices } from './xxt/index.ts';
import { createZhiyun, type ZhiyunServices } from './zhiyun/index.ts';

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  xzzd: '学在浙大',
  zdbk: '教务（本科生院）',
  zhiyun: '智云课堂',
  pta: '拼题A',
  cc98: 'CC98',
  xxt: '学习通',
};

export const IMPLEMENTED_PLATFORMS: ReadonlySet<PlatformId> = new Set(['xzzd', 'zdbk', 'zhiyun', 'pta', 'cc98', 'xxt']);

export interface Runtime {
  ctx: AppContext;
  xzzd?: XzzdServices;
  zdbk?: ZdbkServices;
  zhiyun?: ZhiyunServices;
  pta?: PtaServices;
  cc98?: Cc98Services;
  xxt?: XxtServices;
  clients: Map<PlatformId, SessionClient>;
}

export function createRuntime(ctx: AppContext): Runtime {
  const runtime: Runtime = { ctx, clients: new Map() };
  if (ctx.cfg.platforms.has('xzzd')) {
    runtime.xzzd = createXzzd(ctx);
    runtime.clients.set('xzzd', runtime.xzzd.client);
  }
  if (ctx.cfg.platforms.has('zdbk')) {
    runtime.zdbk = createZdbk(ctx);
    runtime.clients.set('zdbk', runtime.zdbk.client);
  }
  if (ctx.cfg.platforms.has('zhiyun')) {
    runtime.zhiyun = createZhiyun(ctx);
    runtime.clients.set('zhiyun', runtime.zhiyun.client);
  }
  if (ctx.cfg.platforms.has('pta')) {
    runtime.pta = createPta(ctx);
  }
  if (ctx.cfg.platforms.has('cc98')) {
    runtime.cc98 = createCc98(ctx);
    runtime.clients.set('cc98', runtime.cc98.client);
  }
  if (ctx.cfg.platforms.has('xxt')) {
    runtime.xxt = createXxt(ctx);
  }
  return runtime;
}
