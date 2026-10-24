/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 B 类骨架也要单列这个模块：
 *
 *   1. 上游是 0.x（`0.2.1` / `0.1.1`），API 仍在动。放开成 `^` 会在下次安装时
 *      静默换 API，必须写死。
 *   2. 本包**不搬运**上游源码，只 `import` 两个公开入口（`.` 与 `./worker`）。
 *      「我们调的到底是哪一个入口、哪一版」必须有一个可被 grep 到的单一真源。
 *   3. 版本号必须与 `package.json` 的 `dependencies` **逐字符相同**。
 *      真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = '@ocr-web/core';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.2.1';

/** 模型地址常量包（只含 jsDelivr URL，不含模型二进制）。 */
export const UPSTREAM_MODELS_PACKAGE = '@ocr-web/models-ppocrv5';
export const UPSTREAM_MODELS_VERSION = '0.1.1';

/**
 * 推理后端。**peerDependency**，必须由本包显式锁版（上游 `^1.25.0`）。
 *
 * ⚠ 为什么锁 `1.25.1` 而不是上游声明的 `1.25.0`：
 *   npm 上 `1.25.0` **只有 `-dev.*` 预发布标签**（2026-10-20 `npm view versions` 实查），
 *   稳定版从 `1.25.1` 起。写 `1.25.0` 会解析到预发布或直接失败。
 *   这是「上游 peer 区间在 npm 上不可满足」的一个实例，评审时请留意。
 */
export const UPSTREAM_PEER = 'onnxruntime-web';
export const UPSTREAM_PEER_VERSION = '1.25.1';

/** 上游许可证（README / 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'bent2685';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/bent2685/ocr-web';

/**
 * 上游**只**暴露两个 JS 入口（2026-10-20 从 `packages/core/package.json` 的
 * `exports` 字段逐字抄录）：
 *
 *   "."        → dist/index.js      （`OcrEngine`，主线程）
 *   "./worker" → dist/worker.js     （`OcrEngineWorker`，Worker 内）
 *
 * 凡不在下表里的子路径一律视为内部实现，**不得** `import`。
 */
export const UPSTREAM_ENTRYPOINTS = Object.freeze({
  mainThread: '.',
  worker: './worker',
});

/**
 * 上游公开类型（来自 `packages/core/src/index.ts` 的 `export type`，仅作评审线索）。
 *
 * `OcrLine` 是本包真正要用到的那个：它带 `text` / `points`(四边形) / `score`。
 * 注意 `score` 是**识别置信度**，不是「这句话对课程重不重要」—— 两者不得混用。
 */
export const UPSTREAM_TYPES = Object.freeze([
  'ImageInput',
  'LoadProgress',
  'ModelSource',
  'OcrEngineOptions',
  'OcrLine',
  'OcrResult',
  'Point',
  'Quad',
  'RecognizeOptions',
]);

/**
 * 上游**运行时**依赖：**零**。
 *
 * `package.json` 只有 `peerDependencies: { onnxruntime-web: "^1.25.0" }` 与 devDependencies。
 * 这是它相对同轮其他 OCR 候选（Python / Rust / AGPL）唯一的硬优势：
 * **纯 JS、零传递依赖、浏览器内跑完**。
 */
export const UPSTREAM_RUNTIME_DEPS = Object.freeze({});

/**
 * 上游的公开接缝（占位）：评审通过后在这里做一次 `import()` + 形状检查。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只 `import` 上表里的入口，**不深挖 `dist/**` 内部文件**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定退回现状；
 *   - 不把 wasm / 模型路径写死在这里 —— 那是宿主部署配置（TODO 1），不是上游契约。
 *
 * @returns {Promise<{ ok: boolean, mod?: unknown, error?: string }>}
 */
export async function loadUpstream() {
  // TODO 1：`await import('@ocr-web/core')`，断言导出里有 `OcrEngine`；
  //         需要 Worker 时再 `await import('@ocr-web/core/worker')`，断言 `OcrEngineWorker`。
  //         任一步失败 → `{ ok:false, error }`，**不要** throw。
  // TODO 2：核对 `UPSTREAM_PEER_VERSION` 与宿主实际安装的 `onnxruntime-web` 版本；
  //         不一致 → `{ ok:false, error:'PEER_MISMATCH' }`（wasm ABI 变过一次就会崩）。
  // TODO 3：`models-ppocrv5` 只返回 URL 常量 —— 加载前必须确认 CORS 与可达性，
  //         并把「正在下载 X MB 模型」暴露给 UI（不能静默卡住）。
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
