# ATTRIBUTION

本候选骨架**未搬运任何上游源码**。以下为借鉴来源与边界，按 CONTRIBUTING 3.3 记录。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | **Aula-Finder** —— 安第斯大学空教室查找 |
| 仓库 | https://github.com/Open-Source-Uniandes/Aula-Finder |
| 作者 | Open-Source-Uniandes 社区贡献者 |
| 许可证 | **MIT** |
| 版权行 | 见上游根目录 `LICENSE`（未复制到本仓） |
| 引用日期 | 2026-11-03 |

## 借鉴了什么

只借鉴**语义与判定顺序**，未复制代码、未复制注释、未复制数据结构：

| 借鉴点 | 上游位置 |
| --- | --- |
| 教室四态（可用 / 占用 / 课间切换 / 受限），课间阈值 10 分钟 | `lib/query-utils.ts`、README「Los salones muestran su estado」 |
| 闭馆判定顺序：运营时段 → 节假日 → 特殊事件 | `lib/closures.ts` |
| 课程段 → (楼栋, 教室, 星期, 起止) 的剖分 | `lib/parse-courses.ts` |
| 「现在」→ 星期码 + HH:MM 的归一 | `lib/time-state.ts` |

## 明确未搬

- 上游的 Next.js 页面、React hook、`@/types` 别名体系
- 上游的 `data/*.json` 学期快照（他校数据）
- 上游的 GitHub Actions 抓取管道（绑定他校 API）

若评审通过后改为**直接引用**上游代码片段，必须在本文件补上 MIT 全文与版权声明。
