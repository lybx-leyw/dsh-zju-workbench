/**
 * 上游**锁版凭据**（单一真源）—— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本包锁的不是一个新上游，而是**本仓已经在跑的那个上游**：
 *
 *   - `packages/dsh-zhiyun-host-paper/package.json` → `@ggboy123/dsh-paper-reader: "1.3.1"`
 *   - `packages/dsh-zhiyun-host-paper/src/upstream.js` → `UPSTREAM_PACKAGE` / `UPSTREAM_VERSION`
 *
 * 也就是说：**本包不引入第二个论文阅读器**。它要做的只是让同一个抽屉多一种问法。
 *
 * ── 版本号为什么写在这里、而不是只写 package.json ────────────────────
 *
 * 上游客户端是**自渲染 HTML + 私有 HTTP 路由**，小版本就可能改页面结构与工具名。
 * 本包要往抽屉里插「伴读模式」，插得进去与否取决于上游
 * `list_papers / transcribe_pdf / search_paper / study_progress / study_update`
 * 这五个工具名与 `readerUrl` 字段是否还在 —— 1.6.1 实测输出
 * `registered tools: list_papers, transcribe_pdf, search_paper, study_progress, study_update`
 * 且 `dist/tools.js` 有 `readerUrl(ref)` 与 `readerUrlSchema`（nullable）。
 * `^` 会让某次无关改动悄悄换掉阅读器，注入点静默失效。
 *
 * ── LOCK_CONFLICT：本候选**最大**的落地阻塞（评审请先看这一节）────────
 *
 * 上面那行工具清单是 **1.6.x** 的输出；`study_progress` / `study_update` 以及
 * `cordis.patch.yml` 里的 `preset-paper-reader`，**1.3.1 里都没有**。
 * 本仓锁的是 1.3.1，所以本包的依赖写 1.3.1（必须与 host-paper 逐字符一致），
 * 而它想要的能力在上游 1.6.1 才存在 —— 这是**版本级**冲突，不是代码级。
 *
 * 两条路，都不是本骨架能单方面决定的：
 *
 *   A. `dsh-zhiyun-host-paper` 升到 1.6.x。会连带换掉整个论文页的阅读器，
 *      并触发 `packages/dsh-zhiyun-host-paper/src/index.js` 里
 *      `UPSTREAM_VERSION` 不一致的 hard warn（该包自己就写着「协议可能已经变化」）。
 *   B. 只借 `study_*` 的**契约**（计划 / 完成步 / 测验记录三件事的形状），
 *      档案与闸门由本仓自研。这样判据③从「多调更优质实现」降为「借鉴契约」，
 *      分级应从 🟢 降到 🟡。**评审若选 B，请同步改 registry 的分级。**
 *
 * 在 A/B 未定之前，本包**只留占位**，不挂载。
 */

export const UPSTREAM_PACKAGE = '@ggboy123/dsh-paper-reader';

/** 必须与 `packages/dsh-zhiyun-host-paper/package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.3.1';

/**
 * 本包真正想要的、**只在上游 1.6.x 存在**的能力。版本与工具名分开写，
 * 是为了让 `LOCK_CONFLICT` 在评审时一眼看见，而不是被 `UPSTREAM_VERSION` 掩盖。
 */
export const DESIRED_CAPABILITY = {
  /** 首次在该版本观测到 `preset-paper-reader` 与 `study_*` 两个工具。 */
  sinceVersion: '1.6.1',
  /** 上游 `cordis.patch.yml` 里随 bundle 声明的 preset id。 */
  presetId: 'preset-paper-reader',
  /** 上游 `dist/index.js` 的注册日志实测输出。 */
  tools: ['list_papers', 'transcribe_pdf', 'search_paper', 'study_progress', 'study_update'],
};

/** 评审必须先决定走 A 还是 B；在此之前本包不实现任何逻辑。 */
export const LOCK_CONFLICT = {
  locked: UPSTREAM_VERSION,
  needed: DESIRED_CAPABILITY.sinceVersion,
  /** `true` 时说明冲突未解，本包不得挂载。 */
  unresolved: true,
};
