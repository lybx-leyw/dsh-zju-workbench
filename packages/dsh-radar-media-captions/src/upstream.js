/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-radar-llm-fallback/src/upstream.js`。
 *
 * 为什么 B 类骨架也要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口。因此「我们调的到底是哪一版 API」
 *      必须有一个可被 grep 到的单一真源。
 *   2. 版本号必须与 `package.json` 的 `dependencies["media-captions"]` **逐字符相同**。
 *      真实安装的版本由 `npm ls media-captions` 核对，**不得信任本文件**。
 *   3. 这个包的版本选择**不是偏好，是事实**：npm 上 `media-captions` 的
 *      `dist-tags.latest = 0.0.18`（2023-06-15 发布），而 `dist-tags.next = 1.0.4`
 *      （2024-07-29 发布，`type: module`）。**装不带版本的 `media-captions` 会拿到
 *      2023 年那个 0.0.18** —— 这是必须写死 `1.0.4` 的唯一理由。
 */

export const UPSTREAM_PACKAGE = 'media-captions';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.0.4';

/** 上游许可证（README / 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者。 */
export const UPSTREAM_AUTHOR = 'Rahim Alwer（vidstack）';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/vidstack/captions';

/**
 * 上游 npm 元数据（2026-10-20 实测 registry.npmjs.org，`media-captions@1.0.4`）。
 *
 * | 字段 | 值 |
 * | --- | --- |
 * | `license` | `MIT` |
 * | `type` | `module`（纯 ESM，无 CJS 入口） |
 * | `dependencies` | **无**（零运行时依赖） |
 * | `peerDependencies` | 无 |
 * | `unpackedSize` | 162,428 B（≈ 159 KB） |
 * | `main` | `./dist/prod.js` |
 * | `exports["."]` | `types / test / development / default` 四个条件 |
 *
 * ⚠ `type: module` 意味着**只能在 ESM 图里用**。本仓 `packages/*` 全部是 ESM
 *   （`dsh-radar-llm-fallback/package.json` 同样 `"type": "module"`），因此不构成障碍；
 *   但若将来有 CJS 消费者，需要动态 `import()` 而不是 `require()`。
 */
export const UPSTREAM_UNPACKED_BYTES = 162428;

/**
 * 上游声称的能力边界（**评审时不要误读**）。
 *
 * 上游描述：「Modern media captions parser and renderer (~5kB). Supports VTT, SRT, and SSA.
 * Works server side, supports text streams, rollup captions via VTT regions…」
 *
 * 句句属实，但**它做的事与本仓的缺口是两个方向**：
 *
 *   - 上游做的是「**字幕文件格式 ↔ 结构化 cue 树**」；
 *   - 本仓缺的是「**结构化 cue 树 → 可读的中文句子**」。
 *
 * 上游**不提供**、本包也**不得假装它提供**的三件事：
 *
 *   1. **中文断句**。它按 VTT/SRT 的 cue 边界切，**不会**把「我们看这个矩阵」和
 *      「它的秩是三」连成一句。cue 之间怎么连，仍然要本仓自己写规则。
 *   2. **标点恢复**。ASR 丢掉的句尾标点，它不会补 —— 它没有这个能力，也不该有。
 *   3. **浙云课堂的信道格式**（`{BeginSec, EndSec, Text, TransText}` JSON）。
 *      上游只认 VTT/SRT/SSA 三种**文件文本**，不认 JSON。适配层必须由本包补
 *      （见 `src/index.js` 的 `TODO-1`）。
 *
 * 见 README §「这条 🟢 到底买到了什么」。
 */
export const UPSTREAM_NOT_PROVIDED = Object.freeze([
  '中文断句（cue 之间不连接）',
  '标点恢复（ASR 丢失的句尾标点不补）',
  '浙云课堂 JSON 信道格式（只认 VTT / SRT / SSA 文本）',
]);

/**
 * 本包预期使用的上游导出（**待评审核对**，不是已确认的 API）。
 *
 * 上游 `index.d.ts` 的公开形状（据 npm 包 `dist/types/index.d.ts`）大致是：
 * `parseVTT` / `parseSRT` / `parseSSA` / `serializeVTT` / `serializeSRT` / `parseResponse` …
 *
 * ⚠ 本列表**未经运行时验证**：骨架不安装依赖、不跑上游。评审第一步应是
 *   `npm i media-captions@1.0.4 && node -e "import('media-captions').then(m=>console.log(Object.keys(m)))"`，
 *   再用实际导出的名字替换这里的列表。
 */
export const UPSTREAM_EXPECTED_EXPORTS = Object.freeze([
  'parseVTT',
  'parseSRT',
  'parseSSA',
  'serializeVTT',
  'serializeSRT',
]);

/**
 * 上游封装占位。
 *
 * **故意返回失败**：骨架不装依赖、不跑上游。人工评审把本函数替换为真实实现，
 * 并在此处记录「实测到的导出名与上面的预期是否一致」。
 */
export async function loadUpstream() {
  return {
    ok: false,
    package: UPSTREAM_PACKAGE,
    version: UPSTREAM_VERSION,
    reason: '候选骨架：未安装、未评审，loadUpstream() 故意返回失败。见 README。',
  };
}
