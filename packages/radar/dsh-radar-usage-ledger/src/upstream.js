// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装层：把「锁定哪个版本、它期望什么宿主、加载失败怎么退化」集中在这一个文件，
// 让评审者不必翻 `src/index.js` 就能判断「这个锁版还成不成立」。
//
// **本文件不做任何 I/O、不在模块顶层 import 上游。** 理由见 `loadUpstream()` 的注释。

/** 上游包名（npm scope 与 GitHub 仓名不同，勿混）。 */
export const UPSTREAM_PACKAGE = '@ychris12138/dsh-usage-stats';

/**
 * 锁定的上游版本。
 *
 * **精确版本，不用 `^`。** 上游处于 0.x，`^0.3.7` 允许 `0.3.x` 任意漂移，
 * 而 0.x 的 minor 也可能带 breaking change（见 README §风险 R-1）。
 * 升级本常量必须同时走一次评审（`CHANGELOG` 差异 + 宿主 peer 交集重算）。
 */
export const UPSTREAM_VERSION = '0.3.7';

/** 上游仓库地址（NDJSON 里不要写成 npm 名，避免评审时点错）。 */
export const UPSTREAM_REPO = 'https://github.com/Ychris12138/dsh-usage-stats';

/** 许可证 —— 宽松白名单内，允许锁版挂载。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游 `dsh.client.inject` 声明的两个前端包。
 *
 * 这两个都不是本仓的包，来自 `@deepseek-ai/dsh-base` / `dsh-web-app`。
 * 评审时须在**实际安装的宿主**上确认它们存在：缺失时上游 Web 半部**静默不挂载**
 * （宿主侧 API 照常注册，面板却不见）—— 这是最难排查的一类失败，所以在这里显式记下。
 */
export const UPSTREAM_CLIENT_INJECT = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-primitives',
];

/**
 * 上游读取用量的**唯一**数据源。
 *
 * 上游 `host.js` 顶注：`ctx.inject(['sessionQuery'], ...)` —— 从会话日志里读
 * `assistant/message` 的 `data.usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}`。
 *
 * 对本仓的含义：**上游不向本仓要任何东西**，它只读宿主已有的日志。
 * 这也是判据③成立的原因，同时是边界 1（「不新增数据源」）能守住的原因。
 */
export const UPSTREAM_DATA_SOURCE = 'sessionQuery';

/**
 * 上游依赖的「全部」运行时依赖。
 *
 * 实测（读上游 `package.json`）：`dependencies` 与 `peerDependencies` **均为空**。
 * 这不是「没查」，是上游刻意做成零依赖 —— 它也是同题 11 个仓里唯一一个零依赖的，
 * 这是本骨架选它而不是 `dsh-dock` 的**决定性理由之一**（见 README §取舍）。
 */
export const UPSTREAM_RUNTIME_DEPS = [];

/**
 * 上游期望的宿主版本范围（评审时须与 `runtime.lock.json` 逐项求交集）。
 *
 * ⚠ **这里是占位，不是实测值。** 上游未在 `package.json` 里声明 peer，
 * 因此不存在一个可直接引用的区间 —— 评审必须**实读**上游对应 tag 的 `package.json`
 * 与 `CHANGELOG`，把真实区间填进来，并把「交集是否为空」的判定代码一起提交。
 * 未填之前 `assertHostCompatible()` 一律返回 `false`（fail-closed）。
 */
export const UPSTREAM_HOST_RANGE = null;

/**
 * 断言宿主兼容。**当前恒为 fail-closed。**
 *
 * @param {{hostVersions?: Record<string, string>}|null} lock
 *   `runtime.lock.json` 的 `hostVersions`（形如 `{'@deepseek-ai/dsh-llm': '0.2.0-rc.2'}`）
 * @returns {{ok: false, reason: string} | {ok: true}}
 */
export function assertHostCompatible(lock) {
  if (UPSTREAM_HOST_RANGE === null) {
    return { ok: false, reason: 'UPSTREAM_HOST_RANGE 未实测填写（占位），fail-closed' };
  }
  if (!lock || typeof lock !== 'object' || Object.keys(lock).length === 0) {
    return { ok: false, reason: '缺少 hostVersions，无法求交集' };
  }
  return { ok: false, reason: 'TODO：按 UPSTREAM_HOST_RANGE 与 hostVersions 逐项求交集' };
}

/**
 * 加载上游。**当前恒失败。**
 *
 * 为什么不在模块顶层 `import`：
 *   候选骨架在评审期间会被 `packages/radar/*` 的 workspace 扫到（`workspaces` 含该 glob），
 *   而安装依赖前 `@ychris12138/dsh-usage-stats` 并不在 `node_modules` 里。
 *   顶层 import 会让**所有** `pnpm -r` 命令直接炸，连带整仓 CI 变红。
 *   因此上游只在 `apply()` 里动态加载，且**加载失败必须静默降级**（边界 3）。
 *
 * @returns {Promise<{ok: false, error: string} | {ok: true, mod: unknown}>}
 */
export async function loadUpstream() {
  return { ok: false, error: 'candidate skeleton: upstream load is intentionally disabled' };
}

/** 把上游加载失败的原始错误压成一条可读原因（评审时用于决定「拒绝启用」还是「降级运行」）。 */
export function describeLoadFailure(error) {
  if (!error) return '未知原因';
  if (typeof error === 'string') return error;
  const code = error.code ? String(error.code) : '';
  const msg = error.message ? String(error.message) : String(error);
  return code ? `${code}: ${msg}` : msg;
}
