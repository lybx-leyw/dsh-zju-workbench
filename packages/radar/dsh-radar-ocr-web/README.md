# dsh-radar-ocr-web —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-20 · 第三十七轮 · C 组派生「作答回路健全性轴」），
> **仅用于人工评审**。这不是一个可用插件：`src/index.js` 的 `apply()` 只打一行日志，
> `src/upstream.js` 的 `loadUpstream()` 永远返回 `{ ok:false }`，TODO 一条都没落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。评审驳回则整目录删除。

---

## 一句话

**本包不是「给工作台加一个 OCR 功能」，而是给「习题」这条链补上它缺的第一个环：
题目所依据的文字，现在只能从「已经解析好的讲义块」里来；板书、手写笔记、截图一概进不来。**

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [bent2685/ocr-web](https://github.com/bent2685/ocr-web) |
| npm | `@ocr-web/core@0.2.1`（锁版）+ `@ocr-web/models-ppocrv5@0.1.1`（锁版） |
| 推理后端 | `onnxruntime-web@1.25.1`（**peer，本包锁版**；上游写 `^1.25.0`，但 npm 上 `1.25.0` 只有 `-dev.*`，见 §风险 R-4） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id` = `MIT`；`LICENSE` 实文首行 `MIT License / Copyright (c) 2026 ocr-web contributors` 已核） |
| 作者 | bent2685 |
| Stars | ★3 · fork 0 |
| 活跃度 | **2026-05-08 push（约 5 个月前）** —— 不是活跃项目，这是本包最大的非技术风险 |
| 语言 | TypeScript，编译为 ESM + CJS，`sideEffects: false` |
| 运行时依赖 | **零**（只有 1 个 peer） |
| 体积 | core `256,788 B` + models `8,007 B`（只有 URL 常量）+ `onnxruntime-web` `144,618,540 B`（全后端，含全部 wasm） |
| 能力 | PP-OCRv5：DBNet 检测 + CRNN 识别（CTC 贪心）；字典 18,384 字（CJK / 拉丁 / 数字 / 标点）；**Web Worker 模式**；字节级加载进度回调；识别批处理；可直接吃 `Canvas` / `ImageData` / `Blob` / `File` / URL |
| 形态 | **纯库**，不是 DSH 插件 → 本包是 **B 类**（能力提取 + 封装） |
| 首次发现 | 2026-10-20（第三十七轮 · C 组派生 · 关键路径轴） |

> **为什么不选同轮命中的其他 OCR**：
> `StabRise/ScaleDP-TS`（AGPL-3.0 ⛔ 红线）、`Fanfulla/OCR-buddy`（`NOASSERTION` ⚠）、
> `ocr.rotko.net`（无许可证 ⛔）、`MyScript/myscript-math-web`（`NOASSERTION`，且已 2021 年停更）。
> 到 `bent2685/ocr-web` 这一条，才是**许可证明确 + 纯 JS + 浏览器内跑 + 零运行时依赖**同时成立的。
> 星数低（★3）由人工评审斟酌 —— 本轮不为它辩护。

---

## 集成方式：**强化式集成**（不是「全新」）

**与现有功能的关系：重复且可强化 ✅**（与 `dsh-zhiyun-quiz` 的「出题」同属一条链，但补的是上游缺环）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 学习页 `quiz-panel`，同一块「选片段 → 生成题目」区域；不新增页面、不新增导航项 |
| ② 功能仍相似正交 | ✅ | 上游回答「图里写的是什么」；本仓回答「这段文字能出什么题」。相邻两环，不互相替代 |
| ③ 底层多调了更优质实现 | ✅ | 本仓这一层**完全不存在**，见下节三条实测 |

### 现有实现缺什么（2026-10-20 读码实测，不是自述推断）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 片段来源**只有**终稿文字块，没有图片入口 | `packages/dsh-zhiyun-page-study/src/quiz-panel.jsx`：`const blocks = state.result?.blocks ?? []`，勾选后只传 `blockIndexes` |
| 2 | 出题原料由文字块拼接，图片从不参与 | `packages/dsh-zhiyun-study-core/src/workbench.js` `quizMaterials()`：`text: (block.sentences ?? []).map(l => l.text).join("")` |
| 3 | 全仓**没有**任何 OCR 通路 | `packages/*/src` 内 grep `ocr` 零命中（不含本骨架） |

### 边界

1. **不自动出题。** 识别完只生成「候选片段」，用户勾选后才走既有 `generateQuiz()`。
2. **识别文本不进检索。** 建议 `layered-search` **不**收录 OCR 结果（噪声会污染排序），
   只在本次出题时可见 —— 见 TODO 4。
3. **不在主线程推理。** 必须用 `OcrEngineWorker`。
4. **图片不出本机**；但**模型默认从 CDN 拉**，这两件事不得在界面上混为一谈（TODO 3 / R-2）。
5. **失败降级为现状**：引擎起不来就退回「只能粘贴文字」，绝不让出题按钮点不动。

---

## ⚠ 风险

| # | 风险 | 说明 | 处理建议 |
| --- | --- | --- | --- |
| R-1 | **wasm 静态托管**（最大障碍） | `onnxruntime-web` 要求把 `*.wasm` 放在 `wasmPaths` 指定的可访问路径。本仓当前没有可写的静态资源管线 | 评审先回答 TODO 1 的 (a)/(b) 二选一 |
| R-2 | **模型外联** | `models-ppocrv5` 只是 jsDelivr 上的 URL 常量，首次识别必须联网下载几十 MB | 与产品定位冲突；要么内置、要么明示「首次需联网」，**不得**装作离线 |
| R-3 | **中文/手写准确率未经实测** | 上游只宣称字典覆盖 18,384 字，**没有任何中文准确率数字** | 用 3 类夹具各 10 张实测（TODO 3）；低于可接受线就把定位收窄为「仅印刷体」 |
| R-4 | **peer 区间在 npm 上不可满足** | 上游写 `onnxruntime-web: ^1.25.0`，但 npm 上 `1.25.0` 只有 `-dev.*` 预发布 | 本包锁 `1.25.1`；若上游后续依赖 `1.25.0` 的私有 ABI 则需要打补丁 |
| R-5 | **维护停滞** | ★3，5 个月未更新；PP-OCR 系模型更新很快 | 若评审通过，须在 `package.json` 写死并接受「不跟上游升级」；或直接自写（见下） |
| R-6 | **体积** | 138 MB 是**全后端**体积，实际产物只需 2–3 个 wasm | 评审实测「只留 wasm+simd」后的产物大小（TODO 2） |

> **备选方案（评审可考虑替代本包）**：不引入上游，直接用 `onnxruntime-web` + PP-OCRv5
> 的 ONNX 模型自写约 300 行推理。代价是自写前后处理（DBNet 后处理、CTC 解码），
> 好处是去掉 R-4 / R-5 两条风险。**本轮不做这个判断，留给人工。**

---

## 与本轮报告的关系

本轮的起点不是「找 OCR」，而是读 `dsh-zhiyun-quiz` 时发现的一件事：

```
全仓 grep recordAttempt → 只有 store.js:604 定义处一处，没有调用方
```

也就是说，**「作答」这条路本身还没接上**：`attempts` 轨道、错题归因、薄弱点统计
都已经写好并有测试，但产不出数据。这比 OCR 更靠前、更该先修 —— 而那件事**不需要任何外部依赖**，
所以本轮没有为它出骨架，只在报告里点名。本包补的是同一张表上**再往前一格**的缺环。

---

## 许可与归属

- 上游 MIT，本包**不搬运任何上游源码**，只通过 `import` 调用其公开入口（`.` 与 `./worker`）。
- 本包 `OWNERS`: `shared`。
- 未接入 `profiles/zhiyun-bench/package.json`，**不是** profile bundle。
