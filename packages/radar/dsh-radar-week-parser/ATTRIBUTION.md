# 归属声明

> **候选骨架：未评审 · 未接入 profile · 不可直接使用。** 本文件只用于留痕。

按 [CONTRIBUTING 3.3](../../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)：
本仓**已阅读**下列项目的源码以划定能力缺口与接口形状，**未复制任何源码**。
骨架内 `src/*.js` 全部是本仓自写的占位、签名与 TODO。

## 参考项目（只借行为规格，不引入依赖、不复制代码）

- [shou-graduate-calendar-exporter](https://github.com/wowhao333/shou-graduate-calendar-exporter)
  · **MIT** · `Copyright (c) 2026 SHOU Calendar Exporter contributors`
  · 版本 `0.1.1`（`package.json` 实核，`"type": "module"`）
  · 上海海洋大学研究生课表导出扩展（Chrome MV3 + Tampermonkey）

**阅读范围**：`LICENSE`、`README.md`、`package.json`、`core/schedule.js`、`core/exporters.js`

**借用范围（行为规格，非代码）**：

| 上游符号 | 借用内容 | 本仓落点 |
| --- | --- | --- |
| `parseWeeks(text)` | 中文标点归一口径（`－ — – ~ ～ 至` → `-`；`， 、 ； ;` → `,`；删 `第` `周`）、区间倒序容错、`(0,60]` 过滤 | `src/upstream.js` → `normalizeWeeks()` 的 TODO |
| `inferWeekOneMonday(blocks)` | 「多块投票 + 票数排序」的反推思路 | `src/upstream.js` → `inferFirstMonday()` 的 TODO |

**明确未借用**：

- `exporters.js` 的 `foldIcsLine()`（75 字节折行）—— 本仓 `dsh-radar-ics-export` 已按 RFC 5545 处理
- `exporters.js` 的手写 `TZID=Asia/Shanghai` / `VTIMEZONE` —— 本仓该事项**待产品拍板**，不绕过
- `stableUid()` / `stableHash()` —— 本仓 TODO-C 规格更严
- `findConflicts()` / `normalizeTime()` / `normalizeDomCapture()` / `normalizeApiJson()`

**本仓相对上游的修正**（上游有缺陷，本仓不照抄）：

- 单双周混写判定：上游 `含"单" ? 1 : 含"双" ? 0 : null` 会静默丢课；
  本仓要求返回结构化 `parity`，`mixed` 由调用方处理（见 `src/upstream.js` 的 `UPSTREAM_PARITY_DEFECT`）。

**本仓新增（上游无对应实现）**：

- `fromParity(parity, totalWeeks)` —— 服务本仓 `source-zdbk` 的 `'all'|'odd'|'even'` 语义。

**无运行时依赖**：本包 `dependencies` 为空，不引入上游任何 npm 包（上游 `core/` 本身也零依赖）。
