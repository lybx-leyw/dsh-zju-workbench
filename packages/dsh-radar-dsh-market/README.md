# dsh-radar-dsh-market

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-14）。采用前请**重写**并走正常包流程。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/dsh-market/dsh-market |
| 许可证 | MIT |
| 语言 | TypeScript |
| ★ | 6494 |

## 集成判定

- **类型**：A · 原生 DSH 插件包（最高优先）
- **与现有功能的关系**：**强化式集成** —— 增强本仓「插件」页（`dsh-zhiyun-page-plugins`）
- **集成方式**：锁版挂载上游 + 外围兼容层（效法 `packages/dsh-zhiyun-paper` 与 `dsh-zhiyun-page-paper`）
- **UI 预期**：仍是**同一个「插件」面板**，不新增页面、不改交互

## 尚未完成（采用前必做）

- [ ] 确认上游版本并**锁版**引入（`dependencies`，版本写死）
- [ ] 撰写兼容层（挂载上游 + 主题注入 + 控件接管）
- [ ] 测试（`npm test`）、接入 profile、按 CONTRIBUTING 写 `OWNERS`
