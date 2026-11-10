/**
 * 网关与网络诊断：直连能不能到校园网、网关能不能到、会话还有没有效。
 *
 * # 它回答什么问题
 *
 * 用户报「查不到数据」时，可能的原因有四五层，症状却一样：校外没开网关、
 * 网关账号没填、网关会话过期、校园网本身不通、目标站点自己挂了。没有诊断，
 * 排查就得靠猜。
 *
 * 这个模块把四件事分开问，每件都给一个可执行的下一步：
 *
 * | 探测 | 说明 |
 * | --- | --- |
 * | 公网可达 | `zjuam.zju.edu.cn` —— 它不通说明本机根本没网 |
 * | 校园网可达 | **必须用一个只在校内的站**（`api.cc98.org`），不能用教务网 |
 * | 网关可达 | `webvpn.zju.edu.cn/login` |
 * | 会话有效 | 缓存里的 ticket 服务端还认不认 |
 *
 * # 与上游的一处关键差异（架构约束，不是选择）
 *
 * 上游 `doctor()`（`doctor.ts:31-71`）自己 `readProfile()` 读账号密码。本包是
 * **tier 0**：不依赖任何业务包，也就不该知道凭据从哪来。所以这里的账号密码是
 * **参数传进来的**，由调用方（`source/login` 或设置页）负责读取。
 *
 * 这不是妥协 —— 它让这个模块可以在测试里完全离线跑，也让「凭据从哪来」
 * 这件事只有一个真源。
 *
 * # 探测地址的选择依据
 *
 * 上游在 `doctor.ts:9-11` 留了注释：「zdbk is public; only an actual campus host
 * can establish campus reachability」。这与本仓 D4 裁决的发现是同一件事 ——
 * 教务网、学在浙大、智云实测都公网可达，用它们探测校园网会**永远成功**，
 * 从而把「校外」误判成「校内」。
 */

/** 只在校内可达的站 —— 用它判断「直连能不能进校园网」。 */
export const CAMPUS_PROBE_HOST = 'api.cc98.org';
/** 公网站 —— 用它判断「本机有没有网络」。 */
export const PUBLIC_PROBE_URL = 'https://zjuam.zju.edu.cn/cas/login';

/**
 * 一次探测：计时并吞掉异常，把结果整理成统一形状。
 *
 * @param fn - 实际探测动作，返回一个带 `status` 的对象。
 * @returns `{ ok, ms, status?, error? }`。
 */
async function timed(fn) {
  const at = performance.now();
  try {
    const value = await fn();
    return { ok: true, status: value?.status ?? 0, ms: Math.round(performance.now() - at) };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - at), error: String(error?.code ?? error?.message ?? error) };
  }
}

/**
 * 跑一次诊断。
 *
 * @param options.fetch - 出口函数，签名同 `globalThis.fetch`。**必须走 sharedFetch**，
 *   否则会落到宿主为 LLM 配的全局代理上（实测：浙大域名经海外代理 7 秒后 ECONNRESET）。
 * @param options.timeout - 每次探测的超时（毫秒），默认 5000。
 * @param options.transport - 当前出口模式（`'auto' | 'direct' | 'webvpn'`），只用于报告。
 * @param options.credentials - `{ username, password }` 或 null。**由调用方读好传入。**
 * @param options.session - 带 jar 的会话对象（有则探测会话有效性）。
 * @param options.probeSession - 会话探测函数；不传则跳过那一项。
 * @returns 诊断报告。
 */
export async function doctor({
  fetch: fetchImpl = globalThis.fetch,
  timeout = 5000,
  transport = 'auto',
  credentials = null,
  probeSession = null,
} = {}) {
  /** 一次带超时的请求。 */
  const request = (url, init = {}) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });

  const hasCredentials = Boolean(credentials?.username && credentials?.password);
  const report = {
    transport,
    direct: { campus: false, public: false },
    webvpn: { reachable: false, credentials: hasCredentials },
    ok: false,
    advice: [],
  };

  // 三个探测并行：它们是独立的网络事实，串行只会让用户多等。
  const [publicProbe, campusProbe, vpnProbe] = await Promise.all([
    timed(() => request(PUBLIC_PROBE_URL, { redirect: 'manual' })),
    timed(() => request(`https://${CAMPUS_PROBE_HOST}/`, { redirect: 'manual' })),
    timed(() => request('https://webvpn.zju.edu.cn/login', { redirect: 'manual' })),
  ]);

  // 5xx 说明「连上了但服务自己有问题」，这与「连不上」在排查上是两回事；
  // 但两者都不能证明校园网可达，所以仍然算 false。
  report.direct.public = publicProbe.ok && publicProbe.status > 0 && publicProbe.status < 500;
  report.direct.campus = campusProbe.ok && campusProbe.status > 0 && campusProbe.status < 500;
  report.direct.ms = campusProbe.ms;
  if (!campusProbe.ok) report.direct.error = campusProbe.error;

  report.webvpn.reachable = vpnProbe.ok && vpnProbe.status === 200;
  report.webvpn.ms = vpnProbe.ms;
  if (!vpnProbe.ok) report.webvpn.error = vpnProbe.error;

  if (hasCredentials && report.webvpn.reachable && typeof probeSession === 'function') {
    try {
      report.webvpn.sessionValid = await probeSession();
    } catch (error) {
      report.webvpn.sessionValid = false;
      report.webvpn.sessionError = String(error?.code ?? error?.message ?? error);
    }
  }

  /* ── 结论与下一步 ─────────────────────────────────────────── */

  if (transport === 'webvpn') {
    report.ok = report.webvpn.reachable && hasCredentials;
    if (!report.webvpn.reachable) report.advice.push('webvpn.zju.edu.cn 不可达，先检查这台机器能不能上公网');
    if (!hasCredentials) report.advice.push('还没有填 WebVPN 的「上网账号」与密码（注意：与统一身份认证是两套系统）');
    if (report.webvpn.sessionValid === false) {
      report.advice.push('网关会话没有建立或已过期；登录要验证码时，可以从浏览器导入 ticket');
    }
  } else if (transport === 'direct') {
    report.ok = report.direct.campus;
    if (!report.direct.campus) report.advice.push('当前是直连模式但校园网不可达；在校外时请改走 WebVPN');
  } else {
    // auto：只要有一条路能用就算 ok。
    report.ok = report.direct.campus || (report.webvpn.reachable && hasCredentials);
    if (!report.direct.campus && !report.webvpn.reachable) {
      report.advice.push('校园网与网关都不可达，先确认本机能上公网');
    } else if (!report.direct.campus && !hasCredentials) {
      report.advice.push('人在校外且没有填网关账号；要么连校园网，要么补上「上网账号」');
    }
  }

  if (!report.direct.public) {
    report.advice.push('zjuam.zju.edu.cn 不可达，统一身份认证也无法进行');
  }
  return report;
}
