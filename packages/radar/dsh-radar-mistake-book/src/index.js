/**
 * 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
 *
 * dsh-radar-mistake-book —— A 类（原生 DSH 插件）锁版挂载的外围兼容层。
 *
 * 上游：`suanmingxing/dsh-ai-mistake-book`（MIT，v0.3.2）
 * 形态：`dsh.bundle.patch` → `./cordis.patch.yml`，本包锁版引入，**不改上游源码**。
 *
 * 本文件是**占位**：所有导出一律抛错。评审通过后才实现。
 * 每个 TODO 都写明「为什么需要」与「验收时怎么验」，不要在没有评审结论时动它。
 *
 * 集成性质：**全新**（不是强化式集成）。
 * 依据：本仓 `packages/dsh-zhiyun-core-quiz/src/store.js` 的错题归因只认 `attempts`
 * （系统自己出的题），卷面上答错的东西**没有通路进来**；
 * `grep -rl "ocr\|OCR" packages/*\/src` 的 3 处命中全是 bilibili/课堂视频，
 * 没有任何「卷面 → 结构」的链路。所以这是**新入口**，不能包装成「同一面板换底层」。
 */

const NOT_REVIEWED =
  'dsh-radar-mistake-book 是候选骨架：未评审、未接入 profile、不可直接使用。';

/**
 * @dispose 挂载点。评审通过后在这里 `ctx.plugin()` 上游的默认导出，
 *   再把本包的兼容层（下面三个 TODO）注册成上游的**外围**，不侵入上游。
 */
export function apply() {
  throw new Error(NOT_REVIEWED);
}

/**
 * TODO-1 · 卷面错题回流到 `attempts`（本包的主增量）
 *
 * 为什么：上游归档成 `library/<学科>/<卷子>/cards/*.md` + `index.md`，
 *   是**它自己的存储**。而本仓的「薄弱点统计」唯一依据是 `core-quiz` 的 `attempts`
 *   （见 `store.js:21` 的注释）。不回流 → 卷面错的题不会让薄弱点变准。
 *
 * 怎么验：
 *   ① 先确认 `attempts` 的 schema **容得下「没有系统题 id」的条目** —— 这是本仓的硬约束，
 *      schema 若强制 `questionId`，回流方案就得改（可能要给卡片发合成 id），
 *      **这一步没结论前不要写实现**。
 *   ② 回流必须是**用户点过确认**的卡片，不得自动写（上游的「待归档」语义要保住）。
 *   ③ 回流失败要能**反向撤销**：错题卡片已归档但 attempts 没写，不能留下半截状态。
 *
 * @param {object} _card  上游归档后的一张卡片（front-matter + 正文）
 * @returns {Promise<object>} TODO 未实现
 */
export async function relayCardToAttempts(_card) {
  throw new Error(NOT_REVIEWED);
}

/**
 * TODO-2 · `archiveRoot` 钉在工作区，拒绝指向 profile
 *
 * 为什么：上游默认 `~/.dsh/ai-mistake-book`，且**改这个字段要重启插件**。
 *   落在 profile 里等于把学习资料写进应用配置目录 —— 备份/迁移/清理都会踩到。
 *
 * 怎么验：传入 profile 路径（`profiles/*`）时必须拒绝并给出可行动提示，不是静默改路径。
 *
 * @param {string} _candidateRoot
 * @returns {string} TODO 未实现
 */
export function resolveArchiveRoot(_candidateRoot) {
  throw new Error(NOT_REVIEWED);
}

/**
 * TODO-3 · 视觉模型能力前置探测
 *
 * 为什么：上游在**插件启动时**校验「分析模型是否支持图片」，不支持就直接报错。
 *   这个设计是对的（不静默失败），但用户在装完、重启完后才知道 —— 反馈太晚。
 *   本层在「投喂前」再探一次，给出**可行动**提示（换模型 / 先 OCR 成文字）。
 *
 * 怎么验：用一个明确拒图的结构化 stub 调一次，必须返回 `{ ok:false, reason }` 而不是抛错。
 *
 * @returns {Promise<{ok: boolean, reason?: string}>} TODO 未实现
 */
export async function probeVision() {
  throw new Error(NOT_REVIEWED);
}

export default { apply };
