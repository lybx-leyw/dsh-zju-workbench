import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ToolError } from './errors.ts';

export const PROFILES = ['full', 'lite'] as const;
export type Profile = (typeof PROFILES)[number];

export const ALL_PLATFORMS = ['xzzd', 'zdbk', 'zhiyun', 'pta', 'cc98', 'xxt'] as const;
export type PlatformId = (typeof ALL_PLATFORMS)[number];

/**
 * 未设置 `ZJU_PLATFORMS` 时启用哪些平台。
 *
 * ⚠️ **移植改造点**：上游这里是 `['xzzd','zdbk','zhiyun','pta','cc98']`（含 `zhiyun`）。
 * 本仓把它去掉了，理由是本仓的智云能力由 `dsh-zhiyun-classroom` 提供，两边都开会
 * **各登录一次 CAS、各存一份会话**（重复且互相干扰）。想要上游那份智云读取能力
 * （比如它的 PPT 时间轴）时，显式写 `ZJU_PLATFORMS=...,zhiyun` 即可。
 *
 * 这份默认值是**唯一真源**：宿主半边直接用它，不再自持一份（早先两处各写一份，
 * 改一处另一处就静默漂移，测试立刻抓到过）。
 */
export const DEFAULT_PLATFORMS: PlatformId[] = ['xzzd', 'zdbk', 'pta', 'cc98'];

export const NETWORK_MODES = ['auto', 'direct', 'webvpn'] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

export interface Config {
  profile: Profile;
  platforms: ReadonlySet<PlatformId>;
  network: NetworkMode;
  dataDir: string;
  timeoutMs: number;
  maxFileBytes: number;
  minIntervalMs: number;
  storageHosts: string[];
}

type Env = Record<string, string | undefined>;

/**
 * 工具档位（`full` / `lite`）。
 *
 * ⚠️ 移植说明：上游用这个值决定注册多少 MCP 工具。本包**不做工具层**，
 * 所以它已经不影响任何数据行为 —— 保留只是为了两件事：
 *
 *   1. 读得懂上游留下的 `ZJU_OMNI_DATA_DIR` / `MCP_TOOL_PROFILE` 环境变量，
 *      不会因为用户照旧导出它们而报错；
 *   2. 上游日后若调整档位语义，本包同步过来时不用再改这里。
 *
 * 因此**非法值不再抛错**，退回 `full` 并留给调用方去警告 —— 数据层不该因为一个
 * 与它无关的变量而整个起不来。
 */
export function toolProfile(env: Env = process.env): Profile {
  const value = String(env.MCP_TOOL_PROFILE ?? 'full').trim().toLowerCase() || 'full';
  return (PROFILES as readonly string[]).includes(value) ? (value as Profile) : 'full';
}

export function enabledPlatforms(env: Env = process.env): Set<PlatformId> {
  const raw = (env.ZJU_PLATFORMS ?? '').trim();
  if (!raw) return new Set(DEFAULT_PLATFORMS);
  const out = new Set<PlatformId>();
  for (const item of raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (!(ALL_PLATFORMS as readonly string[]).includes(item)) {
      throw new ToolError('CONFIG_ERROR', `ZJU_PLATFORMS 含未知平台：${item}。可选：${ALL_PLATFORMS.join(', ')}`);
    }
    out.add(item as PlatformId);
  }
  if (!out.size) throw new ToolError('CONFIG_ERROR', 'ZJU_PLATFORMS 至少要启用一个平台。');
  return out;
}

export function networkMode(env: Env = process.env): NetworkMode {
  const value = String(env.ZJU_NETWORK ?? 'auto').trim().toLowerCase() || 'auto';
  if (!(NETWORK_MODES as readonly string[]).includes(value)) {
    throw new ToolError('CONFIG_ERROR', `ZJU_NETWORK 只能是 ${NETWORK_MODES.join('、')}，收到：${value}`);
  }
  return value as NetworkMode;
}

function nonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ToolError('CONFIG_ERROR', `${name} 必须是非负整数。`);
  return n;
}

/**
 * 本地状态目录的默认值。
 *
 * 上游写的是 `~/.local/share/zju-omni`（XDG 惯例，macOS/Linux 上合适）。
 * Windows 上那会变成一个藏在用户目录里、既非 `%APPDATA%` 也非 `%LOCALAPPDATA%`
 * 的怪路径，用户根本找不到，清理时也想不到。所以按平台分开：
 * Windows 用 `%LOCALAPPDATA%\zju-omni`，其他平台沿用上游的 XDG 路径。
 *
 * ⚠️ 实际接入 DSH 时这个默认值基本用不到：宿主半边会把 `ZJU_OMNI_DATA_DIR`
 *    指到 profile 自己的 `data/zhiyun-omni`（与本仓其他包的落盘位置一致，
 *    也才能跟着 profile 一起被备份/清理）。这里只是让 CLI 单独跑时有个像样的落点。
 */
export function defaultDataDir(env: Env = process.env): string {
  if (env.ZJU_OMNI_DATA_DIR) return resolve(env.ZJU_OMNI_DATA_DIR);
  const home = homedir();
  return process.platform === 'win32'
    ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'zju-omni')
    : join(home, '.local', 'share', 'zju-omni');
}

export function loadConfig(env: Env = process.env): Config {
  return {
    profile: toolProfile(env),
    platforms: enabledPlatforms(env),
    network: networkMode(env),
    dataDir: defaultDataDir(env),
    timeoutMs: 25000,
    maxFileBytes: 100 * 1024 * 1024,
    minIntervalMs: nonNegativeInt(env.ZJU_MIN_INTERVAL_MS, 200, 'ZJU_MIN_INTERVAL_MS'),
    storageHosts: (env.ZJU_XZZD_STORAGE_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}
