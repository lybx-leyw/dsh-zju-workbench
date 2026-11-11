/**
 * 上游**锁版凭据** —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * ── 版本号为什么写在这两个文件里，而不只写在 package.json ──────────────
 *
 * 上游 `WebVpnService` 是**自渲染 HTTP 客户端**（`fetchWithRedirects` + HTML 登录页解析），
 * 小版本就可能改登录页结构、改 `convertUrl` 的端口写法、改重定向判定。
 * 本包要挂到 `source-cc98` 的出口上，挂不进去时**不会报错**，只会表现为
 * 「校外还是连不上」—— 和没装这个包一模一样，排查成本极高。
 * 所以版本号在两处各写一遍，`^` 一律不用。
 *
 * ── LOCK_CONFLICT：本候选**最大**的落地阻塞（评审请先看这一节）──────────
 *
 * 1. **令牌存储错位**。上游 `Cc98Client` 构造要求 `tokenStore` 满足
 *    `getAccessToken / getRefreshToken / save / (saveAccount)`。本仓 `TokenStore`
 *    （`source-cc98/src/token.js`）形状相近但是另一个类，**且必须保持是唯一刷新器**：
 *    CC98 的 refresh_token 是一次性轮换，两个刷新器并存必然互相踢下线。
 *    ⇒ 适配层只能「读」上游、不能让它触发刷新。`Cc98Client` 的 `refreshPromise`
 *    内部合流管不到这一点。
 *
 * 2. **全局 fetch**。上游 `dist/api/*.js` 直接调全局 `fetch`，绕开宿主的
 *    `sharedFetch` / 代理 / 超时策略。若上游不提供注入点，这条**无法绕开**，
 *    则本包不能以「锁版库」方式落地，只能做**能力提取**（读它的状态机源码、
 *    在本仓 `egress.js` 里重写）—— 那样分级应从 🟢 降 🟡，且本包的
 *    `dependencies` 应当删掉（改判「纯参考」）。
 *
 * 3. **只借 `WebVpnService`，不构造 `Cc98Client`**。上游客户端有 60+ 方法，
 *    其中 `replyTopic` / `createTopic` / `sendMessage` / `favoriteTopic` / `reactToPost`
 *    全是**写**操作。`source-cc98` 的只读是刻意设计（其文件头第 1 条边界），
 *    本包绝不把它打开。
 *
 * 在 1/2 未定之前，本包**只留占位**，不挂载。
 */

export const UPSTREAM_PACKAGE = '@walavave/cc98-cli';

/** 必须与 `package.json` 的 `dependencies` 逐字符相同。 */
export const UPSTREAM_VERSION = '0.4.1';

/** 上游**唯一**允许被 import 的模块。其余（含 `main.js` 入口）一律不碰。 */
export const ALLOWED_IMPORT = '@walavave/cc98-cli/dist/api/webvpn.js';

/** 该模块必须导出的符号；缺一个就说明上游改结构了，适配层应**硬失败**而非静默降级。 */
export const REQUIRED_EXPORTS = Object.freeze(['WebVpnService']);

/**
 * `WebVpnService` 上本包**会调用**的方法（白名单）。不在表里的一律不调 ——
 * 尤其是 `fetch` 之外的任何写操作。
 */
export const ALLOWED_METHODS = Object.freeze([
  'getStatus',      // { enabled, loggedIn, inCampusNetwork? } —— 决定要不要走网关
  'checkNetwork',   // mirrors.zju.edu.cn 探测，判断是否已在校内网
  'loadCookies',    // 网关会话注入（由本仓会话存储提供，不用上游的文件存储）
  'login',          // → { success, needCaptcha, needConfirm, captchaId }
  'confirmLogin',
  'convertUrl',     // ⚠ 与本仓 toWebvpnUrl() 等价 —— 见 README 的「无增益」说明
]);

/**
 * 本包**想要**、本仓**没有**的能力。评审时对照这个表判断「是否真有强化」。
 * 若某项被证明本仓已在别处实现，从表里划掉；表空了就说明本候选无增益。
 */
export const DESIRED_CAPABILITY = Object.freeze({
  /** 会话过期判定：非登录页请求被 302 到登录页 ⇒ 过期（而不是业务站说没登录）。 */
  redirectToLoginMeansExpired: true,
  /** 三段式登录：图形码 / 确认页是**正常状态**，需回传 `captchaId` 而非抛异常。 */
  loginStateMachine: true,
  /** 网关凭据落点独立于 CC98 OAuth2 账号与统一认证账号。 */
  separateCredentialRecord: true,
});

/**
 * 占位：返回**不可用**状态。适配层尚未实现，调用方看到 `available:false`
 * 必须回落到直连（保持 `source-cc98` 现有行为），不得据此改变错误码。
 */
export function upstreamStatus() {
  return {
    available: false,
    reason: 'skeleton-only',
    upstream: `${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}`,
  };
}
