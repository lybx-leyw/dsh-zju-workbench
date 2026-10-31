# ATTRIBUTION — dsh-zhiyun-core-classroom-agent

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **多智能体导演层**的移植，按上游 TS 重写
（文件头标 `// 源：…:<行范围>`），**不含逐字节副本**。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无** |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/actions.js`（课堂动作契约） | `lib/chat/pi/tools/classroom-actions.ts` |
| `src/director.js`（回合驱动循环） | `lib/chat/pi/director-loop.ts` |
| `src/prompts.js` | `lib/chat/pi/prompts.ts` |

## 改动

- 提示词重写为中文，并按本仓的「横版 slides + 画布外讲解」产物调整；
  上游是「口播驱动」，本仓改为「阅读驱动」，教师连续讲解的口吻保留。
- 花名册（teacher / assistant / student）的默认三件套逻辑保留自上游。
- 未知场景类型**直接报错**而不静默改写（上游同样如此），此行为按原样保留。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照 `lib/chat/pi/` 检查 `// 源：` 注释与行范围；
3. 跑 `node --test tests/classroom-agent.test.mjs`。
