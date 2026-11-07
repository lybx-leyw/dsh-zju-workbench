/**
 * dsh-radar-canteen-pick —— 上游封装占位（A 类骨架惯例：锁版引入 + 外壳）。
 *
 * **未评审、未接入 profile、不可直接使用。**
 *
 * 上游 `zjuer-eat-what@1.0.0` 是**微信小程序**，不是可直接 `import` 的 ESM 包。
 * 因此本文件的存在意义是**划清边界**：明确哪些文件可以 vendor、哪些绝对不 vendor。
 *
 * ── 允许 vendor（只读、无运行时依赖）───────────────────────────
 *
 *   data/           玉泉校区基础目录：dishes / canteens 数据字面量
 *   services/*.js   推荐与打卡偏好的**纯函数**部分（需逐函数审查无 wx.* 调用）
 *
 * ── 绝对不 vendor ──────────────────────────────────────────────
 *
 *   cloudfunctions/   wx.cloud 云函数（ensureUser / communityPosts / ...）
 *   pages/            小程序页面（WXML + WXSS，绑定层）
 *   components/       小程序组件
 *   project.config.json  含云环境 ID，属上游配置，不入本仓
 *   behaviors/        小程序 Behavior（宿主不兼容）
 *
 * ── TODO（评审通过后落实）─────────────────────────────────────
 *
 *   TODO(1) 以 `vendored/zjuer-eat-what-1.0.0/` 存放允许 vendor 的文件，
 *           附 `VERSION` 与 `SOURCE`（repo@commit）。
 *   TODO(2) 对 vendored 的 `services/*.js` 做 wx.* 静态扫描，有调用者剔除。
 *   TODO(3) 若上游对目录结构做破坏性变更，本层负责 shim，不改上游文件本身。
 *   TODO(4) 版本升级只允许**锁版替换**，不在 vendored 目录内改上游逻辑。
 *
 * @module dsh-radar-canteen-pick/upstream
 */

/** 上游坐标（锁版；不使用 `^` / `~`） */
export const UPSTREAM = Object.freeze({
  repo: 'neoVqs88/ZJUersTodayRecipe',
  packageName: 'zjuer-eat-what',
  version: '1.0.0',
  license: 'MIT',
});

/** 可 vendor 的上游路径前缀 */
export const VENDOR_ALLOW = Object.freeze(['data/', 'services/']);

/** 禁止 vendor 的上游路径前缀（含云开发与小程序绑定层） */
export const VENDOR_DENY = Object.freeze([
  'cloudfunctions/',
  'pages/',
  'components/',
  'behaviors/',
  'project.config.json',
]);

/**
 * 占位：上游加载器。评审通过前**不得**调用。
 *
 * @returns {never}
 */
export function loadUpstreamCatalog() {
  throw new Error(
    'dsh-radar-canteen-pick/upstream: 候选骨架，未实现（见本文件顶部 TODO）'
  );
}
