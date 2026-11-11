/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-radar-ctx-compact/src/upstream.js` 与 `dsh-radar-paper-union/src/upstream.js`：
 *
 *   1. `package.json` 的依赖写**精确版本**（`0.2.0`，不是 `^0.2.0`）；
 *   2. 运行时再核对一次真实安装的版本（别人的 lockfile / `npm link` 能让声明的版本失真）；
 *   3. 锁版这件事必须有一条会红的校验 —— 本骨架**尚未**带测试（且按 skill 规定
 *      radar 包内**不得**有测试），评审通过后由维护者在 `tests/` 下另行补。
 *
 * ── 这个包为什么是「强化式集成」而不是「全新功能」───────────────────
 *
 * 「hook 按某个顺序跑」这件事**一直存在** —— 只是顺序**没人能声明**。
 *
 * Cordis 的 waterfall 监听器按**注册顺序**派发，唯一的杠杆是布尔 `prepend`；
 * 而注册顺序由 `inject` 依赖的激活顺序推动，**在上游互不知情的插件之间不确定**。
 * 上游 README 给的反例（不是假设）：
 *
 *     raw ctx.on, load order [auth, logging, metrics]  ->  auth, logging, metrics
 *     raw ctx.on, load order [metrics, logging, auth]  ->  metrics, logging, auth   ← 同一批插件，顺序翻了
 *
 * 缺的不是「顺序」这个概念，而是**对顺序的声明能力**。上游给的就是这个：
 *
 *   宿主原生原语                    @tengxiaohtx/dsh-plugin-hooks-ordering
 *   ─────────────────────────       ────────────────────────────────────────
 *   布尔 prepend（最后者胜）         before / after 命名约束
 *   顺序 = 注册时序（不可声明）      稳定拓扑排序（同一输入永远同一输出）
 *   跨 vendor 绑死要靠 inject 依赖   互不知情的插件也能各自声明相对位置
 *   无环检测                         OrderingCycleError（把环点名列出来）
 *
 * ⇒ 三条判据：
 *   ① 仍是同一个面板 —— 上游**不新增面板、不新增导航项、不新增命令**。
 *      它挂的是 Cordis service，改变的是既有 hook 的**执行次序**。
 *      这是判据①最强的一种形态：界面上连一个像素都不变。
 *   ② 功能仍相似正交 —— 同一组 hook、同一批订阅者、同一份输出；正交的是相对次序。
 *   ③ 底层多调了更优质实现 —— 见上表。其中「环检测」是**正确性**能力，
 *      不是体验优化：有环时宁可抛错也不给一个「看似排好了」的假顺序。
 *
 * ── 四条必须先解决的风险（评审别重查，直接看这里）──────────────────
 *
 *   R-1【阻塞·前提未证实】上游的论据是 **dsh 上游发行版**中 `agent/pre-step` 有
 *       十余个独立订阅者。**本仓不是那个发行版**：实测本仓
 *       `agent/pre-step` / `tools/post-execute` / `llm/stream` /
 *       `system-prompt/assemble` / `agent/turn-stopping` **订阅数全为 0**，
 *       `prepend` 关键字 0 处。⇒ 本包**当前收益为 0**，故障面却不小。
 *       唯一致使接入成立的前提是 TODO-0：本仓已装的第三方（`packages/vendor/`）
 *       里确实存在「同一 hook 上 ≥2 个互不知情订阅者且顺序敏感」。
 *       **证不出来就不要接** —— 这条与 `dsh-radar-ctx-compact` 的 R-1 不同：
 *       那边是「版本装不装得上」，这边是「问题存不存在」。
 *
 *   R-2【阻塞·加载位次】bracket 用 prepend。若本包在原生监听器注册前加载，
 *       后注册的原生插件再 prepend 就会落到 bracket 外，**逃出排序**。
 *       上游 patch 注释明写「Apply this layer LAST」。bundle patch 的位次
 *       由 profile 叠加顺序决定，**不是骨架能保证的**。
 *
 *   R-3【阻塞·风险面倒挂】上游默认控 13 个 waterfall + 1 个 serial hook。
 *       本仓一个都没用，却要为此承担「排序策略压过第三方插件隐式假设」的风险。
 *       本包因此把默认面收到 4 个（见 `cordis.patch.yml`），
 *       并规定**按 TODO-0 的实测清单逐条放行**。
 *
 *   R-4【阻塞·Node 版本】上游 `engines.node = ^22.19.0 || >=24.0.0`；
 *       本沙箱 Node **22.13.0**，低于下限。若宿主侧 Node 同为 22.x 早期版本，
 *       `pnpm`/`npm` 会报 engines 不匹配（`--engine-strict` 下直接拒装）。
 *       ⇒ 接入前必须核对**宿主运行时的 Node 版本**，不是沙箱的。
 *
 * ── 与本仓其他 hook / 插件相关骨架的关系（别混为一谈）─────────────────
 *
 *   dsh-radar-plugin-graph       插件**依赖/能力**关系图（静态）            —— 描述
 *   dsh-radar-plugin-caps        插件**能力**清单（静态）                   —— 描述
 *   dsh-radar-diff-approval      编辑**审批**（消费 diff，不关心顺序）      —— 动作
 *   dsh-radar-hook-order         hook **执行次序**（运行时干预）           —— 干预 ← 本包
 *
 *   三者的关系：前两个回答「谁依赖谁」，第三个回答「这段改动接受不接受」，
 *   本包回答「同一段链上谁先跑」。**不重叠**。
 *   但本包与前两个**天然配合**：依赖图能画出「哪些插件落在同一 hook 上」，
 *   那正好是 TODO-0 需要的输入 —— 若能复用 `plugin-graph` 的扫描结果，
 *   TODO-0 的成本会低很多。这是评审可以先看的捷径。
 */

export const UPSTREAM_PACKAGE = '@tengxiaohtx/dsh-plugin-hooks-ordering';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.2.0';

/** 上游发布源头（npm `repository` 指向 GitHub，2026-11-10 实查）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/xinyuehtx/dsh-plugin-hooks-ordering';

/** 上游许可证。MIT —— 宽松白名单内，可以锁版引入。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游的挂载形状：`dsh.bundle.patch: ./cordis.patch.yml`，**无 `dsh.client`**。
 * 即纯宿主侧插件，不注入任何 UI 分包 —— 判据①（不新增面板）的物理依据。
 */
export const UPSTREAM_MANIFEST = { bundlePatch: './cordis.patch.yml', client: null };

/** 上游运行时依赖：空（`dependencies: {}`，0.2.0 实查）。零传递污染。 */
export const UPSTREAM_RUNTIME_DEPENDENCIES = [];

/** 上游要求的 Node 下限 —— R-4 的出处。 */
export const UPSTREAM_ENGINES = { node: '^22.19.0 || >=24.0.0' };

/**
 * 上游 peer 依赖的后缀白名单。**只用来判断「装不装得上」**，不是兼容性证明。
 */
export const UPSTREAM_PEER_PREFIXES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-tools',
];

/** 上游**默认**控制的面（13 waterfall + 1 serial）。本包**不照抄**，见 R-3。 */
export const UPSTREAM_DEFAULT_WATERFALL_HOOKS = [
  'agent/pre-step',
  'agent/request',
  'agent/request-error',
  'llm/stream',
  'system-prompt/assemble',
  'tools/pre-execute',
  'tools/execute',
  'tools/post-execute',
  'tools/code-dispatch-log',
  'fs/write-intent',
  'fs/edit-intent',
  'approval/request',
  'session-telemetry/record',
];

/** 上游默认控制的 serial hook。本包当前**不开**（本仓订阅数为 0）。 */
export const UPSTREAM_DEFAULT_SERIAL_HOOKS = ['agent/turn-stopping'];

/** 上游的三个分层入口（README「Layers」表）。骨架只用第 2 层。 */
export const UPSTREAM_LAYERS = {
  algorithm: '@tengxiaohtx/dsh-plugin-hooks-ordering/topo-sort',
  services: '@tengxiaohtx/dsh-plugin-hooks-ordering/waterfall | /serial',
  dshBinding: '@tengxiaohtx/dsh-plugin-hooks-ordering/dsh',
};

/** 上游的语义保证（README 原文要点），评审判断「能不能信」时看这里。 */
export const UPSTREAM_GUARANTEES = [
  '同一输入 → 同一顺序（稳定拓扑排序，与加载时序无关）',
  '约束成环时抛 OrderingCycleError，并把环上的名字列出来（不返回假顺序）',
  '未注册参与者的 hook 是透明透传（所以挂载本身不改变行为）',
  '不改 Cordis 内核、不 fork、不 monkey-patch（只是普通 Cordis 插件）',
];

/**
 * 延迟 import 上游入口。**只在评审通过后调用**，且必须走这一个函数 ——
 * 不允许在别处直接 `import('@tengxiaohtx/dsh-plugin-hooks-ordering/...')`，
 * 否则锁版核对会被绕过。
 */
export async function loadUpstream() {
  throw new Error(
    'dsh-radar-hook-order 是候选骨架，未评审。' +
      '评审通过后在这里实现：先校验安装版本 === UPSTREAM_VERSION，再 return import(UPSTREAM_PACKAGE + "/dsh")。',
  );
}
