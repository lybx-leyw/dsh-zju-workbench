# 归属说明

本候选骨架由 `dsh-ecosystem-radar` 生成，**未评审、未接入 profile、不可直接使用**。

## 无运行时依赖

本包 `dependencies` 为空，**不 import 任何上游**，也不 vendor 任何代码。

## 口径出处（仅字段名与业务语义，未摘取任何代码）

- [`khalidhasan11/campuskit`](https://github.com/khalidhasan11/campuskit) · **MIT** ✅
  （`LICENSE` 1079 B 实文已核）· ★2 · TS/React/Capacitor · push 2026-10-26 · 990 KB。

  **已阅读**：`README.md`（`Attend` 节与 `Settings → Backup` 节）、
  `src/utils/dateAndMath.ts` 的 `computeAttendanceMetrics()` 与 `meetsRequirement`。

  **借用**：
  - 出勤动作的四个状态名 `Present / Late / Absent / Excused` 及其**语义**
    （`Late` 计入分母与分子；`Excused` 剔出分母）；
  - 每门课自带 `requiredPercentage`；
  - 「满足阈值」的整数判据形式 `attended * 10000 >= p * total`（`p` 为阈值 ×100）。

  **未借用**：`safeMisses` 的浮点实现（返小数的缺陷见 README）、任何 UI、任何测试代码。

## 参考（未采用）

- [`afnan-nex/Lectura`](https://github.com/afnan-nex/Lectura) · MIT · ★3 · React Native
  离线出勤追踪 + 课表 + safe-bunk。同为 MIT，但整包是 RN App，与本仓无共享层；
  思路与本包一致，未单独借鉴。
