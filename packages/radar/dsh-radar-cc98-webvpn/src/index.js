/**
 * dsh-radar-cc98-webvpn —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑。`apply()` 直接抛错 ——
 * 目的与 `dsh-radar-paper-coach` 相同：万一有人误挂，**立刻响**，
 * 而不是静默转成一个什么都不做的包。
 *
 * ═══ 这个包想做什么（强化式集成，不是新建功能）═══════════════════════
 *
 * `dsh-zhiyun-source-cc98` 对外只有 10 个只读方法（`index.js` 的 `METHODS`）：
 *
 *   search / topic / hot / newTopics / boards / boardTopics / user /
 *   notifications / conversations / messages
 *
 * 它们全部直连 `api.cc98.org`。人在校外时必然失败，且本包**刻意**只回一个
 * 诚实的错误码（`WEBVPN_REQUIRED`，见 `source-cc98/src/index.js` 的 `invoke` 兜底）：
 *
 *   > 本包只做直连：请确认在校园网内，或通过一条能连上 api.cc98.org 的出口再试。
 *
 * 这条决定本身是对的 —— 少一条出口少一类难复现的故障。但它留下一个明确缺口：
 * **校外用户拿不到任何 CC98 数据**，而「宿舍/家里刷一下 98」正是该场景的主动机。
 *
 * 本包**不新增任何方法、不新增任何页面**。它就是让上面那 10 个方法在校外也能通。
 *
 * ═══ 强化式集成的三条判据（逐条核对）═══════════════════════════════
 *
 *   ① **仍是同一个面板** —— 不注册页面、不注册 slot；调用方仍是那 10 个
 *      `cc98.*` 方法，参数与返回值形状不变。
 *   ② **功能仍相似正交** —— 同一个「读 98」，只多一条**出口**；不是第二个论坛客户端。
 *   ③ **底层多调了更优质的实现** —— 这是本候选**唯一**的立论，也是它必须先被审的地方：
 *
 *      上游 `@walavave/cc98-cli@0.4.1` 的 `WebVpnService` 提供三样本仓没有的东西：
 *
 *      (a) **网关会话的失败判定**：`fetchWithRedirects()` 在 3xx 时先看
 *          `isLoginPageUrl(nextUrl)`，只在「**非**登录页请求被重定向到登录页」时判会话过期。
 *          本仓 `source-campus/webvpn/protocol.js` 只有 `isWebvpnLoginUrl(url)` 这个**纯谓词**，
 *          「什么时候据此判过期、过期后怎么续」在 `egress.js` 里，且**没有为 cc98 接过线**。
 *      (b) **ticket / captcha / 确认页三段式登录**：`login()` 返回
 *          `{ success, needCaptcha, needConfirm, captchaId }`，把「输入图形码」
 *          与「点确认」当成**正常流程的两个状态**，而不是异常。
 *      (c) **凭据来源分家**：`vpn-store` 自己存网关凭据，与 CC98 OAuth2 账号、
 *          与统一认证**三者分开**。本仓 `source-campus/webvpn/login.js` 的注释里
 *          已经点明「网关登录用上网账号，与统一身份认证是两套系统」——
 *          但 cc98 这条链路压根没有网关凭据的落点。
 *
 * ═══ 判据③的**反驳**（评审请务必先读这一节）═══════════════════════
 *
 * 上游的 `convertUrl()` 与**本仓新写入的** `toWebvpnUrl()` 是**等价实现**：
 *
 *   - 同 key `wrdvpnisthebest!`，同 `AES-128-CFB`，同「hex(key) 前缀」；
 *   - 同特殊端口约定 `https-8443`（上游 `isSpecialPort`，本仓 `target.port ? `${scheme}-${port}``）；
 *   - 上游 `host` 段多一层 `encodeURIComponent`（本仓直接拼，非 hex 字符本来也不出现）。
 *
 * 也就是说：**URL 改写这一层没有净增益**——本仓自己的实现是更晚写入的，
 * 且已带 `fromWebvpnUrl()` 反向解码。真正有增量的是上面 (a)(b)(c) 的**会话状态机**。
 *
 * ⇒ 若评审认为「会话状态机」属于 `dsh-zhiyun-net-proxy` / `source-campus`
 *   的职责、应由那里统一补齐（而非为 cc98 单开一个包），
 *   **本包应整目录删除**，registry 的「重复且可强化」改为「重复且无增益」。
 *   这一判断本次无法自动作出，故只出骨架、不挂载。
 *
 * ═══ 形态说明：为什么它是 B 类，却仍锁了一个 npm 包 ═══════════════════
 *
 * 上游**不是** DSH 插件：`package.json` 里没有 `dsh.bundle.patch`、没有
 * `cordis.patch.yml`、没有 `dsh.client`，`bin` 只指向 `dist/main.js`（一个 CLI）。
 * 但它**导出为库**（`dist/api/client.js` 的 `Cc98Client`、`dist/api/webvpn.js` 的
 * `WebVpnService` 都有 `.d.ts`），且 **npm 上有发行版**（`@walavave/cc98-cli@0.4.1`，
 * 2026-09-02 发布，`dependencies: {}` 零运行时依赖，`engines.node >= 20`）——
 * 锁版因此**成立且便宜**（不进一棵依赖树）。
 *
 * 所以：按「有没有 DSH 形状」判 **B 类**，按「能不能锁版引入」保留 `dependencies`。
 * 这与 `dsh-radar-cc98-sdk` 的处境相反（那个上游 npm 404，锁版不成立）。
 *
 * ═══ 落地阻塞（评审前必须确认）══════════════════════════════════════
 *
 * LOCK 1 · **`Cc98Client` 的构造契约是「自己的令牌存储 + 自己的 WebVPN」**。
 *          `ClientOptions` 要求 `tokenStore` 实现
 *          `getAccessToken / getRefreshToken / save / (saveAccount)`。
 *          本仓已有 `source-cc98/src/token.js` 的 `TokenStore`（含 refresh 合流与
 *          `expires_at` 预判），**形状相近但不是同一个类**。接入时只能写一层薄适配，
 *          不能让上游去刷新令牌 —— 否则本仓会同时存在两个刷新器，抢同一个 refresh_token
 *          （CC98 的 refresh 是一次性轮换，抢刷必然互相踢下线）。
 *
 * LOCK 2 · **上游的 `fetch` 是全局 `fetch`**（`dist/api/*.js` 里直接调）。
 *          DSH 宿主有 `sharedFetch` / 代理与 `Transport` 抽象；直接调全局
 *          `fetch` 会绕开代理设置与超时策略。接入前必须确认能否注入。
 *
 * LOCK 3 · **写侧方法一大堆**：`replyTopic` / `createTopic` / `sendMessage` /
 *          `favoriteTopic` / `reactToPost` …（见 `dist/api/client.d.ts`）。
 *          本包**只用** `WebVpnService` 这一个类，**不构造** `Cc98Client`、
 *          **不调用**任何写方法。这是硬边界 —— `source-cc98` 的
 *          「只读、无可改论坛状态的入口」是刻意设计，不能被这个包破坏。
 *
 * LOCK 4 · **Node >= 20**。与本仓其它包一致，无额外要求；记录在此以免 CI 换镜像时踩坑。
 *
 * ═══ 上游事实（2026-11-03 核实）═══════════════════════════════════════
 *
 *   仓库      oionus/CC98-CLI（**非 fork**；README 自述「改版自 Lucent-Snow/CC98-CLI」）
 *   许可证    MIT ✅（GitHub `/license` API 返回 `spdx_id: MIT` 与根 `LICENSE` 实文
 *             1060 B，`Copyright (c) 2026 Walavave`；npm manifest 亦 `"license": "MIT"` —— 三处互证）
 *   规模      src/ ≈ 30+ 文件；`api/webvpn.ts` 10.2 KB、`api/client.ts` 18.4 KB
 *   活跃      2026-05-28 创建 / 2026-09-02 最近推送 / v0.4.1 已发 npm
 *   与已登记签  本仓 registry 已登记其**上游** `Lucent-Snow/CC98-CLI`（★20，MIT，
 *             2026-08-05 推，npm 404）。**两者同源不同实现，归一取一**：
 *             取本候选，因为 (i) npm 有发行版 → 可锁版；(ii) 有 WebVPN/RVPN
 *             与三段式登录 → 正是本包要的那块；(iii) 更近的推送。
 *             ⚠ 归一意味着评审通过时应把 `Lucent-Snow/CC98-CLI` 那行标 superseded。
 *             ⚠ 两个账号（`oionus` / `walavave`）的对应关系**未能核实**，
 *               npm 包 `repository` 字段指向 `walavave/CC98-CLI`（403/不存在）。
 *               这不影响 MIT 许可效力，但**发布方身份未独立验证** —— 建议人工过目。
 */

export const UPSTREAM_PACKAGE = '@walavave/cc98-cli';

/** 锁死：上游小版本就可能改 `WebVpnService` 的构造与重定向判定，`^` 会让注入点静默失效。 */
export const UPSTREAM_VERSION = '0.4.1';

/** 本包**只**接触上游这两个文件的两个类；其余一律不 import。 */
export const UPSTREAM_ENTRY = Object.freeze({
  webvpn: '@walavave/cc98-cli/dist/api/webvpn.js',
  client: '@walavave/cc98-cli/dist/api/client.js',
});

/**
 * 上游能被复用的能力 —— 与「本仓已有」逐条对照，避免评审时把等价实现误判为增益。
 *
 * `gain` 为 `none` 的项：**本仓已有等价或更新的实现**，接入时不要引上游这一份。
 */
export const CAPABILITY_MATRIX = Object.freeze([
  {
    id: 'url-rewrite',
    upstream: 'WebVpnService.convertUrl()',
    local: 'dsh-zhiyun-source-campus/src/webvpn/protocol.js → toWebvpnUrl()',
    gain: 'none',
    note: '同 key / 同 AES-128-CFB / 同 hex 前缀 / 同特殊端口约定。本仓另有 fromWebvpnUrl() 反向解码。不要引上游这一份。',
  },
  {
    id: 'url-decode',
    upstream: '无（上游 only 正向）',
    local: 'protocol.js → fromWebvpnUrl()',
    gain: 'local-only',
    note: '本仓有、上游没有。接入后**继续用本仓**。',
  },
  {
    id: 'gateway-redirect-judgement',
    upstream: 'WebVpnService.fetchWithRedirects() + isLoginPageUrl()',
    local: 'protocol.js 只有 isWebvpnLoginUrl() 谓词；判过期策略在 egress.js，且未为 cc98 接线',
    gain: 'strong',
    note: '「非登录页请求被 302 到登录页」才判过期——这条**状态机**是本候选的主要增量。',
  },
  {
    id: 'three-stage-login',
    upstream: 'WebVpnService.login() → { needCaptcha, needConfirm, captchaId }',
    local: 'source-campus/webvpn/login.js（有登录页解析，无 captcha/confirm 状态回报）',
    gain: 'strong',
    note: '把图形码与确认页当正常状态而非异常，用户侧提示才不会变成「密码错了」。',
  },
  {
    id: 'ticket-lifecycle',
    upstream: 'ticket cookie 持久化 + login 页重定向触发重取',
    local: 'webvpnJar() 会话级，cc98 链路无落点',
    gain: 'strong',
    note: '仅当 LOCK 2 解决（能注入 fetch/凭据）才有意义。',
  },
  {
    id: 'credential-separation',
    upstream: 'vpn-store（网关凭据独立于 CC98 OAuth2 与统一认证）',
    local: 'source-campus 注释已声明两套系统不同，但无 cc98 侧落点',
    gain: 'medium',
    note: '本仓的账户卡片（source-card）已按 CC98 / WebVPN / 一卡通三分。新增落点须沿用同一分区，**不得**复用 `zhiyun-cc98/account`。',
  },
  {
    id: 'cc98-api-surface',
    upstream: 'Cc98Client（60+ 方法，含大量写方法）',
    local: 'source-cc98 的 10 个只读方法',
    gain: 'negative',
    note: '⛔ 不用。写方法会破坏 source-cc98「只读」的刻意边界（同 dsh-cc98-duty 被拒的理由）。',
  },
]);

/**
 * 骨架阶段**只允许**做的一件事：把 `WebVpnService` 当纯状态机，喂它一个
 * 「逻辑 URL → Response」的测试替身，验证 (a)(b)(c) 三条能否在下游无侵入地成立。
 * 评审通过前**不要**写进任何业务路径。
 */
export const ADAPTER_POINTS = Object.freeze([
  'source-cc98/src/client.js —— 现有 Transport 的出口选择处插入 egress 分支',
  'source-cc98/src/index.js:invoke 的 WEBVPN_REQUIRED 兜底 —— 有网关时改为先试网关再回落',
  'source-card/src/index.js:CC98_RECORD_KEY 旁**新增**网关凭据记录（不复用 CC98 那条）',
]);

export const name = 'dsh-radar-cc98-webvpn';

/**
 * 占位实现：**不挂载任何东西**，直接抛错。
 *
 * 待办（评审通过后再写）：
 *   1. 用 `WebVpnService` 的单测替身验证 LOCK 1 / LOCK 2 是否可绕开（不上线，仅本地验证）；
 *   2. 若可绕开 → 写 `src/egress.js`，只在 `PREFERRED=webvpn` 或直连失败时走；
 *   3. 若不可绕开 → 整目录删除，把「会话状态机」需求挂到 `dsh-zhiyun-net-proxy`。
 */
export function apply() {
  throw new Error(
    'dsh-radar-cc98-webvpn 是候选骨架，未评审、未接入 profile，不可挂载。'
    + '评审结论见 packages/radar/dsh-radar-cc98-webvpn/README.md。',
  );
}

export default { name, apply };
