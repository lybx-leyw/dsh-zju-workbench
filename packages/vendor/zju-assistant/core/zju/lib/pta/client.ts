import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CookieJar, type HttpResponse, type RequestOptions } from "../core/http.ts";
import { AuthExpired, BadResponse, ConfigError, NeedsUser, RateLimited, RemoteRejected } from "../core/errors.ts";
import { paths } from "../core/paths.ts";
import { log } from "../core/output.ts";
import type { ModuleRequirements } from "../core/module.ts";
import { ACCOUNT_PAGE, ptaCredentials, readProfile } from "../profile/profile.ts";
import { SessionStore } from "../zjuam/session.ts";
import { openContext, type Context } from "../webvpn/transport.ts";
import type { PtaApi } from "./types.ts";
import { verifyCaptcha, type VerifyCaptcha } from "./verification.ts";

export const ORIGIN = "https://pintia.cn";
const PASSPORT = "https://passport.pintia.cn";
export const requirements: ModuleRequirements = { name: "pta", title: "PTA", hosts: ["pintia.cn", "passport.pintia.cn"], auth: "own", network: "public", writes: true, sessionProbe: `${PASSPORT}/api/u/current` };
export const accountKey = (username: string) => crypto.createHash("sha256").update(username.trim().toLowerCase()).digest("hex").slice(0, 24);
export function sessionStore(username = readProfile().pta_username ?? "") {
  return new SessionStore({ system: `pta-${accountKey(username)}`, username, ttlMs: 30 * 24 * 3600 * 1000 });
}
interface CurrentUser { user?: { id: string; email?: string; nickname?: string; [key: string]: unknown }; requireMfa?: boolean; [key: string]: unknown }

// 旧版 MD5(固定 Chrome/142 User-Agent)，所有新用户得到同一个值，不能继续复用。
const SHARED_FINGERPRINT = "3c9fc7ddec9b58823c1c96756dbd45d8";
function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value) && value.toLowerCase() !== SHARED_FINGERPRINT;
}
function clientFingerprint(username: string, previous: unknown): string {
  const file = path.join(paths.data(), "pta", "fingerprints", `${accountKey(username)}.json`);
  const read = () => {
    let raw: string;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    let saved: { version?: number; fingerprint?: unknown } | undefined;
    try { saved = JSON.parse(raw); } catch { /* 损坏的标识不能静默轮换。 */ }
    if (saved?.version === 1 && validFingerprint(saved.fingerprint)) return saved.fingerprint;
    throw new ConfigError("PTA 本地客户端指纹文件损坏", `检查 ${file}；不会在登录重试时自动更换指纹`);
  };
  const saved = read();
  if (saved) return saved;
  const fingerprint = validFingerprint(previous) ? previous : crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, fingerprint }) + "\n", { flag: "wx", mode: 0o600, flush: true });
  try {
    // 发布完整文件且不覆盖已有值；并发启动时所有进程读取同一份指纹。
    try { fs.linkSync(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { fs.unlinkSync(temporary); }
  const persisted = read();
  if (!persisted) throw new ConfigError("PTA 客户端指纹未能保存", `检查 ${file} 的目录权限`);
  return persisted;
}

export class Pta implements PtaApi {
  readonly username: string;
  readonly store: SessionStore;
  private readonly password: string;
  private readonly ctx: Context;
  private readonly fingerprint: string;
  private ready: Promise<CurrentUser> | undefined;
  private refresh: Promise<CurrentUser> | undefined;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly verify: VerifyCaptcha;
  constructor(ctx: Context, credentials: { username: string; password: string }, verify: VerifyCaptcha = verifyCaptcha) {
    this.ctx = ctx; this.username = credentials.username; this.password = credentials.password;
    this.verify = verify;
    this.store = sessionStore(this.username);
    const saved = this.store.load();
    if (saved) ctx.http.jar = saved.jar;
    // 本地客户端标识按账号持久化，独立于 Cookie；失败或会话过期不会重新生成。
    // 它不是浏览器环境指纹，也不能替代 PTA 要求的验证码。
    this.fingerprint = clientFingerprint(this.username, saved?.extra.fingerprint);
  }
  private headers() {
    return { Accept: "application/json;charset=UTF-8", "Content-Type": "application/json;charset=UTF-8", "Accept-Language": "zh-CN", Origin: ORIGIN, Referer: `${ORIGIN}/`, "X-Lollipop": this.fingerprint, "X-Marshmallow": "" };
  }
  private send(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const request = this.queue.then(async () => {
      const wait = 350 - (Date.now() - this.lastRequestAt);
      if (wait > 0) await delay(wait);
      this.lastRequestAt = Date.now();
      return this.ctx.fetch(url, options);
    });
    this.queue = request.catch(() => undefined);
    return request;
  }
  private decode<T>(res: HttpResponse): T {
    const data = res.json<Record<string, unknown> & { error?: { code?: string; message?: string } }>();
    const code = data?.error?.code ?? "";
    if (res.status === 429) {
      const raw = res.headers["retry-after"];
      const seconds = typeof raw === "string" ? Number(raw) : NaN;
      const wait = Number.isFinite(seconds) ? seconds * 1000 : typeof raw === "string" ? Date.parse(raw) - Date.now() : 30000;
      throw new RateLimited("PTA 请求过于频繁，请稍后再试；可以 --keyword 缩小历史作业范围", Number.isFinite(wait) ? Math.max(1000, wait) : 30000);
    }
    if (/CAPTCHA/.test(code)) {
      throw new NeedsUser(`PTA 验证未通过（${code}）`, "本次已停止，不循环提交；稍后重新查询或在官网完成验证");
    }
    if (/MFA/.test(code)) throw new NeedsUser(`PTA 登录需要二次验证（${code}）`, "在官网完成二次验证后导入本人会话");
    if (/WRONG_PASSWORD|INVALID_PASSWORD|INVALID_CREDENTIAL|WRONG_EMAIL|USER_NOT_FOUND/.test(code)) {
      throw new NeedsUser(`PTA 账号或密码未通过（${code}）`, `核对${ACCOUNT_PAGE}中 PTA 的邮箱和密码，不要反复尝试`);
    }
    if (res.status === 401 || /NOT_LOGIN|NOT_LOGGED_IN|UNAUTHORIZED|SESSION_EXPIRED|NEED_LOGIN/.test(code)) throw new AuthExpired("pta");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new BadResponse(`PTA 返回非 JSON 对象（HTTP ${res.status}）`, { status: res.status });
    if (res.status >= 400 || data.error) throw new RemoteRejected(`PTA 请求被拒绝（${code || res.status}）`, { status: res.status, code });
    return data as T;
  }
  private save() { this.store.save(this.ctx.http.jar, { fingerprint: this.fingerprint }); }
  private async current(): Promise<CurrentUser> {
    const data = this.decode<CurrentUser>(await this.send(`${PASSPORT}/api/u/current`, { headers: this.headers() }));
    if (!data.user?.id || data.user.id === "0") throw new AuthExpired("pta");
    if (data.user.email?.toLowerCase() !== this.username.toLowerCase()) throw new NeedsUser("PTA 会话的账号和填写的邮箱不是同一个", `核对${ACCOUNT_PAGE}里「课程与作业」的 PTA 邮箱，或重新登录正确账号`);
    return data;
  }
  login(fresh = false): Promise<CurrentUser> {
    // 失败的 promise 保留，避免同一客户端反复提交错误密码或验证码。
    return this.ready ??= this.resolveLogin(fresh);
  }
  private async resolveLogin(fresh: boolean): Promise<CurrentUser> {
    if (!fresh && this.ctx.http.jar.get("PTASession", ORIGIN)) {
      try { const me = await this.current(); this.save(); return me; }
      catch (error) { if (!(error instanceof AuthExpired)) throw error; }
    }
    this.ctx.http.jar = new CookieJar();
    await this.send(`${ORIGIN}/auth/login`);
    const credentials = { email: this.username, password: this.password, rememberMe: true };
    const submit = (body: typeof credentials & { ticket?: string; randStr?: string }) => this.send(`${PASSPORT}/api/users/sessions`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body),
    });
    let response = await submit(credentials);
    if (response.status !== 429 && response.json<{ error?: { code?: string } }>()?.error?.code === "GATEWAY_WRONG_CAPTCHA") {
      log("PTA：登录需要验证，正在打开官方验证码组件");
      const proof = await this.verify();
      if (typeof proof?.ticket !== "string" || !proof.ticket || typeof proof.randStr !== "string" || !proof.randStr) {
        throw new BadResponse("PTA 验证未返回有效票据，本次未再次提交密码");
      }
      // 保留同一次登录的 Cookie 和指纹，只带成功票据续登一次；再次拒绝就停止。
      response = await submit({ ...credentials, ticket: proof.ticket, randStr: proof.randStr });
    }
    const result = this.decode<CurrentUser>(response);
    if (result.requireMfa) throw new NeedsUser("PTA 登录需要二次验证", "在官网正常登录后使用 pta session import-cookie --file 导入");
    if (!result.user?.id) throw new NeedsUser("PTA 登录未返回用户", "检查账号密码，或在官网完成验证后导入 Cookie");
    const me = await this.current();
    this.generation++; this.save(); log("PTA：独立账号登录成功");
    return me;
  }
  async me() {
    const data = await this.login();
    return { id: data.user!.id, email: data.user!.email, nickname: data.user!.nickname, transport: "direct", sessionFile: this.store.file };
  }
  async get<T>(endpoint: string): Promise<T> {
    await this.login(); const generation = this.generation;
    try { return await this.request<T>(endpoint, "GET"); }
    catch (error) {
      if (!(error instanceof AuthExpired)) throw error;
      if (generation === this.generation) await (this.refresh ??= this.resolveLogin(true));
      return this.request<T>(endpoint, "GET");
    }
  }
  async mutate<T>(endpoint: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
    await this.login();
    // 业务写入不自动重试；超时/失效交由 write.ts 回查。
    return this.request<T>(endpoint, method, body);
  }
  private async request<T>(endpoint: string, method: string, body?: unknown): Promise<T> {
    if (!endpoint.startsWith("/api/") || new URL(endpoint, ORIGIN).origin !== ORIGIN) throw new BadResponse("PTA 请求路径必须是本站 /api/ 路径");
    const response = await this.send(ORIGIN + endpoint, { method, headers: this.headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = this.decode<T>(response); this.save(); return result;
  }
  /** 只接受用户指定文件中的本站 Cookie；验证账号成功后才持久化。 */
  async importCookie(raw: string) {
    if (!raw.trim() || /[\r\n]/.test(raw.trim())) throw new BadResponse("Cookie 文件须为单行 Cookie 请求头");
    const jar = new CookieJar();
    for (const part of raw.trim().split(";")) {
      const at = part.indexOf("="); if (at < 1) continue;
      const name = part.slice(0, at).trim();
      if (["PTASession", "JSESSIONID"].includes(name)) jar.put(name, part.slice(at + 1).trim(), "pintia.cn", "/", true);
    }
    if (!jar.get("PTASession", ORIGIN)) throw new BadResponse("Cookie 中缺少 PTASession");
    this.ctx.http.jar = jar; const me = await this.current(); this.save(); this.ready = Promise.resolve(me);
    return this.me();
  }
  close() { this.ctx.close(); }
}
export async function openPta() {
  const credentials = ptaCredentials();
  return new Pta(await openContext(requirements, { timeout: 20000 }), credentials);
}
