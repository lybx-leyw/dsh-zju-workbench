# ATTRIBUTION

本包**未复制上游任何源码**，仅借用其**判据与阈值**（行为规格）。按 CONTRIBUTING 3.3 记录如下。

| 项 | 值 |
| --- | --- |
| 上游 | <https://github.com/bruc3van/awesome-dsh-plugin> |
| 许可证 | **MIT**（Copyright (c) 2026 Bruce Van） |
| 借鉴文件 | `scripts/star-anomaly.mjs` |
| 借鉴内容 | 三条判据名与阈值：`SURGE_DELTA = 100`、`CLAWBACK_DELTA = 100`、`PENDING_STAR_FLOOR = 100`、`★/fork >= 100`；以及「掉星 = 批量清号回收签名」这一**经验结论** |
| 未借鉴 | 榜单相关信号（`board_entry` / `board_leap` / `top20_entry`）与其排名计算；采集流水线；任何数据文件 |
| 代码复制 | **无**。`src/upstream.js` 只记录常量与口径，未包含上游函数体 |

若后续实现中**逐字**引用了上游函数，必须在此补充：文件名 + 函数名 + 复制范围。
