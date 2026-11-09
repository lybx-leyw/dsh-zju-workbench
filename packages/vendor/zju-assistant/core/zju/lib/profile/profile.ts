/**
 * 账号与学籍，也就是原来的 profile.env。都由桌面端维护，这里只读：
 *   <档案目录>/accounts.json   系统凭据库保护的账号密文，旧明文首次读取时自动迁移
 *   <档案目录>/identity.json   学院、专业、年级、培养层次，在设置的「个人档案」最上面的基础信息里填写
 * 哪个键在哪个插件里填，以应用的 ui/profile/catalog.mjs 为准；那边的 catalog.test.mjs 核对两处的键和插件名对得上。
 */
import fs from "node:fs";
import path from "node:path";
import { profileDir } from "../core/paths.ts";
import { ConfigError, NeedsUser } from "../core/errors.ts";
import { readAccountFile } from "../core/account-file.mjs";

export type Transport = "webvpn" | "direct";

/** accounts.json 里的键 */
export const ACCOUNT_KEYS = [
  "zju_username",
  "zju_password",
  "webvpn_username",
  "webvpn_password",
  "transport",
  "cc98_username",
  "cc98_password",
  "pta_username",
  "pta_password",
  "chaoxing_username",
  "chaoxing_password",
  "lab_username",
  "lab_password",
  "tyys_card_password",
  "tyys_buddy_username",
  "tyys_buddy_password",
] as const;
/** identity.json 里本技能用到的键 */
export const IDENTITY_KEYS = ["grade", "major_code", "major_name", "college", "student_level"] as const;
export const PROFILE_KEYS = [...ACCOUNT_KEYS, ...IDENTITY_KEYS] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export type ProfileRaw = Partial<Record<ProfileKey, string>>;

const SECRET_KEYS: ReadonlySet<string> = new Set(["zju_password", "webvpn_password", "cc98_password", "pta_password", "chaoxing_password", "lab_password", "tyys_card_password", "tyys_buddy_password"]);

/** 出错时告诉使用者去哪里填 */
export const ACCOUNT_PAGE = "应用的「插件」页";

function readObject(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(`读不了 ${file}`, err instanceof Error ? err.message : String(err));
  }
}

/** 账号文件和学籍合在一起的全部键（小写）。多账号等动态键用这个。 */
export function readProfileAll(): Record<string, string> {
  const out: Record<string, string> = {};
  let accounts: Record<string, unknown>;
  try { accounts = readAccountFile(path.join(profileDir(), "accounts.json")).data; }
  catch (err) { throw new ConfigError("无法解锁校园账号", err instanceof Error ? err.message : "请检查系统凭据库。安全存储失败时不会退回明文。"); }
  for (const [k, v] of Object.entries(accounts)) if (typeof v === "string" && v) out[k.toLowerCase()] = v;
  const identity = readObject(path.join(profileDir(), "identity.json"))["values"];
  if (identity && typeof identity === "object") {
    for (const k of IDENTITY_KEYS) {
      const v = (identity as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
  }
  return out;
}

/** 只返回档案键 */
export function readProfile(): ProfileRaw {
  const all = readProfileAll(), out: ProfileRaw = {};
  for (const k of PROFILE_KEYS) if (all[k]) out[k] = all[k]!;
  return out;
}

/** 展示用：密码替换为是否已填 */
export function publicProfile(): Record<string, string | boolean> {
  const p = readProfile();
  const out: Record<string, string | boolean> = {};
  for (const k of PROFILE_KEYS) out[SECRET_KEYS.has(k) ? k.replace("password", "password_set") : k] = SECRET_KEYS.has(k) ? !!p[k] : (p[k] ?? "");
  return { ...out, cc98_accounts: cc98Accounts().map((a) => `${a.index}:${a.username}`).join(", ") };
}

export function credentials(): { username: string; password: string } {
  const p = readProfile();
  if (!p.zju_username || !p.zju_password) {
    throw new NeedsUser("缺少统一身份认证凭据", `在${ACCOUNT_PAGE}打开「校园账号」，填写学号和密码`);
  }
  return { username: p.zju_username, password: p.zju_password };
}

/** WebVPN 凭据独立，不回退到统一认证 */
export function webvpnCredentials(): { username: string; password: string } {
  const p = readProfile();
  if (!p.webvpn_username || !p.webvpn_password) {
    throw new NeedsUser("缺少 WebVPN 凭据（与统一认证不是同一套账号）", `在${ACCOUNT_PAGE}打开「校园账号」，填写 WebVPN 的账号和密码`);
  }
  return { username: p.webvpn_username, password: p.webvpn_password };
}

export interface Cc98Account {
  /** 1 起 */
  index: number;
  username: string;
  password: string;
}

/**
 * CC98 多账号：cc98_username / cc98_password 为第 1 个，cc98_username_2 / cc98_password_2 … 依次递增。
 * 缺密码的条目跳过。
 */
export function cc98Accounts(): Cc98Account[] {
  const all = readProfileAll();
  const out: Cc98Account[] = [];
  const indices = new Set<number>();
  for (const k of Object.keys(all)) {
    const m = k.match(/^cc98_username(?:_(\d+))?$/);
    if (m) indices.add(m[1] ? Number(m[1]) : 1);
  }
  for (const i of [...indices].sort((a, b) => a - b)) {
    const suffix = i === 1 ? "" : `_${i}`;
    const username = all[`cc98_username${suffix}`];
    const password = all[`cc98_password${suffix}`];
    if (username && password) out.push({ index: i, username, password });
  }
  return out;
}

/** 按 --account 选账号：可给用户名或 1 起的序号；不给则第 1 个 */
export function cc98Account(selector?: string): Cc98Account {
  const list = cc98Accounts();
  if (!list.length) throw new NeedsUser("缺少 CC98 账号", `在${ACCOUNT_PAGE}打开「校园社区」，填写 CC98 的账号和密码`);
  if (!selector) return list[0]!;
  const byName = list.find((a) => a.username.toLowerCase() === selector.toLowerCase());
  if (byName) return byName;
  if (/^\d+$/.test(selector)) {
    const byIndex = list.find((a) => a.index === Number(selector));
    if (byIndex) return byIndex;
  }
  throw new ConfigError(`找不到 CC98 账号 "${selector}"`, `已配置：${list.map((a) => `${a.index}:${a.username}`).join(", ")}`);
}

export function currentTransport(): Transport {
  const t = readProfile().transport;
  return t === "direct" ? "direct" : "webvpn";
}

/** PTA / 百腾独立账号，不回退到校园凭据。 */
export function ptaCredentials(): { username: string; password: string } {
  const p = readProfile();
  if (!p.pta_username || !p.pta_password) throw new NeedsUser("缺少 PTA 账号", `在${ACCOUNT_PAGE}打开「课程与作业」，填写 PTA 的邮箱和密码`);
  return { username: p.pta_username, password: p.pta_password };
}

/** 超星学习通独立账号（手机号），不回退到校园凭据。 */
export function chaoxingCredentials(): { username: string; password: string } {
  const p = readProfile();
  if (!p.chaoxing_username || !p.chaoxing_password) throw new NeedsUser("缺少超星学习通账号", `在${ACCOUNT_PAGE}打开「学习资料」，填写超星的手机号和密码`);
  return { username: p.chaoxing_username, password: p.chaoxing_password };
}
