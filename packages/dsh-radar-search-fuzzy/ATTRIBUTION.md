# 归属声明

> **候选骨架：未评审 · 未接入 profile · 不可直接使用。** 本文件只用于留痕。

按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)：
本仓**已阅读**下列项目的源码/文档以划定能力缺口与接口形状，**未复制任何源码**。
骨架内 `src/*.js` 全部是本仓自写的占位与 TODO。

## 运行时拟依赖（锁版引入，不复制源码）

- [Fuse.js](https://github.com/krisk/Fuse) · **Apache-2.0** · 作者 Kiro Risk（`krisk`）
  · 版本 `7.5.0`（精确锁定）。轻量模糊检索（bitap 算法 + 模式预编译 + 可选 extended search）。
  本包拟在「学习」页分层检索的 `findIn()` 底层锁版调用它的 **basic 构建**，**不改上游源码**，
  也不分发上游产物（一律走 npm 依赖）。

阅读范围：仓库 `README.md`、npm `package.json`（`exports` / `dependencies` / `license`）、
产物 `dist/fuse.basic.min.mjs`（仅读文件头版权声明与导出形态）、`LICENSE`。
用途：确认（a）Apache-2.0 实文与三处 `spdx_id` 一致；（b）`7.5.0` 的出口清单
（**无 `dist/fuse.min.js`**）；（c）`search()` 返回的 `matches[].indices` 为**闭区间**、
且**不保证存在**（→ 风险 R3）；（d）`dependencies = {}` 零传递依赖。
**未运行**上游测试、**未阅读**其算法实现细节（bitap 的具体实现未照抄，也不需要照抄 ——
本包只用公开 API）。

## 仅评估、**未采用**（同轮候选，已在 registry 登记）

- [fuzzysort](https://github.com/farzher/fuzzysort) · **MIT** · ★4,356 · `4.0.2`。
  只返回「子序列命中」，**没有内建的错字容差**（`傅利叶` 这类替换错直接落空），
  与本包要解决的问题正交度不足 → 未出骨架。
- [uFuzzy](https://github.com/leeoniya/uFuzzy) · **MIT** · ★3,038 · `1.0.19`。
  实测：其 `intraIns` / `intraMode` 对**中文单字替换**基本无效（`付里叶` / `中植定理` /
  `离散傅里叶` 全部 0 命中，只有纯英文 `fourier` 命中）→ 中文场景下增益不成立，未出骨架。
  若将来只做过英文/代码符号检索，它仍是更省的候选（8.4 KB iife）。

## 与同仓既有骨架的关系

`packages/dsh-radar-pinyin-match/`（`pinyin-match@1.2.10`，MIT）与本包**都改 `findIn`**，
但解决的是不同问题（**读音** vs **错字**）。两份骨架**不得同时实现**，需合并裁决；
详见 [README](./README.md#与同族骨架的边界避免同一处换两次底层)。
