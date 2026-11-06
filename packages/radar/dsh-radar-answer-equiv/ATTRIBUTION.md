# 归属声明

> **候选骨架：未评审 · 未接入 profile · 不可直接使用。** 本文件只用于留痕。

按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)：
本仓**已阅读**下列项目的源码/文档以划定能力缺口与接口形状，**未复制任何源码**。
骨架内 `src/*.js` 全部是本仓自写的占位与 TODO。

## 运行时拟依赖（锁版引入，不复制源码）

- [decimal.js](https://github.com/MikeMcl/decimal.js) · **MIT** · 作者 Michael Mclaughlin
  · 版本 `10.6.0`（精确锁定）。任意精度十进制数与 `equals()`。
  本包拟在「学习」页的作答判定底层锁版调用它，**不改上游源码**。

阅读范围：`README.md`、`package.json`、npm 元数据（版本 / 许可 / 依赖 / 体积）。
用途：确认（a）MIT 实文；（b）`dist-tags.latest = 10.6.0`、`dependencies = {}`；
（c）`Decimal#equals` 为任意精度比较（→ 用于 `1/2` 与 `0.5` 这类不同写法的等值判定）。

## 仅评估、**未采用**

- [Achuan-2/chinese_number_to_digits](https://github.com/Achuan-2/chinese_number_to_digits)
  · **MIT** · ★1 · `js/convertChineseNumber.js`（4.0KB，无 ESM 导出、无 npm 包）。
  **未采用**：实测 `一千二百万 → 1002000000`、`十二亿三千四百万 → 4204000000`（均错）。
  仅在沙箱内跑其函数做**行为观测**，未摘取任何代码。
- [spa5k/chinese-numbers-to-arabic](https://github.com/spa5k/chinese-numbers-to-arabic)
  · **MIT** · ★5 · npm `2.0.0`（24.7KB，`dependencies = {}`）。
  **未采用**：实测 `一亿二千万 → 1000020000000`（错）。
- [Wall-ee/chinese2digits](https://github.com/Wall-ee/chinese2digits) · **无许可证（`null`）**
  · ★374 · Python。**⛔ 红线**：无许可证，只登记「仅供参考」，不摘码、不移植。
- [lisez/lib-arabic-chinese](https://github.com/lisez/lib-arabic-chinese) · **MIT** · ★4
  · npm `2.0.0`（18KB）。单向（阿拉伯→中文繁体大写），与判分所需方向相反，仅记录。
- [anton-bot/chinese-numbers-converter.js](https://github.com/anton-bot/chinese-numbers-converter.js)
  · **Unlicense** ✅ · ★24 · 2020 停更。单向，且未覆盖「亿/万」复合读法，仅记录。
- [chinesenum](https://github.com/LiuQixuan/ChineseNumerals) · **MIT** · npm `1.0.2`。
  README 称双向，**实测 `chinanumeralsToNum` 对任意输入均抛 `Cannot read properties of undefined`**
  → 实际只有单向可用。
- [HardusLom/UnitLab](https://github.com/HardusLom/UnitLab) · **无许可证（`null`）** · ★0
  · TS。单位换算轴的同轮唯一命中，无许可证 → ⛔ 只登记。
