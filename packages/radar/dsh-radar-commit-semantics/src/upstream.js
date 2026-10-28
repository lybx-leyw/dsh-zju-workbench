/**
 * 上游 `tiny-conventional-commits-parser` 的**唯一**引用点 —— 锁版凭据只在本文件出现一次。
 *
 * 本文件是占位：**不 import 上游本身**，只把「包名 / 版本 / 仓库 / 许可证 / 已知坑」
 * 写死在这里，供评审者对照。评审通过后再实现 `loadUpstream()`。
 *
 * 所有结论都在沙箱里对仓库 `src/parse.ts`（commit `2026-09-05`，main 分支）原文核对过，
 * 另在 npm registry 上核过 `dist-tags`（2026-10-29，Node 22.13.0）。见
 * `docs/ecosystem-radar/2026-10-29-06.md` §3。
 *
 * ⚠ **本文件里的 `describeCommit()` / `isBreakingCommit()` 不是上游的导出**，
 *    而是本包**拟提供给调用方**的形状（占位，抛错）。之所以放在这里而不是 `index.js`：
 *    二者的实现位置取决于「是否真的锁版引入上游」这一评审结论 —— 若评审驳回，
 *    整目录删除时不留半截逻辑。
 */

/** npm 包名（无 scope）。 */
export const UPSTREAM_PACKAGE = 'tiny-conventional-commits-parser'

/**
 * **锁版**（不带 `^`）：`0.x` 的 `^0.1.0` 只允许进 `0.1.x`，但上游**连 `0.x` 的破坏性改动都不承诺**，
 * 而本包吃的是「正则语义」，一次微调就能让一整类提交从 fix 变成 feat。必须写死。
 * `npm dist-tags.latest` = `0.1.0`（历史上只有 `0.0.1` / `0.1.0` 两个版本）。
 */
export const UPSTREAM_VERSION = '0.1.0'

/** 源码仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/northword/tiny-conventional-commits-parser'

/** 许可证：MIT（仓库 `package.json` 的 `license` 字段与 GitHub API `spdx_id` 两处一致）。 */
export const UPSTREAM_LICENSE = 'MIT'

/** 上游真正导出的两个函数（`src/index.ts`）：`parseRawCommit` / `parseCommit`。 */
export const UPSTREAM_EXPORTS = Object.freeze(['parseRawCommit', 'parseCommit'])

/**
 * 上游源码规模（GitHub contents API 的 `size` 字节数）：
 * `parse.ts` 2446 / `git.ts` 1706 / `types.ts` 503 / `index.ts` 583 —— 合计约 5.2 KB。
 * 这个尺寸意味着**「锁版引入」与「照规格自写 40 行」的维护成本相当**，
 * 评审时要把这一点摆上桌（见 README「评审必须先回答的三个问题」第 1 条）。
 */
export const UPSTREAM_SOURCE_BYTES = Object.freeze({
  'src/parse.ts': 2446,
  'src/git.ts': 1706,
  'src/types.ts': 503,
  'src/index.ts': 583,
})

/**
 * TODO-A · 加载上游。
 *
 *   `package.json` 的 `exports` 只有 `"."` → `./dist/index.mjs`（**ESM only**，
 *   没有 `require` 分支），所以只能用 `await import()`，且必须在宿主 ESM 主线程里调。
 *
 *   预计形态：
 *
 *     let mod
 *     export async function loadUpstream() {
 *       mod ??= await import(UPSTREAM_PACKAGE)
 *       return mod
 *     }
 *
 *   **不要**改成 `createRequire(...)(UPSTREAM_PACKAGE)`：会直接 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
 */
export async function loadUpstream() {
  throw new Error('TODO-A：未实现（评审通过后再接）。见 README')
}

/**
 * TODO-B · 本包对外的**唯一**出口形状。
 *
 * @param {{ hash: string, subject: string, body?: string, authorName?: string, authorEmail?: string }} input
 *   由调用方从**已有的结构化数据**填入，**不经**上游的 `parseRawCommit`（它按 `|` 切字段，见 README P1）。
 * @returns {{ type: string, scope: string, description: string, isConventional: boolean,
 *             isBreaking: boolean, references: Array<{type: 'pull-request'|'issue', value: string}>,
 *             authors: Array<{name: string, email: string}> }}
 */
export function describeCommit(input) {
  void input
  throw new Error('TODO-B：未实现（评审通过后再接）。见 README「不能照抄上游的三处」')
}

/**
 * TODO-C · **修正版** breaking 判定（上游那条不能用）。
 *
 *   上游：`/breaking[ -]changes?:/i.test(body)` —— 全文、无视否定。沙箱实测：
 *         `本提交不构成 breaking change: 无` -> true（否定句被判成破坏性变更）。
 *   本包：只扫 **footer 段**（正文最后一段，每行形如 `Token: value` 或 `Token #value`），
 *        命中 `BREAKING CHANGE:` / `BREAKING-CHANGE:` 时返回 true，
 *        且该行以否定词（`not` / `no` / `不` / `非` / `n't`）开头时返回 false。
 *
 *   这一条是本包**相对上游的全部增量价值**，也是判据③「底层更优质」的唯一硬支点：
 *   不是「上游更好」，而是「上游这一处明确更差，本包在其之上改正」。
 *   → 评审若认为「改正 = 自己写，那就干脆全自己写」，应直接判骨架 **作废**，
 *     而不是「降级成照抄上游」。
 */
export function isBreakingCommit() {
  throw new Error('TODO-C：未实现（评审通过后再接）。见 README「不能照抄上游的三处」P0 第 2 条')
}
