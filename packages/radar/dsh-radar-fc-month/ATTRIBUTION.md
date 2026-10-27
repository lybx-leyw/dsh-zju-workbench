# ATTRIBUTION —— dsh-radar-fc-month

> 本包**未摘取上游任何源码**（`src/` 下全部是占位与 TODO，不含实现）。
> 本节只记录「等价借鉴」与「替代关系」，按 `CONTRIBUTING.md` 3.3 登记。

| 项 | 来源 | 许可证 | 形式 |
| --- | --- | --- | --- |
| 月视图日期网格（7 列、首尾补格、`fixedWeeks`） | [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) `dayGridMonth` 时间单位 | **MIT** | **锁版依赖**（`fullcalendar@5.11.5`），不复制代码 |
| 「补格标 `outside`、照常显示内容」的视觉约定 | 本仓 `packages/dsh-zhiyun-page-planning/src/time.js:275` 与 `style.css:813` | 本仓自有 | 保留，不来自上游 |

## 替代关系（不是借鉴，是替换）

本包要**替换**的是本仓自有实现 `buildMonthCalendar()`（`time.js:257-341`，约 80 行）。
替换后该函数的**签名与返回形状不变**，调用方（`client.jsx:902`）一行不改。

本仓自有实现**不会删除**，保留为 `buildMonthCalendar()` 的回退路径与对照物，
并在注释里指向本包 README 的 F-1 复现步骤。

## 未借鉴

- 上游的 DOM 渲染（`render()` / `Calendar` 实例）：与本仓 `data-zhiyun` 主题变量、
  `zpg-cal-*` 类名、三个勾选回调冲突，见 README H-2。
- 上游 `main.css`：见 README H-1。
- 上游 v6 / v7：依赖 `preact`，解包 3.2 MB / 4.1 MB，只为一个网格不值得，见 README 版本表。
