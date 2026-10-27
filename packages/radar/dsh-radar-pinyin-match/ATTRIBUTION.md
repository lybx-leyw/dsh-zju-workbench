# 归属声明

> **候选骨架：未评审 · 未接入 profile · 不可直接使用。** 本文件只用于留痕。

按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)：
本仓**已阅读**下列项目的源码/文档以划定能力缺口与接口形状，**未复制任何源码**。
骨架内 `src/*.js` 全部是本仓自写的占位与 TODO。

## 运行时拟依赖（锁版引入，不复制源码）

- [pinyin-match](https://github.com/xmflswood/pinyin-match) · **MIT** · 作者 `xmflswood`（774898896@qq.com）
  · 版本 `1.2.10`（精确锁定）。拼音检索（汉字/全拼/首字母/多音字/繁体）。
  本包拟在「学习」页分层检索的 `findIn()` 底层锁版调用它，**不改上游源码**。

阅读范围：仓库 `README.md`、`src/core.js`、`src/simplified.js`、`src/traditional.js`、
`src/simplified_dict.js`（字典形状，抽样）、`test/index.test.js`、`LICENSE`。
用途：确认（a）MIT 实文；（b）`match()` 返回闭区间且未命中回 `false`（→ 风险 R1/R2）；
（c）简/繁两个入口的字典边界 —— 实测「简体入口对纯繁体文本的拼音查询回 false」（→ 风险 R3）。

## 仅评估、**未采用**

- [opencc-js](https://github.com/nk2028/opencc-js) · **MIT AND Apache-2.0** · ★361 · `1.4.2`。
  简繁转换。已实测其 `cn→twp` 转词能力（「头发→頭髮」等），但**本轮不引入**：
  它解决问题的方式（整库转写 / 改写用户输入）与本包「查询侧多一种读法」的边界冲突，
  且 `dist/umd/full.js` 为 **1.1MB**。详见 [README](./README.md#为什么不选-opencc-js同轮候选) 与
  `docs/ecosystem-radar/2026-10-19.md`。
