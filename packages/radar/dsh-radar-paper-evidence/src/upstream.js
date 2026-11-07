/**
 * 上游**锁版凭据**（单一真源）—— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本包锁的不是一个新上游，而是**本仓已经在跑的那个上游**：
 *
 *   - `packages/dsh-zhiyun-host-paper/package.json` → `@ggboy123/dsh-paper-reader: "1.3.1"`
 *   - `packages/dsh-zhiyun-host-paper/src/upstream.js` → `UPSTREAM_PACKAGE` / `UPSTREAM_VERSION`
 *   - `packages/dsh-zhiyun-page-paper/README.md` → 阅读区是同源 `<iframe>` 承载上游 `/paper-reader/`
 *
 * 也就是说：**本包不引入第二个阅读器**。它要做的只是在**同一个 iframe 里**多一层
 * 位置可寻址的文本块索引，让「这段话在第几页第几块」成为一个可以引用的 id。
 *
 * ── 为什么版本号写在这里、而不是只写 package.json ────────────────────
 *
 * 上游的客户端是**自渲染 HTML + 私有 HTTP 路由**（`reader/index.html` 2.0 MB 整包，
 * 23 个文件），小版本就可能改页面结构。本包要往上注入 `markerLayer`，注入点取决于
 * 上游 `#pageCanvas` / `#markerLayer` 这两个 id 是否还在 —— 1.3.1 实测**都在**
 * （`reader/index.html` 里 `const dom = Object.fromEntries([... "pageCanvas", "markerLayer" ...])`）。
 * `^` 会让某次无关改动悄悄换掉阅读器，注入点静默失效。
 *
 * ── 与 host-paper 的锁版必须**逐字符一致** ──────────────────────────
 *
 * 两个包各写一份版本号，就有漂移的可能。评审时请先跑：
 *
 *     node -e "import('./packages/radar/dsh-radar-paper-evidence/src/upstream.js').then(async m=>{const h=await import('./packages/dsh-zhiyun-host-paper/src/upstream.js');console.log(m.UPSTREAM_VERSION===h.UPSTREAM_VERSION)})"
 *
 * 若为 `false`，本包必须跟到 host-paper 的版本，**而不是反过来** —— 改 host-paper
 * 的版本会连带换掉整个论文页的阅读器，那不是本候选骨架该决定的。
 */

export const UPSTREAM_PACKAGE = '@ggboy123/dsh-paper-reader';

/** 必须与 `packages/dsh-zhiyun-host-paper/package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.3.1';

/**
 * 本包**不新增依赖**的上游：能力提取方，仅凭据留存、不 vendor、不 import。
 *
 * `piggymon907/codex-paper-reader-skill`（MIT，见该包 README / ATTRIBUTION）不提供
 * npm 包，也没有 `package.json` —— 它是「Python 脚本 + 静态 HTML」的 Agent Skill。
 * 因此这里**只记版本与提交**，作为契约出处；**不摘取任何代码**。
 */
export const CONTRACT_SOURCE = {
  repo: 'piggymon907/codex-paper-reader-skill',
  license: 'MIT',
  /** 上游 `SKILL.md` 自述的 tooling release，与 `data-contract.md` 的 build identity 一致。 */
  release: '2.7.1',
  /** 只读的两个契约文件（评审时按此路径复核）。 */
  files: [
    'paper-reader/references/data-contract.md',
    'paper-reader/assets/reader/reader.js',
  ],
};
