// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `@ocr-web/core`（纯 JS 浏览器 OCR 引擎，MIT）锁版封装成一个宿主服务，
//       为「学习」页的**图片类讲义 / 板书照片**提供「图 → 文本」的识别底层。
//
// 上游：https://github.com/bent2685/ocr-web        ★3（2026-05-08 push，**5 个月未更新**）
//       npm: @ocr-web/core@0.2.1（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（GitHub `license.spdx_id` + LICENSE 实文首行均已核）
//       体积：core unpacked 256,788 B + models-ppocrv5 8,007 B
//             + onnxruntime-web **144,618,540 B（≈138 MB，含全部 wasm 后端）**
//
// 性质：**B 类（其他 JS 项目）· 强化式集成**，不是全新功能。
//
// # 集成判定：强化式集成的三条判据（逐条见 README）
//
//   ① 仍是同一个面板 —— ✅ 学习页 `quiz-panel` 上方那一块「选片段出题」区域，
//      不新增页面、不新增导航项。新增的只是一个「从图片取文本」的来源。
//   ② 功能仍相似正交 —— ✅ 上游做的是「识别图里的字」，本仓已经做的是
//      「从已识别的文字里出题 / 进检索」；两者串在同一条链的相邻两环，不互相替代。
//   ③ 底层多调了更优质实现 —— ✅ 本仓**完全没有**这一层（见 TODO 0 的三条实测）。
//
// # 边界（评审前请确认这五条）
//
//   1. **不新增数据源、不改任何落盘格式。** 识别结果是「文本」，进的是既有的
//      `blocks[].sentences[].text` 通路，**不新建**任何 JSON 文件。
//   2. **不自动出题。** 识别完只是把文本放进「候选片段」，仍需用户勾选 + 点「生成题目」。
//      上游没有出题能力，本包也不加 —— 出题仍由 `dsh-zhiyun-quiz` 负责。
//   3. **不在主线程做推理。** 必须用 `OcrEngineWorker`（上游提供 Worker 入口），
//      否则一页 A4 会把学习页卡住数秒。
//   4. **图片不出本机。** 模型 + 推理都在浏览器内存里完成；但**模型文件本身**
//      默认从 CDN 拉（见 README §风险 R-2）—— 「图不出本机」与「模型从网上拿」
//      是两件事，不得在界面上混为一谈。
//   5. **失败必须降级为现状。** 引擎加载失败 / wasm 路径不对 / 模型拉不下来
//      → 退回「只能粘贴文字」的现状，**绝不**让出题按钮点不动。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-ocr-web';

/**
 * 上游需要的宿主能力。
 *
 * ⚠ 刻意**只声明一个**：本包不需要 `llm`（识别是纯计算，不调模型服务）、
 * 不需要 `settings`（第一版没有可配置项，参数全走调用方）。
 * 多声明一个就多一处「装上但没用」的耦合。
 */
export const inject = ['static'];

/**
 * 挂载。**未接入 profile，不会被调用。**
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    '[radar-ocr-web] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 0. **先证明「本仓真的没有这一层」。** 2026-10-20 实测的三条依据：
//    - `packages/dsh-zhiyun-page-study/src/quiz-panel.jsx` 的片段来源只有
//      `state.result.blocks`（终稿里的文字块），**没有任何图片入口**；
//    - `packages/dsh-zhiyun-quiz/src/generate.js` 只吃 `makeSourceMaterial({ text })`，
//      `text` 由 `workbench.js:quizMaterials()` 用 `block.sentences.map(s => s.text).join("")`
//      拼出 —— 图片从不参与；
//    - 全仓 grep `recordAttempt` 只有 `dsh-zhiyun-quiz/src/store.js:604` 定义处一处，
//      **没有调用方** —— 说明「作答」通路本身还没接上（见 README §与本轮的关系）。
//
// 1. **wasm 静态路径（最大障碍）。** `onnxruntime-web` 要求把 `*.wasm` 从
//    `wasmPaths` 指向的路径静态托管。本仓目前**没有**可写的静态资源管线。
//    评审须二选一：
//      (a) 由宿主 `static` 服务挂一个 `/ocr/ort/` 前缀，构建时把
//          `node_modules/onnxruntime-web/dist/*.wasm` 拷进去 —— 会让部署产物 +100 MB 量级；
//      (b) 从 CDN 加载 wasm + 模型 —— 落地成本低，但**首次使用必须联网**。
//    **未回答前不实现。**
//
// 2. **体积。** `onnxruntime-web` unpacked 138 MB 是**全后端**体积（webgl/webgpu/wasm
//    各带 simd 与 threaded 版本）。真正进产物的只是被引用的那 2–3 个文件。
//    评审须实测「只留 wasm+simd」后的产物大小，再决定是否接受。
//
// 3. **中文识别质量必须用夹具证明，不能用 README 的话。** 上游宣称字典 18,384 字
//    覆盖 CJK。评审须准备 3 类夹具：印刷体讲义截图、手写笔记照片、板书照片，
//    各 10 张，报告字符准确率。**手写体准确率大概率显著低于印刷体** ——
//    若低于可接受线，本包的定位应改为「仅印刷体讲义」，并在界面上明说。
//
// 4. **接进哪一环。** 建议的最小形状（不新增页面）：
//      图片 → Worker 识别 → `OcrLine[]`（文本 + 坐标 + 置信度）
//           → 按 y 坐标聚成「行 → 段」→ 生成**候选块**（带 `source: 'image-ocr'` 标记）
//           → 用户在 `quiz-panel` 里勾选 → 走既有 `generateQuiz()`
//    评审须确认：候选块进不进 `layered-search` 的检索范围？
//    **建议不进**（识别文本有噪声，会污染检索排序），只在本次出题时可见。
//
// 5. **置信度必须透传给用户。** 上游 `OcrLine` 带 score。低于阈值的行在 UI 上
//    标出来（例如虚线下划线），**不得**静默当成正确文本。这条与本仓
//    「不许静默失败」的既有纪律一致（见 `dsh-zhiyun-quiz` 的 rejected 带名字）。
//
// 6. **与已登记的视觉簇的关系。** registry 里已有 `modlens`（视觉簇已取）、
//    `dsh-ocr-local`（`NOASSERTION`，待核）、`dsh-ocr-plugin`（Python）等。
//    本轮**不取**它们，理由是它们都要求宿主侧 Python/原生运行时；
//    上游是**纯 JS + wasm**，是唯一能跑在浏览器里的选项。评审若认为视觉簇
//    已有覆盖，本骨架可直接驳回删除。
//
// 7. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。
