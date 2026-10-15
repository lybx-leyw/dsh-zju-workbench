/**
 * 跨平台认证的**数据函数**（原上游文件名为 `tools.ts`，移植时改名）。
 *
 * # 为什么改名
 *
 * 上游这个文件里有两半：`authStatus` / `authLogin` / `authForget` 是纯粹的
 * 数据操作，而文件末尾的 `authTools()` 是把它们包成 MCP 工具定义的适配器。
 * 移植时删掉了适配器那一半（本包不做工具层），只留数据函数 ——
 * 名字里的 `tools` 就名不副实了，改成 `auth/actions.ts`。
 *
 * 消费方想把它当工具用，自己包一层即可（这是本仓刻意保持的边界：
 * 数据包不该规定自己只能被谁调用）。
 */

import { ALL_PLATFORMS, type PlatformId } from '../core/config.ts';
import { ToolError } from '../core/errors.ts';
import { ACCOUNT_KINDS, backendLabel } from '../core/keychain.ts';
import { PTA_SETUP } from '../platforms/pta/client.ts';
import { XXT_SETUP } from '../platforms/xxt/client.ts';
import { IMPLEMENTED_PLATFORMS, PLATFORM_LABELS, type Runtime } from '../platforms/index.ts';

export async function authStatus(runtime: Runtime, { platform, check = false }: { platform?: PlatformId; check?: boolean } = {}) {
  const { ctx } = runtime;
  const targets = platform ? [platform] : [...ctx.cfg.platforms];
  const credentials = await Promise.all(ACCOUNT_KINDS.map(kind => ctx.accounts.status(kind)));
  const platforms = [];
  for (const id of targets) {
    const enabled = ctx.cfg.platforms.has(id);
    const implemented = IMPLEMENTED_PLATFORMS.has(id);
    const stored = await ctx.sessions.read(id).catch(() => null);
    const row: Record<string, unknown> = {
      platform: id,
      name: PLATFORM_LABELS[id],
      enabled,
      implemented,
      session: stored ? { mode: stored.mode, saved_at: stored.saved_at } : null,
    };
    const client = runtime.clients.get(id);
    if (id === 'pta' && runtime.pta) {
      row.cookie = await runtime.pta.client.status();
      if (check) row.live = await runtime.pta.client.check();
    } else if (id === 'xxt' && runtime.xxt) {
      row.cookie = await runtime.xxt.client.status();
      if (check) row.live = await runtime.xxt.client.checkLogin();
    } else if (id === 'cc98' && runtime.cc98) {
      if (check) row.live = await runtime.cc98.client.check();
    } else if (check && client) row.live = await client.check();
    platforms.push(row);
  }
  const webvpn = await ctx.sessions.read('webvpn').catch(() => null);
  return {
    network: ctx.cfg.network,
    profile: ctx.cfg.profile,
    // 移植改造：提示语按平台说出**实际**用的凭据后端（Windows 是 DPAPI，不是钥匙串）。
    credentials: credentials.map(({ kind, configured, backend }) => ({ kind, configured, backend })),
    credential_backend: backendLabel(),
    webvpn_session: webvpn ? { saved_at: webvpn.saved_at } : null,
    platforms,
    note: `凭据只保存在本机（${backendLabel()}）；未配置时让用户在本机终端运行 npm run configure -- zju。不返回密码或 Cookie。`,
  };
}

export async function authLogin(runtime: Runtime, platform: PlatformId) {
  if (!runtime.ctx.cfg.platforms.has(platform)) throw new ToolError('PLATFORM_DISABLED', `${PLATFORM_LABELS[platform]} 未启用。请在 ZJU_PLATFORMS 中加入 ${platform}。`);
  if (platform === 'xxt') throw new ToolError('COOKIE_IMPORT_REQUIRED', '学习通登录常弹滑块验证码，不做自动登录。请在浏览器登录学习通后，在本机终端运行导入命令。', { setup_command: XXT_SETUP });
  if (platform === 'pta') throw new ToolError('COOKIE_IMPORT_REQUIRED', '拼题A 登录需要短信验证，不做自动登录。请在浏览器登录 pintia.cn 后，在本机终端运行导入命令。', { setup_command: PTA_SETUP });
  if (platform === 'cc98' && runtime.cc98) {
    await runtime.cc98.client.login({ explicit: true });
    const me = await runtime.cc98.client.me();
    return { platform, authenticated: true, name: me?.name ?? null, message: '已登录 CC98。' };
  }
  const client = runtime.clients.get(platform);
  if (!client) throw new ToolError('PLATFORM_NOT_IMPLEMENTED', `${PLATFORM_LABELS[platform]} 尚未实现登录。`);
  const session = await client.refreshSession({ explicit: true });
  return { platform, authenticated: true, mode: session.mode, saved_at: session.stored.saved_at, message: `已连接${PLATFORM_LABELS[platform]}（${session.mode === 'webvpn' ? '经 WebVPN' : '直连'}）。` };
}

export async function authForget(runtime: Runtime, { platform, remove_credentials = false }: { platform?: PlatformId; remove_credentials?: boolean } = {}) {
  const { ctx } = runtime;
  const removed: string[] = [];
  const targets = platform ? [platform] : [...ALL_PLATFORMS];
  for (const id of targets) if (await ctx.sessions.remove(id)) removed.push(id);
  if (!platform) {
    if (await ctx.sessions.remove('webvpn')) removed.push('webvpn');
    ctx.network.clearSso();
  }
  const credentials: string[] = [];
  if (remove_credentials) {
    const kinds = platform === 'cc98' ? (['cc98'] as const) : platform === 'xxt' ? (['xxt'] as const) : platform ? (['zju'] as const) : ACCOUNT_KINDS;
    for (const kind of kinds) if (await ctx.accounts.remove(kind)) credentials.push(kind);
  }
  return {
    removed_sessions: removed,
    removed_credentials: credentials,
    message: remove_credentials
      ? `已删除会话和对应的本机凭据（${backendLabel()}）。若凭据通过环境变量提供，请同时移除启动环境变量。`
      : '已删除会话；本机保存的账号保留，下次调用会自动重新登录。',
  };
}
